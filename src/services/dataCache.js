// Data caching service for improved performance with enhanced error handling
// SCALABILITY: Query limits to support 10K–1M+ users without unbounded reads
const DASHBOARD_MAX_USERS = 2000;
const DASHBOARD_MAX_INVITES = 500;
const USER_LIST_MAX_USERS = 2000;
const USER_LIST_MAX_ASSIGNMENTS = 2000;

import { db } from '../firebase/client';
import { collection, query, where, getDocs, doc, getDoc, orderBy, limit } from 'firebase/firestore';
import { classifyFirebaseError, executeWithErrorHandling, logError } from '../utils/errorHandler';
import { validateRequiredIds, getUserDisplayName } from '../utils/dataParser';
import { getRoleName } from '../utils/getRoleName';
import { getBillingSummary } from './billing';
import eventBus from './EventBus';

const CACHE_INVALIDATED = 'cache:company:invalidated';

/** Fire-and-forget: revalidate cache in background and notify listeners when done (stale-while-revalidate). */
function scheduleBackgroundRefresh(type, companyId) {
  const cleanId = String(companyId).replace(/^companies\//, '');
  const p = type === 'dashboard'
    ? fetchCompanyDashboardData(cleanId, { forceRefresh: true })
    : fetchUserListData(cleanId, { forceRefresh: true });
  p.then(() => { eventBus.emit(CACHE_INVALIDATED, { companyId: cleanId }); }).catch(() => { });
}

// Simple in-memory cache with TTL, size limits, and LRU eviction
// PERSISTENCE: Save to localStorage to survive page reloads and provide instant UI
class DataCache {
  constructor() {
    this.cache = new Map();
    this.ttl = 30 * 60 * 1000; // 30 minutes TTL for persistent cache
    this.maxSize = 100; // Reduce maxSize for localStorage compatibility
    this.accessOrder = new Map(); // Track access order for LRU eviction
    this.storageKey = 'mprar_data_cache_v1';

    // Load persisted data on initialization
    this.loadFromPersistentStorage();
  }

  // Keys that must never be persisted so browser refresh always fetches fresh from DB
  // (avoids showing stale data after manual DB changes e.g. deleted users/emails)
  static get nonPersistentKeyPrefixes() {
    return ['company-dashboard-', 'user-list-', 'superadmin_users_', 'paginated_users_'];
  }

  saveToPersistentStorage() {
    try {
      const dataToPersist = {};
      const skipPrefixes = DataCache.nonPersistentKeyPrefixes;
      for (const [key, value] of this.cache.entries()) {
        const skip = skipPrefixes.some(prefix => key.startsWith(prefix));
        if (skip) continue;
        // Only persist non-expired data
        if (Date.now() - value.timestamp <= this.ttl) {
          dataToPersist[key] = value;
        }
      }
      localStorage.setItem(this.storageKey, JSON.stringify({
        data: dataToPersist,
        timestamp: Date.now()
      }));
    } catch (error) {
      console.warn('DataCache.saveToPersistentStorage: Failed to persist cache:', error);
      // If localStorage is full, clear it and try again or just fail silently
      if (error.name === 'QuotaExceededError') {
        this.clear();
      }
    }
  }

  loadFromPersistentStorage() {
    try {
      const persisted = localStorage.getItem(this.storageKey);
      if (!persisted) return;

      const { data, timestamp } = JSON.parse(persisted);

      // If the entire cache storage is very old, ignore it
      if (Date.now() - timestamp > this.ttl * 2) {
        localStorage.removeItem(this.storageKey);
        return;
      }

      const skipPrefixes = DataCache.nonPersistentKeyPrefixes;
      for (const [key, value] of Object.entries(data)) {
        const skip = skipPrefixes.some(prefix => key.startsWith(prefix));
        if (skip) continue;
        // Double check TTL for individual entries
        if (Date.now() - value.timestamp <= this.ttl) {
          this.cache.set(key, value);
          this.accessOrder.set(key, value.timestamp);
        }
      }
      console.log(`DataCache: Loaded ${this.cache.size} entries from persistent storage`);
    } catch (error) {
      console.error('DataCache.loadFromPersistentStorage: Failed to load cache:', error);
    }
  }

  set(key, data) {
    try {
      if (!key || typeof key !== 'string') {
        console.warn('DataCache.set: Invalid cache key:', key);
        return false;
      }

      // SCALABILITY: Implement LRU eviction if cache is full
      if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
        // Find least recently used key
        let lruKey = null;
        let oldestAccess = Infinity;
        for (const [k, accessTime] of this.accessOrder.entries()) {
          if (accessTime < oldestAccess) {
            oldestAccess = accessTime;
            lruKey = k;
          }
        }
        if (lruKey) {
          this.cache.delete(lruKey);
          this.accessOrder.delete(lruKey);
        }
      }

      this.cache.set(key, {
        data,
        timestamp: Date.now()
      });
      this.accessOrder.set(key, Date.now()); // Track access time

      // Persist changes
      this.saveToPersistentStorage();
      return true;
    } catch (error) {
      console.error('DataCache.set: Failed to cache data:', error);
      return false;
    }
  }

  get(key) {
    try {
      if (!key || typeof key !== 'string') return null;

      const cached = this.cache.get(key);
      if (!cached) return null;

      // Check if cache is expired
      if (Date.now() - cached.timestamp > this.ttl) {
        this.cache.delete(key);
        this.accessOrder.delete(key);
        this.saveToPersistentStorage();
        return null;
      }

      // SCALABILITY: Update access time for LRU tracking
      this.accessOrder.set(key, Date.now());

      return cached.data;
    } catch (error) {
      console.error('DataCache.get: Failed to retrieve cached data:', error);
      return null;
    }
  }

  clear() {
    try {
      this.cache.clear();
      this.accessOrder.clear();
      localStorage.removeItem(this.storageKey);
      console.log('DataCache: Cache cleared successfully');
    } catch (error) {
      console.error('DataCache.clear: Failed to clear cache:', error);
    }
  }

  delete(key) {
    try {
      if (!key || typeof key !== 'string') return false;

      const deleted = this.cache.delete(key);
      this.accessOrder.delete(key);
      if (deleted) this.saveToPersistentStorage();
      return deleted;
    } catch (error) {
      console.error('DataCache.delete: Failed to delete cached data:', error);
      return false;
    }
  }

  // Get cache statistics
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      utilization: ((this.cache.size / this.maxSize) * 100).toFixed(2) + '%',
      keys: Array.from(this.cache.keys()),
      ttl: this.ttl,
      persistent: true
    };
  }
}

