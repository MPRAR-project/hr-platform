import { db } from '../firebase/client';
import { collection, getDocs, query, where, updateDoc, doc, serverTimestamp, getDoc, setDoc, deleteDoc } from 'firebase/firestore';

/**
 * Migration script to populate managerUserId field for existing users
 * This should be run once to update existing user documents
 */
export async function migrateManagerUserIdField() {
    console.log('Starting migration: Populating managerUserId field for existing users...');

    try {
        // Get all users that don't have managerUserId field
        const usersCol = collection(db, 'users');
        const allUsersSnap = await getDocs(usersCol);

        let updatedCount = 0;
        let skippedCount = 0;
        const batch = [];

        for (const userDoc of allUsersSnap.docs) {
            const userData = userDoc.data();
            const userId = userDoc.id;

            // Skip if managerUserId already exists
            if (userData.managerUserId) {
                skippedCount++;
                continue;
            }

            // Try to get managerUserId from existing data sources
            // Priority: 1) assignments collection, 2) reportsTo field
            let managerUserId = null;

            // First, try to find in assignments collection (most reliable)
            try {
                const assignmentsCol = collection(db, 'assignments');
                const assignmentQuery = query(assignmentsCol, where('employeeId', '==', userId));
                const assignmentSnap = await getDocs(assignmentQuery);

                if (!assignmentSnap.empty) {
                    const assignment = assignmentSnap.docs[0].data();
                    managerUserId = assignment.managerUserId || assignment.managerId;
                    console.log(`Found manager from assignments for user ${userId}: ${managerUserId}`);
                }
            } catch (error) {
                console.warn(`Failed to check assignments for user ${userId}:`, error);
            }

            // Fallback to reportsTo field if no assignment found
            if (!managerUserId && userData.reportsTo) {
                managerUserId = userData.reportsTo;
                console.log(`Using reportsTo for user ${userId}: ${managerUserId}`);
            }

            // Update the user document if we found a manager
            if (managerUserId) {
                try {
                    await updateDoc(doc(db, 'users', userId), {
                        managerUserId: managerUserId,
                        updatedAt: serverTimestamp()
                    });
                    updatedCount++;
                    console.log(`Updated user ${userId} with managerUserId: ${managerUserId}`);
                } catch (error) {
                    console.error(`Failed to update user ${userId}:`, error);
                }
            } else {
                console.log(`No manager found for user ${userId}, setting managerUserId to null`);
                try {
                    await updateDoc(doc(db, 'users', userId), {
                        managerUserId: null,
                        updatedAt: serverTimestamp()
                    });
                    updatedCount++;
                } catch (error) {
                    console.error(`Failed to update user ${userId}:`, error);
                }
            }
        }

        console.log(`Migration completed!`);
        console.log(`- Updated: ${updatedCount} users`);
        console.log(`- Skipped: ${skippedCount} users (already had managerUserId)`);
        console.log(`- Total processed: ${allUsersSnap.size} users`);

        return {
            success: true,
            updated: updatedCount,
            skipped: skippedCount,
            total: allUsersSnap.size
        };

    } catch (error) {
        console.error('Migration failed:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Utility function to check migration status
 * Returns count of users with and without managerUserId field
 */
export async function checkMigrationStatus() {
    try {
        const usersCol = collection(db, 'users');
        const allUsersSnap = await getDocs(usersCol);

        let withField = 0;
        let withoutField = 0;

        for (const userDoc of allUsersSnap.docs) {
            const userData = userDoc.data();
            if (userData.managerUserId !== undefined) {
                withField++;
            } else {
                withoutField++;
            }
        }

        return {
            total: allUsersSnap.size,
            withManagerUserId: withField,
            withoutManagerUserId: withoutField,
            migrationNeeded: withoutField > 0
        };
    } catch (error) {
        console.error('Failed to check migration status:', error);
        return {
            error: error.message
        };
    }
}

/**
 * Validate migration by cross-checking with assignments collection
 * This helps ensure the migration worked correctly
 */
export async function validateMigration() {
    try {
        console.log('Validating migration...');

        const usersCol = collection(db, 'users');
        const assignmentsCol = collection(db, 'assignments');

        const [usersSnap, assignmentsSnap] = await Promise.all([
            getDocs(usersCol),
            getDocs(assignmentsCol)
        ]);

        const users = usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const assignments = assignmentsSnap.docs.map(doc => doc.data());

        let validationErrors = [];
        let validatedCount = 0;

        // Check each assignment
        for (const assignment of assignments) {
            const employeeId = assignment.employeeId;
            const expectedManagerId = assignment.managerUserId || assignment.managerId;

            const user = users.find(u => u.id === employeeId);
            if (!user) {
                validationErrors.push(`Assignment references non-existent user: ${employeeId}`);
                continue;
            }

            if (user.managerUserId !== expectedManagerId) {
                validationErrors.push(
                    `User ${employeeId} has managerUserId=${user.managerUserId}, but assignment says ${expectedManagerId}`
                );
            } else {
                validatedCount++;
            }
        }

        console.log(`Validation completed:`);
        console.log(`- Validated: ${validatedCount} assignments`);
        console.log(`- Errors: ${validationErrors.length}`);

        if (validationErrors.length > 0) {
            console.warn('Validation errors:', validationErrors);
        }

        return {
            success: validationErrors.length === 0,
            validated: validatedCount,
            errors: validationErrors,
            totalAssignments: assignments.length
        };

    } catch (error) {
        console.error('Validation failed:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Migrate existing timesheets to include managerUserId field
 * This function updates all existing timesheets that don't have the managerUserId field
 */
export async function migrateTimesheetsManagerUserId() {
    try {
        console.log('Starting timesheets managerUserId migration...');

        const timesheetsCol = collection(db, 'timesheets');
        const timesheetsSnap = await getDocs(timesheetsCol);

        let updatedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        for (const timesheetDoc of timesheetsSnap.docs) {
            const timesheetData = timesheetDoc.data();
            const timesheetId = timesheetDoc.id;

            // Skip if already has managerUserId
            if (timesheetData.managerUserId) {
                skippedCount++;
                continue;
            }

            try {
                const userId = timesheetData.userId;
                if (!userId) {
                    console.warn(`Timesheet ${timesheetId} has no userId, skipping`);
                    errorCount++;
                    continue;
                }

                // Get user's managerUserId
                const userSnap = await getDoc(doc(db, 'users', userId));
                if (!userSnap.exists()) {
                    console.warn(`User ${userId} not found for timesheet ${timesheetId}, skipping`);
                    errorCount++;
                    continue;
                }

                const userData = userSnap.data();
                let managerUserId = userData.managerUserId || userData.reportsTo || null;

                // If still no manager, try assignments collection
                if (!managerUserId) {
                    try {
                        const assignmentsCol = collection(db, 'assignments');
                        const assignmentQuery = query(assignmentsCol, where('employeeId', '==', userId));
                        const assignmentSnap = await getDocs(assignmentQuery);

                        if (!assignmentSnap.empty) {
                            const assignment = assignmentSnap.docs[0].data();
                            managerUserId = assignment.managerUserId || assignment.managerId || null;
                        }
                    } catch (e) {
                        console.warn(`Failed to check assignments for user ${userId}:`, e);
                    }
                }

                // Update the timesheet with managerUserId
                await updateDoc(doc(db, 'timesheets', timesheetId), {
                    managerUserId: managerUserId,
                    updatedAt: serverTimestamp()
                });

                updatedCount++;
                console.log(`Updated timesheet ${timesheetId} with managerUserId: ${managerUserId}`);

            } catch (error) {
                console.error(`Failed to update timesheet ${timesheetId}:`, error);
                console.error(`Timesheet data:`, timesheetData);
                console.error(`User ID:`, timesheetData.userId);
                errorCount++;
            }
        }

        console.log(`Timesheets migration completed:`);
        console.log(`- Updated: ${updatedCount} timesheets`);
        console.log(`- Skipped: ${skippedCount} timesheets (already had managerUserId)`);
        console.log(`- Errors: ${errorCount} timesheets`);

        return {
            success: true,
            updated: updatedCount,
            skipped: skippedCount,
            errors: errorCount,
            message: `Updated ${updatedCount} timesheets with managerUserId field`
        };

    } catch (error) {
        console.error('Timesheets migration failed:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Check timesheets status - see what timesheets exist and their current state
 */
export async function checkTimesheetsStatus() {
    try {
        console.log('Checking timesheets status...');

        const timesheetsCol = collection(db, 'timesheets');
        const timesheetsSnap = await getDocs(timesheetsCol);

        let totalTimesheets = 0;
        let withManagerUserId = 0;
        let withoutManagerUserId = 0;
        let withoutUserId = 0;
        let orphanedTimesheets = [];

        for (const timesheetDoc of timesheetsSnap.docs) {
            const timesheetData = timesheetDoc.data();
            const timesheetId = timesheetDoc.id;
            totalTimesheets++;

            if (!timesheetData.userId) {
                withoutUserId++;
                orphanedTimesheets.push({
                    id: timesheetId,
                    issue: 'No userId field',
                    data: timesheetData
                });
                continue;
            }

            if (timesheetData.managerUserId) {
                withManagerUserId++;
            } else {
                withoutManagerUserId++;
                // Check if user exists
                try {
                    const userSnap = await getDoc(doc(db, 'users', timesheetData.userId));
                    if (!userSnap.exists()) {
                        orphanedTimesheets.push({
                            id: timesheetId,
                            userId: timesheetData.userId,
                            issue: 'User not found',
                            data: timesheetData
                        });
                    }
                } catch (e) {
                    orphanedTimesheets.push({
                        id: timesheetId,
                        userId: timesheetData.userId,
                        issue: 'Error checking user',
                        error: e.message,
                        data: timesheetData
                    });
                }
            }
        }

        console.log(`Timesheets Status:`);
        console.log(`- Total timesheets: ${totalTimesheets}`);
        console.log(`- With managerUserId: ${withManagerUserId}`);
        console.log(`- Without managerUserId: ${withoutManagerUserId}`);
        console.log(`- Without userId field: ${withoutUserId}`);
        console.log(`- Orphaned timesheets: ${orphanedTimesheets.length}`);

        if (orphanedTimesheets.length > 0) {
            console.log('Orphaned timesheets details:', orphanedTimesheets);
        }

        return {
            success: true,
            total: totalTimesheets,
            withManagerUserId,
            withoutManagerUserId,
            withoutUserId,
            orphaned: orphanedTimesheets,
            message: `Found ${totalTimesheets} timesheets, ${withoutManagerUserId} need migration`
        };

    } catch (error) {
        console.error('Failed to check timesheets status:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Create missing user documents in Firestore for users that exist in Auth but not in users collection
 */
export async function createMissingUserDocuments() {
    try {
        console.log('Creating missing user documents...');

        // Get all timesheets to find user IDs
        const timesheetsCol = collection(db, 'timesheets');
        const timesheetsSnap = await getDocs(timesheetsCol);

        // Get all existing users in Firestore
        const usersCol = collection(db, 'users');
        const usersSnap = await getDocs(usersCol);
        const existingUserIds = new Set(usersSnap.docs.map(doc => doc.id));

        // Find user IDs from timesheets that don't exist in users collection
        const missingUserIds = new Set();
        for (const timesheetDoc of timesheetsSnap.docs) {
            const timesheetData = timesheetDoc.data();
            if (timesheetData.userId && !existingUserIds.has(timesheetData.userId)) {
                missingUserIds.add(timesheetData.userId);
            }
        }

        console.log(`Found ${missingUserIds.size} missing user IDs:`, Array.from(missingUserIds));

        if (missingUserIds.size === 0) {
            return {
                success: true,
                message: 'No missing user documents found',
                created: 0
            };
        }

        let createdCount = 0;
        const errors = [];

        for (const userId of missingUserIds) {
            try {
                // Create a basic user document with minimal required fields
                const userRef = doc(db, 'users', userId);
                await setDoc(userRef, {
                    email: `user-${userId}@example.com`, // Placeholder email
                    displayName: `User ${userId.slice(0, 8)}`, // Placeholder name
                    firstName: 'Unknown',
                    lastName: 'User',
                    primaryRole: 'employee',
                    roles: ['employee'],
                    status: 'active',
                    managerUserId: null, // Will be set by migration
                    reportsTo: null,
                    companyId: '', // Will need to be set manually
                    siteId: '',
                    teamId: null,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                });

                createdCount++;
                console.log(`Created user document for: ${userId}`);

            } catch (error) {
                console.error(`Failed to create user document for ${userId}:`, error);
                errors.push({ userId, error: error.message });
            }
        }

        console.log(`User document creation completed:`);
        console.log(`- Created: ${createdCount} user documents`);
        console.log(`- Errors: ${errors.length}`);

        if (errors.length > 0) {
            console.log('Errors:', errors);
        }

        return {
            success: true,
            created: createdCount,
            errors: errors,
            message: `Created ${createdCount} missing user documents`
        };

    } catch (error) {
        console.error('Failed to create missing user documents:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Fix timesheet user ID mismatches by mapping Auth user IDs to Firestore user IDs
 */
export async function fixTimesheetUserIds() {
    try {
        console.log('Fixing timesheet user ID mismatches...');

        // Get all timesheets
        const timesheetsCol = collection(db, 'timesheets');
        const timesheetsSnap = await getDocs(timesheetsCol);

        // Get all users from Firestore
        const usersCol = collection(db, 'users');
        const usersSnap = await getDocs(usersCol);
        const users = usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Create a mapping from email to Firestore user ID
        const emailToUserIdMap = new Map();
        users.forEach(user => {
            if (user.email) {
                emailToUserIdMap.set(user.email, user.id);
            }
        });

        console.log('Email to User ID mapping:', Object.fromEntries(emailToUserIdMap));

        let updatedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        const updates = [];

        for (const timesheetDoc of timesheetsSnap.docs) {
            const timesheetData = timesheetDoc.data();
            const timesheetId = timesheetDoc.id;
            const currentUserId = timesheetData.userId;

            // Check if this user ID exists in Firestore
            const userExists = users.find(u => u.id === currentUserId);

            if (userExists) {
                skippedCount++;
                continue; // User ID is correct, skip
            }

            // Try to find the user by looking up timesheet data for clues
            // This is a fallback - we'll need to manually map some
            let correctUserId = null;

            // For now, let's create a manual mapping for known cases
            const manualMappings = {
                'k0VjZZCQeONYhUyi1ivWWqi4OAt2': 'GOqhYHvkU6wXj2ckSkqN', // s3e1@gmail.com
                // Add more mappings as needed
            };

            correctUserId = manualMappings[currentUserId];

            if (correctUserId) {
                // Verify the target user exists
                const targetUser = users.find(u => u.id === correctUserId);
                if (targetUser) {
                    updates.push({
                        timesheetId,
                        oldUserId: currentUserId,
                        newUserId: correctUserId,
                        userEmail: targetUser.email
                    });
                } else {
                    console.warn(`Target user ${correctUserId} not found for timesheet ${timesheetId}`);
                    errorCount++;
                }
            } else {
                console.warn(`No mapping found for user ID ${currentUserId} in timesheet ${timesheetId}`);
                errorCount++;
            }
        }

        // Apply updates
        for (const update of updates) {
            try {
                await updateDoc(doc(db, 'timesheets', update.timesheetId), {
                    userId: update.newUserId,
                    updatedAt: serverTimestamp()
                });

                updatedCount++;
                console.log(`Updated timesheet ${update.timesheetId}: ${update.oldUserId} → ${update.newUserId} (${update.userEmail})`);

            } catch (error) {
                console.error(`Failed to update timesheet ${update.timesheetId}:`, error);
                errorCount++;
            }
        }

        console.log(`Timesheet user ID fix completed:`);
        console.log(`- Updated: ${updatedCount} timesheets`);
        console.log(`- Skipped: ${skippedCount} timesheets (correct user ID)`);
        console.log(`- Errors: ${errorCount} timesheets`);

        return {
            success: true,
            updated: updatedCount,
            skipped: skippedCount,
            errors: errorCount,
            message: `Updated ${updatedCount} timesheets with correct user IDs`
        };

    } catch (error) {
        console.error('Failed to fix timesheet user IDs:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Restructure users collection to use Firebase Auth user IDs as document IDs
 * This is more future-proof and easier to manage
 */
export async function restructureUsersCollection() {
    try {
        console.log('Restructuring users collection to use Auth user IDs...');

        // Get all current users from Firestore
        const usersCol = collection(db, 'users');
        const usersSnap = await getDocs(usersCol);
        const currentUsers = usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        console.log(`Found ${currentUsers.length} users in Firestore`);

        // Get all timesheets to find Auth user IDs
        const timesheetsCol = collection(db, 'timesheets');
        const timesheetsSnap = await getDocs(timesheetsCol);
        const authUserIds = new Set();

        for (const timesheetDoc of timesheetsSnap.docs) {
            const timesheetData = timesheetDoc.data();
            if (timesheetData.userId) {
                authUserIds.add(timesheetData.userId);
            }
        }

        console.log(`Found ${authUserIds.size} Auth user IDs from timesheets:`, Array.from(authUserIds));

        let restructuredCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        const errors = [];

        // Create a mapping from current Firestore IDs to Auth user IDs
        const idMappings = {
            'FCes2h65ynUIIk2eOmZS': 'm33vKgMJ3lV9laHM2AKW0CgFHps1', // siteowner12@gmail.com
            'RSu0eAWID7dIYAHwaJ8t': 'elYRQsm48dSGyf6IqDKdyLyRGnH2', // demoowner@mprar.com
            'GOqhYHvkU6wXj2ckSkqN': 'k0VjZZCQeONYhUyi1ivWWqi4OAt2', // (existing example)
            // Add more mappings as needed
        };

        for (const user of currentUsers) {
            try {
                // Check if this user needs to be restructured
                const authUserId = idMappings[user.id];

                if (!authUserId) {
                    // Check if the current ID is already an Auth user ID
                    if (authUserIds.has(user.id)) {
                        skippedCount++;
                        console.log(`User ${user.id} already uses Auth user ID, skipping`);
                        continue;
                    } else {
                        console.log(`No mapping found for user ${user.id}, skipping`);
                        skippedCount++;
                        continue;
                    }
                }

                // Create new user document with Auth user ID
                const newUserRef = doc(db, 'users', authUserId);
                await setDoc(newUserRef, {
                    ...user,
                    id: authUserId, // Ensure the ID field matches the document ID
                    updatedAt: serverTimestamp()
                });

                // Update all timesheets that reference the old user ID
                const timesheetsToUpdate = timesheetsSnap.docs.filter(doc =>
                    doc.data().userId === user.id
                );

                for (const timesheetDoc of timesheetsToUpdate) {
                    await updateDoc(timesheetDoc.ref, {
                        userId: authUserId,
                        updatedAt: serverTimestamp()
                    });
                }

                // Delete the old user document
                await deleteDoc(doc(db, 'users', user.id));

                restructuredCount++;
                console.log(`Restructured user: ${user.id} → ${authUserId} (${user.email})`);
                console.log(`Updated ${timesheetsToUpdate.length} timesheets`);

            } catch (error) {
                console.error(`Failed to restructure user ${user.id}:`, error);
                errors.push({ userId: user.id, error: error.message });
                errorCount++;
            }
        }

        console.log(`Users collection restructuring completed:`);
        console.log(`- Restructured: ${restructuredCount} users`);
        console.log(`- Skipped: ${skippedCount} users`);
        console.log(`- Errors: ${errorCount} users`);

        if (errors.length > 0) {
            console.log('Errors:', errors);
        }

        return {
            success: true,
            restructured: restructuredCount,
            skipped: skippedCount,
            errors: errorCount,
            message: `Restructured ${restructuredCount} users to use Auth user IDs`
        };

    } catch (error) {
        console.error('Failed to restructure users collection:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Run migration with confirmation
 * This function can be called from the browser console or a migration page
 */
export async function runMigrationWithConfirmation() {
    const status = await checkMigrationStatus();

    if (status.error) {
        console.error('Cannot check migration status:', status.error);
        return;
    }

    console.log('Migration Status:', status);

    if (!status.migrationNeeded) {
        console.log('✅ Migration not needed - all users already have managerUserId field');
        // Still run validation to ensure data consistency
        const validation = await validateMigration();
        console.log('Validation result:', validation);
        return;
    }

    console.log(`⚠️  Migration needed: ${status.withoutManagerUserId} users missing managerUserId field`);
    console.log('Running migration...');

    const result = await migrateManagerUserIdField();

    if (result.success) {
        console.log('✅ Migration completed successfully!');
        console.log(`Updated ${result.updated} users`);

        // Run validation after migration
        console.log('Running post-migration validation...');
        const validation = await validateMigration();
        if (validation.success) {
            console.log('✅ Validation passed - migration is consistent with assignments collection');
        } else {
            console.warn('⚠️  Validation found issues:', validation.errors);
        }
    } else {
        console.error('❌ Migration failed:', result.error);
    }

    return result;
}
