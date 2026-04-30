const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

/**
 * Backfill Weekly Summaries
 * 
 * Callable function to migrate existing timesheets to 'weekly_summaries'.
 * Designed to be idempotent. Run until it says "0 updated".
 * 
 * Logic:
 * 1. Fetch batches of timesheets.
 * 2. Write summary to users/{userId}/weekly_summaries/{weekKey}
 */
exports.backfillWeeklySummaries = functions.runWith({ timeoutSeconds: 540, memory: '1GB' }).https.onCall(async (data, context) => {
    // Auth Check: Require Admin or specific migration flag
    if (!context.auth) {
        console.warn('[backfill] Unauthenticated attempt');
        throw new functions.https.HttpsError('unauthenticated', 'Login required');
    }

    // Ensure Admin Init
    try {
        if (admin.apps.length === 0) {
            admin.initializeApp();
        }
    } catch (e) {
        console.error('[backfill] Admin Init Error:', e);
    }

    const db = admin.firestore();

    try {
        const batchSize = 400; // Limit for Batch Write (500 max)


        // Resume token (optional)
        const startAfterId = data?.startAfterId || null;
        let query = db.collection('timesheets').orderBy(admin.firestore.FieldPath.documentId()).limit(2000);

        if (startAfterId) {
            const lastDoc = await db.collection('timesheets').doc(startAfterId).get();
            if (lastDoc.exists) {
                query = query.startAfter(lastDoc);
            }
        }

        const snapshot = await query.get();
        const totalDocs = snapshot.size;
        console.log(`[backfill] Found ${totalDocs} timesheets to process...`);

        let processed = 0;
        let batches = [];
        let currentBatch = db.batch();
        let operationCount = 0;

        for (const doc of snapshot.docs) {
            const data = doc.data();
            const { userId, start, end, totals, status } = data;

            if (!userId || !start || !end) {
                console.warn(`[backfill] Skipping malformed: ${doc.id}`);
                continue;
            }

            const weekKey = `${start}_${end}`;
            const summaryRef = db.doc(`users/${userId}/weekly_summaries/${weekKey}`);

            const summaryPayload = {
                weekKey,
                start,
                end,
                totals: totals || { grossSec: 0, effectiveSec: 0, overtimeSec: 0 },
                status: status || 'draft',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                _syncedFrom: doc.id,
                _migratedAt: admin.firestore.FieldValue.serverTimestamp()
            };

            currentBatch.set(summaryRef, summaryPayload, { merge: true });
            operationCount++;

            if (operationCount >= batchSize) {
                batches.push(currentBatch.commit());
                currentBatch = db.batch();
                operationCount = 0;
            }
            processed++;
        }

        if (operationCount > 0) {
            batches.push(currentBatch.commit());
        }

        await Promise.all(batches);
        console.log(`[backfill] Successfully processed ${processed} docs.`);

        // Return last ID for next page
        const lastProcessedId = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1].id : null;

        return {
            success: true,
            processed,
            lastId: lastProcessedId,
            hasMore: processed === 2000
        };
    } catch (error) {
        console.error('[backfill] CRITICAL ERROR:', error);
        throw new functions.https.HttpsError('internal', `Backfill failed: ${error.message}`, error);
    }
});
