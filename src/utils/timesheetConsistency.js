import { db } from '../firebase/client';
import { collection, query, where, getDocs, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { timesheetValidation } from '../services/timesheetValidation';
import { timesheetDeduplication } from '../services/timesheetDeduplication';
import { formatISODate, getWeekRange } from '../services/timesheets';
import { DEFAULT_WEEK_START_DAY } from './weekStartUtils';

/**
 * Service for ensuring consistent timesheet data across all views and components
 */
export class TimesheetConsistencyManager {
  /**
   * Get consistent weekly data for a user, ensuring no duplicates
   * @param {string} userId - User ID
   * @param {string|Date} weekStartDate - Week start date
   * @returns {Promise<Object>} Consistent weekly data
   */
  async getConsistentWeeklyData(userId, weekStartDate, options = {}) {
    try {
      const weekStartDay = options.weekStartDay || DEFAULT_WEEK_START_DAY;
      const weekStart = timesheetValidation.normalizeWeekStartDate(weekStartDate, weekStartDay);
      const weekEnd = timesheetValidation.getWeekEndDate(weekStart, weekStartDay);
      
      console.log(`[TimesheetConsistency] Getting consistent data for user ${userId}, week ${weekStart}`);
      
      // First, check for and resolve any duplicates
      const duplicates = await timesheetDeduplication.detectDuplicateEntries(userId, weekStart, { weekStartDay });
      if (duplicates.hasDuplicates) {
        console.log('[TimesheetConsistency] Duplicates detected, auto-resolving...');
        await timesheetDeduplication.cleanupDuplicates(userId, weekStart, {
          strategy: 'latest',
          dryRun: false,
          weekStartDay
        });
      }
      
      // Get clean data after deduplication
      const timesheetsCol = collection(db, 'timesheets');
      const weekQuery = query(
        timesheetsCol,
        where('userId', '==', userId),
        where('period', '>=', weekStart),
        where('period', '<=', weekEnd)
      );
      
      const snapshot = await getDocs(weekQuery);
      const weekDocs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      // Organize by date and calculate totals
      const dailyData = {};
      let weekTotals = {
        grossSec: 0,
        effectiveSec: 0,
        overtimeSec: 0
      };
      
      weekDocs.forEach(doc => {
        const date = doc.period;
        dailyData[date] = {
          id: doc.id,
          date,
          entries: doc.entries || [],
          totals: doc.totals || { grossSec: 0, effectiveSec: 0, overtimeSec: 0 },
          status: doc.status || 'draft',
          submittedAt: doc.submittedAt,
          auditTrail: doc.auditTrail || []
        };
        
        // Add to week totals
        weekTotals.grossSec += doc.totals?.grossSec || 0;
        weekTotals.effectiveSec += doc.totals?.effectiveSec || 0;
        weekTotals.overtimeSec += doc.totals?.overtimeSec || 0;
      });
      
      // Determine overall week status
      const statuses = weekDocs.map(doc => doc.status || 'draft');
      let weekStatus = 'draft';
      if (statuses.includes('approved')) weekStatus = 'approved';
      else if (statuses.includes('pending')) weekStatus = 'pending';
      else if (statuses.includes('rejected')) weekStatus = 'rejected';
      
      return {
        userId,
        weekStart,
        weekEnd,
        weekKey: timesheetValidation.generateWeekKey(userId, weekStart),
        dailyData,
        weekTotals,
        weekStatus,
        docCount: weekDocs.length,
        isConsistent: true, // Since we just cleaned up duplicates
        lastValidated: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('[TimesheetConsistency] Error getting consistent data:', error);
      throw new Error(`Failed to get consistent weekly data: ${error.message}`);
    }
  }
  
  /**
   * Validate data integrity across views for a user/week
   * @param {string} userId - User ID
   * @param {string|Date} weekStartDate - Week start date
   * @returns {Promise<Object>} Validation result
   */
  async validateDataConsistency(userId, weekStartDate, options = {}) {
    try {
      const weekStartDay = options.weekStartDay || DEFAULT_WEEK_START_DAY;
      const weekStart = timesheetValidation.normalizeWeekStartDate(weekStartDate, weekStartDay);
      
      console.log(`[TimesheetConsistency] Validating consistency for user ${userId}, week ${weekStart}`);
      
      const validation = {
        isConsistent: true,
        issues: [],
        warnings: [],
        weekStart,
        userId
      };
      
      // Check for duplicates
      const duplicates = await timesheetDeduplication.detectDuplicateEntries(userId, weekStart, { weekStartDay });
      if (duplicates.hasDuplicates) {
        validation.isConsistent = false;
        validation.issues.push({
          type: 'duplicates',
          severity: 'high',
          message: `Found ${duplicates.duplicateGroups.length} duplicate groups`,
          details: duplicates.duplicateGroups
        });
      }
      
      // Check for orphaned documents (documents without proper week metadata)
      const weekEnd = timesheetValidation.getWeekEndDate(weekStart, weekStartDay);
      const timesheetsCol = collection(db, 'timesheets');
      const weekQuery = query(
        timesheetsCol,
        where('userId', '==', userId),
        where('period', '>=', weekStart),
        where('period', '<=', weekEnd)
      );
      
      const snapshot = await getDocs(weekQuery);
      const weekDocs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // Check for missing metadata
      const missingMetadata = weekDocs.filter(doc => 
        !doc.weekStartDate || !doc.weekKey || !doc.auditTrail
      );
      
      if (missingMetadata.length > 0) {
        validation.isConsistent = false;
        validation.issues.push({
          type: 'missing_metadata',
          severity: 'medium',
          message: `${missingMetadata.length} documents missing deduplication metadata`,
          details: missingMetadata.map(doc => ({ id: doc.id, period: doc.period }))
        });
      }
      
      // Check for inconsistent week keys
      const expectedWeekKey = timesheetValidation.generateWeekKey(userId, weekStart);
      const inconsistentKeys = weekDocs.filter(doc => 
        doc.weekKey && doc.weekKey !== expectedWeekKey
      );
      
      if (inconsistentKeys.length > 0) {
        validation.warnings.push({
          type: 'inconsistent_keys',
          severity: 'low',
          message: `${inconsistentKeys.length} documents have inconsistent week keys`,
          details: inconsistentKeys.map(doc => ({ 
            id: doc.id, 
            period: doc.period, 
            currentKey: doc.weekKey, 
            expectedKey: expectedWeekKey 
          }))
        });
      }
      
      // Check for status inconsistencies
      const statuses = weekDocs.map(doc => doc.status || 'draft');
      const uniqueStatuses = [...new Set(statuses)];
      
      if (uniqueStatuses.length > 1 && uniqueStatuses.includes('approved')) {
        validation.warnings.push({
          type: 'mixed_statuses',
          severity: 'medium',
          message: 'Week has mixed statuses including approved documents',
          details: { statuses: uniqueStatuses, docCount: weekDocs.length }
        });
      }
      
      return validation;
      
    } catch (error) {
      console.error('[TimesheetConsistency] Error validating consistency:', error);
      throw new Error(`Failed to validate data consistency: ${error.message}`);
    }
  }
  
  /**
   * Repair inconsistent timesheet data automatically
   * @param {string} userId - User ID
   * @param {string|Date} weekStartDate - Week start date
   * @param {Object} options - Repair options
   * @returns {Promise<Object>} Repair result
   */
  async repairInconsistentData(userId, weekStartDate, options = {}) {
    try {
      const { dryRun = false, autoApprove = false, weekStartDay = DEFAULT_WEEK_START_DAY } = options;
      const weekStart = timesheetValidation.normalizeWeekStartDate(weekStartDate, weekStartDay);
      
      console.log(`[TimesheetConsistency] Repairing data for user ${userId}, week ${weekStart}, dryRun: ${dryRun}`);
      
      const validation = await this.validateDataConsistency(userId, weekStart, { weekStartDay });
      
      if (validation.isConsistent) {
        return {
          success: true,
          message: 'No repairs needed - data is consistent',
          repairsPerformed: []
        };
      }
      
      const repairsPerformed = [];
      
      if (dryRun) {
        return {
          success: true,
          message: 'Dry run completed',
          wouldRepair: validation.issues.length + validation.warnings.length,
          issues: validation.issues,
          warnings: validation.warnings
        };
      }
      
      // Repair duplicates
      const duplicateIssues = validation.issues.filter(issue => issue.type === 'duplicates');
      for (const issue of duplicateIssues) {
        try {
          const cleanupResult = await timesheetDeduplication.cleanupDuplicates(userId, weekStart, {
            strategy: 'latest',
            dryRun: false,
            weekStartDay
          });
          
          repairsPerformed.push({
            type: 'duplicate_cleanup',
            result: cleanupResult,
            success: true
          });
        } catch (error) {
          repairsPerformed.push({
            type: 'duplicate_cleanup',
            error: error.message,
            success: false
          });
        }
      }
      
      // Repair missing metadata
      const metadataIssues = validation.issues.filter(issue => issue.type === 'missing_metadata');
      for (const issue of metadataIssues) {
        try {
          const expectedWeekKey = timesheetValidation.generateWeekKey(userId, weekStart);
          
          for (const docInfo of issue.details) {
            const docRef = doc(db, 'timesheets', docInfo.id);
            await updateDoc(docRef, {
              weekStartDate: weekStart,
              weekKey: expectedWeekKey,
              lastModified: serverTimestamp(),
              auditTrail: [{
                action: 'metadata_repair',
                timestamp: serverTimestamp(),
                userId: 'system',
                details: { repairType: 'missing_metadata' }
              }]
            });
          }
          
          repairsPerformed.push({
            type: 'metadata_repair',
            count: issue.details.length,
            success: true
          });
        } catch (error) {
          repairsPerformed.push({
            type: 'metadata_repair',
            error: error.message,
            success: false
          });
        }
      }
      
      // Repair inconsistent week keys
      const keyWarnings = validation.warnings.filter(warning => warning.type === 'inconsistent_keys');
      for (const warning of keyWarnings) {
        try {
          for (const docInfo of warning.details) {
            const docRef = doc(db, 'timesheets', docInfo.id);
            await updateDoc(docRef, {
              weekKey: docInfo.expectedKey,
              lastModified: serverTimestamp(),
              auditTrail: [{
                action: 'key_repair',
                timestamp: serverTimestamp(),
                userId: 'system',
                details: { 
                  repairType: 'inconsistent_key',
                  oldKey: docInfo.currentKey,
                  newKey: docInfo.expectedKey
                }
              }]
            });
          }
          
          repairsPerformed.push({
            type: 'key_repair',
            count: warning.details.length,
            success: true
          });
        } catch (error) {
          repairsPerformed.push({
            type: 'key_repair',
            error: error.message,
            success: false
          });
        }
      }
      
      const successfulRepairs = repairsPerformed.filter(repair => repair.success);
      const failedRepairs = repairsPerformed.filter(repair => !repair.success);
      
      return {
        success: failedRepairs.length === 0,
        message: `Completed ${successfulRepairs.length} repairs, ${failedRepairs.length} failed`,
        repairsPerformed,
        successfulRepairs: successfulRepairs.length,
        failedRepairs: failedRepairs.length
      };
      
    } catch (error) {
      console.error('[TimesheetConsistency] Error repairing data:', error);
      throw new Error(`Failed to repair inconsistent data: ${error.message}`);
    }
  }
  
  /**
   * Get consistency statistics for a user across multiple weeks
   * @param {string} userId - User ID
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Consistency statistics
   */
  async getConsistencyStats(userId, options = {}) {
    try {
      const { weeksBack = 4, weekStartDay = DEFAULT_WEEK_START_DAY } = options;
      
      const stats = {
        userId,
        weeksAnalyzed: 0,
        consistentWeeks: 0,
        inconsistentWeeks: 0,
        totalIssues: 0,
        issueTypes: {},
        weeklyResults: []
      };
      
      // Analyze the last N weeks
      for (let i = 0; i < weeksBack; i++) {
        const weekDate = new Date();
        weekDate.setDate(weekDate.getDate() - (i * 7));
        const { start } = getWeekRange(weekDate, weekStartDay);
        const weekStart = formatISODate(start);
        
        try {
          const validation = await this.validateDataConsistency(userId, weekStart, { weekStartDay });
          stats.weeksAnalyzed++;
          
          if (validation.isConsistent) {
            stats.consistentWeeks++;
          } else {
            stats.inconsistentWeeks++;
            stats.totalIssues += validation.issues.length;
            
            // Count issue types
            validation.issues.forEach(issue => {
              stats.issueTypes[issue.type] = (stats.issueTypes[issue.type] || 0) + 1;
            });
          }
          
          stats.weeklyResults.push({
            weekStart,
            isConsistent: validation.isConsistent,
            issueCount: validation.issues.length,
            warningCount: validation.warnings.length
          });
          
        } catch (error) {
          console.warn(`[TimesheetConsistency] Failed to analyze week ${weekStart}:`, error);
          stats.weeklyResults.push({
            weekStart,
            error: error.message
          });
        }
      }
      
      stats.consistencyRate = stats.weeksAnalyzed > 0 ? 
        (stats.consistentWeeks / stats.weeksAnalyzed) * 100 : 0;
      
      return stats;
      
    } catch (error) {
      console.error('[TimesheetConsistency] Error getting consistency stats:', error);
      throw new Error(`Failed to get consistency stats: ${error.message}`);
    }
  }
}

// Export singleton instance
export const timesheetConsistency = new TimesheetConsistencyManager();

// Export individual functions for backward compatibility
export const getConsistentWeeklyData = (userId, weekStartDate, options) => 
  timesheetConsistency.getConsistentWeeklyData(userId, weekStartDate, options);

export const validateDataConsistency = (userId, weekStartDate, options) => 
  timesheetConsistency.validateDataConsistency(userId, weekStartDate, options);

export const repairInconsistentData = (userId, weekStartDate, options) => 
  timesheetConsistency.repairInconsistentData(userId, weekStartDate, options);