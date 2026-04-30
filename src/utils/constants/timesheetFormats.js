/**
 * Timesheet formatting configuration constants
 * Provides standardized formatting options for different timesheet contexts
 */

// Default formatting options for different timesheet display contexts
export const TIMESHEET_FORMATS = {
  // Weekly submission count formatting (whole numbers only)
  weeklySubmissions: {
    maxDecimals: 0,
    minDecimals: 0,
    showZeroDecimals: false,
    fallback: '0'
  },

  // Legacy week count formatting (DEPRECATED - for daily-to-week conversion)
  weekCounts: {
    maxDecimals: 1,
    minDecimals: 0,
    showZeroDecimals: false,
    fallback: '0'
  },

  // Hours formatting (for time duration displays)
  hours: {
    maxDecimals: 2,
    minDecimals: 0,
    showZeroDecimals: false,
    fallback: '0h'
  },

  // Percentage formatting (for completion rates, etc.)
  percentages: {
    maxDecimals: 1,
    minDecimals: 0,
    showZeroDecimals: false,
    fallback: '0%'
  },

  // Currency formatting (for payroll, rates, etc.)
  currency: {
    maxDecimals: 2,
    minDecimals: 2,
    showZeroDecimals: true,
    fallback: '0.00'
  },

  // General decimal formatting (for statistics, ratios, etc.)
  decimal: {
    maxDecimals: 2,
    minDecimals: 0,
    showZeroDecimals: false,
    fallback: '0'
  },

  // High precision formatting (for calculations that need more precision)
  highPrecision: {
    maxDecimals: 4,
    minDecimals: 0,
    showZeroDecimals: false,
    fallback: '0'
  }
};

// Specific formatting presets for common timesheet scenarios
export const TIMESHEET_PRESETS = {
  // For displaying weekly submission counts in management dashboards
  WEEKLY_SUBMISSIONS: TIMESHEET_FORMATS.weeklySubmissions,
  
  // For displaying week counts in management dashboards (DEPRECATED)
  WEEK_COUNT: TIMESHEET_FORMATS.weekCounts,
  
  // For displaying time durations (hours, minutes)
  TIME_DURATION: TIMESHEET_FORMATS.hours,
  
  // For displaying completion percentages
  COMPLETION_RATE: TIMESHEET_FORMATS.percentages,
  
  // For displaying monetary values
  PAYROLL_AMOUNT: TIMESHEET_FORMATS.currency,
  
  // For displaying general statistics
  STATISTICS: TIMESHEET_FORMATS.decimal
};

// Common timesheet calculation constants
export const TIMESHEET_CONSTANTS = {
  SECONDS_PER_MINUTE: 60,
  SECONDS_PER_HOUR: 3600,
  SECONDS_PER_DAY: 86400,
  MINUTES_PER_HOUR: 60,
  HOURS_PER_DAY: 24,
  DAYS_PER_WEEK: 7,
  STANDARD_WORK_HOURS_PER_DAY: 8,
  STANDARD_WORK_HOURS_PER_WEEK: 40
};

// Error messages for formatting failures
export const FORMATTING_ERRORS = {
  INVALID_INPUT: 'Invalid input provided to formatting function',
  CALCULATION_ERROR: 'Error occurred during calculation',
  DISPLAY_ERROR: 'Error occurred during display formatting'
};

/**
 * Usage examples and documentation
 * 
 * @example
 * // Format weekly submission counts for dashboard display
 * import { formatWeeklyCount } from '../numberFormatter';
 * import { TIMESHEET_PRESETS } from './timesheetFormats';
 * 
 * const weeklyCount = formatWeeklyCount(3); // Returns "3"
 * 
 * @example
 * // Format week counts for dashboard display (DEPRECATED)
 * import { formatWeekCount } from '../numberFormatter';
 * import { TIMESHEET_PRESETS } from './timesheetFormats';
 * 
 * const weekCount = formatWeekCount(13); // Returns "1.9"
 * 
 * @example
 * // Format time duration for timesheet display
 * import { formatTimeDisplay } from '../numberFormatter';
 * 
 * const timeDisplay = formatTimeDisplay(30600); // Returns "8h 30m"
 * 
 * @example
 * // Format decimal with specific preset
 * import { formatTimesheetNumber } from '../numberFormatter';
 * import { TIMESHEET_PRESETS } from './timesheetFormats';
 * 
 * const formatted = formatTimesheetNumber(1.8571428571428572, TIMESHEET_PRESETS.STATISTICS);
 * // Returns "1.86"
 */