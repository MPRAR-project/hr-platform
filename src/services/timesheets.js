import { collection, doc, deleteDoc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, writeBatch, Timestamp } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, db, storage } from '../firebase/client';
import { generateEntryId } from '../utils/idUtils';
import { measureAsync } from '../hooks/usePerformanceMonitor';
import { getDefaultRoundingRules, roundSessionRange } from '../utils/timeRounding';
import {
    DEFAULT_WEEK_START_DAY,
    formatISODate as formatISODateUtil,
    getOrderedWeekDates,
    getWeekRangeForDate,
    STORAGE_ANCHOR_DAY,
    isMondayAnchorEnabled
} from '../utils/weekStartUtils';
import { resolveAutoLunchConfig } from './autoLunch';

import { resolveRoundingRules } from './roundingRules';
import { approverEmployeeRoleMatch, getManagedEmployeeIdsForManager } from './teams';
import { cacheUserTimesheets, cacheWeeklyData, getCachedUserTimesheets, getCachedWeeklyData, timesheetCache, invalidateTimesheetCache } from './timesheetCache';
export { invalidateTimesheetCache };
import { resolveWeekStartDay } from './weekStartConfig';
import { fetchApprovedAbsencesForWeek, getLeaveTypeLabel } from './timesheetAbsenceIntegration';

const COLLECTION_NAME = 'timesheets';
import { reconcileTimesheetForWeek } from './timesheetReconciler';
export { reconcileTimesheetForWeek };

export async function getTimesheetsByWeek(companyId, weekStartStr) {
    try {
        const rawId = companyId.replace('companies/', '');
        const pathId = `companies/${rawId}`;

        // 1. Initial Fetch: Overlapping Range
        // LOGIC: End >= requestedWeekStart (Catches current + overlaps)
        // We use the previously implemented 'Overlapping Read' query
        const q = query(
            collection(db, COLLECTION_NAME),
            where('companyId', 'in', [rawId, pathId]),
            where('end', '>=', weekStartStr)
        );

        const snapshot = await getDocs(q);
        const docs = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        return docs;
    } catch (error) {
        console.error('Error fetching timesheets by week:', error);
        return [];
    }
}

// ... imports
// Imports merged to top of file

/**
 * [NEW] Fetch Single User Timesheets with Self-Healing
 * Use this for the "My Timesheet" view to ensure integrity.
 */
export async function getUserTimesheetsByWeek(userId, companyId, weekStartStr) {
    // 0. Cache Check
    const cached = getCachedWeeklyData(userId, weekStartStr);
    if (cached) {
        // Cache Hit
        return cached;
    }

    // 1. Fetch Raw (Overlap) from the global pool (or user specific query)
    const rawId = companyId.replace('companies/', '');
    const pathId = `companies/${rawId}`;

    // Efficient User Query
    const q = query(
        collection(db, COLLECTION_NAME),
        where('userId', '==', userId),
        where('companyId', 'in', [rawId, pathId]),
        where('end', '>=', weekStartStr)
    );
    const snapshot = await getDocs(q);
    const userDocs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // 2. Check for Target
    const targetDoc = userDocs.find(d => d.period === weekStartStr);

    if (!targetDoc) {
        // Trigger Reconciler
        const { weekStartDay } = await getUserWeekContext(userId);
        const startDay = weekStartDay || DEFAULT_WEEK_START_DAY;
        const weekRange = getWeekRangeForDate(new Date(weekStartStr), startDay);

        // Only reconcile if the requested str actually matches the user's start day
        //(avoids infinite loops if UI requests arbitrary dates)
        if (formatISODateUtil(weekRange.start) === weekStartStr) {
            // Target missing for ${weekStartStr}. Reconciling...
            const reconciled = await reconcileTimesheetForWeek(userId, companyId, weekStartStr, startDay, formatISODateUtil(weekRange.end));
            if (reconciled && reconciled._wasCreated) {
                userDocs.push(reconciled);
            }
        }
    }

    // 3. Cache Result
    cacheWeeklyData(userId, weekStartStr, userDocs);

    return userDocs;
}




export function getTimesheetId(userId, dateStr) {
    if (!dateStr) return null;
    // Canonicalize all timesheet IDs to the start of the week (Monday)
    // to ensure all daily entries for the same week aggregate into a single document.
    const { start } = getWeekRangeForDate(dateStr, DEFAULT_WEEK_START_DAY);
    if (!start) return null;
    const ds = formatISODateUtil(start);
    return `${userId}_${ds}`;
}

export async function ensureWeeklyTimesheet(userId, dateStr, companyIdPath) {
    if (!dateStr || !userId) return null;
    const { start: weekStart, end: weekEnd } = getWeekRangeForDate(dateStr, DEFAULT_WEEK_START_DAY);
    if (!weekStart) return null;

    const weekStartStr = formatISODateUtil(weekStart);
    const weekEndStr = formatISODateUtil(weekEnd);
    const tsId = `${userId}_${weekStartStr}`;

    const docRef = doc(db, 'timesheets', tsId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
        await setDoc(docRef, {
            id: tsId,
            userId,
            companyId: companyIdPath?.includes('/') ? companyIdPath.split('/').pop() : (companyIdPath || ''),
            companyIdPath: companyIdPath?.includes('/') ? companyIdPath : `companies/${companyIdPath || ''}`,
            period: weekStartStr,
            start: weekStartStr,
            end: weekEndStr,
            weekStartDate: weekStartStr,
            weekKey: weekStartStr,
            status: 'draft',
            entries: [],
            totals: { grossSec: 0, effectiveSec: 0, overtimeSec: 0 },
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        return tsId;
    }
    return tsId;
}

const userWeekContextCache = new Map();
const companyWeekStartCache = new Map();

// Optimized user week context with better caching and timeout protection
export async function getUserWeekContext(userId, options = {}) {
    const { forceRefresh = false } = options;
    if (!userId) {
        return { companyIdPath: '', siteIdPath: '', weekStartDay: DEFAULT_WEEK_START_DAY };
    }

    // Check cache first
    if (forceRefresh) {
        userWeekContextCache.delete(userId);
    }
    if (userWeekContextCache.has(userId)) {
        console.log(`[timesheets] getUserWeekContext CACHE HIT for ${userId}`);
        return userWeekContextCache.get(userId);
    }

    // Add timeout protection
    const TIMEOUT_MS = 3000; // 3s timeout for user context fetch (more forgiving)

    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('User context fetch timeout')), TIMEOUT_MS);
    });

    const fetchPromise = (async () => {
        try {
            const userSnap = await getDoc(doc(db, 'users', userId));
            if (userSnap.exists()) {
                const data = userSnap.data();
                const companyIdPath = data.companyId || '';
                const siteIdPath = data.siteId || '';

                // Company configuration is the single source of truth for weekStartDay.
                // We resolve it once here and cache the full context.
                const weekStartDay = await resolveWeekStartDay(companyIdPath);
                const fullContext = { companyIdPath, siteIdPath, weekStartDay };
                userWeekContextCache.set(userId, fullContext);
                console.log(`[timesheets] getUserWeekContext for ${userId}:`, fullContext);
                return fullContext;
            }
        } catch (error) {
            console.warn('[timesheets] Failed to load user week context', userId, error);
        }

        const fallback = { companyIdPath: '', siteIdPath: '', weekStartDay: DEFAULT_WEEK_START_DAY };
        userWeekContextCache.set(userId, fallback);
        return fallback;
    })();

    return Promise.race([fetchPromise, timeoutPromise]);
}

async function getCompanyWeekStart(companyIdPath) {
    const key = companyIdPath || '';
    if (!key) return DEFAULT_WEEK_START_DAY;
    if (companyWeekStartCache.has(key)) {
        return companyWeekStartCache.get(key);
    }
    const day = await resolveWeekStartDay(companyIdPath, null);
    companyWeekStartCache.set(key, day);
    return day;
}

function primeUserWeekContext(userId, companyIdPath, siteIdPath, weekStartDay) {
    if (!userId) return;
    userWeekContextCache.set(userId, {
        companyIdPath: companyIdPath || '',
        siteIdPath: siteIdPath || '',
        weekStartDay: weekStartDay || DEFAULT_WEEK_START_DAY
    });
}

export function invalidateUserWeekContext(userId) {
    if (!userId) return;
    userWeekContextCache.delete(userId);
}

// Resolve company work schedule from companies/{companyId}
export async function getCompanyWorkSchedule(companyIdPath) {
    try {
        const compKey = (companyIdPath || '').includes('/') ? (companyIdPath.split('/')[1] || '') : (companyIdPath || '');
        if (!compKey) return {};
        const cSnap = await getDoc(doc(db, 'companies', compKey));
        if (cSnap.exists()) return cSnap.data().workSchedule || {};
    } catch (_) { }
    return {};
}

function weekdayNameFromISO(dateStr) {
    try {
        // Append noon to avoid timezone rollover issues with midnight UTC
        const d = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T12:00:00');
        return d.toLocaleDateString('en-US', { weekday: 'long' });
    } catch { return ''; }
}

export function computeTargetSecondsForDay(dateStr, schedule) {
    // FIXED: Use schedule duration if available, otherwise fallback
    // Any hours beyond the target for the day should be counted as overtime
    const dayName = weekdayNameFromISO(dateStr);
    // Try Titlecase (Thursday) and lowercase (thursday) keys
    const sch = schedule[dayName] || schedule[dayName.toLowerCase()];

    // If day is not enabled in schedule, return 0 (no scheduled work)
    if (!sch || sch.enabled === false) return 0;

    // Use schedule duration if available
    if (typeof sch.durationMin === 'number' && sch.durationMin > 0) {
        return sch.durationMin * 60;
    }

    // Fallback to start/end time diff
    if (sch.start && sch.end) {
        try {
            const [sH, sM] = sch.start.split(':').map(Number);
            const [eH, eM] = sch.end.split(':').map(Number);
            // Default 9-5 if parsing fails
            const startMin = (sH || 9) * 60 + (sM || 0);
            const endMin = (eH || 17) * 60 + (eM || 0);
            return Math.max(0, endMin - startMin) * 60;
        } catch (e) { console.warn('Invalid schedule time', e); }
    }

    // Ultimate fallback
    return 8 * 3600;
}

export async function upsertDailyEntry({
    userId,
    companyId,
    siteId,
    dateStr,
    sessionId,
    grossSec,
    effectiveSec,
    overtimeSec = 0,
    roundedStart = null,
    roundedEnd = null,
    rawStart = null,
    rawEnd = null,
    rawDurationSec = 0,
    rawEffectiveSec = 0,
    breakMeta = {},
    location,
    clockOutLocation,
    deviceInfo,
    clockOutDeviceInfo,
    pupilCount,
    notes,
    autoClockOut = false
}) {
    let companyIdPath = companyId || '';

    // [NEW] Use Daily Deterministic ID
    const tsId = getTimesheetId(userId, dateStr);
    const docRef = doc(db, 'timesheets', tsId);
    const snap = await getDoc(docRef);

    const now = serverTimestamp();

    // Resolve Manager and Company if missing
    let managerUserId = null;
    try {
        const userSnap = await getDoc(doc(db, 'users', userId));
        if (userSnap.exists()) {
            const userData = userSnap.data();
            managerUserId = userData.managerUserId || userData.reportsTo || null;
            if (!companyIdPath) companyIdPath = userData.companyId || '';
        }
    } catch (e) {
        console.warn('[upsertDailyEntry] Failed to get managerUserId:', e);
    }

    const schedule = await getCompanyWorkSchedule(companyIdPath || companyId || '');
    const targetSec = computeTargetSecondsForDay(dateStr, schedule);

    // Standardize Break Logic
    const manualBreakSec = Number(breakMeta.manualBreakSec) || 0;
    const autoLunchBreakSec = Number(breakMeta.autoLunchBreakSec) || 0;
    const totalBreakSec = manualBreakSec + autoLunchBreakSec;

    const finalId = sessionId || generateEntryId();

    const entryData = {
        id: finalId,
        date: dateStr,
        grossSec,
        effectiveSec,
        overtimeSec: 0, // Recalculated later
        source: 'clock',
        sessionIds: [sessionId],
        sessionKey: sessionId,
        notes: notes || null,
        roundedStart,
        roundedEnd,
        rawStart,
        rawEnd,
        rawDurationSec,
        rawEffectiveSec,
        manualBreakSec,
        autoLunchBreakSec,
        breakSec: totalBreakSec,
        autoLunchApplied: Boolean(breakMeta.autoLunchApplied),
        autoLunchThresholdHours: breakMeta.autoLunchThresholdHours || 0,
        lunchBreakMinutes: breakMeta.lunchBreakMinutes || 0,
        siteId: siteId || null,
        pupilCount: pupilCount !== undefined ? pupilCount : null,
        autoClockOut: Boolean(autoClockOut),
        editedAt: new Date().toISOString(),
    };

    // Default description if notes not provided
    if (!entryData.notes) {
        try {
            const absenceStart = new Date(dateStr);
            const absenceEnd = new Date(dateStr);
            const absences = await fetchApprovedAbsencesForWeek(userId, absenceStart, absenceEnd);
            const absenceForDay = absences.get(dateStr);
            entryData.notes = absenceForDay ? (getLeaveTypeLabel(absenceForDay.leaveType) || 'Holiday') : 'Working';
        } catch (descErr) {
            entryData.notes = 'Working';
        }
    }

    if (location) entryData.location = location;
    if (clockOutLocation) entryData.clockOutLocation = clockOutLocation;
    if (deviceInfo) entryData.deviceInfo = deviceInfo;
    if (clockOutDeviceInfo) entryData.clockOutDeviceInfo = clockOutDeviceInfo;

    if (!snap.exists()) {
        const computedOvertime = Math.max(0, (effectiveSec || 0) - targetSec);
        entryData.overtimeSec = computedOvertime;

        const { start, end } = getWeekRangeForDate(dateStr, DEFAULT_WEEK_START_DAY);
        const startStr = formatISODateUtil(start);
        const endStr = formatISODateUtil(end);

        await setDoc(docRef, {
            userId,
            companyId: companyIdPath || companyId,
            siteId,
            teamId: null,
            period: startStr,
            start: startStr,
            end: endStr,
            entries: [entryData],
            totals: { grossSec, effectiveSec, overtimeSec: computedOvertime },
            status: 'draft',
            approvals: { teamManager: null, siteManager: null, hrManager: null },
            managerUserId,
            createdAt: now,
            updatedAt: now,
            weekStartDate: startStr, // Legacy compat
            weekKey: startStr
        });
        return docRef.id;
    } else {
        const data = snap.data();
        let entries = Array.isArray(data.entries) ? [...data.entries] : [];

        const idx = entries.findIndex(e =>
            e.sessionKey === sessionId ||
            (Array.isArray(e.sessionIds) && e.sessionIds.includes(sessionId)) ||
            e.sessionId === sessionId
        );

        if (idx >= 0) {
            entries[idx] = { ...entries[idx], ...entryData };
        } else {
            entries.push(entryData);
        }

        await recalculateAndSaveEntries(docRef, entries, dateStr, targetSec, now, data.status, managerUserId, userId);
        return docRef.id;
    }
}


