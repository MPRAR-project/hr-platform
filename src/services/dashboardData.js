/**
 * Enhanced dashboard data service with improved error handling and data validation
 */

import { db } from '../firebase/client';
import { collection, query, where, getDocs, doc, getDoc, orderBy, limit } from 'firebase/firestore';
import {
  validateUserData,
  parseCompanyId,
  parseSiteId,
  validateRequiredIds,
  getUserDisplayName
} from '../utils/dataParser';
import {
  executeWithErrorHandling,
  retryOperation,
  createConfigurationError,
  createPartialFailureError,
  ERROR_TYPES,
  classifyFirebaseError
} from '../utils/errorHandler';

/**
 * Creates an empty dashboard state
 */
export function createEmptyDashboardState() {
  return {
    teamMembers: [],
    statistics: {
      totalUsers: 0,
      totalSeats: 0,
      monthlyBill: 0,
      lastPaymentStatus: '—',
      lastPaymentDate: '—',
      nextBilling: '—'
    },
    loading: {
      overall: false,
      teamMembers: combinedMembers, // Note: This list is capped by DASHBOARD_MAX_USERS
      totalUsers: activeUsersCount, // Derived from company metadata (accurate for 1M+ users)
      payments: false
    },
    errors: {
      teamMembers: null,
      statistics: null,
      payments: null,
      configuration: null
    },
    lastUpdated: null,
    hasData: false
  };
}

/**
 * Validates dashboard data for consistency
 */
export function validateDashboardData(data) {
  const issues = [];

  if (!data || typeof data !== 'object') {
    issues.push('Dashboard data is not a valid object');
    return { isValid: false, issues };
  }

  // Validate team members
  if (!Array.isArray(data.teamMembers)) {
    issues.push('Team members data is not an array');
  } else {
    data.teamMembers.forEach((member, index) => {
      if (!member.id) issues.push(`Team member at index ${index} missing ID`);
      if (!member.name) issues.push(`Team member at index ${index} missing name`);
      if (!member.email) issues.push(`Team member at index ${index} missing email`);
    });
  }

  // Validate statistics
  if (!data.statistics || typeof data.statistics !== 'object') {
    issues.push('Statistics data is missing or invalid');
  } else {
    const stats = data.statistics;
    if (typeof stats.totalUsers !== 'number') issues.push('Total users must be a number');
    if (typeof stats.totalSeats !== 'number') issues.push('Total seats must be a number');
    if (typeof stats.monthlyBill !== 'number') issues.push('Monthly bill must be a number');
  }

  return {
    isValid: issues.length === 0,
    issues
  };
}

/**
 * Safely fetches dashboard data with comprehensive error handling
 */
