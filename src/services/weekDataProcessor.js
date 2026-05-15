/**
 * Week Data Processor
 * Pure functions to process timesheet and session data into week format
 * Used by TimesheetContext to process real-time data
 */

import { DEFAULT_WEEK_START_DAY, formatISODate } from '../utils/weekStartUtils';

import { getUserWeekContext, computeTargetSecondsForDay } from './timesheets';
import { applyRoundingToDate } from '../utils/timeRounding';

// Helper to convert any date-like value to a Date object safely
const safeToDate = (val) => {
    if (!val) return null;
    if (val instanceof Date) return val;
    if (val && typeof val.toDate === 'function') return val.toDate();
    if (typeof val === 'string') {
        const d = new Date(val);
        return isNaN(d.getTime()) ? null : d;
    }
    if (typeof val === 'number') return new Date(val);
    return null;
};

// Helper to convert time string (HH:MM) to Date for formatting
const timeStringToDate = (timeStr, dateStr) => {
    if (!timeStr || typeof timeStr !== 'string') return null;
    try {
        const s = timeStr.trim();
        const baseDate = new Date(dateStr + 'T00:00:00');

        // 12h format match
        const m12 = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
        if (m12) {
            let h = parseInt(m12[1], 10);
            const m = parseInt(m12[2], 10);
            const ap = m12[3].toUpperCase();
            h = h % 12;
            if (ap === 'PM') h += 12;
            baseDate.setHours(h, m, 0, 0);
            return baseDate;
        }

        // 24h format match
        const m24 = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
        if (m24) {
            const h = parseInt(m24[1], 10);
            const m = parseInt(m24[2], 10);
            baseDate.setHours(h, m, 0, 0);
            return baseDate;
        }

        return null;
    } catch {
        return null;
    }
};

/**
 * Process a single day's data combining timesheet entries, sessions, and absences
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @param {Object} timesheet - Timesheet document for this date (or null)
 * @param {Array} daySessions - Array of session documents for this date
 * @param {Object} schedule - Work schedule for the day
 * @param {Map} absencesMap - Map of date strings to absence objects
 * @returns {Object} Processed day row data
 */