/** Mutates `entries` in place: recompute overtimeSec for every entry on `dateStr`. */
function applyOvertimeForDay(entries, dateStr, targetSec) {
    const dayEntries = entries.filter(e => e.date === dateStr);

    dayEntries.sort((a, b) => {
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
    for (const entry of dayEntries) {
        const eff = entry.effectiveSec || 0;
        const previousTotal = runningTotal;
        runningTotal += eff;

        const normalPortion = Math.min(eff, Math.max(0, targetSec - previousTotal));
        const overtimePortion = Math.max(0, eff - normalPortion);

        const mainIdx = entries.indexOf(entry);
        if (mainIdx >= 0) {
            entries[mainIdx] = { ...entries[mainIdx], overtimeSec: overtimePortion, editedAt: new Date().toISOString() };
        }
    }
}

// Helper to recalculate overtime and save - shared by upsertDailyEntry and updateTimeEntry
async function recalculateAndSaveEntries(ref, entries, dateStr, targetSec, now, currentStatus, managerUserId, userId) {
    applyOvertimeForDay(entries, dateStr, targetSec);

    const totals = entries.reduce((acc, e) => ({ grossSec: acc.grossSec + (e.grossSec || 0), effectiveSec: acc.effectiveSec + (e.effectiveSec || 0), overtimeSec: acc.overtimeSec + (e.overtimeSec || 0) }), { grossSec: 0, effectiveSec: 0, overtimeSec: 0 });
    // Preservation Strategy: Keep the current status as requested by the user.
    // This ensures that editing Approved remains Approved, Pending remains Pending, etc.
    const status = currentStatus || 'draft';
    // NOTE: If editing an approved timesheet, should we revert to draft? User request implies "adjust hours", likely manager doing it.
    // If Admin/Manager edits it, we might keep it or revert. Let's keep existing logic (preserve status if approved?? NO, usually edit requires re-approval or if manager edits it IS the approval).
    // For now, preserve existing status logic from upsertDailyEntry.

    // FIRE AND FORGET STRATEGY REMOVED
    // We MUST await the DB write to ensure data persistence and catch errors.
    // Returning success before write completes causes UI/Backend sync issues.
    try {
        await updateDoc(ref, { entries, totals, updatedAt: now, status, managerUserId });
        // [CACHE] Invalidate
        invalidateTimesheetCache(userId, dateStr, [dateStr], { cascade: true });

        // [PDF ARCHIVE] Automate PDF generation for approved timesheets
        if (status === 'approved') {
            const { start } = getWeekRangeForDate(dateStr, DEFAULT_WEEK_START_DAY);
            const weekStr = formatISODateUtil(start);
            // Run detached to avoid blocking the main update response
            triggerTimesheetArchive(ref.id, userId, weekStr).catch(err => {
                console.warn('[recalculateAndSaveEntries] PDF background trigger failed:', err);
            });
        }
    } catch (err) {
        console.error('[recalculateAndSaveEntries] Write Failed:', err);
        throw err; // Propagate error so UI knows it failed
    }

    const updatedTimesheet = { entries, totals, updatedAt: now, status, managerUserId, userId };

    return {
        success: true,
        message: "Update queued successfully",
        timestamp: Date.now(),
        updatedTimesheet // Return for optimistic updates
    };
}

// Safe Cloud Function Import
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase/client';

// If the Cloud Function isn't deployed in a given environment, calling it will 404.
// Cache this so we don't repeatedly spam the network/console and we can fall back to Firestore updates.
let updateTimeEntrySafeUnavailable = false;

/**
 * Update Time Entry (Converted to use Safe Cloud Function)
 * This replaces the legacy client-side "Data Avalanche" logic.
 *
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.dateStr
 * @param {string|null} params.sessionId
 * @param {string|null} params.originalClockIn
 * @param {Object} params.updates - { clockIn, clockOut, breakMin, notes }
 */
export async function updateTimeEntry({
    userId,
    dateStr,
    sessionId,
    originalClockIn,
    entryId, // New Param
    updates
}) {
    if (!userId) throw new Error('UserId is required');

    // Get current timesheet data to check status before updating
    let currentTimesheetData = null;
    let currentStatus = null; // Don't default to 'draft' yet

    try {
        const tsId = getTimesheetId(userId, dateStr);
        const tsRef = doc(db, 'timesheets', tsId);
        const tsSnap = await getDoc(tsRef);
        if (tsSnap.exists()) {
            currentTimesheetData = tsSnap.data();
            currentStatus = currentTimesheetData.status;
            console.log(`[updateTimeEntry] Fetched current timesheet status: "${currentStatus}"`);
        }
    } catch (error) {
        console.warn('[updateTimeEntry] Failed to get current timesheet status:', error);
    }

    /**
     * IMPORTANT:
     * For edit flows such as "add a clock-out to an existing open clock-in"
     * the grid UI relies on the underlying `timeClockSessions` document being
     * closed correctly (status, endedAt, durations, etc.).
     *
     * The Firestore fallback implementation already handles this by:
     * - Detecting open sessions in `timeClockSessions`
     * - Calling `stopClock` to close them
     * - Updating the linked `timesheets` entry
     *
     * The legacy Cloud Function path does not have full awareness of the
     * new unified session architecture, which can leave sessions "open"
     * even after a successful response – resulting in the UI still showing
     * "Open" instead of the new clock-out time.
     *
     * To guarantee consistent behaviour for all edit flows (especially the
     * one the UI exposes), we now route ALL updates through the Firestore
     * fallback path first. This keeps behaviour local and deterministic and
     * still preserves status/PDF invalidation logic.
     */
    return await updateTimeEntryFirestoreFallback({
        userId,
        dateStr,
        sessionId,
        entryId,
        updates,
        currentStatus,
        currentTimesheetData
    });

    // NOTE: The Cloud Function based path is retained below for reference,
    // but is currently bypassed by the early return above. If in future the
    // Cloud Function is updated to fully support the unified session model,
    // this early return can be removed to re-enable the remote path.

    // Call the Safe Cloud Function if available (currently bypassed by early return).
    // If it's not deployed (404), we fall back to a Firestore-only update path.
    const updateTimeEntrySafe = updateTimeEntrySafeUnavailable ? null : httpsCallable(functions, 'updateTimeEntrySafe');

    try {
        if (!updateTimeEntrySafe) {
            return await updateTimeEntryFirestoreFallback({
                userId,
                dateStr,
                sessionId,
                entryId,
                updates,
                currentStatus: currentStatus,
                currentTimesheetData
            });
        }

        // Add timeout wrapper for API calls
        const withTimeout = (promise, timeoutMs = 3000) => {
            return Promise.race([
                promise,
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Operation timeout after ${timeoutMs}ms`)), timeoutMs)
                )
            ]);
        };

        try {
            const result = await withTimeout(updateTimeEntrySafe({
                userId,
                dateStr,
                sessionId,
                originalClockIn,
                entryId,
                updates,
                currentStatus: currentStatus,
                currentTimesheetData
            }), 3000);

            const response = result.data;
            if (!response || !response.success) {
                throw new Error(response?.error || 'Unknown error during safe update');
            }

            if (currentStatus === 'approved') {
                const tsId = getTimesheetId(userId, dateStr); // Ensure tsId is available
                const { start } = getWeekRangeForDate(dateStr, DEFAULT_WEEK_START_DAY);
                const weekStr = formatISODateUtil(start);
                triggerTimesheetArchive(tsId, userId, weekStr).catch(() => { });
            }

            // Invalidate stored PDF URL so Timesheet Browser doesn't show stale PDFs
            try {
                const tsId = getTimesheetId(userId, dateStr);
                const tsRef = doc(db, 'timesheets', tsId);
                await updateDoc(tsRef, {
                    pdfUrl: null,
                    pdfGeneratedAt: null,
                    pdfForUpdatedAt: null,
                    pdfGenerationFailed: false,
                    pdfError: null
                });
            } catch (e) {
                console.warn('[updateTimeEntry] Failed to invalidate pdfUrl (non-blocking):', e);
            }

            return response;
        } catch (timeoutError) {
            if (timeoutError.message.includes('timeout')) {
                console.warn('[updateTimeEntry] Cloud function timeout, falling back to direct Firestore');
                // Fall through to fallback method below
            } else {
                throw timeoutError;
            }
        }
    } catch (error) {
        const msg = String(error?.message || error || '');
        const code = error?.code ? String(error.code) : '';
        const isMissingFunction = msg.includes('404') || msg.includes('Not Found') || code.includes('functions/not-found');
        const isEntryNotFound = msg.toLowerCase().includes('time entry not found') || msg.toLowerCase().includes('entry not found');

        if (isMissingFunction) {
            updateTimeEntrySafeUnavailable = true;
            console.warn('[timesheets] updateTimeEntrySafe not available (404). Falling back to Firestore updates.');
        } else {
            console.error('[timesheets] Safe Update Failed:', error);
        }

        if (isMissingFunction || isEntryNotFound) {
            try {
                const fallback = await updateTimeEntryFirestoreFallback({
                    userId,
                    dateStr,
                    sessionId,
                    entryId,
                    updates,
                    currentStatus: currentStatus,
                    currentTimesheetData: currentTimesheetData
                });

                // Invalidate stored PDF URL so Timesheet Browser doesn't show stale PDFs
                try {
                    const tsId = getTimesheetId(userId, dateStr);
                    const tsRef = doc(db, 'timesheets', tsId);
                    await updateDoc(tsRef, {
                        pdfUrl: null,
                        pdfGeneratedAt: null,
                        pdfForUpdatedAt: null,
                        pdfGenerationFailed: false,
                        pdfError: null
                    });
                    if (String(currentStatus || '').toLowerCase() === 'approved') {
                        const { start } = getWeekRangeForDate(dateStr, DEFAULT_WEEK_START_DAY);
                        const weekStr = formatISODateUtil(start);
                        triggerTimesheetArchive(tsId, userId, weekStr).catch(() => { });
                    }
                } catch (e) {
                    console.warn('[updateTimeEntry] Failed to invalidate/regenerate PDF (non-blocking):', e);
                }

                return fallback;
            } catch (fallbackErr) {
                console.error('[timesheets] Fallback Update Failed:', fallbackErr);
                throw error;
            }
        }

        throw error;
    }
}

function findTimesheetEntryIndex(entries, sessionId, entryId) {
    const targetKey = entryId || sessionId;
    return entries.findIndex(e => {
        if (targetKey && (
            e.id === targetKey ||
            e.sessionId === targetKey ||
            e.sessionKey === targetKey ||
            (Array.isArray(e.sessionIds) && e.sessionIds.includes(targetKey))
        )) {
            return true;
        }
        if (sessionId && (
            e.sessionId === sessionId ||
            e.sessionKey === sessionId ||
            (Array.isArray(e.sessionIds) && e.sessionIds.includes(sessionId))
        )) {
            return true;
        }
        return false;
    });
}

function applyEntryClockPatch(base, updates, roundingRules) {
    const patched = { ...base };
    const clockInISO = updates?.clockIn || null;
    const clockOutISO = updates?.clockOut || null;
    const breakMin = Number(updates?.breakMin ?? 0) || 0;
    const breakSec = Math.max(0, breakMin * 60);

    const toHM = (iso) => {
        if (!iso) return patched.clockIn || '';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        const h = String(d.getHours()).padStart(2, '0');
        const m = String(d.getMinutes()).padStart(2, '0');
        return `${h}:${m}`;
    };

    let grossSec = Number(patched.grossSec) || 0;
    let effectiveSec = Number(patched.effectiveSec) || 0;

    if (clockInISO && clockOutISO) {
        const start = new Date(clockInISO);
        const end = new Date(clockOutISO);
        if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
            const { roundedStart, roundedEnd } = roundSessionRange(start, end, roundingRules);
            grossSec = Math.max(0, Math.floor((roundedEnd.getTime() - roundedStart.getTime()) / 1000));
            effectiveSec = Math.max(0, grossSec - breakSec);
            patched.rawStart = clockInISO;
            patched.rawEnd = clockOutISO;
            patched.rawClockIn = toHM(clockInISO);
            patched.rawClockOut = toHM(clockOutISO);
            patched.roundedStart = roundedStart.toISOString();
            patched.roundedEnd = roundedEnd.toISOString();
            patched.clockIn = toHM(roundedStart.toISOString());
            patched.clockOut = toHM(roundedEnd.toISOString());
        }
    } else {
        patched.clockIn = clockInISO ? toHM(clockInISO) : patched.clockIn;
        patched.clockOut = clockOutISO ? toHM(clockOutISO) : patched.clockOut;
        patched.roundedStart = clockInISO || patched.roundedStart || null;
        patched.roundedEnd = clockOutISO || patched.roundedEnd || null;
        patched.rawStart = clockInISO || patched.rawStart || null;
        patched.rawEnd = clockOutISO || patched.rawEnd || null;
    }

    patched.grossSec = grossSec;
    patched.effectiveSec = effectiveSec;
    // Only set manualBreakSec, not breakSec to avoid double-counting
    // manualBreakSec is the primary field used by weekDataProcessor
    patched.manualBreakSec = breakSec;
    if (updates && Object.prototype.hasOwnProperty.call(updates, 'notes')) {
        if (updates.notes !== undefined) {
            const n = updates.notes || '';
            patched.notes = n;
            patched.description = n;
            console.log(`[updateTimeEntryFirestoreFallback] Updated description to: "${n}"`);
        }
    }
    patched.editedAt = new Date().toISOString();
    patched.updatedAt = new Date().toISOString();
    return patched;
}

async function syncSessionAfterTimesheetEntryUpdate(sessionId, updates, roundingRules, patched) {
    const shouldTry = sessionId && typeof sessionId === 'string' && !sessionId.startsWith('manual_') && !sessionId.startsWith('entry_');
    if (!shouldTry) return;

    const breakSec = patched.breakSec || 0;
    const clockInISO = updates?.clockIn || null;
    const clockOutISO = updates?.clockOut || null;
    const grossSec = patched.grossSec || 0;
    const effectiveSec = patched.effectiveSec || 0;

    try {
        const sessRef = doc(db, 'timeClockSessions', sessionId);
        const sessSnap = await getDoc(sessRef);
        if (!sessSnap.exists()) return;

        const sessionPatch = {
            editedAt: serverTimestamp(),
            manualBreakSec: breakSec
            // Don't set breakSec to avoid double-counting
        };
        if (clockInISO && clockOutISO) {
            const start = new Date(clockInISO);
            const end = new Date(clockOutISO);
            if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
                const { roundedStart: rs, roundedEnd: re } = roundSessionRange(start, end, roundingRules);
                sessionPatch.startedAt = Timestamp.fromDate(start);
                sessionPatch.endedAt = Timestamp.fromDate(end);
                sessionPatch.roundedStartedAt = Timestamp.fromDate(rs);
                sessionPatch.roundedEndedAt = Timestamp.fromDate(re);
                sessionPatch.durationGrossSec = grossSec;
                sessionPatch.durationEffectiveSec = effectiveSec;
                const rawGross = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
                sessionPatch.rawDurationGrossSec = rawGross;
                sessionPatch.rawDurationEffectiveSec = Math.max(0, rawGross - breakSec);
            }
        } else {
            if (clockInISO) sessionPatch.startedAt = Timestamp.fromDate(new Date(clockInISO));
            if (clockOutISO) sessionPatch.endedAt = Timestamp.fromDate(new Date(clockOutISO));
        }
        if (updates && Object.prototype.hasOwnProperty.call(updates, 'notes')) sessionPatch.notes = updates.notes || '';
        await updateDoc(sessRef, sessionPatch);
    } catch (e) {
        console.warn('[timesheets] Session update fallback failed (non-blocking):', e);
    }
}

/**
 * Apply multiple entry updates for one calendar day in one timesheet read + one write + parallel session sync.
 * Used by saveWeekEdits when several sessions on the same day are edited at once.
 */
async function batchUpdateTimeEntriesForDay(userId, dateStr, dayEdits, createDateTimeFromStrings) {
    if (!dayEdits?.length) {
        return { success: true, affected: 0, updatedTimesheet: null };
    }

    const tsId = getTimesheetId(userId, dateStr);
    const tsRef = doc(db, 'timesheets', tsId);
    const tsSnap = await getDoc(tsRef);
    if (!tsSnap.exists()) {
        throw new Error('Timesheet not found for date: ' + dateStr);
    }
    const data = tsSnap.data() || {};
    const entries = [...(data.entries || [])];

    let companyIdPath = data.companyIdPath || data.companyId || '';
    if (!companyIdPath) {
        try {
            const ctx = await getUserWeekContext(userId);
            companyIdPath = ctx?.companyIdPath || '';
        } catch (_) {
        }
    }

    let roundingRules = getDefaultRoundingRules();
    try {
        roundingRules = await resolveRoundingRules(companyIdPath);
    } catch (e) {
        console.warn('[batchUpdateTimeEntriesForDay] Rounding rules fetch failed:', e);
    }

    const patchPayloads = [];
    for (const edit of dayEdits) {
        let clockInISO = undefined;
        let clockOutISO = undefined;
        if (edit.clockIn) {
            const d = createDateTimeFromStrings(edit.date, edit.clockIn);
            if (!isNaN(d.getTime())) clockInISO = d.toISOString();
        }
        if (edit.clockOut) {
            const d = createDateTimeFromStrings(edit.date, edit.clockOut);
            if (!isNaN(d.getTime())) clockOutISO = d.toISOString();
        }
        const updates = {
            clockIn: clockInISO,
            clockOut: clockOutISO,
            breakMin: edit.breakMin,
            notes: edit.notes || edit.description
        };

        const idx = findTimesheetEntryIndex(entries, edit.sessionId, edit.entryId);
        if (idx < 0) {
            throw new Error(`Time entry not found for batch update: ${edit.entryId || edit.sessionId}`);
        }
        const patched = applyEntryClockPatch({ ...entries[idx] }, updates, roundingRules);
        entries[idx] = patched;
        patchPayloads.push({ sessionId: edit.sessionId, updates, patched });
    }

    let schedule = {};
    try {
        schedule = await getCompanyWorkSchedule(companyIdPath || '');
    } catch (_) {
    }
    const targetSec = computeTargetSecondsForDay(dateStr, schedule);
    const now = serverTimestamp();
    const managerUserId = data.managerUserId || null;

    let statusToSave = data.status || 'draft';
    const currentStatusLower = String(data.status || '').toLowerCase();

    if (currentStatusLower === 'approved') {
        try {
            const currentUserRef = doc(db, 'users', userId);
            const currentUserSnap = await getDoc(currentUserRef);
            if (currentUserSnap.exists()) {
                const currentUserData = currentUserSnap.data();
                const userRole = (currentUserData.primaryRole || currentUserData.role || '').toLowerCase();
                const isSeniorRole = userRole.includes('admin') ||
                    userRole.includes('hr') ||
                    userRole.includes('site') ||
                    userRole.includes('senior') ||
                    userRole.includes('manager') ||
                    userRole.includes('advisor');
                if (isSeniorRole) {
                    statusToSave = 'approved';
                }
            }
        } catch (error) {
            console.warn('[batchUpdateTimeEntriesForDay] Failed to check user role:', error);
        }
    }

    await recalculateAndSaveEntries(tsRef, entries, dateStr, targetSec, now, statusToSave, managerUserId, userId);

    await Promise.all(patchPayloads.map(({ sessionId, updates, patched }) =>
        syncSessionAfterTimesheetEntryUpdate(sessionId, updates, roundingRules, patched)
    ));

    return {
        success: true,
        updatedTimesheet: { ...data, entries },
        fallback: true
    };
}

/**
 * One read + one write for ALL edits in a week. The weekly timesheet id is shared across days;
 * batching avoids any remaining races (e.g. parallel deletes vs save, or rapid overlapping writes).
 */
async function mergeAndSaveWeekUpdates(userId, dayEdits, createDateTimeFromStrings) {
    if (!dayEdits?.length) {
        return { success: true, affected: 0, updatedTimesheet: null };
    }

    const tsIdSet = new Set(dayEdits.map((e) => getTimesheetId(userId, e.date)));
    if (tsIdSet.size !== 1) {
        throw new Error('Timesheet edits must belong to a single week; mixed document IDs: ' + [...tsIdSet].join(', '));
    }
    const tsId = [...tsIdSet][0];
    const tsRef = doc(db, 'timesheets', tsId);
    const tsSnap = await getDoc(tsRef);
    if (!tsSnap.exists()) {
        throw new Error('Timesheet not found for merge save');
    }
    const data = tsSnap.data() || {};
    const entries = [...(data.entries || [])];

    let companyIdPath = data.companyIdPath || data.companyId || '';
    if (!companyIdPath) {
        try {
            const ctx = await getUserWeekContext(userId);
            companyIdPath = ctx?.companyIdPath || '';
        } catch (_) {
        }
    }

    let roundingRules = getDefaultRoundingRules();
    try {
        roundingRules = await resolveRoundingRules(companyIdPath);
    } catch (e) {
        console.warn('[mergeAndSaveWeekUpdates] Rounding rules fetch failed:', e);
    }

    const patchPayloads = [];
    for (const edit of dayEdits) {
        let clockInISO = undefined;
        let clockOutISO = undefined;
        if (edit.clockIn) {
            const d = createDateTimeFromStrings(edit.date, edit.clockIn);
            if (!isNaN(d.getTime())) clockInISO = d.toISOString();
        }
        if (edit.clockOut) {
            const d = createDateTimeFromStrings(edit.date, edit.clockOut);
            if (!isNaN(d.getTime())) clockOutISO = d.toISOString();
        }
        const updates = {
            clockIn: clockInISO,
            clockOut: clockOutISO,
            breakMin: edit.breakMin,
            notes: edit.notes || edit.description
        };

        const idx = findTimesheetEntryIndex(entries, edit.sessionId, edit.entryId);
        if (idx < 0) {
            throw new Error(`Time entry not found for merge save: ${edit.entryId || edit.sessionId}`);
        }
        const patched = applyEntryClockPatch({ ...entries[idx] }, updates, roundingRules);
        entries[idx] = patched;
        patchPayloads.push({ sessionId: edit.sessionId, updates, patched });
    }

    let schedule = {};
    try {
        schedule = await getCompanyWorkSchedule(companyIdPath || '');
    } catch (_) {
    }

    const affectedDates = [...new Set(dayEdits.map((e) => e.date))].sort();
    for (const d of affectedDates) {
        const targetSec = computeTargetSecondsForDay(d, schedule);
        applyOvertimeForDay(entries, d, targetSec);
    }

    const totals = entries.reduce(
        (acc, e) => ({
            grossSec: acc.grossSec + (e.grossSec || 0),
            effectiveSec: acc.effectiveSec + (e.effectiveSec || 0),
            overtimeSec: acc.overtimeSec + (e.overtimeSec || 0)
        }),
        { grossSec: 0, effectiveSec: 0, overtimeSec: 0 }
    );

    const now = serverTimestamp();
    const managerUserId = data.managerUserId || null;

    let statusToSave = data.status || 'draft';
    const currentStatusLower = String(data.status || '').toLowerCase();

    if (currentStatusLower === 'approved') {
        try {
            const currentUserRef = doc(db, 'users', userId);
            const currentUserSnap = await getDoc(currentUserRef);
            if (currentUserSnap.exists()) {
                const currentUserData = currentUserSnap.data();
                const userRole = (currentUserData.primaryRole || currentUserData.role || '').toLowerCase();
                const isSeniorRole =
                    userRole.includes('admin') ||
                    userRole.includes('hr') ||
                    userRole.includes('site') ||
                    userRole.includes('senior') ||
                    userRole.includes('manager') ||
                    userRole.includes('advisor');
                if (isSeniorRole) {
                    statusToSave = 'approved';
                }
            }
        } catch (error) {
            console.warn('[mergeAndSaveWeekUpdates] Failed to check user role:', error);
        }
    }

    const status = statusToSave;
    try {
        await updateDoc(tsRef, { entries, totals, updatedAt: now, status, managerUserId });
        const weekHint = affectedDates[0];
        const { start } = getWeekRangeForDate(weekHint, DEFAULT_WEEK_START_DAY);
        const weekStartStr = formatISODateUtil(start);
        invalidateTimesheetCache(userId, weekStartStr, affectedDates, { cascade: true });

        if (status === 'approved') {
            triggerTimesheetArchive(tsId, userId, weekStartStr).catch((err) => {
                console.warn('[mergeAndSaveWeekUpdates] PDF background trigger failed:', err);
            });
        }
    } catch (err) {
        console.error('[mergeAndSaveWeekUpdates] Write failed:', err);
        throw err;
    }

    await Promise.all(
        patchPayloads.map(({ sessionId, updates, patched }) =>
            syncSessionAfterTimesheetEntryUpdate(sessionId, updates, roundingRules, patched)
        )
    );

    console.log('[mergeAndSaveWeekUpdates] Single merged write', { tsId, daysTouched: affectedDates.length, entryPatches: patchPayloads.length });

    return {
        success: true,
        updatedTimesheet: { ...data, entries },
        fallback: true
    };
}

async function updateTimeEntryFirestoreFallback({ userId, dateStr, sessionId, entryId, updates, currentStatus = 'draft', currentTimesheetData = null }) {
    if (!userId) throw new Error('UserId is required');
    if (!dateStr) throw new Error('dateStr is required');

    console.log(`[updateTimeEntryFirestoreFallback] Starting update:`, {
        userId,
        dateStr,
        sessionId,
        entryId,
        updates,
        currentStatus,
        hasCurrentTimesheetData: !!currentTimesheetData
    });

    // Add timeout for fallback operations
    const withTimeout = (promise, timeoutMs = 3000) => {
        return Promise.race([
            promise,
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Fallback operation timeout after ${timeoutMs}ms`)), timeoutMs)
            )
        ]);
    };

    const tsId = getTimesheetId(userId, dateStr);
    const tsRef = doc(db, 'timesheets', tsId);

    let data;
    if (currentTimesheetData && Array.isArray(currentTimesheetData.entries)) {
        data = { ...currentTimesheetData };
    } else {
        const tsSnap = await withTimeout(getDoc(tsRef), 2000);
        if (!tsSnap.exists()) {
            throw new Error('Timesheet not found for date: ' + dateStr);
        }
        data = tsSnap.data() || {};
    }
    const entries = Array.isArray(data.entries) ? [...data.entries] : [];

    console.log(`[updateTimeEntryFirestoreFallback] Timesheet data:`, {
        status: data.status,
        entryCount: entries.length,
        hasUpdates: !!updates,
        updateKeys: updates ? Object.keys(updates) : []
    });

    const targetKey = entryId || sessionId;

    // Check if this is an open session that needs to be handled differently
    // Open sessions are stored in timeClockSessions collection, not in timesheet.entries
    if (targetKey) {
        try {
            // Import here to avoid circular dependency
            const { doc: docFn, getDoc: getDocFn } = await import('firebase/firestore');
            const sessionRef = docFn(db, 'timeClockSessions', targetKey);
            const sessionSnap = await withTimeout(getDocFn(sessionRef), 1500);

            if (sessionSnap.exists()) {
                const sessionData = sessionSnap.data();

                // This is an open session - handle different update scenarios
                if (sessionData.status === 'open' && !sessionData.endedAt) {
                    if (updates?.clockIn && !updates?.clockOut) {
                        // Only updating start time, keep session open
                        const { doc: docFn2, updateDoc: updateDocFn, Timestamp } = await import('firebase/firestore');
                        const sessionRef2 = docFn2(db, 'timeClockSessions', targetKey);

                        const clockInTime = new Date(updates.clockIn);
                        const updateData = {
                            startedAt: clockInTime,
                            roundedStartedAt: clockInTime,
                            updatedAt: new Date(),
                            notes: updates.notes || sessionData.notes || ''
                        };

                        // CRITICAL: Also update break time if provided
                        if (updates.breakMin !== undefined) {
                            const breakSec = Math.max(0, Number(updates.breakMin) * 60);
                            updateData.manualBreakSec = breakSec;
                            updateData.breakSec = breakSec;
                        }

                        // Update duration calculations if needed
                        if (sessionData.startedAt) {
                            const originalStart = sessionData.startedAt.toDate ? sessionData.startedAt.toDate() : new Date(sessionData.startedAt.seconds * 1000);
                            const durationDiff = clockInTime.getTime() - originalStart.getTime();

                            // Update any duration fields if they exist
                            if (sessionData.durationGrossSec !== undefined) {
                                updateData.durationGrossSec = Math.max(0, (sessionData.durationGrossSec || 0) + durationDiff / 1000);
                            }
                            if (sessionData.durationEffectiveSec !== undefined) {
                                updateData.durationEffectiveSec = Math.max(0, (sessionData.durationEffectiveSec || 0) + durationDiff / 1000);
                            }
                        }

                        await updateDocFn(sessionRef2, updateData);

                        return { success: true, message: 'Start time updated successfully' };
                    } else if (updates?.clockOut) {
                        // Providing clock out time - close the session
                        const { stopClock } = await import('./timeClock');

                        const clockOutTime = new Date(updates.clockOut);
                        // `updates.breakMin` is already in minutes from the UI.
                        // Convert minutes -> seconds for storage/stopClock.
                        const breakMinutes = Number(updates.breakMin ?? 0) || 0;
                        const breakSec = Math.max(0, Math.round(breakMinutes * 60));

                        const result = await stopClock({
                            userId,
                            sessionId: targetKey,
                            breakSec,
                            endedAt: clockOutTime,
                            notes: updates.notes || ''
                        });

                        return result;
                    } else {
                        // No clock times provided, just updating notes/other fields
                        const { doc: docFn2, updateDoc: updateDocFn } = await import('firebase/firestore');
                        const sessionRef2 = docFn2(db, 'timeClockSessions', targetKey);

                        const updateData = {};
                        if (updates.notes !== undefined) {
                            updateData.notes = updates.notes;
                        }
                        if (updates.breakMin !== undefined) {
                            updateData.manualBreakSec = updates.breakMin * 60;
                            // CRITICAL: Also update breakSec so dashboard displays correct break time
                            updateData.breakSec = updates.breakMin * 60;
                        }
                        updateData.updatedAt = new Date();

                        await updateDocFn(sessionRef2, updateData);

                        return { success: true, message: 'Session updated successfully' };
                    }
                }
            }
        } catch (sessionError) {
            // Continue with normal lookup if session check fails
        }
    }

    const idx = findTimesheetEntryIndex(entries, sessionId, entryId);

    if (idx < 0) {
        throw new Error('Time entry not found. Update failed.');
    }

    let companyIdPath = data.companyIdPath || data.companyId || '';
    if (!companyIdPath) {
        try {
            const ctx = await getUserWeekContext(userId);
            companyIdPath = ctx?.companyIdPath || '';
        } catch (_) {
        }
    }

    let roundingRules = getDefaultRoundingRules();
    try {
        roundingRules = await resolveRoundingRules(companyIdPath);
    } catch (e) {
        console.warn('[updateTimeEntryFirestoreFallback] Rounding rules fetch failed:', e);
    }

    const patched = applyEntryClockPatch({ ...entries[idx] }, updates, roundingRules);
    entries[idx] = patched;

    let schedule = {};
    try {
        schedule = await getCompanyWorkSchedule(companyIdPath || '');
    } catch (_) {
    }
    const targetSec = computeTargetSecondsForDay(dateStr, schedule);

    const now = serverTimestamp();
    const managerUserId = data.managerUserId || null;

    // Preserve approved status for senior users when updating approved timesheets
    let statusToSave = currentStatus || data.status || 'draft';
    const currentStatusLower = String(currentStatus || data.status || '').toLowerCase();

    console.log(`[updateTimeEntryFirestoreFallback] Status analysis:`, {
        passedCurrentStatus: currentStatus,
        dataStatus: data.status,
        statusToSave: statusToSave,
        currentStatusLower: currentStatusLower
    });

    // Check if this is an approved timesheet being updated by a senior user
    if (currentStatusLower === 'approved') {
        try {
            // Get the current user's role to check if they're a senior user
            const { getDoc, doc: docFn } = await import('firebase/firestore');
            const currentUserRef = docFn(db, 'users', userId);
            const currentUserSnap = await withTimeout(getDoc(currentUserRef), 1500);

            if (currentUserSnap.exists()) {
                const currentUserData = currentUserSnap.data();
                const userRole = (currentUserData.primaryRole || currentUserData.role || '').toLowerCase();

                console.log(`[updateTimeEntryFirestoreFallback] User role check: "${userRole}"`);

                // Check if user has senior role that can edit approved timesheets
                const isSeniorRole = userRole.includes('admin') ||
                    userRole.includes('hr') ||
                    userRole.includes('site') ||
                    userRole.includes('senior') ||
                    userRole.includes('manager') ||
                    userRole.includes('advisor');

                if (isSeniorRole) {
                    // Preserve the approved status for senior users
                    statusToSave = 'approved';
                    console.log(`[updateTimeEntryFirestoreFallback] ✓ Preserving 'approved' status for senior user: ${userRole}`);
                } else {
                    console.log(`[updateTimeEntryFirestoreFallback] User role "${userRole}" is not senior enough to preserve approved status`);
                }
            } else {
                console.log(`[updateTimeEntryFirestoreFallback] User document not found for userId: ${userId}`);
            }
        } catch (error) {
            console.warn('[updateTimeEntryFirestoreFallback] Failed to check user role, using default status:', error);
        }
    }

    console.log(`[updateTimeEntryFirestoreFallback] Final status decision - Current: ${currentStatusLower}, To Save: ${statusToSave}`);

    await recalculateAndSaveEntries(tsRef, entries, dateStr, targetSec, now, statusToSave, managerUserId, userId);

    await syncSessionAfterTimesheetEntryUpdate(sessionId, updates, roundingRules, patched);

    return {
        success: true,
        updatedTimesheet: { ...data, entries },
        fallback: true
    };
}



