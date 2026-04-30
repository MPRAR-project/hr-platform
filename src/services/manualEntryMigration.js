/**
 * Manual Entry Migration Service
 * Backfills timeClockSessions documents for old manual entries that lack sessionId
 * 
 * Three modes:
 * 1. DRY_RUN - Preview what would be migrated (no writes)
 * 2. LIVE - Execute migration (create sessions, update entries)
 * 3. ROLLBACK - Undo a previous migration
 */

import {
    collection,
    doc,
    getDocs,
    getDoc,
    addDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    serverTimestamp,
    writeBatch
} from 'firebase/firestore';
import { db, auth } from '../firebase/client';

// Migration modes
export const MIGRATION_MODE = {
    DRY_RUN: 'dry_run',
    LIVE: 'live',
    ROLLBACK: 'rollback'
};

/**
 * Scan all timesheets for manual entries without sessionId
 * @param {string} companyId - Optional filter by company
 * @returns {Promise<{total: number, entries: Array}>}
 */
export async function scanManualEntriesForMigration(companyId = null) {
    console.log('[Migration] Scanning for manual entries without sessionId...');

    const results = {
        total: 0,
        entries: [],
        byUser: {},
        byDate: {}
    };

    try {
        // Build query
        let timesheetsQuery;
        if (companyId) {
            const companyPath = companyId.includes('/') ? companyId : `companies/${companyId}`;
            timesheetsQuery = query(
                collection(db, 'timesheets'),
                where('companyId', '==', companyPath)
            );
        } else {
            timesheetsQuery = collection(db, 'timesheets');
        }

        const timesheetsSnap = await getDocs(timesheetsQuery);
        console.log(`[Migration] Found ${timesheetsSnap.size} timesheets to scan`);

        for (const tsDoc of timesheetsSnap.docs) {
            const tsData = tsDoc.data();
            const entries = Array.isArray(tsData.entries) ? tsData.entries : [];

            for (const entry of entries) {
                // Check if this is a manual entry without sessionId
                if (entry.isManual === true && !entry.sessionId) {
                    // Skip description-only entries (they don't need sessions)
                    if (entry.isDescriptionOnly) continue;
                    // Skip entries without valid clock times
                    if (!entry.clockIn && !entry.rawClockIn) continue;

                    const entryRecord = {
                        timesheetId: tsDoc.id,
                        // entryId: entry.id || `entry_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, // Generate ID if missing
                        entryId: entry.id || crypto.randomUUID(), // Standardized UUID
                        userId: tsData.userId,
                        companyId: tsData.companyId,
                        date: entry.date,
                        clockIn: entry.rawClockIn || entry.clockIn,
                        clockOut: entry.rawClockOut || entry.clockOut,
                        rawStart: entry.rawStart,
                        rawEnd: entry.rawEnd,
                        effectiveSec: entry.effectiveSec || 0,
                        grossSec: entry.grossSec || 0,
                        siteId: entry.siteId,
                        notes: entry.notes || entry.description || '',
                        originalEntryIndex: entries.indexOf(entry) // Track position for entries without ID
                    };

                    results.entries.push(entryRecord);
                    results.total++;

                    // Group by user
                    if (!results.byUser[tsData.userId]) {
                        results.byUser[tsData.userId] = 0;
                    }
                    results.byUser[tsData.userId]++;

                    // Group by date
                    if (!results.byDate[entry.date]) {
                        results.byDate[entry.date] = 0;
                    }
                    results.byDate[entry.date]++;
                }
            }
        }

        console.log(`[Migration] Scan complete: ${results.total} entries need migration`);
        return results;

    } catch (error) {
        console.error('[Migration] Scan failed:', error);
        throw error;
    }
}

/**
 * Execute migration (dry run or live)
 * @param {Object} options
 * @param {string} options.mode - 'dry_run' or 'live'
 * @param {string} options.companyId - Optional filter
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<Object>} Migration result
 */
