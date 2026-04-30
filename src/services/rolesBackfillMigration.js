
import {
    collection,
    doc,
    getDocs,
    updateDoc,
    query,
    where,
    serverTimestamp,
    writeBatch
} from 'firebase/firestore';
import { db, auth } from '../firebase/client';

export const MIGRATION_MODE = {
    DRY_RUN: 'dry_run',
    LIVE: 'live'
};

/**
 * Scan for users missing the roles array
 * @returns {Promise<{total: number, users: Array}>}
 */
export async function scanUsersForMissingRoles() {
    console.log('[Migration] Scanning for users missing roles array...');

    const results = {
        total: 0,
        users: []
    };

    try {
        const usersRef = collection(db, 'users');
        const snapshot = await getDocs(usersRef);

        for (const doc of snapshot.docs) {
            const userData = doc.data();

            // Check if roles is missing or empty
            const missingRoles = !userData.roles || !Array.isArray(userData.roles) || userData.roles.length === 0;

            if (missingRoles) {
                // Determine what the role should be
                // Use primaryRole, or fallback to 'employee' if widely safe, or 'no-role'
                // Based on previous findings, primaryRole is usually set.
                const targetRole = userData.primaryRole || userData.role || 'employee';

                results.users.push({
                    id: doc.id,
                    email: userData.email,
                    displayName: userData.displayName,
                    currentPrimaryRole: userData.primaryRole,
                    currentRoleLegacy: userData.role,
                    proposedRoles: [targetRole]
                });
                results.total++;
            }
        }

        console.log(`[Migration] Scan complete: ${results.total} users need migration`);
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
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<Object>} Migration result
 */
export async function migrateMissingRoles(options = {}) {
    const {
        mode = MIGRATION_MODE.DRY_RUN,
        onProgress = () => { }
    } = options;

    const isDryRun = mode === MIGRATION_MODE.DRY_RUN;
    console.log(`[Migration] Starting ${isDryRun ? 'DRY RUN' : 'LIVE'} migration...`);

    const result = {
        mode,
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        completedAt: null,
        usersScanned: 0,
        usersMigrated: 0,
        updates: [],
        errors: []
    };

    try {
        // Step 1: Scan
        onProgress({ phase: 'scanning', progress: 0 });
        const scanResult = await scanUsersForMissingRoles();
        result.usersScanned = scanResult.total;

        if (scanResult.total === 0) {
            result.status = 'completed';
            result.completedAt = new Date().toISOString();
            result.message = 'No users need migration';
            return result;
        }

        onProgress({ phase: 'migrating', progress: 0, total: scanResult.total });

        // Step 2: Process
        // Process in batches of 500 ideally, but simple for loop for now
        let processed = 0;

        // Batch writes if live
        let batch = null;
        let batchCount = 0;
        if (!isDryRun) {
            batch = writeBatch(db);
        }

        for (const user of scanResult.users) {
            try {
                if (isDryRun) {
                    result.updates.push({
                        userId: user.id,
                        email: user.email,
                        action: 'Would update roles',
                        value: user.proposedRoles
                    });
                    result.usersMigrated++;
                } else {
                    const userRef = doc(db, 'users', user.id);
                    batch.update(userRef, {
                        roles: user.proposedRoles,
                        updatedAt: serverTimestamp()
                    });

                    batchCount++;
                    result.updates.push({
                        userId: user.id,
                        email: user.email,
                        action: 'Updated roles',
                        value: user.proposedRoles
                    });

                    // Commit batch every 400 updates
                    if (batchCount >= 400) {
                        await batch.commit();
                        batch = writeBatch(db); // new batch
                        batchCount = 0;
                    }
                    result.usersMigrated++;
                }

                processed++;
                onProgress({
                    phase: 'migrating',
                    progress: processed,
                    total: scanResult.total,
                    current: user.email
                });

            } catch (err) {
                console.error(`[Migration] Failed to migrate user ${user.id}:`, err);
                result.errors.push({
                    userId: user.id,
                    error: err.message
                });
            }
        }

        // Commit remaining batch
        if (!isDryRun && batchCount > 0) {
            await batch.commit();
        }

        result.status = 'completed';
        result.completedAt = new Date().toISOString();

        return result;

    } catch (error) {
        console.error('[Migration] Migration failed:', error);
        result.status = 'failed';
        result.error = error.message;
        throw error;
    }
}
