import hrApiClient from '../lib/hrApiClient';
import { getWeekRangeForDate as getWeekRange, formatISODate, DEFAULT_WEEK_START_DAY } from '../utils/weekStartUtils';

/**
 * Service for validating timesheet submissions and detecting duplicates
 */
export class TimesheetValidationService {
  /**
   * Check if a week submission already exists for a user
   * @param {string} userId - User ID
   * @param {string|Date} weekStartDate - Week start date
   * @returns {Promise<Object>} Validation result
   */
  async checkExistingWeekSubmission(userId, weekStartDate, options = {}) {
    try {
      const weekStart = await this.normalizeWeekStartDate(weekStartDate, options.weekStartDay);
      
      const { data } = await hrApiClient.get('/hr/timesheets', {
        params: {
          employeeId: userId,
          weekStart: weekStart,
          limit: 10
        }
      });

      const existingDocs = data.timesheets || [];

      if (existingDocs.length === 0) {
        return {
          hasSubmission: false,
          weekStart,
          status: null
        };
      }

      const statuses = existingDocs.map(ts => ts.status.toLowerCase());
      const hasApproved = statuses.includes('approved');
      const hasPending = statuses.includes('submitted');

      let weekStatus = 'draft';
      if (hasApproved) weekStatus = 'approved';
      else if (hasPending) weekStatus = 'submitted';

      return {
        hasSubmission: true,
        weekStart,
        existingDocs,
        status: weekStatus,
        docCount: existingDocs.length,
        canModify: !hasApproved,
        submittedAt: existingDocs.find(ts => ts.submittedAt)?.submittedAt || null
      };
    } catch (error) {
      console.error('[TimesheetValidation] Error checking existing submission:', error);
      return { hasSubmission: false, status: null, error: error.message };
    }
  }

  async validateWeekSubmission(userId, weekStartDate, options = {}) {
    const existing = await this.checkExistingWeekSubmission(userId, weekStartDate, options);
    const validation = {
      isValid: true,
      errors: [],
      warnings: [],
      weekStart: existing.weekStart,
      existing
    };

    if (existing.hasSubmission) {
      if (existing.status === 'approved') {
        validation.isValid = false;
        validation.errors.push({
          code: 'APPROVED_TIMESHEET_READONLY',
          message: 'Cannot modify an approved timesheet'
        });
      }
    }
    return validation;
  }

  async getWeekSubmissionStatus(userId, weekStartDate, options = {}) {
    const existing = await this.checkExistingWeekSubmission(userId, weekStartDate, options);
    if (!existing.hasSubmission) {
      return { status: 'not_submitted', canSubmit: true, canModify: true };
    }
    return {
      status: existing.status,
      canSubmit: existing.status === 'draft',
      canModify: existing.canModify,
      submittedAt: existing.submittedAt
    };
  }

  async normalizeWeekStartDate(weekStartDate, weekStartDay = DEFAULT_WEEK_START_DAY) {
    const date = new Date(weekStartDate);
    if (isNaN(date.getTime())) throw new Error('Invalid date');
    const { start } = getWeekRange(date, weekStartDay);
    return formatISODate(start);
  }
}

export const timesheetValidation = new TimesheetValidationService();
export const checkExistingWeekSubmission = (userId, weekStartDate, options) => timesheetValidation.checkExistingWeekSubmission(userId, weekStartDate, options);
export const validateWeekSubmission = (userId, weekStartDate, options) => timesheetValidation.validateWeekSubmission(userId, weekStartDate, options);
export const getWeekSubmissionStatus = (userId, weekStartDate, options) => timesheetValidation.getWeekSubmissionStatus(userId, weekStartDate, options);