/**
 * Break Display Utilities
 * [FIX #8] Standardizes break display across all views
 * 
 * Break breakdown:
 * - manualBreakSec: User-entered break time
 * - autoLunchBreakSec: System-applied lunch deduction
 * - totalBreakSec: Sum of manual + auto-lunch (this is what affects pay)
 */

/**
 * Extract break information from an entry in a standardized way
 * @param {Object} entry - Timesheet entry object
 * @returns {{ totalBreakSec: number, manualBreakSec: number, autoLunchBreakSec: number, autoLunchApplied: boolean }}
 */
export function getBreakInfo(entry) {
    if (!entry) {
        return { totalBreakSec: 0, manualBreakSec: 0, autoLunchBreakSec: 0, autoLunchApplied: false };
    }

    // Try to get from breakMeta first (newer format)
    if (entry.breakMeta) {
        return {
            totalBreakSec: (entry.breakMeta.manualBreakSec || 0) + (entry.breakMeta.autoLunchBreakSec || 0),
            manualBreakSec: entry.breakMeta.manualBreakSec || 0,
            autoLunchBreakSec: entry.breakMeta.autoLunchBreakSec || 0,
            autoLunchApplied: entry.breakMeta.autoLunchApplied || false
        };
    }

    // Fallback to top-level fields (older format or direct fields)
    const manualBreakSec = entry.manualBreakSec || 0;
    const autoLunchBreakSec = entry.autoLunchBreakSec || 0;
    const autoLunchApplied = entry.autoLunchApplied || false;

    // breakSec may be the total or just manual depending on source
    const explicitTotal = entry.breakSec || 0;
    const calculatedTotal = manualBreakSec + autoLunchBreakSec;

    return {
        totalBreakSec: Math.max(explicitTotal, calculatedTotal),
        manualBreakSec,
        autoLunchBreakSec,
        autoLunchApplied
    };
}

/**
 * Format break time for display
 * @param {number} breakSec - Break time in seconds
 * @param {string} format - 'hours' | 'minutes' | 'hm' (e.g., "1h 30m")
 * @returns {string}
 */
export function formatBreakTime(breakSec, format = 'hours') {
    if (!breakSec || breakSec <= 0) return '0';

    const hours = Math.floor(breakSec / 3600);
    const minutes = Math.floor((breakSec % 3600) / 60);

    switch (format) {
        case 'minutes':
            return `${Math.round(breakSec / 60)} min`;
        case 'hm':
            if (hours === 0) return `${minutes}m`;
            if (minutes === 0) return `${hours}h`;
            return `${hours}h ${minutes}m`;
        case 'hours':
        default:
            return (breakSec / 3600).toFixed(2);
    }
}

/**
 * Get break display with breakdown tooltip content
 * @param {Object} entry - Timesheet entry
 * @returns {{ display: string, tooltipContent: string, hasAutoLunch: boolean }}
 */
export function getBreakDisplay(entry) {
    const breakInfo = getBreakInfo(entry);

    const display = formatBreakTime(breakInfo.totalBreakSec, 'hours');

    let tooltipParts = [];
    if (breakInfo.manualBreakSec > 0) {
        tooltipParts.push(`Manual: ${formatBreakTime(breakInfo.manualBreakSec, 'hm')}`);
    }
    if (breakInfo.autoLunchBreakSec > 0) {
        tooltipParts.push(`Auto-Lunch: ${formatBreakTime(breakInfo.autoLunchBreakSec, 'hm')}`);
    }

    const tooltipContent = tooltipParts.length > 0
        ? tooltipParts.join(' + ')
        : 'No break recorded';

    return {
        display,
        tooltipContent,
        hasAutoLunch: breakInfo.autoLunchApplied
    };
}

/**
 * Calculate break minutes from an entry (for forms)
 * Returns the manual break portion in minutes
 * @param {Object} entry - Timesheet entry
 * @returns {number} Break in minutes
 */
export function getManualBreakMinutes(entry) {
    const breakInfo = getBreakInfo(entry);
    return Math.round(breakInfo.manualBreakSec / 60);
}

/**
 * Calculate total break minutes from an entry
 * @param {Object} entry - Timesheet entry
 * @returns {number} Total break in minutes
 */
export function getTotalBreakMinutes(entry) {
    const breakInfo = getBreakInfo(entry);
    return Math.round(breakInfo.totalBreakSec / 60);
}
