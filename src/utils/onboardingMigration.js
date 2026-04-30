import { collection, getDocs, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase/client';

/**
 * Migration utilities for onboarding field name standardization
 * These functions help migrate from old field names to new standardized names
 */

/**
 * Migrate company documents from isOnbordingManadatory to isOnboardingMandatory
 * @returns {Promise<Object>} Migration result
 */
export async function migrateCompanyOnboardingFields() {
    try {
        console.log('Starting company onboarding field migration...');

        const companiesRef = collection(db, 'companies');
        const snapshot = await getDocs(companiesRef);

        const batch = writeBatch(db);
        let migratedCount = 0;
        let skippedCount = 0;

        snapshot.docs.forEach((docSnap) => {
            const data = docSnap.data();

            // Check if migration is needed
            if (data.hasOwnProperty('isOnbordingManadatory') && !data.hasOwnProperty('isOnboardingMandatory')) {
                const companyRef = doc(db, 'companies', docSnap.id);

                batch.update(companyRef, {
                    isOnboardingMandatory: data.isOnbordingManadatory,
                    // Keep the old field for backward compatibility during transition
                    // isOnbordingManadatory: deleteField() // Uncomment this line to remove old field
                });

                migratedCount++;
                console.log(`Queued migration for company: ${docSnap.id}`);
            } else {
                skippedCount++;
            }
        });

        if (migratedCount > 0) {
            await batch.commit();
            console.log(`Migration completed: ${migratedCount} companies migrated, ${skippedCount} skipped`);
        } else {
            console.log('No companies need migration');
        }

        return {
            success: true,
            migratedCount,
            skippedCount,
            totalProcessed: snapshot.docs.length
        };
    } catch (error) {
        console.error('Error during company onboarding field migration:', error);
        return {
            success: false,
            error: error.message,
            migratedCount: 0,
            skippedCount: 0
        };
    }
}

/**
 * Migrate user documents from isOnbordingCompleted to isOnboardingCompleted
 * @returns {Promise<Object>} Migration result
 */
export async function migrateUserOnboardingFields() {
    try {
        console.log('Starting user onboarding field migration...');

        const usersRef = collection(db, 'users');
        const snapshot = await getDocs(usersRef);

        const batch = writeBatch(db);
        let migratedCount = 0;
        let skippedCount = 0;

        snapshot.docs.forEach((docSnap) => {
            const data = docSnap.data();

            // Check if migration is needed
            if (data.hasOwnProperty('isOnbordingCompleted') && !data.hasOwnProperty('isOnboardingCompleted')) {
                const userRef = doc(db, 'users', docSnap.id);

                batch.update(userRef, {
                    isOnboardingCompleted: data.isOnbordingCompleted,
                    // Keep the old field for backward compatibility during transition
                    // isOnbordingCompleted: deleteField() // Uncomment this line to remove old field
                });

                migratedCount++;
                console.log(`Queued migration for user: ${docSnap.id}`);
            } else {
                skippedCount++;
            }
        });

        if (migratedCount > 0) {
            await batch.commit();
            console.log(`Migration completed: ${migratedCount} users migrated, ${skippedCount} skipped`);
        } else {
            console.log('No users need migration');
        }

        return {
            success: true,
            migratedCount,
            skippedCount,
            totalProcessed: snapshot.docs.length
        };
    } catch (error) {
        console.error('Error during user onboarding field migration:', error);
        return {
            success: false,
            error: error.message,
            migratedCount: 0,
            skippedCount: 0
        };
    }
}

/**
 * Run complete onboarding field migration for both companies and users
 * @returns {Promise<Object>} Complete migration result
 */
export async function runCompleteOnboardingMigration() {
    console.log('Starting complete onboarding field migration...');

    const companyResult = await migrateCompanyOnboardingFields();
    const userResult = await migrateUserOnboardingFields();

    const result = {
        success: companyResult.success && userResult.success,
        companies: companyResult,
        users: userResult,
        summary: {
            totalMigrated: companyResult.migratedCount + userResult.migratedCount,
            totalSkipped: companyResult.skippedCount + userResult.skippedCount,
            totalProcessed: companyResult.totalProcessed + userResult.totalProcessed
        }
    };

    console.log('Complete migration result:', result);
    return result;
}

/**
 * Check migration status - how many documents still need migration
 * @returns {Promise<Object>} Migration status
 */
export async function checkMigrationStatus() {
    try {
        const companiesRef = collection(db, 'companies');
        const usersRef = collection(db, 'users');

        const [companiesSnapshot, usersSnapshot] = await Promise.all([
            getDocs(companiesRef),
            getDocs(usersRef)
        ]);

        let companiesNeedingMigration = 0;
        let usersNeedingMigration = 0;

        companiesSnapshot.docs.forEach((doc) => {
            const data = doc.data();
            if (data.hasOwnProperty('isOnbordingManadatory') && !data.hasOwnProperty('isOnboardingMandatory')) {
                companiesNeedingMigration++;
            }
        });

        usersSnapshot.docs.forEach((doc) => {
            const data = doc.data();
            if (data.hasOwnProperty('isOnbordingCompleted') && !data.hasOwnProperty('isOnboardingCompleted')) {
                usersNeedingMigration++;
            }
        });

        return {
            companies: {
                total: companiesSnapshot.docs.length,
                needingMigration: companiesNeedingMigration,
                migrated: companiesSnapshot.docs.length - companiesNeedingMigration
            },
            users: {
                total: usersSnapshot.docs.length,
                needingMigration: usersNeedingMigration,
                migrated: usersSnapshot.docs.length - usersNeedingMigration
            }
        };
    } catch (error) {
        console.error('Error checking migration status:', error);
        throw error;
    }
}