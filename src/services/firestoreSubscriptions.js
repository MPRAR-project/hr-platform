/**
 * Firestore Real-Time Subscription Service
 * Provides centralized subscriptions for timesheets and clock sessions
 * All subscriptions use onSnapshot for real-time updates
 * 
 * SCALABILITY: Integrated with subscription monitor for 1M+ user support
 */

import { collection, onSnapshot, query, Timestamp, where } from 'firebase/firestore';
import { db } from '../firebase/client';
import { DEFAULT_WEEK_START_DAY, formatISODate, getWeekRangeForDate } from '../utils/weekStartUtils';
import { getUserWeekContext } from './timesheets';
import subscriptionMonitor from '../utils/subscriptionMonitor';

/**
 * Subscribe to all timesheet documents for a user
 * @param {string} userId - User ID
 * @param {function} callback - Callback function that receives timesheet documents
 * @returns {function} Unsubscribe function
 */
export function subscribeUserTimesheets(userId, callback) {
    if (!userId) {
        console.warn('[subscribeUserTimesheets] No userId provided');
        return () => { };
    }


    // Calculate 90 days ago for performance optimization
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    ninetyDaysAgo.setHours(0, 0, 0, 0);
    const ninetyDaysAgoStr = formatISODate(ninetyDaysAgo);

    // Optimized query: Filter to only last 90 days (Requires Index)
    const optimizedQuery = query(
        collection(db, 'timesheets'),
        where('userId', '==', userId),
        where('period', '>=', ninetyDaysAgoStr)
    );

    // Wrapper for unsubscribe to handle swapping listeners
    let activeUnsubscribe = null;

    // Fallback Listener Logic REMOVED for Scalability Safety
    // "Download the database" queries are strictly forbidden.
    // If index is missing, the feature must fail until fixed by admin.

    activeUnsubscribe = onSnapshot(
        optimizedQuery,
        (snapshot) => {
            const timesheets = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            callback(timesheets, snapshot.metadata);
        },
        (error) => {
            if (error.code === 'failed-precondition') {
                console.error('[subscribeUserTimesheets] CRITICAL: Missing Index. Auto-creation link should be in console.');
                // Do NOT fallback. Propagate error to UI.
                callback([], null, error);
            } else {
                console.error('[subscribeUserTimesheets] Snapshot error:', error);
                callback([], null, error);
            }
        }
    );

    // SCALABILITY: Register subscription with monitor (graceful - doesn't break if monitor fails)
    try {
        subscriptionMonitor.register(userId, 'timesheets', activeUnsubscribe);
    } catch (monitorError) {
        console.warn('[subscribeUserTimesheets] Failed to register with subscription monitor:', monitorError);
        // Continue without monitor - backward compatible
    }

    return () => {
        if (activeUnsubscribe) {
            activeUnsubscribe();
            // SCALABILITY: Unregister from monitor on cleanup
            try {
                subscriptionMonitor.unregister(userId, 'timesheets');
            } catch (monitorError) {
                // Ignore - already cleaned up
            }
        }
    };
}

/**
 * Subscribe to all clock sessions for a user
 * @param {string} userId - User ID
 * @param {function} callback - Callback function that receives session documents
 * @returns {function} Unsubscribe function
 */
