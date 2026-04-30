import { db } from '../firebase/client';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { getWeekRangeForDate as getWeekRange, formatISODate } from '../utils/weekStartUtils';
import { DEFAULT_WEEK_START_DAY } from '../utils/weekStartUtils';

/**
 * Service for validating timesheet submissions and detecting duplicates
 */
export class TimesheetValidationService {
  /**
   * Check if a week submission already exists for a user
   * @param {string} userId - User ID
   * @param {string|Date} weekStartDate - Week start date (Monday)
   * @returns {Promise<Object>} Validation result with submission details
   */
  async checkExistingWeekSubmission(userId, weekStartDate, options = {}) {
    try {
      const { STORAGE_ANCHOR_DAY, isMondayAnchorEnabled } = await import('../utils/weekStartUtils');
      const { getUserWeekContext } = await import('./timesheets');

      const context = options.companyIdPath ? { companyIdPath: options.companyIdPath } : await getUserWeekContext(userId);
      const companyIdPath = context.companyIdPath;
      const weekStartDay = options.weekStartDay || context.weekStartDay || DEFAULT_WEEK_START_DAY;
      const effectiveAnchor = isMondayAnchorEnabled(companyIdPath) ? STORAGE_ANCHOR_DAY : weekStartDay;

      const weekStart = await this.normalizeWeekStartDate(weekStartDate, effectiveAnchor, companyIdPath);
      const weekEnd = this.getWeekEndDate(weekStart, effectiveAnchor);


      const { getOrderedWeekDates } = await import('../utils/weekStartUtils');
      const dates = getOrderedWeekDates(weekStart, effectiveAnchor);

      console.log(`[TimesheetValidation] Checking existing submission for user ${userId}, weekStart: ${weekStart}, weekEnd: ${weekEnd}, effectiveAnchor: ${effectiveAnchor}, dates:`, dates);

      // Query for any timesheet documents in this week range
      const timesheetsCol = collection(db, 'timesheets');
      // Use 'in' query instead of range to avoid requiring complex composite indexes
      const weekQuery = query(
        timesheetsCol,
        where('userId', '==', userId),
        where('period', 'in', dates)
      );

      const snapshot = await getDocs(weekQuery);
      const existingDocs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      console.log(`[TimesheetValidation] Found ${existingDocs.length} existing documents for dates:`,
        existingDocs.map(d => ({ id: d.id, period: d.period, status: d.status }))
      );

      if (existingDocs.length === 0) {
        return {
          hasSubmission: false,
          weekStart,
          weekEnd,
          existingDocs: [],
          status: null
        };
      }

      // Analyze existing submissions
      const statuses = existingDocs.map(doc => (doc.status || 'draft').toLowerCase());
      const hasApproved = statuses.includes('approved');
      const hasPending = statuses.includes('pending');
      const hasDraft = statuses.includes('draft');

      // Determine overall week status
      let weekStatus = 'draft';
      if (hasApproved) weekStatus = 'approved';
      else if (hasPending) weekStatus = 'pending';

      return {
        hasSubmission: true,
        weekStart,
        weekEnd,
        existingDocs,
        status: weekStatus,
        docCount: existingDocs.length,
        canModify: !hasApproved, // Can't modify if any day is approved
        submittedAt: existingDocs.find(doc => doc.submittedAt)?.submittedAt || null
      };

    } catch (error) {
      console.error('[TimesheetValidation] Error checking existing submission:', error);
      throw new Error(`Failed to check existing submission: ${error.message}`);
    }
  }

  /**
   * Validate submission constraints for a week
   * @param {string} userId - User ID
   * @param {string|Date} weekStartDate - Week start date
   * @param {Object} options - Validation options
   * @returns {Promise<Object>} Validation result
   */
  async validateWeekSubmission(userId, weekStartDate, options = {}) {
    try {
      const {
        allowUpdateExisting = true,
        requireTimeEntries = false,
        checkApprovalStatus = true
      } = options;

      const { getUserWeekContext } = await import('./timesheets');
      const context = await getUserWeekContext(userId);
      const companyIdPath = context.companyIdPath;
      const weekStartDay = options.weekStartDay || context.weekStartDay || DEFAULT_WEEK_START_DAY;

      const weekStart = await this.normalizeWeekStartDate(weekStartDate, weekStartDay, companyIdPath);
      const existing = await this.checkExistingWeekSubmission(userId, weekStart, { weekStartDay, companyIdPath });


      const validation = {
        isValid: true,
        errors: [],
        warnings: [],
        weekStart,
        existing
      };

      // Check if submission already exists
      if (existing.hasSubmission) {
        if (existing.status === 'approved' && checkApprovalStatus) {
          validation.isValid = false;
          validation.errors.push({
            code: 'APPROVED_TIMESHEET_READONLY',
            message: 'Cannot modify an approved timesheet',
            field: 'weekStart'
          });
        } else if (!allowUpdateExisting) {
          validation.isValid = false;
          validation.errors.push({
            code: 'DUPLICATE_WEEK_SUBMISSION',
            message: 'A timesheet for this week has already been submitted',
            field: 'weekStart'
          });
        } else {
          validation.warnings.push({
            code: 'EXISTING_SUBMISSION_UPDATE',
            message: 'This will update an existing timesheet submission',
            field: 'weekStart'
          });
        }
      }

      // Check for future date submissions (optional business rule)
      const today = new Date();
      const weekStartObj = new Date(weekStart);
      const daysDiff = Math.ceil((weekStartObj - today) / (1000 * 60 * 60 * 24));

      if (daysDiff > 7) {
        validation.warnings.push({
          code: 'FUTURE_WEEK_SUBMISSION',
          message: 'Submitting timesheet for a future week',
          field: 'weekStart'
        });
      }

      return validation;

    } catch (error) {
      console.error('[TimesheetValidation] Error validating submission:', error);
      throw new Error(`Failed to validate submission: ${error.message}`);
    }
  }

