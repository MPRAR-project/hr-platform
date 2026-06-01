/**
 * Timesheet Utility Functions
 * Common functions for timesheet operations across components
 */

import { formatISODate } from './weekStartUtils';

/**
 * Determines whether the "Submit for Approval" button should be shown.
 *
 * Business Rule (simple & clear):
 *   Submit is only available from the day AFTER the week's last calendar day.
 *
 *   Example: week Mon May 19 – Sun May 25
 *     → Submit available from Mon May 26 onwards.
 *
 *   Example: week Mon May 26 – Sun Jun 1
 *     → Submit available from Mon Jun 2 onwards.
 *
 * Eligible statuses: 'draft' and 'rejected' (can re-submit after rejection).
 *
 * @param {Object}  timesheet        - Timesheet summary object (must have status and weekEndDate/weekEnd)
 * @param {Object}  companySettings  - (unused, kept for API compat)
 * @param {Map}     absencesMap      - (unused, kept for API compat)
 * @param {Object}  options          - (unused, kept for API compat)
 * @returns {boolean} Whether to show the Submit for Approval button
 */
export function shouldShowSubmitButton(timesheet, companySettings, absencesMap, options = {}) {
    // ─── Guard: timesheet must exist ────────────────────────────────────────────
    if (!timesheet) return false;

    // ─── Guard: only Draft / Rejected are eligible for submission ───────────────
    const status = (timesheet.status || '').toLowerCase();
    if (!['draft', 'rejected'].includes(status)) return false;

    // ─── Resolve week end ───────────────────────────────────────────────────────
    // weekEndDate (from TimesheetTab transform) is preferred; fall back to raw fields
    const endProp = timesheet.weekEndDate
        || timesheet.end
        || timesheet.raw?.end
        || timesheet.weekEnd;

    if (!endProp) {
        // No weekEnd available — conservatively hide the button
        return false;
    }

    // Normalize to midnight UTC for consistent cross-timezone comparison
    const weekEnd = endProp instanceof Date
        ? new Date(Date.UTC(endProp.getFullYear(), endProp.getMonth(), endProp.getDate()))
        : new Date(String(endProp).includes('T') ? endProp : endProp + 'T00:00:00Z');

    if (isNaN(weekEnd.getTime())) return false;

    // Today at UTC midnight (based on local date)
    const now = new Date();
    const todayUTC = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

    // ─── Business Rule ──────────────────────────────────────────────────────────
    // Submit is only allowed the day AFTER the week's last calendar day (strictly >)
    const allowed = todayUTC > weekEnd;

    return allowed;
}

/**
 * Check if a date is in the future
 * @param {Date|string} date - Date to check
 * @returns {boolean} - Whether the date is in the future
 */
export function isFutureDate(date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const checkDate = date instanceof Date ? date : new Date(date);
    checkDate.setHours(0, 0, 0, 0);

    return checkDate > today;
}
