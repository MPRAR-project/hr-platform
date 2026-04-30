/**
 * Safe date parsing utility to handle DD/MM/YYYY and other formats correctly
 */

/**
 * Parse date string in various formats safely
 * @param {string} dateString - Date string to parse
 * @returns {Date|null} - Parsed date or null if invalid
 */
export function safeParseDate(dateString) {
    if (!dateString) return null;

    // If it's already a Date object, return it
    if (dateString instanceof Date) {
        return isNaN(dateString.getTime()) ? null : dateString;
    }

    // Handle Firestore Timestamp
    if (dateString && typeof dateString.toDate === 'function') {
        try {
            return dateString.toDate();
        } catch (e) {
            return null;
        }
    }

    if (typeof dateString !== 'string') {
        return null;
    }

    // Try ISO format first (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)
    if (dateString.match(/^\d{4}-\d{2}-\d{2}/)) {
        const date = new Date(dateString);
        return isNaN(date.getTime()) ? null : date;
    }

    // Handle DD/MM/YYYY or DD/MM/YY format
    const dmyMatch = dateString.match(/^(\d{1,2})[\/](\d{1,2})[\/](\d{2,4})$/);
    if (dmyMatch) {
        let [_, day, month, year] = dmyMatch;
        let fullYear = parseInt(year);
        if (fullYear < 100) fullYear += 2000;
        const date = new Date(fullYear, month - 1, day); // month is 0-indexed
        return isNaN(date.getTime()) ? null : date;
    }

    // Handle DD-MM-YYYY or DD-MM-YY format
    const dmyDashMatch = dateString.match(/^(\d{1,2})[-](\d{1,2})[-](\d{2,4})$/);
    if (dmyDashMatch) {
        let [_, day, month, year] = dmyDashMatch;
        let fullYear = parseInt(year);
        if (fullYear < 100) fullYear += 2000;
        const date = new Date(fullYear, month - 1, day);
        return isNaN(date.getTime()) ? null : date;
    }

    // Fallback to standard Date constructor (last resort)
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? null : date;
}

/**
 * Format any date input to YYYY-MM-DD string safely
 * @param {any} dateInput - Date object, string, or timestamp
 * @returns {string} - Date in YYYY-MM-DD format
 */
export function formatToISODate(dateInput) {
    const date = safeParseDate(dateInput);
    if (!date || isNaN(date.getTime())) return typeof dateInput === 'string' ? dateInput : '';

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}