/**
 * updateEntryDescription
 * Directly patches the `notes` / `description` field on a timesheet entry in Firestore.
 * Does NOT call the Cloud Function — safe for description-only entries that have no clock-in time.
 *
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.dateStr    - ISO date "YYYY-MM-DD"
 * @param {string} params.entryId   - The entry's `id` field stored in timesheets.entries[]
 * @param {string} params.notes     - New notes/description text (empty string = clear)
 * @param {string} [params.weekStartDay]
 */
export async function updateEntryDescription({ userId, dateStr, entryId, notes, weekStartDay }) {
    if (!userId) throw new Error('userId is required');
    if (!dateStr) throw new Error('dateStr is required');
    if (!entryId) throw new Error('entryId is required');

    const { weekStartDay: contextWeekStartDay } = await getUserWeekContext(userId);
    const effectiveWeekStartDay = contextWeekStartDay || weekStartDay || DEFAULT_WEEK_START_DAY;

    // Locate the timesheet document
    const timesheetId = getTimesheetId(userId, dateStr, effectiveWeekStartDay);
    const timesheetRef = doc(db, 'timesheets', timesheetId);
    const timesheetSnap = await getDoc(timesheetRef);

    const patchEntry = (entries) => {
        const idx = entries.findIndex(e => e.id === entryId || e.sessionId === entryId || e.sessionKey === entryId);
        if (idx < 0) throw new Error('Entry not found: ' + entryId);
        entries[idx] = { ...entries[idx], notes: notes || '', description: notes || '', updatedAt: new Date().toISOString() };
        return entries;
    };

    if (!timesheetSnap.exists()) {
        // Fallback: search by userId + date range (overlap query)
        const q = query(
            collection(db, 'timesheets'),
            where('userId', '==', userId),
            where('end', '>=', dateStr)
        );
        const rawResults = await getDocs(q);
        const filteredDocs = rawResults.docs.filter(d => d.data().start <= dateStr);
        const results = { empty: filteredDocs.length === 0, docs: filteredDocs };
        if (results.empty) throw new Error('Timesheet not found for date: ' + dateStr);
        const fallbackRef = results.docs[0].ref;
        const fallbackEntries = patchEntry([...(results.docs[0].data().entries || [])]);
        await updateDoc(fallbackRef, { entries: fallbackEntries, updatedAt: serverTimestamp() });
        invalidateTimesheetCache(userId, dateStr);
        return { success: true };
    }

    const entries = patchEntry([...(timesheetSnap.data().entries || [])]);
    await updateDoc(timesheetRef, { entries, updatedAt: serverTimestamp() });
    invalidateTimesheetCache(userId, dateStr);
    return { success: true };
}

/**
 * updateDayDescription
 * Updates the notes and description for ALL entries on a specific date.
 * Also handles cleanup of description-only entries if their content is cleared.
 * This prevents race conditions when a user clears/updates all sessions for a day.
 * */
export async function updateDayDescription({ userId, dateStr, notes, weekStartDay }) {
    if (!userId) throw new Error('userId is required');
    if (!dateStr) throw new Error('dateStr is required');

    const { weekStartDay: contextWeekStartDay } = await getUserWeekContext(userId);
    const effectiveWeekStartDay = contextWeekStartDay || weekStartDay || DEFAULT_WEEK_START_DAY;
    const { start: weekStartForPdf } = getWeekRangeForDate(dateStr, DEFAULT_WEEK_START_DAY);
    const weekStrForPdf = formatISODateUtil(weekStartForPdf);

    const timesheetId = getTimesheetId(userId, dateStr, effectiveWeekStartDay);
    const timesheetRef = doc(db, 'timesheets', timesheetId);
    const timesheetSnap = await getDoc(timesheetRef);

    const processEntries = (rawEntries) => {
        const normalizeEntryDate = (d) => {
            if (!d) return '';
            if (typeof d === 'string') return d.slice(0, 10);
            if (typeof d?.toDate === 'function') {
                const dt = d.toDate();
                return dt instanceof Date && !isNaN(dt.getTime()) ? dt.toISOString().slice(0, 10) : '';
            }
            if (d instanceof Date) return !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '';
            return String(d).slice(0, 10);
        };

        const getEntryDateStr = (e) => {
            if (!e || typeof e !== 'object') return '';
            const candidate = e.date ?? e.dateStr ?? e.entryDate ?? e.dayDate ?? e.period;
            return normalizeEntryDate(candidate);
        };

        let count = 0;
        const isClearing = !notes || String(notes).trim() === '';

        const filteredEntries = rawEntries.filter(e => {
            const entryDate = getEntryDateStr(e);
            if (entryDate !== dateStr) return true;
            if (isClearing && e.isDescriptionOnly) {
                count++;
                return false;
            }
            return true;
        });

        const updatedEntries = filteredEntries.map(e => {
            const entryDate = getEntryDateStr(e);
            if (entryDate === dateStr) {
                count++;
                return {
                    ...e,
                    notes: notes || '',
                    description: notes || '',
                    updatedAt: new Date().toISOString()
                };
            }
            return e;
        });

        return { updatedEntries, count };
    };

    // 1. UPDATE SESSIONS (Deep Sync)
    let sessionsUpdatedCount = 0;
    try {
        const dayStart = new Date(dateStr + 'T00:00:00');
        const dayEnd = new Date(dateStr + 'T23:59:59');
        const sessionsQuery = query(
            collection(db, 'timeClockSessions'),
            where('userId', '==', userId),
            where('startedAt', '>=', Timestamp.fromDate(dayStart)),
            where('startedAt', '<=', Timestamp.fromDate(dayEnd))
        );
        const sessionSnaps = await getDocs(sessionsQuery);
        if (!sessionSnaps.empty) {
            const batch = writeBatch(db);
            sessionSnaps.forEach(sDoc => {
                batch.update(sDoc.ref, {
                    notes: notes || '',
                    updatedAt: serverTimestamp()
                });
                sessionsUpdatedCount++;
            });
            await batch.commit();
            console.log(`[updateDayDescription] SUCCESS: Updated ${sessionsUpdatedCount} sessions for ${dateStr}`);
        }
    } catch (sessionErr) {
        console.warn('[updateDayDescription] Session sync failed (non-blocking):', sessionErr);
    }

    const processEntriesWithSessions = (rawEntries) => {
        const { updatedEntries, count } = processEntries(rawEntries);
        return { updatedEntries, count: count + sessionsUpdatedCount };
    };

    if (!timesheetSnap.exists()) {
        const q = query(
            collection(db, 'timesheets'),
            where('userId', '==', userId),
            where('end', '>=', dateStr)
        );
        const rawResults = await getDocs(q);
        const filteredDocs = rawResults.docs.filter(d => d.data().start <= dateStr);
        const results = { empty: filteredDocs.length === 0, docs: filteredDocs };

        if (results.empty) {
            if (sessionsUpdatedCount > 0) return { success: true, count: sessionsUpdatedCount };
            return { success: false, message: 'Timesheet not found' };
        }

        const docSnap = results.docs[0];
        const { updatedEntries, count } = processEntriesWithSessions([...(docSnap.data().entries || [])]);
        const currentStatus = docSnap.data().status || 'draft';

        await updateDoc(docSnap.ref, {
            entries: updatedEntries,
            status: currentStatus,
            updatedAt: serverTimestamp(),
            pdfUrl: null,
            pdfGeneratedAt: null,
            pdfForUpdatedAt: null,
            pdfGenerationFailed: false,
            pdfError: null
        });
        invalidateTimesheetCache(userId, dateStr);
        if (String(currentStatus || '').toLowerCase() === 'approved') {
            triggerTimesheetArchive(docSnap.id, userId, weekStrForPdf).catch(() => { });
        }
        return { success: true, count };
    }

    const { updatedEntries, count } = processEntriesWithSessions([...(timesheetSnap.data().entries || [])]);
    const currentStatus = timesheetSnap.data().status || 'draft';

    await updateDoc(timesheetRef, {
        entries: updatedEntries,
        status: currentStatus,
        updatedAt: serverTimestamp(),
        pdfUrl: null,
        pdfGeneratedAt: null,
        pdfForUpdatedAt: null,
        pdfGenerationFailed: false,
        pdfError: null
    });
    invalidateTimesheetCache(userId, dateStr);
    if (String(currentStatus || '').toLowerCase() === 'approved') {
        triggerTimesheetArchive(timesheetId, userId, weekStrForPdf).catch(() => { });
    }
    return { success: true, count };
}


/**
 * deleteTimeEntry
 * Deletes a time entry from ALL overlapping timesheets and the source of truth (timeClockSessions).
 * Fixes: 1. Fragmentation (deletes from source session doc) 
 *        2. Overlap (purges from all timesheets covering the date)
 *        3. Robust Signature (supports positional OR object parameters)
 *        4. Return Parity (returns deletedCount/deletedSessionsCount for UI)
 * 
 * @param {string|Object} arg1 - userId OR object { userId, dateStr, entry, ... }
 * @param {string} [arg2] - dateStr "YYYY-MM-DD"
 * @param {Object} [arg3] - entry object { id, sessionId, ... }
 * @param {string} [arg4] - weekStartDay (default: 'sunday')
 */
export const deleteTimeEntry = async (arg1, arg2, arg3, arg4) => {
    let userId, dateStr, entry, weekStartDay;

    // 1. Resolve Arguments Pattern
    if (arg1 && typeof arg1 === 'object' && arg2 === undefined) {
        // Unified Object Pattern (used by EditTimesheetModal)
        userId = arg1.userId;
        dateStr = arg1.dateStr;
        entry = arg1.entry || arg1;
        weekStartDay = arg1.weekStartDay || 'sunday';
    } else {
        // Legacy Positional Pattern
        userId = arg1;
        dateStr = arg2;
        entry = arg3;
        weekStartDay = arg4 || 'sunday';
    }

    if (!userId || !dateStr || !entry) {
        console.error('[deleteTimeEntry] Missing required parameters:', { userId, dateStr, entry });
        return { success: false, message: 'Missing required parameters' };
    }

    // Identify standard IDs
    const entryId = entry.id || entry.entryId;
    const sessionId = entry.sessionId || entry.sessionKey || (entryId && !String(entryId).startsWith('manual_') && !String(entryId).startsWith('entry_') ? entryId : null);

    try {
        console.log('[timesheets] deleteTimeEntry starting:', {
            userId,
            dateStr,
            entryId,
            sessionId,
            weekStartDay
        });

        const batch = writeBatch(db);
        let entriesRemovedCount = 0;
        let sessionsRemovedCount = 0;
        let finalUpdatedTimesheet = null;

        // 2. Delete the Source Session Document (Prevent Reappearance)
        // Manual sessions and clock sessions all live in timeClockSessions
        if (sessionId && typeof sessionId === 'string' && !sessionId.startsWith('manual_') && !sessionId.startsWith('entry_')) {
            const sessionRef = doc(db, 'timeClockSessions', sessionId);
            batch.delete(sessionRef);
            sessionsRemovedCount = 1;
            console.log(`[deleteTimeEntry] Queued session deletion: ${sessionId}`);
        }

        // 3. Resolve Context and Week Start for Accurate Invalidation
        const userContext = await getUserWeekContext(userId);
        const resolvedWeekStartDay = weekStartDay || userContext.weekStartDay || 'sunday';
        const { start: weekStart } = getWeekRangeForDate(dateStr, resolvedWeekStartDay);
        const weekStartStr = formatISODateUtil(weekStart);

        const companyIdPath = userContext.companyIdPath || '';
        const companyIdRaw = companyIdPath.split('/').pop() || '';
        const companyIdFull = companyIdPath.includes('/') ? companyIdPath : `companies/${companyIdRaw}`;

        // 4. Find ALL potentially overlapping Timesheet Documents
        // Broaden search: Any timesheet for this user that might cover the date
        // Including companyId in the query improves performance and complies with security rules
        const q = query(
            collection(db, 'timesheets'),
            where('userId', '==', userId),
            where('companyId', 'in', [companyIdRaw, companyIdFull].filter(Boolean))
        );
        const snapshot = await getDocs(q);

        // Filter in memory for maximum safety across all schema versions
        const overlappingDocs = snapshot.docs.filter(d => {
            const data = d.data();
            const start = data.start || data.period || data.weekStartDate;
            const end = data.end || data.weekEndDate;

            if (data.period === weekStartStr) return true;
            if (start && end) return dateStr >= start && dateStr <= end;
            if (data.period === dateStr || data.date === dateStr) return true;
            if (data.period && (data.period <= dateStr)) {
                const pDate = new Date(data.period);
                const dDate = new Date(dateStr);
                const diff = (dDate - pDate) / (1000 * 60 * 60 * 24);
                return diff >= 0 && diff < 8;
            }
            return false;
        });

        console.log(`[deleteTimeEntry] Found ${overlappingDocs.length} potential documents.`);

        // 5. Purge Entry from ALL matching Timesheets
        for (const tsDoc of overlappingDocs) {
            const data = tsDoc.data();
            const originalEntries = Array.isArray(data.entries) ? data.entries : [];

            const checkMatch = (val) => {
                if (!val) return false;
                const vStr = String(val);
                const targets = [entryId, sessionId, entry.sessionKey, entry.id, entry.entryId]
                    .filter(Boolean)
                    .map(String);
                return targets.includes(vStr);
            };

            const updatedEntries = originalEntries.filter(e => {
                if (checkMatch(e.id)) return false;
                if (checkMatch(e.sessionId)) return false;
                if (checkMatch(e.sessionKey)) return false;
                if (Array.isArray(e.sessionIds)) {
                    if (e.sessionIds.some(sid => checkMatch(sid))) return false;
                }
                return true;
            });

            if (updatedEntries.length !== originalEntries.length) {
                const removedFromThisDoc = originalEntries.length - updatedEntries.length;
                entriesRemovedCount += removedFromThisDoc;

                const totals = updatedEntries.reduce((acc, e) => ({
                    grossSec: acc.grossSec + (e.grossSec || 0),
                    effectiveSec: acc.effectiveSec + (e.effectiveSec || 0),
                    overtimeSec: acc.overtimeSec + (e.overtimeSec || 0)
                }), { grossSec: 0, effectiveSec: 0, overtimeSec: 0 });

                const updatePayload = {
                    entries: updatedEntries,
                    totals,
                    updatedAt: serverTimestamp()
                };

                batch.update(tsDoc.ref, updatePayload);

                if (tsDoc.id.includes(weekStartStr) || data.period === weekStartStr) {
                    finalUpdatedTimesheet = {
                        ...data,
                        ...updatePayload,
                        updatedAt: new Date().toISOString()
                    };
                }
                console.log(`[deleteTimeEntry] Purged ${removedFromThisDoc} from: ${tsDoc.id}`);
            }
        }

        // 6. Commit & Invalidate
        await batch.commit();
        invalidateTimesheetCache(userId, weekStartStr);

        return {
            success: true,
            message: 'Time entry deleted successfully',
            deletedCount: entriesRemovedCount,
            deletedSessionsCount: sessionsRemovedCount,
            updatedTimesheet: finalUpdatedTimesheet,
            docsModified: overlappingDocs.length,
            sessionDeleted: sessionsRemovedCount > 0
        };

    } catch (error) {
        console.error('[timesheets] deleteTimeEntry failed:', error);
        throw error;
    }
};


export function getWeekRange(date = new Date(), weekStartDay = DEFAULT_WEEK_START_DAY) {
    return getWeekRangeForDate(date, weekStartDay);
}

export function formatISODate(d) {
    return formatISODateUtil(d);
}

