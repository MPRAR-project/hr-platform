/**
 * timesheetSubmitGate.js
 *
 * Determines whether an employee can submit a timesheet for approval.
 *
 * Business rule:
 *   Submit is only active AFTER the week's last day (weekEnd) is complete.
 *   e.g. if weekEnd = Sunday May 25, submit is available from Monday May 26.
 *
 * The week start day is set once by the site owner in Central at registration
 * and is passed down via the company profile (/hr/employees/me → weekStartDay).
 */

/**
 * Returns true if the timesheet can be submitted (week has ended).
 *
 * @param {string|Date} weekEnd  - The last day of the week (inclusive). Can be 'YYYY-MM-DD' or Date.
 * @param {Date} [now]           - The current date (defaults to today). Useful for testing.
 * @returns {boolean}
 */
export function canSubmitTimesheet(weekEnd, now = new Date()) {
  if (!weekEnd) return false;

  // Normalize weekEnd to midnight UTC
  const endDate = weekEnd instanceof Date ? weekEnd : new Date(weekEnd + 'T00:00:00Z');
  if (isNaN(endDate.getTime())) return false;

  // Today at UTC midnight (based on local date)
  const todayUTC = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

  // Submit is allowed only AFTER the last day (strictly greater than weekEnd)
  return todayUTC > endDate;
}

/**
 * Returns the first date on which submit becomes available.
 *
 * @param {string|Date} weekEnd
 * @returns {Date}
 */
export function getSubmitAvailableDate(weekEnd) {
  const endDate = weekEnd instanceof Date ? new Date(weekEnd) : new Date(weekEnd + 'T00:00:00Z');
  const available = new Date(endDate);
  available.setUTCDate(available.getUTCDate() + 1);
  return available;
}

/**
 * Returns a human-readable reason why submit is blocked, or null if submit is allowed.
 *
 * @param {string|Date} weekEnd
 * @param {Date} [now]
 * @returns {string|null}
 */
export function getSubmitBlockedReason(weekEnd, now = new Date()) {
  if (canSubmitTimesheet(weekEnd, now)) return null;

  const available = getSubmitAvailableDate(weekEnd);
  const fmt = available.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

  return `Submit will be available on ${fmt} (after the week ends).`;
}