export async function migrateManualEntries(options = {}) {
    const {
        mode = MIGRATION_MODE.DRY_RUN,
        companyId = null,
        onProgress = () => { }
    } = options;

    const isDryRun = mode === MIGRATION_MODE.DRY_RUN;
    console.log(`[Migration] Starting ${isDryRun ? 'DRY RUN' : 'LIVE'} migration...`);

    const migrationId = `mig_${Date.now()}`;
    const result = {
        migrationId,
        mode,
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        completedAt: null,
        entriesScanned: 0,
        entriesMigrated: 0,
        sessionIdsCreated: [],
        entryUpdates: [],
        errors: [],
        createdBy: auth.currentUser?.userId || 'system'
    };

    try {
        // Step 1: Scan for entries to migrate
        onProgress({ phase: 'scanning', progress: 0 });
        const scanResult = await scanManualEntriesForMigration(companyId);
        result.entriesScanned = scanResult.total;

        if (scanResult.total === 0) {
            result.status = 'completed';
            result.completedAt = new Date().toISOString();
            result.message = 'No entries need migration';
            return result;
        }

        onProgress({ phase: 'migrating', progress: 0, total: scanResult.total });

        // Step 2: Process each entry
        for (let i = 0; i < scanResult.entries.length; i++) {
            const entry = scanResult.entries[i];

            try {
                console.log(`[Migration] Processing entry ${i + 1}/${scanResult.entries.length}:`, entry.entryId);

                // Create session data
                const sessionData = buildSessionFromEntry(entry);
                console.log(`[Migration] Built session data for entry ${entry.entryId}`);

                if (isDryRun) {
                    // Dry run - just record what would happen
                    result.entryUpdates.push({
                        entryId: entry.entryId,
                        timesheetId: entry.timesheetId,
                        wouldCreateSession: true,
                        sessionData: sessionData
                    });
                    result.entriesMigrated++;
                    console.log(`[Migration] Dry run: would create session for ${entry.entryId}`);
                } else {
                    // Live migration - create session and update entry
                    console.log(`[Migration] Creating session in Firestore...`);
                    const sessionsRef = collection(db, 'timeClockSessions');
                    const sessionDocRef = await addDoc(sessionsRef, sessionData);
                    const sessionId = sessionDocRef.id;
                    console.log(`[Migration] Session created: ${sessionId}`);

                    result.sessionIdsCreated.push(sessionId);

                    // Update the timesheet entry with sessionId
                    console.log(`[Migration] Updating timesheet entry...`);
                    await updateTimesheetEntryWithSessionId(
                        entry.timesheetId,
                        entry.entryId,
                        sessionId,
                        entry.originalEntryIndex // Pass index for entries without IDs
                    );
                    console.log(`[Migration] Entry ${entry.entryId} updated with sessionId ${sessionId}`);

                    result.entryUpdates.push({
                        entryId: entry.entryId,
                        timesheetId: entry.timesheetId,
                        sessionId: sessionId
                    });
                    result.entriesMigrated++;
                }

            } catch (entryError) {
                console.error(`[Migration] Failed to migrate entry ${entry.entryId}:`, entryError);
                result.errors.push({
                    entryId: entry.entryId,
                    error: entryError.message
                });
            }

            // Report progress after each entry
            console.log(`[Migration] Progress: ${i + 1}/${scanResult.total}`);
            onProgress({
                phase: 'migrating',
                progress: i + 1,
                total: scanResult.total,
                current: entry.entryId
            });
        }

        // Step 3: Save migration record (only for live migrations)
        if (!isDryRun) {
            await saveMigrationRecord(result);
        }

        result.status = 'completed';
        result.completedAt = new Date().toISOString();
        console.log(`[Migration] ${isDryRun ? 'DRY RUN' : 'LIVE'} complete:`, {
            migrated: result.entriesMigrated,
            errors: result.errors.length
        });

        return result;

    } catch (error) {
        console.error('[Migration] Migration failed:', error);
        result.status = 'failed';
        result.error = error.message;
        result.completedAt = new Date().toISOString();

        if (!isDryRun) {
            await saveMigrationRecord(result);
        }

        throw error;
    }
}

/**
 * Rollback a previous migration
 * @param {string} migrationId - ID of migration to rollback
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Object>}
 */
export async function rollbackMigration(migrationId, onProgress = () => { }) {
    console.log(`[Migration] Starting rollback for ${migrationId}...`);

    try {
        // Step 1: Get migration record
        const migrationRef = doc(db, 'migrations', migrationId);
        const migrationSnap = await getDoc(migrationRef);

        if (!migrationSnap.exists()) {
            throw new Error(`Migration ${migrationId} not found`);
        }

        const migrationData = migrationSnap.data();

        if (migrationData.status === 'rolled_back') {
            throw new Error('Migration already rolled back');
        }

        const { sessionIdsCreated, entryUpdates } = migrationData;
        const total = sessionIdsCreated.length + entryUpdates.length;
        let processed = 0;

        onProgress({ phase: 'rollback', progress: 0, total });

        // Step 2: Delete created sessions
        for (const sessionId of sessionIdsCreated) {
            try {
                await deleteDoc(doc(db, 'timeClockSessions', sessionId));
                processed++;
                onProgress({ phase: 'deleting_sessions', progress: processed, total });
            } catch (err) {
                console.warn(`[Migration] Failed to delete session ${sessionId}:`, err);
            }
        }

        // Step 3: Remove sessionId from entries
        for (const update of entryUpdates) {
            if (update.sessionId) {
                try {
                    await removeSessionIdFromEntry(update.timesheetId, update.entryId);
                    processed++;
                    onProgress({ phase: 'updating_entries', progress: processed, total });
                } catch (err) {
                    console.warn(`[Migration] Failed to update entry ${update.entryId}:`, err);
                }
            }
        }

        // Step 4: Update migration record
        await updateDoc(migrationRef, {
            status: 'rolled_back',
            rolledBackAt: serverTimestamp(),
            rolledBackBy: auth.currentUser?.userId || 'system'
        });

        console.log(`[Migration] Rollback complete for ${migrationId}`);

        return {
            success: true,
            migrationId,
            sessionsDeleted: sessionIdsCreated.length,
            entriesUpdated: entryUpdates.length
        };

    } catch (error) {
        console.error('[Migration] Rollback failed:', error);
        throw error;
    }
}

