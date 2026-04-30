/**
 * Unified Entry Factory
 * [FIX #3] Ensures consistent schema for all timesheet entries
 * 
 * All paths that create entries should use this factory:
 * - startClock (timeClock.js)
 * - stopClock (timeClock.js)
 * - addManualTimeEntry (timesheets.js)
 * - EditTimesheetModal
 * - Session import in addManualTimeEntry
 */

import { generateEntryId } from './idUtils';

/**
 * Create a standardized timesheet entry object
 * @param {Object} params - Entry parameters
 * @returns {Object} Complete entry object with all required fields
 */
export function createTimesheetEntry({
    // Required identifiers
    id = null,
    sessionId = null,
    date, // YYYY-MM-DD format

    // Time data (HH:MM format for display, ISO for storage)
    clockIn = null,
    clockOut = null,
    rawStart = null,
    rawEnd = null,
    roundedStart = null,
    roundedEnd = null,
    rawClockIn = null,
    rawClockOut = null,

    // Duration data (in seconds)
    grossSec = 0,
    effectiveSec = 0,
    overtimeSec = 0,
    rawDurationSec = 0,
    rawEffectiveSec = 0,

    // Break data (in seconds)
    breakSec = 0,
    manualBreakSec = 0,
    autoLunchBreakSec = 0,
    autoLunchApplied = false,

    // Entry metadata
    status = 'closed', // 'open' | 'closed'
    isManual = false,
    isAuto = false,
    source = null, // 'clock' | 'manual' | 'import'

    // Context
    location = null,
    clockOutLocation = null,
    deviceInfo = null,
    clockOutDeviceInfo = null,

    // Additional data
    notes = null,
    pupilCount = null,
    assignmentId = null,
    clientId = null,

    // Deduplication keys
    sessionKey = null,
    sessionIds = null,

    // Audit fields
    editedBy = null,
    editedAt = null,
    createdAt = null,
    updatedAt = null
} = {}) {
    // Generate ID if not provided
    const entryId = id || sessionId || generateEntryId();

    // Build sessionKey and sessionIds for deduplication
    const finalSessionKey = sessionKey || sessionId || entryId;
    const finalSessionIds = sessionIds || (sessionId ? [sessionId] : [entryId]);

    // Build the complete entry object
    return {
        // Core identifiers
        id: entryId,
        sessionId: sessionId || entryId,
        date,

        // Time display (HH:MM format)
        clockIn,
        clockOut,
        rawClockIn: rawClockIn || clockIn,
        rawClockOut: rawClockOut || clockOut,

        // Time storage (ISO format)
        rawStart,
        rawEnd,
        roundedStart,
        roundedEnd,

        // Duration calculations
        grossSec,
        effectiveSec,
        overtimeSec,
        rawDurationSec: rawDurationSec || grossSec,
        rawEffectiveSec: rawEffectiveSec || effectiveSec,

        // Break information
        breakSec: breakSec || (manualBreakSec + autoLunchBreakSec),
        manualBreakSec,
        autoLunchBreakSec,
        autoLunchApplied,

        // Entry metadata
        status,
        isManual,
        isAuto,
        source: source || (isManual ? 'manual' : (isAuto ? 'import' : 'clock')),

        // Context data
        location,
        clockOutLocation,
        deviceInfo,
        clockOutDeviceInfo,

        // Additional fields
        notes,
        pupilCount,
        assignmentId,
        clientId,

        // Deduplication keys (critical for preventing duplicates)
        sessionKey: finalSessionKey,
        sessionIds: finalSessionIds,

        // Audit fields
        editedBy,
        editedAt,
        createdAt: createdAt || new Date().toISOString(),
        updatedAt: updatedAt || new Date().toISOString()
    };
}

/**
 * Create entry from a clock session document
 * @param {Object} sessionDoc - Firestore session document
 * @param {string} dateStr - Date string
 * @returns {Object} Standardized entry
 */
export function createEntryFromSession(sessionDoc, dateStr) {
    const data = sessionDoc.data?.() || sessionDoc;
    const sessionId = sessionDoc.id || data.id;

    return createTimesheetEntry({
        id: sessionId,
        sessionId,
        date: dateStr,
        sessionKey: sessionId,
        sessionIds: [sessionId],
        isAuto: true,
        source: 'import',
        status: data.status === 'open' ? 'open' : 'closed',

        // Times from session
        rawStart: data.startedAt?.toDate?.()?.toISOString() || data.startedAt,
        rawEnd: data.endedAt?.toDate?.()?.toISOString() || data.endedAt,
        roundedStart: data.roundedStartedAt?.toDate?.()?.toISOString() || data.roundedStartedAt,
        roundedEnd: data.roundedEndedAt?.toDate?.()?.toISOString() || data.roundedEndedAt,

        // Durations
        grossSec: data.durationGrossSec || 0,
        effectiveSec: data.durationEffectiveSec || 0,
        rawDurationSec: data.rawDurationGrossSec || data.durationGrossSec || 0,
        rawEffectiveSec: data.rawDurationEffectiveSec || data.durationEffectiveSec || 0,

        // Breaks
        breakSec: data.breakSec || 0,
        manualBreakSec: data.manualBreakSec || 0,
        autoLunchBreakSec: data.autoLunchBreakSec || 0,
        autoLunchApplied: data.autoLunchApplied || false,

        // Context
        location: data.location || null,
        clockOutLocation: data.clockOutLocation || null,
        deviceInfo: data.deviceInfo || null,
        clockOutDeviceInfo: data.clockOutDeviceInfo || null,

        // Additional
        notes: data.notes || null,
        pupilCount: data.pupilCount || null
    });
}

/**
 * Validate that an entry has all required fields
 * @param {Object} entry - Entry to validate
 * @returns {{ valid: boolean, missingFields: string[] }}
 */
export function validateEntrySchema(entry) {
    const requiredFields = ['id', 'date', 'sessionKey'];
    const missingFields = [];

    for (const field of requiredFields) {
        if (!entry[field]) {
            missingFields.push(field);
        }
    }

    return {
        valid: missingFields.length === 0,
        missingFields
    };
}