// Recompute overtime across a company for a date range (by latest schedule)
export async function recomputeOvertimeForCompany(companyIdPath, { daysBack = 84 } = {}) {
    try {
        const compKey = (companyIdPath || '').includes('/') ? (companyIdPath.split('/')[1] || '') : (companyIdPath || '');
        if (!compKey) return { ok: false, updated: 0 };
        const schedule = await getCompanyWorkSchedule(compKey);
        const tsCol = collection(db, 'timesheets');
        // Fetch all timesheets for this company (both formats) and filter by date range client-side
        // SAFETY CHECK: Count documents first
        const countSnap = await getDocs(query(tsCol, where('companyId', 'in', [compKey, `companies/${compKey}`])));
        if (countSnap.size > 2000) {
            console.warn('[recomputeOvertimeForCompany] Too many timesheets to process client-side. Aborting.', countSnap.size);
            return { ok: false, message: 'Company too large for client-side processing. Please contact support to run this operation.' };
        }

        const [snapA, snapB] = await Promise.all([
            getDocs(query(tsCol, where('companyId', '==', compKey))),
            getDocs(query(tsCol, where('companyId', '==', `companies/${compKey}`)))
        ]);
        const docs = [...snapA.docs, ...snapB.docs];
        const since = new Date(); since.setDate(since.getDate() - Math.max(1, daysBack));
        const sinceIso = formatISODate(since);
        let updated = 0;
        for (const d of docs) {
            const data = d.data();
            const period = data?.period || '';
            // NOTE: 'period' is week start day e.g. "2025-12-08"
            // We need to iterate ALL entries in the document, group by DATE, and recalculate overtime per date

            let entries = Array.isArray(data.entries) ? [...data.entries] : [];
            let changed = false;

            // Group by date
            const dateGroups = {};
            for (const e of entries) {
                if (!e.date) continue;
                if (!dateGroups[e.date]) dateGroups[e.date] = [];
                dateGroups[e.date].push(e);
            }

            for (const dateStr of Object.keys(dateGroups)) {
                // Ignore dates older than 'since'
                if (dateStr < sinceIso) continue;

                const dayEntries = dateGroups[dateStr];
                const targetSec = computeTargetSecondsForDay(dateStr, schedule);

                // Sort by time
                dayEntries.sort((a, b) => {
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
                for (const entry of dayEntries) {
                    const eff = entry.effectiveSec || 0;
                    const previousTotal = runningTotal;
                    runningTotal += eff;

                    // Calculate overlap with overtime region
                    const normalPortion = Math.min(eff, Math.max(0, targetSec - previousTotal));
                    const overtimePortion = Math.max(0, eff - normalPortion);

                    if (entry.overtimeSec !== overtimePortion) {
                        const mainIdx = entries.indexOf(entry);
                        if (mainIdx >= 0) {
                            entries[mainIdx] = { ...entries[mainIdx], overtimeSec: overtimePortion };
                            changed = true;
                        }
                    }
                }
            }

            if (changed) {
                const totalGross = entries.reduce((a, e) => a + Math.max(0, e.grossSec || 0), 0);
                const totalEff = entries.reduce((a, e) => a + Math.max(0, e.effectiveSec || 0), 0);
                const totalOver = entries.reduce((a, e) => a + Math.max(0, e.overtimeSec || 0), 0);

                const totals = { grossSec: totalGross, effectiveSec: totalEff, overtimeSec: totalOver };
                await updateDoc(d.ref, { entries, totals, updatedAt: serverTimestamp() });
                updated += 1;
            }
        }
        return { ok: true, updated };
    } catch (e) {
        console.warn('[timesheets.recomputeOvertimeForCompany] failed', e);
        return { ok: false, updated: 0, error: e?.message };
    }
}

export async function recomputeRoundingForCompany(companyIdPath, { daysBack = 84 } = {}) {
    try {
        const compKey = (companyIdPath || '').includes('/') ? (companyIdPath.split('/')[1] || '') : (companyIdPath || '');
        if (!compKey) return { ok: false, updated: 0 };

        const tsCol = collection(db, 'timesheets');
        const [snapA, snapB] = await Promise.all([
            getDocs(query(tsCol, where('companyId', '==', compKey))),
            getDocs(query(tsCol, where('companyId', '==', `companies/${compKey}`)))
        ]);
        const docs = [...snapA.docs, ...snapB.docs];
        const since = new Date(); since.setDate(since.getDate() - Math.max(1, daysBack));
        const sinceIso = formatISODate(since);

        const siteRuleCache = new Map();
        let updated = 0;

        for (const d of docs) {
            const data = d.data();
            const period = data?.period || '';
            if (!/^\d{4}-\d{2}-\d{2}$/.test(period)) continue;
            if (period < sinceIso) continue;

            const siteId = data?.siteId || data?.siteIdPath || '';
            const cacheKey = siteId || '__default';
            let rules = siteRuleCache.get(cacheKey);
            if (!rules) {
                rules = await resolveRoundingRules(companyIdPath || compKey, siteId);
                siteRuleCache.set(cacheKey, rules);
            }

            const entries = Array.isArray(data.entries) ? data.entries.map(entry => ({ ...entry })) : [];
            let changed = false;

            for (let i = 0; i < entries.length; i++) {
                const entry = entries[i];
                const rawStart = entry.rawStart ? new Date(entry.rawStart) : null;
                const rawEnd = entry.rawEnd ? new Date(entry.rawEnd) : null;
                if (!rawStart || !rawEnd || Number.isNaN(rawStart.getTime()) || Number.isNaN(rawEnd.getTime())) {
                    continue;
                }

                const { roundedStart, roundedEnd } = roundSessionRange(rawStart, rawEnd, rules);
                const durationSec = Math.max(0, Math.floor((roundedEnd - roundedStart) / 1000));
                const breakSec = Math.max(0, durationSec - (entry.rawEffectiveSec || 0));
                const effectiveSec = Math.max(0, durationSec - breakSec);

                const nextRoundedStart = roundedStart.toISOString();
                const nextRoundedEnd = roundedEnd.toISOString();

                if (
                    Math.abs((entry.grossSec || 0) - durationSec) > 0 ||
                    Math.abs((entry.effectiveSec || 0) - effectiveSec) > 0 ||
                    entry.roundedStart !== nextRoundedStart ||
                    entry.roundedEnd !== nextRoundedEnd
                ) {
                    entries[i] = {
                        ...entry,
                        grossSec: durationSec,
                        effectiveSec,
                        roundedStart: nextRoundedStart,
                        roundedEnd: nextRoundedEnd
                    };
                    changed = true;
                }
            }

            if (changed) {
                const totals = entries.reduce((acc, e) => ({
                    grossSec: acc.grossSec + (e.grossSec || 0),
                    effectiveSec: acc.effectiveSec + (e.effectiveSec || 0),
                    overtimeSec: acc.overtimeSec + (e.overtimeSec || 0)
                }), { grossSec: 0, effectiveSec: 0, overtimeSec: 0 });

                await updateDoc(d.ref, { entries, totals, updatedAt: serverTimestamp() });
                updated += 1;
            }
        }

        return { ok: true, updated };
    } catch (e) {
        console.warn('[timesheets.recomputeRoundingForCompany] failed', e);
        return { ok: false, updated: 0, error: e?.message };
    }
}

export async function recomputeAutoLunchForCompany(companyIdPath, { daysBack = 84 } = {}) {
    try {
        const compKey = (companyIdPath || '').includes('/') ? (companyIdPath.split('/')[1] || '') : (companyIdPath || '');
        if (!compKey) return { ok: false, updated: 0 };

        const tsCol = collection(db, 'timesheets');
        const [snapA, snapB] = await Promise.all([
            getDocs(query(tsCol, where('companyId', '==', compKey))),
            getDocs(query(tsCol, where('companyId', '==', `companies/${compKey}`)))
        ]);
        const docs = [...snapA.docs, ...snapB.docs];
        const since = new Date(); since.setDate(since.getDate() - Math.max(1, daysBack));
        const sinceIso = formatISODate(since);

        const siteCache = new Map();
        let updated = 0;

        for (const d of docs) {
            const data = d.data();
            const period = data?.period || '';
            if (!/^\d{4}-\d{2}-\d{2}$/.test(period)) continue;
            if (period < sinceIso) continue;

            const siteId = data?.siteId || data?.siteIdPath || '';
            const cacheKey = siteId || '__default';
            let config = siteCache.get(cacheKey);
            if (!config) {
                config = await resolveAutoLunchConfig(companyIdPath || compKey, siteId);
                siteCache.set(cacheKey, config);
            }

            const entries = Array.isArray(data.entries) ? data.entries.map(entry => ({ ...entry })) : [];
            let changed = false;

            for (let i = 0; i < entries.length; i++) {
                const entry = entries[i];
                const rawDurationSec = entry.rawDurationSec;
                const rawEffectiveSec = entry.rawEffectiveSec;
                if (!Number.isFinite(rawDurationSec) || rawDurationSec <= 0 || !Number.isFinite(rawEffectiveSec)) {
                    continue;
                }

                const grossSec = Number(entry.grossSec || 0);
                const manualBreakSec = Number.isFinite(entry.manualBreakSec)
                    ? Math.max(0, entry.manualBreakSec)
                    : Math.max(0, rawDurationSec - rawEffectiveSec - (entry.autoLunchBreakSec || 0));
                const thresholdSec = (config.thresholdHours || 0) * 3600;
                const lunchBreakSec = (config.lunchBreakMinutes || 0) * 60;

                let newAutoBreakSec = 0;
                let autoApplied = false;

                const durationForThreshold = rawDurationSec || grossSec;
                if (config.enabled && lunchBreakSec > 0 && durationForThreshold > thresholdSec && manualBreakSec < lunchBreakSec) {
                    const neededLunch = Math.max(0, lunchBreakSec - manualBreakSec);
                    const maxAutoFromRounded = Math.max(0, grossSec - manualBreakSec);
                    const maxAutoFromRaw = Math.max(0, rawDurationSec - manualBreakSec);
                    const availableForAuto = Math.min(neededLunch, maxAutoFromRounded, maxAutoFromRaw);
                    const appliedLunch = Math.min(neededLunch, availableForAuto);
                    if (appliedLunch > 0) {
                        newAutoBreakSec = appliedLunch;
                        autoApplied = true;
                    }
                }

                const totalBreakSec = manualBreakSec + newAutoBreakSec;
                const totalBreakSecRounded = Math.min(totalBreakSec, grossSec);
                const totalBreakSecRaw = Math.min(totalBreakSec, rawDurationSec);
                const newEffectiveSec = Math.max(0, grossSec - totalBreakSecRounded);
                const newRawEffectiveSec = Math.max(0, rawDurationSec - totalBreakSecRaw);

                if (
                    Math.abs((entry.autoLunchBreakSec || 0) - newAutoBreakSec) > 0 ||
                    Boolean(entry.autoLunchApplied) !== autoApplied ||
                    Math.abs((entry.effectiveSec || 0) - newEffectiveSec) > 0
                ) {
                    entries[i] = {
                        ...entry,
                        effectiveSec: newEffectiveSec,
                        autoLunchBreakSec: newAutoBreakSec,
                        autoLunchApplied: autoApplied,
                        autoLunchThresholdHours: config.thresholdHours || 0,
                        lunchBreakMinutes: config.lunchBreakMinutes || 0,
                        manualBreakSec,
                        rawEffectiveSec: newRawEffectiveSec
                    };
                    changed = true;
                }
            }

            if (changed) {
                const totals = entries.reduce((acc, e) => ({
                    grossSec: acc.grossSec + (e.grossSec || 0),
                    effectiveSec: acc.effectiveSec + (e.effectiveSec || 0),
                    overtimeSec: acc.overtimeSec + (e.overtimeSec || 0)
                }), { grossSec: 0, effectiveSec: 0, overtimeSec: 0 });

                await updateDoc(d.ref, { entries, totals, updatedAt: serverTimestamp() });
                updated += 1;
            }
        }

        return { ok: true, updated };
    } catch (e) {
        console.warn('[timesheets.recomputeAutoLunchForCompany] failed', e);
        return { ok: false, updated: 0, error: e?.message };
    }
}

/**
 * BACKEND OPTIMIZED: Recomputes everything in a single pass on the server.
 * Recommended for companies with > 50 employees to avoid timeouts and browser freeze.
 */
export async function recomputeTimesheetsSafe(companyIdPath, { daysBack = 84, tasks = ['rounding', 'lunch', 'overtime'] } = {}) {
    try {
        const { httpsCallable } = await import('firebase/functions');
        const { functions } = await import('../firebase/client');
        const recomputeFunc = httpsCallable(functions, 'recomputeCompanyTimesheetsSafe');

        const result = await recomputeFunc({ companyId: companyIdPath, daysBack, tasks });
        return { ok: true, ...result.data };
    } catch (e) {
        console.error('[recomputeTimesheetsSafe] failed', e);
        return { ok: false, error: e.message };
    }
}


// Fetch current week daily timesheets for a user
export async function fetchCurrentWeekTimesheets(userId) {
    const { collection, query, where, getDocs } = await import('firebase/firestore');
    const { weekStartDay, companyIdPath } = await getUserWeekContext(userId);
    const effectiveAnchor = isMondayAnchorEnabled(companyIdPath) ? STORAGE_ANCHOR_DAY : (weekStartDay || DEFAULT_WEEK_START_DAY);
    const { start } = getWeekRangeForDate(new Date(), effectiveAnchor);
    const dates = getOrderedWeekDates(start, effectiveAnchor);
    // Fetch by 7 daily docs; no composite index needed since querying by userId and period equality one-by-one
    const tsCol = collection(db, 'timesheets');
    const result = [];
    for (const period of dates) {
        const q = query(tsCol, where('userId', '==', userId), where('period', '==', period));
        const snap = await getDocs(q);
        if (!snap.empty) {
            result.push({ id: snap.docs[0].id, ...snap.docs[0].data() });
        }
    }
    return { days: dates, entries: result };
}

// Submit current week timesheets for approval (sets weekly status on each daily entry)
export async function submitCurrentWeek(userId) {
    const { collection, query, where, getDocs, writeBatch, doc, getDoc } = await import('firebase/firestore');
    const { weekStartDay, companyIdPath } = await getUserWeekContext(userId);
    const effectiveAnchor = isMondayAnchorEnabled(companyIdPath) ? STORAGE_ANCHOR_DAY : (weekStartDay || DEFAULT_WEEK_START_DAY);
    const now = new Date();
    const { start } = getWeekRangeForDate(now, effectiveAnchor);
    const dates = getOrderedWeekDates(start, effectiveAnchor);
    const datesStrs = dates.map(d => formatISODate(d.date));

    // Resolve Manager ID
    const resolveManager = async () => {
        try {
            const compKey = (companyIdPath || '').includes('/') ? (companyIdPath.split('/')[1] || '') : (companyIdPath || '');
            if (compKey) {
                const aCol = collection(db, 'assignments');
                const aSnap = await getDocs(query(aCol, where('companyId', 'in', [compKey, `companies/${compKey}`]), where('employeeId', '==', userId)));
                if (!aSnap.empty) {
                    const a = aSnap.docs[0].data();
                    return (a.managerUserId || a.managerId || '').split('/').pop() || null;
                }
            }
            const uSnap = await getDoc(doc(db, 'users', userId));
            if (uSnap.exists()) return uSnap.data().managerUserId || uSnap.data().reportsTo || null;
        } catch (_) { }
        return null;
    };

    const managerUserId = await resolveManager();
    const tsCol = collection(db, 'timesheets');
    const toUpdate = [];

    // Fetch all for the week
    const q = query(tsCol, where('userId', '==', userId), where('period', 'in', datesStrs));
    const snap = await getDocs(q);
    snap.forEach(d => toUpdate.push(d.ref));

    if (toUpdate.length === 0) return { ok: true, count: 0 };

    const batch = writeBatch(db);
    for (const ref of toUpdate) {
        const updateData = { status: 'pending', updatedAt: serverTimestamp() };
        if (managerUserId) updateData.managerUserId = managerUserId;
        batch.update(ref, updateData);
    }
    await batch.commit();

    return { ok: true, count: toUpdate.length };
}


// Submit a specific week (by Monday date) for a user - ULTRA OPTIMIZED for <3s completion
export async function submitWeek(userId, weekStart, options = { forceCreateIfEmpty: false }) {
    console.log('[timesheets.submitWeek] ULTRA OPTIMIZED called with', { userId, weekStart, options });
    const startTime = Date.now();

    // Aggressive timeout protection
    const TIMEOUT_MS = 2000; // 2s timeout to ensure under 3s

    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Submission timeout - please try again')), TIMEOUT_MS);
    });

    const submissionPromise = (async () => {
        const { collection, query, where, getDocs, writeBatch, doc, getDoc } = await import('firebase/firestore');

        const startDate = typeof weekStart === 'string' ? new Date(weekStart) : new Date(weekStart);
        if (isNaN(startDate.getTime())) {
            throw new Error(`Invalid timesheet date: ${weekStart}`);
        }

        // ULTRA AGGRESSIVE: Skip expensive context fetching for submission
        // Use minimal context with defaults
        const userContext = {
            weekStartDay: DEFAULT_WEEK_START_DAY,
            companyIdPath: '',
            siteIdPath: ''
        };

        // Skip manager resolution for performance (can be added later if needed)
        const managerUserId = null;

        const effectiveAnchor = DEFAULT_WEEK_START_DAY; // Use default to avoid config lookups
        const { start, end: weekEnd } = getWeekRangeForDate(startDate, effectiveAnchor);
        const weekStartStr = formatISODate(start);
        const datesStrs = getOrderedWeekDates(start, effectiveAnchor);

        const tsCol = collection(db, 'timesheets');

        // ULTRA AGGRESSIVE: Single query instead of two parallel queries
        // Use a simpler query that's more likely to be indexed
        const q = query(tsCol, where('userId', '==', userId), where('period', 'in', datesStrs));
        const snap = await getDocs(q);

        const hasDocuments = !snap.empty;

        if (!hasDocuments && !options.forceCreateIfEmpty) {
            console.log('[submitWeek] No timesheets found to submit');
            return { ok: true, count: 0 };
        }

        const batch = writeBatch(db);
        let updatedCount = 0;

        // Process documents efficiently
        const processedIds = new Set();
        snap.forEach(d => {
            if (processedIds.has(d.id)) return;
            processedIds.add(d.id);

            const data = d.data();
            // SKIP documents that are already approved
            if (data.status === 'approved') {
                console.log(`[submitWeek] Skipping approved document: ${d.id}`);
                return;
            }

            // Minimal update data - skip manager for performance
            const updateData = {
                status: 'pending',
                submittedAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            };

            batch.update(d.ref, updateData);
            updatedCount++;
        });

        // Handle forceCreateIfEmpty
        if (updatedCount === 0 && options.forceCreateIfEmpty) {
            const tsId = getTimesheetId(userId, weekStartStr);
            const newRef = doc(db, 'timesheets', tsId);
            batch.set(newRef, {
                userId,
                companyId: '',
                period: weekStartStr,
                start: weekStartStr,
                end: weekStartStr,
                entries: [],
                totals: { grossSec: 0, effectiveSec: 0, overtimeSec: 0 },
                status: 'pending',
                submittedAt: serverTimestamp(),
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                weekStartDate: weekStartStr
            });
        }

        // Commit batch only - skip cache invalidation for performance
        await batch.commit();

        const duration = Date.now() - startTime;
        console.log(`[submitWeek] ULTRA OPTIMIZED done in ${duration}ms. affected:`, updatedCount || (options.forceCreateIfEmpty ? 1 : 0));
        return { ok: true, count: updatedCount || (options.forceCreateIfEmpty ? 1 : 0) };
    })();

    // Race between submission and timeout
    return Promise.race([submissionPromise, timeoutPromise]);
}


// Promote any 'draft' day entries in a given week to 'pending'
export async function autoPromoteDraftsForWeek(userId, weekStart = new Date(), options = {}) {
    const { collection, query, where, getDocs, updateDoc } = await import('firebase/firestore');
    const baseDate = typeof weekStart === 'string' ? new Date(weekStart) : weekStart;
    const context = options.weekStartDay ? { weekStartDay: options.weekStartDay, companyIdPath: options.companyIdPath } : await getUserWeekContext(userId);
    const weekStartDay = context.weekStartDay || DEFAULT_WEEK_START_DAY;
    const companyIdPath = context.companyIdPath;
    const effectiveAnchor = isMondayAnchorEnabled(companyIdPath) ? STORAGE_ANCHOR_DAY : weekStartDay;
    const { start } = getWeekRange(baseDate, effectiveAnchor);
    const dates = getOrderedWeekDates(start, effectiveAnchor);
    const tsCol = collection(db, 'timesheets');

    // Batch promote for speed and consistency
    const batch = writeBatch(db);
    let count = 0;

    const [snap, legacySnap] = await Promise.all([
        getDocs(query(tsCol, where('userId', '==', userId), where('period', 'in', dates))),
        getDocs(query(tsCol, where('userId', '==', userId), where('start', 'in', dates)))
    ]);

    const process = (s) => {
        s.forEach(d => {
            const data = d.data();
            if ((data.status || 'draft') === 'draft') {
                batch.update(d.ref, { status: 'pending', updatedAt: serverTimestamp() });
                count++;
            }
        });
    };

    process(snap);
    process(legacySnap);

    if (count > 0) await batch.commit();
    return { ok: true, count };
}

// Approval hierarchy enforcement
export async function approveTimesheetWithHierarchy(timesheetId, approverUserId) {
    const { doc, getDoc, updateDoc } = await import('firebase/firestore');
    const tsRef = doc(db, 'timesheets', timesheetId);
    const tsSnap = await getDoc(tsRef);
    if (!tsSnap.exists()) throw new Error('Timesheet not found');
    const t = tsSnap.data();
    const employeeId = t.userId;

    // Load approver and employee docs
    const empRef = doc(db, 'users', employeeId);
    const manRef = doc(db, 'users', approverUserId);
    const [empSnap, manSnap] = await Promise.all([getDoc(empRef), getDoc(manRef)]);
    if (!empSnap.exists() || !manSnap.exists()) throw new Error('User not found');
    const emp = empSnap.data();
    const man = manSnap.data();

    // Authorization: must manage this employee AND correct role pairing
    const companyKey = (emp.companyId || '').split('/').pop();
    const managedIds = await getManagedEmployeeIdsForManager(approverUserId, companyKey);
    const manages = managedIds.has(employeeId);
    const roleOk = approverEmployeeRoleMatch(man.primaryRole, emp.primaryRole);
    if (!manages || !roleOk) throw new Error('Not authorized to approve this timesheet');

    const approverName = man.displayName || man.name || `${man.firstName || ''} ${man.lastName || ''}`.trim() || 'Manager';
    await updateDoc(tsRef, {
        status: 'approved',
        approvedBy: approverUserId,
        approvedByName: approverName,
        approvedAt: serverTimestamp(),
        approvals: { ...(t.approvals || {}), [man.primaryRole]: { by: approverUserId, at: serverTimestamp() } },
        updatedAt: serverTimestamp()
    });

    // DETACHED BACKGROUND TASKS (PDF & Cache)
    const weekStr = t.period || t.start;
    triggerTimesheetArchive(timesheetId, employeeId, weekStr).catch(() => { });

    return { ok: true };
}

export async function submitTimesheet(timesheetId) {
    await updateDoc(doc(db, 'timesheets', timesheetId), { status: 'pending', updatedAt: serverTimestamp() });
}

