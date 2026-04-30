import { db } from '../firebase/client';
import {
    doc,
    getDoc,
    setDoc,
    collection,
    query,
    where,
    getDocs,
    writeBatch,
    serverTimestamp,
    Timestamp
} from 'firebase/firestore';
import { getTimesheetId } from './timesheets';
import { formatISODate } from '../utils/weekStartUtils';

/**
 * Reconciles appropriate timesheet for a given DATE.
 * In the new Daily structure, this ensures:
 * 1. The daily document exists.
 * 2. Any entries for this date in OTHER documents (Legacy weekly docs) are migrated here.
 */
export async function reconcileTimesheetForWeek(userId, companyId, dateStr) {
    if (!userId || !dateStr) return null;

    const targetId = getTimesheetId(userId, dateStr);
    const targetRef = doc(db, 'timesheets', targetId);

    // 1. Fetch Target & Potential Overlaps (Weekly docs that cover this date)
    const [targetSnap, overlapSnaps] = await Promise.all([
        getDoc(targetRef),
        fetchOverlappingTimesheets(userId, dateStr, dateStr)
    ]);

    let targetData = targetSnap.exists() ? targetSnap.data() : null;
    let didCreate = false;
    let didMigrate = false;

    // 2. Auto-Create Target if Missing
    if (!targetSnap.exists()) {
        console.log(`[Reconciler] Daily timesheet ${targetId} missing. Auto-creating.`);
        targetData = await createEmptyTimesheet(targetRef, userId, companyId, dateStr, 'monday', dateStr);
        didCreate = true;
    }

    // 3. Find Entries for this date in OTHER documents
    const entriesToMigrate = [];
    const othersUpdates = new Map();

    overlapSnaps.forEach(tsDoc => {
        if (tsDoc.id === targetId) return;

        const data = tsDoc.data();
        if (!data.entries || !Array.isArray(data.entries)) return;

        const orphans = [];
        const keep = [];
        let hasChanges = false;

        data.entries.forEach(entry => {
            if (entry.date === dateStr) {
                // [DE-DUP CHECK] Only migrate if not already in target
                const entryId = entry.id || entry.sessionKey || entry.sessionId;
                const alreadyInTarget = entryId && targetData.entries?.some(e => (e.id || e.sessionKey || e.sessionId) === entryId);

                if (!alreadyInTarget) {
                    orphans.push(entry);
                }
                hasChanges = true;
            } else {
                keep.push(entry);
            }
        });

        if (hasChanges) {
            if (orphans.length > 0) entriesToMigrate.push(...orphans);
            othersUpdates.set(tsDoc.id, { ref: tsDoc.ref, entries: keep, oldData: data });
        }
    });

    // 4. Execute Migration
    if (entriesToMigrate.length > 0) {
        console.log(`[Reconciler] Found ${entriesToMigrate.length} NEW entries for ${dateStr} in other docs. Migrating to ${targetId}...`);

        const batch = writeBatch(db);

        // Final deduplication for safety when combining
        const rawCombined = [...(targetData.entries || []), ...entriesToMigrate];
        const seenIds = new Set();
        const combinedEntries = rawCombined.filter(e => {
            const id = e.id || e.sessionKey || e.sessionId;
            if (id) {
                if (seenIds.has(id)) return false;
                seenIds.add(id);
            }
            return true;
        });

        const newTotals = calculateTotals(combinedEntries);

        batch.set(targetRef, {
            ...targetData,
            entries: combinedEntries,
            totals: newTotals,
            updatedAt: serverTimestamp()
        }, { merge: true });

        othersUpdates.forEach(({ ref, entries }) => {
            const legacyTotals = calculateTotals(entries);
            batch.update(ref, {
                entries: entries,
                totals: legacyTotals,
                updatedAt: serverTimestamp()
            });
        });

        await batch.commit();
        didMigrate = true;
        targetData.entries = combinedEntries;
        targetData.totals = newTotals;
    }

    return {
        ...targetData,
        id: targetId,
        _wasCreated: didCreate,
        _wasMigrated: didMigrate
    };
}

// --- Helpers ---

async function fetchOverlappingTimesheets(userId, start, end) {
    // Range query: overlapping means ts.start <= requestedEnd AND ts.end >= requestedStart
    // Firestore limitations: can't range on two different fields easily.
    // Strategy: Query by userId, client-side filter.
    // Optimization: query start <= end (Most overlapping docs usually start before the requested end)

    // Actually, simple query: where end >= start
    const q = query(
        collection(db, 'timesheets'),
        where('userId', '==', userId),
        where('end', '>=', start)
    );

    try {
        const snap = await getDocs(q);
        return snap.docs.filter(d => {
            const dData = d.data();
            return dData.start <= end; // Second part of overlap check
        });
    } catch (error) {
        // Handle index building errors gracefully
        if (error.code === 'failed-precondition' && error.message?.includes('currently building')) {
            console.warn('[fetchOverlappingTimesheets] Index is still building. This is expected during deployment. Returning empty array.');
            return []; // Return empty array during index building
        }
        throw error; // Re-throw other errors
    }
}

async function createEmptyTimesheet(ref, userId, companyId, start, weekStartDay, end) {
    const rawCompanyId = companyId.replace('companies/', '');
    const data = {
        userId,
        companyId: rawCompanyId, // Store raw ID
        companyIdPath: companyId.includes('/') ? companyId : `companies/${companyId}`, // Store path
        weekStartDay,
        period: start,
        start,
        end,
        entries: [],
        totals: { grossSec: 0, effectiveSec: 0, overtimeSec: 0 },
        status: 'draft',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    };

    await setDoc(ref, data);
    return data;
}

function calculateTotals(entries) {
    let gross = 0;
    let effective = 0;
    let overtime = 0;

    entries.forEach(e => {
        gross += e.grossSec || 0;
        effective += e.effectiveSec || 0;
        overtime += e.overtimeSec || 0;
    });

    return {
        grossSec: gross,
        effectiveSec: effective,
        overtimeSec: overtime
    };
}
