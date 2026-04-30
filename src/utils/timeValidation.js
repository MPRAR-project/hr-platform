/**
 * Time Entry Validation Utilities
 * [FIX #9] Validates time entries against schedule and provides warnings
 */

/**
 * Validation result types
 */
export const VALIDATION_SEVERITY = {
    ERROR: 'error',
    WARNING: 'warning',
    INFO: 'info'
};

/**
 * Validate time entry against work schedule
 * @param {Object} params
 * @param {string} params.clockIn - Clock in time (HH:MM)
 * @param {string} params.clockOut - Clock out time (HH:MM)
 * @param {string} params.dateStr - Date string (YYYY-MM-DD)
 * @param {Object} params.schedule - Work schedule { Monday: { enabled, start, end, durationMin }, ... }
 * @returns {Array<{ severity: string, message: string, field?: string }>}
 */
export function validateTimeEntryAgainstSchedule({ clockIn, clockOut, dateStr, schedule }) {
    const validations = [];

    if (!schedule || !dateStr) {
        return validations;
    }

    // Get day name from date
    const date = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T12:00:00`);
    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
    const daySchedule = schedule[dayName] || schedule[dayName.toLowerCase()];

    // Check if day is a scheduled work day
    if (!daySchedule || !daySchedule.enabled) {
        validations.push({
            severity: VALIDATION_SEVERITY.WARNING,
            message: `${dayName} is not a scheduled work day. All hours will be overtime.`,
            field: 'date'
        });
        return validations;
    }

    // Parse schedule times
    const scheduleStart = daySchedule.start || '09:00';
    const scheduleEnd = daySchedule.end || '17:00';

    // Parse entry times
    if (clockIn && scheduleStart) {
        const [schedH, schedM] = scheduleStart.split(':').map(Number);
        const [entryH, entryM] = clockIn.split(':').map(Number);

        const schedMinutes = schedH * 60 + schedM;
        const entryMinutes = entryH * 60 + entryM;

        // Early clock-in warning (> 30 min early)
        if (entryMinutes < schedMinutes - 30) {
            const diffMin = schedMinutes - entryMinutes;
            validations.push({
                severity: VALIDATION_SEVERITY.INFO,
                message: `Clock-in is ${diffMin} minutes before scheduled start (${scheduleStart})`,
                field: 'clockIn'
            });
        }

        // Late clock-in warning (> 15 min late)
        if (entryMinutes > schedMinutes + 15) {
            const diffMin = entryMinutes - schedMinutes;
            validations.push({
                severity: VALIDATION_SEVERITY.INFO,
                message: `Clock-in is ${diffMin} minutes after scheduled start (${scheduleStart})`,
                field: 'clockIn'
            });
        }
    }

    if (clockOut && scheduleEnd) {
        const [schedH, schedM] = scheduleEnd.split(':').map(Number);
        const [entryH, entryM] = clockOut.split(':').map(Number);

        const schedMinutes = schedH * 60 + schedM;
        const entryMinutes = entryH * 60 + entryM;

        // Late clock-out warning (> 30 min after schedule end)
        if (entryMinutes > schedMinutes + 30) {
            const diffMin = entryMinutes - schedMinutes;
            validations.push({
                severity: VALIDATION_SEVERITY.WARNING,
                message: `Clock-out is ${diffMin} minutes after scheduled end (${scheduleEnd}). This may include overtime.`,
                field: 'clockOut'
            });
        }
    }

    // Calculate total duration and check for unusual length
    if (clockIn && clockOut) {
        const [inH, inM] = clockIn.split(':').map(Number);
        const [outH, outM] = clockOut.split(':').map(Number);

        const inMinutes = inH * 60 + inM;
        const outMinutes = outH * 60 + outM;
        const durationMinutes = outMinutes - inMinutes;

        if (durationMinutes > 12 * 60) {
            validations.push({
                severity: VALIDATION_SEVERITY.WARNING,
                message: `Shift duration is over 12 hours (${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m). Please verify.`,
                field: 'duration'
            });
        }

        if (durationMinutes < 15) {
            validations.push({
                severity: VALIDATION_SEVERITY.WARNING,
                message: `Shift duration is less than 15 minutes. Is this correct?`,
                field: 'duration'
            });
        }
    }

    return validations;
}

/**
 * Validate basic time entry constraints
 * @param {Object} params
 * @param {string} params.clockIn - Clock in time (HH:MM)
 * @param {string} params.clockOut - Clock out time (HH:MM)
 * @param {number} params.breakMin - Break in minutes
 * @returns {Array<{ severity: string, message: string, field: string }>}
 */
export function validateTimeEntryBasic({ clockIn, clockOut, breakMin = 0 }) {
    const errors = [];

    if (!clockIn) {
        errors.push({
            severity: VALIDATION_SEVERITY.ERROR,
            message: 'Clock-in time is required',
            field: 'clockIn'
        });
    }

    if (!clockOut) {
        errors.push({
            severity: VALIDATION_SEVERITY.ERROR,
            message: 'Clock-out time is required',
            field: 'clockOut'
        });
    }

    if (clockIn && clockOut) {
        const [inH, inM] = clockIn.split(':').map(Number);
        const [outH, outM] = clockOut.split(':').map(Number);

        const inMinutes = inH * 60 + inM;
        const outMinutes = outH * 60 + outM;

        if (outMinutes <= inMinutes) {
            errors.push({
                severity: VALIDATION_SEVERITY.ERROR,
                message: 'Clock-out must be after clock-in',
                field: 'clockOut'
            });
        }

        const durationMinutes = outMinutes - inMinutes;
        if (breakMin > durationMinutes) {
            errors.push({
                severity: VALIDATION_SEVERITY.ERROR,
                message: 'Break time cannot exceed work duration',
                field: 'breakMin'
            });
        }
    }

    return errors;
}

/**
 * Get summary of validation results
 * @param {Array} validations - Array of validation results
 * @returns {{ hasErrors: boolean, hasWarnings: boolean, errorCount: number, warningCount: number }}
 */
export function getValidationSummary(validations) {
    const errors = validations.filter(v => v.severity === VALIDATION_SEVERITY.ERROR);
    const warnings = validations.filter(v => v.severity === VALIDATION_SEVERITY.WARNING);

    return {
        hasErrors: errors.length > 0,
        hasWarnings: warnings.length > 0,
        errorCount: errors.length,
        warningCount: warnings.length
    };
}

function parseHHMMToMinutes(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return null;
    const [hStr, mStr] = timeStr.split(':');
    const h = Number(hStr);
    const m = Number(String(mStr ?? '').slice(0, 2));
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return h * 60 + m;
}

function formatMinutesAsHHMM(min) {
    if (!Number.isFinite(min)) return '';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Check if a candidate entry overlaps any existing interval.
 *
 * Overlap rule (boundaries allowed): intervals overlap iff startA < endB AND startB < endA
 * - This means 08:00-10:00 and 10:00-open is OK (touching boundary)
 * - But 11:00-16:00 conflicts with 10:00-open (open treated as infinity)
 *
 * @param {Object} params
 * @param {string} params.candidateStart - HH:MM
 * @param {string|null} params.candidateEnd - HH:MM or null (open)
 * @param {Array<{ startMin: number, endMin: number|null, label?: string }>} params.existingIntervals
 * @param {number} [params.nowMin] - current time in minutes (used for UI messaging)
 * @returns {{ hasConflict: boolean, message?: string, conflictWith?: any }}
 */
export function getTimeEntryOverlapConflict({ candidateStart, candidateEnd, existingIntervals = [], nowMin = null }) {
    const startMin = parseHHMMToMinutes(candidateStart);
    if (startMin == null) return { hasConflict: false };

    const endMinRaw = candidateEnd ? parseHHMMToMinutes(candidateEnd) : null;
    const endMin = endMinRaw == null ? Number.POSITIVE_INFINITY : endMinRaw;
    if (endMin !== Number.POSITIVE_INFINITY && endMin <= startMin) return { hasConflict: false };

    for (const iv of existingIntervals) {
        const ivStart = Number(iv?.startMin);
        if (!Number.isFinite(ivStart)) continue;
        const ivEndRaw = iv?.endMin == null ? null : Number(iv.endMin);
        const ivEnd = ivEndRaw == null ? Number.POSITIVE_INFINITY : ivEndRaw;
        if (ivEnd !== Number.POSITIVE_INFINITY && ivEnd <= ivStart) continue;

        const overlaps = startMin < ivEnd && ivStart < endMin;
        if (overlaps) {
            const left = formatMinutesAsHHMM(ivStart);
            const right = ivEnd === Number.POSITIVE_INFINITY
                ? 'Open'
                : formatMinutesAsHHMM(ivEnd);
            const suffix = iv?.label ? ` (${iv.label})` : '';
            return {
                hasConflict: true,
                message: `Time entry conflicts with existing entry (${left}-${right})${suffix}`,
                conflictWith: iv
            };
        }
    }

    // Special case messaging: candidate is inside an open interval treated as "until now"
    if (nowMin != null && Number.isFinite(nowMin) && endMin === Number.POSITIVE_INFINITY) {
        // no-op (message already handled above if it overlapped)
    }

    return { hasConflict: false };
}

/**
 * Build a normalized list of intervals (minutes) from mixed entry types.
 *
 * Supports:
 * - Saved entries: { rawClockIn/clockIn, rawClockOut/clockOut }
 * - Sessions: { startedAt, endedAt, status }
 *
 * @param {Object} params
 * @param {string} params.dateStr - YYYY-MM-DD
 * @param {Array<any>} [params.savedEntries]
 * @param {Array<any>} [params.sessions]
 * @returns {Array<{ startMin:number, endMin:number|null, label?:string }>}
 */
export function buildExistingIntervalsForDate({ dateStr, savedEntries = [], sessions = [] }) {
    const intervals = [];

    // 1) Saved timesheet entries (HH:MM)
    for (const e of savedEntries) {
        const s = e?.rawClockIn || e?.clockIn || e?.timeOn || null;
        const t = e?.rawClockOut || e?.clockOut || e?.timeOff || null;
        const sMin = parseHHMMToMinutes(s);
        const tMin = t ? parseHHMMToMinutes(t) : null;
        if (sMin == null) continue;
        if (tMin != null && tMin <= sMin) continue;
        intervals.push({
            id: e?.id || e?.entryId || null,
            sessionId: e?.sessionId || e?.sessionKey || (Array.isArray(e?.sessionIds) ? e.sessionIds[0] : null) || null,
            startMin: sMin,
            endMin: tMin,
            label: e?.isManual ? 'Manual' : undefined
        });
    }

    // 2) Clock sessions (Dates)
    for (const s of sessions) {
        const startedAt = s?.startedAt?.toDate ? s.startedAt.toDate() : (s?.startedAt instanceof Date ? s.startedAt : (s?.startedAt ? new Date(s.startedAt) : null));
        if (!startedAt || Number.isNaN(startedAt.getTime())) continue;
        const sessionDateStr = startedAt.toISOString().slice(0, 10);
        if (sessionDateStr !== dateStr) continue;

        const endedAt = s?.endedAt?.toDate ? s.endedAt.toDate() : (s?.endedAt instanceof Date ? s.endedAt : (s?.endedAt ? new Date(s.endedAt) : null));
        const startMin = startedAt.getHours() * 60 + startedAt.getMinutes();
        const endMin = endedAt && !Number.isNaN(endedAt.getTime())
            ? (endedAt.getHours() * 60 + endedAt.getMinutes())
            : null;
        if (endMin != null && endMin <= startMin) continue;

        intervals.push({
            id: s?.id || null,
            sessionId: s?.id || s?.sessionId || s?.sessionKey || null,
            startMin,
            endMin,
            label: s?.status === 'open' || endMin == null ? 'Open' : undefined
        });
    }

    return intervals;
}
