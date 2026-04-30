import { db } from '../firebase/client';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { timesheetValidation } from './timesheetValidation';
import { formatISODate } from '../utils/weekStartUtils';

/**
 * Service for detecting and resolving duplicate timesheet entries
 */
export class TimesheetDeduplicationService {
  /**
   * Detect duplicate entries for a user/week combination
   * @param {string} userId - User ID
   * @param {string|Date} weekStartDate - Week start date
   * @returns {Promise<Object>} Duplicate detection result
   */
  async detectDuplicateEntries(userId, weekStartDate, options = {}) {
    try {
      const weekStartDay = options.weekStartDay;
      const weekStart = await timesheetValidation.normalizeWeekStartDate(weekStartDate, weekStartDay);
      const weekEnd = await timesheetValidation.getWeekEndDate(weekStart, weekStartDay);

      console.log(`[TimesheetDeduplication] Detecting duplicates for user ${userId}, week ${weekStart}`);

      // Get all timesheet documents for this user/week
      const { getOrderedWeekDates } = await import('../utils/weekStartUtils');
      const dates = getOrderedWeekDates(weekStart, weekStartDay);

      const timesheetsCol = collection(db, 'timesheets');
      // Use 'in' query instead of range to avoid requiring complex composite indexes
      const weekQuery = query(
        timesheetsCol,
        where('userId', '==', userId),
        where('period', 'in', dates)
      );

      const snapshot = await getDocs(weekQuery);
      const allDocs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      if (allDocs.length <= 7) {
        // Normal case: one document per day or less
        return {
          hasDuplicates: false,
          weekStart,
          weekEnd,
          totalDocs: allDocs.length,
          duplicateGroups: [],
          allDocs
        };
      }

      // Group documents by date to find duplicates
      const docsByDate = {};
      allDocs.forEach(doc => {
        const date = doc.period;
        if (!docsByDate[date]) {
          docsByDate[date] = [];
        }
        docsByDate[date].push(doc);
      });

      // Find dates with multiple documents
      const duplicateGroups = [];
      Object.entries(docsByDate).forEach(([date, docs]) => {
        if (docs.length > 1) {
          duplicateGroups.push({
            date,
            docs,
            count: docs.length
          });
        }
      });

      return {
        hasDuplicates: duplicateGroups.length > 0,
        weekStart,
        weekEnd,
        totalDocs: allDocs.length,
        duplicateGroups,
        allDocs
      };

    } catch (error) {
      console.error('[TimesheetDeduplication] Error detecting duplicates:', error);
      throw new Error(`Failed to detect duplicates: ${error.message}`);
    }
  }

  /**
   * Merge duplicate timesheet entries using specified strategy
   * @param {Array} duplicateEntries - Array of duplicate documents
   * @param {string} mergeStrategy - Strategy: 'latest', 'sum', 'manual'
   * @returns {Promise<Object>} Merge result
   */
  async mergeDuplicateEntries(duplicateEntries, mergeStrategy = 'latest') {
    try {
      if (!duplicateEntries || duplicateEntries.length < 2) {
        throw new Error('At least 2 entries required for merging');
      }

      console.log(`[TimesheetDeduplication] Merging ${duplicateEntries.length} entries using ${mergeStrategy} strategy`);

      let mergedData;
      let keepDoc;
      let deleteDocIds;

      switch (mergeStrategy) {
        case 'latest':
          mergedData = await this.mergeByLatest(duplicateEntries);
          break;
        case 'sum':
          mergedData = await this.mergeBySum(duplicateEntries);
          break;
        default:
          throw new Error(`Unsupported merge strategy: ${mergeStrategy}`);
      }

      keepDoc = mergedData.keepDoc;
      deleteDocIds = mergedData.deleteDocIds;

      // Perform the merge operation in a batch
      const batch = writeBatch(db);

      // Update the document we're keeping
      const keepDocRef = doc(db, 'timesheets', keepDoc.id);
      batch.update(keepDocRef, {
        ...keepDoc.data,
        isConsolidated: true,
        consolidatedFrom: deleteDocIds,
        lastModified: serverTimestamp(),
        auditTrail: [
          ...(keepDoc.auditTrail || []),
          {
            action: 'merged',
            timestamp: new Date(),
            details: {
              strategy: mergeStrategy,
              mergedDocIds: deleteDocIds,
              originalCount: duplicateEntries.length
            }
          }
        ]
      });

      // Delete the duplicate documents
      deleteDocIds.forEach(docId => {
        const deleteDocRef = doc(db, 'timesheets', docId);
        batch.delete(deleteDocRef);
      });

      await batch.commit();

      return {
        success: true,
        mergedDocId: keepDoc.id,
        deletedDocIds: deleteDocIds,
        strategy: mergeStrategy,
        originalCount: duplicateEntries.length
      };

    } catch (error) {
      console.error('[TimesheetDeduplication] Error merging duplicates:', error);
      throw new Error(`Failed to merge duplicates: ${error.message}`);
    }
  }

