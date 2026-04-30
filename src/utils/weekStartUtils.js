const WEEKDAY_CODES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const DEFAULT_WEEK_START = 'monday'; // normalize all settings against this default

export function normalizeWeekStartDay(value) {
    if (!value) return DEFAULT_WEEK_START;
    const lower = String(value).trim().toLowerCase();
    if (WEEKDAY_CODES.includes(lower)) return lower;
    // allow numeric values 0-6 mapping to weekday
    const parsed = Number(lower);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 6) {
        return WEEKDAY_CODES[parsed];
    }
    return DEFAULT_WEEK_START;
}

export function getWeekStartIndex(weekStartDay) {
    const normalized = normalizeWeekStartDay(weekStartDay);
    return WEEKDAY_CODES.indexOf(normalized);
}

export function isValidDate(d) {
    return d instanceof Date && !isNaN(d.getTime());
}

/**
 * Returns { start: Date, end: Date } representing the week containing `date`.
 * Returns { start: null, end: null } if input is invalid.
 */
export function getWeekRangeForDate(date, weekStartDay = DEFAULT_WEEK_START) {
    let inputDate = date instanceof Date ? new Date(date) : null;
    if (typeof date === 'string') {
        // Handle YYYY-MM-DD safely as local date
        if (date.match(/^\d{4}-\d{2}-\d{2}$/)) {
            inputDate = new Date(date + 'T00:00:00');
        } else {
            inputDate = new Date(date);
        }
    }

    if (!isValidDate(inputDate)) {
        console.warn('[weekStartUtils] Invalid date provided to getWeekRangeForDate:', date);
        return { start: null, end: null };
    }

    const startIndex = getWeekStartIndex(weekStartDay);
    const currentDayIndex = inputDate.getDay(); // 0=Sun .. 6=Sat (local time)
    
    let diff = currentDayIndex - startIndex;
    if (diff < 0) diff += 7;
    
    const start = new Date(inputDate);
    start.setDate(inputDate.getDate() - diff);
    start.setHours(0, 0, 0, 0);
    
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    return { start, end };
}

/**
 * Generates a week key string "YYYY-MM-DD_YYYY-MM-DD".
 * Returns null if invalid.
 */
export function generateWeekKey(date, weekStartDay = DEFAULT_WEEK_START) {
    const { start, end } = getWeekRangeForDate(date, weekStartDay);
    if (!start || !end) return null;
    return `${formatISODate(start)}_${formatISODate(end)}`;
}

export function formatISODate(date) {
    if (!date) return '';
    const d = new Date(date);
    if (!isValidDate(d)) return '';

    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function parseLocalDate(d) {
    if (d instanceof Date) return d;
    if (!d) return null;
    if (typeof d === 'string' && d.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const date = new Date(d + 'T00:00:00');
        if (isValidDate(date)) return date;
    }
    const date = new Date(d);
    return isValidDate(date) ? date : null;
}

/**
 * Returns an ordered array of 7 ISO date strings representing the week, starting from configured start day.
 */
export function getOrderedWeekDates(date, weekStartDay = DEFAULT_WEEK_START) {
    const { start } = getWeekRangeForDate(date, weekStartDay);
    const dates = [];
    for (let i = 0; i < 7; i += 1) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        dates.push(formatISODate(d));
    }
    return dates;
}

export function shiftDateByWeeks(date, weekOffset = 0, weekStartDay = DEFAULT_WEEK_START) {
    const { start } = getWeekRangeForDate(date, weekStartDay);
    const shifted = new Date(start);
    shifted.setDate(start.getDate() + (weekOffset * 7));
    return shifted;
}

/**
 * Returns human readable label components for UI, accounting for week end requirement.
 */
export function describeWeek(date, weekStartDay = DEFAULT_WEEK_START) {
    const { start, end } = getWeekRangeForDate(date, weekStartDay);
    return {
        start,
        end,
        startLabel: humanDate(start),
        endLabel: humanDate(end)
    };
}

function humanDate(d) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Formats a week range into a human-readable string: "Mar 23 - Mar 29, 2026"
 */
export function formatWeeklyRange(startDate, endDate) {
    if (!startDate || !endDate) return '—';
    const s = new Date(startDate);
    const e = new Date(endDate);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return '—';

    const sDay = s.getDate();
    const eDay = e.getDate();
    const sMonth = s.toLocaleDateString('en-US', { month: 'short' });
    const eMonth = e.toLocaleDateString('en-US', { month: 'short' });
    const sYear = s.getFullYear();
    const eYear = e.getFullYear();

    if (sYear === eYear) {
        if (sMonth === eMonth) {
            return `${sMonth} ${sDay} - ${eDay}, ${sYear}`;
        }
        return `${sMonth} ${sDay} - ${eMonth} ${eDay}, ${sYear}`;
    }
    return `${sMonth} ${sDay}, ${sYear} - ${eMonth} ${eDay}, ${eYear}`;
}


export const WEEKDAY_CODES_LIST = WEEKDAY_CODES.slice();
export const DEFAULT_WEEK_START_DAY = DEFAULT_WEEK_START;

// Feature Flags for Week Anchor Logic
export const STORAGE_ANCHOR_DAY = 'monday';
export const USE_FIXED_STORAGE_ANCHOR = false;

export function isMondayAnchorEnabled(companyId) {
    // Default to false to preserve existing dynamic-anchor behavior
    return false;
}

/**
 * Returns an ordered array of week days based on the selected week start day
 * @param {string} weekStartDay - The day the week starts ('sunday', 'monday', etc.)
 * @returns {Array} Array of day names ordered based on week start day
 */
export function getOrderedWeekDays(weekStartDay = DEFAULT_WEEK_START) {
    const normalizedStart = normalizeWeekStartDay(weekStartDay);
    const startIndex = getWeekStartIndex(normalizedStart);
    
    const allDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    // Reorder days based on start index
    const orderedDays = [];
    for (let i = 0; i < 7; i++) {
        const dayIndex = (startIndex + i) % 7;
        orderedDays.push(allDays[dayIndex]);
    }
    
    return orderedDays;
}
