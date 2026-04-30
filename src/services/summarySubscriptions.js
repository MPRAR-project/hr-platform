import { collection, doc, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { db } from '../firebase/client';
import { getTimesheetId, reconcileTimesheetForWeek, getUserWeekContext } from './timesheets';
import { formatISODate, getWeekRangeForDate, DEFAULT_WEEK_START_DAY } from '../utils/weekStartUtils';

/**
 * Subscribe to Weekly Summaries (Direct Source of Truth)
 * 
 * REPLACES legacy 'weekly_summaries' listener.
 * Now listens directly to 'timesheets' collection to ensure 100% data consistency
 * between the List View and the Detail View.
 * 
 * Performance Note: fetching 20 weeks of full timesheets is negligible (~100KB).
 */

export async function subscribeWeeklySummaries(userId, callback) {
    if (!userId) return () => { };

    const { getUserWeekContext } = await import('./timesheets');
    const { weekStartDay, companyIdPath } = await getUserWeekContext(userId);

    const { getCompanyWorkSchedule, computeTargetSecondsForDay } = await import('./timesheets');
    const { STORAGE_ANCHOR_DAY, isMondayAnchorEnabled } = await import('../utils/weekStartUtils');

    const effectiveWeekStart = isMondayAnchorEnabled(companyIdPath)
        ? STORAGE_ANCHOR_DAY
        : (weekStartDay || DEFAULT_WEEK_START_DAY);

    const schedule = await getCompanyWorkSchedule(companyIdPath);

    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    const minPeriod = d.toISOString().slice(0, 10);

    const efficientQuery = query(
        collection(db, 'timesheets'),
        where('userId', '==', userId),
        where('period', '>=', minPeriod)
    );

    const unsubscribe = onSnapshot(efficientQuery, (snap) => {
        const rawDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        const deriveDocTotals = (doc) => {
            // Prefer summing entries for correctness (doc.totals can be stale on legacy docs or partial updates)
            if (doc && Array.isArray(doc.entries) && doc.entries.length > 0) {
                return doc.entries.reduce((acc, e) => {
                    acc.grossSec += e?.grossSec || 0;
                    acc.effectiveSec += e?.effectiveSec || 0;
                    acc.overtimeSec += e?.overtimeSec || 0;
                    return acc;
                }, { grossSec: 0, effectiveSec: 0, overtimeSec: 0 });
            }
            return {
                grossSec: doc?.totals?.grossSec || 0,
                effectiveSec: doc?.totals?.effectiveSec || 0,
                overtimeSec: doc?.totals?.overtimeSec || 0
            };
        };

        // Aggregate Daily to Weekly
        const weekMap = new Map();

        rawDocs.forEach(doc => {
            const dateStr = doc.period || doc.start;
            if (!dateStr) return;

            const { start } = getWeekRangeForDate(dateStr, effectiveWeekStart);
            const weekStartStr = formatISODate(start);

            if (!weekMap.has(weekStartStr)) {
                weekMap.set(weekStartStr, {
                    id: `virtual_${userId}_${weekStartStr}`,
                    userId,
                    period: weekStartStr,
                    start: weekStartStr,
                    end: formatISODate(new Date(start.getTime() + 6 * 86400000)),
                    totals: { grossSec: 0, effectiveSec: 0, overtimeSec: 0 },
                    status: 'approved', // will be downgraded
                    docCount: 0,
                    statuses: new Set(),
                    entries: [],
                    submittedAtList: []
                });
            }

            const w = weekMap.get(weekStartStr);
            const dt = deriveDocTotals(doc);

            // Normalize status with a defensive fallback:
            // Some legacy/edge-case docs may have missing/empty status even though they were submitted.
            // If the doc has submittedAt (or any worked time/entries), treat it as pending instead of draft.
            const rawStatus = String(doc.status || '').toLowerCase();
            const hasWorkedTime = (dt.effectiveSec || dt.grossSec) > 0;
            const hasEntries = Array.isArray(doc.entries) && doc.entries.length > 0;
            const hasSubmittedAt = Boolean(doc.submittedAt);

            const status = rawStatus
                ? rawStatus
                : ((hasSubmittedAt || hasWorkedTime || hasEntries) ? 'pending' : 'draft');

            if (doc.submittedAt && typeof doc.submittedAt.toDate === 'function') {
                w.submittedAtList.push(doc.submittedAt.toDate());
            } else if (doc.createdAt && typeof doc.createdAt.toDate === 'function') {
                w.submittedAtList.push(doc.createdAt.toDate());
            }

            w.totals.grossSec += dt.grossSec;
            w.totals.effectiveSec += dt.effectiveSec;
            w.totals.overtimeSec += dt.overtimeSec;

            // IMPORTANT: Do not let empty auto-created draft docs (no submission, no time, no entries)
            // downgrade the entire week to Draft. They are placeholders.
            const isEmptySkeletonDraft = (status === 'draft') && !hasSubmittedAt && !hasWorkedTime && !hasEntries;
            if (!isEmptySkeletonDraft) {
                w.statuses.add(status);
            }
            w.docCount++;
            if (doc.entries) w.entries.push(...doc.entries);
            if (!w.docIds) w.docIds = [];
            w.docIds.push(doc.id);

            // Capture metadata from any doc (prefer approved one)
            if (status === 'approved' || !w.approvedBy) {
                if (doc.approvedBy) w.approvedBy = doc.approvedBy;
                if (doc.approvedByName) w.approvedByName = doc.approvedByName;
                if (doc.approvedAt) w.approvedAt = doc.approvedAt;
                if (doc.pdfUrl) w.pdfUrl = doc.pdfUrl;
                if (doc.storagePath) w.storagePath = doc.storagePath;
            }
        });

        const weeklySummaries = Array.from(weekMap.values()).map(w => {
            // Aggregate status with clear priority: Rejected > Draft > Pending > Approved
            const s = w.statuses;
            let finalStatus = 'draft';

            if (s.has('rejected')) {
                finalStatus = 'rejected';
            } else if (s.has('draft')) {
                finalStatus = 'draft';
            } else if (s.has('pending') || s.has('approved-by-team')) {
                finalStatus = 'pending';
            } else if (s.has('approved')) {
                finalStatus = 'approved';
            } else {
                finalStatus = 'draft';
            }

            let submittedDateStr = '';
            if (w.submittedAtList && w.submittedAtList.length > 0) {
                const latestDate = w.submittedAtList.sort((a, b) => b.getTime() - a.getTime())[0];
                submittedDateStr = latestDate.toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                });
            }

            return {
                ...w,
                status: finalStatus,
                weekStart: w.start,
                weekEnd: w.end,
                weekKey: `${w.start}_${w.end}`,
                submitted: submittedDateStr
            };
        });

        // Client-side Sort (Desc)
        weeklySummaries.sort((a, b) => b.start.localeCompare(a.start));

        callback(weeklySummaries);
    }, (err) => {
        console.warn(`[subscribeWeeklySummaries] Subscription failed for ${userId}`, err);
        callback([]);
    });

    return unsubscribe;
}

