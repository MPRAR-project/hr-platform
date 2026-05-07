import { db } from '../firebase/client';
import { functions } from '../firebase/client';
import { httpsCallable } from 'firebase/functions';
import {
  arrayUnion,
  doc,
  getDoc,
  increment,
  serverTimestamp,
  Timestamp,
  updateDoc
} from 'firebase/firestore';
import { parseCompanyId } from '../utils/dataParser';
import { USE_STRIPE, updateStripeSubscription, createSeatAdditionCheckoutSession } from './stripe';

const PRICE_PER_SEAT = 5;
const TRIAL_DAYS = 14;
const CURRENCY = 'GBP';
export const BILLING_EVENT_NAME = 'billing:updated';

// Simple internal cache for billing operations
const billingCache = new Map();
const cache = {
  get: (key) => {
    const item = billingCache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiry) {
      billingCache.delete(key);
      return null;
    }
    return item.value;
  },
  set: (key, value, ttlMs) => {
    billingCache.set(key, {
      value,
      expiry: Date.now() + ttlMs
    });
  }
};

const toDate = (value) => {
  if (!value) return null;
  try {
    if (value.toDate) {
      return value.toDate();
    }
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  } catch (error) {
    console.warn('[billing] Failed to convert value to Date', error);
  }
  return null;
};

const addDays = (date, days) => {
  const clone = new Date(date.getTime());
  clone.setDate(clone.getDate() + days);
  return clone;
};

const addMonths = (date, months) => {
  const clone = new Date(date.getTime());
  clone.setMonth(clone.getMonth() + months);
  return clone;
};

