const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { getWeekRangeForDate, formatISODate, normalizeWeekStartDay, DEFAULT_WEEK_START } = require('../utils/dateUtils');
const { roundSessionRange } = require('../utils/timeRounding');
const { computeTargetSecondsForDay, distributeOvertimeForDay } = require('../utils/overtimeCalculation');

const db = null; // Removed global init to prevent cold start timeout. DB is initialized in functions.

// Helper: Format Time HH:MM
const formatTimeStr = (d) => {
    if (!d || isNaN(d.getTime())) return null;
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
};

// Helper: Get Work Schedule
async function getCompanyWorkSchedule(companyIdPath) {
    try {
        const db = admin.firestore();
        const compKey = (companyIdPath || '').includes('/') ? (companyIdPath.split('/')[1] || '') : (companyIdPath || '');
        if (!compKey) return {};
        const cSnap = await db.collection('companies').doc(compKey).get();
        if (cSnap.exists) return cSnap.data().workSchedule || {};
    } catch (_) { }
    return {};
}

// Helper: Get Auto-Lunch Config (matches client-side resolveAutoLunchConfig)
async function getAutoLunchConfig(companyIdPath, siteId) {
    const db = admin.firestore();
    const defaultConfig = { enabled: false, thresholdHours: 6, lunchBreakMinutes: 60 };

    try {
        // Try site-level override first
        if (siteId) {
            const siteKey = String(siteId).includes('/') ? siteId.split('/').pop() : siteId;
            const siteSnap = await db.collection('sites').doc(siteKey).get();
            if (siteSnap.exists) {
                const siteData = siteSnap.data();
                if (siteData.autoLunchConfig && siteData.autoLunchConfig.enabled) {
                    return {
                        enabled: true,
                        thresholdHours: siteData.autoLunchConfig.thresholdHours || 0,
                        lunchBreakMinutes: siteData.autoLunchConfig.lunchBreakMinutes || 0
                    };
                }
            }
        }

        // Fall back to company-level config
        if (companyIdPath) {
            const compKey = (companyIdPath || '').includes('/') ? (companyIdPath.split('/')[1] || '') : (companyIdPath || '');
            if (compKey) {
                const compSnap = await db.collection('companies').doc(compKey).get();
                if (compSnap.exists) {
                    const compData = compSnap.data();
                    if (compData.autoLunchConfig && compData.autoLunchConfig.enabled) {
                        return {
                            enabled: true,
                            thresholdHours: compData.autoLunchConfig.thresholdHours || 0,
                            lunchBreakMinutes: compData.autoLunchConfig.lunchBreakMinutes || 0
                        };
                    }
                }
            }
        }
    } catch (e) {
        console.warn('[updateSafe] Failed to fetch auto-lunch config:', e);
    }

    return defaultConfig;
}

// [FIX #10] computeTargetSecondsForDay is now imported from '../utils/overtimeCalculation'

// Helper: Resolve Week Context
// Helper: Get Timesheet ID
function getTimesheetId(userId, dateStr, weekStartDay) {
    const { start } = getWeekRangeForDate(dateStr, weekStartDay);
    const weekStart = formatISODate(start);
    return `${userId}_${weekStart}`; // Standard ID format
}

