/**
 * Timesheet Entry Utilities
 * 
 * Provides helper functions for processing and displaying timesheet entries.
 * Includes deduplication logic to handle edge cases where duplicate entries
 * may exist in the database.
 */

/**
 * Deduplicates timesheet entries by sessionId/sessionKey.
 * When duplicates exist, prefers entries marked as `isManual: true`
 * or the most recently updated entry.
 * 
 * @param {Array<Object>} entries - Array of timesheet entries
 * @returns {Array<Object>} - Deduplicated array of entries
 */
export function deduplicateEntries(entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
        return entries || [];
    }

    const sessionMap = new Map();

    for (const entry of entries) {
        // Determine the unique key for this entry
        const key = entry.sessionId || entry.sessionKey || entry.id;

        if (!key) {
            // Entry has no identifiable key, include it as-is
            // (This handles legacy entries or description-only entries)
            continue;
        }

        const existing = sessionMap.get(key);

        if (!existing) {
            // First occurrence, add it
            sessionMap.set(key, entry);
        } else {
            // Duplicate found - decide which to keep
            // Priority: isManual=true > later updatedAt > first occurrence
            const existingIsManual = existing.isManual === true;
            const newIsManual = entry.isManual === true;

            if (newIsManual && !existingIsManual) {
                // Prefer manual entry over auto-imported
                sessionMap.set(key, entry);
            } else if (existingIsManual === newIsManual) {
                // Both same type, prefer more recent
                const existingTime = new Date(existing.updatedAt || existing.createdAt || 0).getTime();
                const newTime = new Date(entry.updatedAt || entry.createdAt || 0).getTime();
                if (newTime > existingTime) {
                    sessionMap.set(key, entry);
                }
            }
            // Otherwise keep existing
        }
    }

    // Include entries without keys (description-only, etc.)
    const keyedEntries = Array.from(sessionMap.values());
    const unkeyedEntries = entries.filter(entry => {
        const key = entry.sessionId || entry.sessionKey || entry.id;
        return !key;
    });

    return [...keyedEntries, ...unkeyedEntries];
}

/**
 * Recalculates totals from an array of entries.
 * Use this after deduplication to ensure totals are accurate.
 * 
 * @param {Array<Object>} entries - Array of timesheet entries
 * @returns {Object} - { grossSec, effectiveSec, overtimeSec }
 */
export function calculateTotals(entries) {
    if (!Array.isArray(entries)) {
        return { grossSec: 0, effectiveSec: 0, overtimeSec: 0 };
    }

    return entries.reduce((totals, entry) => {
        return {
            grossSec: totals.grossSec + (entry.grossSec || 0),
            effectiveSec: totals.effectiveSec + (entry.effectiveSec || 0),
            overtimeSec: totals.overtimeSec + (entry.overtimeSec || 0)
        };
    }, { grossSec: 0, effectiveSec: 0, overtimeSec: 0 });
}

/**
 * Processes entries for display: deduplicates and recalculates totals.
 * 
 * @param {Array<Object>} entries - Raw entries from Firestore
 * @returns {Object} - { entries: Array, totals: Object }
 */
export function processEntriesForDisplay(entries) {
    const dedupedEntries = deduplicateEntries(entries);
    const totals = calculateTotals(dedupedEntries);
    return { entries: dedupedEntries, totals };
}
