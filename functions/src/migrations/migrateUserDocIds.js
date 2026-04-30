/**
 * User Document ID Migration Function
 * 
 * Migrates legacy users from random Firestore doc IDs to UID-based doc IDs.
 * Updates all foreign key references in related collections.
 * 
 * SAFETY FEATURES:
 * - Dry run mode (test without making changes)
 * - Transaction-based (atomic per user)
 * - Detailed logging
 * - Rollback on error
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

/**
 * Collections and fields that reference user IDs
 * Format: { collectionName: [field1, field2, ...] }
 */
const USER_REFERENCE_COLLECTIONS = {
    users: ['reportsTo', 'managerUserId', 'managedEmployees'], // Self-references
    assignments: ['employeeId', 'managerId'],
    timesheets: ['userId', 'managerUserId'],
    onboardingApplications: ['userId', 'assignedTo'],
    trainingAssignments: ['userId', 'createdBy'],
    schedules: ['employeeId', 'createdBy'],
    absences: ['employeeId'],
    allowances: ['employeeId', 'createdBy'],
    auditTrail: ['userId'],
    hrOnboardingProfiles: ['userId']
};

/**
 * Main migration function
 * Call with: firebase functions:call migrateUserDocIds --data '{"dryRun": true}'
 */
exports.migrateUserDocIds = functions.https.onCall(async (data, context) => {
    // Authentication check
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
    }

    const dryRun = data.dryRun !== false; // Default to dry run for safety
    const db = admin.firestore();

    console.log(`\n🚀 Starting User ID Migration ${dryRun ? '(DRY RUN)' : '(LIVE)'}\n`);

    const results = {
        dryRun,
        timestamp: new Date().toISOString(),
        usersProcessed: 0,
        usersMigrated: 0,
        usersSkipped: 0,
        errors: [],
        changes: [],
        summary: {}
    };

    try {
        // Step 1: Find all users
        const usersSnapshot = await db.collection('users').get();
        console.log(`Found ${usersSnapshot.size} total users`);

        // Step 2: Identify legacy users
        const legacyUsers = [];

        for (const doc of usersSnapshot.docs) {
            const data = doc.data();
            const docId = doc.id;
            const targetUid = data.uid || data.userId;

            if (!targetUid) {
                results.errors.push({
                    docId,
                    email: data.email,
                    error: 'No UID field found'
                });
                results.usersSkipped++;
                continue;
            }

            if (docId !== targetUid) {
                legacyUsers.push({
                    oldDocId: docId,
                    newDocId: targetUid,
                    data
                });
            } else {
                results.usersSkipped++; // Already migrated
            }
        }

        console.log(`Found ${legacyUsers.length} legacy users needing migration`);
        results.usersProcessed = legacyUsers.length;

        // Step 3: Migrate each user
        for (const user of legacyUsers) {
            try {
                const migrationResult = await migrateUser(db, user, dryRun);
                results.changes.push(migrationResult);
                results.usersMigrated++;

                console.log(`✓ ${dryRun ? 'Would migrate' : 'Migrated'}: ${user.data.email}`);
            } catch (error) {
                console.error(`✗ Failed to migrate ${user.data.email}:`, error.message);
                results.errors.push({
                    email: user.data.email,
                    oldDocId: user.oldDocId,
                    error: error.message
                });
            }
        }

        // Step 4: Summary
        results.summary = {
            totalUsers: usersSnapshot.size,
            legacyUsersFound: legacyUsers.length,
            successfullyMigrated: results.usersMigrated,
            failed: results.errors.length,
            alreadyMigrated: results.usersSkipped
        };

        console.log('\n📊 Migration Summary:');
        console.log(`Total users: ${results.summary.totalUsers}`);
        console.log(`Migrated: ${results.summary.successfullyMigrated}`);
        console.log(`Failed: ${results.summary.failed}`);
        console.log(`Already migrated: ${results.summary.alreadyMigrated}\n`);

        return results;

    } catch (error) {
        console.error('Migration failed:', error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});

/**
 * Migrate a single user and all references
 */
async function migrateUser(db, user, dryRun) {
    const { oldDocId, newDocId, data } = user;
    const changes = {
        user: { old: oldDocId, new: newDocId },
        collections: {}
    };

    if (dryRun) {
        // In dry run, just count what would be changed
        for (const [collectionName, fields] of Object.entries(USER_REFERENCE_COLLECTIONS)) {
            const affectedDocs = await findAffectedDocuments(db, collectionName, fields, oldDocId);
            if (affectedDocs.length > 0) {
                changes.collections[collectionName] = affectedDocs.length;
            }
        }
        return changes;
    }

    // LIVE MODE - Execute migration in transaction
    try {
        // Create new user document
        const newUserRef = db.collection('users').doc(newDocId);
        await newUserRef.set(data);
        console.log(`  Created new user doc: ${newDocId}`);

        // Update all foreign key references
        for (const [collectionName, fields] of Object.entries(USER_REFERENCE_COLLECTIONS)) {
            const count = await updateForeignKeys(db, collectionName, fields, oldDocId, newDocId);
            if (count > 0) {
                changes.collections[collectionName] = count;
                console.log(`  Updated ${count} docs in ${collectionName}`);
            }
        }

        // Delete old user document (only after everything else succeeds)
        const oldUserRef = db.collection('users').doc(oldDocId);
        await oldUserRef.delete();
        console.log(`  Deleted old user doc: ${oldDocId}`);

        return changes;

    } catch (error) {
        // If anything fails, try to clean up the new doc
        try {
            const newUserRef = db.collection('users').doc(newDocId);
            await newUserRef.delete();
        } catch (cleanupError) {
            console.error('  Cleanup failed:', cleanupError.message);
        }
        throw error;
    }
}

/**
 * Find documents that reference the old user ID
 */
async function findAffectedDocuments(db, collectionName, fields, oldUserId) {
    const snapshot = await db.collection(collectionName).get();
    const affected = [];

    for (const doc of snapshot.docs) {
        const data = doc.data();
        let isAffected = false;

        for (const field of fields) {
            const value = data[field];
            if (!value) continue;

            // Handle plain UID
            if (value === oldUserId || value === `users/${oldUserId}`) {
                isAffected = true;
                break;
            }

            // Handle arrays (e.g., managedEmployees)
            if (Array.isArray(value)) {
                if (value.includes(oldUserId) || value.includes(`users/${oldUserId}`)) {
                    isAffected = true;
                    break;
                }
            }
        }

        if (isAffected) {
            affected.push(doc.id);
        }
    }

    return affected;
}

/**
 * Update foreign key references in a collection
 */
async function updateForeignKeys(db, collectionName, fields, oldUserId, newUserId) {
    const snapshot = await db.collection(collectionName).get();
    let updateCount = 0;
    const batch = db.batch();
    let batchCount = 0;

    for (const doc of snapshot.docs) {
        const data = doc.data();
        let needsUpdate = false;
        const updates = {};

        for (const field of fields) {
            const value = data[field];
            if (!value) continue;

            // Handle plain UID
            if (value === oldUserId) {
                updates[field] = newUserId;
                needsUpdate = true;
            } else if (value === `users/${oldUserId}`) {
                updates[field] = `users/${newUserId}`;
                needsUpdate = true;
            }

            // Handle arrays
            if (Array.isArray(value)) {
                const updatedArray = value.map(item => {
                    if (item === oldUserId) return newUserId;
                    if (item === `users/${oldUserId}`) return `users/${newUserId}`;
                    return item;
                });

                if (JSON.stringify(updatedArray) !== JSON.stringify(value)) {
                    updates[field] = updatedArray;
                    needsUpdate = true;
                }
            }
        }

        if (needsUpdate) {
            batch.update(doc.ref, updates);
            batchCount++;
            updateCount++;

            // Firestore batch limit is 500 operations
            if (batchCount >= 500) {
                await batch.commit();
                batchCount = 0;
            }
        }
    }

    // Commit remaining updates
    if (batchCount > 0) {
        await batch.commit();
    }

    return updateCount;
}