export function subscribeUserSessions(userId, callback) {
    if (!userId) {
        console.warn('[subscribeUserSessions] No userId provided');
        return () => { };
    }


    // Calculate 90 days ago for performance optimization
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    ninetyDaysAgo.setHours(0, 0, 0, 0);
    const ninetyDaysAgoTimestamp = Timestamp.fromDate(ninetyDaysAgo);

    // OPTIMIZED: Server-side date filter (requires composite index: userId + startedAt)
    // This prevents downloading entire user session history
    const sessionsQuery = query(
        collection(db, 'timeClockSessions'),
        where('userId', '==', userId),
        where('startedAt', '>=', ninetyDaysAgoTimestamp) // ✅ Server-side filter
    );

    const unsubscribe = onSnapshot(
        sessionsQuery,
        (snapshot) => {
            let sessions = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            // Safety fallback: Client-side filter (in case query returns more than expected)
            const ninetyDaysAgoTime = ninetyDaysAgo.getTime();
            sessions = sessions.filter(s => {
                // ALWAYS include open sessions regardless of date
                if (s.status === 'open') return true;

                const startedAt = s.startedAt?.toDate ? s.startedAt.toDate() : null;
                if (!startedAt) return false;
                return startedAt.getTime() >= ninetyDaysAgoTime;
            });

            // Sort by startedAt descending client-side
            sessions.sort((a, b) => {
                const aTime = a.startedAt?.toDate ? a.startedAt.toDate().getTime() : 0;
                const bTime = b.startedAt?.toDate ? b.startedAt.toDate().getTime() : 0;
                return bTime - aTime; // Descending (most recent first)
            });

            callback(sessions, snapshot.metadata);
        },
        (error) => {
            console.error('[subscribeUserSessions] Snapshot error:', error);
            // Return empty array on error so UI doesn't break
            callback([], null, error);
        }
    );

    // SCALABILITY: Register subscription with monitor (graceful - doesn't break if monitor fails)
    try {
        subscriptionMonitor.register(userId, 'sessions', unsubscribe);
    } catch (monitorError) {
        console.warn('[subscribeUserSessions] Failed to register with subscription monitor:', monitorError);
        // Continue without monitor - backward compatible
    }

    return () => {
        unsubscribe();
        // SCALABILITY: Unregister from monitor on cleanup
        try {
            subscriptionMonitor.unregister(userId, 'sessions');
        } catch (monitorError) {
            // Ignore - already cleaned up
        }
    };
}

/**
 * Process timesheet documents into weekly summaries
 * @param {Array} timesheetDocs - Array of timesheet documents
 * @param {string} userId - User ID (for week context)
 * @param {number} maxWeeks - Maximum number of weeks to return
 * @returns {Promise<Array>} Array of weekly summaries
 */