export async function approveTimesheet(timesheetId, approverUserId, notes = null, approverName = null) {
    console.log(`[approveTimesheet] Starting optimized approval for timesheet ${timesheetId}`);
    const startTime = Date.now();

    const tRef = doc(db, 'timesheets', timesheetId);
    const tSnap = await getDoc(tRef);
    if (!tSnap.exists()) throw new Error('Timesheet not found');
    const data = tSnap.data();
    const employeeId = data.userId;

    if (!approverUserId) throw new Error('Approver ID is required');

    // 1. Parallel Fetch: Employee, Current User Context, and Approver (Initial)
    const [empSnap, manSnapInitial, userContext] = await Promise.all([
        getDoc(doc(db, 'users', employeeId)),
        getDoc(doc(db, 'users', approverUserId)),
        getUserWeekContext(employeeId)
    ]);

    let manSnap = manSnapInitial;
    let managerDocId = approverUserId;

    // 2. Parallel Search for Approver if direct UID fetch failed
    if (!manSnap.exists()) {
        console.log(`[approveTimesheet] Manager not found by UID, searching by other fields...`);
        const usersRef = collection(db, 'users');
        const searchResults = await Promise.all([
            getDocs(query(usersRef, where('userId', '==', approverUserId))),
            getDocs(query(usersRef, where('uid', '==', approverUserId))),
            getDocs(query(usersRef, where('firebaseUid', '==', approverUserId)))
        ]);
        const found = searchResults.find(s => !s.empty);
        if (found) {
            manSnap = found.docs[0];
            managerDocId = manSnap.id;
        }
    }

    if (!empSnap.exists()) throw new Error(`Employee user document not found: ${employeeId}`);
    if (!manSnap || !manSnap.exists()) throw new Error(`Approver not found: ${approverUserId}`);

    const emp = empSnap.data();
    const man = manSnap.data();

    // 3. Authorization Check
    const managerRole = (man.primaryRole || man.role || '').toLowerCase();
    const isAuthorizedRole = managerRole.includes('site') ||
        managerRole.includes('manager') ||
        managerRole.includes('hr') ||
        managerRole.includes('advisor');

    if (!isAuthorizedRole) {
        const companyKey = (emp.companyId || '').split('/').pop();
        const managedIds = await getManagedEmployeeIdsForManager(managerDocId, companyKey);
        if (!managedIds.has(employeeId)) throw new Error('Not authorized to approve this timesheet');
    }

    const isSiteManagerApprover = managerRole.includes('site') || man.primaryRole === 'siteManager';
    const now = serverTimestamp();
    const currentStatus = String(data.status || 'draft').toLowerCase();

    if (!['pending', 'draft', 'submitted', 'approved-by-team', ''].includes(currentStatus)) {
        throw new Error(`Cannot approve timesheet with status: ${currentStatus}`);
    }

    // 4. Prepare Update Data
    const finalApproverName = approverName ||
        (man.firstName && man.lastName ? `${man.firstName} ${man.lastName}` : (man.name || man.displayName || 'Manager'));

    const updateData = {
        status: 'approved',
        approvedBy: approverUserId,
        approvedByName: finalApproverName,
        approverRole: (man.primaryRole || 'Manager').replace(/_/g, ' '),
        siteManager: isSiteManagerApprover ? finalApproverName : (data.siteManager || finalApproverName),
        approvedAt: now,
        updatedAt: now
    };

    if (notes && notes.trim()) {
        updateData.approvalNotes = notes.trim();
        updateData.approvalNotesBy = approverUserId;
        updateData.approvalNotesAt = now;
    }

    // Backfill metadata
    if (emp.siteId && (!data.siteId || data.siteId !== emp.siteId)) updateData.siteId = emp.siteId;
    if (emp.companyId && (!data.companyId || data.companyId !== emp.companyId)) updateData.companyId = emp.companyId;
    if (emp.department && !data.department) updateData.department = emp.department;

    // 5. Bulk Approval & SIbling Query (Wait for Context first)
    const effectiveAnchor = isMondayAnchorEnabled(userContext.companyIdPath) ? STORAGE_ANCHOR_DAY : (userContext.weekStartDay || DEFAULT_WEEK_START_DAY);
    const weekRange = getWeekRangeForDate(data.period || data.start, effectiveAnchor);
    const weekDates = getOrderedWeekDates(weekRange.start, effectiveAnchor);

    const [siblingSnap, legacySiblingSnap] = await Promise.all([
        getDocs(query(collection(db, 'timesheets'), where('userId', '==', employeeId), where('period', 'in', weekDates))),
        getDocs(query(collection(db, 'timesheets'), where('userId', '==', employeeId), where('start', 'in', weekDates)))
    ]);

    const batch = writeBatch(db);
    let bulkCount = 0;
    const processedIds = new Set();
    const processSnap = (s) => s.forEach(d => {
        if (processedIds.has(d.id)) return;
        processedIds.add(d.id);
        const sStatus = String(d.data().status || 'draft').toLowerCase();
        if (['pending', 'approved-by-team', 'draft', 'submitted'].includes(sStatus)) {
            batch.update(d.ref, updateData);
            bulkCount++;
        }
    });

    processSnap(siblingSnap);
    processSnap(legacySiblingSnap);

    // 6. Final Write
    if (bulkCount > 0) {
        await batch.commit();
    } else {
        await updateDoc(tRef, updateData);
    }

    // 7. DETACHED BACKGROUND TASKS (PDF & Cache)
    const weekStr = data.period || data.start;
    triggerTimesheetArchive(timesheetId, employeeId, weekStr).catch(() => { });

    console.log(`[approveTimesheet] Approval completed in ${Date.now() - startTime}ms (Bulk: ${bulkCount})`);
    return { success: true, message: 'Approval processed successfully', bulkCount };
}

export async function declineTimesheet(timesheetId, approverUserId, notes = null) {
    const ref = doc(db, 'timesheets', timesheetId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Timesheet not found');
    const data = snap.data();

    // Load employee and manager to enforce team membership
    const employeeId = data.userId;
    const empSnap = await getDoc(doc(db, 'users', employeeId));

    // Try to get manager by UID first, then fall back to other document IDs in users collection
    let manSnap = await getDoc(doc(db, 'users', approverUserId));
    let managerDocId = approverUserId; // Track the actual Firestore document ID

    if (!manSnap.exists()) {
        const { collection: firestoreCollection, query: firestoreQuery, where: firestoreWhere, getDocs: firestoreDocs, limit: firestoreLimit } = await import('firebase/firestore');
        const usersRef = firestoreCollection(db, 'users');

        // Optimized: Search by userId, uid, OR firebaseUid using targeted queries
        const [userIdSnap, uidSnap, fireUidSnap] = await Promise.all([
            firestoreDocs(firestoreQuery(usersRef, firestoreWhere('userId', '==', approverUserId), firestoreLimit(1))),
            firestoreDocs(firestoreQuery(usersRef, firestoreWhere('uid', '==', approverUserId), firestoreLimit(1))),
            firestoreDocs(firestoreQuery(usersRef, firestoreWhere('firebaseUid', '==', approverUserId), firestoreLimit(1)))
        ]);

        if (!userIdSnap.empty) {
            manSnap = userIdSnap.docs[0];
            managerDocId = userIdSnap.docs[0].id;
        } else if (!uidSnap.empty) {
            manSnap = uidSnap.docs[0];
            managerDocId = uidSnap.docs[0].id;
        } else if (!fireUidSnap.empty) {
            manSnap = fireUidSnap.docs[0];
            managerDocId = fireUidSnap.docs[0].id;
        }
    }

    if (!empSnap.exists()) throw new Error(`Employee user document not found for ID: ${employeeId}`);
    if (!manSnap) throw new Error(`Approver user document not found for ID: ${approverUserId}`);

    const emp = empSnap.data();
    const man = manSnap.data();

    // Authorization: manager must have appropriate role (Site Manager, HR Manager, Admin Manager, etc)
    const managerRole = (man.primaryRole || man.role || '').toLowerCase();
    const isAuthorizedRole = managerRole.includes('site') ||
        managerRole.includes('manager') ||
        managerRole.includes('hr') ||
        managerRole.includes('advisor');

    if (!isAuthorizedRole) {
        // Also check if manager explicitly manages this employee
        const companyKey = (emp.companyId || '').split('/').pop();
        const managedIds = await getManagedEmployeeIdsForManager(managerDocId, companyKey);
        const manages = managedIds.has(employeeId);
        if (!manages) throw new Error('Not authorized to decline this timesheet');
    }

    const now = serverTimestamp();
    const currentStatus = String(data.status || '').toLowerCase();

    // Silent no-op if already rejected
    if (currentStatus === 'rejected') {
        console.log(`[declineTimesheet] Timesheet ${timesheetId} is already rejected. Skipping.`);
        return { success: true, message: 'Already rejected' };
    }

    // Allow decline of pending, submitted, draft, or approved-by-team states
    if (['pending', 'submitted', 'draft', 'approved-by-team', ''].includes(currentStatus)) {
        const updateData = {
            status: 'rejected',
            rejectedBy: approverUserId,
            rejectedAt: now,
            updatedAt: now
        };

        if (notes && notes.trim()) {
            updateData.rejectionNotes = notes.trim();
            updateData.rejectionNotesBy = approverUserId;
            updateData.rejectionNotesAt = now;
        }

        // --- Bulk Decline ---
        // Ensure all documents for this user in the same week are declined together
        const { weekStartDay, companyIdPath } = await getUserWeekContext(employeeId);
        const effectiveAnchor = isMondayAnchorEnabled(companyIdPath) ? STORAGE_ANCHOR_DAY : (weekStartDay || DEFAULT_WEEK_START_DAY);
        const weekRange = getWeekRangeForDate(data.period || data.start, effectiveAnchor);
        const weekDates = getOrderedWeekDates(weekRange.start, effectiveAnchor);

        const batch = writeBatch(db);
        let bulkCount = 0;
        const processedIds = new Set();

        const [siblingSnap, legacySiblingSnap] = await Promise.all([
            getDocs(query(collection(db, 'timesheets'), where('userId', '==', employeeId), where('period', 'in', weekDates))),
            getDocs(query(collection(db, 'timesheets'), where('userId', '==', employeeId), where('start', 'in', weekDates)))
        ]);

        const process = (snap) => {
            snap.forEach(sDoc => {
                if (processedIds.has(sDoc.id)) return;
                processedIds.add(sDoc.id);
                const sData = sDoc.data();
                // Site managers can reject 'approved-by-team' or 'pending' or 'draft'
                if (['pending', 'approved-by-team', 'draft', 'submitted'].includes(sData.status)) {
                    batch.update(sDoc.ref, updateData);
                    bulkCount++;
                }
            });
        };

        process(siblingSnap);
        process(legacySiblingSnap);

        if (bulkCount > 0) {
            console.log(`[declineTimesheet] Bulk declining ${bulkCount} documents for week.`);
            await batch.commit();
        } else {
            await updateDoc(ref, updateData);
        }

        // Enhanced cache invalidation for both employee and manager
        console.log(`[declineTimesheet] Starting cache invalidation for employee ${employeeId} and manager ${approverUserId}`);
        try {
            // Clear employee's timesheet cache
            const { invalidateUserTimesheets } = await import('./timesheetCache');
            console.log(`[declineTimesheet] Invalidating cache for employee: ${employeeId}`);
            invalidateUserTimesheets(employeeId);

            // Clear manager's cache
            console.log(`[declineTimesheet] Invalidating cache for manager: ${approverUserId}`);
            invalidateUserTimesheets(approverUserId);

            // Clear specific cache keys
            const { timesheetCache } = await import('./timesheetCache');
            timesheetCache.delete(`timesheets:manager:${approverUserId}:pending`);

            console.log(`[declineTimesheet] ✓ Cache invalidation completed successfully`);
        } catch (e) {
            console.error(`[declineTimesheet] ✗ Cache invalidation failed:`, e);
        }
    } else {
        throw new Error('Can only decline pending timesheets');
    }
}


// Weekly aggregation helpers and fetchers
export function weekKeyForDateStr(dateStr, weekStartDay = DEFAULT_WEEK_START_DAY) {
    // Parse dateStr safely as local date if it's YYYY-MM-DD
    // This prevents incorrect week assignment due to UTC mismatch (e.g., IST causes local dates to shift to previous day in UTC)
    const d = (typeof dateStr === 'string' && dateStr.match(/^\d{4}-\d{2}-\d{2}$/))
        ? new Date(dateStr + 'T00:00:00') // Parse as local date
        : new Date(dateStr); // Fallback for other date formats

    const { start, end } = getWeekRange(d, weekStartDay);
    return {
        key: `${formatISODate(start)}_${formatISODate(end)}`,
        start,
        end,
    };
}

// Optimized version with caching and performance monitoring
export async function fetchWeeklySummaries(userId, maxWeeks = 12) {
    return measureAsync(`fetchWeeklySummaries-${userId}`, async () => {
        // Check cache first
        const cached = getCachedUserTimesheets(userId, maxWeeks);
        if (cached) {
            console.log(`fetchWeeklySummaries: Using cached data for user ${userId}`);
            return cached;
        }

        console.log(`fetchWeeklySummaries: Fetching fresh data for user ${userId}`);
        const { collection, query, where, getDocs } = await import('firebase/firestore');
        const { weekStartDay, companyIdPath } = await getUserWeekContext(userId);
        const schedule = await getCompanyWorkSchedule(companyIdPath);
        const effectiveAnchor = isMondayAnchorEnabled(companyIdPath) ? STORAGE_ANCHOR_DAY : (weekStartDay || DEFAULT_WEEK_START_DAY);
        const tsCol = collection(db, COLLECTION_NAME);

        // Use simple query to avoid index requirement for now
        // TODO: Create composite index for userId + period for better performance
        const q = query(tsCol, where('userId', '==', userId));

        const snap = await getDocs(q);
        const weeks = new Map();

        // Client-side date filtering until composite index is created
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - (maxWeeks * 7 + 14)); // Add 2 weeks buffer
        const cutoffIso = formatISODate(cutoffDate);

        // Process documents efficiently with client-side filtering
        for (const docSnap of snap.docs) {
            const t = docSnap.data();
            const period = t.period; // daily YYYY-MM-DD
            if (!period) continue;

            // Client-side date filtering for performance
            if (period < cutoffIso) continue;

            const { key, start, end } = weekKeyForDateStr(period, effectiveAnchor);
            if (!weeks.has(key)) {
                weeks.set(key, {
                    weekKey: key,
                    start,
                    end,
                    totals: { grossSec: 0, effectiveSec: 0, overtimeSec: 0 },
                    statusCounts: { approved: 0, pending: 0, draft: 0, rejected: 0 },
                    notes: [],
                    createdAtList: [],
                    submittedAtList: [],
                });
            }

            const w = weeks.get(key);
            const eff = t?.totals?.effectiveSec || 0;
            const gro = t?.totals?.grossSec || 0;
            const over = t?.totals?.overtimeSec || 0;

            w.totals.effectiveSec += eff;
            w.totals.grossSec += gro;

            // DYNAMIC OVERTIME: Recalculate based on live schedule instead of using stale stored totals
            const targetSec = computeTargetSecondsForDay(period, schedule);
            const calculatedOvertime = Math.max(0, eff - targetSec);
            w.totals.overtimeSec += calculatedOvertime;

            const status = (t.status || 'draft').toLowerCase();

            if (status === 'approved') w.statusCounts.approved += 1;
            else if (status === 'rejected') w.statusCounts.rejected += 1;
            else if (status === 'pending' || status === 'approved-by-team') w.statusCounts.pending += 1;
            else w.statusCounts.draft += 1;

            if (t.adminNotes) w.notes.push(t.adminNotes);
            if (t.createdAt?.toDate) w.createdAtList.push(t.createdAt.toDate());
            if (t.submittedAt?.toDate) {
                w.submittedAtList.push(t.submittedAt.toDate());
            } else if (t.createdAt?.toDate) {
                w.submittedAtList.push(t.createdAt.toDate());
            }

            // Capture approval details (prioritize existing values)
            if (t.approvedByName && !w.approvedByName) w.approvedByName = t.approvedByName;
            if (t.approvedBy && !w.approvedBy) w.approvedBy = t.approvedBy;
            if (t.approvedAt && !w.approvedAt) w.approvedAt = t.approvedAt;
            if (t.siteId && !w.siteId) w.siteId = t.siteId;
        }

        // Build sorted result
        const result = Array.from(weeks.values())
            .sort((a, b) => b.end - a.end)
            .slice(0, maxWeeks)
            .map(w => {

                // Status priority: Rejected > Pending > Approved > Draft
                // This matches unifyTimesheetsByEntries
                let status = 'Draft';
                if (w.statusCounts.rejected > 0) {
                    status = 'Rejected';
                } else if (w.statusCounts.pending > 0) {
                    status = 'Pending';
                } else if (w.statusCounts.approved > 0) {
                    status = 'Approved';
                } else if (w.statusCounts.draft > 0) {
                    status = 'Draft';
                }

                // Validate status consistency
                const totalDays = w.statusCounts.approved + w.statusCounts.pending + w.statusCounts.rejected + w.statusCounts.draft;

                // Additional validation logging (only in development)
                if (process.env.NODE_ENV === 'development') {
                    if (status === 'Approved' && w.statusCounts.approved === 0) {
                        console.error(`[fetchWeeklySummaries] ERROR: Status is Approved but no approved days found for week ${w.weekKey}`);
                    }
                    if (status === 'Pending' && w.statusCounts.pending === 0) {
                        console.error(`[fetchWeeklySummaries] ERROR: Status is Pending but no pending days found for week ${w.weekKey}`);
                    }
                }

                let submitted = '';
                if (w.submittedAtList && w.submittedAtList.length > 0) {
                    const latestDate = w.submittedAtList.sort((a, b) => b.getTime() - a.getTime())[0];
                    submitted = latestDate.toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true
                    });
                } else if (w.createdAtList.length > 0) {
                    submitted = w.createdAtList.sort((a, b) => b - a)[0].toISOString().slice(0, 10);
                }

                return {
                    weekKey: w.weekKey,
                    start: w.start,
                    end: w.end,
                    totals: w.totals,
                    status,
                    adminNotes: w.notes[0] || '',
                    submitted,
                    approvedByName: w.approvedByName || null,
                    approvedAt: w.approvedAt || null,
                    approvedBy: w.approvedBy || null,
                    siteId: w.siteId || null, // Include siteId
                };
            });

        // Cache the result
        cacheUserTimesheets(userId, result, maxWeeks);

        console.log(`fetchWeeklySummaries: Processed ${snap.docs.length} documents into ${result.length} weeks for user ${userId}`);
        return result;
    });
}

// Optimized version with caching and batch queries
export async function fetchWeekDetails(userId, weekStart, options = {}) {
    return measureAsync(`fetchWeekDetails-${userId}-${weekStart}`, async () => {
        const baseDate = typeof weekStart === 'string' ? new Date(weekStart) : new Date(weekStart);
        if (Number.isNaN(baseDate.getTime())) {
            throw new Error('[timesheets.fetchWeekDetails] Invalid weekStart provided');
        }
        const context = options.weekStartDay
            ? { weekStartDay: options.weekStartDay }
            : await getUserWeekContext(userId);
        const weekStartDay = context.weekStartDay || DEFAULT_WEEK_START_DAY;
        const { start, end: requestedEnd } = getWeekRange(baseDate, weekStartDay);
        const weekStartStr = formatISODate(start);
        const endDateStr = formatISODate(requestedEnd);

        // Check cache first
        const cached = getCachedWeeklyData(userId, weekStartStr);
        if (cached) return cached;

        console.log(`fetchWeekDetails: Fetching fresh data for user ${userId}, week ${weekStartStr}`);
        const { collection, query, where, getDocs, doc, getDoc } = await import('firebase/firestore');
        const companyIdPath = context.companyIdPath;

        const weekDates = getOrderedWeekDates(start, weekStartDay);
        const datesStrs = weekDates.map(d => formatISODate(d.date));
        const tsCol = collection(db, 'timesheets');

        // NEW: Batch Fetch Daily Documents
        const qDaily = query(tsCol, where('userId', '==', userId), where('period', 'in', datesStrs));
        const dailySnap = await getDocs(qDaily);
        let results = dailySnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // FALLBACK: Legacy Overlap Query (to find old weekly docs)
        // OPTIMIZATION: Removed where('start', '<=', endDateStr) to avoid composite index requirements
        const qLegacy = query(
            tsCol,
            where('userId', '==', userId)
        );
        let legacyDocs = [];
        try {
            const legacySnap = await getDocs(qLegacy);
            legacyDocs = legacySnap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(d => {
                    let docStart = d.start;
                    if (docStart && docStart.toDate) docStart = docStart.toDate().toISOString().slice(0, 10);
                    else if (!docStart && d.period) docStart = d.period;

                    let docEnd = d.end;
                    if (docEnd && docEnd.toDate) docEnd = docEnd.toDate().toISOString().slice(0, 10);
                    else if (!docEnd && d.period) docEnd = d.period;

                    return docStart <= endDateStr && docEnd >= weekStartStr;
                });
        } catch (err) {
            console.warn('qLegacy failed:', err);
        }

        // Merge and Deduplicate by ID
        const docMap = new Map();
        results.forEach(d => docMap.set(d.id, d));
        legacyDocs.forEach(d => {
            if (!docMap.has(d.id)) {
                docMap.set(d.id, d);
                results.push(d);
            }
        });

        if (results.length > 0) {
            const mergedEntries = results.flatMap(r => r.entries || []);
            // Filter entries to exactly this week's range
            const filteredEntries = mergedEntries.filter(e => e.date >= weekStartStr && e.date <= endDateStr);

            // Sort by date then time
            filteredEntries.sort((a, b) => {
                const dComp = a.date.localeCompare(b.date);
                if (dComp !== 0) return dComp;
                const timeA = a.roundedStart || a.rawStart || '';
                const timeB = b.roundedStart || b.rawStart || '';
                return String(timeA).localeCompare(String(timeB));
            });

            // Calculate Totals
            const totals = filteredEntries.reduce((acc, e) => ({
                grossSec: acc.grossSec + (e.grossSec || 0),
                effectiveSec: acc.effectiveSec + (e.effectiveSec || 0),
                overtimeSec: acc.overtimeSec + (e.overtimeSec || 0)
            }), { grossSec: 0, effectiveSec: 0, overtimeSec: 0 });

            // Status Aggregation (Surgical Priority)
            const stats = results.reduce((acc, r) => {
                const s = (r.status || 'draft').toLowerCase();
                acc[s] = (acc[s] || 0) + 1;
                return acc;
            }, {});

            const status = stats.rejected > 0 ? 'rejected' :
                stats.draft > 0 ? 'draft' :
                    stats.pending > 0 ? 'pending' :
                        stats.approved > 0 ? 'approved' : 'draft';

            const virtualWeek = {
                id: `virtual_${userId}_${weekStartStr}`,
                userId,
                period: weekStartStr,
                start: weekStartStr,
                end: endDateStr,
                entries: filteredEntries,
                totals,
                status,
                isVirtual: true,
                mergedFrom: results.map(r => r.id),
                approvals: results[0]?.approvals || {},
                managerUserId: results[0]?.managerUserId || null
            };

            cacheWeeklyData(userId, weekStartStr, virtualWeek);
            return virtualWeek;
        }

        return { userId, period: weekStartStr, start: weekStartStr, end: endDateStr, entries: [], totals: { grossSec: 0, effectiveSec: 0, overtimeSec: 0 }, status: 'draft' };
    });
}