export function processDayData(dateStr, timesheet, daySessions, schedule = {}, absencesMap = new Map(), roundingRules = null) {

    const formatSeconds = (sec) => {
        const h = Math.floor((sec || 0) / 3600);
        const m = Math.floor(((sec || 0) % 3600) / 60);
        return `${String(h)}h ${String(m).padStart(2, '0')}m`;
    };

    const fmt = (date) => {
        if (!date) return '-';
        try {
            return date.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
        } catch { return '-'; }
    };

    // Get ALL timesheet entries for this date
    let dayEntries = timesheet?.entries?.filter(e => e.date === dateStr) || [];

    // CRITICAL FIX: Deduplicate entries within the day
    // This handles cases where a single timesheet document might contain duplicate entries for the same day
    const uniqueEntriesMap = new Map();
    for (const entry of dayEntries) {
        // Create a unique key for the entry
        // Use sessionId if available, otherwise a combination of values
        const sessionId = Array.isArray(entry.sessionIds) && entry.sessionIds.length > 0
            ? entry.sessionIds.sort().join(',')
            : null;

        const key = sessionId || `${entry.date}_${entry.grossSec}_${entry.effectiveSec}_${entry.rawStart || ''}`;

        // If duplicate found, prioritize the one with the LATER editedAt timestamp
        const existing = uniqueEntriesMap.get(key);
        if (!existing) {
            uniqueEntriesMap.set(key, entry);
        } else {
            const existingTime = existing.editedAt ? new Date(existing.editedAt).getTime() : 0;
            const newTime = entry.editedAt ? new Date(entry.editedAt).getTime() : 0;

            // Also prioritize entries with notes over those without, if times are roughly equal (or missing)
            // But strict timestamp is better if available.
            if (newTime > existingTime) {
                uniqueEntriesMap.set(key, entry);
            }
        }
    }
    dayEntries = Array.from(uniqueEntriesMap.values());

    const dayEntry = dayEntries.length > 0 ? dayEntries[0] : null; // Keep first entry for backward compatibility

    // CRITICAL FIX: Prioritize saved timesheet entry values over session data
    // Saved timesheet entries have the latest edited values (e.g., 19:13), while sessions might have old values (e.g., 16:10)


    // Check if timesheet entries have saved clockIn/clockOut values (highest priority)
    // For display purposes, use the earliest clock in and latest clock out from all entries
    let savedClockIn = null;
    let savedClockOut = null;
    let rawClockIn = null;
    let rawClockOut = null;

    if (dayEntries.length > 0) {
        const clockInTimes = [];
        const clockOutTimes = [];

        for (const entry of dayEntries) {
            // PRIORITY: Use ISO strings (roundedStart/roundedEnd) which preserve full date/time info
            // This handles overnight shifts correctly (e.g. out time is next day)
            if (entry.roundedStart) {
                const d = new Date(entry.roundedStart);
                if (!isNaN(d.getTime())) clockInTimes.push(d);
            } else if (entry.clockIn && typeof entry.clockIn === 'string') {
                const time = timeStringToDate(entry.clockIn, dateStr);
                if (time) {
                    // UI-only rounding for legacy entries that didn't store roundedStart
                    const rounded = (roundingRules && roundingRules.clockIn)
                        ? applyRoundingToDate(time, roundingRules.clockIn)
                        : time;
                    clockInTimes.push(rounded);
                }
            }

            if (entry.roundedEnd) {
                const d = new Date(entry.roundedEnd);
                if (!isNaN(d.getTime())) clockOutTimes.push(d);
            } else if (entry.clockOut && typeof entry.clockOut === 'string') {
                const time = timeStringToDate(entry.clockOut, dateStr);
                if (time) {
                    // UI-only rounding for legacy entries that didn't store roundedEnd
                    const rounded = (roundingRules && roundingRules.clockOut)
                        ? applyRoundingToDate(time, roundingRules.clockOut)
                        : time;
                    clockOutTimes.push(rounded);
                }
            }
        }

        // Use earliest clock in and latest clock out
        if (clockInTimes.length > 0) {
            savedClockIn = clockInTimes.sort((a, b) => a.getTime() - b.getTime())[0];
        }
        if (clockOutTimes.length > 0) {
            savedClockOut = clockOutTimes.sort((a, b) => b.getTime() - a.getTime())[0];
        }
    }

    // Get clock in/out pairs from sessions
    const clockInOutPairs = daySessions.map(s => {
        const manualBreakSec = Number.isFinite(s.manualBreakSec) ? Math.max(0, s.manualBreakSec) : 0;
        const autoLunchBreakSec = Number.isFinite(s.autoLunchBreakSec) ? Math.max(0, s.autoLunchBreakSec) : 0;
        const breakSecForSession = Number.isFinite(s.breakSec)
            ? Math.max(0, s.breakSec)
            : (manualBreakSec + autoLunchBreakSec);

        const getRoundedStart = () => {
            const start = safeToDate(s.roundedStartedAt) || safeToDate(s.startedAt);
            if (!start) return null;
            if (!s.roundedStartedAt && roundingRules) return applyRoundingToDate(start, roundingRules.clockIn);
            return start;
        };

        const getRoundedEnd = () => {
            if (s.status === 'open') return null;
            const end = safeToDate(s.roundedEndedAt) || safeToDate(s.endedAt);
            if (!end) return null;
            if (!s.roundedEndedAt && roundingRules) return applyRoundingToDate(end, roundingRules.clockOut);
            return end;
        };

        const getRawStart = () => safeToDate(s.startedAt);

        const getRawEnd = () => (s.status === 'open' ? null : safeToDate(s.endedAt));

        const roundedIn = getRoundedStart();
        const roundedOut = getRoundedEnd();

        return {
            clockIn: roundedIn,
            clockOut: roundedOut,
            clockInTime: roundedIn,
            clockOutTime: roundedOut,
            rawClockIn: getRawStart(), // FIXED: Use session's own raw start
            rawClockOut: getRawEnd(), // FIXED: Use session's own raw end
            sessionId: s.id,
            status: s.status,
            isManual: s.isManual === true,
            manualBreakSec,
            autoLunchBreakSec,
            breakSec: breakSecForSession,
            // UI expects minutes for the manual break value
            breakMin: Math.round(manualBreakSec / 60)
        };
    }).filter(pair => {
        if (pair.clockIn === null || pair.clockOut === null) return false;
        return pair.clockOut.getTime() > pair.clockIn.getTime();
    });

    // Format clock in/out pairs
    // CRITICAL FIX: Always use session pairs to show granular data in UI, even if timesheet is saved
    // The previous logic collapsed all sessions into one if a saved entry existed, hiding the breakdown
    // CRITICAL FIX: Prioritize saved edits over raw session data
    const savedEntriesMap = new Map();
    if (Array.isArray(dayEntries)) {
        dayEntries.forEach(entry => {
            if (entry.sessionKey) savedEntriesMap.set(entry.sessionKey, entry);
            if (Array.isArray(entry.sessionIds)) {
                entry.sessionIds.forEach(id => savedEntriesMap.set(id, entry));
            }
        });
    }

    let clockInOutPairsFormatted = clockInOutPairs.map(pair => {
        // Check if we have an edit for this session
        const saved = pair.sessionId ? savedEntriesMap.get(pair.sessionId) : null;

        const rawStartDt = pair.rawClockIn;
        const rawEndDt = pair.rawClockOut;

        // Display rounding (UI-only): if the entry doesn't have explicit roundedStart/roundedEnd,
        // apply current rounding rules so old entries render consistently.
        const hasExplicitRounded = Boolean(pair.clockInTime || pair.clockOutTime);
        const startDt = (!hasExplicitRounded && roundingRules && rawStartDt)
            ? applyRoundingToDate(rawStartDt, roundingRules.clockIn)
            : rawStartDt;
        const endDt = (!hasExplicitRounded && roundingRules && rawEndDt)
            ? applyRoundingToDate(rawEndDt, roundingRules.clockOut)
            : rawEndDt;

        if (saved) {
            // 1. Determine Start Time
            let finalIn = pair.clockIn; // Default: Raw Session
            let finalInTime = pair.clockIn || null; // For sorting/calculation

            if (saved.roundedStart) {
                // Priority 1: Saved ISO String (created during save)
                const d = new Date(saved.roundedStart);
                if (!isNaN(d.getTime())) {
                    finalIn = d;
                    finalInTime = d;
                }
            } else if (saved.clockIn) {
                // Priority 2: Saved Manual String (HH:mm)
                // Note: saved.clockIn might be a string "HH:mm"
                const d = timeStringToDate(saved.clockIn, dateStr);
                if (d) {
                    const rounded = (!saved.roundedStart && roundingRules && roundingRules.clockIn)
                        ? applyRoundingToDate(d, roundingRules.clockIn)
                        : d;
                    finalIn = rounded;
                    finalInTime = rounded;
                }
            } else if (saved.rawStart) {
                // Priority 3: Raw Start from saved entry (fallback)
                const d = new Date(saved.rawStart);
                if (!isNaN(d.getTime())) {
                    finalIn = d;
                    finalInTime = d;
                }
            }

            // 2. Determine End Time
            let finalOut = pair.clockOut; // Default: Raw Session
            let finalOutTime = pair.clockOut || null;

            if (saved.roundedEnd) {
                // Priority 1: Saved ISO String
                const d = new Date(saved.roundedEnd);
                if (!isNaN(d.getTime())) {
                    finalOut = d;
                    finalOutTime = d;
                }
            } else if (saved.clockOut) {
                // Priority 2: Saved Manual String (HH:mm)
                const d = timeStringToDate(saved.clockOut, dateStr);
                if (d) {
                    const rounded = (!saved.roundedEnd && roundingRules && roundingRules.clockOut)
                        ? applyRoundingToDate(d, roundingRules.clockOut)
                        : d;
                    finalOut = rounded;
                    finalOutTime = rounded;
                }
            } else if (saved.rawEnd) {
                // Priority 3: Raw End from saved entry (fallback)
                const d = new Date(saved.rawEnd);
                if (!isNaN(d.getTime())) {
                    finalOut = d;
                    finalOutTime = d;
                }
            }

            return {
                id: saved.id || pair.id || pair.sessionId,
                clockIn: finalIn ? fmt(finalIn) : (pair.clockIn ? fmt(pair.clockIn) : '-'),
                clockOut: finalOut ? fmt(finalOut) : (pair.clockOut ? fmt(pair.clockOut) : '-'),
                clockInTime: finalInTime,
                clockOutTime: finalOutTime,

                // [DATA PRESERVATION] Keep original session timestamps for reliable UTC detection
                originalSessionStart: pair.clockInTime,
                originalSessionEnd: pair.clockOutTime,

                rawClockIn: startDt ? fmt(startDt) : '-',
                rawClockOut: endDt ? fmt(endDt) : '-',
                rawClockInTime: startDt,
                rawClockOutTime: endDt,

                sessionId: pair.sessionId,
                status: pair.status,
                isManual: saved.isManual === true || pair.isManual === true,
                manualBreakSec: Number.isFinite(saved.manualBreakSec)
                    ? Math.max(0, saved.manualBreakSec)
                    : (Number.isFinite(saved?.breakMeta?.manualBreakSec) ? Math.max(0, saved.breakMeta.manualBreakSec) : (pair.manualBreakSec || 0)),
                autoLunchBreakSec: Number.isFinite(saved.autoLunchBreakSec)
                    ? Math.max(0, saved.autoLunchBreakSec)
                    : (Number.isFinite(saved?.breakMeta?.autoLunchBreakSec) ? Math.max(0, saved.breakMeta.autoLunchBreakSec) : (pair.autoLunchBreakSec || 0)),
                breakSec: Number.isFinite(saved.breakSec)
                    ? Math.max(0, saved.breakSec)
                    : (Number.isFinite(saved?.breakMeta?.manualBreakSec) || Number.isFinite(saved?.breakMeta?.autoLunchBreakSec)
                        ? Math.max(0, (saved.breakMeta.manualBreakSec || 0) + (saved.breakMeta.autoLunchBreakSec || 0))
                        : (pair.breakSec || 0)),
                breakMin: Math.round((((Number.isFinite(saved.manualBreakSec) ? saved.manualBreakSec : (pair.manualBreakSec || 0)) || 0) / 60)),
                isSavedEntry: true,
                isEdited: true // Flag for UI
            };
        }

        // Default behavior (Raw Data)
        return {
            id: pair.id || pair.sessionId,
            clockIn: pair.clockIn ? fmt(pair.clockIn) : '-',
            clockOut: pair.clockOut ? fmt(pair.clockOut) : '-',
            clockInTime: pair.clockIn,
            clockOutTime: pair.clockOut,

            // [DATA PRESERVATION] Keep original session timestamps for reliable UTC detection
            originalSessionStart: pair.clockInTime,
            originalSessionEnd: pair.clockOutTime,

            rawClockIn: startDt ? fmt(startDt) : '-',
            rawClockOut: endDt ? fmt(endDt) : '-',
            rawClockInTime: startDt,
            rawClockOutTime: endDt,
            sessionId: pair.sessionId,
            status: pair.status,
            isManual: pair.isManual === true,
            manualBreakSec: pair.manualBreakSec || 0,
            autoLunchBreakSec: pair.autoLunchBreakSec || 0,
            breakSec: pair.breakSec || 0,
            breakMin: pair.breakMin || Math.round(((pair.manualBreakSec || 0) / 60)),
            isSavedEntry: false,
            isEdited: false
        };
    });

    // If NO sessions exist but we have a saved entry (e.g. manual entry, description-only, or legacy), add it
    if (clockInOutPairsFormatted.length === 0) {
        if (savedClockIn || savedClockOut) {
            clockInOutPairsFormatted.push({
                id: dayEntry?.id,
                clockIn: savedClockIn ? fmt(savedClockIn) : '-',
                clockOut: savedClockOut ? fmt(savedClockOut) : '-',
                clockInTime: savedClockIn,
                clockOutTime: savedClockOut,
                rawClockIn: savedClockIn ? fmt(savedClockIn) : '-',
                rawClockOut: savedClockOut ? fmt(savedClockOut) : '-',
                rawClockInTime: savedClockIn,
                rawClockOutTime: savedClockOut,
                sessionId: null,
                status: 'saved',
                isSavedEntry: true,
                notes: dayEntry?.notes || dayEntry?.description || '',
                description: dayEntry?.description || ''
            });
        } else if (dayEntries.some(e => e.isDescriptionOnly)) {
            // Handle description-only entries with no hours
            const descEntry = dayEntries.find(e => e.isDescriptionOnly);
            clockInOutPairsFormatted.push({
                clockIn: '-',
                clockOut: '-',
                clockInTime: null,
                clockOutTime: null,
                isDescriptionOnly: true,
                id: descEntry.id,
                sessionId: descEntry.sessionId || descEntry.id,
                notes: descEntry.notes || descEntry.description || '',
                description: descEntry.description || descEntry.notes || '',
                isSavedEntry: true,
                status: 'saved'
            });
        }
    }

    // Get clock in/out from sessions (fallback if no saved values)
    const firstClockIn = savedClockIn || (clockInOutPairs.length > 0 ? clockInOutPairs[0].clockIn : null);
    const lastClockOut = savedClockOut || (clockInOutPairs.length > 0
        ? clockInOutPairs
            .map(p => p.clockOut)
            .filter(Boolean)
            .sort((a, b) => b.getTime() - a.getTime())[0]
        : null);

    const firstRawClockIn = rawClockIn || savedClockIn || (clockInOutPairs.length > 0 ? clockInOutPairs[0].rawClockIn : null);
    const lastRawClockOut = rawClockOut || savedClockOut || (clockInOutPairs.length > 0
        ? clockInOutPairs
            .map(p => p.rawClockOut)
            .filter(Boolean)
            .sort((a, b) => b.getTime() - a.getTime())[0]
        : null);

    // Get totals from ALL timesheet entries for this date (sum them up)
    let grossSec = 0;
    let effectiveSec = 0;
    let overtimeSec = 0;
    let breakSec = 0;

    if (dayEntries.length > 0) {
        // Sum up totals from all entries
        for (const entry of dayEntries) {
            grossSec += entry.grossSec || 0;
            effectiveSec += entry.effectiveSec || 0;
            overtimeSec += entry.overtimeSec || 0;

            // Calculate break for each entry
            let entryBreak = 0;
            if (Number.isFinite(entry.manualBreakSec) || Number.isFinite(entry.autoLunchBreakSec)) {
                // Use explicit breaks (manual + auto-lunch) if available
                entryBreak = Math.max(
                    0,
                    (Number(entry.manualBreakSec) || 0) + (Number(entry.autoLunchBreakSec) || 0)
                );
            } else if (Number.isFinite(entry.breakSec)) {
                // Prefer stored total break if component fields are missing
                entryBreak = Math.max(0, Number(entry.breakSec) || 0);
            } else if (dayEntries.length === 1 && Number.isFinite(entry.grossSec) && Number.isFinite(entry.effectiveSec)) {
                // Only use gross - effective for SINGLE entries
                // For multiple entries, don't calculate break as gross - effective to avoid double counting
                // Gaps will be calculated separately below
                entryBreak = Math.max(0, (entry.grossSec || 0) - (entry.effectiveSec || 0));
            }
            // For multiple entries, if no explicit breaks, entryBreak remains 0
            // Gaps between entries will be added separately in the gap calculation below
            breakSec += entryBreak;
        }
    } else if (timesheet?.totals && (!timesheet.entries || !Array.isArray(timesheet.entries) || timesheet.entries.length === 0)) {
        // Fallback to timesheet-level totals ONLY if this is a legacy document with no entries array
        // If entries array exists but is empty (length 0), we still likely want to fall back to totals for safety on legacy docs
        // But if entries has items (length > 0) and we didn't find one for this day (in the if block above), 
        // then this day truly has 0 hours.
        grossSec = timesheet.totals.grossSec || 0;
        effectiveSec = timesheet.totals.effectiveSec || 0;
        overtimeSec = timesheet.totals.overtimeSec || 0;
    }

    // Calculate actual breaks between entries for multiple entries
    if (dayEntries.length > 1) {
        // Sort entries by clock-in time using rounded times (consistent with display)
        const sortedEntries = [...dayEntries]
            .filter(entry => {
                // Use the same priority as display: roundedStart > rawStart > roundedClockIn > clockIn
                const startTime = entry.roundedStart || entry.rawStart || entry.roundedClockIn || entry.clockIn;
                const endTime = entry.roundedEnd || entry.rawEnd || entry.roundedClockOut || entry.clockOut;
                return startTime && endTime;
            })
            .sort((a, b) => {
                const getStartTime = (entry) => {
                    if (entry.roundedStart) return new Date(entry.roundedStart);
                    if (entry.rawStart) return new Date(entry.rawStart);
                    if (entry.roundedClockIn) return new Date(`2000-01-01T${entry.roundedClockIn}:00`);
                    if (entry.clockIn) return new Date(`2000-01-01T${entry.clockIn}:00`);
                    return new Date(0);
                };
                return getStartTime(a) - getStartTime(b);
            });

        // Calculate gaps between consecutive entries using rounded times
        for (let i = 0; i < sortedEntries.length - 1; i++) {
            const currentEntry = sortedEntries[i];
            const nextEntry = sortedEntries[i + 1];

            // Get end time of current entry (same priority as display)
            const getCurrentEnd = (entry) => {
                if (entry.roundedEnd) return new Date(entry.roundedEnd);
                if (entry.rawEnd) return new Date(entry.rawEnd);
                if (entry.roundedClockOut) return new Date(`2000-01-01T${entry.roundedClockOut}:00`);
                if (entry.clockOut) return new Date(`2000-01-01T${entry.clockOut}:00`);
                return new Date(0);
            };

            // Get start time of next entry (same priority as display)
            const getNextStart = (entry) => {
                if (entry.roundedStart) return new Date(entry.roundedStart);
                if (entry.rawStart) return new Date(entry.rawStart);
                if (entry.roundedClockIn) return new Date(`2000-01-01T${entry.roundedClockIn}:00`);
                if (entry.clockIn) return new Date(`2000-01-01T${entry.clockIn}:00`);
                return new Date(0);
            };

            const currentEnd = getCurrentEnd(currentEntry);
            const nextStart = getNextStart(nextEntry);

            const gapMs = nextStart.getTime() - currentEnd.getTime();
            const gapSec = Math.max(0, Math.floor(gapMs / 1000));

            // Add gap to break time
            breakSec += gapSec;
        }
    }

    // If no break from entry, calculate from sessions
    if (breakSec === 0 && daySessions.length > 0) {
        breakSec = daySessions.reduce((acc, s) => {
            const manual = Number.isFinite(s.manualBreakSec) ? Math.max(0, s.manualBreakSec) : 0;
            const autoLunch = Number.isFinite(s.autoLunchBreakSec) ? Math.max(0, s.autoLunchBreakSec) : 0;
            const legacyBreak = Number.isFinite(s.breakSec) ? Math.max(0, s.breakSec) : 0;
            return acc + ((manual || autoLunch) ? (manual + autoLunch) : legacyBreak);
        }, 0);
    }

    // Calculate scheduled seconds for the day
    let scheduledSec = 0;
    if (schedule) {
        const dayName = new Date(dateStr).toLocaleDateString('en-US', { weekday: 'long' });
        const daySchedule = schedule[dayName];
        if (daySchedule && daySchedule.enabled) {
            if (typeof daySchedule.durationMin === 'number') {
                scheduledSec = Math.max(0, daySchedule.durationMin) * 60;
            } else if (daySchedule.start && daySchedule.end) {
                const [sH, sM] = daySchedule.start.split(':').map(Number);
                const [eH, eM] = daySchedule.end.split(':').map(Number);
                const d = new Date(dateStr);
                const start = new Date(d); start.setHours(sH || 0, sM || 0, 0, 0);
                const end = new Date(d); end.setHours(eH || 17, eM || 0, 0, 0);
                scheduledSec = Math.max(0, Math.floor((end - start) / 1000));
            }
        }
    }

    // Get day name
    const dayName = new Date(dateStr).toLocaleDateString('en-US', { weekday: 'long' });

    // Check if any entry for this day is manual
    const isManual = dayEntries.some(entry => entry.isManual === true);

    // Check for approved absence on this day
    const absence = absencesMap.get(dateStr);
    const hasAbsence = !!absence;

    // If there's an absence and no actual clock data, set effective hours to 0
    let finalEffectiveSec = effectiveSec;
    if (hasAbsence && !firstClockIn && !lastClockOut) {
        // Leave entries should have 0 effective hours
        finalEffectiveSec = 0;
    }

    return {
        date: dateStr,
        day: dayName,
        clockIn: firstClockIn ? fmt(firstClockIn) : '-',
        clockOut: lastClockOut ? fmt(lastClockOut) : '-',
        clockInTime: firstClockIn,
        clockOutTime: lastClockOut,
        rawClockIn: firstRawClockIn ? fmt(firstRawClockIn) : '-',
        rawClockOut: lastRawClockOut ? fmt(lastRawClockOut) : '-',
        rawClockInTime: firstRawClockIn,
        rawClockOutTime: lastRawClockOut,
        clockInOutPairs: clockInOutPairsFormatted,
        grossSec,
        effectiveSec: finalEffectiveSec,
        totalSec: finalEffectiveSec, // Alias for compatibility
        overtimeSec,
        breakSec,
        scheduledSec,
        totalHours: formatSeconds(finalEffectiveSec),
        breakHours: formatSeconds(breakSec),
        overtime: formatSeconds(overtimeSec),
        status: dayEntry?.status || timesheet?.status || 'draft',
        notes: dayEntry?.notes || dayEntry?.description || null,
        isOptimisticallyUpdated: false,
        isManual: isManual, // Track if entry was manually added
        isDescriptionOnly: dayEntries.some(entry => entry.isDescriptionOnly === true), // Track if description-only entry
        timesheetId: timesheet?.id || null,
        entries: dayEntries, // Include ALL entries for this date
        // Absence fields
        hasAbsence: hasAbsence,
        absenceType: absence?.leaveType || null,
        absenceLabel: absence?.leaveTypeLabel || null,
        absenceId: absence?.id || null
    };
}