  /**
   * Clean up orphaned or duplicate documents for a user/week
   * @param {string} userId - User ID
   * @param {string|Date} weekStartDate - Week start date
   * @param {Object} options - Cleanup options
   * @returns {Promise<Object>} Cleanup result
   */
  async cleanupDuplicates(userId, weekStartDate, options = {}) {
    try {
      const { dryRun = false, strategy = 'latest', weekStartDay = undefined } = options;

      const duplicates = await this.detectDuplicateEntries(userId, weekStartDate, { weekStartDay });

      if (!duplicates.hasDuplicates) {
        return {
          success: true,
          message: 'No duplicates found',
          cleaned: 0,
          duplicates: duplicates
        };
      }

      console.log(`[TimesheetDeduplication] Cleaning up ${duplicates.duplicateGroups.length} duplicate groups`);

      if (dryRun) {
        return {
          success: true,
          message: 'Dry run completed',
          wouldClean: duplicates.duplicateGroups.length,
          duplicates: duplicates
        };
      }

      let totalCleaned = 0;
      const cleanupResults = [];

      // Process each group of duplicates
      for (const group of duplicates.duplicateGroups) {
        try {
          const mergeResult = await this.mergeDuplicateEntries(group.docs, strategy);
          cleanupResults.push({
            date: group.date,
            result: mergeResult
          });
          totalCleaned += mergeResult.originalCount - 1; // -1 because we keep one
        } catch (error) {
          console.error(`[TimesheetDeduplication] Failed to cleanup group for ${group.date}:`, error);
          cleanupResults.push({
            date: group.date,
            error: error.message
          });
        }
      }

      return {
        success: true,
        message: `Cleaned up ${totalCleaned} duplicate entries`,
        cleaned: totalCleaned,
        results: cleanupResults,
        duplicates: duplicates
      };

    } catch (error) {
      console.error('[TimesheetDeduplication] Error during cleanup:', error);
      throw new Error(`Failed to cleanup duplicates: ${error.message}`);
    }
  }

  /**
   * Merge strategy: Keep the latest document based on updatedAt timestamp
   * @param {Array} entries - Duplicate entries
   * @returns {Object} Merge decision
   */
  async mergeByLatest(entries) {
    // Sort by updatedAt timestamp (most recent first)
    const sorted = entries.sort((a, b) => {
      const aTime = a.updatedAt?.toDate?.()?.getTime() || 0;
      const bTime = b.updatedAt?.toDate?.()?.getTime() || 0;
      return bTime - aTime;
    });

    const keepDoc = sorted[0];
    const deleteDocIds = sorted.slice(1).map(doc => doc.id);

    return {
      keepDoc: {
        id: keepDoc.id,
        data: keepDoc,
        auditTrail: keepDoc.auditTrail || []
      },
      deleteDocIds
    };
  }

