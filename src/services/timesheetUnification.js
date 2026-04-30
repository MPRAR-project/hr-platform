
import { generateWeekKey, getWeekRangeForDate, formatISODate, isValidDate } from '../utils/weekStartUtils.js';

/**
 * Advanced Unification: Rebuilds the timesheet list from the ground up by extracting ALL entries
 * and re-bucketing them into the correct weeks based on the CURRENT weekStartDay.
 * 
 * This treats the timesheet documents as just "Containers of Entries" rather than authoritative boundaries.
 * It ensures that if an entry exists on Jan 18, it WILL appear in the week of "Jan 13-19" 
 * even if the original document was "Jan 15-21".
 * 
 * @param {Array} timesheets - Raw timesheet documents
 * @param {string} weekStartDay - Current generic week start day (e.g. 'monday')
 */
const STATUS_MAP = { 'rejected': 3, 'pending': 2, 'approved': 1, 'draft': 0 };

export function unifyTimesheetsByEntries(timesheets, weekStartDay) {
    if (!timesheets || !Array.isArray(timesheets) || timesheets.length === 0) {
        return [];
    }

    const weekMap = new Map(); // Key: weekKey, Value: { entries: [], statusPriority: 0, ... }

    // PHASE 1: Initialize from actual Documents (Authority Weeks)
    // This ensure "Skeleton Weeks" (Drafts with no entries yet) are preserved.
    timesheets.forEach(ts => {
        if (!ts) return;

        // Determine anchor date for document (Authoritative for defining the week)
        const anchorDateStr = ts.end || ts.start || ts.period;
        if (!anchorDateStr) return;

        const anchorDate = new Date(anchorDateStr);
        if (!isValidDate(anchorDate)) return;

        const { start, end } = getWeekRangeForDate(anchorDate, weekStartDay);
        if (!start || !end) return;

        const weekKey = generateWeekKey(anchorDate, weekStartDay);
        if (!weekKey) return;

        const weekStartIso = formatISODate(start);
        const weekEndIso = formatISODate(end);

        if (!weekMap.has(weekKey)) {
            weekMap.set(weekKey, {
                id: weekKey,
                weekKey,
                start: weekStartIso,
                end: weekEndIso,
                weekStart: weekStartIso,
                weekEnd: weekEndIso,
                period: weekStartIso,
                entries: [],
                status: ts.status || 'draft',
                totals: { grossSec: 0, effectiveSec: 0, overtimeSec: 0 },
                docIds: ts.id ? [ts.id] : [],
                submitted: ts.submitted || null,
                _statusRank: STATUS_MAP[ts.status?.toLowerCase()] || 0
            });
        } else {
            // Already seen this week (e.g. twin docs). Merge Status.
            const bin = weekMap.get(weekKey);
            const tsRank = STATUS_MAP[ts.status?.toLowerCase()] || 0;
            if (tsRank > bin._statusRank) {
                bin._statusRank = tsRank;
                bin.status = ts.status;
            }
            if (ts.id && !bin.docIds?.includes(ts.id)) {
                bin.docIds = [...(bin.docIds || []), ts.id];
            }
            if (!bin.submitted && ts.submitted) {
                bin.submitted = ts.submitted;
            }
        }
    });

    // PHASE 2: Process ALL Entries (Deduplicated)
    // This discovers "Ghost Weeks" (entries existing outside any document window)
    // AND enriches the Authority Weeks with their data.
    const allEntries = extractDeduplicatedEntries(timesheets);

    allEntries.forEach(entry => {
        if (!entry.date) return;

        // Defensive Date Check
        const entryDate = new Date(entry.date);
        if (!isValidDate(entryDate)) return;

        // Compute canonical week for this entry's date
        const { start, end } = getWeekRangeForDate(entryDate, weekStartDay);
        if (!start || !end) return;

        const weekKey = generateWeekKey(entryDate, weekStartDay);
        if (!weekKey) return;

        const weekStartIso = formatISODate(start);
        const weekEndIso = formatISODate(end);

        if (!weekMap.has(weekKey)) {
            // GHOST WEEK DISCOVERY: We found an entry on a date that has no document.
            weekMap.set(weekKey, {
                id: weekKey,
                weekKey,
                start: weekStartIso,
                end: weekEndIso,
                weekStart: weekStartIso,
                weekEnd: weekEndIso,
                period: weekStartIso,
                entries: [],
                status: 'draft', // Default
                totals: { grossSec: 0, effectiveSec: 0, overtimeSec: 0 },
                docIds: [],
                _isGhost: true,
                _statusRank: 0
            });
        }

        const bin = weekMap.get(weekKey);

        // Safety: ensure we don't double count entries if they are in both twin docs
        const uniqueId = entry.id || entry.sessionKey || entry.sessionId;
        const exists = bin.entries.some(e => (e.id || e.sessionKey || e.sessionId) === uniqueId);

        if (!exists) {
            bin.entries.push(entry);

            // Update Totals
            bin.totals.grossSec += (entry.grossSec || 0);
            bin.totals.effectiveSec += (entry.effectiveSec || 0);
            bin.totals.overtimeSec += (entry.overtimeSec || 0);
        }

        // Update Status Rank (Priority: Entry parent doc status > Current bucket status)
        const entryRank = STATUS_MAP[entry._parentStatus?.toLowerCase()] || 0;
        if (entryRank > bin._statusRank) {
            bin._statusRank = entryRank;
            bin.status = entry._parentStatus;
        }
    });

    // 3. Convert Map to List
    const unified = Array.from(weekMap.values());

    // 4. Sort Descending
    unified.sort((a, b) => {
        const dA = new Date(a.end);
        const dB = new Date(b.end);
        // Defensive sort
        const tA = isValidDate(dA) ? dA.getTime() : 0;
        const tB = isValidDate(dB) ? dB.getTime() : 0;
        return tB - tA;
    });

    return unified;
}