const cache = new DataCache();

const formatDisplayDate = (value) => {
  if (!value) return '—';
  try {
    let dateValue = value;
    if (dateValue.toDate) {
      dateValue = dateValue.toDate();
    }
    const dateObj = dateValue instanceof Date ? dateValue : new Date(dateValue);
    if (Number.isNaN(dateObj.getTime())) {
      return '—';
    }
    return dateObj.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  } catch (error) {
    console.warn('formatDisplayDate: Failed to format date', error);
    return '—';
  }
};

const formatLabel = (value) => {
  if (!value) return '—';
  try {
    return value
      .toString()
      .replace(/[_-]/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  } catch (error) {
    return value;
  }
};

/** Return cached company dashboard if available (sync, for instant first paint). */
export function getCachedCompanyDashboard(companyId) {
  if (!companyId || typeof companyId !== 'string') return null;
  return cache.get(`company-dashboard-${companyId}`) || null;
}

// Optimized company data fetcher with parallel queries and enhanced error handling
// options.forceRefresh: if true, bypass cache and fetch from DB (e.g. after manual DB changes)
export async function fetchCompanyDashboardData(companyId, options = {}) {
  const { forceRefresh = false } = options;
  // Validate input
  const idsValidation = validateRequiredIds({ companyId });
  if (!idsValidation.isValid) {
    const error = new Error(`Invalid company ID: ${idsValidation.errors.join(', ')}`);
    error.code = 'invalid-argument';
    throw classifyFirebaseError(error);
  }

  const cacheKey = `company-dashboard-${companyId}`;
  if (forceRefresh) cache.delete(cacheKey);
  const cached = cache.get(cacheKey);

  if (cached) {
    // Stale-while-revalidate: return fast, then refresh in background and notify UI
    scheduleBackgroundRefresh('dashboard', companyId);
    return cached;
  }

  return executeWithErrorHandling(async () => {
    // Single parallel batch: all 6 sources at once for minimum latency
    const [usersSnap, companySnap, invitesSnapResult, paymentsResult, subscriptionsResult, billingResult] = await Promise.all([
      getDocs(query(
        collection(db, 'users'),
        where('companyId', '==', `companies/${companyId}`),
        limit(DASHBOARD_MAX_USERS)
      )),
      getDoc(doc(db, 'companies', companyId)),
      getDocs(query(
        collection(db, 'invites'),
        where('companyId', '==', companyId),
        where('status', '==', 'pending'),
        limit(DASHBOARD_MAX_INVITES)
      )).catch((err) => {
        if (process.env.NODE_ENV === 'development') {
          console.warn('fetchCompanyDashboardData: Invites query failed:', err?.message);
        }
        return { empty: true, docs: [] };
      }),
      getDocs(query(
        collection(db, 'payments'),
        where('companyId', '==', `companies/${companyId}`),
        orderBy('createdAt', 'desc'),
        limit(1)
      )).catch(() => ({ empty: true, docs: [] })),
      getDocs(query(
        collection(db, 'subscriptions'),
        where('companyId', '==', `companies/${companyId}`),
        where('status', '==', 'active'),
        limit(1)
      )).catch(() => ({ empty: true, docs: [] })),
      getBillingSummary(companyId).catch(() => null)
    ]);

    const paymentsSnap = paymentsResult?.docs != null ? paymentsResult : { empty: true, docs: [] };
    const subscriptionsSnap = subscriptionsResult?.docs != null ? subscriptionsResult : { empty: true, docs: [] };
    const billingSummary = billingResult && typeof billingResult === 'object' ? billingResult : null;

    // Process users data with enhanced error handling
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

    const hasValidEmail = (email) => {
      const e = (email || '').trim();
      return e.length > 0 && e !== 'No email' && e.includes('@');
    };

    const teamMembers = usersSnap.docs
      .filter(d => {
        try {
          const primaryRole = d.data().primaryRole || '';
          if (primaryRole.toLowerCase() === 'sitemanager') return false;
          if (!hasValidEmail(d.data().email)) return false; // Skip fake users (no email)
          return true;
        } catch (error) {
          console.warn('fetchCompanyDashboardData: Error filtering user:', d.id, error);
          return false;
        }
      })
      .map(d => {
        try {
          const userData = d.data();
          const name = getUserDisplayName(userData);

          return {
            id: d.id,
            userId: d.id,
            uid: d.id,
            name,
            email: userData.email || 'No email',
            profileImage: userData.profileImage || null, // ✅ ADD THIS LINE
            role: getRoleName(userData.primaryRole) || 'Employee',
            jobTitle: userData.jobTitle || getRoleName(userData.primaryRole) || 'Employee', // ✅ ADD THIS LINE
            roleCategory: ['teamManager', 'adminManager', 'hrManager'].includes(userData.primaryRole) ? 'Manager' : 'Employee', // ✅ ADD THIS LINE
            status: (userData.status === 'active') ? 'active' : 'Inactive',
            joinDate: formatDisplayDate(userData.createdAt),
            isInvited: false
          };
        } catch (error) {
          console.warn('fetchCompanyDashboardData: Error processing user:', d.id, error);
          return {
            id: d.id,
            name: 'Unknown User',
            email: 'No email',
            profileImage: null, // ✅ ADD THIS LINE
            role: 'Employee',
            jobTitle: 'Employee', // ✅ ADD THIS LINE
            roleCategory: 'Employee', // ✅ ADD THIS LINE
            status: 'Inactive',
            joinDate: '—',
            isInvited: false
          };
        }
      });

    const inviteMembers = (invitesSnapResult.docs || [])
      .filter(docSnap => hasValidEmail((docSnap.data() || {}).email))
      .map(docSnap => {
        const inviteData = docSnap.data() || {};
        return {
          id: `invite-${docSnap.id}`,
          userId: `invite-${docSnap.id}`,
          uid: `invite-${docSnap.id}`,
          name: inviteData.displayName || inviteData.email || 'Invited User',
          email: inviteData.email || 'No email',
          role: getRoleName(inviteData.primaryRole) || 'Employee',
          status: 'Invited',
          joinDate: formatDisplayDate(inviteData.createdAt) || 'Pending',
          isInvited: true,
          inviteId: docSnap.id
        };
      });

    // Process company data with fallback
    let companyData = { seatCount: 0, currentEmployeeCount: 0, pricePerSeat: 5, joinDate: '—', paymentMethod: '—' };
    if (companySnap.exists()) {
      try {
        const data = companySnap.data();
        companyData = {
          seatCount: Number.isFinite(data.seatCount) ? data.seatCount : 0,
          currentEmployeeCount: Number.isFinite(data.currentEmployeeCount) ? data.currentEmployeeCount : 0,
          pricePerSeat: Number.isFinite(data.pricePerSeat) ? data.pricePerSeat : 5,
          joinDate: formatDisplayDate(data.createdAt),
          paymentMethod: data.defaultPaymentMethod || data.paymentMethod || '—'
        };
      } catch (error) {
        console.warn('fetchCompanyDashboardData: Error processing company data:', error);
      }
    } else {
      console.warn('fetchCompanyDashboardData: Company document not found:', companyId);
    }

    // Process payment data with error handling
    let paymentData = { status: '—', date: '—' };
    if (!paymentsSnap.empty) {
      try {
        const p = paymentsSnap.docs[0].data();
        paymentData = {
          status: p.status || '—',
          date: p.createdAt?.toDate ? p.createdAt.toDate().toISOString().slice(0, 10) : '—'
        };
      } catch (error) {
        console.warn('fetchCompanyDashboardData: Error processing payment data:', error);
      }
    }

    // Process subscription data with error handling
    let subscriptionData = { nextBilling: '—' };
    if (!subscriptionsSnap.empty) {
      try {
        const s = subscriptionsSnap.docs[0].data();
        subscriptionData = {
          nextBilling: s.periodEnd?.toDate ? s.periodEnd.toDate().toISOString().slice(0, 10) : '—'
        };
      } catch (error) {
        console.warn('fetchCompanyDashboardData: Error processing subscription data:', error);
      }
    }

    // Deduplicate by id so manual duplicates in DB never show as duplicate rows
    const seenIds = new Set();
    const dedupedTeam = teamMembers.filter(m => {
      if (seenIds.has(m.id)) return false;
      seenIds.add(m.id);
      return true;
    });
    const dedupedInvites = inviteMembers.filter(m => {
      if (seenIds.has(m.id)) return false;
      seenIds.add(m.id);
      return true;
    });
    const combinedMembers = [...dedupedTeam, ...dedupedInvites];
    const activeUsersCount = companyData.currentEmployeeCount > 0
      ? companyData.currentEmployeeCount
      : dedupedTeam.length;
    const pendingInvitesCount = dedupedInvites.length;

    const seatCount = Number.isFinite(billingSummary?.seatQuota)
      ? billingSummary.seatQuota
      : companyData.seatCount || 0;
    const pricePerSeat = Number.isFinite(billingSummary?.pricePerSeat)
      ? billingSummary.pricePerSeat
      : companyData.pricePerSeat || 5;
    const monthlyBill = Number.isFinite(billingSummary?.monthlyAmount)
      ? billingSummary.monthlyAmount
      : seatCount * pricePerSeat;
    const used = activeUsersCount + pendingInvitesCount;
    const seatDeficit = Math.max(0, used - seatCount);

    const formattedNextBilling = billingSummary?.renewalDate
      ? formatDisplayDate(billingSummary.renewalDate)
      : (subscriptionData.nextBilling || '—');
    const formattedLastPaymentStatus = formatLabel(
      billingSummary?.lastPaymentType || paymentData.status || '—'
    );
    const formattedLastPaymentDate = billingSummary?.lastPaymentAt
      ? formatDisplayDate(billingSummary.lastPaymentAt)
      : paymentData.date || '—';
    const paymentMethod = formatLabel(
      billingSummary?.lastPaymentType || companyData.paymentMethod || '—'
    );

    const result = {
      teamMembers: combinedMembers,
      totalUsers: activeUsersCount,
      seatUsageCount: used,
      pendingInvites: pendingInvitesCount,
      totalSeats: seatCount,
      monthlyBill,
      pricePerSeat,
      seatDeficit,
      lastPaymentStatus: formattedLastPaymentStatus,
      lastPaymentDate: formattedLastPaymentDate,
      nextBilling: formattedNextBilling,
      paymentMethod,
      joinDate: companyData.joinDate || '—',
      lastUpdated: new Date().toISOString(),
      hasData: true,
      plugins: companySnap.exists() ? (companySnap.data().plugins || {}) : {}
    };

    // Cache the result with error handling
    cache.set(cacheKey, result);
    return result;
  }, 'fetchCompanyDashboardData', { companyId });
}

// Optimized user list data fetcher with enhanced error handling
// options.forceRefresh: if true, bypass cache and fetch from DB (e.g. after manual DB changes)
export async function fetchUserListData(companyId, options = {}) {
  const { forceRefresh = false } = options;
  // Validate input
  const idsValidation = validateRequiredIds({ companyId });
  if (!idsValidation.isValid) {
    const error = new Error(`Invalid company ID: ${idsValidation.errors.join(', ')}`);
    error.code = 'invalid-argument';
    throw classifyFirebaseError(error);
  }

  const cacheKey = `user-list-${companyId}`;
  if (forceRefresh) cache.delete(cacheKey);
  const cached = cache.get(cacheKey);

  if (cached) {
    scheduleBackgroundRefresh('userList', companyId);
    return cached;
  }

  return executeWithErrorHandling(async () => {
    if (process.env.NODE_ENV === 'development') {
      console.log('fetchUserListData: Fetching fresh data', { companyId });
    }

    // Execute queries in parallel — capped for scalability (use pagination for full lists)
    const [usersSnap, assignmentsSnap] = await Promise.all([
      getDocs(query(
        collection(db, 'users'),
        where('companyId', '==', `companies/${companyId}`),
        limit(USER_LIST_MAX_USERS)
      )),
      getDocs(query(
        collection(db, 'assignments'),
        where('companyId', '==', companyId),
        limit(USER_LIST_MAX_ASSIGNMENTS)
      ))
    ]);

    // Process users data efficiently
    const userIdToUser = new Map();
    const allUsers = [];

    const roleToJobTitle = (role) => {
      const mapping = {
        'siteManager': 'Site Manager',
        'teamManager': 'Team Manager',
        'adminManager': 'Admin Manager',
        'hrManager': 'HR Manager',
        'adminAdvisor': 'Admin Advisor',
        'hrAdvisor': 'HR Advisor',
        'contractManager': 'Contract Manager',
        'employee': 'Employee'
      };
      return mapping[role] || 'Employee';
    };

    const roleToCategory = (role) =>
      ['teamManager', 'adminManager', 'hrManager'].includes(role) ? 'Manager' : 'Employee';

    const hasValidEmailForList = (email) => {
      const e = (email || '').trim();
      return e.length > 0 && e !== 'No email' && e.includes('@');
    };

    // Process users in a single loop with error handling
    for (const d of usersSnap.docs) {
      try {
        const u = d.data();
        // Skip Site Managers from appearing in the list
        if ((u.primaryRole || '').toLowerCase() === 'sitemanager') continue;
        // Skip fake users (no or invalid email)
        if (!hasValidEmailForList(u.email)) continue;

        const id = d.id;
        const name = getUserDisplayName(u);
        const jobTitle = roleToJobTitle(u.primaryRole);
        const roleCategory = roleToCategory(u.primaryRole);
        const status = (u.status === 'active') ? 'active' : 'Inactive';

        const row = {
          id,
          userId: id,
          uid: id,
          name,
          email: u.email || 'No email',
          jobTitle,
          roleCategory,
          status,
          primaryRole: u.primaryRole
        };
        userIdToUser.set(id, { id, ...u, _row: row });
        allUsers.push(row);
      } catch (error) {
        console.warn('fetchUserListData: Error processing user:', d.id, error);
        // Continue processing other users
      }
    }

    // Determine manager users
    const managerRoles = new Set(['teamManager', 'adminManager', 'hrManager', 'siteManager']);
    const managerIds = new Set(
      allUsers.filter(u => managerRoles.has(u.primaryRole)).map(u => u.id)
    );

    // Process assignments efficiently
    const managerIdToEmployees = new Map();
    const strip = (v) => typeof v === 'string' ? (v.includes('/') ? v.split('/').pop() : v) : null;

    for (const d of assignmentsSnap.docs) {
      const a = d.data();
      const employeeId = strip(a.employeeId || a.employeeUid || a.assigneeId || a.userId);
      const managerId = strip(a.managerId || a.managerUid || a.assignedToId);

      if (!employeeId || !managerId) continue;
      if (!userIdToUser.has(employeeId) || !userIdToUser.has(managerId)) continue;

      if (!managerIdToEmployees.has(managerId)) {
        managerIdToEmployees.set(managerId, new Set());
      }
      managerIdToEmployees.get(managerId).add(employeeId);
      managerIds.add(managerId);
    }

    // Process managedEmployees arrays
    for (const [id, userDoc] of userIdToUser.entries()) {
      const managed = Array.isArray(userDoc.managedEmployees) ? userDoc.managedEmployees : [];
      if (!managed.length) continue;

      const normalizedManaged = managed.map(strip).filter(Boolean).filter(eid => userIdToUser.has(eid));
      if (normalizedManaged.length) {
        if (!managerIdToEmployees.has(id)) {
          managerIdToEmployees.set(id, new Set());
        }
        normalizedManaged.forEach(eid => managerIdToEmployees.get(id).add(eid));
        managerIds.add(id);
      }
    }

    // Process direct managerUserId relationships
    for (const [employeeId, userDoc] of userIdToUser.entries()) {
      const managerId = strip(userDoc.managerUserId || userDoc.reportsTo);
      if (!managerId) continue;

      console.log(`Processing manager relationship: Employee ${employeeId} -> Manager ${managerId}`);

      if (!userIdToUser.has(managerId)) {
        console.warn(`Manager ${managerId} not found in user list for employee ${employeeId}`);
        continue;
      }

      // Add manager to manager list
      managerIds.add(managerId);

      // Add employee to manager's list
      if (!managerIdToEmployees.has(managerId)) {
        managerIdToEmployees.set(managerId, new Set());
      }
      managerIdToEmployees.get(managerId).add(employeeId);

      console.log(`Added employee ${employeeId} to manager ${managerId}'s group`);
    }

    // Build groups efficiently with enhanced manager information
    const groups = [];
    const assignedUserIds = new Set();

    for (const managerId of managerIds) {
      const managerUser = userIdToUser.get(managerId);
      if (!managerUser) continue;

      const primaryRow = managerUser._row;
      const employeeIds = Array.from(managerIdToEmployees.get(managerId) || []);
      employeeIds.forEach(id => assignedUserIds.add(id));

      const associated = employeeIds
        .map(id => userIdToUser.get(id)?._row)
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));

      // Enhanced primary row with team information
      const enhancedPrimaryRow = {
        ...primaryRow,
        teamSize: associated.length,
        teamInfo: `${associated.length} team member${associated.length !== 1 ? 's' : ''}`,
        isManager: true
      };

      groups.push({
        primary: enhancedPrimaryRow,
        associated,
        managerType: primaryRow.primaryRole,
        teamStats: {
          total: associated.length,
          active: associated.filter(u => u.status === 'active').length,
          inactive: associated.filter(u => u.status === 'Inactive').length
        }
      });
    }

    // Deduplicate users by id so duplicate docs in DB never show as duplicate rows
    const uniqueUsersById = new Map();
    for (const u of allUsers) {
      if (!uniqueUsersById.has(u.id)) uniqueUsersById.set(u.id, u);
    }
    const dedupedAllUsers = Array.from(uniqueUsersById.values());

    // Add unassigned users (use deduped list for consistency)
    const unassigned = dedupedAllUsers
      .filter(u => !managerIds.has(u.id) && !assignedUserIds.has(u.id));

    if (unassigned.length) {
      groups.push({
        primary: {
          id: 'Unassigned',
          name: 'Unassigned',
          email: '',
          jobTitle: `${unassigned.length} users`,
          roleCategory: 'Group',
          status: ''
        },
        associated: unassigned.sort((a, b) => a.name.localeCompare(b.name))
      });
    }

    const result = {
      groupedUsers: groups,
      lastUpdated: new Date().toISOString(),
      hasData: groups.length > 0
    };

    // Cache the result with error handling
    const cached = cache.set(cacheKey, result);
    if (process.env.NODE_ENV === 'development') {
      if (!cached) console.warn('fetchUserListData: Failed to cache result');
      console.log('fetchUserListData: Successfully fetched and processed data', {
        companyId,
        groupsCount: groups.length,
        totalUsers: allUsers.length,
        managerCount: managerIds.size,
        assignedEmployees: assignedUserIds.size,
        cached
      });
    }

    return result;
  }, 'fetchUserListData', { companyId });
}

