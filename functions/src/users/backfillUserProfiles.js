const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

/**
 * Callable Function: Backfill User Profiles
 * Purpose: Iterates ALL users and updates their corresponding userCompanyProfiles with denormalized data.
 * Strategy: Read-All-Users -> Map -> Read-All-Profiles -> Batch Updates.
 * Complexity: O(U + P) - Linear scaling.
 */
exports.backfillUserProfiles = functions.runWith({
    timeoutSeconds: 540, // Max duration
    memory: '1GB'        // Increased memory for Map storage
}).https.onCall(async (data, context) => {

    // 1. Auth Check
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Login required');
    }

    const db = admin.firestore();
    const batchOpsLimit = 500;

    console.log('[backfill] Starting User Profile Denormalization Backfill...');

    try {
        // 2. Fetch ALL Users (Optimization: Only fetch fields we need)
        console.log('[backfill] Fetching Users...');
        const usersSnapshot = await db.collection('users')
            .select('displayName', 'email', 'photoURL', 'employmentDetails')
            .get();

        console.log(`[backfill] Loaded ${usersSnapshot.size} users.`);

        const userMap = new Map();
        usersSnapshot.forEach(doc => {
            const d = doc.data();
            userMap.set(doc.id, {
                displayName: d.displayName || '',
                email: d.email || '',
                photoURL: d.photoURL || null,
                jobTitle: d.employmentDetails?.jobTitle || null
            });
        });

        // 3. Fetch ALL Profiles
        // Note: If this collection is massive (>50k), we should use pagination/streaming.
        // For <10k docs, a single fetch is likely fine ~5-10MB payload.
        console.log('[backfill] Fetching Profiles...');
        const profilesSnapshot = await db.collection('userCompanyProfiles').get();
        console.log(`[backfill] Loaded ${profilesSnapshot.size} profiles.`);

        // 4. Iterate and Batch Update
        let batch = db.batch();
        let opCount = 0;
        let totalUpdated = 0;
        let errors = 0;

        for (const profileDoc of profilesSnapshot.docs) {
            const profileData = profileDoc.data();
            const userId = profileData.userId;

            if (!userId) continue; // Orphaned profile?

            const userInfo = userMap.get(userId);

            // Optimization: Only update if we have user info
            if (userInfo) {
                // Check if update is actually needed? 
                // For backfill, we force it to ensure consistency, or simple strict overwrite.

                batch.update(profileDoc.ref, {
                    displayName: userInfo.displayName,
                    email: userInfo.email,
                    photoURL: userInfo.photoURL,
                    jobTitle: userInfo.jobTitle,
                    _backfilledAt: admin.firestore.FieldValue.serverTimestamp()
                });

                opCount++;

                // Commit batch if full
                if (opCount >= batchOpsLimit) {
                    await batch.commit();
                    totalUpdated += opCount;
                    console.log(`[backfill] Committed batch of ${opCount}. Total: ${totalUpdated}`);
                    batch = db.batch(); // New batch
                    opCount = 0;
                }
            } else {
                // Profile exists but User does not?
                // This indicates broken data constraint. Log it.
                // console.warn(`[backfill] Profile ${profileDoc.id} points to missing user ${userId}`);
                errors++;
            }
        }

        // Commit remaining
        if (opCount > 0) {
            await batch.commit();
            totalUpdated += opCount;
        }

        console.log(`[backfill] Complete. Updated: ${totalUpdated}. Orphaned/Missing User: ${errors}`);

        return {
            success: true,
            usersScanned: usersSnapshot.size,
            profilesScanned: profilesSnapshot.size,
            profilesUpdated: totalUpdated,
            orphanedProfiles: errors
        };

    } catch (error) {
        console.error('[backfill] Fatal Error:', error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});