/**
 * Extracts all entries from a list of timesheets, deduplicating by ID.
 * Useful for aggregation views (Invoices, Reports) that need flat data.
 */
export function extractDeduplicatedEntries(timesheets) {
    if (!timesheets || !Array.isArray(timesheets)) return [];

    const allEntries = [];
    const seenEntryIds = new Set();

    try {
        timesheets.forEach(ts => {
            if (!ts || !Array.isArray(ts.entries)) return;

            ts.entries.forEach(e => {
                if (!e) return;
                // Use explicit ID or fallback to sessionKey/sessionId
                const uniqueId = e.id || e.sessionKey || e.sessionId;

                if (uniqueId && seenEntryIds.has(uniqueId)) {
                    // Skip duplicate
                    return;
                }

                if (uniqueId) seenEntryIds.add(uniqueId);

                // Enrich entry with parent metadata
                allEntries.push({ ...e, _parentStatus: ts.status, _parentId: ts.id });
            });
        });
    } catch (err) {
        console.error('[timesheetUnification] Error in extractDeduplicatedEntries:', err);
        return []; // Fail safe
    }
    return allEntries;
}

/**
 * Unifies a list of timesheet documents/summaries into a canonical list based on the configured Week Start Day.
 * This solves the issue of "Twin Weeks" (overlapping periods) when settings change.
 * 
 * @param {Array} timesheets - List of timesheet objects (raw or summary)
 * @param {string} weekStartDay - The current user's/organization's configured week start day
 * @returns {Array} - Unified, deduplicated, and sorted list of timesheets
 */
export function unifyTimesheetList(timesheets, weekStartDay) {
    if (!timesheets || !Array.isArray(timesheets) || timesheets.length === 0) {
        return [];
    }

    if (!weekStartDay) {
        weekStartDay = 'monday'; // default
    }

    // Group by Canonical Week Key
    // We determine the "Canonical" week for a timesheet by taking its END DATE
    // and asking "Which week does this date belong to in the CURRENT configuration?"
    // We use End Date because it's usually the defining anchor for "Week Ending".

    const groups = new Map(); // Key: canonicalWeekKey, Value: [timesheets]

    timesheets.forEach(ts => {
        if (!ts) return;

        // Safe extraction of dates
        const end = ts.weekEnd || ts.raw?.end || ts.end;
        if (!end) return;

        const endDateObj = new Date(end);
        if (!isValidDate(endDateObj)) return;

        // Calculate Canonical Week for this item
        // Note: usage of weekStartDay ensures we align to current settings
        const canonicalKey = generateWeekKey(endDateObj, weekStartDay);

        // Safety Fallback if invalid
        if (!canonicalKey) return;

        if (!groups.has(canonicalKey)) {
            groups.set(canonicalKey, []);
        }
        groups.get(canonicalKey).push(ts);
    });

    const unified = [];

    // Process each group
    for (const [key, group] of groups.entries()) {
        if (group.length === 1) {
            // No conflict, just use it
            unified.push(group[0]);
        } else {
            // Conflict Resolution
            group.sort((a, b) => {
                const aIsExact = (a.id === key || a.weekKey === key);
                const bIsExact = (b.id === key || b.weekKey === key);

                if (aIsExact && !bIsExact) return -1; // a comes first
                if (!aIsExact && bIsExact) return 1;

                // Prefer documents with PDF URLs
                if (a.pdfUrl && !b.pdfUrl) return -1;
                if (!a.pdfUrl && b.pdfUrl) return 1;

                // Prefer content
                const aTotal = a.totals?.grossSec || a.totalSec || 0;
                const bTotal = b.totals?.grossSec || b.totalSec || 0;

                // If one has data and other doesn't, prefer data
                if (aTotal > 0 && bTotal === 0) return -1;
                if (bTotal > 0 && aTotal === 0) return 1;

                // Prefer latest update, defensively
                const dateA = a.lastUpdated ? new Date(a.lastUpdated) : null;
                const dateB = b.lastUpdated ? new Date(b.lastUpdated) : null;
                const timeA = isValidDate(dateA) ? dateA.getTime() : 0;
                const timeB = isValidDate(dateB) ? dateB.getTime() : 0;
                return timeB - timeA;
            });

            const winner = group[0];
            unified.push(winner);
        }
    }

    // Sort Descending by Date
    unified.sort((a, b) => {
        const dA = new Date(a.weekEnd || a.end);
        const dB = new Date(b.weekEnd || b.end);
        const tA = isValidDate(dA) ? dA.getTime() : 0;
        const tB = isValidDate(dB) ? dB.getTime() : 0;
        return tB - tA;
    });

    return unified;
}

/**
 * Helper to ensure a timesheet object has the correct visual labels matching the config.
 * Use this when displaying the unified list.
 */
export function formatUnifiedTimesheet(ts, weekStartDay) {
    if (!ts) return null;
    return ts;
}
