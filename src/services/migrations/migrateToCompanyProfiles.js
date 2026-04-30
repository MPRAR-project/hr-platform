import { db } from '../../firebase/client';
import {
    collection,
    getDocs,
    doc,
    setDoc,
    updateDoc,
    writeBatch,
    serverTimestamp
} from 'firebase/firestore';

/**
 * Migration Script: Convert existing users to multi-company profile system
 * 
 * This script:
 * 1. Creates a userCompanyProfile for each existing user
 * 2. Updates user documents with new fields (primaryCompanyId, companyProfiles)
 * 3. Preserves all existing data
 * 4. Maintains backward compatibility
 */

export async function migrateUsersToCompanyProfiles(options = {}) {
    const { dryRun = false, batchSize = 100 } = options;

    console.log(`Starting user migration to company profiles (${dryRun ? 'DRY RUN' : 'LIVE'})`);

    const results = {
        total: 0,
        migrated: 0,
        skipped: 0,
        errors: [],
        profiles: []
    };

    try {
        // Fetch all users
        const usersRef = collection(db, 'users');
        const usersSnapshot = await getDocs(usersRef);
        results.total = usersSnapshot.size;

        console.log(`Found ${results.total} users to migrate`);

        // Process in batches
        const users = usersSnapshot.docs;
        for (let i = 0; i < users.length; i += batchSize) {
            const batch = users.slice(i, i + batchSize);
            await processBatch(batch, dryRun, results);
        }

        console.log('Migration complete:', results);
        return results;

    } catch (error) {
        console.error('Migration failed:', error);
        results.errors.push({ type: 'FATAL', message: error.message });
        throw error;
    }
}

async function processBatch(userDocs, dryRun, results) {
    const batch = writeBatch(db);
    let batchCount = 0;

    for (const userDoc of userDocs) {
        try {
            const userId = userDoc.id;
            const userData = userDoc.data();

            // Skip if already migrated
            if (userData.companyProfiles && userData.companyProfiles.length > 0) {
                console.log(`User ${userId} already migrated, skipping`);
                results.skipped++;
                continue;
            }

            // Skip if no company ID
            if (!userData.companyId) {
                console.warn(`User ${userId} has no companyId, skipping`);
                results.skipped++;
                continue;
            }

            // Create company profile
            const profileRef = doc(collection(db, 'userCompanyProfiles'));
            const profileId = profileRef.id;

            const companyId = userData.companyId.includes('/')
                ? userData.companyId
                : `companies/${userData.companyId}`;

            const profileData = {
                userId,
                companyId,
                status: userData.archived ? 'Archived' : 'Active',
                joinedAt: userData.createdAt || serverTimestamp(),
                createdAt: userData.createdAt || serverTimestamp(),
                updatedAt: serverTimestamp(),

                // Copy company-specific fields
                primaryRole: userData.primaryRole || userData.role || 'employee',
                roles: userData.roles || [userData.primaryRole || userData.role || 'employee'],
                siteId: userData.siteId || null,
                reportsTo: userData.reportsTo || null,
                managerUserId: userData.managerUserId || null,
                teamId: userData.teamId || null,

                // Employment details
                employmentDetails: userData.employmentDetails || {},
                rates: userData.rates || {},
                cisDeduction: userData.cisDeduction || null,
                utrNumber: userData.utrNumber || null,

                // Migration metadata
                migratedFrom: 'users_collection',
                migratedAt: serverTimestamp()
            };

            // Add archived timestamp if applicable
            if (userData.archived && userData.archivedAt) {
                profileData.archivedAt = userData.archivedAt;
            }

            if (!dryRun) {
                batch.set(profileRef, profileData);
                batchCount++;
            }

            // Update user document
            const userUpdates = {
                primaryCompanyId: companyId,
                companyProfiles: [profileId],
                updatedAt: serverTimestamp(),

                // Keep old fields for backward compatibility (mark as deprecated)
                _deprecated_companyId: userData.companyId,
                _deprecated_archived: userData.archived || false
            };

            if (!dryRun) {
                batch.update(doc(db, 'users', userId), userUpdates);
                batchCount++;
            }

            results.migrated++;
            results.profiles.push({
                userId,
                profileId,
                companyId,
                status: profileData.status
            });

            console.log(`Prepared migration for user ${userId} -> profile ${profileId}`);

        } catch (error) {
            console.error(`Error processing user ${userDoc.id}:`, error);
            results.errors.push({
                userId: userDoc.id,
                error: error.message
            });
        }
    }

    // Commit batch
    if (!dryRun && batchCount > 0) {
        await batch.commit();
        console.log(`Committed batch of ${batchCount} operations`);
    }
}