export async function processWeeklySummaries(timesheetDocs, userId, maxWeeks = 12) {
    if (!timesheetDocs || timesheetDocs.length === 0) {
        return [];
    }

    // Get user's week start day and company schedule
    const { weekStartDay, companyIdPath } = await getUserWeekContext(userId);
    const { getCompanyWorkSchedule, computeTargetSecondsForDay } = await import('./timesheets');
    const schedule = await getCompanyWorkSchedule(companyIdPath);
    const { STORAGE_ANCHOR_DAY, isMondayAnchorEnabled } = await import('../utils/weekStartUtils');
    const weekStart = isMondayAnchorEnabled(companyIdPath) ? STORAGE_ANCHOR_DAY : (weekStartDay || DEFAULT_WEEK_START_DAY);

    // Helper function to calculate week key for a date string
    const weekKeyForDateStr = (dateStr) => {
        // Parse as local time to ensure consistent week calculation
        const [year, month, day] = dateStr.split('-').map(Number);
        const date = new Date(year, month - 1, day); // month is 0-indexed
        const { start, end } = getWeekRangeForDate(date, weekStart);
        return {
            key: `${formatISODate(start)}_${formatISODate(end)}`,
            start,
            end,
        };
    };

    const weeks = new Map();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - (maxWeeks * 7 + 14));
    const cutoffIso = formatISODate(cutoffDate);

    // Process each timesheet document
    for (const timesheet of timesheetDocs) {
        const period = timesheet.period; // YYYY-MM-DD
        if (!period || period < cutoffIso) continue;

        const { key, start, end } = weekKeyForDateStr(period);

        if (!weeks.has(key)) {
            weeks.set(key, {
                weekKey: key,
                start,
                end,
                totals: { grossSec: 0, effectiveSec: 0, overtimeSec: 0 },
                statusCounts: { approved: 0, pending: 0, draft: 0, rejected: 0 },
                notes: [],
                createdAtList: [],
                entries: [] // [NEW] Initialize entries array to prevent data loss
            });
        }

        const w = weeks.get(key);

        // [NEW] Aggregate Entries from daily timesheets
        if (timesheet.entries && Array.isArray(timesheet.entries)) {
            // Add period to each entry for context if needed
            const dailyEntries = timesheet.entries.map(e => ({
                ...e,
                date: timesheet.period, // Context
                period: timesheet.period,
                timesheetId: timesheet.id
            }));
            w.entries.push(...dailyEntries);
        }

        // Get totals - prefer timesheet.totals, but calculate from entries if missing
        let totals = timesheet.totals || {};

        // CRITICAL FIX: If totals are missing or zero, recalculate from entries
        const hasValidTotals = totals.effectiveSec > 0 || totals.grossSec > 0;
        if (!hasValidTotals && timesheet.entries && Array.isArray(timesheet.entries)) {
            totals = {
                grossSec: 0,
                effectiveSec: 0,
                overtimeSec: 0
            };
            for (const entry of timesheet.entries) {
                totals.grossSec += entry.grossSec || 0;
                totals.effectiveSec += entry.effectiveSec || 0;
                totals.overtimeSec += entry.overtimeSec || 0;
            }
        }

        w.totals.effectiveSec += totals.effectiveSec || 0;
        w.totals.grossSec += totals.grossSec || 0;

        w.totals.overtimeSec += totals.overtimeSec || 0;

        const status = (timesheet.status || 'draft').toLowerCase();
        if (status === 'approved') w.statusCounts.approved += 1;
        else if (status === 'rejected') w.statusCounts.rejected += 1;
        else if (status === 'pending' || status === 'approved-by-team') w.statusCounts.pending += 1;
        else w.statusCounts.draft += 1;

        if (timesheet.adminNotes) w.notes.push(timesheet.adminNotes);
        if (timesheet.createdAt?.toDate) w.createdAtList.push(timesheet.createdAt.toDate());

        // Capture approval details (prioritize existing values)
        if (timesheet.approvedByName && !w.approvedByName) w.approvedByName = timesheet.approvedByName;
        if (timesheet.approvedBy && !w.approvedBy) w.approvedBy = timesheet.approvedBy;
        if (timesheet.approvedAt && !w.approvedAt) w.approvedAt = timesheet.approvedAt;
    }

    // Build sorted result
    const result = Array.from(weeks.values())
        .sort((a, b) => b.end - a.end)
        .slice(0, maxWeeks)
        .map(w => {
            let status = 'Draft';
            if (w.statusCounts.approved > 0) {
                status = 'Approved';
            } else if (w.statusCounts.pending > 0) {
                status = 'Pending';
            } else if (w.statusCounts.rejected > 0) {
                status = 'Rejected';
            }

            const submitted = w.createdAtList.length ?
                w.createdAtList.sort((a, b) => b - a)[0].toISOString().slice(0, 10) : '';

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
                entries: w.entries || [] // [NEW] Expose the entries
            };
        });

    return result;
}

/**
 * Process timesheet documents into current week data
 * @param {Array} timesheetDocs - Array of timesheet documents
 * @param {string} userId - User ID (for week context)
 * @returns {Promise<Object>} Current week data with days and entries
 */
export async function processCurrentWeekTimesheets(timesheetDocs, userId) {
    const { weekStartDay } = await getUserWeekContext(userId);
    const { start } = getWeekRangeForDate(new Date(), weekStartDay || DEFAULT_WEEK_START_DAY);

    // Get ordered week dates
    const dates = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        dates.push(formatISODate(d));
    }

    // Filter timesheets for current week
    const weekTimesheets = timesheetDocs.filter(ts =>
        dates.includes(ts.period)
    );

    const entries = weekTimesheets.map(ts => ({
        id: ts.id,
        ...ts
    }));

    return {
        days: dates,
        entries
    };
}

/**
 * Process sessions into recent entries format
 * @param {Array} sessionDocs - Array of session documents
 * @param {number} days - Number of days to include (default: 7)
 * @returns {Array} Recent entries formatted for display
 */
