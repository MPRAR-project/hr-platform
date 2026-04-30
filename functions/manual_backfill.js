const admin = require('firebase-admin');

// ------------------------------------------------------------------
// CONFIGURATION
// ------------------------------------------------------------------
// Try to initialize with default credentials (should work if logged in via gcloud or on GCP)
// If this fails, we might need a service account key.
try {
    const serviceAccount = require('../serviceAccountKey.json');
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log('Using serviceAccountKey.json');
} catch (e) {
    console.log('No serviceAccountKey.json found, trying default credentials...');
    admin.initializeApp();
}

const db = admin.firestore();

async function runBackfill() {
    console.log('Starting Backfill of Weekly Summaries...');

    // 1. Get all timesheets
    // Optimized: Select only needed fields
    const snapshot = await db.collection('timesheets')
        .select('userId', 'start', 'end', 'totals', 'status')
        .get();

    console.log(`Found ${snapshot.size} timesheets to process.`);

    if (snapshot.empty) {
        console.log('No timesheets found. Exiting.');
        return;
    }

    const batchSize = 400;
    let batches = [];
    let currentBatch = db.batch();
    let operationCount = 0;
    let processed = 0;

    for (const doc of snapshot.docs) {
        const d = doc.data();
        const { userId, start, end, totals, status } = d;

        // Validation
        if (!userId || !start || !end) {
            console.warn(`Skipping timesheet ${doc.id}: Missing required fields.`);
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

        // Use SET with merge to be idempotent
        currentBatch.set(summaryRef, summaryPayload, { merge: true });

        operationCount++;
        processed++;

        if (operationCount >= batchSize) {
            batches.push(currentBatch.commit());
            console.log(`Committing batch of ${operationCount} records... (Total: ${processed})`);
            currentBatch = db.batch();
            operationCount = 0;
        }
    }

    if (operationCount > 0) {
        batches.push(currentBatch.commit());
        console.log(`Committing final batch of ${operationCount} records...`);
    }

    await Promise.all(batches);
    console.log('------------------------------------------------');
    console.log(`✅ Backfill Complete. Processed ${processed} timesheets.`);
    console.log('------------------------------------------------');
}

runBackfill().catch(console.error);
