import { collection, getDocs, query, where, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/client';
import { DEFAULT_WEEK_START_DAY, formatISODate, getWeekRangeForDate } from '../utils/weekStartUtils';
import { getUserWeekContext } from './timesheets';
import { timesheetCache } from './timesheetCache';


/**
 * Service for counting weekly timesheet submissions
 * Provides centralized logic for counting unique weeks with timesheets
 */
export class WeeklyTimesheetCounter {
  /**
   * Count unique weeks with timesheets for a user
   * @param {string} userId - User ID to count timesheets for
   * @param {string[]} statuses - Array of statuses to include (default: ['pending', 'approved', 'rejected'])
   * @returns {Promise<number>} - Number of unique weeks with timesheets
   */
  static async countWeeklySubmissions(userId, statuses = ['pending', 'approved', 'rejected']) {
    try {
      if (!userId) return 0;

      // 0. Cache Check
      const cacheKey = `timesheets:count:${userId}`;
      const cached = timesheetCache.get(cacheKey);
      if (cached !== null && cached !== undefined) return cached;

      const tsCol = collection(db, 'timesheets');

      // OPTIMIZATION: Limit to past 12 months to prevent unbounded history scan (Scalability Fix)
      // We rely on client-side status filtering to avoid requiring a complex composite index (userId + status + period)
      const d = new Date();
      d.setFullYear(d.getFullYear() - 1);
      const minPeriod = formatISODate(d);

      const q = query(
        tsCol,
        where('userId', '==', userId),
        where('period', '>=', minPeriod)
      );

      const snap = await getDocs(q);
      const timesheets = snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(t => statuses.includes(t.status)); // Client-side filter

      // Group by week and count unique weeks using Unified Logic
      const { weekStartDay } = await getUserWeekContext(userId);
      const resolvedWeekStartDay = weekStartDay || DEFAULT_WEEK_START_DAY;
      const counts = await this.calculateWeeklyCounts(timesheets, resolvedWeekStartDay);
      const count = counts.total;

      // Cache Result (Short TTL: 2 mins)
      timesheetCache._setWithCustomTTL(cacheKey, count, 2 * 60 * 1000);

      return count;
    } catch (error) {
      console.error('[WeeklyTimesheetCounter] Error counting weekly submissions:', error);
      return 0;
    }
  }


  /**
   * Get aggregated weekly stats for a company/week (O(1) read)
   * @param {string} companyId - Company ID
   * @param {string} weekStartDate - YYYY-MM-DD
   */
  static async getWeeklyStats(companyId, weekStartDate) {
    try {
      if (!companyId || !weekStartDate) return null;
      const rawId = companyId.replace('companies/', '');
      const docRef = doc(db, `companies/${rawId}/weeklyStats`, weekStartDate);
      const snap = await getDoc(docRef);
      return snap.exists() ? snap.data() : null;
    } catch (error) {
      console.warn('[WeeklyTimesheetCounter] Failed to fetch stats:', error);
      return null;
    }
  }

  /**
   * Fetch all timesheets for a company for the last 12 months (Batch Optimization)
   * @param {string} companyId - Company ID path (e.g. 'companies/123')
   * @returns {Promise<Map<string, Array>>} - Map of userId -> timesheets array
   */
  static async getTimesheetsForCompany(companyId) {
    try {
      if (!companyId) return new Map();

      const tsCol = collection(db, 'timesheets');
      const d = new Date();
      d.setFullYear(d.getFullYear() - 1);
      const minPeriod = formatISODate(d);

      let snap;

      try {
        // 1. Try Optimized Query (Requires Index)
        const q = query(
          tsCol,
          where('companyId', '==', companyId),
          where('period', '>=', minPeriod)
        );
        snap = await getDocs(q);
      } catch (err) {
        // [SAFETY FIX] Removed dangerous fallback that queried entire collection
        if (err.code === 'failed-precondition') {
          console.error('[WeeklyTimesheetCounter] Index missing for company query. Aborting to protect performance.');
          throw new Error('Missing Index: Create Composite Index for [companyId ASC, period ASC]');
        }
        throw err;
      }

      const userMap = new Map();
      snap.docs.forEach(doc => {
        const data = doc.data();
        const userId = data.userId;
        if (!userId) return;

        if (!userMap.has(userId)) {
          userMap.set(userId, []);
        }
        userMap.get(userId).push({ id: doc.id, ...data });
      });

      return userMap;
    } catch (error) {
      console.error('[WeeklyTimesheetCounter] Error fetching company timesheets:', error);
      return new Map();
    }
  }

  /**
   * Fetch timesheets for a company for a SPECIFIC week (Optimized)
   * SCALABILITY: Checks for pre-aggregated stats first (O(1)) before querying raw docs (O(N))
   * @param {string} companyId - Company ID path
   * @param {string} weekStartStr - ISO Date YYYY-MM-DD (Monday)
   * @returns {Promise<Map<string, Array>>} - Map of userId -> timesheets array
   */
  static async getTimesheetsForCompanyByWeek(companyId, weekStartStr) {
    try {
      if (!companyId || !weekStartStr) return new Map();

      // [SCALABILITY] Try to fetch pre-aggregated stats first
      // This is the implementation for 1M+ users where a Cloud Function aggregates data
      try {
        const statsRef = doc(db, `companies/${companyId.replace('companies/', '')}/weeklyStats`, weekStartStr);
        const statsSnap = await getDoc(statsRef);

        if (statsSnap.exists()) {
          const stats = statsSnap.data();
          // If we have full user map in stats (limited scale) or summary
          // For this specific method which expects a Map of timesheets, 
          // we only return if the stats doc contains the full 'timesheetMap'.
          // Otherwise config might force raw query for detailed views.
          if (stats.timesheetMap) {
            const userMap = new Map(Object.entries(JSON.parse(stats.timesheetMap)));
            return userMap;
          }
        }
      } catch (e) {
        // Ignore stats fetch error, verify permissions or existence
        // console.warn('Failed to fetch aggregated stats, falling back to query', e);
      }

      const tsCol = collection(db, 'timesheets');
      const rawId = companyId.replace('companies/', '');
      const pathId = `companies/${rawId}`;
      let snap;

      try {
        // OPTIMIZED QUERY: Fetch by PERIOD range for the week
        // Check BOTH rawId and pathId formats for companyId

        // Calculate week end date (start + 6 days)
        const startDate = new Date(weekStartStr);
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);
        const weekEndStr = formatISODate(endDate);

        const q = query(
          tsCol,
          where('companyId', 'in', [rawId, pathId]),
          where('period', '>=', weekStartStr),
          where('period', '<=', weekEndStr)
        );
        snap = await getDocs(q);
      } catch (err) {
        // REMOVED: Unbounded fallback query (safety fix)
        // Previous fallback downloaded entire company timesheet database (365K+ docs)
        // causing browser crashes and 30-120 second load times

        if (err.code === 'failed-precondition') {
          console.error('[WeeklyTimesheetCounter] CRITICAL: Missing required Firestore composite index.');
          console.error('Required index: timesheets collection with fields [companyId ASC, period ASC]');
          console.error('Deploy index with: firebase deploy --only firestore:indexes');
          console.error('Verify index configuration in firestore.indexes.json');

          // Return empty result with error indicator
          throw new Error(
            'Database index missing - unable to load timesheet data. ' +
            'Administrator: Deploy required Firestore index (timesheets: companyId + period). ' +
            'See https://firebase.google.com/docs/firestore/query-data/indexing for details.'
          );
        }

        // Re-throw other errors
        throw err;
      }

      const userMap = new Map();
      snap.docs.forEach(doc => {
        const data = doc.data();
        const userId = data.userId;
        if (!userId) return;

        if (!userMap.has(userId)) {
          userMap.set(userId, []);
        }
        userMap.get(userId).push({ id: doc.id, ...data });
      });

      return userMap;
    } catch (error) {
      console.error('[WeeklyTimesheetCounter] Error fetching company timesheets for week:', error);
      return new Map();
    }
  }

  /**
   * Calculate counts from a list of timesheets (Pure calculation)
   * @param {Array} timesheets - Array of timesheet objects
   * @param {string} weekStartDay - Week start day setting
   * @returns {Object} - Counts object
   */
  static async calculateWeeklyCounts(timesheets, weekStartDay = DEFAULT_WEEK_START_DAY) {
    const { unifyTimesheetsByEntries } = await import('./timesheetUnification');
    const unified = unifyTimesheetsByEntries(timesheets, weekStartDay);

    const counts = {
      total: 0,
      approved: 0,
      pending: 0,
      rejected: 0,
      draft: 0
    };

    const normalizeStatus = (rawStatus) => {
      const status = String(rawStatus || 'draft').toLowerCase();
      if (status === 'approved') return 'approved';
      if (status === 'rejected') return 'rejected';
      if (status === 'pending' || status === 'approved-by-team' || status === 'submitted') return 'pending';
      return 'draft';
    };

    unified.forEach(week => {
      counts.total++;
      const status = normalizeStatus(week.status);
      if (status === 'approved') counts.approved++;
      else if (status === 'pending') counts.pending++;
      else if (status === 'rejected') counts.rejected++;
      else counts.draft++;
    });

    return counts;
  }

  /**
   * Helper to group daily timesheets by week
   * @param {Array} timesheets - Array of timesheet documents
   * @returns {Object} - Object with week keys and arrays of timesheets
   */
  static groupTimesheetsByWeek(timesheets, weekStartDay = DEFAULT_WEEK_START_DAY) {
    const weekGroups = {};

    timesheets.forEach(timesheet => {
      // Skip timesheets with invalid period
      if (!timesheet.period || typeof timesheet.period !== 'string') {
        console.warn('[WeeklyTimesheetCounter] Skipping timesheet with invalid period:', timesheet.id);
        return;
      }

      const weekKey = this.getWeekKey(timesheet.period, weekStartDay);
      if (!weekGroups[weekKey]) {
        weekGroups[weekKey] = [];
      }
      weekGroups[weekKey].push(timesheet);
    });

    return weekGroups;
  }

  /**
   * Get week key (Monday date) from a date string
   * @param {string} dateStr - ISO date string (YYYY-MM-DD)
   * @returns {string} - Week key (Monday date in YYYY-MM-DD format)
   */
  static getWeekKey(dateStr, weekStartDay = DEFAULT_WEEK_START_DAY) {
    try {
      const { start } = getWeekRangeForDate(dateStr, weekStartDay);
      return formatISODate(start); // Return YYYY-MM-DD format
    } catch (error) {
      console.error('[WeeklyTimesheetCounter] Error getting week key:', error);
      return dateStr; // Fallback to original date
    }
  }

  /**
   * Determine the status of a week based on its timesheets
   * @param {Array} weekTimesheets - Array of timesheets for a week
   * @returns {string} - Week status ('approved', 'pending', 'rejected', 'draft')
   */
  static getWeekStatus(weekTimesheets) {
    if (!weekTimesheets || weekTimesheets.length === 0) return 'draft';

    const STATUS_PRIORITY = { 'rejected': 3, 'pending': 2, 'approved': 1, 'draft': 0 };

    let highestRank = -1;
    let winningStatus = 'draft';

    weekTimesheets.forEach(ts => {
      const status = (ts.status || 'draft').toLowerCase();
      const rank = STATUS_PRIORITY[status] || 0;
      if (rank > highestRank) {
        highestRank = rank;
        winningStatus = status;
      }
    });

    return winningStatus;
  }

  /**
   * Get week range (start and end dates) for a given date
   * @param {string|Date} date - Date to get week range for
   * @returns {Object} - Object with start and end Date objects
   */
  static getWeekRange(date, weekStartDay = DEFAULT_WEEK_START_DAY) {
    try {
      const { start, end } = getWeekRangeForDate(date, weekStartDay);
      return { start, end };
    } catch (error) {
      console.error('[WeeklyTimesheetCounter] Error getting week range:', error);
      return { start: new Date(), end: new Date() };
    }
  }
  /**
   * Fetch timesheets for a specific list of users for a SPECIFIC week (Batch Query)
   * Optimization for Paginated Lists: Only fetch timesheets for visible users.
   * @param {string[]} userIds - Array of User IDs (max 30 for 'in' query)
   * @param {string} weekStartStr - ISO Date YYYY-MM-DD (Monday)
   * @returns {Promise<Map<string, Array>>} - Map of userId -> timesheets array
   */
  static async getTimesheetsForUsersBatch(userIds, weekStartStr = null) {
    try {
      if (!userIds || userIds.length === 0) return new Map();

      const tsCol = collection(db, 'timesheets');

      // Calculate week end date if weekStartStr is provided
      let weekEndStr = null;
      if (weekStartStr) {
        const startDate = new Date(weekStartStr);
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);
        weekEndStr = formatISODate(endDate);
      }

      // Firestore 'in' query is limited to 30 items
      // We process in chunks of 10 to be safe and efficient
      const chunkSize = 10;
      const chunks = [];
      for (let i = 0; i < userIds.length; i += chunkSize) {
        chunks.push(userIds.slice(i, i + chunkSize));
      }

      // Determine minimum period (default to 12 months ago if no specific week)
      const d = new Date();
      d.setFullYear(d.getFullYear() - 1);
      const minPeriod = weekStartStr || formatISODate(d);

      const results = await Promise.all(chunks.map(async (chunk) => {
        let q = query(
          tsCol,
          where('userId', 'in', chunk),
          where('period', '>=', minPeriod)
        );

        // If we have a specific week range, add the upper bound
        if (weekStartStr && weekEndStr) {
          q = query(q, where('period', '<=', weekEndStr));
        }

        return getDocs(q);
      }));

      const userMap = new Map();
      results.forEach(snap => {
        snap.docs.forEach(doc => {
          const data = doc.data();
          const userId = data.userId;
          if (!userId) return;

          if (!userMap.has(userId)) {
            userMap.set(userId, []);
          }
          userMap.get(userId).push({ id: doc.id, ...data });
        });
      });

      return userMap;

    } catch (error) {
      console.error('[WeeklyTimesheetCounter] Error fetching batch timesheets:', error);
      return new Map();
    }
  }
}

export default WeeklyTimesheetCounter;