/**
 * Get migration history
 * @returns {Promise<Array>}
 */
export async function getMigrationHistory() {
    try {
        const migrationsQuery = query(
            collection(db, 'migrations'),
            where('type', '==', 'manual_entry_session_backfill')
        );
        const snap = await getDocs(migrationsQuery);

        return snap.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        })).sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));

    } catch (error) {
        console.error('[Migration] Failed to get history:', error);
        return [];
    }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Build session document from entry data
 */
function buildSessionFromEntry(entry) {
    // Parse clock times
    let startedAt = null;
    let endedAt = null;

    if (entry.rawStart) {
        startedAt = new Date(entry.rawStart);
    } else if (entry.clockIn && entry.date) {
        const [hours, mins] = entry.clockIn.split(':').map(Number);
        startedAt = new Date(entry.date);
        startedAt.setHours(hours, mins, 0, 0);
    }

    if (entry.rawEnd) {
        endedAt = new Date(entry.rawEnd);
    } else if (entry.clockOut && entry.date) {
        const [hours, mins] = entry.clockOut.split(':').map(Number);
        endedAt = new Date(entry.date);
        endedAt.setHours(hours, mins, 0, 0);
    }

    // Build base session object - only include defined values
    const sessionData = {
        userId: entry.userId || 'unknown',
        companyId: entry.companyId || null,
        siteId: entry.siteId || null,
        startedAt: startedAt,
        endedAt: endedAt,
        roundedStartedAt: startedAt,
        roundedEndedAt: endedAt,
        durationGrossSec: entry.grossSec || 0,
        durationEffectiveSec: entry.effectiveSec || 0,
        status: 'ended',
        isManual: true,
        source: 'migration',
        notes: entry.notes || '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    };

    // Only add migratedFrom if we have valid IDs
    if (entry.entryId && entry.timesheetId) {
        sessionData.migratedFrom = {
            entryId: entry.entryId,
            timesheetId: entry.timesheetId
        };
    }

    return sessionData;
}

/**
 * Update a timesheet entry with sessionId
 */
async function updateTimesheetEntryWithSessionId(timesheetId, entryId, sessionId, originalEntryIndex = -1) {
    const tsRef = doc(db, 'timesheets', timesheetId);
    const tsSnap = await getDoc(tsRef);

    if (!tsSnap.exists()) {
        throw new Error(`Timesheet ${timesheetId} not found`);
    }

    const tsData = tsSnap.data();
    const entries = Array.isArray(tsData.entries) ? [...tsData.entries] : [];

    // Try to find by ID first
    let entryIndex = entries.findIndex(e => e.id === entryId);

    // If not found by ID and we have an originalEntryIndex, use that
    if (entryIndex === -1 && originalEntryIndex >= 0 && originalEntryIndex < entries.length) {
        console.log(`[Migration] Entry ${entryId} not found by ID, using originalEntryIndex: ${originalEntryIndex}`);
        entryIndex = originalEntryIndex;
    }

    if (entryIndex === -1) {
        // Still not found - skip updating but don't throw (session was already created)
        console.warn(`[Migration] Entry not found in timesheet, skipping update. Session was created.`);
        return;
    }

    entries[entryIndex] = {
        ...entries[entryIndex],
        id: entries[entryIndex].id || entryId, // Assign ID if missing
        sessionId: sessionId,
        migratedAt: new Date().toISOString()
    };

    await updateDoc(tsRef, {
        entries: entries,
        updatedAt: serverTimestamp()
    });
}

/**
 * Remove sessionId from entry (for rollback)
 */
async function removeSessionIdFromEntry(timesheetId, entryId) {
    const tsRef = doc(db, 'timesheets', timesheetId);
    const tsSnap = await getDoc(tsRef);

    if (!tsSnap.exists()) return;

    const tsData = tsSnap.data();
    const entries = Array.isArray(tsData.entries) ? [...tsData.entries] : [];

    const entryIndex = entries.findIndex(e => e.id === entryId);
    if (entryIndex === -1) return;

    // Remove sessionId and migratedAt
    const { sessionId, migratedAt, ...restEntry } = entries[entryIndex];
    entries[entryIndex] = restEntry;

    await updateDoc(tsRef, {
        entries: entries,
        updatedAt: serverTimestamp()
    });
}

/**
 * Save migration record to Firestore
 */
async function saveMigrationRecord(result) {
    try {
        const migrationData = {
            ...result,
            type: 'manual_entry_session_backfill',
            createdAt: serverTimestamp()
        };

        const migrationRef = doc(db, 'migrations', result.migrationId);
        await setDoc(migrationRef, migrationData);
        console.log('[Migration] Migration record saved:', result.migrationId);
    } catch (err) {
        console.error('[Migration] Failed to save migration record:', err);
    }
}
