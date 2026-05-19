import hrApiClient from '../lib/hrApiClient';
import { timesheetValidation } from './timesheetValidation';

/**
 * Service for detecting and resolving duplicate timesheet entries (REST version)
 */
export class TimesheetDeduplicationService {
  /**
   * Detect duplicate entries for a user/week combination
   * In REST mode, duplicates are prevented by DB unique constraints.
   */
  async detectDuplicateEntries(userId, weekStartDate, options = {}) {
    try {
      const weekStart = await timesheetValidation.normalizeWeekStartDate(weekStartDate, options.weekStartDay);
      
      // Fetch timesheets for this week
      const { data } = await hrApiClient.get('/hr/timesheets', {
        params: { employeeId: userId, weekStart, limit: 10 }
      });

      const allDocs = data.timesheets || [];

      // Since DB has UNIQUE constraint on (companyId, employeeId, weekStart), 
      // allDocs.length should be <= 1.
      return {
        hasDuplicates: allDocs.length > 1, // Should be false in REST
        weekStart,
        totalDocs: allDocs.length,
        duplicateGroups: [],
        allDocs
      };
    } catch (error) {
      console.error('[TimesheetDeduplication] Error detecting duplicates:', error);
      return { hasDuplicates: false, allDocs: [] };
    }
  }

  async mergeDuplicateEntries(duplicateEntries, mergeStrategy = 'latest') {
      // In REST, we don't expect duplicates. If we found them, the DB state is weird.
      // This is a stub for backward compatibility.
      return { success: true, message: 'Duplicates handled by database constraints' };
  }

  async cleanupDuplicates(userId, weekStartDate, options = {}) {
    // Already handled by DB
    return {
      success: true,
      message: 'No duplicates possible in REST architecture',
      cleaned: 0
    };
  }

  async getDeduplicationStats(userId, options = {}) {
    return {
      userId,
      totalWeeks: 0,
      weeksWithDuplicates: 0,
      totalDuplicateDocs: 0,
      duplicateRate: 0
    };
  }
}

export const timesheetDeduplication = new TimesheetDeduplicationService();
export const detectDuplicateEntries = (userId, weekStartDate, options) => timesheetDeduplication.detectDuplicateEntries(userId, weekStartDate, options);
export const mergeDuplicateEntries = (duplicateEntries, mergeStrategy) => timesheetDeduplication.mergeDuplicateEntries(duplicateEntries, mergeStrategy);
export const cleanupDuplicates = (userId, weekStartDate, options) => timesheetDeduplication.cleanupDuplicates(userId, weekStartDate, options);