const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

/**
 * Trigger: When a user document is written (create/update)
 * Purpose: Syncs basic user details to all related userCompanyProfiles to avoid N+1 fetches.
 * Denormalized Fields: displayName, email, photoURL, jobTitle
 */
exports.syncUserProfile = functions.firestore
    .document('users/{userId}')
    .onWrite(async (change, context) => {
        const db = admin.firestore();
        const userId = context.params.userId;

        // 1. Handle Deletion - we strictly do not delete profiles automatically to preserve history.
        // If a user is deleted, their auth is gone, so they can't log in.
        // We exit early.
        if (!change.after.exists) {
            console.log(`[syncUserProfile] User ${userId} deleted. Skipping profile synchronization.`);
            return null;
        }

        const userData = change.after.data();
        const beforeData = change.before.exists ? change.before.data() : {};

        // 2. Check for changes in relevant fields to avoid infinite loops or wasted writes
        // Note: We check 'employmentDetails' object for jobTitle
        const getJobTitle = (data) => data.employmentDetails && data.employmentDetails.jobTitle ? data.employmentDetails.jobTitle : null;

        const newJobTitle = getJobTitle(userData);
        const oldJobTitle = getJobTitle(beforeData);

        const hasChanged =
            userData.displayName !== beforeData.displayName ||
            userData.email !== beforeData.email ||
            userData.photoURL !== beforeData.photoURL ||
            newJobTitle !== oldJobTitle;

        // If it's an update buffer and nothing relevant changed, exit.
        if (!hasChanged && change.before.exists) {
            return null;
        }

        console.log(`[syncUserProfile] data changed for user ${userId}. Syncing to profiles...`);

        // 3. Prepare the update object
        const updates = {
            displayName: userData.displayName || '',
            email: userData.email || '',
            photoURL: userData.photoURL || null,
            jobTitle: newJobTitle, // Can be null
            lastSyncedAt: admin.firestore.FieldValue.serverTimestamp() // Good for debugging
        };

        try {
            // 4. Find all profiles belonging to this user
            const profilesQuery = await db.collection('userCompanyProfiles')
                .where('userId', '==', userId)
                .get();

            if (profilesQuery.empty) {
                console.log(`[syncUserProfile] No profiles found for user ${userId}`);
                return null;
            }

            // 5. Batch Update
            const batch = db.batch();

            profilesQuery.docs.forEach(doc => {
                batch.update(doc.ref, updates);
            });

            await batch.commit();
            console.log(`[syncUserProfile] Successfully synced ${profilesQuery.size} profiles for user ${userId}`);

            return { success: true, count: profilesQuery.size };

        } catch (error) {
            console.error(`[syncUserProfile] Critical Error syncing user ${userId}:`, error);
            return null;
        }
    });
