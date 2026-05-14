import hrApiClient from '../lib/hrApiClient';

/**
 * Week Submission Tracking Service (Phase 4 — REST Migration)
 * 
 * Maps legacy week-level tracking to the new HrTimesheet model in the REST API.
 * In the new architecture, a Timesheet is the week-level submission record.
 */
export class WeekSubmissionTrackingService {
  /**
   * Create a new week submission record (Maps to get-or-create timesheet)
   */
  async createWeekSubmission(submissionData) {
    try {
      const { userId, weekStartDate } = submissionData;
      
      const { data } = await hrApiClient.post('/hr/timesheets/get-or-create', {
        employeeId: userId,
        weekStart: weekStartDate
      });
      
      return data.id;
    } catch (error) {
      console.error('[WeekSubmissionTracking] Error creating submission:', error);
      throw error;
    }
  }
  
  /**
   * Get week submission by user and week
   */
  async getWeekSubmission(userId, weekStartDate) {
    try {
      const { data } = await hrApiClient.get('/hr/timesheets', {
        params: { employeeId: userId, weekStart: weekStartDate }
      });
      
      const ts = data.timesheets?.[0] || data?.[0] || null;
      if (!ts) return null;

      // Normalize to match legacy expectation
      return {
        id: ts.id,
        ...ts,
        totalHours: ts.totalHours || 0,
        status: ts.status
      };
    } catch (error) {
      console.error('[WeekSubmissionTracking] Error getting submission:', error);
      throw error;
    }
  }
  
  /**
   * Update week submission status and metadata (Maps to timesheet update/submit/approve/reject)
   */
  async updateWeekSubmission(submissionId, updates) {
    try {
      if (updates.status === 'submitted') {
        await hrApiClient.post(`/hr/timesheets/${submissionId}/submit`);
      } else if (updates.status === 'approved') {
        await hrApiClient.post(`/hr/timesheets/${submissionId}/approve`);
      } else if (updates.status === 'rejected') {
        await hrApiClient.post(`/hr/timesheets/${submissionId}/reject`, { reason: updates.rejectedReason });
      } else {
        // Generic update not explicitly supported via simple post, but we can add a PUT if needed
        // For now, these are the primary status transitions
      }
    } catch (error) {
      console.error('[WeekSubmissionTracking] Error updating submission:', error);
      throw error;
    }
  }
  
  /**
   * Get all submissions for a user within a date range
   */
  async getUserSubmissions(userId, options = {}) {
    try {
      const { startDate, endDate, status, limit = 50 } = options;
      
      const { data } = await hrApiClient.get('/hr/timesheets', {
        params: { 
          employeeId: userId, 
          weekStart: startDate, 
          weekEnd: endDate, 
          status, 
          limit 
        }
      });
      
      return data.timesheets || data || [];
    } catch (error) {
      console.error('[WeekSubmissionTracking] Error getting user submissions:', error);
      throw error;
    }
  }
  
  /**
   * Sync week submission with daily timesheet documents
   * In REST API, this is done automatically on the backend during recalculation.
   */
  async syncWithDailyDocuments(submissionId) {
    // Recalculate totals on backend
    const { data } = await hrApiClient.get(`/hr/timesheets/${submissionId}`);
    return {
      success: true,
      totalHours: data.totalHours,
      status: data.status
    };
  }
}

export const weekSubmissionTracking = new WeekSubmissionTrackingService();

export const createWeekSubmission = (submissionData) => 
  weekSubmissionTracking.createWeekSubmission(submissionData);

export const getWeekSubmission = (userId, weekStartDate) => 
  weekSubmissionTracking.getWeekSubmission(userId, weekStartDate);

export const updateWeekSubmission = (submissionId, updates) => 
  weekSubmissionTracking.updateWeekSubmission(submissionId, updates);

export const getUserSubmissions = (userId, options) => 
  weekSubmissionTracking.getUserSubmissions(userId, options);