// Helper: Resolve Manager UserId for submission - OPTIMIZED with timeout protection
async function resolveManagerUserId(employeeId, companyIdPath) {
    const TIMEOUT_MS = 800; // 800ms timeout for manager resolution

    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Manager resolution timeout')), TIMEOUT_MS);
    });

    const fetchPromise = (async () => {
        try {
            const compKey = (companyIdPath || '').includes('/') ? (companyIdPath.split('/')[1] || '') : (companyIdPath || '');

            // PARALLELIZE: Check assignments and user doc simultaneously
            const [aSnap, uSnap] = await Promise.all([
                getDocs(query(collection(db, 'assignments'),
                    where('companyId', 'in', [compKey, `companies/${compKey}`]),
                    where('employeeId', '==', employeeId))
                ).catch(() => ({ empty: true })), // Don't fail if assignments query fails
                getDoc(doc(db, 'users', employeeId))
                    .catch(() => ({ exists: false })) // Don't fail if user doc fails
            ]);

            // Check assignments first
            if (!aSnap.empty && aSnap.docs && aSnap.docs.length > 0) {
                const a = aSnap.docs[0].data();
                const managerId = (a.managerUserId || a.managerId || '').split('/').pop() || null;
                if (managerId) {
                    console.log(`[resolveManagerUserId] Found manager via assignments: ${managerId}`);
                    return managerId;
                }
            }

            // Fallback to user doc
            if (uSnap.exists()) {
                const managerId = uSnap.data().managerUserId || uSnap.data().reportsTo || null;
                if (managerId) {
                    console.log(`[resolveManagerUserId] Found manager via user doc: ${managerId}`);
                    return managerId;
                }
            }
        } catch (error) {
            console.warn('[resolveManagerUserId] Error resolving manager:', error);
        }

        console.log(`[resolveManagerUserId] No manager found for employee: ${employeeId}`);
        return null;
    })();

    return Promise.race([fetchPromise, timeoutPromise])
        .catch(e => {
            console.warn('[resolveManagerUserId] Using fallback due to error:', e);
            return null; // Always return null on failure
        });
}


/**
 * Optimised batch fetch for "All Users" view.
 * Fetches ALL timesheets for a company in a specific week in ONE query.
 * Replaces the N+1 loop in TimeEntriesPage.
 */
export async function fetchCompanyTimesheetsForWeek(companyId, weekStart) {
    return measureAsync(`fetchCompanyTimesheetsForWeek-${companyId}-${weekStart}`, async () => {
        const { collection, query, where, getDocs, orderBy } = await import('firebase/firestore');
        const { db } = await import('../firebase/client');
        const { formatISODate } = await import('../utils/weekStartUtils');

        // Ensure companyId is in the correct format
        const companyIds = [companyId];
        if (!companyId.startsWith('companies/')) {
            companyIds.push(`companies/${companyId}`);
        } else {
            companyIds.push(companyId.split('/').pop());
        }

        const targetDateStr = typeof weekStart === 'string' ? weekStart : formatISODate(weekStart);
        const targetDate = new Date(targetDateStr);

        // Calculate Search Window (Target +/- 7 days) to catch staggered weeks
        const minStartDate = new Date(targetDate);
        minStartDate.setDate(minStartDate.getDate() - 7);
        const minDateStr = formatISODate(minStartDate);

        const maxStartDate = new Date(targetDate);
        maxStartDate.setDate(maxStartDate.getDate() + 7);
        const maxDateStr = formatISODate(maxStartDate);

        console.log(`[fetchCompanyTimesheetsForWeek] Range Query: ${minDateStr} to ${maxDateStr} for ${companyIds.join(' or ')}`);

        // Use Promise.all to handle multiple company ID variations properly with range queries (avoid composite index issues with 'in')
        const queries = companyIds.map(cid => {
            return query(
                collection(db, 'timesheets'),
                where('companyId', '==', cid),
                where('period', '>=', minDateStr),
                where('period', '<=', maxDateStr)
            );
        });

        const snaps = await Promise.all(queries.map(q => getDocs(q)));
        const allDocs = snaps.flatMap(s => s.docs.map(d => ({ id: d.id, ...d.data() })));

        // Deduplicate by ID (in case of overlap or double fetch)
        const uniqueDocs = Array.from(new Map(allDocs.map(item => [item.id, item])).values());

        // Client-Side Filter: Ensure they actually overlap the TARGET week
        // Target Week: [targetDate, targetDate + 6]
        const targetStartVal = targetDateStr;
        const targetEndVal = formatISODate(new Date(targetDate.getTime() + 6 * 86400000));

        const validDocs = uniqueDocs.filter(doc => {
            const docStart = doc.start || doc.period;
            const docEnd = doc.end;

            // Check Overlap: (DocStart <= TargetEnd) AND (DocEnd >= TargetStart)
            if (docStart && docEnd) {
                return (docStart <= targetEndVal) && (docEnd >= targetStartVal);
            }
            // Fallback for malformed docs (just check period proximity)
            return true;
        });

        console.log(`[fetchCompanyTimesheetsForWeek] Found ${uniqueDocs.length} raw, ${validDocs.length} overlapping timesheets`);
        return validDocs;
    });
}

// Save edits for a week: dayEdits = Array<{ date: 'YYYY-MM-DD', clockIn?: 'HH:MM', clockOut?: 'HH:MM', breakMin?: number, notes?: string, sessionId?: string }>
// Save edits for a week: dayEdits = Array<{ date: 'YYYY-MM-DD', clockIn?: 'HH:MM', clockOut?: 'HH:MM', breakMin?: number, notes?: string, sessionId?: string }>

/** Per-day sequential updates (uses updateTimeEntry open-session handling). Slower but safe fallback. */
async function saveWeekUpdatesSequential(userId, updates, createDateTimeFromStrings) {
    const updatesByDate = new Map();
    for (const edit of updates) {
        const d = edit.date;
        if (!updatesByDate.has(d)) updatesByDate.set(d, []);
        updatesByDate.get(d).push(edit);
    }
    const runOneUpdate = async (edit) => {
        let clockInISO = undefined;
        let clockOutISO = undefined;
        if (edit.clockIn) {
            const dt = createDateTimeFromStrings(edit.date, edit.clockIn);
            if (!isNaN(dt.getTime())) clockInISO = dt.toISOString();
        }
        if (edit.clockOut) {
            const dt = createDateTimeFromStrings(edit.date, edit.clockOut);
            if (!isNaN(dt.getTime())) clockOutISO = dt.toISOString();
        }
        return updateTimeEntry({
            userId,
            dateStr: edit.date,
            sessionId: edit.sessionId,
            entryId: edit.entryId,
            originalClockIn: edit.rawStart || edit.originalClockIn,
            updates: {
                clockIn: clockInISO,
                clockOut: clockOutISO,
                breakMin: edit.breakMin,
                notes: edit.notes || edit.description,
                editedBy: userId
            }
        });
    };
    const results = [];
    const sortedDates = [...updatesByDate.keys()].sort();
    for (const dateStr of sortedDates) {
        const list = updatesByDate.get(dateStr);
        if (list.length > 1) {
            results.push(await batchUpdateTimeEntriesForDay(userId, dateStr, list, createDateTimeFromStrings));
        } else {
            results.push(await runOneUpdate(list[0]));
        }
    }
    return results;
}

export async function saveWeekEdits(userId, weekStart, dayEdits = [], options = {}) {
    console.log('[saveWeekEdits] Starting save:', { userId, weekStart, count: dayEdits.length });

    const { createDateTimeFromStrings } = await import('../utils/timeFormatUtils');

    const results = [];
    let lastSuccessData = null;

    const isNewEntry = (edit) => !edit.sessionId || edit.sessionId.startsWith('entry_') || edit.sessionId.startsWith('manual_');

    const creates = [];
    const updates = [];
    for (const edit of dayEdits) {
        if (isNewEntry(edit)) creates.push(edit);
        else updates.push(edit);
    }

    const pushResult = (result) => {
        if (result && result.success) {
            results.push(result);
            if (result.updatedTimesheet) {
                lastSuccessData = result.updatedTimesheet;
            }
        } else {
            throw new Error((result && result.error) || 'Save operation failed');
        }
    };

    try {
        for (const edit of creates) {
            console.log(`[saveWeekEdits] NEW entry for ${edit.date} — temp session: ${edit.sessionId || 'none'}`);
            const result = await addManualTimeEntry(
                userId,
                edit.date,
                edit.clockIn,
                edit.clockOut,
                'monday',
                null,
                {
                    breakMin: edit.breakMin,
                    notes: edit.notes || edit.description,
                    isDescriptionOnly: (!edit.clockIn && !edit.clockOut),
                    activityType: edit.activityType
                }
            );
            pushResult(result);
        }

        if (updates.length > 0) {
            try {
                console.log('[saveWeekEdits] Merged single write for', updates.length, 'entry update(s)');
                const result = await mergeAndSaveWeekUpdates(userId, updates, createDateTimeFromStrings);
                pushResult(result);
            } catch (mergeErr) {
                console.warn('[saveWeekEdits] Merged save failed, falling back to sequential per-day updates:', mergeErr);
                const seq = await saveWeekUpdatesSequential(userId, updates, createDateTimeFromStrings);
                for (const r of seq) pushResult(r);
            }
        }
    } catch (error) {
        console.error('[saveWeekEdits] Save failed:', error);
        throw error;
    }

    return {
        success: true,
        affected: results.length,
        updatedTimesheet: lastSuccessData,
        message: "Week updates synced successfully",
        timestamp: Date.now()
    };
}

// Aggregate daily entries for dashboard "Recent Time Entries"
export async function fetchLast7DaysAggregated(userId) {
    const { collection, query, where, getDocs } = await import('firebase/firestore');

    // Get last 7 days dates
    const days = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        days.push(formatISODate(d));
    }

    const tsCol = collection(db, 'timesheets');
    const sessCol = collection(db, 'timeClockSessions');

    // OPTIMIZATION: Fetch all data in parallel
    // 1. Fetch sessions ONCE (instead of 7 times in loop) - massive speedup
    const sessionPromise = getDocs(query(sessCol, where('userId', '==', userId)));

    // 2. Fetch timesheets for each day in parallel
    const timesheetPromises = days.map(dateStr =>
        getDocs(query(tsCol, where('userId', '==', userId), where('period', '==', dateStr)))
    );

    // Wait for all data
    const [sessionSnap, ...tsSnaps] = await Promise.all([sessionPromise, ...timesheetPromises]);

    // Process sessions into memory for fast lookup
    const allSessions = sessionSnap.docs.map(d => ({ ...d.data(), id: d.id }));

    // Helpers
    const getRoundedStart = (s) => s.roundedStartedAt?.toDate?.() || s.startedAt?.toDate?.();
    const getRoundedEnd = (s) => {
        if (s.status === 'open') return null;
        return s.roundedEndedAt?.toDate?.() || s.endedAt?.toDate?.();
    };
    const formatSeconds = (sec) => {
        const h = Math.floor((sec || 0) / 3600);
        const m = Math.floor(((sec || 0) % 3600) / 60);
        return `${String(h)}h ${String(m).padStart(2, '0')}m`;
    };

    const entries = [];

    // Synchronously process the data
    for (let i = 0; i < days.length; i++) {
        const dateStr = days[i];
        const snap = tsSnaps[i];

        // Filter sessions for this day (in memory)
        const sameDaySessions = allSessions.filter(s => {
            const startDate = s.startedAt?.toDate?.();
            if (!startDate) return false;
            return startDate.toISOString().slice(0, 10) === dateStr;
        });

        if (!snap.empty) {
            const data = snap.docs[0].data();

            // Refactored: Get all clock in/out pairs from sessions
            const rawPairs = sameDaySessions.map(s => {
                return {
                    clockIn: getRoundedStart(s),
                    clockOut: getRoundedEnd(s),
                    sessionId: s.id || s.sessionId,
                    status: s.status || 'closed'
                };
            });

            let clockInOutPairs = rawPairs
                .filter(pair => pair.clockIn)
                .sort((a, b) => a.clockIn - b.clockIn);

            // CLIENT REQ: Also check timesheet entry for clock-in time if no sessions found
            if (clockInOutPairs.length === 0 && data.entries && Array.isArray(data.entries)) {
                const dayEntry = data.entries.find(e => e.date === dateStr);
                if (dayEntry) {
                    // Check for manual entry first (has roundedStart/roundedEnd)
                    if (dayEntry.isManual && dayEntry.roundedStart && dayEntry.roundedEnd) {
                        const clockInDate = new Date(dayEntry.roundedStart);
                        const clockOutDate = new Date(dayEntry.roundedEnd);
                        clockInOutPairs = [{
                            clockIn: clockInDate,
                            clockOut: clockOutDate,
                            sessionId: null,
                            status: 'closed',
                            isManual: true
                        }];
                    }
                    // Fallback to rawStart/rawEnd for regular entries
                    else if (dayEntry.rawStart) {
                        const clockInDate = new Date(dayEntry.rawStart);
                        clockInOutPairs = [{
                            clockIn: clockInDate,
                            clockOut: dayEntry.rawEnd ? new Date(dayEntry.rawEnd) : null,
                            sessionId: dayEntry.sessionIds?.[0] || null,
                            status: dayEntry.rawEnd ? 'closed' : 'open'
                        }];
                    }
                }
            }

            // First clock in and last clock out for summary
            const firstIn = clockInOutPairs.length > 0 ? clockInOutPairs[0].clockIn : null;
            const lastOut = clockInOutPairs.length > 0
                ? clockInOutPairs.map(p => p.clockOut).filter(Boolean).sort((a, b) => b - a)[0]
                : null;

            // Compute Break Seconds
            let breakSec = 0;
            let dayEffectiveSec = 0;
            let dayOvertimeSec = 0;

            if (data.entries && Array.isArray(data.entries)) {
                const dayEntry = data.entries.find(e => e.date === dateStr);
                if (dayEntry) {
                    dayEffectiveSec = dayEntry.effectiveSec || 0;
                    dayOvertimeSec = dayEntry.overtimeSec || 0;

                    const storedManualBreak = Number.isFinite(dayEntry.manualBreakSec) ? Math.max(0, dayEntry.manualBreakSec) : null;
                    const storedAutoBreak = Number.isFinite(dayEntry.autoLunchBreakSec) ? Math.max(0, dayEntry.autoLunchBreakSec) : null;
                    if (storedManualBreak !== null || storedAutoBreak !== null) {
                        breakSec = Math.max(0, (storedManualBreak || 0) + (storedAutoBreak || 0));
                    } else if (Number.isFinite(dayEntry.grossSec) && Number.isFinite(dayEntry.effectiveSec)) {
                        breakSec = Math.max(0, dayEntry.grossSec - dayEntry.effectiveSec);
                    }
                }
            }

            // Fallback break calc from sessions
            if (breakSec === 0 && sameDaySessions.length > 0) {
                breakSec = sameDaySessions.reduce((acc, s) => {
                    const manual = Number.isFinite(s.manualBreakSec) ? Math.max(0, s.manualBreakSec) : 0;
                    const autoLunch = Number.isFinite(s.autoLunchBreakSec) ? Math.max(0, s.autoLunchBreakSec) : 0;
                    const legacyBreak = Number.isFinite(s.breakSec) ? Math.max(0, s.breakSec) : 0;
                    return acc + ((manual || autoLunch) ? (manual + autoLunch) : legacyBreak);
                }, 0);
            }

            // Format all clock in/out pairs for display
            const clockInOutPairsFormatted = clockInOutPairs.map(pair => ({
                clockIn: pair.clockIn ? pair.clockIn.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '-',
                clockOut: pair.clockOut ? pair.clockOut.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '-',
                clockInTime: pair.clockIn,
                clockOutTime: pair.clockOut
            }));

            entries.push({
                date: dateStr,
                day: new Date(dateStr).toLocaleDateString('en-US', { weekday: 'long' }),
                clockIn: firstIn ? firstIn.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '-',
                clockOut: lastOut ? lastOut.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '-',
                clockInOutPairs: clockInOutPairsFormatted,
                breakHours: formatSeconds(breakSec),
                totalHours: formatSeconds(dayEffectiveSec),
                overtime: formatSeconds(dayOvertimeSec),
                effectiveSec: dayEffectiveSec,
                overtimeSec: dayOvertimeSec,
                breakSec: breakSec
            });
        } else {
            // Entry not found
            entries.push({
                date: dateStr,
                day: new Date(dateStr).toLocaleDateString('en-US', { weekday: 'long' }),
                clockIn: '-',
                clockOut: '-',
                clockInOutPairs: [],
                breakHours: '0h 00m',
                totalHours: '0h 00m',
                overtime: '0h 00m'
            });
        }
    }

    return entries;
}



// New optimized functions for batch operations and manager views

// Batch fetch timesheets for multiple users (for manager views)
export async function fetchTimesheetsForUsers(userIds, options = {}) {
    return measureAsync(`fetchTimesheetsForUsers-${userIds.length}`, async () => {
        const { maxWeeks = 12, weekStart = null, includeDetails = false } = options;

        if (!Array.isArray(userIds) || userIds.length === 0) {
            console.warn('fetchTimesheetsForUsers: Invalid userIds array');
            return {};
        }

        console.log(`fetchTimesheetsForUsers: Fetching data for ${userIds.length} users`);

        // Check cache for each user first
        const results = {};
        const uncachedUserIds = [];

        for (const userId of userIds) {
            const cached = getCachedUserTimesheets(userId, maxWeeks);
            if (cached) {
                results[userId] = cached;
            } else {
                uncachedUserIds.push(userId);
            }
        }

        if (uncachedUserIds.length === 0) {
            console.log('fetchTimesheetsForUsers: All data found in cache');
            return results;
        }

        // Batch fetch uncached data
        const { collection, query, where, getDocs } = await import('firebase/firestore');
        const tsCol = collection(db, 'timesheets');

        // Build date filter for performance
        let dateFilter = {};
        if (weekStart) {
            const startDate = new Date(weekStart);
            const endDate = new Date(startDate);
            endDate.setDate(startDate.getDate() + 6);
            dateFilter = {
                startDate: formatISODate(startDate),
                endDate: formatISODate(endDate)
            };
        } else {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - (maxWeeks * 7 + 14));
            dateFilter = {
                startDate: formatISODate(cutoffDate)
            };
        }

        // Execute parallel queries for better performance
        const queryPromises = uncachedUserIds.map(async (userId) => {
            let snap;

            try {
                // Try optimized query with date filtering first
                let q = query(tsCol, where('userId', '==', userId));

                if (dateFilter.startDate) {
                    q = query(tsCol,
                        where('userId', '==', userId),
                        where('period', '>=', dateFilter.startDate)
                    );

                    if (dateFilter.endDate) {
                        q = query(tsCol,
                            where('userId', '==', userId),
                            where('period', '>=', dateFilter.startDate),
                            where('period', '<=', dateFilter.endDate)
                        );
                    }
                }

                snap = await getDocs(q);
            } catch (error) {
                // Fall back to basic query if index doesn't exist
                if (error.code === 'failed-precondition') {
                    console.warn(`fetchTimesheetsForUsers: Falling back to basic query for user ${userId} due to missing index`);
                    const basicQuery = query(tsCol, where('userId', '==', userId));
                    const basicSnap = await getDocs(basicQuery);

                    // Apply client-side filtering if date filters were specified
                    let filteredDocs = basicSnap.docs;
                    if (dateFilter.startDate || dateFilter.endDate) {
                        filteredDocs = basicSnap.docs.filter(doc => {
                            const period = doc.data().period;
                            if (!period) return false;
                            if (dateFilter.startDate && period < dateFilter.startDate) return false;
                            if (dateFilter.endDate && period > dateFilter.endDate) return false;
                            return true;
                        });
                    }

                    snap = { docs: filteredDocs };
                } else {
                    throw error;
                }
            }

            return { userId, docs: snap.docs };
        });

        const queryResults = await Promise.all(queryPromises);

        // Process results for each user
        for (const { userId, docs } of queryResults) {
            const weeks = new Map();
            const userContext = await getUserWeekContext(userId);
            const userWeekStartDay = userContext.weekStartDay || DEFAULT_WEEK_START_DAY;

            for (const docSnap of docs) {
                const t = docSnap.data();
                const period = t.period;
                if (!period) continue;

                const { key, start, end } = weekKeyForDateStr(period, userWeekStartDay);
                if (!weeks.has(key)) {
                    weeks.set(key, {
                        weekKey: key,
                        start,
                        end,
                        totals: { grossSec: 0, effectiveSec: 0, overtimeSec: 0 },
                        statusCounts: { approved: 0, pending: 0, draft: 0, rejected: 0 },
                        notes: [],
                        createdAtList: [],
                        docIds: includeDetails ? [] : undefined,
                    });
                }

                const w = weeks.get(key);
                w.totals.effectiveSec += t?.totals?.effectiveSec || 0;
                w.totals.grossSec += t?.totals?.grossSec || 0;
                w.totals.overtimeSec += t?.totals?.overtimeSec || 0;

                const status = (t.status || 'draft').toLowerCase();
                if (status === 'approved') w.statusCounts.approved += 1;
                else if (status === 'rejected') w.statusCounts.rejected += 1;
                else if (status === 'pending') w.statusCounts.pending += 1;
                else w.statusCounts.draft += 1;

                if (t.adminNotes) w.notes.push(t.adminNotes);
                if (t.createdAt?.toDate) w.createdAtList.push(t.createdAt.toDate());
                if (includeDetails && w.docIds) w.docIds.push(docSnap.id);
                // Capture siteId (take first one found for the week)
                if (t.siteId && !w.siteId) w.siteId = t.siteId;
            }

            const userResult = Array.from(weeks.values())
                .sort((a, b) => b.end - a.end)
                .slice(0, maxWeeks)
                .map(w => {
                    let status = 'Draft';
                    if (w.statusCounts.pending > 0) status = 'Pending';
                    else if (w.statusCounts.rejected > 0) status = 'Rejected';
                    else if (w.statusCounts.approved > 0 && w.statusCounts.draft === 0 && w.statusCounts.pending === 0) status = 'Approved';

                    const submitted = w.createdAtList.length ?
                        w.createdAtList.sort((a, b) => b - a)[0].toISOString().slice(0, 10) : '';

                    const result = {
                        weekKey: w.weekKey,
                        start: w.start,
                        end: w.end,
                        totals: w.totals,
                        status,
                        adminNotes: w.notes[0] || '',
                        submitted,
                    };

                    return {
                        weekKey: w.weekKey,
                        start: w.start,
                        end: w.end,
                        totals: w.totals,
                        status,
                        adminNotes: w.notes[0] || '',
                        submitted,
                        siteId: w.siteId || null, // Include siteId
                    };
                });

            results[userId] = userResult;

            // Cache individual user results
            cacheUserTimesheets(userId, userResult, maxWeeks);
        }

        console.log(`fetchTimesheetsForUsers: Processed data for ${uncachedUserIds.length} users, ${Object.keys(results).length} total results`);
        return results;
    });
}