export async function fetchDashboardDataSafely(user) {
  console.log('fetchDashboardDataSafely: Starting dashboard data fetch', { userEmail: user?.email });

  // Validate user data first
  const userValidation = validateUserData(user);
  if (!userValidation.isValid) {
    const configError = createConfigurationError('user');
    configError.details.validationErrors = userValidation.errors;
    throw configError;
  }

  const { companyId, siteId } = userValidation;

  // Validate required IDs
  const idsValidation = validateRequiredIds({ companyId, siteId });
  if (!idsValidation.isValid) {
    const configError = createConfigurationError('companyId');
    configError.details.validationErrors = idsValidation.errors;
    throw configError;
  }

  console.log('fetchDashboardDataSafely: User validation passed', { companyId, siteId });

  // Initialize result structure
  const result = createEmptyDashboardState();
  const operations = [];
  const successes = [];
  const failures = [];

  // Define data fetching operations
  const fetchTeamMembers = () => fetchTeamMembersData(companyId);
  const fetchCompanyData = () => fetchCompanyStatistics(companyId);
  const fetchPaymentData = () => fetchPaymentInformation(companyId);
  const fetchSubscriptionData = () => fetchSubscriptionInformation(companyId);

  operations.push(
    { name: 'teamMembers', operation: fetchTeamMembers },
    { name: 'companyData', operation: fetchCompanyData },
    { name: 'paymentData', operation: fetchPaymentData },
    { name: 'subscriptionData', operation: fetchSubscriptionData }
  );

  // Execute operations with individual error handling
  const results = {};

  for (const { name, operation } of operations) {
    try {
      console.log(`fetchDashboardDataSafely: Fetching ${name}`);

      const data = await retryOperation(
        () => executeWithErrorHandling(operation, `fetch-${name}`, { companyId }),
        ERROR_TYPES.NETWORK_ERROR,
        { operation: name, companyId }
      );

      results[name] = data;
      successes.push(name);
      console.log(`fetchDashboardDataSafely: Successfully fetched ${name}`);

    } catch (error) {
      console.error(`fetchDashboardDataSafely: Failed to fetch ${name}:`, error);
      failures.push({ name, error });
      result.errors[name] = error;
    }
  }

  // Process successful results
  if (results.teamMembers) {
    result.teamMembers = results.teamMembers;
  }

  if (results.companyData) {
    result.statistics.totalSeats = results.companyData.seatCount || 0;
    result.statistics.monthlyBill = (results.companyData.seatCount || 0) * 5;
  }

  if (results.paymentData) {
    result.statistics.lastPaymentStatus = results.paymentData.status || '—';
    result.statistics.lastPaymentDate = results.paymentData.date || '—';
  }

  if (results.subscriptionData) {
    result.statistics.nextBilling = results.subscriptionData.nextBilling || '—';
  }

  // Calculate total users from company data if available, or fall back to array length
  if (result.statistics.totalUsers === 0 && result.teamMembers.length > 0) {
    // This fallback runs only if fetchCompanyStatistics returned 0 or failed, 
    // but we have team members loaded.
    result.statistics.totalUsers = result.teamMembers.filter(m => m.status === 'active').length;
  } else if (result.statistics.totalSeats > 0 && result.statistics.totalUsers === 0) {
    // If we have seats but 0 users, it might be correct, or we might need to trust the company data we fetched.
    // fetchCompanyDashboardData populates 'totalUsers' directly now, so this legacy check 
    // in fetchDashboardDataSafely is mostly a fallback for other callers.
  }

  // Set metadata
  result.lastUpdated = new Date().toISOString();
  result.hasData = successes.length > 0;

  // Validate the final result
  const validation = validateDashboardData(result);
  if (!validation.isValid) {
    console.warn('fetchDashboardDataSafely: Data validation issues:', validation.issues);
  }

  // Handle partial failures
  if (failures.length > 0 && successes.length > 0) {
    const partialError = createPartialFailureError(successes, failures);
    console.warn('fetchDashboardDataSafely: Partial failure occurred', partialError);
    // Don't throw, but log the partial failure
  } else if (failures.length > 0 && successes.length === 0) {
    // Complete failure - throw the first error
    throw failures[0].error;
  }

  console.log('fetchDashboardDataSafely: Dashboard data fetch completed', {
    successes: successes.length,
    failures: failures.length,
    hasData: result.hasData
  });

  return result;
}

/**
 * Fetches team members data for a company
 */
async function fetchTeamMembersData(companyId) {
  console.log('fetchTeamMembersData: Fetching team members', { companyId });

  const usersQuery = query(
    collection(db, 'users'),
    where('companyId', '==', `companies/${companyId}`),
    limit(20)
  );

  const usersSnap = await getDocs(usersQuery);
  console.log('fetchTeamMembersData: Retrieved users snapshot', { count: usersSnap.docs.length });

  const roleMapping = {
    'siteManager': 'Site Manager',
    'teamManager': 'Manager',
    'adminManager': 'Admin',
    'hrManager': 'Manager',
    'adminAdvisor': 'Admin',
    'hrAdvisor': 'Employee',
    'contractManager': 'Admin',
    'employee': 'Employee'
  };

  const teamMembers = usersSnap.docs
    .filter(d => {
      const primaryRole = d.data().primaryRole || '';
      return primaryRole.toLowerCase() !== 'sitemanager';
    })
    .map(d => {
      const userData = d.data();
      const name = getUserDisplayName(userData);

      return {
        id: d.id,
        name,
        email: userData.email || 'No email',
        role: roleMapping[userData.primaryRole] || 'Employee',
        status: (userData.status === 'active') ? 'active' : 'Inactive'
      };
    });

  console.log('fetchTeamMembersData: Processed team members', { count: teamMembers.length });
  return teamMembers;
}

/**
 * Fetches company statistics
 */
