/**
 * Time Display Utilities
 * [FIX #7] Visual indicators for time display types
 * 
 * Helps distinguish between:
 * - Raw times: Actual clock in/out as entered (displayed on /time-entries)
 * - Rounded times: After rounding rules applied (displayed on timesheets)
 * - Payable times: What the employee is paid for (effectiveSec based)
 */

/**
 * Time display types
 */
export const TIME_DISPLAY_TYPES = {
    RAW: 'raw',
    ROUNDED: 'rounded',
    EFFECTIVE: 'effective'
};

/**
 * Get label and description for a time display type
 * @param {string} type - One of TIME_DISPLAY_TYPES
 * @returns {{ label: string, description: string, badgeColor: string }}
 */
export function getTimeTypeInfo(type) {
    switch (type) {
        case TIME_DISPLAY_TYPES.RAW:
            return {
                label: 'Actual',
                description: 'Exact time as clocked/entered',
                badgeColor: 'bg-blue-100 text-blue-700'
            };
        case TIME_DISPLAY_TYPES.ROUNDED:
            return {
                label: 'Rounded',
                description: 'After company rounding rules applied',
                badgeColor: 'bg-green-100 text-green-700'
            };
        case TIME_DISPLAY_TYPES.EFFECTIVE:
            return {
                label: 'Payable',
                description: 'Hours to be paid (after breaks)',
                badgeColor: 'bg-purple-100 text-purple-700'
            };
        default:
            return {
                label: 'Time',
                description: '',
                badgeColor: 'bg-gray-100 text-gray-700'
            };
    }
}

/**
 * Determine if raw and rounded times are different
 * @param {Object} entry - Timesheet entry
 * @returns {boolean} True if rounding made a difference
 */
export function hasRoundingDifference(entry) {
    if (!entry) return false;

    const rawStart = entry.rawStart || entry.rawClockIn;
    const roundedStart = entry.roundedStart || entry.clockIn;
    const rawEnd = entry.rawEnd || entry.rawClockOut;
    const roundedEnd = entry.roundedEnd || entry.clockOut;

    // Compare as strings (HH:MM format or ISO)
    const startDiff = rawStart !== roundedStart;
    const endDiff = rawEnd !== roundedEnd;

    return startDiff || endDiff;
}

/**
 * Get time values for both raw and rounded display
 * @param {Object} entry - Timesheet entry
 * @returns {{ raw: { clockIn: string, clockOut: string }, rounded: { clockIn: string, clockOut: string } }}
 */
export function getTimeDisplayValues(entry) {
    if (!entry) {
        return {
            raw: { clockIn: '--:--', clockOut: '--:--' },
            rounded: { clockIn: '--:--', clockOut: '--:--' }
        };
    }

    // Extract raw times - prefer rawClockIn format (HH:MM) over rawStart (ISO)
    const rawClockIn = entry.rawClockIn || formatTimeFromISO(entry.rawStart);
    const rawClockOut = entry.rawClockOut || formatTimeFromISO(entry.rawEnd);

    // Extract rounded times - prefer clockIn format (HH:MM) over roundedStart (ISO)
    const roundedClockIn = entry.clockIn || formatTimeFromISO(entry.roundedStart);
    const roundedClockOut = entry.clockOut || formatTimeFromISO(entry.roundedEnd);

    return {
        raw: { clockIn: rawClockIn || '--:--', clockOut: rawClockOut || '--:--' },
        rounded: { clockIn: roundedClockIn || '--:--', clockOut: roundedClockOut || '--:--' }
    };
}

/**
 * Format ISO timestamp to HH:MM string
 * @param {string} isoString - ISO timestamp
 * @returns {string} HH:MM format
 */
function formatTimeFromISO(isoString) {
    if (!isoString) return null;
    try {
        const date = new Date(isoString);
        if (isNaN(date.getTime())) return null;
        const h = String(date.getHours()).padStart(2, '0');
        const m = String(date.getMinutes()).padStart(2, '0');
        return `${h}:${m}`;
    } catch {
        return null;
    }
}

/**
 * Get display configuration for a page
 * @param {string} pageName - 'time-entries' | 'timesheet' | 'report'
 * @returns {{ showType: string, showBadge: boolean, showBothTimes: boolean }}
 */
export function getPageTimeDisplayConfig(pageName) {
    switch (pageName) {
        case 'time-entries':
            return {
                showType: TIME_DISPLAY_TYPES.RAW,
                showBadge: true,
                showBothTimes: false
            };
        case 'timesheet':
        case 'timesheet-modal':
            return {
                showType: TIME_DISPLAY_TYPES.ROUNDED,
                showBadge: true,
                showBothTimes: true // Show raw in tooltip
            };
        case 'report':
        case 'payroll':
            return {
                showType: TIME_DISPLAY_TYPES.EFFECTIVE,
                showBadge: false,
                showBothTimes: false
            };
        default:
            return {
                showType: TIME_DISPLAY_TYPES.ROUNDED,
                showBadge: false,
                showBothTimes: false
            };
    }
}
