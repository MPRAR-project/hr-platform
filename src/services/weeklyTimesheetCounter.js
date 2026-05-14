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
      return filtered.length; // Each record is a week in the new architecture
    } catch (error) {
      console.error('[WeeklyTimesheetCounter] Error counting weekly submissions:', error);
      return 0;
    }
  }

  static async getWeeklyStats(companyId, weekStartDate) {
    try {
      const { data } = await hrApiClient.get('/hr/timesheets/summary', {
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
        params: { limit: 1000 }
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
      const { data } = await hrApiClient.get('/hr/timesheets', {
        params: { weekStart: weekStartStr, limit: 1000 }
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

  static getWeekKey(dateStr, weekStartDay = DEFAULT_WEEK_START_DAY) {
    try {
      const { start } = getWeekRangeForDate(dateStr, weekStartDay);
      return formatISODate(start);
    } catch (error) {
      return dateStr;
    }
  }

  static async getTimesheetsForUsersBatch(userIds, weekStartStr = null) {
      // Simplified: fetch all for the week
      return this.getTimesheetsForCompanyByWeek(null, weekStartStr);
  }
}

export default WeeklyTimesheetCounter;