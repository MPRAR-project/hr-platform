/**
 * Time Display Utilities
 * 
 * Handles strict UTC-to-Local conversion heuristics for time strings.
 * Used to fix discrepancies where the backend (Cloud Functions) stores times as UTC strings ("06:45")
 * while the UI expects Local Time strings ("12:15").
 */

// Inline helper to avoid dependency issues
const zeroPad = (num) => num.toString().padStart(2, '0');

/**
 * Detects if a time string is likely UTC based on a reference ISO timestamp,
 * and converts it to Local Time if so.
 * 
 * Logic:
 * 1. Get the authoritative Local Hour from the ISO timestamp.
 * 2. Parse the string as a raw integer (Hypothesis: It is Local).
 * 3. Parse the string as UTC (Hypothesis: It is UTC).
 * 4. Compare diffs against the ISO Local Hour.
 * 
 * @param {string} timeStr - The time string (HH:mm) from the database/entry.
 * @param {Date|string} isoSource - The authoritative ISO timestamp (e.g., source rawStart).
 * @returns {string} - The corrected time string (HH:mm) for UI display.
 */
export const detectAndConvertToLocal = (timeStr, isoSource) => {
    if (!timeStr || !isoSource) return timeStr;
    try {
        // 1. Get the authoritative Local Hour from the ISO timestamp
        const dateObj = isoSource instanceof Date ? isoSource : new Date(isoSource);
        if (isNaN(dateObj.getTime())) return timeStr;

        const localHour = dateObj.getHours();

        // 2. Parse the string as a raw integer (Hypothesis: It is Local)
        // [FIX] Handle AM/PM logic to avoid false 12h diffs
        const lowerTimeStr = timeStr.toLowerCase();
        let [hStr, mStr] = timeStr.split(':');
        let hInt = parseInt(hStr, 10);
        const mInt = parseInt(mStr, 10);

        if (lowerTimeStr.includes('pm') && hInt < 12) hInt += 12;
        if (lowerTimeStr.includes('am') && hInt === 12) hInt = 0;

        // 3. Parse the string as UTC (Hypothesis: It is UTC)
        const utcDate = new Date();
        utcDate.setUTCHours(hInt, mInt, 0, 0);
        const hUtcToLocal = utcDate.getHours();

        // 4. Compare diffs (Logic: Minimizing error circle distance)
        // We check slightly relaxed equality due to potential rounding
        const diffLocal = Math.abs(hInt - localHour);
        const diffUtc = Math.abs(hUtcToLocal - localHour);

        // Handle 24h wrapping for diffs (e.g. 23 vs 0 is 1 hour diff)
        const wrapDiff = (d) => Math.min(d, 24 - d);

        // If UTC interpretation is SIGNIFICANTLY closer to the ISO truth than the Raw interpretation,
        // it means the string is stored as UTC.
        if (wrapDiff(diffUtc) < wrapDiff(diffLocal) && wrapDiff(diffLocal) > 1) {
            return `${zeroPad(utcDate.getHours())}:${zeroPad(utcDate.getMinutes())}`;
        }
        return timeStr;
    } catch (err) {
        return timeStr;
    }
};

/**
 * Formats time string to consistent AM/PM format
 * @param {string|Date} time - Time string (HH:mm) or Date object
 * @returns {string} - Formatted time in AM/PM format (e.g., "09:30 AM", "5:30 PM")
 */
export const formatTimeToAMPM = (time) => {
    if (!time) return '-';
    
    try {
        let date;
        
        if (typeof time === 'string') {
            // Handle strings that might already contain AM/PM
            if (time.toLowerCase().includes('am') || time.toLowerCase().includes('pm')) {
                return time.toUpperCase().replace(/\s+/g, ' ').trim();
            }
            
            // Parse HH:mm format
            const [hours, minutes] = time.split(':').map(Number);
            if (isNaN(hours) || isNaN(minutes)) return time;
            
            date = new Date();
            date.setHours(hours, minutes, 0, 0);
        } else if (time instanceof Date) {
            date = time;
        } else {
            return time;
        }
        
        if (isNaN(date.getTime())) return time;
        
        return date.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    } catch (error) {
        // Error formatting time to AM/PM
        return time;
    }
};
