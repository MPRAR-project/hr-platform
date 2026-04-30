import { db } from '../firebase/client';
import { collection, doc, setDoc, serverTimestamp, query, where, getDocs, updateDoc, getDoc } from 'firebase/firestore';
import { upsertDailyEntry } from './timesheets';
import { resolveRoundingRules } from './roundingRules';
import { resolveAutoLunchConfig } from './autoLunch';
import { roundSessionRange } from '../utils/timeRounding';
import { getUserCurrentLocation } from './locationService';

// Cache invalidation and EventBus removed - Firestore listeners handle real-time updates automatically


export async function startClock({ userId, companyId, siteId, assignedLocationId = null, assignedLocationName = null, startedAt = null, notes = null }) {
    // ensure no open session - user must clock out before clocking in again
    const openQ = query(collection(db, 'timeClockSessions'), where('userId', '==', userId), where('status', '==', 'open'));
    const openSnap = await getDocs(openQ);
    if (!openSnap.empty) throw new Error('Already clocked in. Please clock out first.');

    // Import Timestamp for retroactive clock-in support
    const { Timestamp } = await import('firebase/firestore');

    // Helper to capture device info
    const getDeviceInfo = () => {
        const ua = navigator.userAgent;
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
        return {
            type: 'web', // Always web for this app, but helpful distinction vs native app if we had one
            platform: isMobile ? 'mobile_web' : 'desktop_web',
            userAgent: ua
        };
    };

    // Multiple sessions per day are now allowed - removed the one session per day restriction

    const ref = doc(collection(db, 'timeClockSessions'));
    const now = startedAt instanceof Date ? startedAt : new Date();
    const deviceInfo = getDeviceInfo();

    // Capture Location
    // Capture Location using robust service
    let location = null;
    try {
        const loc = await getUserCurrentLocation();
        location = {
            lat: loc.latitude,
            lng: loc.longitude,
            accuracy: loc.accuracy,
            capturedAt: new Date().toISOString(),
            assignedLocationId: assignedLocationId || null,
            assignedLocationName: assignedLocationName || null
        };
    } catch (err) {
        location = {
            error: err.message,
            code: err.code || 'UNKNOWN',
            capturedAt: new Date().toISOString(),
            assignedLocationId: assignedLocationId || null,
            assignedLocationName: assignedLocationName || null
        };
    }


    // Verify User Status is Active
    // [FIX] Prevent inactive users from clocking in (security hardening)
    try {
        const userDocRef = doc(db, 'users', userId);
        const userSnap = await getDoc(userDocRef);

        if (userSnap.exists()) {
            const userData = userSnap.data();
            const normalizedStatus = (userData.status || '').toString().toLowerCase().trim();
            if (['inactive', 'Inactive', 'suspended', 'Suspended', 'archived', 'Archived'].includes(normalizedStatus)) {
                throw new Error('Your account is inactive. You cannot clock in.');
            }
        }
    } catch (statusErr) {
        // If it's the specific error we threw, rethrow it
        if (statusErr.message === 'Your account is inactive. You cannot clock in.') {
            throw statusErr;
        }
        // Otherwise allow (fail open for connection issues to avoid blocking valid work)
    }

    // Calculate rounded start time for immediate display
    const roundingRules = await resolveRoundingRules(companyId, siteId);
    const { roundedStart } = roundSessionRange(now, now, roundingRules);

    await setDoc(ref, {
        userId,
        companyId,
        siteId,
        startedAt: startedAt ? Timestamp.fromDate(startedAt) : serverTimestamp(),
        roundedStartedAt: roundedStart, // Store rounded start time for display
        endedAt: null,
        durationGrossSec: null,
        durationEffectiveSec: null,
        breakSec: 0,
        status: 'open',
        notes: notes || null,
        location, // Store location
        deviceInfo, // Store device info (Web)
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });


    // Update user's lastActive timestamp
    try {
        await updateDoc(doc(db, 'users', userId), {
            lastActive: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
    } catch (_) { /* non-critical */ }

    return {
        sessionId: ref.id,
        roundedStart
    };
}

function toDateSafe(ts) {
    if (!ts) return null;
    return ts.toDate ? ts.toDate() : (ts.seconds ? new Date(ts.seconds * 1000) : null);
}

function secondsBetween(a, b) {
    return Math.max(0, Math.floor((b - a) / 1000));
}

function computeOvertimeForDay(startDate, endDate, scheduleForDay) {
    if (!scheduleForDay || !scheduleForDay.enabled) return { scheduledSec: 0, overtimeSec: secondsBetween(startDate, endDate) };
    const [sH, sM] = (scheduleForDay.start || '09:00').split(':').map(Number);
    const dayStart = new Date(startDate); dayStart.setHours(sH || 0, sM || 0, 0, 0);
    let dayEnd;
    if (typeof scheduleForDay.durationMin === 'number') {
        dayEnd = new Date(dayStart.getTime() + Math.max(0, scheduleForDay.durationMin) * 60000);
    } else {
        const [eH, eM] = (scheduleForDay.end || '17:00').split(':').map(Number);
        dayEnd = new Date(startDate); dayEnd.setHours(eH || 17, eM || 0, 0, 0);
    }
    // overlap of work with scheduled window
    const workStart = startDate;
    const workEnd = endDate;
    const overlapStart = new Date(Math.max(workStart.getTime(), dayStart.getTime()));
    const overlapEnd = new Date(Math.min(workEnd.getTime(), dayEnd.getTime()));
    const scheduledOverlapSec = overlapEnd > overlapStart ? secondsBetween(overlapStart, overlapEnd) : 0;
    const totalSec = secondsBetween(workStart, workEnd);
    const overtimeSec = Math.max(0, totalSec - scheduledOverlapSec);
    return { scheduledSec: scheduledOverlapSec, overtimeSec };
}

export async function startBreak({ userId, sessionId = null }) {
    let sDoc;

    if (sessionId) {
        const docRef = doc(db, 'timeClockSessions', sessionId);
        const snap = await getDoc(docRef);
        if (!snap.exists()) throw new Error('Specific session not found.');
        sDoc = snap;
    } else {
        const openQ = query(collection(db, 'timeClockSessions'), where('userId', '==', userId), where('status', '==', 'open'));
        const openSnap = await getDocs(openQ);
        if (openSnap.empty) throw new Error('No active clock session found. Please clock in first.');
        sDoc = openSnap.docs[0];
    }

    const sessionData = sDoc.data();

    // Check if already on break
    if (sessionData.breakStartTime) {
        throw new Error('Already on break.');
    }

    // Update session with break start time
    await updateDoc(sDoc.ref, {
        breakStartTime: serverTimestamp(),
        updatedAt: serverTimestamp()
    });

    return {
        sessionId: sDoc.id,
        breakStartTime: new Date()
    };
}

export async function endBreak({ userId, sessionId = null }) {
    let sDoc;

    if (sessionId) {
        const docRef = doc(db, 'timeClockSessions', sessionId);
        const snap = await getDoc(docRef);
        if (!snap.exists()) throw new Error('Specific session not found.');
        sDoc = snap;
    } else {
        const openQ = query(collection(db, 'timeClockSessions'), where('userId', '==', userId), where('status', '==', 'open'));
        const openSnap = await getDocs(openQ);
        if (openSnap.empty) throw new Error('No active clock session found. Please clock in first.');
        sDoc = openSnap.docs[0];
    }

    const sessionData = sDoc.data();

    // Check if not on break
    if (!sessionData.breakStartTime) {
        throw new Error('Not currently on break.');
    }

    // Calculate break duration
    const breakStartTime = sessionData.breakStartTime.toDate ? sessionData.breakStartTime.toDate() : new Date(sessionData.breakStartTime);
    const currentTime = new Date();
    const breakDurationSec = Math.floor((currentTime - breakStartTime) / 1000);

    // Get current total break time and add new duration
    const currentBreakSec = sessionData.breakSec || 0;
    const newTotalBreakSec = currentBreakSec + breakDurationSec;

    // Update session to clear break start time and accumulate break time
    await updateDoc(sDoc.ref, {
        breakStartTime: null,
        breakSec: newTotalBreakSec,
        updatedAt: serverTimestamp()
    });

    return {
        sessionId: sDoc.id,
        breakDurationSec,
        totalBreakSec: newTotalBreakSec
    };
}


export async function stopClock({ userId, sessionId = null, breakSec = 0, endedAt = null, pupilCount = null, notes = null }) {
    let sDoc;

    if (sessionId) {
        const docRef = doc(db, 'timeClockSessions', sessionId);
        const snap = await getDoc(docRef);
        if (!snap.exists()) throw new Error('Specific session not found.');
        sDoc = snap;
    } else {
        const openQ = query(collection(db, 'timeClockSessions'), where('userId', '==', userId), where('status', '==', 'open'));
        const openSnap = await getDocs(openQ);
        if (openSnap.empty) throw new Error('No active clock session found. Please clock in first.');
        sDoc = openSnap.docs[0];
    }
    // finalize end time
    const sessionData = sDoc.data();
    const manualBreakSec = Math.max(0, sessionData.breakSec || 0);

    const finalEndedAt = endedAt ? (endedAt instanceof Date ? endedAt : new Date(endedAt)) : serverTimestamp();

    const getDeviceInfo = () => {
        const ua = navigator.userAgent;
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
        return {
            type: 'web',
            platform: isMobile ? 'mobile_web' : 'desktop_web',
            userAgent: ua
        };
    };
    const clockOutDeviceInfo = getDeviceInfo();

    // Capture Location
    // Capture Location using robust service
    let clockOutLocation = null;
    try {
        const loc = await getUserCurrentLocation();
        clockOutLocation = {
            lat: loc.latitude,
            lng: loc.longitude,
            accuracy: loc.accuracy,
            capturedAt: new Date().toISOString(),
            assignedLocationId: sDoc.data().location?.assignedLocationId || null,
            assignedLocationName: sDoc.data().location?.assignedLocationName || null
        };
    } catch (err) {
        clockOutLocation = {
            error: err.message,
            code: err.code || 'UNKNOWN',
            capturedAt: new Date().toISOString(),
            assignedLocationId: sDoc.data().location?.assignedLocationId || null,
            assignedLocationName: sDoc.data().location?.assignedLocationName || null
        };
    }

    await updateDoc(sDoc.ref, {
        endedAt: finalEndedAt,
        status: 'closed',
        breakSec: manualBreakSec,
        clockOutLocation, // Store clock out location
        clockOutDeviceInfo, // Store clock out device info
        pupilCount: pupilCount, // Store pupil count
        notes: notes || null, // Store notes
        updatedAt: serverTimestamp()
    });

    // read back session with timestamps
    const fresh = await getDoc(sDoc.ref);
    const session = fresh.data();
    const startedAt = toDateSafe(session.startedAt);
    const sessionEndedAt = toDateSafe(session.endedAt);
    const rawTotalSec = secondsBetween(startedAt, sessionEndedAt);
    const roundingRulesPromise = resolveRoundingRules(session.companyId, session.siteId);
    const autoLunchConfigPromise = resolveAutoLunchConfig(session.companyId, session.siteId);

    // fetch company work schedule (prepared promise)
    const compIdPath = session.companyId;
    let companySchedulePromise = Promise.resolve(null);
    let compId = '';

    if (compIdPath) {
        compId = typeof compIdPath === 'string'
            ? (compIdPath.includes('/') ? compIdPath.split('/')[1] : compIdPath)
            : '';
        if (compId) {
            const compRef = doc(db, 'companies', compId);
            companySchedulePromise = getDoc(compRef);
        }
    }

    // Await all parallel fetches
    const [roundingRules, autoLunchConfig, compSnap] = await Promise.all([
        roundingRulesPromise,
        autoLunchConfigPromise,
        companySchedulePromise
    ]);

    // 1. Process Rounding
    const { roundedStart, roundedEnd } = roundSessionRange(startedAt, sessionEndedAt, roundingRules);
    const roundedTotalSec = secondsBetween(roundedStart, roundedEnd);

    // 2. Process Auto Lunch
    const thresholdSec = (autoLunchConfig.thresholdHours || 0) * 3600;
    const lunchBreakSec = (autoLunchConfig.lunchBreakMinutes || 0) * 60;
    let autoLunchBreakSec = 0;
    let autoLunchApplied = false;

    // ... (keep auto lunch logic) ...


    const durationForThreshold = rawTotalSec || roundedTotalSec;
    if (autoLunchConfig.enabled && lunchBreakSec > 0 && durationForThreshold > thresholdSec && manualBreakSec < lunchBreakSec) {
        const neededLunch = Math.max(0, lunchBreakSec - manualBreakSec);
        const availableForAuto = Math.max(0, Math.min(roundedTotalSec, rawTotalSec) - manualBreakSec);
        const appliedLunch = Math.min(neededLunch, availableForAuto);
        if (appliedLunch > 0) {
            autoLunchBreakSec = appliedLunch;
            autoLunchApplied = true;
        }
    }

    const totalBreakSec = manualBreakSec + autoLunchBreakSec;
    const totalBreakSecRounded = Math.min(totalBreakSec, roundedTotalSec);
    const totalBreakSecRaw = Math.min(totalBreakSec, rawTotalSec);
    const roundedEffectiveSec = Math.max(0, roundedTotalSec - totalBreakSecRounded);
    const rawEffectiveSec = Math.max(0, rawTotalSec - totalBreakSecRaw);

    // 3. Process Overtime using parallel-fetched company schedule
    let overtimeSec = 0;
    if (compSnap && compSnap.exists()) {
        const schedule = compSnap.data().workSchedule || {};
        const dayName = startedAt.toLocaleDateString('en-US', { weekday: 'long' });
        const calcEndDate = endedAt ? (endedAt instanceof Date ? endedAt : new Date(endedAt)) : new Date();
        const res = computeOvertimeForDay(startedAt, calcEndDate, schedule[dayName]);
        overtimeSec = res.overtimeSec || 0;
    }

    // upsert daily timesheet with overtime
    try {
        const dateStr = `${startedAt.getFullYear()}-${String(startedAt.getMonth() + 1).padStart(2, '0')}-${String(startedAt.getDate()).padStart(2, '0')}`;
        const entryId = await upsertDailyEntry({
            userId: session.userId,
            companyId: session.companyId,
            siteId: session.siteId,
            dateStr,
            sessionId: sDoc.id,
            status: 'closed', // [FIX #5] Entry is complete after clock-out
            grossSec: rawTotalSec, // Use actual duration (not rounded) so gross matches real clock in/out times
            effectiveSec: rawEffectiveSec, // Use raw equivalent to match the 'rawTotalSec' applied array
            overtimeSec,
            roundedStart: roundedStart?.toISOString() || null,
            roundedEnd: roundedEnd?.toISOString() || null,
            rawStart: startedAt?.toISOString() || null,
            rawEnd: sessionEndedAt?.toISOString() || null,
            rawDurationSec: rawTotalSec,
            rawEffectiveSec: rawEffectiveSec,

            clockOutLocation, // Pass clock out location to timesheet
            clockOutDeviceInfo, // Pass clock out device info
            pupilCount: pupilCount, // Pass pupil count to timesheet
            notes: notes, // Pass notes to timesheet
            breakMeta: {
                manualBreakSec,
                autoLunchBreakSec,
                autoLunchApplied,
                autoLunchThresholdHours: autoLunchConfig.thresholdHours || 0,
                lunchBreakMinutes: autoLunchConfig.lunchBreakMinutes || 0
            }
        });
    } catch (upsertError) {
        // Handle index building errors gracefully
        if (upsertError.code === 'failed-precondition' && upsertError.message?.includes('currently building')) {
            // Don't rollback - let the user retry when index is ready
            throw new Error('Index is currently building. Please wait 5-10 minutes and try clocking out again.');
        }

        // CROSS-SERVICE TRANSACTION RECOVERY: rollback session so user can retry
        await updateDoc(sDoc.ref, {
            status: 'open',
            endedAt: null,
            updatedAt: serverTimestamp()
        });

        throw new Error(`System Error: Failed to record pay data. Clock-out rolled back. Please try again. (${upsertError.message})`);
    }


    // Duration computing for session record
    const durationGrossSec = rawTotalSec;
    const durationEffectiveSec = roundedEffectiveSec;


    // write back computed durations (gross = actual duration to match real clock times)
    await updateDoc(sDoc.ref, {
        durationGrossSec: rawTotalSec,
        durationEffectiveSec: roundedEffectiveSec,
        rawDurationGrossSec: rawTotalSec,
        rawDurationEffectiveSec: rawEffectiveSec,
        roundedStartedAt: roundedStart,
        roundedEndedAt: roundedEnd,
        breakSec: totalBreakSecRaw,
        manualBreakSec,
        autoLunchBreakSec,
        autoLunchApplied,
        autoLunchThresholdHours: autoLunchConfig.thresholdHours || 0,
        lunchBreakMinutes: autoLunchConfig.lunchBreakMinutes || 0
    });

    return {
        sessionId: sDoc.id,
        overtimeSec,
        breakSec: totalBreakSecRaw,
        durationGrossSec: rawTotalSec,
        durationEffectiveSec: roundedEffectiveSec,
        autoLunchApplied,
        autoLunchBreakSec,
        roundedEnd
    };
}