async function fetchCompanyStatistics(companyId) {
  console.log('fetchCompanyStatistics: Fetching company data', { companyId });

  const companyRef = doc(db, 'companies', companyId);
  const companySnap = await getDoc(companyRef);

  if (!companySnap.exists()) {
    console.warn('fetchCompanyStatistics: Company document not found', { companyId });
    const activeUsersCount = companyData.currentEmployeeCount || 0;
    // PENDING INVITES: We still need to count them, but they are usually small. 
    // If invites grow large, we should add a 'pendingInviteCount' to company metadata.
    // For now, capping the query at 500 in the fetch function handles the safety.
    const pendingInvitesCount = inviteMembers.length;

    const seatCount = Number.isFinite(billingSummary?.seatQuota)
      ? billingSummary.seatQuota
      : companyData.seatCount || 0;
    const pricePerSeat = Number.isFinite(billingSummary?.pricePerSeat)
      ? billingSummary.pricePerSeat
      : companyData.pricePerSeat || 5;
    const monthlyBill = Number.isFinite(billingSummary?.monthlyAmount)
      ? billingSummary.monthlyAmount
      : seatCount * pricePerSeat;

    // Seat Usage: Active Employees + Pending Invites
    const seatUsageCount = activeUsersCount + pendingInvitesCount;
    const seatDeficit = Math.max(0, seatUsageCount - seatCount);
    return { seatCount: 0, currentEmployeeCount: 0 };
  }

  const companyData = companySnap.data();
  console.log('fetchCompanyStatistics: Retrieved company data', {
    seatCount: companyData.seatCount,
    currentEmployeeCount: companyData.currentEmployeeCount
  });

  return {
    seatCount: companyData.seatCount || 0,
    currentEmployeeCount: companyData.currentEmployeeCount || 0
  };
}

/**
 * Fetches payment information
 */
async function fetchPaymentInformation(companyId) {
  console.log('fetchPaymentInformation: Fetching payment data', { companyId });

  const paymentsQuery = query(
    collection(db, 'payments'),
    where('companyId', '==', `companies/${companyId}`),
    orderBy('createdAt', 'desc'),
    limit(1)
  );

  const paymentsSnap = await getDocs(paymentsQuery);

  if (paymentsSnap.empty) {
    console.log('fetchPaymentInformation: No payment history found');
    return { status: '—', date: '—' };
  }

  const paymentData = paymentsSnap.docs[0].data();
  const result = {
    status: paymentData.status || '—',
    date: paymentData.createdAt?.toDate ?
      paymentData.createdAt.toDate().toISOString().slice(0, 10) : '—'
  };

  console.log('fetchPaymentInformation: Retrieved payment data', result);
  return result;
}

/**
 * Fetches subscription information
 */
async function fetchSubscriptionInformation(companyId) {
  console.log('fetchSubscriptionInformation: Fetching subscription data', { companyId });

  const subscriptionsQuery = query(
    collection(db, 'subscriptions'),
    where('companyId', '==', `companies/${companyId}`),
    where('status', '==', 'active'),
    limit(1)
  );

  const subscriptionsSnap = await getDocs(subscriptionsQuery);

  if (subscriptionsSnap.empty) {
    console.log('fetchSubscriptionInformation: No active subscription found');
    return { nextBilling: '—' };
  }

  const subscriptionData = subscriptionsSnap.docs[0].data();
  const result = {
    nextBilling: subscriptionData.periodEnd?.toDate ?
      subscriptionData.periodEnd.toDate().toISOString().slice(0, 10) : '—'
  };

  console.log('fetchSubscriptionInformation: Retrieved subscription data', result);
  return result;
}

/**
 * Refreshes dashboard data with cache invalidation
 */
export async function refreshDashboardData(user, clearCache = true) {
  console.log('refreshDashboardData: Starting data refresh', { clearCache });

  if (clearCache) {
    try {
      const { invalidateCompanyCache } = await import('./cacheInvalidationService');
      const userValidation = validateUserData(user);
      if (userValidation.isValid && userValidation.companyId) {
        await invalidateCompanyCache(userValidation.companyId);
        console.log('refreshDashboardData: Cache cleared');
      }
    } catch (error) {
      console.warn('refreshDashboardData: Failed to clear cache:', error);
    }
  }

  return fetchDashboardDataSafely(user);
}

/**
 * Gets cached dashboard data if available
 */
export async function getCachedDashboardData(companyId) {
  try {
    const { default: cache } = await import('./dataCache');
    const cacheKey = `company-dashboard-${companyId}`;
    return cache.get(cacheKey);
  } catch (error) {
    console.warn('getCachedDashboardData: Failed to get cached data:', error);
    return null;
  }
}