/**
 * Rollback migration (emergency use only)
 * Removes company profiles and restores original user fields
 */
export async function rollbackMigration(options = {}) {
    const { dryRun = false } = options;

    console.log(`Starting migration rollback (${dryRun ? 'DRY RUN' : 'LIVE'})`);

    const results = {
        profilesDeleted: 0,
        usersRestored: 0,
        errors: []
    };

    try {
        // Get all company profiles
        const profilesRef = collection(db, 'userCompanyProfiles');
        const profilesSnapshot = await getDocs(profilesRef);

        console.log(`Found ${profilesSnapshot.size} profiles to delete`);

        // Delete all profiles
        const batch = writeBatch(db);
        let batchCount = 0;

        for (const profileDoc of profilesSnapshot.docs) {
            if (!dryRun) {
                batch.delete(doc(db, 'userCompanyProfiles', profileDoc.id));
                batchCount++;
            }
            results.profilesDeleted++;

            // Commit in batches of 500 (Firestore limit)
            if (batchCount >= 500) {
                if (!dryRun) await batch.commit();
                batchCount = 0;
            }
        }

        if (batchCount > 0 && !dryRun) {
            await batch.commit();
        }

        // Restore user documents
        const usersRef = collection(db, 'users');
        const usersSnapshot = await getDocs(usersRef);

        for (const userDoc of usersSnapshot.docs) {
            const userData = userDoc.data();

            if (userData._deprecated_companyId) {
                const restoreUpdates = {
                    companyId: userData._deprecated_companyId,
                    archived: userData._deprecated_archived || false,
                    primaryCompanyId: null,
                    companyProfiles: [],
                    updatedAt: serverTimestamp()
                };

                if (!dryRun) {
                    await updateDoc(doc(db, 'users', userDoc.id), restoreUpdates);
                }

                results.usersRestored++;
            }
        }

        console.log('Rollback complete:', results);
        return results;

    } catch (error) {
        console.error('Rollback failed:', error);
        results.errors.push({ type: 'FATAL', message: error.message });
        throw error;
    }
}

/**
 * Verify migration integrity
 * Checks that all users have corresponding profiles
 */
export async function verifyMigration() {
    console.log('Verifying migration integrity...');

    const report = {
        totalUsers: 0,
        usersWithProfiles: 0,
        usersWithoutProfiles: [],
        orphanedProfiles: [],
        statusMismatches: []
    };

    try {
        // Get all users
        const usersRef = collection(db, 'users');
        const usersSnapshot = await getDocs(usersRef);
        report.totalUsers = usersSnapshot.size;

        // Get all profiles
        const profilesRef = collection(db, 'userCompanyProfiles');
        const profilesSnapshot = await getDocs(profilesRef);

        const profilesByUser = {};
        profilesSnapshot.docs.forEach(doc => {
            const data = doc.data();
            if (!profilesByUser[data.userId]) {
                profilesByUser[data.userId] = [];
            }
            profilesByUser[data.userId].push({ id: doc.id, ...data });
        });

        // Check each user
        for (const userDoc of usersSnapshot.docs) {
            const userId = userDoc.id;
            const userData = userDoc.data();
            const userProfiles = profilesByUser[userId] || [];

            if (userProfiles.length === 0) {
                report.usersWithoutProfiles.push({
                    userId,
                    email: userData.email,
                    companyId: userData.companyId
                });
            } else {
                report.usersWithProfiles++;

                // Check status consistency
                const userArchived = userData.archived || userData._deprecated_archived;
                const hasActiveProfile = userProfiles.some(p => p.status === 'active');

                if (userArchived && hasActiveProfile) {
                    report.statusMismatches.push({
                        userId,
                        issue: 'User marked as archived but has active profile',
                        profiles: userProfiles.map(p => ({ id: p.id, status: p.status }))
                    });
                }
            }
        }

        // Check for orphaned profiles
        const userIds = new Set(usersSnapshot.docs.map(d => d.id));
        profilesSnapshot.docs.forEach(doc => {
            const data = doc.data();
            if (!userIds.has(data.userId)) {
                report.orphanedProfiles.push({
                    profileId: doc.id,
                    userId: data.userId,
                    companyId: data.companyId
                });
            }
        });

        console.log('Verification complete:', report);
        return report;

    } catch (error) {
        console.error('Verification failed:', error);
        throw error;
    }
}
