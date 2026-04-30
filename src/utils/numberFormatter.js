/**
 * Number formatting utilities for timesheet displays
 * Provides consistent formatting for decimal numbers, time values, and week counts
 */

// Import error constants
import { FORMATTING_ERRORS } from './constants/timesheetFormats';

/**
 * Safe wrapper for formatting operations with error handling
 * @param {Function} formatFn - The formatting function to execute
 * @param {*} value - The value to format
 * @param {string} fallback - Fallback value on error
 * @param {string} operation - Operation name for logging
 * @returns {string} - Formatted value or fallback
 */
const safeFormat = (formatFn, value, fallback, operation) => {
  try {
    return formatFn(value);
  } catch (error) {
    console.warn(`${FORMATTING_ERRORS.DISPLAY_ERROR} in ${operation}:`, error);
    return fallback;
  }
};

/**
 * Formats decimal numbers for timesheet display
 * @param {number} value - The number to format
 * @param {Object} options - Formatting options
 * @param {number} options.maxDecimals - Maximum decimal places (default: 2)
 * @param {number} options.minDecimals - Minimum decimal places (default: 0)
 * @param {boolean} options.showZeroDecimals - Whether to show .00 for whole numbers (default: false)
 * @param {string} options.fallback - Fallback value for invalid inputs (default: '0')
 * @returns {string} - Formatted number string
 */
export const formatTimesheetNumber = (value, options = {}) => {
  const {
    maxDecimals = 2,
    minDecimals = 0,
    showZeroDecimals = false,
    fallback = '0'
  } = options;

  // Handle null/undefined/NaN values
  if (value == null || isNaN(value)) return fallback;

  const num = Number(value);

  // Handle zero case
  if (num === 0) return '0';

  try {
    // Format with appropriate decimal places
    const formatted = num.toFixed(maxDecimals);
    const parsed = parseFloat(formatted);

    // Remove trailing zeros unless showZeroDecimals is true
    if (!showZeroDecimals && parsed === Math.floor(parsed)) {
      return Math.floor(parsed).toString();
    }

    // Apply minimum decimal places if specified
    if (minDecimals > 0) {
      return parsed.toFixed(minDecimals);
    }

    return parsed.toString();
  } catch (error) {
    console.warn('Number formatting error:', error);
    return fallback;
  }
};

/**
 * Formats hours for display (handles seconds to hours conversion)
 * @param {number} seconds - Time in seconds
 * @returns {string} - Formatted time string (e.g., "8h 30m")
 */
export const formatTimeDisplay = (seconds) => {
  if (!seconds || seconds <= 0) return '0h';

  try {
    const totalSeconds = Math.floor(seconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
  } catch (error) {
    console.warn('Time formatting error:', error);
    return '0h';
  }
};

/**
 * Formats hours in 0.25 quarter-hour intervals
 * 0.25 = 15 minutes, 0.50 = 30 minutes, 0.75 = 45 minutes, 1.00 = 1 hour
 * @param {number} seconds - Time in seconds
 * @returns {string} - Formatted hours in decimal (e.g., "2.25", "8.50")
 */
export const formatHoursInQuarters = (seconds) => {
  if (!seconds || seconds <= 0) return '0.00';

  try {
    const totalSeconds = Math.floor(seconds);
    const totalHours = totalSeconds / 3600;

    // Round to nearest 0.25 (quarter hour)
    const quarterHours = Math.round(totalHours * 4) / 4;

    // Format with 2 decimal places
    return quarterHours.toFixed(2);
  } catch (error) {
    console.warn('Quarter hour formatting error:', error);
    return '0.00';
  }
};


/**
 * Formats weekly submission counts (whole numbers)
 * @param {number} weekCount - Number of weekly submissions
 * @returns {string} - Formatted week count (whole numbers: 1, 2, 3, etc.)
 */
export const formatWeeklyCount = (weekCount) => {
  return safeFormat(
    (value) => {
      if (!value || value <= 0) return '0';
      return Math.floor(Number(value)).toString();
    },
    weekCount,
    '0',
    'formatWeeklyCount'
  );
};

/**
 * Formats week counts for timesheet totals (DEPRECATED)
 * @deprecated Use formatWeeklyCount for weekly submissions instead
 * @param {number} totalDays - Total number of timesheet days
 * @returns {string} - Formatted week count
 */
export const formatWeekCount = (totalDays) => {
  console.warn('[DEPRECATED] formatWeekCount is deprecated. Use formatWeeklyCount for weekly submissions or formatTimesheetNumber for other decimal formatting.');

  return safeFormat(
    (value) => {
      if (!value || value <= 0) return '0';
      const weeks = value / 7;
      return formatTimesheetNumber(weeks, { maxDecimals: 1 });
    },
    totalDays,
    '0',
    'formatWeekCount'
  );
};

/**
 * Formats percentage values for display
 * @param {number} value - The percentage value (0-100)
 * @param {Object} options - Formatting options
 * @returns {string} - Formatted percentage string
 */
export const formatPercentage = (value, options = {}) => {
  const {
    maxDecimals = 1,
    fallback = '0%'
  } = options;

  if (value == null || isNaN(value)) return fallback;

  try {
    const formatted = formatTimesheetNumber(value, { maxDecimals });
    return `${formatted}%`;
  } catch (error) {
    console.warn('Percentage formatting error:', error);
    return fallback;
  }
};

// Import formatting constants
import { TIMESHEET_FORMATS, TIMESHEET_PRESETS } from './constants/timesheetFormats';

// Re-export for backward compatibility
export { TIMESHEET_FORMATS, TIMESHEET_PRESETS };

// Export the new weekly count formatter as the primary export
export { formatWeeklyCount as formatWeeklySubmissions };