/**
 * Process timesheet and session data into a complete week structure
 * @param {string} weekStartDate - Week start date (Date object or ISO string)
 * @param {Array} timesheetDocs - All timesheet documents for the user
 * @param {Array} sessionDocs - All session documents for the user
 * @param {string} userId - User ID (for week context)
 * @param {Object} schedule - Work schedule (optional)
 * @param {Map} absencesMap - Map of date strings to absence objects (optional)
 * @returns {Promise<Object>} Processed week data
 */
export async function processWeekData(weekStartDate, timesheetDocs, sessionDocs, userId, schedule = {}, absencesMap = new Map(), roundingRules = null) {
    if (!timesheetDocs) timesheetDocs = [];
    if (!sessionDocs) sessionDocs = [];

    // Get user's week start day
    const { weekStartDay } = await getUserWeekContext(userId);
    const weekStart = weekStartDay || DEFAULT_WEEK_START_DAY;

    // Convert weekStartDate to Date if needed - CRITICAL: parse as UTC to prevent timezone shift
    const weekStartDateObj = weekStartDate instanceof Date
        ? weekStartDate
        : new Date(typeof weekStartDate === 'string' && !weekStartDate.includes('T')
            ? weekStartDate + 'T00:00:00Z'
            : weekStartDate);

    // IMPORTANT: weekStartDate is already the correct week start - don't recalculate!
    // Use it directly instead of calling getWeekRangeForDate which can shift to a different week
    const start = new Date(weekStartDateObj);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    // Get ordered week dates - use UTC to prevent timezone shift
    // Get ordered week dates - use local time to respect user request
    const dates = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        dates.push(formatISODate(d));
    }

    // [UPDATED] Overlap-Aware Filtering
    // Instead of strict period matching, we accept any timesheet that OVERLAPS this week.
    // This supports "Bridge Weeks" where data might live in an old Sunday-based timesheet
    // but needs to be displayed in a new Tuesday-based view.

    const weekStartStr = formatISODate(start);
    const weekEndStr = formatISODate(end);

    let weekTimesheets = timesheetDocs.filter(ts => {
        // Strict Period Match (Optimization)
        if (dates.includes(ts.period)) return true;

        // Overlap Check: (StartA <= EndB) and (EndA >= StartB)
        // ts.start <= weekEnd AND ts.end >= weekStart
        // Use string comparison (ISO dates work fine for this)
        return (ts.start <= weekEndStr) && (ts.end >= weekStartStr);
    });

    // CRITICAL FIX: Deduplicate timesheets by period to prevent double counting
    // If multiple docs exist for the same period (e.g. race condition created duplicates),
    // keep only the most recently updated one.
    const uniqueTimesheetsMap = new Map();
    for (const ts of weekTimesheets) {
        const existing = uniqueTimesheetsMap.get(ts.period);
        if (!existing) {
            uniqueTimesheetsMap.set(ts.period, ts);
        } else {
            // Keep the one with later updatedAt
            const tsTime = safeToDate(ts.updatedAt)?.getTime() || 0;
            const existingTime = safeToDate(existing.updatedAt)?.getTime() || 0;
            if (tsTime > existingTime) {
                uniqueTimesheetsMap.set(ts.period, ts);
            }
        }
    }
    weekTimesheets = Array.from(uniqueTimesheetsMap.values());

    // [UPDATED] Find the primary weekly timesheet for this view
    // This is used for authoritative totals and status, but we will still
    // collect entries from ALL overlapping timesheets.
    const weeklyTs = weekTimesheets.find(ts => ts.period === formatISODate(weekStartDateObj));

    // ✅ CRITICAL FIX: Calculate totals from FIRESTORE documents (single source of truth)
    // We sum totals from ALL overlapping timesheets in the week (which are already deduplicated by period)
    // to ensure that both daily and weekly timesheet models are supported correctly in the summary.
    let docsToSum = weekTimesheets;

    const weekTotals = docsToSum.reduce((acc, ts) => {
        // Prefer stored totals, but calculate from entries if totals missing
        let docEffective = 0;
        let docOvertime = 0;
        let docGross = 0;

        if (ts.totals && (ts.totals.effectiveSec > 0 || ts.totals.grossSec > 0)) {
            // Use stored totals (preferred)
            docEffective = ts.totals.effectiveSec || 0;
            docOvertime = ts.totals.overtimeSec || 0;
            docGross = ts.totals.grossSec || 0;
        } else if (ts.entries && Array.isArray(ts.entries) && ts.entries.length > 0) {
            // Fallback: calculate from entries if totals missing
            ts.entries.forEach(entry => {
                docEffective += entry.effectiveSec || 0;
                docOvertime += entry.overtimeSec || 0;
                docGross += entry.grossSec || 0;
            });
        }

        return {
            effectiveSec: acc.effectiveSec + docEffective,
            overtimeSec: acc.overtimeSec + docOvertime,
            grossSec: acc.grossSec + docGross,
            breakSec: acc.breakSec + (docGross - docEffective)
        };
    }, { effectiveSec: 0, overtimeSec: 0, grossSec: 0, breakSec: 0 });

    // Filter sessions for this week
    const weekStartTime = start.getTime();
    const weekEndTime = end.getTime() + (24 * 60 * 60 * 1000); // Include end day

        const weekSessions = sessionDocs.filter(s => {
        const startedAt = safeToDate(s.startedAt);
        if (!startedAt) return false;
        const startTime = startedAt.getTime();
        return startTime >= weekStartTime && startTime < weekEndTime;
    });

    // Group sessions by date
    const sessionsByDate = {};
    for (const session of weekSessions) {
        const startedAt = safeToDate(session.startedAt);
        if (!startedAt) continue;
        const sessionDate = formatISODate(startedAt);
        if (!sessionsByDate[sessionDate]) {
            sessionsByDate[sessionDate] = [];
        }
        sessionsByDate[sessionDate].push(session);
    }

    // Group timesheets by date (one timesheet doc per day per user)
    // CRITICAL FIX: A timesheet document may contain entries for multiple dates in the same week
    // We need to look through ALL week timesheets to find entries for each specific date
    // Helper for formatting time (handles ISO and HH:mm)
    const formatTime = (timeVal) => {
        if (!timeVal) return '-';
        try {
            let date;
            if (timeVal instanceof Date) {
                date = timeVal;
            } else if (typeof timeVal === 'string') {
                if (timeVal.includes('T')) {
                    date = new Date(timeVal);
                } else if (timeVal.includes(':')) {
                    // Handle "HH:mm"
                    const [h, m] = timeVal.split(':');
                    date = new Date();
                    date.setHours(h, m, 0, 0);
                }
            }

            if (!date || isNaN(date.getTime())) return '-';

            return date.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
        } catch (e) {
            return '-';
        }
    };

    // 1. Group SAVED entries by Date (YYYY-MM-DDString)
    // CRITICAL: We aggregate ALL entries from ALL timesheets for the week
    const savedEntriesByDate = {};

    for (const ts of weekTimesheets) {
        if (ts.entries && Array.isArray(ts.entries)) {
            ts.entries.forEach(entry => {
                // Ensure we use the entry's specific date, or fallback to period
                const dateKey = entry.date || ts.period;
                if (!dateKey) return;

                if (!savedEntriesByDate[dateKey]) savedEntriesByDate[dateKey] = [];
                savedEntriesByDate[dateKey].push({
                    ...entry,
                    // Keep reference to parent timesheet for status/notes/id
                    parentStatus: ts.status,
                    parentNotes: ts.adminNotes,
                    parentTimesheetId: ts.id,
                    timesheetId: ts.id // Standard property name for services
                });
            });
        }
    }

    // Process each day
    const days = [];
    let weekEffectiveSec = 0;
    let weekOvertimeSec = 0;
    let weekBreakSec = 0;
    let weekGrossSec = 0;
    const statusCounts = { approved: 0, pending: 0, draft: 0, rejected: 0 };

    for (const dateStr of dates) {
        const dayDate = new Date(dateStr + 'T00:00:00'); // Use local time
        const dayName = dayDate.toLocaleDateString('en-US', { weekday: 'long' });

        let dailyDisplayData = [];
        let dayGrossSec = 0;
        let dayEffectiveSec = 0;
        let dayOvertimeSec = 0;
        let dayBreakSec = 0;
        let dayStatus = 'draft';
        let dayNotes = '';

        // Step 1: Filter sessions for this day
        const dailySessions = (sessionDocs || []).filter(s => {
            const start = s.startedAt?.toDate ? s.startedAt.toDate() : (s.startedAt instanceof Date ? s.startedAt : (typeof s.startedAt === 'string' ? new Date(s.startedAt) : null));
            return start && formatISODate(start) === dateStr;
        });

        // Step 2: Identify saved entries for this day
        const rawSavedEntries = savedEntriesByDate[dateStr] || [];

        if (rawSavedEntries.length > 0 || dailySessions.length > 0) {
            // we have data to show!

            // Step 3: Deduplicate and Merge (Source of Truth Logic)
            const uniqueEntriesMap = new Map();
            const claimedSessionIds = new Set();
            const timeSignatureMap = new Map();

            // A. Add saved entries (they are the primary authority)
            for (const entry of rawSavedEntries) {
                let key = entry.sessionId || entry.sessionKey || entry.id;
                if (!key && entry.sessionIds && entry.sessionIds.length > 0) key = entry.sessionIds[0];

                const startSig = entry.clockIn || entry.rawStart || 'START';
                const endSig = entry.clockOut || entry.rawEnd || 'END';
                const timeSig = `${entry.date}_${startSig}_${endSig}`;

                if (!key) key = timeSig;

                // Track claimed sessions
                if (entry.sessionId) claimedSessionIds.add(entry.sessionId);
                if (entry.sessionIds && Array.isArray(entry.sessionIds)) {
                    entry.sessionIds.forEach(id => claimedSessionIds.add(id));
                }

                uniqueEntriesMap.set(key, { ...entry, isSavedEntry: true });
                timeSignatureMap.set(timeSig, key);
            }

            // B. Add raw sessions that haven't been claimed by any saved entry
            for (const session of dailySessions) {
                if (!claimedSessionIds.has(session.id)) {
                    // This session is not yet in the timesheet doc!
                    const startTime = session.startedAt?.toDate ? session.startedAt.toDate() : (session.startedAt instanceof Date ? session.startedAt : new Date(session.startedAt));
                    const endTime = session.endedAt?.toDate ? session.endedAt.toDate() : (session.endedAt instanceof Date ? session.endedAt : (session.endedAt ? new Date(session.endedAt) : null));

                    const startSig = formatTime(startTime);
                    const endSig = endTime ? formatTime(endTime) : '-';
                    const timeSig = `${dateStr}_${startSig}_${endSig}`;

                    if (!timeSignatureMap.has(timeSig)) {
                        uniqueEntriesMap.set(session.id, {
                            ...session,
                            isSavedEntry: false,
                            isUnsynced: true,
                            // Map session fields to entry fields for uniform processing below
                            clockIn: startSig,
                            clockOut: endSig,
                            clockInTime: startTime,
                            clockOutTime: endTime,
                            rawStart: startTime.toISOString(),
                            rawEnd: endTime?.toISOString() || null,
                            grossSec: (startTime && endTime) ? (endTime.getTime() - startTime.getTime()) / 1000 : 0,
                            effectiveSec: (startTime && endTime) ? Math.max(0, ((endTime.getTime() - startTime.getTime()) / 1000) - (session.manualBreakSec || 0)) : 0,
                            notes: session.notes || ''
                        });
                        timeSignatureMap.set(timeSig, session.id);
                    }
                }
            }

            const combinedEntries = Array.from(uniqueEntriesMap.values());

            // Set Day Status: If any session is active/open, it's pending. Otherwise use parentStatus or draft.
            const hasActive = dailySessions.some(s => s.status === 'active' || s.status === 'open');
            dayStatus = hasActive ? 'pending' : (combinedEntries[0]?.parentStatus || 'draft');

            // Resolve Day Notes: Latest note from any entry
            const sortedForNotes = [...combinedEntries].sort((a, b) => {
                const getMillis = (val) => {
                    if (!val) return 0;
                    if (val.toMillis) return val.toMillis();
                    if (val.toDate) return val.toDate().getTime();
                    if (val instanceof Date) return val.getTime();
                    const d = new Date(val);
                    return isNaN(d.getTime()) ? 0 : d.getTime();
                };
                const tA = getMillis(a.editedAt || a.updatedAt);
                const tB = getMillis(b.editedAt || b.updatedAt);
                return tB - tA;
            });
            const entryWithNotes = sortedForNotes.find(e => {
                const n = e.notes || e.description || '';
                return n && String(n).trim() !== '';
            });
            dayNotes = entryWithNotes ? (entryWithNotes.notes || entryWithNotes.description || '') : (combinedEntries[0]?.parentNotes || '');

            dailyDisplayData = combinedEntries.map(entry => {
                // Accumulate totals
                if (!entry.isDescriptionOnly) {
                    dayGrossSec += (entry.grossSec || 0);
                    dayEffectiveSec += (entry.effectiveSec || 0);

                    let entryBreak = 0;
                    if (entry.manualBreakSec || entry.autoLunchBreakSec) {
                        // Use explicit breaks (manual + auto-lunch) if available
                        entryBreak = Math.max(0, (entry.manualBreakSec || 0) + (entry.autoLunchBreakSec || 0));
                    } else if (combinedEntries.length === 1 && entry.grossSec && entry.effectiveSec) {
                        // Only use gross - effective for SINGLE entries
                        // For multiple entries, don't calculate break as gross - effective
                        // Gaps will be calculated separately below
                        entryBreak = Math.max(0, entry.grossSec - entry.effectiveSec);
                    }
                    // For multiple entries, if no explicit breaks, entryBreak remains 0
                    // Gaps between entries will be added separately in the gap calculation below
                    dayBreakSec += entryBreak;
                }

                if (entry.isDescriptionOnly) {
                    return {
                        ...entry,
                        clockIn: '-',
                        clockOut: '-',
                        isEdited: true,
                        isDescriptionOnly: true,
                        status: 'approved',
                        notes: entry.notes || '',
                    };
                }

                // Standardize display for both saved and unsynced entries
                return {
                    ...entry,
                    clockIn: entry.clockIn || formatTime(entry.clockInTime),
                    clockOut: entry.clockOut || (entry.clockOutTime ? formatTime(entry.clockOutTime) : '-'),
                    isEdited: entry.isSavedEntry,
                    status: entry.isSavedEntry ? 'approved' : (entry.status || 'draft'),
                    notes: entry.notes || '',
                    description: entry.notes || entry.description || ''
                };
            });
        }

        // Calculate actual breaks between entries for multiple entries
        // This adds the time gaps between consecutive clock-out and clock-in times
        if (dailyDisplayData && dailyDisplayData.length > 1) {
            // Sort entries by clock-in time to calculate gaps correctly
            const sortedEntries = [...dailyDisplayData]
                .filter(entry => !entry.isDescriptionOnly && entry.clockInTime && entry.clockOutTime)
                .sort((a, b) => new Date(a.clockInTime) - new Date(b.clockInTime));

            // Calculate gaps between consecutive entries
            for (let i = 0; i < sortedEntries.length - 1; i++) {
                const currentEntry = sortedEntries[i];
                const nextEntry = sortedEntries[i + 1];

                const currentEnd = new Date(currentEntry.clockOutTime);
                const nextStart = new Date(nextEntry.clockInTime);

                const gapMs = nextStart.getTime() - currentEnd.getTime();
                const gapSec = Math.max(0, Math.floor(gapMs / 1000));

                // Add gap to break time (these are the actual breaks between work sessions)
                dayBreakSec += gapSec;
            }
        }

        // DYNAMIC OVERTIME: Always recalculate using live company schedule.
        // This ensures changes made by the site manager (e.g. Monday → 4h) are
        // immediately reflected in the display without needing to re-save each entry.
        {
            const targetSec = computeTargetSecondsForDay(dateStr, schedule);
            // If day has no schedule (targetSec === 0 and day IS enabled), all hours are OT.
            // If day is not in schedule at all, fall back to 8h.
            const daySchedule = schedule[dayName] || schedule[dayName?.toLowerCase()];
            const dayInSchedule = !!daySchedule;
            const effectiveTarget = dayInSchedule ? targetSec : (8 * 3600);
            dayOvertimeSec = Math.max(0, dayEffectiveSec - effectiveTarget);
        }

        // Update Status Counts
        const statusKey = (dayStatus || 'draft').toLowerCase();
        if (statusKey === 'approved') statusCounts.approved++;
        else if (statusKey === 'pending' || statusKey === 'approved-by-team') statusCounts.pending++;
        else if (statusKey === 'rejected') statusCounts.rejected++;
        else statusCounts.draft++;

        // Helper to formatting duration
        const fmtDur = (sec) => {
            const h = Math.floor(sec / 3600);
            const m = Math.floor((sec % 3600) / 60);
            return `${h}h ${String(m).padStart(2, '0')}m`;
        };

        // Check for approved absence on this day
        const absence = absencesMap.get(dateStr);
        const hasAbsence = !!absence;

        // IMPORTANT BUSINESS RULE:
        // Leave days should be DISPLAYED, but must NOT inflate paid hours.
        // Therefore: only actual worked time contributes to effectiveSec.
        let finalEffectiveSec = dayEffectiveSec;
        let finalOvertimeSec = dayOvertimeSec;

        const hasActualWorkedTime = (dayGrossSec > 0) || (dayEffectiveSec > 0);

        if (hasAbsence) {
            if (!hasActualWorkedTime) {
                // No worked time: keep paid time as 0 for the day.
                finalEffectiveSec = 0;
                finalOvertimeSec = 0;
            } else {
                // User requested to keep data in normal hours if it's saved as normal hours in DB.
                // Do not forcibly treat all worked hours on a leave day as overtime anymore.
                
                // Let's also check if there's explicit overtime saved for this day in the entries
                // to respect DB values if the dynamic recalculation changed it
                let savedOvertime = 0;
                let hasSavedEntries = false;
                if (savedEntriesByDate[dateStr] && savedEntriesByDate[dateStr].length > 0) {
                   hasSavedEntries = true;
                   savedEntriesByDate[dateStr].forEach(entry => {
                       savedOvertime += entry.overtimeSec || 0;
                   });
                   finalOvertimeSec = savedOvertime;
                }
            }
        }

        // Add to Week Totals (use finalEffectiveSec to include absence hours)
        weekEffectiveSec += finalEffectiveSec;
        weekOvertimeSec += finalOvertimeSec;
        weekBreakSec += dayBreakSec;
        weekGrossSec += dayGrossSec;

        // Construct Day Data Object (matching expected UI structure)
        days.push({
            date: dateStr,
            day: dayName,

            // Summaries
            grossSec: dayGrossSec,
            effectiveSec: finalEffectiveSec,
            overtimeSec: finalOvertimeSec,
            breakSec: dayBreakSec,

            totalHours: fmtDur(finalEffectiveSec),
            breakHours: fmtDur(dayBreakSec),
            overtime: fmtDur(finalOvertimeSec),

            status: dayStatus,
            notes: dayNotes,

            // Check if any saved entry for this day is manual or description-only
            isManual: savedEntriesByDate[dateStr]?.some(entry => entry.isManual === true) || false,
            isDescriptionOnly: savedEntriesByDate[dateStr]?.some(entry => entry.isDescriptionOnly === true) || false,

            // The List of Entries (Strictly one source)
            clockInOutPairs: dailyDisplayData,

            // Alias for compatibility
            totalSec: finalEffectiveSec,
            entries: dailyDisplayData, // Expose as entries too

            // Absence fields
            hasAbsence: hasAbsence,
            absenceType: absence?.leaveType || null,
            absenceLabel: absence?.leaveTypeLabel || null,
            absenceId: absence?.id || null
        });
    }

    // Determine week status
    let weekStatus = 'Draft';
    if (statusCounts.approved > 0) {
        weekStatus = 'Approved';
    } else if (statusCounts.pending > 0) {
        weekStatus = 'Pending';
    } else if (statusCounts.rejected > 0) {
        weekStatus = 'Rejected';
    }

    // Final Totals Override
    // Use stored gross/effective totals for consistency with List View,
    // but keep weekOvertimeSec from our live recalculation so schedule changes are reflected.
    if (weeklyTs && weeklyTs.totals && (weeklyTs.totals.effectiveSec || weeklyTs.totals.grossSec)) {
        weekGrossSec = weeklyTs.totals.grossSec || 0;
        weekEffectiveSec = weeklyTs.totals.effectiveSec || 0;
        // NOTE: overtime is intentionally NOT overridden here — we use the dynamically calculated value above.
    }

    return {
        weekKey: `${formatISODate(start)}_${formatISODate(end)}`,
        weekStart: start,
        weekEnd: end,
        startDate: formatISODate(start),
        endDate: formatISODate(end),
        dates,
        days,
        // ✅ USE FIRESTORE TOTALS (authoritative source, do NOT recalculate)
        totals: {
            effectiveSec: weekTotals.effectiveSec,
            overtimeSec: weekTotals.overtimeSec,
            breakSec: weekTotals.breakSec,
            grossSec: weekTotals.grossSec
        },
        // Keep recalculated totals for comparison/debugging (can remove later)
        recalculatedTotals: {
            effectiveSec: weekEffectiveSec,
            overtimeSec: weekOvertimeSec,
            breakSec: weekBreakSec,
            grossSec: weekGrossSec
        },
        status: weekStatus,
        statusCounts,
        entries: weekTimesheets,
        sessions: weekSessions,
        timesheetDocs: weekTimesheets // ✅ Include original documents for ViewTimesheetModal
    };
}

/**
 * Calculate totals from day rows (for modal compatibility)
 * @param {Array} days - Array of day row objects
 * @returns {Object} Totals object
 */
export function calculateWeekTotals(days) {
    const effectiveSec = days.reduce((acc, day) => acc + (day.effectiveSec || day.totalSec || 0), 0);
    const overtimeSec = days.reduce((acc, day) => acc + (day.overtimeSec || 0), 0);
    const breakSec = days.reduce((acc, day) => acc + (day.breakSec || 0), 0);
    return { effectiveSec, overtimeSec, breakSec };
}