const generateHistoryId = () => `bill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const buildHistoryEntry = ({ type, seats, amount, note }) => ({
  id: generateHistoryId(),
  type,
  seats,
  amount,
  currency: CURRENCY,
  note: note || null,
  createdAt: new Date().toISOString(),
  createdAtMs: Date.now()
});

const emitBillingEvent = () => {
  if (typeof window !== 'undefined' && window?.dispatchEvent) {
    window.dispatchEvent(new CustomEvent(BILLING_EVENT_NAME));
  }
};

const emitBillingEventAndInvalidateCache = async (companyId) => {
  emitBillingEvent();
  // Clear the billing local cache
  const cacheKey = `billing-summary-${companyId}`;
  billingCache.delete(cacheKey);
  billingCache.delete(`seat-count-verify-${companyId}`);

  try {
    const { invalidateCompanyCache } = await import('./cacheInvalidationService');
    await invalidateCompanyCache(companyId);
  } catch (e) {
    console.warn('[billing] Failed to invalidate cache:', e);
  }
};

const getCompanyContext = async (companyId) => {
  const normalizedId = parseCompanyId(companyId);
  if (!normalizedId) {
    throw new Error('Invalid company identifier');
  }
  const ref = doc(db, 'companies', normalizedId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) {
    throw new Error('Company not found');
  }
  return {
    id: normalizedId,
    ref,
    data: snapshot.data() || {}
  };
};

const deriveSubscriptionStatus = (companyData, now = new Date()) => {
  const baseStatus = companyData.billingSubscriptionStatus || companyData.subscriptionTier || 'trial';
  const trialEnd = toDate(companyData.billingTrialEndsAt || companyData.trialEndsAt);
  const renewalDate = toDate(companyData.billingRenewalDate);
  const lastPaymentAt = toDate(companyData.billingLastPaymentAt);
  const hasStripeSubscription = !!companyData.stripeSubscriptionId;

  // If it's a trial, check if trial ended
  if (baseStatus === 'trial') {
    if (trialEnd && now > trialEnd) {
      return 'expired';
    }
    return 'trial';
  }

  // If status is explicitly expired, return expired
  if (baseStatus === 'expired') {
    return 'expired';
  }

  // If status is 'pending' but we have a Stripe subscription and recent payment,
  // treat it as active (webhook might be delayed)
  if (baseStatus === 'pending' && hasStripeSubscription) {
    // If payment was made in last 24 hours, consider it active
    if (lastPaymentAt && (now - lastPaymentAt) < 24 * 60 * 60 * 1000) {
      return 'active';
    }
    // Otherwise check renewal date
    if (renewalDate && now > renewalDate) {
      return 'past_due';
    }
    // If renewal date is in future, treat as active
    if (renewalDate && now <= renewalDate) {
      return 'active';
    }
  }

  // Check if renewal date has passed
  if (renewalDate && now > renewalDate) {
    // If we have a Stripe subscription and recent payment, don't mark as past_due
    // (might be a date sync issue)
    if (hasStripeSubscription && lastPaymentAt && (now - lastPaymentAt) < 7 * 24 * 60 * 60 * 1000) {
      return 'active';
    }
    return 'past_due';
  }

  // If status is 'pending' without Stripe subscription, check renewal date
  if (baseStatus === 'pending') {
    if (renewalDate && now > renewalDate) {
      return 'past_due';
    }
    // If no renewal date or it's in future, treat as active (might be transitioning)
    return renewalDate && now <= renewalDate ? 'active' : 'pending';
  }

  return baseStatus || 'active';
};

export const isSubscriptionExpired = (companyData) => {
  if (!companyData) return false;

  const now = new Date();
  const status = deriveSubscriptionStatus(companyData, now);
  if (status === 'expired' || status === 'past_due') {
    return true;
  }

  if (status === 'trial') {
    const trialEnd = toDate(companyData.billingTrialEndsAt || companyData.trialEndsAt);
    return trialEnd ? now > trialEnd : false;
  }

  return false;
};

export const startTrial = async (companyId, seatCount) => {
  const normalizedSeatCount = Number.isFinite(seatCount) && seatCount > 0 ? Math.floor(seatCount) : 1;
  const { ref, data } = await getCompanyContext(companyId);
  const now = new Date();
  const trialEndsAt = addDays(now, TRIAL_DAYS);
  const firstRenewal = trialEndsAt;

  const historyEntry = buildHistoryEntry({
    type: 'trial',
    seats: normalizedSeatCount,
    amount: 0,
    note: `Trial started for ${normalizedSeatCount} seat(s)`
  });

  await updateDoc(ref, {
    seatCount: normalizedSeatCount,
    billingSeatQuota: normalizedSeatCount,
    billingActiveSeatCount: Number(data.currentEmployeeCount) || 0,
    billingSubscriptionStatus: 'trial',
    billingTrialEndsAt: Timestamp.fromDate(trialEndsAt),
    billingRenewalDate: Timestamp.fromDate(firstRenewal),
    billingLastPaymentAt: serverTimestamp(),
    billingLastPaymentType: 'trial',
    billingHistory: arrayUnion(historyEntry),
    updatedAt: serverTimestamp()
  });

  await emitBillingEventAndInvalidateCache(companyId);

  return {
    seatQuota: normalizedSeatCount,
    trialEndsAt,
    renewalDate: firstRenewal
  };
};

export const recordSubscriptionPayment = async (companyId, seatCountOverride = null) => {
  const { ref, data, id } = await getCompanyContext(companyId);
  const now = new Date();
  const seatQuota = Number.isFinite(seatCountOverride) && seatCountOverride > 0
    ? Math.floor(seatCountOverride)
    : Number(data.billingSeatQuota ?? data.seatCount) || 0;
  const price = Number(data.billingPricePerSeat) || PRICE_PER_SEAT;
  const amount = seatQuota * price;

  // If Stripe is enabled and subscription exists, webhook will handle the update
  // This function now serves as a fallback for mock payments
  if (USE_STRIPE && data.stripeSubscriptionId) {
    console.log('Stripe subscription exists - payment will be handled by webhook');
    // Don't update Firestore here - webhook will handle it
    // Just return the current summary
    return getBillingSummary(id);
  }

  const currentRenewalDate = toDate(data.billingRenewalDate);
  const baseDate = currentRenewalDate && currentRenewalDate > now ? currentRenewalDate : now;
  const nextRenewalDate = addMonths(baseDate, 1);

  const historyEntry = buildHistoryEntry({
    type: 'subscription',
    seats: seatQuota,
    amount,
    note: `Subscription renewed for ${seatQuota} seat(s)`
  });

  await updateDoc(ref, {
    billingSeatQuota: seatQuota,
    billingSubscriptionStatus: 'active',
    billingRenewalDate: Timestamp.fromDate(nextRenewalDate),
    billingLastPaymentAt: serverTimestamp(),
    billingLastPaymentType: 'subscription',
    billingHistory: arrayUnion(historyEntry),
    updatedAt: serverTimestamp()
  });

  await emitBillingEventAndInvalidateCache(id);

  return getBillingSummary(id);
};

export const recordSeatTopUp = async (companyId, addedSeats = 1, requestId = null) => {
  if (!Number.isFinite(addedSeats) || addedSeats <= 0) {
    throw new Error('Seat quantity must be a positive number');
  }
  const seatIncrement = Math.floor(addedSeats);
  const { ref, data } = await getCompanyContext(companyId);
  const price = Number(data.billingPricePerSeat) || PRICE_PER_SEAT;
  const amount = seatIncrement * price;

  // Check if company is in trial period
  const subscriptionStatus = deriveSubscriptionStatus(data);
  const trialEnd = toDate(data.billingTrialEndsAt || data.trialEndsAt);
  const now = new Date();
  const isInTrial = subscriptionStatus === 'trial' && trialEnd && now <= trialEnd;

  // If in trial period, add seats for free (no payment required)
  if (isInTrial) {
    console.log('Company is in trial period - adding seats for free:', {
      companyId,
      addedSeats: seatIncrement,
      currentSeats: data.seatCount || 0,
      newTotalSeats: (data.seatCount || 0) + seatIncrement
    });

    const historyEntry = buildHistoryEntry({
      type: 'seat_topup',
      seats: seatIncrement,
      amount: 0, // Free during trial
      note: `Added ${seatIncrement} seat(s) during trial period (free)`
    });

    await updateDoc(ref, {
      seatCount: increment(seatIncrement),
      billingSeatQuota: increment(seatIncrement), // Update quota so subscription charges for all seats when trial ends
      billingHistory: arrayUnion(historyEntry),
      updatedAt: serverTimestamp()
    });

    await emitBillingEventAndInvalidateCache(companyId);

    // Also update request ID if provided (since no webhook will run)
    if (requestId) {
      try {
        const requestRef = doc(db, 'seatRequests', requestId);
        await updateDoc(requestRef, {
          status: 'approved',
          updatedAt: serverTimestamp(),
          approvedAt: serverTimestamp(),
          billingHistoryId: historyEntry.id
        });
      } catch (e) {
        console.error('Error updating seat request during trial topup:', e);
      }
    }

    return seatIncrement; // Return seat count added (no checkout required)
  }

  // If Stripe is enabled and subscription exists, create checkout session instead of direct update
  if (USE_STRIPE && data.stripeSubscriptionId && data.stripeCustomerId) {
    try {
      console.log('Creating Stripe checkout for seat addition:', {
        customerId: data.stripeCustomerId,
        subscriptionId: data.stripeSubscriptionId,
        additionalSeats: seatIncrement,
        companyId,
        requestId
      });

      // Get current URL for success/cancel redirects
      const currentUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const successUrl = `${currentUrl}/billing?session_id={CHECKOUT_SESSION_ID}&action=seat_added`;
      const cancelUrl = `${currentUrl}/billing?canceled=true&action=seat_addition`;

      // Create checkout session for seat addition
      const checkoutSession = await createSeatAdditionCheckoutSession(
        data.stripeCustomerId,
        data.stripeSubscriptionId,
        seatIncrement,
        companyId,
        successUrl,
        cancelUrl,
        requestId
      );

      console.log('Stripe checkout session created:', checkoutSession);

      if (!checkoutSession || !checkoutSession.url) {
        throw new Error('Checkout session URL not returned');
      }

      // Return checkout URL instead of updating directly
      return {
        requiresCheckout: true,
        checkoutUrl: checkoutSession.url,
        sessionId: checkoutSession.sessionId
      };
    } catch (stripeError) {
      console.error('Stripe checkout creation failed:', stripeError);
      console.error('Error details:', {
        message: stripeError.message,
        stack: stripeError.stack,
        customerId: data.stripeCustomerId,
        subscriptionId: data.stripeSubscriptionId
      });
      // Don't fall through to mock - throw error so user knows
      throw new Error(`Failed to create payment checkout: ${stripeError.message || 'Unknown error'}`);
    }
  } else {
    // Log why Stripe checkout is not being used
    console.warn('Stripe checkout not available:', {
      USE_STRIPE,
      hasSubscriptionId: !!data.stripeSubscriptionId,
      hasCustomerId: !!data.stripeCustomerId,
      companyId
    });
  }

  // Fallback to mock payment (when Stripe disabled or checkout creation failed)
  const historyEntry = buildHistoryEntry({
    type: 'seat_topup',
    seats: seatIncrement,
    amount,
    note: `Added ${seatIncrement} seat(s)`
  });

  await updateDoc(ref, {
    seatCount: increment(seatIncrement),
    billingSeatQuota: increment(seatIncrement),
    billingLastPaymentAt: serverTimestamp(),
    billingLastPaymentType: 'seat_topup',
    billingHistory: arrayUnion(historyEntry),
    updatedAt: serverTimestamp()
  });

  await emitBillingEventAndInvalidateCache(companyId);

  return seatIncrement;
};

export const getBillingSummary = async (companyId) => {
  // Use cache if available to prevent redundant fetches within a short window (e.g. guard + page loads)
  const cacheKey = `billing-summary-${companyId}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const { data, id } = await getCompanyContext(companyId);
  const seatQuota = Number(data.billingSeatQuota ?? data.seatCount) || 0;
  const currentSeatsInUse = Number(data.billingActiveSeatCount) || 0;
  const trialEndsAt = toDate(data.billingTrialEndsAt || data.trialEndsAt);
  const renewalDate = toDate(data.billingRenewalDate);
  const lastPaymentAt = toDate(data.billingLastPaymentAt);
  const subscriptionStatus = deriveSubscriptionStatus(data);
  const expired = isSubscriptionExpired(data);
  const price = Number(data.billingPricePerSeat) || PRICE_PER_SEAT;

  // Calculate Add-ons Cost
  let addonsCost = 0;
  if (data.plugins?.scheduling) {
    addonsCost += 2.50; // Shift Roster
  }
  if (data.plugins?.traveller) {
    addonsCost += 100.00; // Traveller System
  }
  if (data.plugins?.timeworks) {
    addonsCost += 50.00; // TimeWorks
  }

  const monthlyAmount = (seatQuota * price) + addonsCost;
  const now = new Date();

  // During trial, monthly amount should be 0, not projected cost
  const isInTrial = subscriptionStatus === 'trial' && trialEndsAt && now <= trialEndsAt;
  const finalMonthlyAmount = isInTrial ? 0 : monthlyAmount;

  const normalizeHistoryEntry = (entry) => {
    const createdAt = entry?.createdAtMs
      ? new Date(entry.createdAtMs)
      : (toDate(entry?.createdAt) || toDate(entry?.date) || null);
    return {
      ...entry,
      createdAt,
      createdAtIso: createdAt ? createdAt.toISOString() : entry?.createdAt,
      // CRITICAL: Explicitly preserve Stripe-related fields
      stripeInvoiceId: entry?.stripeInvoiceId || null,
      stripeSubscriptionId: entry?.stripeSubscriptionId || null,
      stripe_invoice_id: entry?.stripe_invoice_id || null, // Also check snake_case variant
    };
  };

  const history = Array.isArray(data.billingHistory)
    ? [...data.billingHistory]
      .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0))
      .map(normalizeHistoryEntry)
    : [];

  const daysUntilTrialEnds = trialEndsAt
    ? Math.max(0, Math.ceil((trialEndsAt - now) / (1000 * 60 * 60 * 24)))
    : null;
  const daysUntilRenewal = renewalDate
    ? Math.max(0, Math.ceil((renewalDate - now) / (1000 * 60 * 60 * 24)))
    : null;

  // Self-healing: If seats are 0, checking if that's true or a sync error
  let verifiedCurrentSeatsInUse = currentSeatsInUse;
  if (currentSeatsInUse === 0) {
    // OPTIMIZATION: Cache self-healing results to prevent repeated queries
    const SELF_HEAL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    const selfHealCacheKey = `seat-count-verify-${id}`;

    try {
      // Try to get from cache first
      const cachedCount = cache?.get?.(selfHealCacheKey);
      if (cachedCount && cachedCount > 0) {
        console.log(`[Billing] Using cached seat count: ${cachedCount}`);
        verifiedCurrentSeatsInUse = cachedCount;
      } else {
        // Perform self-healing query
        const { collection, query, where, getDocs } = await import('firebase/firestore');
        const usersRef = collection(db, 'users');
        const rawId = id.replace('companies/', '');
        const q = query(
          usersRef,
          where('companyId', 'in', [rawId, `companies/${rawId}`]),
          where('status', '==', 'active') // [FIX] Use lowercase 'active' to match standardized status
        );

        const snapshot = await getDocs(q);
        // Filter out site managers to match dashboard logic
        const realCount = snapshot.docs.filter(doc => {
          const d = doc.data();
          return (d.primaryRole || '').toLowerCase() !== 'sitemanager';
        }).length;

        if (realCount > 0) {
          console.log(`[Billing] Self-healed seat count from 0 to ${realCount}`);
          verifiedCurrentSeatsInUse = realCount;

          // Cache the result for future use
          cache?.set?.(selfHealCacheKey, realCount, SELF_HEAL_CACHE_TTL);

          // Optimistically update firestore to fix it permanently
          updateDoc(data.ref || doc(db, 'companies', id), {
            currentEmployeeCount: realCount,
            billingActiveSeatCount: realCount
          }).catch(e => console.error('Failed to self-heal seat count in Firestore', e));
        }
      }
    } catch (err) {
      console.warn('Failed to verify seat count', err);
    }
  }

  const summary = {
    companyId: id,
    companyName: data.name || 'Your Company',
    seatQuota,
    currentSeatsInUse: verifiedCurrentSeatsInUse,
    trialEndsAt,
    renewalDate,
    subscriptionStatus,
    pricePerSeat: price,
    monthlyAmount: finalMonthlyAmount,
    lastPaymentAt,
    lastPaymentType: data.billingLastPaymentType || null,
    history,
    isExpired: expired,
    isTrial: subscriptionStatus === 'trial',
    currency: data.billingCurrency || CURRENCY,
    daysUntilTrialEnds,
    daysUntilRenewal,
    seatShortage: Math.max(0, verifiedCurrentSeatsInUse - seatQuota),
    plugins: data.plugins || {},
    stripeSubscriptionId: data.stripeSubscriptionId || null,
    stripeCustomerId: data.stripeCustomerId || null
  };

  // Cache for 60 seconds (short window primarily for cross-component sync during navigation)
  cache.set(cacheKey, summary, 60 * 1000);

  return summary;
};

