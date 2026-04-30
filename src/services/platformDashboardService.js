import { db } from '../firebase/client';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  documentId,
  onSnapshot
} from 'firebase/firestore';
import eventBus from './EventBus';
import DataCache from './dataCache';

// NOTE: We use company doc fields (currentEmployeeCount, billingActiveSeatCount) instead of
// getCountFromServer to avoid 100+ aggregation queries per page load (was causing 262 req loop)

const GBP_FORMATTER = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0
});

const DEFAULT_STATS = {
  totalCompanies: 0,
  activeCompanies: 0,
  inactiveCompanies: 0,
  totalUsers: 0,
  totalSeats: 0,
  monthlyRevenue: 0,
  monthlyRevenueDisplay: GBP_FORMATTER.format(0)
};

const MONTHLY_SEAT_PRICE = 5;

const formatCurrency = (value = 0) => {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  return GBP_FORMATTER.format(safeValue);
};

const formatDate = (value) => {
  if (!value) return '—';
  try {
    if (typeof value === 'string') {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? '—' : parsed.toISOString().slice(0, 10);
    }
    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }
    if (value?.toDate) {
      return value.toDate().toISOString().slice(0, 10);
    }
  } catch (error) {
    console.warn('[platformDashboardService] Failed to format date:', error);
  }
  return '—';
};

const stripPathId = (value) => {
  if (!value || typeof value !== 'string') return value || null;
  return value.includes('/') ? value.split('/').pop() : value;
};

