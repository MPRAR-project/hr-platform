import { db } from '../firebase/client';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit
} from 'firebase/firestore';
import { fetchEnhancedUserGroups } from './userGroupingService';
import { getUserDisplayName, safeParseDate } from '../utils/dataParser';

const GBP_FORMATTER = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

const PRICE_PER_SEAT = 5;

const formatCurrency = (value) => {
  const safeValue = Number.isFinite(value) ? value : 0;
  return GBP_FORMATTER.format(Math.max(0, safeValue));
};

const formatCurrencyWithDecimals = (value) => {
  const formatter = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP'
  });
  const safeValue = Number.isFinite(value) ? value : 0;
  return formatter.format(Math.max(0, safeValue));
};

const formatDate = (value) => {
  if (!value) return '—';
  try {
    if (value?.toDate) {
      return value.toDate().toISOString().slice(0, 10);
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  } catch (err) {
    console.warn('[companyService] Failed to format date:', err);
  }
  return '—';
};

const formatMonthLabel = (value) => {
  if (!value) return '—';
  try {
    const date = value?.toDate ? value.toDate() : new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const formatter = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
    return formatter.format(date);
  } catch (error) {
    console.warn('[companyService] Failed to format month label:', error);
    return '—';
  }
};

const buildCompanyInfo = (companyDoc) => {
  const data = companyDoc.data() || {};

  // Get payment method: check multiple sources
  let paymentMethod =
    data.defaultPaymentMethod ||
    data.paymentMethod ||
    data.billingMethod ||
    null;

  // Check billingLastPaymentType to infer payment method
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

  // Check billing history for payment method
  if (!paymentMethod && Array.isArray(data.billingHistory) && data.billingHistory.length > 0) {
    const sortedHistory = [...data.billingHistory].sort(
      (a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0)
    );
    const latestHistory = sortedHistory[0];
    if (latestHistory?.type && latestHistory.type !== 'trial') {
      if (latestHistory.type === 'subscription' || latestHistory.type === 'seat_topup') {
        paymentMethod = 'Card';
      }
    }
  }

  // Default fallback
  if (!paymentMethod) {
    paymentMethod = 'Not provided';
  }

  return {
    id: companyDoc.id,
    name: data.name || 'Company',
    status: (data.status === 'active') ? 'active' : 'Inactive',
    industry: data.industry || 'Not specified',
    joinDate: formatDate(data.createdAt),
    contactEmail: data.contactEmail || data.ownerEmail || 'Not provided',
    billingEmail: data.billingEmail || data.contactEmail || 'Not provided',
    website: data.website || 'Not provided',
    phone: data.phone || 'Not provided',
    address: data.address?.line1 || data.address?.raw || 'Not provided',
    paymentMethod,
    seatCount: Number(data.seatCount) || 0,
    currentUsers: Number(data.currentEmployeeCount) || 0,
    pricePerSeat: formatCurrencyWithDecimals(PRICE_PER_SEAT),
    createdAt: data.createdAt
  };
};

const buildQuickStats = (companyInfo, paymentHistory) => {
  const currentUsers = Number.isFinite(companyInfo.currentUsers)
    ? Math.max(0, companyInfo.currentUsers)
    : 0;
  const seatCount = Number.isFinite(companyInfo.seatCount) && companyInfo.seatCount > 0
    ? Math.max(companyInfo.seatCount, currentUsers)
    : currentUsers;
  const monthlyRevenue = seatCount * PRICE_PER_SEAT;
  const totalRevenue = paymentHistory.reduce((sum, payment) => {
    const totalValue = payment.rawTotalAmount ?? 0;
    return sum + (Number.isFinite(totalValue) ? totalValue : 0);
  }, 0);

  return {
    currentUsers,
    pricePerSeat: `${formatCurrencyWithDecimals(PRICE_PER_SEAT)}/Month`,
    monthlyRevenue: formatCurrencyWithDecimals(monthlyRevenue),
    totalRevenue: formatCurrencyWithDecimals(totalRevenue)
  };
};

const normalizePaymentHistory = (paymentsDocs, fallbackUsers, fallbackSeatPrice) => {
  return paymentsDocs.map((paymentDoc) => {
    const data = paymentDoc.data() || {};
    const userCount =
      Number(data.userCount) ||
      Number(data.users) ||
      Number(data.totalUsers) ||
      Number(data.lineItems?.[0]?.quantity) ||
      fallbackUsers ||
      0;

    const seatPriceRaw =
      Number(data.pricePerSeat) ||
      Number(data.unitPrice) ||
      Number(data.lineItems?.[0]?.unitAmount) ||
      fallbackSeatPrice;

    const seatPrice = seatPriceRaw > 100 ? seatPriceRaw / 100 : seatPriceRaw;

    const totalAmountRaw =
      Number(data.totalAmount) ||
      Number(data.amount) ||
      Number(data.total) ||
      Number(data.lineItems?.[0]?.amount) ||
      userCount * seatPrice;

    const paymentMethod = data.paymentMethod || data.method || '—';
    const status = data.status || data.paymentStatus || 'paid';
    const createdAt = data.createdAt || data.paymentDate;

    return {
      month: formatMonthLabel(createdAt),
      users: userCount,
      price: formatCurrencyWithDecimals(seatPrice),
      total: formatCurrencyWithDecimals(totalAmountRaw),
      date: formatDate(createdAt),
      method: paymentMethod,
      status,
      rawTotalAmount: totalAmountRaw,
      source: 'payments'
    };
  });
};

const normalizeBillingHistory = (billingHistoryArray, fallbackSeatPrice) => {
  if (!Array.isArray(billingHistoryArray) || billingHistoryArray.length === 0) {
    return [];
  }

  return billingHistoryArray
    .filter(entry => entry && entry.type && entry.type !== 'trial') // Exclude trial entries
    .map((entry) => {
      const seats = Number(entry.seats) || 0;
      const amount = Number(entry.amount) || 0;
      const seatPrice = amount > 0 && seats > 0 ? amount / seats : fallbackSeatPrice;

      // Get date from createdAtMs (milliseconds) or createdAt (ISO string)
      let createdAt = null;
      if (entry.createdAtMs) {
        createdAt = new Date(entry.createdAtMs);
      } else if (entry.createdAt) {
        createdAt = typeof entry.createdAt === 'string'
          ? new Date(entry.createdAt)
          : (entry.createdAt?.toDate ? entry.createdAt.toDate() : null);
      }

      // Infer payment method from type
      let paymentMethod = '—';
      if (entry.type === 'subscription' || entry.type === 'seat_topup') {
        paymentMethod = 'Card';
      } else if (entry.type === 'bank_transfer' || entry.type === 'bank') {
        paymentMethod = 'Bank Transfer';
      } else if (entry.type === 'cash') {
        paymentMethod = 'Cash';
      } else if (entry.type === 'cheque' || entry.type === 'check') {
        paymentMethod = 'Cheque';
      }

      return {
        month: formatMonthLabel(createdAt),
        users: seats,
        price: formatCurrencyWithDecimals(seatPrice),
        total: formatCurrencyWithDecimals(amount),
        date: formatDate(createdAt),
        method: paymentMethod,
        status: 'paid',
        rawTotalAmount: amount,
        source: 'billingHistory',
        type: entry.type,
        note: entry.note || null
      };
    });
};

const FETCH_COMPANY_DETAILS_OVERALL_TIMEOUT = 25000; // 25s - prevent indefinite loader

export async function fetchCompanyDetails(companyId) {
  if (!companyId) {
    throw new Error('Company ID is required');
  }

  const doFetch = async () => {
    // Sanitize companyId to ensure it's just the ID, not a path
    const sanitizedCompanyId = companyId.replace('companies/', '');

    // Timeout helper: if Firestore hangs (network issue / security rule defer), reject
    const withTimeout = (promise, ms = 15000, label = 'query') =>
      Promise.race([
        promise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`[companyService] ${label} timed out after ${ms}ms`)), ms)
        )
      ]);

    const companyRef = doc(db, 'companies', sanitizedCompanyId);
    const companyPath = `companies/${sanitizedCompanyId}`;

    // Build TWO payment queries upfront (ordered preferred, unordered fallback).
    // Both are fired as part of the parallel block so neither creates a sequential retry.
    const paymentsOrderedQuery = query(
      collection(db, 'payments'),
      where('companyId', '==', companyPath),
      orderBy('createdAt', 'desc'),
      limit(12)
    );
    const paymentsFallbackQuery = query(
      collection(db, 'payments'),
      where('companyId', '==', companyPath)
    );
    const siteManagersQuery = query(
      collection(db, 'users'),
      where('companyId', '==', companyPath),
      where('primaryRole', '==', 'siteManager')
    );

    const fetchPayments = async () => {
      try {
        return await withTimeout(getDocs(paymentsOrderedQuery), 10000, 'payments-ordered');
      } catch {
        console.warn('[companyService] Ordered payments query failed, using fallback');
        return await withTimeout(getDocs(paymentsFallbackQuery), 10000, 'payments-fallback');
      }
    };

    // Run all primary fetches in parallel with individual timeouts
    const [
      companySnap,
      groupsResultPromise,
      paymentsSnapshot,
      siteManagersSnap
    ] = await Promise.allSettled([
      withTimeout(getDoc(companyRef), 10000, 'company-doc'),
      withTimeout(
        fetchEnhancedUserGroups(sanitizedCompanyId),
        12000, 'user-groups'
      ).catch(err => {
        console.warn('[companyService] Failed to fetch user groups:', err);
        return { groups: [], metadata: { totalUsers: 0, activeUsers: 0 } };
      }),
      fetchPayments().catch(() => ({ docs: [] })),
      withTimeout(getDocs(siteManagersQuery), 8000, 'site-managers').catch(() => ({ docs: [] }))
    ]);

    const resolvedCompanySnap = companySnap.status === 'fulfilled' ? companySnap.value : null;

    if (!resolvedCompanySnap || !resolvedCompanySnap.exists()) {
      throw new Error('Company not found');
    }

    const companyData = resolvedCompanySnap.data() || {};
    const companyInfo = buildCompanyInfo(resolvedCompanySnap);

    const resolvedPaymentsSnapshot = paymentsSnapshot.status === 'fulfilled' ? paymentsSnapshot.value : { docs: [] };
    const paymentsDocs = resolvedPaymentsSnapshot?.docs || [];
    const paymentHistoryFromPayments = normalizePaymentHistory(
      paymentsDocs,
      companyInfo.currentUsers,
      PRICE_PER_SEAT
    );

    // Fetch billing history from company document
    const billingHistoryFromCompany = normalizeBillingHistory(
      companyData.billingHistory || [],
      PRICE_PER_SEAT
    );

    // Merge both histories, prioritizing payments collection, then billing history
    // Remove duplicates based on date and amount, keeping the most detailed entry
    const allHistoryEntries = [...paymentHistoryFromPayments, ...billingHistoryFromCompany];
    const uniqueHistoryMap = new Map();

    allHistoryEntries.forEach(entry => {
      const key = `${entry.date}-${entry.rawTotalAmount}`;
      if (!uniqueHistoryMap.has(key) || entry.source === 'payments') {
        uniqueHistoryMap.set(key, entry);
      }
    });

    // Sort by date descending (most recent first)
    const paymentHistory = Array.from(uniqueHistoryMap.values()).sort((a, b) => {
      const dateA = new Date(a.date || 0).getTime();
      const dateB = new Date(b.date || 0).getTime();
      return dateB - dateA;
    });

    const groupsResult = groupsResultPromise.status === 'fulfilled' ? groupsResultPromise.value : { groups: [], metadata: { totalUsers: 0, activeUsers: 0 } };

    const userGroups = (groupsResult.groups || []).map((group) => ({
      primary: group.manager,
      associated: group.members,
      teamStats: group.teamStats,
      managerType: group.managerType,
      groupType: group.type
    }));
    const userGroupMetadata = groupsResult.metadata || { totalUsers: 0, activeUsers: 0 };

    // Resolve site managers snap first (needed for count AND for building groups)
    const resolvedSiteManagersSnap = siteManagersSnap.status === 'fulfilled' ? siteManagersSnap.value : { docs: [] };

    // Count from actual rendered groups — matches exactly what user sees on screen.
    // Avoids stale/orphaned profile records inflating the count (e.g. 2011).
    const countFromGroups = userGroups.reduce((sum, group) => {
      const managerCount = group.primary && group.primary.id !== 'Unassigned' ? 1 : 0;
      return sum + managerCount + (group.associated?.length || 0);
    }, 0);

    // Site managers are rendered separately, count them too
    const siteManagerCount = (resolvedSiteManagersSnap?.docs || []).length;

    // Total visible = site managers + everyone in user groups
    const visibleUserCount = siteManagerCount + countFromGroups;

    // Use visible count if we have groups; otherwise fall back to Firestore stored value
    const inferredUsers = visibleUserCount > 0
      ? visibleUserCount
      : (Number(companyInfo.currentUsers) || 0);

    const liveTotalCount = userGroupMetadata.totalUsers || 0;
    const inferredSeatCount = Number(companyInfo.seatCount) > 0
      ? companyInfo.seatCount
      : Math.max(inferredUsers, liveTotalCount);

    const normalizedCompanyInfo = {
      ...companyInfo,
      currentUsers: inferredUsers,
      seatCount: inferredSeatCount
    };

    // Self-heal the currentEmployeeCount if it's out of sync
    if (inferredUsers > 0 && Number(companyData.currentEmployeeCount || 0) !== inferredUsers) {
      try {
        import('firebase/firestore').then(({ updateDoc }) => {
          updateDoc(companyRef, { currentEmployeeCount: inferredUsers })
            .then(() => {
              console.log(`[companyService] Self-healed currentEmployeeCount to ${inferredUsers} for company ${sanitizedCompanyId}`);
              // Force dashboard cache refresh so the overview picks up the new count
              import('./platformDashboardService').then(({ clearPlatformCache }) => {
                clearPlatformCache();
                window.dispatchEvent(new CustomEvent('companies:refresh'));
              });
            })
            .catch(err => console.error('[companyService] Self-healing failed:', err));
        });
      } catch (e) {
        // Ignore
      }
    }

    const quickStats = buildQuickStats(normalizedCompanyInfo, paymentHistory);

    const siteManagerGroups = (resolvedSiteManagersSnap?.docs || []).map((docSnap) => {
      const data = docSnap.data() || {};
      const name = getUserDisplayName(data) || data.displayName || data.email || 'Site Manager';
      const primaryRow = {
        id: docSnap.id,
        name,
        email: data.email || 'No email',
        jobTitle: 'Site Manager',
        roleCategory: 'Manager',
        status: ['active', 'active'].includes(data.status) ? 'active' : 'Inactive',
        isManager: true,
        isInvited: false,
        teamInfo: 'Site Manager'
      };

      return {
        primary: primaryRow,
        associated: [],
        teamStats: { totalMembers: 0, activeMembers: 0 },
        managerType: 'siteManager',
        groupType: 'managed'
      };
    });

    const nonSiteManagerGroups = userGroups || [];
    const groupsForCompanyPage = [...siteManagerGroups, ...nonSiteManagerGroups];

    return {
      company: normalizedCompanyInfo,
      stats: quickStats,
      subscriptionHistory: paymentHistory,
      userGroups: groupsForCompanyPage
    };
  };

  return Promise.race([
    doFetch(),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`[companyService] Request timed out after ${FETCH_COMPANY_DETAILS_OVERALL_TIMEOUT}ms`)),
        FETCH_COMPANY_DETAILS_OVERALL_TIMEOUT
      )
    )
  ]);
}


