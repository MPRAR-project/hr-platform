const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

/**
 * Trigger: When a document is written (create/update/delete)
 * Purpose: updates a centralized counter document for the company.
 * Target Doc: counters/{companyId}
 * Fields: totalDocuments, status_pending, status_approved, status_rejected, etc.
 */
exports.syncDocumentCounters = functions.firestore
    .document('documents/{docId}')
    .onWrite(async (change, context) => {
        const db = admin.firestore();
        const before = change.before.exists ? change.before.data() : null;
        const after = change.after.exists ? change.after.data() : null;

        // Extract Company ID (Required for partitioning)
        const companyId = after ? after.companyId : before.companyId;

        if (!companyId) {
            console.warn(`[syncDocumentCounters] Document ${context.params.docId} missing companyId`);
            return null;
        }

        // We maintain counters at the root 'counters' collection, keyed by CompanyID
        const counterRef = db.collection('counters').doc(companyId);

        const updates = {};
        // Helper: lazily add increment/decrement
        const atomicInc = (amt) => admin.firestore.FieldValue.increment(amt);

        if (!before && after) {
            // CREATE
            updates.totalDocuments = atomicInc(1);
            if (after.status) {
                updates[`status_${after.status}`] = atomicInc(1);
            }
            if (after.type) {
                updates[`type_${after.type}`] = atomicInc(1);
            }
        }
        else if (before && !after) {
            // DELETE
            updates.totalDocuments = atomicInc(-1);
            if (before.status) {
                updates[`status_${before.status}`] = atomicInc(-1);
            }
            if (before.type) {
                updates[`type_${before.type}`] = atomicInc(-1);
            }
        }
        else {
            // UPDATE
            let hasChange = false;

            // Status Change
            if (before.status !== after.status) {
                if (before.status) updates[`status_${before.status}`] = atomicInc(-1);
                if (after.status) updates[`status_${after.status}`] = atomicInc(1);
                hasChange = true;
            }

            // Type Change (Rare, but possible)
            if (before.type !== after.type) {
                if (before.type) updates[`type_${before.type}`] = atomicInc(-1);
                if (after.type) updates[`type_${after.type}`] = atomicInc(1);
                hasChange = true;
            }

            if (!hasChange) return null;
        }

        try {
            // Use set(merge) to ensure document exists
            await counterRef.set(updates, { merge: true });
            // console.log(`[syncDocumentCounters] Updated counters for ${companyId}`);
        } catch (error) {
            console.error(`[syncDocumentCounters] Failed to update counters for ${companyId}:`, error);
        }
    });
