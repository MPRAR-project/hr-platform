import hrApiClient from '../lib/hrApiClient';
import { DEFAULT_WEEK_START_DAY, formatISODate, getWeekRangeForDate } from '../utils/weekStartUtils';

/**
 * Service for counting weekly timesheet submissions (REST version)
 */
export class WeeklyTimesheetCounter {
  /**
   * Count unique weeks with timesheets for a user
   */
  static async countWeeklySubmissions(userId, statuses = ['submitted', 'approved', 'rejected']) {
    try {
      if (!userId) return 0;
      
      const { data } = await hrApiClient.get('/hr/timesheets', {
        params: { employeeId: userId, limit: 100 }
      });

      const timesheets = data.timesheets || [];
      const filtered = timesheets.filter(t => statuses.includes(t.status));
      return filtered.length;
    } catch (error) {
      console.error('[WeeklyTimesheetCounter] Error counting weekly submissions:', error);
      return 0;
    }
  }

  static async getWeeklyStats(companyId, weekStartDate) {
    try {
      // Correct endpoint: /hr/timesheets/week-summary (not /summary)
      const { data } = await hrApiClient.get('/hr/timesheets/week-summary', {
        params: { weekStart: weekStartDate }
      });
      return data;
    } catch (error) {
      return null;
    }
  }

  static async getTimesheetsForCompany(companyId) {
    try {
      const { data } = await hrApiClient.get('/hr/timesheets', {
        params: { limit: 500 }
      });
      
      const userMap = new Map();
      (data.timesheets || []).forEach(ts => {
        if (!userMap.has(ts.employeeId)) userMap.set(ts.employeeId, []);
        userMap.get(ts.employeeId).push(ts);
      });
      return userMap;
    } catch (error) {
      return new Map();
    }
  }

  static async getTimesheetsForCompanyByWeek(companyId, weekStartStr) {
    try {
      const params = { limit: 500 };
      if (weekStartStr) params.weekStart = weekStartStr;

      const { data } = await hrApiClient.get('/hr/timesheets', { params });
      
      const userMap = new Map();
      (data.timesheets || []).forEach(ts => {
        if (!userMap.has(ts.employeeId)) userMap.set(ts.employeeId, []);
        userMap.get(ts.employeeId).push(ts);
      });
      return userMap;
    } catch (error) {
      return new Map();
    }
  }

  static getWeekKey(dateStr, weekStartDay = DEFAULT_WEEK_START_DAY) {
    try {
      const { start } = getWeekRangeForDate(dateStr, weekStartDay);
      return formatISODate(start);
    } catch (error) {
      return dateStr;
    }
  }

  /**
   * Batch fetch timesheets for multiple users.
   * If weekStartStr provided, filters to that week.
   * Returns a Map<userId, timesheet[]>
   */
  static async getTimesheetsForUsersBatch(userIds, weekStartStr = null) {
    if (!Array.isArray(userIds) || userIds.length === 0) return new Map();

    // For small batches (≤20) fetch individually in parallel for accuracy
    if (userIds.length <= 20) {
      const map = new Map();
      await Promise.allSettled(
        userIds.map(async (uid) => {
          try {
            const params = { employeeId: uid, limit: 52 };
            if (weekStartStr) params.weekStart = weekStartStr;
            const { data } = await hrApiClient.get('/hr/timesheets', { params });
            map.set(uid, data.timesheets || []);
          } catch {
            map.set(uid, []);
          }
        })
      );
      return map;
    }

    // For larger batches: one company-wide call, then partition
    return this.getTimesheetsForCompanyByWeek(null, weekStartStr);
  }

  static calculateWeeklyCounts(timesheets = [], weekStartDay = 'monday') {
    const counts = { total: 0, approved: 0, pending: 0, rejected: 0, draft: 0 };
    for (const ts of timesheets) {
      counts.total++;
      const status = (ts.status || 'draft').toLowerCase();
      if (status === 'approved')                                        counts.approved++;
      else if (status === 'submitted' || status === 'pending')          counts.pending++;
      else if (status === 'rejected')                                   counts.rejected++;
      else                                                              counts.draft++;
    }
    return counts;
  }
}

export default WeeklyTimesheetCounter;
