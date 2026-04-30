/**
 * Shared Overtime Calculation Utilities
 * Used by both client-side (timeClock.js) and server-side (Cloud Functions)
 * 
 * [FIX #10] Consolidates overtime calculation into a single source of truth
 */

/**
 * Calculate scheduled seconds and overtime for a work day based on schedule
 * @param {Date} startDate - Work start time
 * @param {Date} endDate - Work end time
 * @param {Object} scheduleForDay - Schedule config for the day { enabled, start, end, durationMin }
 * @returns {{ scheduledSec: number, overtimeSec: number }}
 */
function computeOvertimeForDay(startDate, endDate, scheduleForDay) {
    // Helper function
    const secondsBetween = (a, b) => Math.max(0, Math.floor((b - a) / 1000));

    // If no schedule or day is disabled, all work is overtime
    if (!scheduleForDay || !scheduleForDay.enabled) {
        return {
            scheduledSec: 0,
            overtimeSec: secondsBetween(startDate, endDate)
        };
    }

    // Parse schedule start/end times
    const [sH, sM] = (scheduleForDay.start || '09:00').split(':').map(Number);
    const dayStart = new Date(startDate);
    dayStart.setHours(sH || 0, sM || 0, 0, 0);

    let dayEnd;
    if (typeof scheduleForDay.durationMin === 'number') {
        // Schedule defined by duration
        dayEnd = new Date(dayStart.getTime() + Math.max(0, scheduleForDay.durationMin) * 60000);
    } else {
        // Schedule defined by start/end time
        const [eH, eM] = (scheduleForDay.end || '17:00').split(':').map(Number);
        dayEnd = new Date(startDate);
        dayEnd.setHours(eH || 17, eM || 0, 0, 0);
    }

    // Calculate overlap of actual work with scheduled window
    const workStart = startDate;
    const workEnd = endDate;
    const overlapStart = new Date(Math.max(workStart.getTime(), dayStart.getTime()));
    const overlapEnd = new Date(Math.min(workEnd.getTime(), dayEnd.getTime()));

    const scheduledOverlapSec = overlapEnd > overlapStart ? secondsBetween(overlapStart, overlapEnd) : 0;
    const totalSec = secondsBetween(workStart, workEnd);
    const overtimeSec = Math.max(0, totalSec - scheduledOverlapSec);

    return { scheduledSec: scheduledOverlapSec, overtimeSec };
}

/**
 * Calculate target scheduled seconds for a day from schedule config
 * @param {string} dateStr - Date string (YYYY-MM-DD)
 * @param {Object} schedule - Full week schedule { Monday: {...}, Tuesday: {...}, ... }
 * @returns {number} Target seconds for the day
 */
function computeTargetSecondsForDay(dateStr, schedule) {
    const d = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T12:00:00');
    const dayName = d.toLocaleDateString('en-US', { weekday: 'long' });
    const sch = schedule[dayName] || schedule[dayName.toLowerCase()];

    if (!sch || sch.enabled === false) return 0;

    if (typeof sch.durationMin === 'number' && sch.durationMin > 0) {
        return sch.durationMin * 60;
    }

    // Calculate from start/end times
    if (sch.start && sch.end) {
        const [sH, sM] = sch.start.split(':').map(Number);
        const [eH, eM] = sch.end.split(':').map(Number);
        const startMin = (sH || 0) * 60 + (sM || 0);
        const endMin = (eH || 17) * 60 + (eM || 0);
        return Math.max(0, (endMin - startMin) * 60);
    }

    return 8 * 3600; // Default 8 hours
}

/**
 * Distribute overtime across day entries after a new entry is added/edited
 * Used when recalculating overtime for a specific day
 * @param {Array} dayEntries - All entries for the day
 * @param {number} targetSec - Target scheduled seconds for the day
 * @returns {Array} Updated entries with overtimeSec calculated
 */
function distributeOvertimeForDay(dayEntries, targetSec) {
    // Sort by start time
    const sorted = [...dayEntries].sort((a, b) => {
        const getStr = (v) => {
            if (!v) return '';
            if (typeof v === 'string') return v;
            if (v.toISOString) return v.toISOString();
            if (v.toDate) return v.toDate().toISOString();
            return String(v);
        };
        const strA = getStr(a.roundedStart || a.rawStart);
        const strB = getStr(b.roundedStart || b.rawStart);
        return strA.localeCompare(strB);
    });

    let runningTotal = 0;

    for (const entry of sorted) {
        const effectiveSec = entry.effectiveSec || 0;
        const previousTotal = runningTotal;
        runningTotal += effectiveSec;

        // Calculate how much of this entry is within scheduled time
        const normalSec = Math.min(effectiveSec, Math.max(0, targetSec - previousTotal));
        const overtimeSec = Math.max(0, effectiveSec - normalSec);

        entry.overtimeSec = overtimeSec;
    }

    return sorted;
}

// Export for both Node.js (Cloud Functions) and ES Modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        computeOvertimeForDay,
        computeTargetSecondsForDay,
        distributeOvertimeForDay
    };
}

export {
    computeOvertimeForDay,
    computeTargetSecondsForDay,
    distributeOvertimeForDay
};