// Clear cache when data is modified with enhanced error handling
export function clearCompanyCache(companyId) {
  try {
    if (!companyId || typeof companyId !== 'string') {
      console.warn('clearCompanyCache: Invalid company ID:', companyId);
      return false;
    }

    const dashboardDeleted = cache.delete(`company-dashboard-${companyId}`);
    const userListDeleted = cache.delete(`user-list-${companyId}`);

    console.log('clearCompanyCache: Cache cleared', {
      companyId,
      dashboardDeleted,
      userListDeleted
    });

    return dashboardDeleted || userListDeleted;
  } catch (error) {
    console.error('clearCompanyCache: Failed to clear cache:', error);
    return false;
  }
}

// Clear all cache with error handling
export function clearAllCache() {
  try {
    const stats = cache.getStats();
    cache.clear();
    console.log('clearAllCache: All cache cleared', { previousSize: stats.size });
    return true;
  } catch (error) {
    console.error('clearAllCache: Failed to clear all cache:', error);
    return false;
  }
}

// Get cache statistics for debugging
export function getCacheStats() {
  try {
    return cache.getStats();
  } catch (error) {
    console.error('getCacheStats: Failed to get cache stats:', error);
    return { size: 0, keys: [], ttl: 0, error: error.message };
  }
}

// Cache document statistics for faster dashboard loads
export async function getCachedDocumentStats(companyId, userRole, userId) {
  const cacheKey = `doc-stats-${companyId}-${userRole}-${userId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    // Import dynamically to avoid circular dependency
    const { documentService } = await import('./documentService');
    const stats = await documentService.getDocumentStatistics(companyId, userRole, userId);
    cache.set(cacheKey, stats);
    return stats;
  } catch (error) {
    console.error('getCachedDocumentStats: Failed to fetch stats:', error);
    throw error;
  }
}

// Performance monitoring wrapper
export async function withPerformanceTracking(queryName, queryFn) {
  const start = performance.now();
  try {
    const result = await queryFn();
    const duration = performance.now() - start;

    if (duration > 1000) { // Log slow queries (>1s)
      console.warn(`🐌 Slow Query: ${queryName} took ${duration.toFixed(2)}ms`);
    }

    return result;
  } catch (error) {
    const duration = performance.now() - start;
    console.error(`❌ Failed Query: ${queryName} after ${duration.toFixed(2)}ms`, error);
    throw error;
  }
}

// Export the DataCache class and cache instance
export { DataCache };
export default cache;