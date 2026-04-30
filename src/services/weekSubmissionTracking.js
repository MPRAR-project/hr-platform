import { db } from '../firebase/client';
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs,
  updateDoc, 
  deleteDoc,
  query, 
  where, 
  serverTimestamp,
  writeBatch 
} from 'firebase/firestore';
import { timesheetValidation } from './timesheetValidation';
import { formatISODate } from './timesheets';

/**
 * Service for managing week-level timesheet submission tracking
 */
export class WeekSubmissionTrackingService {
  /**
   * Create a new week submission record
   * @param {Object} submissionData - Submission data
   * @returns {Promise<string>} Created submission ID
   */
  async createWeekSubmission(submissionData) {
    try {
      const {
        userId,
        weekStartDate,
        dailyDocumentIds = [],
        totalHours = 0,
        overtimeHours = 0,
        status = 'pending'
      } = submissionData;
      
      const weekStart = timesheetValidation.normalizeWeekStartDate(weekStartDate);
      const weekKey = timesheetValidation.generateWeekKey(userId, weekStart);
      
      console.log(`[WeekSubmissionTracking] Creating submission for ${userId}, week ${weekStart}`);
      
      const submissionRef = doc(collection(db, 'weekSubmissions'));
      const submissionData_clean = {
        userId,
        weekStartDate: weekStart,
        weekKey,
        status,
        submittedAt: serverTimestamp(),
        dailyDocumentIds,
        totalHours,
        overtimeHours,
        consolidatedFrom: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      
      await setDoc(submissionRef, submissionData_clean);
      
      console.log(`[WeekSubmissionTracking] Created submission ${submissionRef.id}`);
      return submissionRef.id;
      
    } catch (error) {
      console.error('[WeekSubmissionTracking] Error creating submission:', error);
      throw new Error(`Failed to create week submission: ${error.message}`);
    }
  }
  
  /**
   * Get week submission by user and week
   * @param {string} userId - User ID
   * @param {string|Date} weekStartDate - Week start date
   * @returns {Promise<Object|null>} Submission data or null
   */
  async getWeekSubmission(userId, weekStartDate) {
    try {
      const weekStart = timesheetValidation.normalizeWeekStartDate(weekStartDate);
      const weekKey = timesheetValidation.generateWeekKey(userId, weekStart);
      
      const submissionsCol = collection(db, 'weekSubmissions');
      const submissionQuery = query(
        submissionsCol,
        where('weekKey', '==', weekKey)
      );
      
      const snapshot = await getDocs(submissionQuery);
      
      if (snapshot.empty) {
        return null;
      }
      
      const doc = snapshot.docs[0];
      return {
        id: doc.id,
        ...doc.data()
      };
      
    } catch (error) {
      console.error('[WeekSubmissionTracking] Error getting submission:', error);
      throw new Error(`Failed to get week submission: ${error.message}`);
    }
  }
  
  /**
   * Update week submission status and metadata
   * @param {string} submissionId - Submission ID
   * @param {Object} updates - Updates to apply
   * @returns {Promise<void>}
   */
  async updateWeekSubmission(submissionId, updates) {
    try {
      console.log(`[WeekSubmissionTracking] Updating submission ${submissionId}`, updates);
      
      const submissionRef = doc(db, 'weekSubmissions', submissionId);
      const updateData = {
        ...updates,
        updatedAt: serverTimestamp()
      };
      
      await updateDoc(submissionRef, updateData);
      
    } catch (error) {
      console.error('[WeekSubmissionTracking] Error updating submission:', error);
      throw new Error(`Failed to update week submission: ${error.message}`);
    }
  }
  
  /**
   * Delete week submission record
   * @param {string} submissionId - Submission ID
   * @returns {Promise<void>}
   */
  async deleteWeekSubmission(submissionId) {
    try {
      console.log(`[WeekSubmissionTracking] Deleting submission ${submissionId}`);
      
      const submissionRef = doc(db, 'weekSubmissions', submissionId);
      await deleteDoc(submissionRef);
      
    } catch (error) {
      console.error('[WeekSubmissionTracking] Error deleting submission:', error);
      throw new Error(`Failed to delete week submission: ${error.message}`);
    }
  }
  
  /**
   * Get all submissions for a user within a date range
   * @param {string} userId - User ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Array of submissions
   */
  async getUserSubmissions(userId, options = {}) {
    try {
      const { 
        startDate = null, 
        endDate = null, 
        status = null,
        limit = 50 
      } = options;
      
      console.log(`[WeekSubmissionTracking] Getting submissions for user ${userId}`);
      
      let submissionQuery = query(
        collection(db, 'weekSubmissions'),
        where('userId', '==', userId)
      );
      
      // Add date range filters if provided
      if (startDate) {
        const startDateStr = typeof startDate === 'string' ? startDate : formatISODate(startDate);
        submissionQuery = query(submissionQuery, where('weekStartDate', '>=', startDateStr));
      }
      
      if (endDate) {
        const endDateStr = typeof endDate === 'string' ? endDate : formatISODate(endDate);
        submissionQuery = query(submissionQuery, where('weekStartDate', '<=', endDateStr));
      }
      
      if (status) {
        submissionQuery = query(submissionQuery, where('status', '==', status));
      }
      
      const snapshot = await getDocs(submissionQuery);
      const submissions = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      // Sort by week start date (most recent first) and apply limit
      submissions.sort((a, b) => b.weekStartDate.localeCompare(a.weekStartDate));
      
      return submissions.slice(0, limit);
      
    } catch (error) {
      console.error('[WeekSubmissionTracking] Error getting user submissions:', error);
      throw new Error(`Failed to get user submissions: ${error.message}`);
    }
  }
  
  /**
   * Sync week submission with daily timesheet documents
   * @param {string} submissionId - Submission ID
   * @returns {Promise<Object>} Sync result
   */
  async syncWithDailyDocuments(submissionId) {
    try {
      console.log(`[WeekSubmissionTracking] Syncing submission ${submissionId} with daily docs`);
      
      const submissionRef = doc(db, 'weekSubmissions', submissionId);
      const submissionSnap = await getDoc(submissionRef);
      
      if (!submissionSnap.exists()) {
        throw new Error('Week submission not found');
      }
      
      const submission = submissionSnap.data();
      const { userId, weekStartDate } = submission;
      
      // Get all daily documents for this week
      const weekEnd = timesheetValidation.getWeekEndDate(weekStartDate);
      const timesheetsCol = collection(db, 'timesheets');
      const weekQuery = query(
        timesheetsCol,
        where('userId', '==', userId),
        where('period', '>=', weekStartDate),
        where('period', '<=', weekEnd)
      );
      
      const snapshot = await getDocs(weekQuery);
      const dailyDocs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      // Calculate totals
      let totalGrossSec = 0;
      let totalEffectiveSec = 0;
      let totalOvertimeSec = 0;
      
      dailyDocs.forEach(doc => {
        totalGrossSec += doc.totals?.grossSec || 0;
        totalEffectiveSec += doc.totals?.effectiveSec || 0;
        totalOvertimeSec += doc.totals?.overtimeSec || 0;
      });
      
      // Convert to hours
      const totalHours = Math.round((totalEffectiveSec / 3600) * 100) / 100;
      const overtimeHours = Math.round((totalOvertimeSec / 3600) * 100) / 100;
      
      // Determine overall status
      const statuses = dailyDocs.map(doc => doc.status || 'draft');
      let overallStatus = 'draft';
      if (statuses.every(status => status === 'approved')) {
        overallStatus = 'approved';
      } else if (statuses.some(status => status === 'pending')) {
        overallStatus = 'pending';
      } else if (statuses.some(status => status === 'rejected')) {
        overallStatus = 'rejected';
      }
      
      // Update submission
      await updateDoc(submissionRef, {
        dailyDocumentIds: dailyDocs.map(doc => doc.id),
        totalHours,
        overtimeHours,
        status: overallStatus,
        lastSyncedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      
      return {
        success: true,
        dailyDocCount: dailyDocs.length,
        totalHours,
        overtimeHours,
        status: overallStatus
      };
      
    } catch (error) {
      console.error('[WeekSubmissionTracking] Error syncing with daily docs:', error);
      throw new Error(`Failed to sync with daily documents: ${error.message}`);
    }
  }
  
  /**
   * Consolidate multiple submissions into one (for duplicate resolution)
   * @param {Array} submissionIds - Array of submission IDs to consolidate
   * @param {string} keepSubmissionId - ID of submission to keep
   * @returns {Promise<Object>} Consolidation result
   */
  async consolidateSubmissions(submissionIds, keepSubmissionId) {
    try {
      console.log(`[WeekSubmissionTracking] Consolidating submissions`, { submissionIds, keepSubmissionId });
      
      if (!submissionIds.includes(keepSubmissionId)) {
        throw new Error('Keep submission ID must be in the list of submissions to consolidate');
      }
      
      const batch = writeBatch(db);
      
      // Get all submissions
      const submissions = [];
      for (const id of submissionIds) {
        const submissionSnap = await getDoc(doc(db, 'weekSubmissions', id));
        if (submissionSnap.exists()) {
          submissions.push({ id, ...submissionSnap.data() });
        }
      }
      
      const keepSubmission = submissions.find(s => s.id === keepSubmissionId);
      const otherSubmissions = submissions.filter(s => s.id !== keepSubmissionId);
      
      if (!keepSubmission) {
        throw new Error('Keep submission not found');
      }
      
      // Consolidate data
      const allDailyDocIds = new Set(keepSubmission.dailyDocumentIds || []);
      let totalHours = keepSubmission.totalHours || 0;
      let overtimeHours = keepSubmission.overtimeHours || 0;
      const consolidatedFrom = [...(keepSubmission.consolidatedFrom || [])];
      
      otherSubmissions.forEach(submission => {
        // Collect all daily document IDs
        (submission.dailyDocumentIds || []).forEach(id => allDailyDocIds.add(id));
        
        // Sum hours (though this might not be accurate if there are overlaps)
        totalHours += submission.totalHours || 0;
        overtimeHours += submission.overtimeHours || 0;
        
        // Track what was consolidated
        consolidatedFrom.push(submission.id);
      });
      
      // Update the keep submission
      const keepSubmissionRef = doc(db, 'weekSubmissions', keepSubmissionId);
      batch.update(keepSubmissionRef, {
        dailyDocumentIds: Array.from(allDailyDocIds),
        totalHours,
        overtimeHours,
        consolidatedFrom,
        consolidatedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      
      // Delete other submissions
      otherSubmissions.forEach(submission => {
        const submissionRef = doc(db, 'weekSubmissions', submission.id);
        batch.delete(submissionRef);
      });
      
      await batch.commit();
      
      return {
        success: true,
        keptSubmissionId: keepSubmissionId,
        deletedSubmissionIds: otherSubmissions.map(s => s.id),
        consolidatedDailyDocs: Array.from(allDailyDocIds).length,
        totalHours,
        overtimeHours
      };
      
    } catch (error) {
      console.error('[WeekSubmissionTracking] Error consolidating submissions:', error);
      throw new Error(`Failed to consolidate submissions: ${error.message}`);
    }
  }
  
  /**
   * Get submission statistics for reporting
   * @param {Object} options - Query options
   * @returns {Promise<Object>} Statistics
   */
  async getSubmissionStats(options = {}) {
    try {
      const { 
        userId = null,
        startDate = null,
        endDate = null,
        groupBy = 'status' // 'status', 'user', 'week'
      } = options;
      
      console.log(`[WeekSubmissionTracking] Getting submission stats`, options);
      
      let submissionQuery = collection(db, 'weekSubmissions');
      
      if (userId) {
        submissionQuery = query(submissionQuery, where('userId', '==', userId));
      }
      
      if (startDate) {
        const startDateStr = typeof startDate === 'string' ? startDate : formatISODate(startDate);
        submissionQuery = query(submissionQuery, where('weekStartDate', '>=', startDateStr));
      }
      
      if (endDate) {
        const endDateStr = typeof endDate === 'string' ? endDate : formatISODate(endDate);
        submissionQuery = query(submissionQuery, where('weekStartDate', '<=', endDateStr));
      }
      
      const snapshot = await getDocs(submissionQuery);
      const submissions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      const stats = {
        total: submissions.length,
        totalHours: submissions.reduce((sum, s) => sum + (s.totalHours || 0), 0),
        totalOvertimeHours: submissions.reduce((sum, s) => sum + (s.overtimeHours || 0), 0),
        groupedBy: {}
      };
      
      // Group by specified field
      submissions.forEach(submission => {
        let groupKey;
        switch (groupBy) {
          case 'status':
            groupKey = submission.status || 'unknown';
            break;
          case 'user':
            groupKey = submission.userId || 'unknown';
            break;
          case 'week':
            groupKey = submission.weekStartDate || 'unknown';
            break;
          default:
            groupKey = 'all';
        }
        
        if (!stats.groupedBy[groupKey]) {
          stats.groupedBy[groupKey] = {
            count: 0,
            totalHours: 0,
            overtimeHours: 0
          };
        }
        
        stats.groupedBy[groupKey].count++;
        stats.groupedBy[groupKey].totalHours += submission.totalHours || 0;
        stats.groupedBy[groupKey].overtimeHours += submission.overtimeHours || 0;
      });
      
      return stats;
      
    } catch (error) {
      console.error('[WeekSubmissionTracking] Error getting stats:', error);
      throw new Error(`Failed to get submission stats: ${error.message}`);
    }
  }
}

// Export singleton instance
export const weekSubmissionTracking = new WeekSubmissionTrackingService();

// Export individual functions for backward compatibility
export const createWeekSubmission = (submissionData) => 
  weekSubmissionTracking.createWeekSubmission(submissionData);

export const getWeekSubmission = (userId, weekStartDate) => 
  weekSubmissionTracking.getWeekSubmission(userId, weekStartDate);

export const updateWeekSubmission = (submissionId, updates) => 
  weekSubmissionTracking.updateWeekSubmission(submissionId, updates);

export const getUserSubmissions = (userId, options) => 
  weekSubmissionTracking.getUserSubmissions(userId, options);