/**
 * Extract lightweight summary from a full timesheet doc
 * (Mirror of Server Logic for Optimistic Client Updates)
 */
function extractSummaryFromTimesheet(timesheet) {
    if (!timesheet || !timesheet.start || !timesheet.end) return null;

    const totals = timesheet.totals || { grossSec: 0, effectiveSec: 0, overtimeSec: 0 };
    // Recalculate if missing (Behavioral Equivalence)
    if (!timesheet.totals && Array.isArray(timesheet.entries)) {
        totals.grossSec = 0;
        totals.effectiveSec = 0;
        totals.overtimeSec = 0;
        timesheet.entries.forEach(e => {
            totals.grossSec += e.grossSec || 0;
            totals.effectiveSec += e.effectiveSec || 0;
            totals.overtimeSec += e.overtimeSec || 0;
        });
    }

    // Status counts logic if needed, but usually list just needs status
    return {
        weekKey: `${timesheet.start}_${timesheet.end}`,
        start: timesheet.start,
        end: timesheet.end,
        totals,
        status: timesheet.status || 'draft',
        // Preserve other fields needed for WeekList
        submitted: timesheet.createdAt?.toDate ? timesheet.createdAt.toDate().toISOString() : null,
        approvedByName: timesheet.approvedByName,
        // entries: [] // List view usually doesn't need entries, but 'processWeeklySummaries' returned them. 
        // We might need to check if WeekList uses entries. Usually it just needs totals.
    };
}