export function processRecentEntries(sessionDocs, days = 7) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    cutoffDate.setHours(0, 0, 0, 0);

    const entries = [];

    for (const session of sessionDocs) {
        const startedAt = session.startedAt?.toDate ? session.startedAt.toDate() : null;
        if (!startedAt || startedAt < cutoffDate) continue;

        const dateStr = formatISODate(startedAt);
        const endedAt = session.endedAt?.toDate ? session.endedAt.toDate() : null;

        const roundedStart = session.roundedStartedAt?.toDate ?
            session.roundedStartedAt.toDate() : startedAt;
        const roundedEnd = session.roundedEndedAt?.toDate ?
            session.roundedEndedAt.toDate() : endedAt;

        entries.push({
            id: session.id,
            date: dateStr,
            clockIn: roundedStart,
            clockOut: roundedEnd,
            duration: session.durationEffectiveSec || 0,
            status: session.status,
            sessionId: session.id
        });
    }

    // Group by date and sort
    const grouped = {};
    for (const entry of entries) {
        if (!grouped[entry.date]) {
            grouped[entry.date] = [];
        }
        grouped[entry.date].push(entry);
    }

    // Sort dates descending
    const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

    return sortedDates.map(date => ({
        date,
        entries: grouped[date].sort((a, b) => {
            const aTime = a.clockIn?.getTime() || 0;
            const bTime = b.clockIn?.getTime() || 0;
            return bTime - aTime;
        })
    }));
}

/**
 * Process sessions and timesheets into dashboard recent entries format
 * Combines session data (for clock in/out times) with timesheet data (for totals)
 * @param {Array} sessionDocs - Array of session documents
 * @param {Array} timesheetDocs - Array of timesheet documents
 * @param {number} days - Number of days to include (default: 7)
 * @returns {Array} Recent entries with clock times and totals
 */