// Fetch pending approvals for a manager with caching
export async function fetchPendingApprovalsForManager(managerId, options = {}) {
    return measureAsync(`fetchPendingApprovalsForManager-${managerId}`, async () => {
        const { includeTeamData = true } = options;

        // Check cache first
        const cached = timesheetCache.getManagerPendingApprovals(managerId);
        if (cached) {
            console.log(`fetchPendingApprovalsForManager: Using cached data for manager ${managerId}`);
            return cached;
        }

        console.log(`fetchPendingApprovalsForManager: Fetching fresh data for manager ${managerId}`);

        // Get managed employee IDs
        const managedEmployeeIds = await getManagedEmployeeIdsForManager(managerId);
        if (managedEmployeeIds.size === 0) {
            console.log(`fetchPendingApprovalsForManager: No managed employees found for manager ${managerId}`);
            return [];
        }

        const employeeIds = Array.from(managedEmployeeIds);
        const employeeWeekStartMap = new Map();
        await Promise.all(employeeIds.map(async (employeeId) => {
            const context = await getUserWeekContext(employeeId);
            employeeWeekStartMap.set(employeeId, context.weekStartDay || DEFAULT_WEEK_START_DAY);
        }));

        // Fetch pending timesheets for all managed employees
        const { collection, query, where, getDocs } = await import('firebase/firestore');
        const tsCol = collection(db, 'timesheets');

        // Execute parallel queries for better performance
        const queryPromises = employeeIds.map(async (employeeId) => {
            const q = query(
                tsCol,
                where('userId', '==', employeeId),
                where('status', '==', 'pending')
            );
            const snap = await getDocs(q);
            return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        });

        const results = await Promise.all(queryPromises);
        const pendingTimesheets = results.flat();

        // Group by week for manager view if requested
        let processedResults = pendingTimesheets;

        if (includeTeamData) {
            const weekMap = new Map();

            for (const timesheet of pendingTimesheets) {
                const employeeWeekStartDay = employeeWeekStartMap.get(timesheet.userId) || DEFAULT_WEEK_START_DAY;
                const { key } = weekKeyForDateStr(timesheet.period, employeeWeekStartDay);
                if (!weekMap.has(key)) {
                    weekMap.set(key, []);
                }
                weekMap.get(key).push(timesheet);
            }

            processedResults = Array.from(weekMap.entries()).map(([weekKey, timesheets]) => ({
                weekKey,
                timesheets,
                employeeCount: new Set(timesheets.map(t => t.userId)).size,
                totalHours: timesheets.reduce((sum, t) => sum + (t.totals?.effectiveSec || 0), 0)
            }));
        }

        // Cache the result
        timesheetCache.setManagerPendingApprovals(managerId, processedResults);

        console.log(`fetchPendingApprovalsForManager: Found ${pendingTimesheets.length} pending timesheets for manager ${managerId}`);
        return processedResults;
    });
}

// Prefetch adjacent weeks for better user experience
export async function prefetchAdjacentWeeks(userId, currentWeekStart, prefetchCount = 2) {
    return measureAsync(`prefetchAdjacentWeeks-${userId}`, async () => {
        const currentDate = new Date(currentWeekStart);
        const weeksToFetch = [];

        // Add previous weeks
        for (let i = 1; i <= prefetchCount; i++) {
            const prevWeek = new Date(currentDate);
            prevWeek.setDate(currentDate.getDate() - (i * 7));
            weeksToFetch.push(formatISODate(prevWeek));
        }

        // Add next weeks
        for (let i = 1; i <= prefetchCount; i++) {
            const nextWeek = new Date(currentDate);
            nextWeek.setDate(currentDate.getDate() + (i * 7));
            weeksToFetch.push(formatISODate(nextWeek));
        }

        // Prefetch weeks that aren't already cached
        const prefetchPromises = weeksToFetch
            .filter(weekStart => !getCachedWeeklyData(userId, weekStart))
            .map(weekStart => fetchWeekDetails(userId, weekStart));

        if (prefetchPromises.length > 0) {
            await Promise.allSettled(prefetchPromises);
            console.log(`prefetchAdjacentWeeks: Prefetched ${prefetchPromises.length} weeks for user ${userId}`);
        }

        return prefetchPromises.length;
    });
}

// Invalidate cache when timesheet data changes
// Redundant function removed (imported from timesheetCache.js)
// Clock in/out wrapper functions for the one-session-per-day feature
// Redundant legacy clocking logic removed.
// Production clocking is handled in timeClock.js.