  /**
   * Get the current status of a week submission
   * @param {string} userId - User ID
   * @param {string|Date} weekStartDate - Week start date
   * @returns {Promise<Object>} Status information
   */
  async getWeekSubmissionStatus(userId, weekStartDate, options = {}) {
    try {
      const weekStartDay = options.weekStartDay || DEFAULT_WEEK_START_DAY;
      const existing = await this.checkExistingWeekSubmission(userId, weekStartDate, { weekStartDay });

      if (!existing.hasSubmission) {
        return {
          status: 'not_submitted',
          weekStart: existing.weekStart,
          weekEnd: existing.weekEnd,
          canSubmit: true,
          canModify: true
        };
      }

      return {
        status: existing.status,
        weekStart: existing.weekStart,
        weekEnd: existing.weekEnd,
        docCount: existing.docCount,
        canSubmit: existing.status === 'draft',
        canModify: existing.canModify,
        submittedAt: existing.submittedAt
      };

    } catch (error) {
      console.error('[TimesheetValidation] Error getting submission status:', error);
      throw new Error(`Failed to get submission status: ${error.message}`);
    }
  }

  /**
   * Normalize week start date to Monday in YYYY-MM-DD format
   * @param {string|Date} weekStartDate - Input date
   * @returns {string} Normalized week start date
   */
  async normalizeWeekStartDate(weekStartDate, weekStartDay = DEFAULT_WEEK_START_DAY, companyIdPath = null) {
    let date;

    if (typeof weekStartDate === 'string') {
      date = new Date(weekStartDate);
    } else if (weekStartDate instanceof Date) {
      date = new Date(weekStartDate);
    } else {
      throw new Error('Invalid weekStartDate format');
    }

    if (isNaN(date.getTime())) {
      throw new Error('Invalid date provided');
    }

    const { STORAGE_ANCHOR_DAY, isMondayAnchorEnabled } = await import('../utils/weekStartUtils');
    const effectiveAnchor = isMondayAnchorEnabled(companyIdPath) ? STORAGE_ANCHOR_DAY : weekStartDay;

    // Get the Monday (or anchor) of this week
    const { start } = getWeekRange(date, effectiveAnchor);
    return formatISODate(start);
  }


  /**
   * Get week end date (Sunday) from week start date
   * @param {string} weekStart - Week start date in YYYY-MM-DD format
   * @returns {string} Week end date in YYYY-MM-DD format
   */
  getWeekEndDate(weekStart, _weekStartDay = DEFAULT_WEEK_START_DAY) {
    const startDate = new Date(weekStart);
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);
    return formatISODate(endDate);
  }

  /**
   * Generate a composite key for user + week combination
   * @param {string} userId - User ID
   * @param {string} weekStart - Week start date in YYYY-MM-DD format
   * @returns {string} Composite key
   */
  generateWeekKey(userId, weekStart) {
    return `${userId}_${weekStart}`;
  }

  /**
   * Validate that a date falls within a specific week
   * @param {string} date - Date to validate (YYYY-MM-DD)
   * @param {string} weekStart - Week start date (YYYY-MM-DD)
   * @returns {boolean} True if date is within the week
   */
  isDateInWeek(date, weekStart) {
    const dateObj = new Date(date);
    const weekStartObj = new Date(weekStart);
    const weekEndObj = new Date(weekStart);
    weekEndObj.setDate(weekStartObj.getDate() + 6);

    return dateObj >= weekStartObj && dateObj <= weekEndObj;
  }
}

// Export singleton instance
export const timesheetValidation = new TimesheetValidationService();

// Export individual functions for backward compatibility
export const checkExistingWeekSubmission = (userId, weekStartDate, options) =>
  timesheetValidation.checkExistingWeekSubmission(userId, weekStartDate, options);

export const validateWeekSubmission = (userId, weekStartDate, options) =>
  timesheetValidation.validateWeekSubmission(userId, weekStartDate, options);

export const getWeekSubmissionStatus = (userId, weekStartDate, options) =>
  timesheetValidation.getWeekSubmissionStatus(userId, weekStartDate, options);