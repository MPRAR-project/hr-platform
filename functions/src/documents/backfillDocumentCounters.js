const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

/**
 * Callable Function: Backfill Document Counters
 * Purpose: Scans ALL documents and rebuilds the 'counters' collection from scratch.
 * Use Case: Initial migration or "Recalibrate" button if counts get out of sync.
 */
exports.backfillDocumentCounters = functions.runWith({
    timeoutSeconds: 540,
    memory: '1GB'
}).https.onCall(async (data, context) => {

    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Login required');
    }

    const db = admin.firestore();
    const targetCompanyId = data.companyId; // Optional: Run for just one company

    console.log('[backfillDocs] Starting Document Counter Recalibration...');

    try {
        let query = db.collection('documents');
        if (targetCompanyId) {
            query = query.where('companyId', '==', targetCompanyId);
        }

        // 1. Scan Documents
        // 1. Scan Documents
        const docSnap = await query.get();
        console.log(`[backfillDocs] Found ${docSnap.size} documents.`);

        const stats = {};

        // 2. Aggregate Documents
        docSnap.forEach(doc => {
            const data = doc.data();
            const cid = data.companyId;
            if (!cid) return;

            if (!stats[cid]) stats[cid] = { totalDocuments: 0, totalRequests: 0 };

            stats[cid].totalDocuments++;

            if (data.status) {
                const sKey = `status_${data.status}`;
                stats[cid][sKey] = (stats[cid][sKey] || 0) + 1;
            }
        });

        // 3. Scan Requests
        let reqQuery = db.collection('documentRequests');
        if (targetCompanyId) {
            reqQuery = reqQuery.where('companyId', '==', targetCompanyId);
        }

        const reqSnap = await reqQuery.get();
        console.log(`[backfillDocs] Found ${reqSnap.size} requests.`);

        // 4. Aggregate Requests
        reqSnap.forEach(doc => {
            const data = doc.data();
            const cid = data.companyId;
            if (!cid) return;

            if (!stats[cid]) stats[cid] = { totalDocuments: 0, totalRequests: 0 };

            stats[cid].totalRequests++;

            if (data.status) {
                const sKey = `req_status_${data.status}`;
                stats[cid][sKey] = (stats[cid][sKey] || 0) + 1;
            }
        });

        // 3. Write Results
        const batch = db.batch();
        const companies = Object.keys(stats);

        companies.forEach(cid => {
            const ref = db.collection('counters').doc(cid);
            // We use SET here to overwrite any bad data with the absolute truth
            batch.set(ref, {
                ...stats[cid],
                _lastRecalibratedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });

        await batch.commit();

        console.log(`[backfillDocs] Recalibrated counters for ${companies.length} companies.`);
        return {
            success: true,
            documentsScanned: snapshot.size,
            companiesUpdated: companies.length
        };

    } catch (error) {
        console.error('[backfillDocs] Error:', error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});