export const BILLING_CONSTANTS = {
  PRICE_PER_SEAT,
  TRIAL_DAYS,
  CURRENCY
};



export const addPluginService = async (companyId, addonType) => {
  const addAddon = httpsCallable(functions, 'addSubscriptionAddon');
  try {
    const result = await addAddon({ companyId, addonType });
    return result.data;
  } catch (error) {
    console.error('Failed to add plugin:', error);
    throw error;
  }
};

export const removePluginService = async (companyId, addonType) => {
  const removeAddon = httpsCallable(functions, 'removeSubscriptionAddon');
  try {
    const result = await removeAddon({ companyId, addonType });
    return result.data;
  } catch (error) {
    console.warn('[billing] Cloud function failed, attempting local fallback:', error);

    // Fallback: Try to update Firestore directly if function fails
    try {
      const normalizedId = parseCompanyId(companyId);
      const companyRef = doc(db, 'companies', normalizedId);

      await updateDoc(companyRef, {
        [`plugins.${addonType}`]: false,
        updatedAt: serverTimestamp()
      });

      console.log(`[billing] Local fallback successful for ${addonType} removal`);
      return { success: true, fallback: true };
    } catch (fallbackError) {
      console.error('[billing] Local fallback also failed:', fallbackError);
      throw error; // Throw original error if fallback fails
    }
  }
};

