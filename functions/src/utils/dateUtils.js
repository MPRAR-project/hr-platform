const WEEKDAY_CODES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DEFAULT_WEEK_START = 'monday';

function normalizeWeekStartDay(value) {
    if (!value) return DEFAULT_WEEK_START;
    const lower = String(value).trim().toLowerCase();
    if (WEEKDAY_CODES.includes(lower)) return lower;
    const parsed = Number(lower);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 6) {
        return WEEKDAY_CODES[parsed];
    }
    return DEFAULT_WEEK_START;
}

function getWeekStartIndex(weekStartDay) {
    const normalized = normalizeWeekStartDay(weekStartDay);
    return WEEKDAY_CODES.indexOf(normalized);
}

function getWeekRangeForDate(date, weekStartDay = DEFAULT_WEEK_START) {
    const inputDate = new Date(date);
    if (Number.isNaN(inputDate.getTime())) {
        throw new Error('[dateUtils] Invalid date provided');
    }

    const startIndex = getWeekStartIndex(weekStartDay);
    const currentDayIndex = inputDate.getUTCDay();

    let diff = currentDayIndex - startIndex;
    if (diff < 0) diff += 7;

    const start = new Date(inputDate);
    start.setUTCDate(inputDate.getUTCDate() - diff);
    start.setUTCHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    end.setUTCHours(23, 59, 59, 999);

    return { start, end };
}

function formatISODate(date) {
    const d = new Date(date);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

module.exports = {
    DEFAULT_WEEK_START,
    getWeekRangeForDate,
    formatISODate,
    normalizeWeekStartDay
};