const chunkArray = (items = [], size = 10) => {
  if (!Array.isArray(items) || size <= 0) return [];
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const buildOwnerEmailMap = async (ownerIds = []) => {
  const uniqueIds = Array.from(new Set(ownerIds.map(stripPathId).filter(Boolean)));
  if (uniqueIds.length === 0) return {};

  const emailMap = {};
  const chunks = chunkArray(uniqueIds, 10);

  await Promise.all(chunks.map(async (chunk) => {
    try {
      const ownersSnap = await getDocs(
        query(collection(db, 'users'), where(documentId(), 'in', chunk))
      );
      ownersSnap.forEach((ownerDoc) => {
        emailMap[ownerDoc.id] = ownerDoc.data()?.email || 'Not provided';
      });
    } catch (error) {
      console.warn('[platformDashboardService] Failed to fetch owner emails chunk:', error);
    }
  }));

  return emailMap;
};

const fetchLatestPayment = async (companyPath) => {
  try {
    let paymentsSnap = null;
    try {
      paymentsSnap = await getDocs(
        query(
          collection(db, 'payments'),
          where('companyId', '==', companyPath),
          orderBy('createdAt', 'desc'),
          limit(1)
        )
      );
    } catch (orderError) {
      console.warn('[platformDashboardService] Payments query failed (orderBy). Retrying without orderBy.', orderError);
      paymentsSnap = await getDocs(
        query(collection(db, 'payments'), where('companyId', '==', companyPath))
      );
    }

    if (!paymentsSnap || paymentsSnap.empty) {
      return null;
    }

    const paymentDoc =
      paymentsSnap.docs.length === 1
        ? paymentsSnap.docs[0]
        : paymentsSnap.docs.sort(
          (a, b) =>
            (b.data().createdAt?.toMillis?.() || 0) -
            (a.data().createdAt?.toMillis?.() || 0)
        )[0];

    const data = paymentDoc.data();

    // Try multiple field variations for payment method
    const paymentMethod =
      data.paymentMethod ||
      data.method ||
      data.payment_method ||
      data.paymentType ||
      data.type ||
      data.source?.type ||
      data.card?.brand ||
      (data.card?.last4 ? `Card ending ${data.card.last4}` : null) ||
      (data.last4 ? `Card ending ${data.last4}` : null) ||
      data.billingMethod ||
      '—';

    return {
      status: data.status || '—',
      date: formatDate(data.createdAt),
      method: paymentMethod
    };
  } catch (error) {
    console.warn('[platformDashboardService] Failed to fetch latest payment:', error);
    return null;
  }
};

const fetchActiveSubscription = async (companyPath) => {
  try {
    let subscriptionSnap = null;
    try {
      subscriptionSnap = await getDocs(
        query(
          collection(db, 'subscriptions'),
          where('companyId', '==', companyPath),
          where('status', '==', 'active'),
          orderBy('periodEnd', 'desc'),
          limit(1)
        )
      );
    } catch (orderError) {
      console.warn('[platformDashboardService] Subscription query failed (orderBy). Retrying without orderBy.', orderError);
      subscriptionSnap = await getDocs(
        query(
          collection(db, 'subscriptions'),
          where('companyId', '==', companyPath),
          where('status', '==', 'active')
        )
      );
    }

    if (!subscriptionSnap || subscriptionSnap.empty) {
      return null;
    }

    const subscriptionDoc =
      subscriptionSnap.docs.length === 1
        ? subscriptionSnap.docs[0]
        : subscriptionSnap.docs.sort(
          (a, b) =>
            (b.data().periodEnd?.toMillis?.() || 0) -
            (a.data().periodEnd?.toMillis?.() || 0)
        )[0];

    const data = subscriptionDoc.data();

    // Try multiple field variations for payment method
    const paymentMethod =
      data.paymentMethod ||
      data.billingMethod ||
      data.method ||
      data.payment_method ||
      data.paymentType ||
      data.defaultPaymentMethod ||
      data.source?.type ||
      data.card?.brand ||
      (data.card?.last4 ? `Card ending ${data.card.last4}` : null) ||
      (data.last4 ? `Card ending ${data.last4}` : null) ||
      '—';

    return {
      nextBilling: formatDate(data.periodEnd),
      paymentMethod
    };
  } catch (error) {
    console.warn('[platformDashboardService] Failed to fetch active subscription:', error);
    return null;
  }
};

const MAX_COMPANIES_QUERY = 500; // SCALABILITY: Cap to avoid unbounded read
const CACHE_KEY = 'platform-overview';

// In-flight promise to deduplicate concurrent calls (prevents 86+ duplicate requests)
let inFlightPromise = null;

/**
 * Returns the cached platform overview data synchronously if available
 */
export function getCachedPlatformOverview() {
  try {
    return DataCache.get(CACHE_KEY);
  } catch (err) {
    return null;
  }
}

/**
 * Clears the platform overview cache
 */
export function clearPlatformCache() {
  try {
    DataCache.delete(CACHE_KEY);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Processes a list of company document snapshots into the dashboard overview data structure.
 * Internal helper to keep processing logic dry between fetch and sync.
 */
async function processCompanyDocs(companyDocs, limitCompanies) {
  const trimmedDocs =
    typeof limitCompanies === 'number' && limitCompanies > 0
      ? companyDocs.slice(0, limitCompanies)
      : companyDocs;

  const ownerIds = trimmedDocs
    .map((docSnap) => docSnap.data()?.ownerUserId)
    .filter(Boolean);

  const ownerEmailMap = await buildOwnerEmailMap(ownerIds);

  const statsAccumulator = {
    ...DEFAULT_STATS
  };

  const companies = await Promise.all(
    trimmedDocs.map(async (docSnap) => {
      const data = docSnap.data() || {};
      const companyId = docSnap.id;

      // Get user count: use company document fields only (avoid N aggregation queries per page load)
      const userCount = Number.isFinite(Number(data.currentEmployeeCount || data.billingActiveSeatCount))
        ? Math.max(0, Number(data.currentEmployeeCount || data.billingActiveSeatCount || 0))
        : 0;

      // Get seat count: prefer billingSeatQuota, fallback to seatCount, then userCount
      let seatCount = Number(data.billingSeatQuota || data.seatCount || 0);
      if (!Number.isFinite(seatCount) || seatCount <= 0) {
        seatCount = Math.max(userCount, 0);
      }

      // Get price per seat
      const pricePerSeat = Number.isFinite(Number(data.billingPricePerSeat))
        ? Number(data.billingPricePerSeat)
        : Number.isFinite(Number(data.pricePerSeat))
          ? Number(data.pricePerSeat)
          : MONTHLY_SEAT_PRICE;

      // Add-ons
      let addonsCost = 0;
      if (data.plugins?.scheduling) {
        addonsCost += 2.50;
      }

      // Calculate monthly revenue from billingSeatQuota (actual paid seats)
      const billingSeatQuota = Number(data.billingSeatQuota || data.seatCount || seatCount || 0);
      let monthlyRevenue = (billingSeatQuota * pricePerSeat) + addonsCost;

      // Trial check
      const baseStatus = data.billingSubscriptionStatus || data.subscriptionTier || 'trial';
      const rawTrialEndsAt = data.billingTrialEndsAt || data.trialEndsAt;
      let trialEndsAtDate = null;
      if (rawTrialEndsAt) {
        try {
          trialEndsAtDate = rawTrialEndsAt.toDate ? rawTrialEndsAt.toDate() : new Date(rawTrialEndsAt);
        } catch (e) {
          // ignore
        }
      }
      const now = new Date();
      if (baseStatus === 'trial' && trialEndsAtDate && now <= trialEndsAtDate) {
        monthlyRevenue = 0;
      }

      const status = (data.status || 'inactive').toLowerCase() === 'active' ? 'active' : 'Suspended';
      const industry = data.industry || 'Not specified';
      const joinDate = formatDate(data.createdAt);

      statsAccumulator.totalCompanies += 1;
      if (status === 'active') {
        statsAccumulator.activeCompanies += 1;
      } else {
        statsAccumulator.inactiveCompanies += 1;
      }
      statsAccumulator.totalUsers += userCount;
      statsAccumulator.totalSeats += seatCount;
      statsAccumulator.monthlyRevenue += monthlyRevenue;

      let ownerEmail = data.billingEmail || data.contactEmail || data.ownerEmail || data.email || 'Not provided';
      const ownerId = stripPathId(data.ownerUserId);
      if ((!ownerEmail || ownerEmail === 'Not provided') && ownerId) {
        ownerEmail = ownerEmailMap[ownerId] || ownerEmail;
      }

      const nextBilling = formatDate(data.billingRenewalDate) || '—';
      const lastPayment = formatDate(data.billingLastPaymentAt) || '—';

      let paymentMethod =
        data.defaultPaymentMethod ||
        data.paymentMethod ||
        data.billingMethod ||
        null;

      if (!paymentMethod && data.billingLastPaymentType) {
        const lastPaymentType = String(data.billingLastPaymentType).toLowerCase();
        if (lastPaymentType === 'subscription' || lastPaymentType === 'seat_topup') {
          paymentMethod = 'Card';
        } else if (lastPaymentType === 'trial') {
          paymentMethod = 'Trial';
        } else if (lastPaymentType.includes('bank') || lastPaymentType.includes('transfer')) {
          paymentMethod = 'Bank Transfer';
        } else if (lastPaymentType.includes('cash')) {
          paymentMethod = 'Cash';
        } else if (lastPaymentType.includes('cheque') || lastPaymentType.includes('check')) {
          paymentMethod = 'Cheque';
        }
      }

      if (!paymentMethod && Array.isArray(data.billingHistory) && data.billingHistory.length > 0) {
        const sortedHistory = [...data.billingHistory].sort(
          (a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0)
        );
        const latestHistory = sortedHistory[0];
        if (latestHistory?.type && latestHistory.type !== 'trial') {
          paymentMethod = latestHistory.type === 'subscription' || latestHistory.type === 'seat_topup'
            ? 'Card'
            : null;
        }
      }

      if ((!paymentMethod || paymentMethod === '—') && lastPayment !== '—' && nextBilling !== '—') {
        paymentMethod = 'Card';
      }

      return {
        id: companyId,
        name: data.name || 'Unnamed Company',
        category: industry,
        email: ownerEmail || 'Not provided',
        status,
        users: userCount,
        revenue: formatCurrency(monthlyRevenue),
        joinDate,
        nextBilling,
        lastPayment,
        paymentMethod
      };
    })
  );

  const stats = {
    ...statsAccumulator,
    monthlyRevenueDisplay: formatCurrency(statsAccumulator.monthlyRevenue)
  };

  return {
    stats,
    companies,
    lastUpdated: new Date().toISOString()
  };
}

export async function fetchPlatformOverview({ limitCompanies = 100, skipCache = false } = {}) {
  // 1. CACHE-FIRST: Return cached data if available for instant UI
  if (!skipCache) {
    try {
      const cached = DataCache.get(CACHE_KEY);
      if (cached) {
        if (!inFlightPromise) {
          console.log('[platformDashboardService] SWR: Triggering background refresh');
          const p = doFetch().then(freshData => {
            eventBus.emit('platform_cache_updated', freshData);
            return freshData;
          }).catch(err => {
            console.warn('[platformDashboardService] Background refresh failed:', err);
          });
        }
        return cached;
      }
    } catch (e) { /* ignore */ }

    if (inFlightPromise) return inFlightPromise;
  }

  const doFetch = async () => {
    try {
      const cap = Math.min(limitCompanies || 100, MAX_COMPANIES_QUERY);
      const companiesQuery = query(
        collection(db, 'companies'),
        limit(cap)
      );
      const companiesSnap = await getDocs(companiesQuery);
      const companyDocs = companiesSnap.docs.sort(
        (a, b) =>
          (b.data().createdAt?.toMillis?.() || 0) -
          (a.data().createdAt?.toMillis?.() || 0)
      );

      const result = await processCompanyDocs(companyDocs, limitCompanies);

      // PERSISTENCE: Save to cache
      try {
        DataCache.set(CACHE_KEY, result);
      } catch (e) { /* ignore */ }

      return result;
    } catch (error) {
      console.error('[platformDashboardService] Failed to fetch platform overview:', error);
      throw error;
    } finally {
      inFlightPromise = null;
    }
  };

  inFlightPromise = doFetch();
  return inFlightPromise;
}

/**
 * Subscribe to real-time updates for the platform dashboard.
 * Listens for collection changes and processes data as it arrives.
 */
export function subscribeToPlatformOverview(callback, limitCompanies = 100) {
  const cap = Math.min(limitCompanies || 100, MAX_COMPANIES_QUERY);
  const q = query(
    collection(db, 'companies'),
    limit(cap)
  );

  let isFirstLoad = true;

  // SCALABILITY: onSnapshot handles adding/removing/updating automatically
  return onSnapshot(q, async (snapshot) => {
    try {
      if (snapshot.metadata.fromCache && !isFirstLoad) {
        // Skip intermediate cache hits if we already have server data
        return;
      }
      isFirstLoad = false;

      const companyDocs = snapshot.docs.sort(
        (a, b) =>
          (b.data().createdAt?.toMillis?.() || 0) -
          (a.data().createdAt?.toMillis?.() || 0)
      );

      const result = await processCompanyDocs(companyDocs, limitCompanies);

      // Update cache so next page reload gets fresh data
      try {
        DataCache.set(CACHE_KEY, result);
      } catch (e) { /* ignore */ }

      if (callback) callback(result);
    } catch (error) {
      console.error('[platformDashboardService] Real-time subscription error:', error);
    }
  });
}

export { DEFAULT_STATS };