exports.updateTimeEntrySafe = functions.https.onCall(async (data, context) => {
    // 1. Auth Check - Fast Fail
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');
    const { uid: requesterId } = context.auth;

    const { userId, dateStr, updates, sessionId, originalClockIn } = data;

    if (!userId || !dateStr) throw new functions.https.HttpsError('invalid-argument', 'Missing required fields');

    console.log(`[updateSafe] Start: User=${userId}, Date=${dateStr}, Session=${sessionId}`);

    const db = admin.firestore();

    // 2. Resolve Context & IDs (Optimized Fetching)
    // Fetch User Doc first to get company/site references
    const userSnap = await db.collection('users').doc(userId).get();
    if (!userSnap.exists) throw new functions.https.HttpsError('not-found', 'User not found');

    const userData = userSnap.data();
    const companyIdPath = userData.companyId || '';
    const siteId = userData.siteId || '';
    const managerUserId = userData.managerUserId || userData.reportsTo || null;

    const cKey = companyIdPath ? (companyIdPath.split('/').pop()) : null;
    const siteKey = siteId ? (String(siteId).split('/').pop()) : null;

    // Parallel fetch Company and Site configs
    const [compSnap, siteSnap] = await Promise.all([
        cKey ? db.collection('companies').doc(cKey).get() : Promise.resolve(null),
        siteKey ? db.collection('sites').doc(siteKey).get() : Promise.resolve(null)
    ]);

    const compData = compSnap && compSnap.exists ? compSnap.data() : {};
    const siteData = siteSnap && siteSnap.exists ? siteSnap.data() : {};

    // Resolve Week Start Day
    const weekStartDay = compData.weekStartDay || DEFAULT_WEEK_START;
    const { start } = getWeekRangeForDate(dateStr, weekStartDay);
    const deterministicId = `${userId}_${formatISODate(start)}`;

    // Resolve Overtime Schedule
    const schedule = compData.workSchedule || {};
    const targetSec = computeTargetSecondsForDay(dateStr, schedule);

    // Resolve Rounding Rules
    const roundingRules = compData.roundingRules || { enabled: false };

    // Resolve Auto-Lunch Config (Logic from getAutoLunchConfig but using fetched data)
    let autoLunchConfig = { enabled: false, thresholdHours: 6, lunchBreakMinutes: 60 };
    if (siteData.autoLunchConfig && siteData.autoLunchConfig.enabled) {
        autoLunchConfig = {
            enabled: true,
            thresholdHours: siteData.autoLunchConfig.thresholdHours || 0,
            lunchBreakMinutes: siteData.autoLunchConfig.lunchBreakMinutes || 0
        };
    } else if (compData.autoLunchConfig && compData.autoLunchConfig.enabled) {
        autoLunchConfig = {
            enabled: true,
            thresholdHours: compData.autoLunchConfig.thresholdHours || 0,
            lunchBreakMinutes: compData.autoLunchConfig.lunchBreakMinutes || 0
        };
    }

    // 4. FIND TIMESHEET (Handle Legacy IDs)
    // First try deterministic ID, then fallback to legacy search
    let tsRef = db.collection('timesheets').doc(deterministicId);
    let tsSnap = await tsRef.get();
    
    if (!tsSnap.exists) {
        console.log(`[updateSafe] Deterministic timesheet not found, searching for legacy/overlap docs`);
        
        // Search for timesheets with overlapping date ranges
        const weekEnd = formatISODate(getWeekRangeForDate(dateStr, weekStartDay).end);
        const legacyQuery = await db.collection('timesheets')
            .where('userId', '==', userId)
            .where('companyId', 'in', [cKey, companyIdPath])
            .where('start', '<=', dateStr)
            .where('end', '>=', dateStr)
            .limit(5)
            .get();
        
        if (legacyQuery.empty) {
            throw new functions.https.HttpsError('not-found', 'Time entry not found. No timesheet exists for this date.');
        }
        
        // Use the first matching document
        tsRef = legacyQuery.docs[0].ref;
        console.log(`[updateSafe] Found legacy timesheet: ${tsRef.id}`);
        tsSnap = await tsRef.get();
    }

    // 5. TRANSACTION START
    return await db.runTransaction(async (transaction) => {
        // A. Read Timesheet (now we have the correct ref)
        const tsDoc = await transaction.get(tsRef);
        if (!tsDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Time entry not found. Timesheet disappeared.');
        }

        // B. Process Logic
        const tsData = tsDoc.data();
        let entries = Array.isArray(tsData.entries) ? [...tsData.entries] : [];

        // ... [Insert Logic for Finding Entry, Rounding, Calculating] ...
        // (Copied from original but adapted for transaction context)

        // Find Entry
        let idx = -1;
        if (data.entryId) idx = entries.findIndex(e => e.id === data.entryId);
        if (idx === -1 && sessionId) {
            idx = entries.findIndex(e => e.sessionKey === sessionId || (e.sessionIds && e.sessionIds.includes(sessionId)) || e.id === sessionId);
        }
        if (idx === -1 && originalClockIn) {
            idx = entries.findIndex(e => {
                if (e.date !== dateStr) return false;
                const tTarget = new Date(originalClockIn).getTime();
                const tEntry = new Date(e.rawStart || e.clockIn || dateStr).getTime();
                return Math.abs(tTarget - tEntry) < 300000;
            });
        }

        if (idx === -1) throw new functions.https.HttpsError('not-found', 'Time entry not found.');

        const entry = entries[idx];

        // Calc Updates
        const newClockIn = updates.clockIn ? new Date(updates.clockIn) : (entry.rawStart ? new Date(entry.rawStart) : null);
        const newClockOut = updates.clockOut ? new Date(updates.clockOut) : (entry.rawEnd ? new Date(entry.rawEnd) : null);

        if (!newClockIn || isNaN(newClockIn.getTime())) throw new functions.https.HttpsError('invalid-argument', 'Invalid Start Time');

        const { roundedStart, roundedEnd } = roundSessionRange(newClockIn, newClockOut, roundingRules);

        // Calc Stats
        let grossSec = 0;
        if (roundedEnd) grossSec = Math.floor((roundedEnd.getTime() - roundedStart.getTime()) / 1000);

        const manualBreakMin = updates.breakMin !== undefined ? Number(updates.breakMin) : (entry.manualBreakSec ? entry.manualBreakSec / 60 : 0);
        const manualBreakSec = manualBreakMin * 60;

        let autoLunchBreakSec = 0;
        let autoLunchApplied = false;
        const rawDurationSec = newClockOut ? Math.floor((newClockOut.getTime() - newClockIn.getTime()) / 1000) : 0;

        if (autoLunchConfig.enabled && rawDurationSec > 0) {
            const thresholdSec = autoLunchConfig.thresholdHours * 3600;
            const lunchBreakSec = autoLunchConfig.lunchBreakMinutes * 60;
            if (rawDurationSec > thresholdSec && lunchBreakSec > 0 && manualBreakSec < lunchBreakSec) {
                autoLunchBreakSec = Math.max(0, lunchBreakSec - manualBreakSec);
                autoLunchApplied = true;
            }
        }

        const totalBreakSec = manualBreakSec + autoLunchBreakSec;
        const effectiveSec = Math.max(0, grossSec - totalBreakSec);
        const rawEffectiveSec = Math.max(0, rawDurationSec - totalBreakSec);

        // Update Entry in Array
        entries[idx] = {
            ...entry,
            id: entry.id, // PERSIST ID
            clockIn: formatTimeStr(roundedStart),
            clockOut: formatTimeStr(roundedEnd),
            rawStart: newClockIn.toISOString(),
            rawEnd: newClockOut ? newClockOut.toISOString() : null,
            rawClockIn: formatTimeStr(newClockIn),
            rawClockOut: newClockOut ? formatTimeStr(newClockOut) : null,
            roundedStart: roundedStart.toISOString(),
            roundedEnd: roundedEnd ? roundedEnd.toISOString() : null,
            grossSec, effectiveSec, rawDurationSec, rawEffectiveSec,
            manualBreakSec, autoLunchBreakSec, autoLunchApplied,
            breakSec: totalBreakSec,
            notes: updates.notes !== undefined ? updates.notes : entry.notes,
            editedBy: requesterId,
            editedAt: new Date().toISOString()
        };

        // Recalc Overtime (The Cascade)
        const dayEntries = entries.filter(e => e.date === dateStr);
        dayEntries.sort((a, b) => (a.roundedStart || a.rawStart || '').localeCompare(b.roundedStart || b.rawStart || ''));

        let runningTotal = 0;
        for (const e of dayEntries) {
            const eff = e.effectiveSec || 0;
            const prev = runningTotal;
            runningTotal += eff;
            const normal = Math.min(eff, Math.max(0, targetSec - prev));
            const overtime = Math.max(0, eff - normal);
            const mIdx = entries.indexOf(e);
            if (mIdx >= 0) entries[mIdx].overtimeSec = overtime;
        }

        // Totals
        const totals = entries.reduce((acc, e) => ({
            grossSec: acc.grossSec + (e.grossSec || 0),
            effectiveSec: acc.effectiveSec + (e.effectiveSec || 0),
            overtimeSec: acc.overtimeSec + (e.overtimeSec || 0)
        }), { grossSec: 0, effectiveSec: 0, overtimeSec: 0 });

        // C. WRITE Timesheet
        transaction.update(tsRef, {
            entries,
            totals,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            managerUserId: managerUserId // Ensure manager is synced
        });

        // D. Dual Write Session (if exists)
        // READ FIRST? No, for `batch.set` with merge we didn't read. 
        // Transactions prefer reads before writes. 
        // If we want to be pure, we should read sessionDoc. 
        // But blind writes in transactions are allowed if we don't depend on the value.
        const effSessionId = sessionId || entry.sessionId;
        if (effSessionId && !effSessionId.startsWith('entry_')) {
            const sessionRef = db.collection('timeClockSessions').doc(effSessionId);
            // We can just set merge=true
            transaction.set(sessionRef, {
                roundedStartedAt: admin.firestore.Timestamp.fromDate(roundedStart),
                roundedEndedAt: roundedEnd ? admin.firestore.Timestamp.fromDate(roundedEnd) : null,
                startedAt: admin.firestore.Timestamp.fromDate(newClockIn),
                endedAt: newClockOut ? admin.firestore.Timestamp.fromDate(newClockOut) : null,
                durationGrossSec: grossSec,
                durationEffectiveSec: effectiveSec,
                notes: updates.notes || entry.notes || null,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        }

        return { success: true, updatedTimesheet: { ...tsData, entries, totals } };

    }); // End Transaction

});