  /**
   * Merge strategy: Sum all time values and keep in one document
   * @param {Array} entries - Duplicate entries
   * @returns {Object} Merge decision
   */
  async mergeBySum(entries) {
    // Use the most recent document as base
    const latest = await this.mergeByLatest(entries);
    const keepDoc = latest.keepDoc;

    // Sum all the time values
    let totalGrossSec = 0;
    let totalEffectiveSec = 0;
    let totalOvertimeSec = 0;
    const allSessionIds = new Set();
    const allEntries = [];

    entries.forEach(doc => {
      // Sum totals
      totalGrossSec += doc.totals?.grossSec || 0;
      totalEffectiveSec += doc.totals?.effectiveSec || 0;
      totalOvertimeSec += doc.totals?.overtimeSec || 0;

      // Collect all entries and session IDs
      if (doc.entries && Array.isArray(doc.entries)) {
        doc.entries.forEach(entry => {
          allEntries.push(entry);
          if (entry.sessionIds && Array.isArray(entry.sessionIds)) {
            entry.sessionIds.forEach(id => allSessionIds.add(id));
          }
        });
      }
    });

    // Create consolidated entry
    const consolidatedEntry = {
      date: keepDoc.data.period,
      grossSec: totalGrossSec,
      effectiveSec: totalEffectiveSec,
      overtimeSec: totalOvertimeSec,
      source: 'consolidated',
      sessionIds: Array.from(allSessionIds),
      notes: 'Consolidated from duplicate entries'
    };

    // Update the keep document with summed values
    keepDoc.data = {
      ...keepDoc.data,
      entries: [consolidatedEntry],
      totals: {
        grossSec: totalGrossSec,
        effectiveSec: totalEffectiveSec,
        overtimeSec: totalOvertimeSec
      }
    };

    return {
      keepDoc,
      deleteDocIds: latest.deleteDocIds
    };
  }

  /**
   * Get deduplication statistics for a user
   * @param {string} userId - User ID
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Statistics
   */
  async getDeduplicationStats(userId, options = {}) {
    try {
      const { daysBack = 30 } = options;

      const since = new Date();
      since.setDate(since.getDate() - daysBack);
      const sinceStr = formatISODate(since);

      const timesheetsCol = collection(db, 'timesheets');
      const userQuery = query(
        timesheetsCol,
        where('userId', '==', userId),
        where('period', '>=', sinceStr)
      );

      const snapshot = await getDocs(userQuery);
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Group by week to find potential duplicates
      const weekGroups = {};
      docs.forEach(doc => {
        const weekStart = timesheetValidation.normalizeWeekStartDate(doc.period);
        if (!weekGroups[weekStart]) {
          weekGroups[weekStart] = [];
        }
        weekGroups[weekStart].push(doc);
      });

      let totalWeeks = 0;
      let weeksWithDuplicates = 0;
      let totalDuplicateDocs = 0;

      Object.values(weekGroups).forEach(weekDocs => {
        totalWeeks++;
        if (weekDocs.length > 7) {
          weeksWithDuplicates++;
          totalDuplicateDocs += weekDocs.length - 7; // Excess beyond 7 days
        }
      });

      return {
        userId,
        daysBack,
        totalWeeks,
        weeksWithDuplicates,
        totalDuplicateDocs,
        duplicateRate: totalWeeks > 0 ? (weeksWithDuplicates / totalWeeks) * 100 : 0,
        weekGroups
      };

    } catch (error) {
      console.error('[TimesheetDeduplication] Error getting stats:', error);
      throw new Error(`Failed to get deduplication stats: ${error.message}`);
    }
  }
}

// Export singleton instance
export const timesheetDeduplication = new TimesheetDeduplicationService();

// Export individual functions for backward compatibility
export const detectDuplicateEntries = (userId, weekStartDate, options) =>
  timesheetDeduplication.detectDuplicateEntries(userId, weekStartDate, options);

export const mergeDuplicateEntries = (duplicateEntries, mergeStrategy) =>
  timesheetDeduplication.mergeDuplicateEntries(duplicateEntries, mergeStrategy);

export const cleanupDuplicates = (userId, weekStartDate, options) =>
  timesheetDeduplication.cleanupDuplicates(userId, weekStartDate, options); 