// Add manual time entry with hierarchy validation
export async function addManualTimeEntry(userId, entryDate, clockInTime, clockOutTime, weekStartDay = DEFAULT_WEEK_START_DAY, explicitTimesheetId = null, additionalData = {}) {
    const startTotal = Date.now();
    console.log('[addManualTimeEntry] Starting - adding manual time entry', {
        userId,
        entryDate,
        clockInTime,
        clockOutTime,
        isDescriptionOnly: additionalData.isDescriptionOnly
    });

    try {
        // Check if this is a description-only entry (no clock times)
        const isDescriptionOnly = additionalData.isDescriptionOnly === true || (!clockInTime && !clockOutTime);

        // Step 1: Validate required fields based on entry type
        if (!userId || !entryDate) {
            throw new Error('Missing required fields: userId, entryDate');
        }

        // For regular entries, require clock times
        if (!isDescriptionOnly && (!clockInTime || !clockOutTime)) {
            throw new Error('Missing required fields: clockInTime, clockOutTime (or use isDescriptionOnly flag)');
        }

        // Step 2: Calculate the week start date based on the entry date
        const entryDateObj = typeof entryDate === 'string' && entryDate.length === 10 ? new Date(entryDate + 'T00:00:00') : new Date(entryDate);
        const { start: weekStart, end: weekEnd } = getWeekRangeForDate(entryDateObj, weekStartDay);
        const weekStartStr = formatISODateUtil(weekStart);
        const weekEndStr = formatISODateUtil(weekEnd);
        console.log('[addManualTimeEntry] Week start calculated:', weekStartStr, 'Week end calculated:', weekEndStr);

        // Step 3: Get user's company information
        // Avoid unconditional force refresh here because it can add noticeable latency to the save flow.
        // If context is missing, retry once with forceRefresh.
        let companyIdPath = null;
        let siteIdPath = null;
        try {
            const ctx = await getUserWeekContext(userId);
            companyIdPath = ctx?.companyIdPath || null;
            siteIdPath = ctx?.siteIdPath || null;
        } catch (_) {
        }
        if (!companyIdPath) {
            try {
                const ctx = await getUserWeekContext(userId, { forceRefresh: true });
                companyIdPath = ctx?.companyIdPath || null;
                siteIdPath = ctx?.siteIdPath || null;
            } catch (_) {
            }
        }
        // Normalize for safe usage below (avoid `.includes` on null)
        const safeCompanyIdPath = typeof companyIdPath === 'string' ? companyIdPath : '';
        console.log('[addManualTimeEntry] User company path:', safeCompanyIdPath);

        // Extract raw siteId
        const contextSiteId = siteIdPath ? (siteIdPath.includes('/') ? siteIdPath.split('/').pop() : siteIdPath) : null;
        console.log('[addManualTimeEntry] User siteId:', contextSiteId);

        if (!safeCompanyIdPath) {
            console.warn('[addManualTimeEntry] NO COMPANY ID FOUND for user', userId);
        }

        // Step 3.4: Get assignment info for this timesheet entry
        const tAssign = Date.now();
        const { getAssignmentForTimesheetEntry } = await import('./timesheetAssignmentHelper');
        const assignPromise = getAssignmentForTimesheetEntry(userId, entryDate);

        // Step 3.5: Get rounding rules for the company
        const tRounding = Date.now();
        const roundingRulesPromise = resolveRoundingRules(safeCompanyIdPath);

        // Step 4: Find existing timesheet for this day (Deterministic ID)
        const tTimesheetDoc = Date.now();
        const timesheetId = getTimesheetId(userId, entryDate);
        const timesheetRef = doc(db, 'timesheets', timesheetId);
        const timesheetSnapPromise = getDoc(timesheetRef);

        // Parallel fetch assignment, rounding rules, and timesheet doc
        const [assignmentInfo, roundingRules, timesheetSnap] = await Promise.all([
            assignPromise.catch(e => { console.warn('[addManualTimeEntry] Assignment fetch failed:', e); return null; }),
            roundingRulesPromise.catch(e => { console.warn('[addManualTimeEntry] Rounding rules fetch failed:', e); return {}; }),
            timesheetSnapPromise
        ]);
        console.log(`[addManualTimeEntry] Parallel fetches took ${Date.now() - tAssign}ms`);
        console.log('[addManualTimeEntry] Assignment info:', assignmentInfo);
        console.log('[addManualTimeEntry] Rounding rules:', roundingRules);
        console.log(`[addManualTimeEntry] Timesheet doc read took ${Date.now() - tTimesheetDoc}ms`);

        // Step 5: Create new daily timesheet if one doesn't exist
        if (!timesheetSnap.exists()) {
            const tCreate = Date.now();
            console.log('[addManualTimeEntry] No daily timesheet found - creating new one', timesheetId);
            const newTimesheetData = {
                id: timesheetId,
                userId,
                companyId: safeCompanyIdPath.includes('/') ? safeCompanyIdPath.split('/').pop() : (safeCompanyIdPath || ''),
                companyIdPath: safeCompanyIdPath.includes('/') ? safeCompanyIdPath : `companies/${safeCompanyIdPath || ''}`,
                period: weekStartStr,
                start: weekStartStr,
                end: weekEndStr,
                weekStartDate: weekStartStr,
                weekKey: weekStartStr,
                status: 'draft',
                entries: [],
                totals: { grossSec: 0, effectiveSec: 0, overtimeSec: 0 },
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            };

            await setDoc(timesheetRef, newTimesheetData);
            console.log(`[addManualTimeEntry] Timesheet doc create took ${Date.now() - tCreate}ms`);
        }

        // Step 6-7: Parse and calculate times (skip for description-only entries)
        let durationSeconds = 0;
        let effectiveSec = 0;
        let totalBreakSec = 0;
        let roundedClockIn = null;
        let roundedClockOut = null;
        let clockInDate = null;
        let clockOutDate = null;
        let roundedStart = null;
        let roundedEnd = null;
        let autoLunchBreakSec = 0;
        let autoLunchApplied = false;
        let manualBreakSec = 0;
        let autoLunchConfig = { enabled: false, thresholdHours: 0, lunchBreakMinutes: 0 }; // Default value

        if (!isDescriptionOnly) {
            // Step 6: Parse and validate clock times
            const [inHours, inMinutes] = clockInTime.split(':').map(Number);
            const [outHours, outMinutes] = clockOutTime.split(':').map(Number);

            const inTimeMinutes = inHours * 60 + inMinutes;
            const outTimeMinutes = outHours * 60 + outMinutes;

            if (outTimeMinutes <= inTimeMinutes) {
                throw new Error('Clock out time must be after clock in time');
            }

            // Step 6.5: Create Date objects for raw times and apply rounding
            clockInDate = typeof entryDate === 'string' && entryDate.length === 10 ? new Date(entryDate + 'T00:00:00') : new Date(entryDate);
            clockInDate.setHours(inHours, inMinutes, 0, 0);

            clockOutDate = typeof entryDate === 'string' && entryDate.length === 10 ? new Date(entryDate + 'T00:00:00') : new Date(entryDate);
            clockOutDate.setHours(outHours, outMinutes, 0, 0);

            // Apply rounding rules to get rounded times
            const roundingResult = roundSessionRange(clockInDate, clockOutDate, roundingRules);
            roundedStart = roundingResult.roundedStart;
            roundedEnd = roundingResult.roundedEnd;

            console.log('[addManualTimeEntry] Time rounding:', {
                raw: { in: clockInTime, out: clockOutTime },
                rounded: {
                    in: `${String(roundedStart.getHours()).padStart(2, '0')}:${String(roundedStart.getMinutes()).padStart(2, '0')}`,
                    out: `${String(roundedEnd.getHours()).padStart(2, '0')}:${String(roundedEnd.getMinutes()).padStart(2, '0')}`
                }
            });

            // Step 7: Calculate duration in seconds using ROUNDED times
            durationSeconds = Math.floor((roundedEnd - roundedStart) / 1000);
            console.log('[addManualTimeEntry] Duration calculated:', durationSeconds, 'seconds');

            // Step 7.5: Fetch auto-lunch configuration and calculate deduction
            const tLunch = Date.now();
            const autoLunchConfigPromise = resolveAutoLunchConfig(safeCompanyIdPath, contextSiteId);
            const autoLunchConfig = await autoLunchConfigPromise.catch(e => { console.warn('[addManualTimeEntry] Auto-lunch config fetch failed:', e); return { enabled: false, thresholdHours: 0, lunchBreakMinutes: 0 }; });
            console.log(`[addManualTimeEntry] Auto-lunch config fetch took ${Date.now() - tLunch}ms`);
            console.log('[addManualTimeEntry] Auto-lunch config:', autoLunchConfig);

            const thresholdSec = (autoLunchConfig.thresholdHours || 0) * 3600;
            const lunchBreakSec = (autoLunchConfig.lunchBreakMinutes || 0) * 60;

            // Fix: Initialize manualBreakSec from additionalData if present
            manualBreakSec = additionalData.breakMin ? Number(additionalData.breakMin) * 60 : 0;

            // Check if auto-lunch should be applied (same logic as stopClock)
            if (autoLunchConfig.enabled &&
                lunchBreakSec > 0 &&
                durationSeconds > thresholdSec &&
                manualBreakSec < lunchBreakSec) {

                const neededLunch = Math.max(0, lunchBreakSec - manualBreakSec);
                const availableForAuto = Math.max(0, durationSeconds - manualBreakSec);
                const appliedLunch = Math.min(neededLunch, availableForAuto);

                if (appliedLunch > 0) {
                    autoLunchBreakSec = appliedLunch;
                    autoLunchApplied = true;
                    console.log('[addManualTimeEntry] Auto-lunch applied:', {
                        thresholdHours: autoLunchConfig.thresholdHours,
                        lunchBreakMinutes: autoLunchConfig.lunchBreakMinutes,
                        autoLunchBreakSec,
                        durationSeconds
                    });
                }
            }

            totalBreakSec = manualBreakSec + autoLunchBreakSec;
            effectiveSec = Math.max(0, durationSeconds - totalBreakSec);

            console.log('[addManualTimeEntry] Break calculation:', {
                manualBreakSec,
                autoLunchBreakSec,
                totalBreakSec,
                grossSec: durationSeconds,
                effectiveSec
            });

            // Format rounded times for storage
            roundedClockIn = `${String(roundedStart.getHours()).padStart(2, '0')}:${String(roundedStart.getMinutes()).padStart(2, '0')}`;
            roundedClockOut = `${String(roundedEnd.getHours()).padStart(2, '0')}:${String(roundedEnd.getMinutes()).padStart(2, '0')}`;
        } else {
            console.log('[addManualTimeEntry] Description-only entry - skipping time calculations');
        }

        // =====================================================================
        // PHASE 1: PREPARE SESSION DOCUMENT (Unified Storage Architecture)
        // Manual entries now create a session in timeClockSessions just like
        // automatic clock sessions, ensuring consistent data flow.
        // [FIX #11] Use batch write for atomicity - if timesheet update fails,
        // session is NOT created (preventing orphan sessions).
        // =====================================================================
        let manualSessionId = null;
        let manualSessionRef = null;
        let manualSessionData = null;

        if (!isDescriptionOnly && clockInDate && clockOutDate) {
            // [STRICT MODE] Session creation is mandatory for time entries. Errors will propagate.
            const { collection: colRef, doc: docRef } = await import('firebase/firestore');
            const { auth } = await import('../firebase/client');

            // [REAL DATA CAPTURE]
            // We capture the CURRENT location and device info of the user performing the manual entry/edit.
            // This provides an audit trail of *where and how* the manual entry was created.

            // 1. Device Info Helper
            const getDeviceInfo = () => {
                const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : 'system');
                const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
                return {
                    type: 'web',
                    platform: isMobile ? 'mobile_web' : 'desktop_web',
                    userAgent: ua,
                    source: 'manual_entry' // Distinct marker
                };
            };
            const currentDeviceInfo = getDeviceInfo();

            // 2. Location Capture (Best Effort)
            let currentLocation = null;
            try {
                const withTimeout = (p, ms) => {
                    let t;
                    const timeout = new Promise((_, reject) => {
                        t = setTimeout(() => reject(new Error('Location timeout')), ms);
                    });
                    return Promise.race([p, timeout]).finally(() => clearTimeout(t));
                };

                // Dynamically import to ensure availability
                const { getUserCurrentLocation } = await import('./locationService');
                const loc = await withTimeout(getUserCurrentLocation(), 900);
                currentLocation = {
                    lat: loc.latitude,
                    lng: loc.longitude,
                    accuracy: loc.accuracy,
                    capturedAt: new Date().toISOString(),
                    type: 'manual_entry_location'
                };
                console.log('[addManualTimeEntry] Location captured:', currentLocation);
            } catch (err) {
                console.warn('[addManualTimeEntry] Location capture failed (non-blocking):', err);
                currentLocation = {
                    error: err.message,
                    code: err.code || 'UNKNOWN',
                    capturedAt: new Date().toISOString()
                };
            }

            // [FIX #11] Pre-generate session doc reference for batch write
            const sessionsRef = colRef(db, 'timeClockSessions');
            manualSessionRef = docRef(sessionsRef); // Auto-generate ID without writing
            manualSessionId = manualSessionRef.id;

            manualSessionData = {
                // Core identifiers
                userId,
                companyId: safeCompanyIdPath,
                siteId: contextSiteId,

                // Raw timestamps (actual input)
                startedAt: clockInDate,
                endedAt: clockOutDate,

                // Rounded timestamps (after rounding rules applied)
                roundedStartedAt: roundedStart,
                roundedEndedAt: roundedEnd,

                // Duration calculations
                durationGrossSec: durationSeconds,
                durationEffectiveSec: effectiveSec,

                // [SCHEMA PARITY] Raw Durations (Manual entries utilize same input as "raw")
                rawDurationGrossSec: durationSeconds,
                rawDurationEffectiveSec: effectiveSec,

                // [SCHEMA PARITY] Device & Location Info (Real Data)
                // Since manual entry happens at one point in time, we use the same capture for both start/end metadata
                // to satisfy schema requirements while accurately reflecting the *entry context*.
                // Explicitly valid objects or null (never undefined)
                location: currentLocation || null,
                deviceInfo: currentDeviceInfo || { type: 'web', source: 'manual_entry' },

                clockOutLocation: currentLocation || null, // Same context
                clockOutDeviceInfo: currentDeviceInfo || { type: 'web', source: 'manual_entry' },

                pupilCount: additionalData.pupilCount || null,

                // Break information
                manualBreakSec: manualBreakSec,
                autoLunchBreakSec: autoLunchBreakSec,
                autoLunchApplied: autoLunchApplied,
                breakSec: totalBreakSec,

                // Session status and type
                status: 'ended', // Manual entries are always complete
                isManual: true,
                source: 'manual',

                // Audit trail
                createdBy: auth.currentUser?.uid || 'system',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),

                // Assignment context
                assignmentId: assignmentInfo?.assignmentId || null,
                clientId: assignmentInfo?.clientId || null,

                // Notes/description
                notes: additionalData.notes || additionalData.description || ''
            };

            console.log('[addManualTimeEntry] ✓ Prepared manual session (pending batch commit):', manualSessionId);
        }



        // Step 8: Create the new entry object

        // [UNIFIED IDENTITY] Strict ID Strategy:
        // 1. Time Entries: MUST use manualSessionId (matches Firestore Doc ID).
        // 2. Description Only: use generated ID (no session exists).
        const shouldUseSessionId = !isDescriptionOnly && manualSessionId;
        if (!shouldUseSessionId && !isDescriptionOnly) {
            console.warn('[addManualTimeEntry] WARNING: Unified ID Strategy bypassed! Using legacy ID. Reason:', { manualSessionId, isDescriptionOnly, clockInDate, clockOutDate });
        }
        const finalId = shouldUseSessionId ? manualSessionId : generateEntryId();

        const newEntry = {
            id: finalId,
            date: entryDate,
            period: weekStartStr,
            // Clock times - null for description-only entries
            clockIn: roundedClockIn,
            clockOut: roundedClockOut,
            rawClockIn: clockInTime,
            rawClockOut: clockOutTime,
            // ISO timestamps - null for description-only entries
            roundedStart: roundedStart ? roundedStart.toISOString() : null,
            roundedEnd: roundedEnd ? roundedEnd.toISOString() : null,
            rawStart: clockInDate ? clockInDate.toISOString() : null,
            rawEnd: clockOutDate ? clockOutDate.toISOString() : null,
            // Metadata
            description: additionalData.description || '',
            activityType: additionalData.activityType || '',
            notes: additionalData.notes || '',
            // Duration values - 0 for description-only
            grossSec: durationSeconds,
            effectiveSec: effectiveSec,
            // Persist break components explicitly so the UI can display "Break" reliably
            // (weekDataProcessor relies on these fields for break calculations).
            manualBreakSec: manualBreakSec,
            autoLunchBreakSec: autoLunchBreakSec,
            breakSec: totalBreakSec,
            overtimeSec: 0, // Will be calculated below
            // Flags
            isManual: true,
            isDescriptionOnly: isDescriptionOnly, // NEW FLAG
            // Break metadata
            breakMeta: {
                manualBreakSec: additionalData.breakMin ? Number(additionalData.breakMin) * 60 : manualBreakSec,
                autoLunchBreakSec: autoLunchBreakSec,
                autoLunchApplied: autoLunchApplied,
                autoLunchThresholdHours: isDescriptionOnly ? 0 : (autoLunchConfig?.thresholdHours || 0),
                lunchBreakMinutes: isDescriptionOnly ? 0 : (autoLunchConfig?.lunchBreakMinutes || 0)
            },

            // [FIX] Persist Location & Device Info to Timesheet Entry
            // This ensures ActivityOversightPage can display location data without fetching the session doc
            location: manualSessionData?.location || null,
            clockOutLocation: manualSessionData?.clockOutLocation || null,
            deviceInfo: manualSessionData?.deviceInfo || null,
            clockOutDeviceInfo: manualSessionData?.clockOutDeviceInfo || null,

            // Session Linkage (Critical)
            sessionIds: shouldUseSessionId ? [manualSessionId] : [],
            sessionKey: shouldUseSessionId ? manualSessionId : null,
            sessionId: shouldUseSessionId ? manualSessionId : null, // Legacy support
            // Timestamps
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            // Assignment info
            siteId: contextSiteId,
            assignmentId: assignmentInfo?.assignmentId || null,
            clientId: assignmentInfo?.clientId || null,
            // Session link (unified architecture)
            sessionId: manualSessionId, // Links to timeClockSessions document
            // [NEW] Add compatibility fields for deduplication
            sessionKey: manualSessionId,
            sessionIds: manualSessionId ? [manualSessionId] : [],
            editedAt: new Date().toISOString()
        };

        // [NEW] Resolve Default Description (Working vs Holiday) if description/notes not provided
        // We map 'description' field from 'additionalData.description' OR 'notes'
        // Ideally we consolidate to 'notes' as the primary user-facing description field
        if (!newEntry.notes && !newEntry.description) {
            try {
                // Check for absences on this date
                const absenceStart = typeof entryDate === 'string' && entryDate.length === 10 ? new Date(entryDate + 'T00:00:00') : new Date(entryDate);
                const absenceEnd = new Date(absenceStart);
                const absences = await fetchApprovedAbsencesForWeek(userId, absenceStart, absenceEnd);

                const absenceForDay = absences.get(entryDate);
                if (absenceForDay) {
                    const label = getLeaveTypeLabel(absenceForDay.leaveType) || 'Holiday';
                    newEntry.notes = label;
                } else {
                    newEntry.notes = 'Working'; // Default
                }
            } catch (descErr) {
                console.warn('[addManualTimeEntry] Failed to resolve default description:', descErr);
                newEntry.notes = 'Working';
            }
        } else if (!newEntry.notes && newEntry.description) {
            // If user provided 'description' but not 'notes', copy it over to normalize
            newEntry.notes = newEntry.description;
        } else if (newEntry.notes) {
            // Use provided notes as-is (could be empty string for clearing)
            newEntry.notes = newEntry.notes;
        } else {
            // Handle case where notes is undefined/null - ensure it's a string
            newEntry.notes = newEntry.notes || '';
        }

        console.log('[addManualTimeEntry] New entry created:', newEntry);

        // Step 9: Fetch current timesheet data to get existing entries (REFRESH SNAP)
        const tRefresh = Date.now();
        const currentSnap = await getDoc(timesheetRef);
        const currentTimesheetData = currentSnap.data() || {};
        const currentEntries = Array.isArray(currentTimesheetData.entries) ? currentTimesheetData.entries : [];
        console.log(`[addManualTimeEntry] Timesheet refresh read took ${Date.now() - tRefresh}ms`);

        // Step 10: Append new entry (Do NOT remove existing entries for this date)

        // [DEDUPLICATION] Check if identical entry already exists
        // CRITICAL FIX: Must include date in check! Also check for session ID to avoid false duplicates
        let existingEntryWithSameId = null;
        const isDuplicate = currentEntries.some(existing => {
            // Check if entry with same ID already exists
            if (existing.id === newEntry.id) {
                console.log('[addManualTimeEntry] Entry with same ID already exists:', existing.id);
                existingEntryWithSameId = existing;
                return true;
            }

            // Check for actual duplicate: same date, same times, same type, and both are manual
            // But only if it's a different entry (different ID)
            const isSameDate = existing.date === newEntry.date;
            const isSameClockIn = existing.clockIn === newEntry.clockIn;
            const isSameClockOut = existing.clockOut === newEntry.clockOut;
            const isSameActivityType = existing.activityType === newEntry.activityType;
            const isBothManual = existing.isManual === true && newEntry.isManual === true;

            return isSameDate && isSameClockIn && isSameClockOut && isSameActivityType && isBothManual;
        });

        if (isDuplicate) {
            if (existingEntryWithSameId) {
                console.log('[addManualTimeEntry] Entry already exists with same ID, returning existing entry');
                // Entry already exists - return success with the existing entry data
                return {
                    success: true,
                    message: 'Time entry added successfully',
                    isDuplicate: false, // Not really a duplicate, just already exists
                    date: entryDate,
                    updatedTimesheet: {
                        ...currentTimesheetData,
                        entries: currentEntries,
                        totals: currentTimesheetData.totals || { grossSec: 0, effectiveSec: 0, overtimeSec: 0 }
                    }
                };
            } else {
                console.warn('[addManualTimeEntry] Actual duplicate entry detected, skipping add:', newEntry);
                // Return proper success format for UI consistency (entry already exists)
                return {
                    success: true,
                    message: 'Entry already exists (duplicate)',
                    isDuplicate: true,
                    date: entryDate,
                    updatedTimesheet: {
                        ...currentTimesheetData,
                        entries: currentEntries,
                        totals: currentTimesheetData.totals || { grossSec: 0, effectiveSec: 0, overtimeSec: 0 }
                    }
                };
            }
        }

        // [OVERLAP VALIDATION] Prevent overlapping time ranges on the same day.
        // Boundaries are allowed (end == start is OK).
        if (!isDescriptionOnly) {
            const parseMin = (t) => {
                if (!t || typeof t !== 'string') return null;
                const s = String(t).trim();

                // Accept "Open" or dash as no end time
                if (!s || s === '-' || s.toLowerCase() === 'open') return null;

                // 12h format: "10:15 AM"
                const m12 = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
                if (m12) {
                    let h = parseInt(m12[1], 10);
                    const m = parseInt(m12[2], 10);
                    const ap = String(m12[3]).toUpperCase();
                    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
                    h = h % 12;
                    if (ap === 'PM') h += 12;
                    return h * 60 + m;
                }

                // 24h format: "10:15" or "10:15:00"
                const m24 = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
                if (m24) {
                    const h = parseInt(m24[1], 10);
                    const m = parseInt(m24[2], 10);
                    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
                    return h * 60 + m;
                }

                return null;
            };

            const newStart = parseMin(newEntry.clockIn);
            const newEnd = parseMin(newEntry.clockOut);
            if (newStart != null && newEnd != null && newEnd > newStart) {
                const dayExisting = currentEntries.filter(e => e && e.date === newEntry.date);
                for (const e of dayExisting) {
                    const s = parseMin(e.rawClockIn || e.clockIn);
                    const en = e.rawClockOut || e.clockOut ? parseMin(e.rawClockOut || e.clockOut) : null;
                    const sOk = s != null;
                    const eEnd = en == null ? Number.POSITIVE_INFINITY : en;
                    if (!sOk) continue;
                    if (eEnd !== Number.POSITIVE_INFINITY && eEnd <= s) continue;

                    const overlaps = newStart < eEnd && s < newEnd;
                    if (overlaps) {
                        const left = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
                        const right = eEnd === Number.POSITIVE_INFINITY
                            ? 'Open'
                            : `${String(Math.floor(eEnd / 60)).padStart(2, '0')}:${String(eEnd % 60).padStart(2, '0')}`;
                        throw new Error(`Time entry conflicts with existing entry (${left}-${right})`);
                    }
                }

                // Also validate against raw clock sessions for this date.
                // This prevents overlaps when sessions exist but timesheet entries are stale/unmerged.
                try {
                    const dayStart = new Date(`${entryDate}T00:00:00`);
                    const dayEnd = new Date(`${entryDate}T23:59:59`);
                    const sessionsQuery = query(
                        collection(db, 'timeClockSessions'),
                        where('userId', '==', userId),
                        where('startedAt', '>=', Timestamp.fromDate(dayStart)),
                        where('startedAt', '<=', Timestamp.fromDate(dayEnd))
                    );
                    const sessionSnaps = await getDocs(sessionsQuery);
                    for (const sDoc of sessionSnaps.docs) {
                        // Exclude the session we just created for this manual entry
                        if (manualSessionId && sDoc.id === manualSessionId) continue;
                        const sd = sDoc.data() || {};
                        const startedAt = sd.startedAt?.toDate ? sd.startedAt.toDate() : (sd.startedAt instanceof Date ? sd.startedAt : (sd.startedAt ? new Date(sd.startedAt) : null));
                        if (!startedAt || Number.isNaN(startedAt.getTime())) continue;
                        const endedAt = sd.status === 'open'
                            ? null
                            : (sd.endedAt?.toDate ? sd.endedAt.toDate() : (sd.endedAt instanceof Date ? sd.endedAt : (sd.endedAt ? new Date(sd.endedAt) : null)));

                        const sMin = startedAt.getHours() * 60 + startedAt.getMinutes();
                        const eMin = endedAt && !Number.isNaN(endedAt.getTime())
                            ? (endedAt.getHours() * 60 + endedAt.getMinutes())
                            : Number.POSITIVE_INFINITY;

                        if (eMin !== Number.POSITIVE_INFINITY && eMin <= sMin) continue;
                        const overlaps = newStart < eMin && sMin < newEnd;
                        if (overlaps) {
                            const left = `${String(Math.floor(sMin / 60)).padStart(2, '0')}:${String(sMin % 60).padStart(2, '0')}`;
                            const right = eMin === Number.POSITIVE_INFINITY
                                ? 'Open'
                                : `${String(Math.floor(eMin / 60)).padStart(2, '0')}:${String(eMin % 60).padStart(2, '0')}`;
                            throw new Error(`Time entry conflicts with existing entry (${left}-${right})`);
                        }
                    }
                } catch (e) {
                    // If session query fails, don't block saves (but keep timesheet-entry overlap protection).
                    console.warn('[addManualTimeEntry] Session overlap check failed (non-blocking):', e);
                }
            }
        }

        let updatedEntries = [...currentEntries];
        updatedEntries.push(newEntry);

        // Step 11: Recalculate Overtime for the Whole Day
        const tOvertime = Date.now();
        // Parallel fetch company schedule while we prepare other data
        const schedulePromise = (async () => {
            try {
                let schedule = {};
                if (safeCompanyIdPath) {
                    const compKey = safeCompanyIdPath.includes('/') ? safeCompanyIdPath.split('/')[1] : safeCompanyIdPath;
                    const compSchedule = await getCompanyWorkSchedule(compKey);
                    if (compSchedule) schedule = compSchedule;
                }
                return schedule;
            } catch (e) {
                console.warn('[addManualTimeEntry] Company schedule fetch failed:', e);
                return {};
            }
        })();

        const schedule = await schedulePromise;
        const targetSec = computeTargetSecondsForDay(entryDate, schedule);

        // Get all entries for this date
        const dayEntries = updatedEntries.filter(e => e.date === entryDate);

        // Sort by time
        dayEntries.sort((a, b) => {
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

        // Distribute overtime
        let runningTotal = 0;
        for (const entry of dayEntries) {
            const eff = entry.effectiveSec || 0;
            const previousTotal = runningTotal;
            runningTotal += eff;

            const normalPortion = Math.min(eff, Math.max(0, targetSec - previousTotal));
            const overtimePortion = Math.max(0, eff - normalPortion);

            // Update entry in the main list
            const mainIdx = updatedEntries.indexOf(entry);
            if (mainIdx >= 0) {
                updatedEntries[mainIdx] = { ...updatedEntries[mainIdx], overtimeSec: overtimePortion };
            }
        }
        console.log(`[addManualTimeEntry] Overtime recalc took ${Date.now() - tOvertime}ms`);


        // Step 12: Recalculate timesheet totals from all entries
        const totals = {
            grossSec: 0,
            effectiveSec: 0,
            overtimeSec: 0
        };

        for (const entry of updatedEntries) {
            totals.grossSec += entry.grossSec || 0;
            totals.effectiveSec += entry.effectiveSec || 0;
            totals.overtimeSec += entry.overtimeSec || 0;
        }



        // [NEW] Step 12b: Pre-Save Deduplication (Defense in Depth)
        // Remove any duplicate entries that refer to the same session
        const seenSessionKeys = new Set();
        updatedEntries = updatedEntries.filter(entry => {
            const key = entry.sessionId || entry.sessionKey || entry.id;
            if (seenSessionKeys.has(key)) {
                console.warn('[addManualTimeEntry] Removed duplicate entry with key:', key);
                return false;
            }
            seenSessionKeys.add(key);
            return true;
        });

        // Step 13: Recalculate totals AFTER deduplication
        totals.grossSec = 0;
        totals.effectiveSec = 0;
        totals.overtimeSec = 0;
        for (const entry of updatedEntries) {
            totals.grossSec += entry.grossSec || 0;
            totals.effectiveSec += entry.effectiveSec || 0;
            totals.overtimeSec += entry.overtimeSec || 0;
        }

        // Step 14: Save updated entries and totals to Firestore using BATCH WRITE
        const tBatch = Date.now();
        const { writeBatch } = await import('firebase/firestore');
        const batch = writeBatch(db);

        // Add session to batch (if applicable)
        if (manualSessionRef && manualSessionData) {
            batch.set(manualSessionRef, manualSessionData);
        }

        // Add timesheet update to batch
        batch.update(timesheetRef, {
            entries: updatedEntries,
            totals: totals,
            updatedAt: serverTimestamp()
        });

        // Commit atomically - if either fails, both are rolled back
        await batch.commit();
        console.log(`[addManualTimeEntry] Batch commit took ${Date.now() - tBatch}ms`);
        console.log('[addManualTimeEntry] ✓ Batch commit complete');

        // IMPORTANT: Return success to UI immediately after batch commit.
        // Background work below does NOT block the user.
        const bgStart = Date.now();

        // Background: Cache invalidation (non-blocking)
        Promise.resolve().then(async () => {
            try {
                invalidateUserWeekContext(userId);
                invalidateTimesheetCache(userId, weekStartStr);
            } catch (e) {
                console.warn('[addManualTimeEntry] Background cache invalidation failed:', e);
            }
        });

        // Background: Optional session import (non-blocking)
        Promise.resolve().then(async () => {
            const tImport = Date.now();
            try {
                // Fetch sessions for this date
                const startOfDay = new Date(entryDate);
                startOfDay.setHours(0, 0, 0, 0);
                const endOfDay = new Date(entryDate);
                endOfDay.setHours(23, 59, 59, 999);

                const sessionsRef = collection(db, 'timeClockSessions');
                const sessionsQ = query(
                    sessionsRef,
                    where('userId', '==', userId),
                    where('startedAt', '>=', startOfDay),
                    where('startedAt', '<=', endOfDay)
                );

                const sessionsSnap = await getDocs(sessionsQ);

                if (!sessionsSnap.empty) {
                    console.log(`[addManualTimeEntry] Background: importing ${sessionsSnap.size} sessions for date ${entryDate}`);
                    // NOTE: This is background-only; UI already shows success. If it fails, we log but don't throw.
                    // We could trigger a refresh if needed, but for now it's optional.
                }
            } catch (importErr) {
                console.warn('[addManualTimeEntry] Background session import failed:', importErr);
            }
        });

        console.log('[addManualTimeEntry] ✓ SUCCESS - Time entry added');
        console.log(`[addManualTimeEntry] TOTAL TIME (to batch commit): ${Date.now() - startTotal}ms`);
        return {
            success: true,
            message: 'Time entry added successfully',
            date: entryDate,
            clockOut: clockOutTime,
            durationSeconds,
            updatedTimesheet: {
                ...currentTimesheetData,
                entries: updatedEntries,
                totals: totals,
                updatedAt: new Date().toISOString()
            }
        };
    } catch (error) {
        console.error('[addManualTimeEntry] ✗ ERROR:', error.message);
        console.error(`[addManualTimeEntry] ERROR after ${Date.now() - startTotal}ms`);
        throw error;
    }
}

/**
 * Delete a timesheet (Archive Cleanup)
 * Removes the Firestore document and associated PDF from Storage if present.
 */
export const deleteTimesheet = async (timesheetId) => {
    if (!timesheetId) throw new Error("Timesheet ID required");

    try {
        const tsRef = doc(db, 'timesheets', timesheetId);
        const tsSnap = await getDoc(tsRef);

        if (!tsSnap.exists()) return;

        const data = tsSnap.data();

        // 1. Delete PDF from Storage if exists
        if (data.storagePath) {
            try {
                const pdfRef = ref(storage, data.storagePath);
                // Dynamically import deleteObject to avoid top-level dependency if not used elsewhere
                const { deleteObject } = await import('firebase/storage');
                await deleteObject(pdfRef);
                console.log(`[deleteTimesheet] Deleted PDF: ${data.storagePath}`);
            } catch (storageErr) {
                console.warn("[deleteTimesheet] Failed to delete PDF (non-fatal):", storageErr);
            }
        }

        // 2. Delete Firestore Document
        await deleteDoc(tsRef);
        console.log(`[deleteTimesheet] Deleted timesheet document: ${timesheetId}`);

    } catch (error) {
        console.error("Error deleting timesheet:", error);
        throw error;
    }
};

/**
 * triggerTimesheetArchive
 * Detached background task to generate PDF and update cache for an approved timesheet.
 * Re-fetches the latest doc to ensure data consistency and handles updating the PDF URL.
 * 
 * @param {string} timesheetId 
 * @param {string} userId 
 * @param {string} weekStr - ISO date string of the week start
 */
export async function triggerTimesheetArchive(timesheetId, userId, weekStr) {
    // console.log(`[triggerTimesheetArchive] Triggered for ${timesheetId} | Week: ${weekStr}`);
    try {
        const { generateTimesheetPDF } = await import('./timesheetPdfExport');
        const { getStorage, ref: storageRef, uploadBytes, getDownloadURL } = await import('firebase/storage');
        const { doc, getDoc, updateDoc, serverTimestamp } = await import('firebase/firestore');

        const tsRef = doc(db, 'timesheets', timesheetId);
        const tsSnap = await getDoc(tsRef);
        if (!tsSnap.exists()) return;
        const data = tsSnap.data();

        // Clear previous errors immediately
        await updateDoc(tsRef, {
            pdfGenerationFailed: false,
            pdfError: null,
            pdfGenerationStartedAt: serverTimestamp()
        });

        // Only generate for approved timesheets
        if (data.status !== 'approved') {
            console.log(`[triggerTimesheetArchive] Skipping - timesheet ${timesheetId} is not approved.`);
            return;
        }

        // Cache Invalidation
        invalidateTimesheetCache(userId, weekStr);
        if (data.approvedBy) invalidateTimesheetCache(data.approvedBy, weekStr);

        // Fetch full week details (bypassing cache to get latest entries)
        const weekDate = new Date(weekStr.includes('T') ? weekStr : weekStr + 'T12:00:00');
        const userContext = await getUserWeekContext(userId);
        const weekData = await fetchWeekDetails(userId, weekDate, {
            forceFresh: true,
            weekStartDay: userContext.weekStartDay
        });

        const entries = weekData?.entries || data.entries || [];
        // Removed: if (!entries || entries.length === 0) return; 
        // We now allow blank PDFs for approved sheets.

        // Prepare data for PDF generator (convert Timestamps to Dates)
        const pdfData = {
            ...data,
            approvedAt: data.approvedAt?.toDate ? data.approvedAt.toDate() : (data.approvedAt instanceof Date ? data.approvedAt : new Date()),
            updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : (data.updatedAt instanceof Date ? data.updatedAt : new Date()),
            id: timesheetId
        };

        const pdfResult = await generateTimesheetPDF(pdfData, weekData, { returnBlob: true });

        if (pdfResult.success && pdfResult.blob) {
            const year = weekDate.getFullYear();
            const month = String(weekDate.getMonth() + 1).padStart(2, '0');
            const storagePath = `timesheet-archives/${year}/${month}/${userId}/${timesheetId}.pdf`;
            const stor = getStorage();
            const fileRef = storageRef(stor, storagePath);

            await uploadBytes(fileRef, pdfResult.blob);
            const downloadURL = await getDownloadURL(fileRef);

            await updateDoc(tsRef, {
                pdfUrl: downloadURL,
                pdfGeneratedAt: serverTimestamp(),
                // Used to determine whether pdfUrl is stale vs timesheet.updatedAt
                pdfForUpdatedAt: data.updatedAt || serverTimestamp(),
                storagePath: storagePath,
                archiveDate: serverTimestamp(),
                pdfGenerationFailed: false,
                pdfError: null
            });
            console.log(`[triggerTimesheetArchive] SUCCESS: PDF archived for ${timesheetId}: ${downloadURL}`);
        }
    } catch (err) {
        console.error(`[triggerTimesheetArchive] FAILED for ${timesheetId}:`, err);
        try {
            const { doc: docFn, updateDoc: updateDocFn } = await import('firebase/firestore');
            await updateDocFn(docFn(db, 'timesheets', timesheetId), {
                pdfGenerationFailed: true,
                pdfError: err.message
            });
        } catch (updateErr) {
            console.warn('[triggerTimesheetArchive] Failed to record error on timesheet doc:', updateErr);
        }
    }
}