export function processDashboardRecentEntries(sessionDocs, timesheetDocs, days = 7) {
    // Handle undefined/null inputs
    if (!sessionDocs) sessionDocs = [];
    if (!timesheetDocs) timesheetDocs = [];

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    cutoffDate.setHours(0, 0, 0, 0);

    // Get last 7 days dates
    const dateStrs = [];
    for (let i = 0; i < days; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        dateStrs.push(formatISODate(d));
    }

    const result = [];

    for (const dateStr of dateStrs) {
        // Get timesheet for this date
        const timesheet = Array.isArray(timesheetDocs) ? timesheetDocs.find(ts => ts.period === dateStr) : null;

        // Get sessions for this date
        const daySessions = Array.isArray(sessionDocs) ? sessionDocs.filter(s => {
            const startedAt = s.startedAt?.toDate ? s.startedAt.toDate() : null;
            if (!startedAt) return false;
            const sessionDate = formatISODate(startedAt);
            return sessionDate === dateStr;
        }) : [];

        // Get clock in/out pairs from sessions
        const clockInOutPairs = daySessions.map(s => {
            const getRoundedStart = () => {
                if (s.roundedStartedAt?.toDate) return s.roundedStartedAt.toDate();
                if (s.startedAt?.toDate) return s.startedAt.toDate();
                return null;
            };

            const getRoundedEnd = () => {
                if (s.status === 'open') return null;
                if (s.roundedEndedAt?.toDate) return s.roundedEndedAt.toDate();
                if (s.endedAt?.toDate) return s.endedAt.toDate();
                return null;
            };

            const clockIn = getRoundedStart();
            const clockOut = getRoundedEnd();

            return {
                clockIn,
                clockOut,
                sessionId: s.id,
                status: s.status
            };
        }).filter(pair => {
            if (pair.clockIn === null || pair.clockOut === null) return false;
            return pair.clockOut.getTime() > pair.clockIn.getTime();
        });

        // Get totals from timesheet
        let totals = { grossSec: 0, effectiveSec: 0, overtimeSec: 0 };

        if (timesheet?.entries && Array.isArray(timesheet.entries)) {
            // Priority 1: Get totals from specific daily entry
            const dayEntry = timesheet.entries.find(e => e.date === dateStr);
            if (dayEntry) {
                totals = {
                    grossSec: dayEntry.grossSec || 0,
                    effectiveSec: dayEntry.effectiveSec || 0,
                    overtimeSec: dayEntry.overtimeSec || 0
                };
            }
            // If entries array exists but no entry for this day, totals remain 0
            // logic correctly skips the fallback to timesheet.totals 
        } else if (timesheet?.totals) {
            // Priority 2: Fallback to timesheet totals (Legacy behavior for daily docs)
            // Only use if no entries array exists
            totals = timesheet.totals;
        }

        // Calculate break hours from timesheet entry
        let breakSec = 0;
        if (timesheet?.entries && Array.isArray(timesheet.entries)) {
            // Find entry for this date
            const dayEntry = timesheet.entries.find(e => e.date === dateStr);
            if (dayEntry) {
                // Prioritize manualBreakSec and autoLunchBreakSec
                const storedManualBreak = Number.isFinite(dayEntry.manualBreakSec) ? Math.max(0, dayEntry.manualBreakSec) : null;
                const storedAutoBreak = Number.isFinite(dayEntry.autoLunchBreakSec) ? Math.max(0, dayEntry.autoLunchBreakSec) : null;
                if (storedManualBreak !== null || storedAutoBreak !== null) {
                    breakSec = Math.max(0, (storedManualBreak || 0) + (storedAutoBreak || 0));
                } else if (Number.isFinite(dayEntry.grossSec) && Number.isFinite(dayEntry.effectiveSec)) {
                    // Fallback to gross - effective calculation
                    breakSec = Math.max(0, dayEntry.grossSec - dayEntry.effectiveSec);
                }
            }
        }

        // If no break from entry, calculate from sessions
        if (breakSec === 0 && daySessions.length > 0) {
            breakSec = daySessions.reduce((acc, s) => {
                const manual = Number.isFinite(s.manualBreakSec) ? Math.max(0, s.manualBreakSec) : 0;
                const autoLunch = Number.isFinite(s.autoLunchBreakSec) ? Math.max(0, s.autoLunchBreakSec) : 0;
                const legacyBreak = Number.isFinite(s.breakSec) ? Math.max(0, s.breakSec) : 0;
                // Prioritize manual + auto, fallback to legacy
                return acc + ((manual || autoLunch) ? (manual + autoLunch) : legacyBreak);
            }, 0);
        }

        // Format clock in/out pairs for display
        const clockInOutPairsFormatted = clockInOutPairs.map(pair => ({
            clockIn: pair.clockIn ? pair.clockIn.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '-',
            clockOut: pair.clockOut ? pair.clockOut.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '-',
            clockInTime: pair.clockIn,
            clockOutTime: pair.clockOut,
            sessionId: pair.sessionId,
            status: pair.status
        }));

        // Format seconds to hours/minutes
        const formatSeconds = (sec) => {
            const h = Math.floor((sec || 0) / 3600);
            const m = Math.floor(((sec || 0) % 3600) / 60);
            return `${String(h)}h ${String(m).padStart(2, '0')}m`;
        };

        // Get day name
        const dateObj = new Date(dateStr);
        const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });

        if (timesheet || clockInOutPairs.length > 0) {
            result.push({
                date: dateStr,
                day: dayName,
                clockInOutPairs: clockInOutPairsFormatted,
                clockIn: clockInOutPairs.length > 0 && clockInOutPairs[0].clockIn
                    ? clockInOutPairs[0].clockIn.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                    : '-',
                clockOut: clockInOutPairs.length > 0
                    ? (() => {
                        const lastOut = clockInOutPairs
                            .map(p => p.clockOut)
                            .filter(Boolean)
                            .sort((a, b) => b.getTime() - a.getTime())[0];
                        return lastOut ? lastOut.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '-';
                    })()
                    : '-',
                totals: {
                    grossSec: totals.grossSec || 0,
                    effectiveSec: totals.effectiveSec || 0,
                    overtimeSec: totals.overtimeSec || 0
                },
                totalHours: formatSeconds(totals.effectiveSec || 0),
                breakHours: formatSeconds(breakSec),
                overtime: formatSeconds(totals.overtimeSec || 0),
                timesheetId: timesheet?.id || null
            });
        } else {
            // Still include days with no entries
            result.push({
                date: dateStr,
                day: dayName,
                clockInOutPairs: [],
                clockIn: '-',
                clockOut: '-',
                totals: {
                    grossSec: 0,
                    effectiveSec: 0,
                    overtimeSec: 0
                },
                totalHours: '0h 00m',
                breakHours: '0h 00m',
                overtime: '0h 00m',
                timesheetId: null
            });
        }
    }

    return result.sort((a, b) => b.date.localeCompare(a.date));
}

