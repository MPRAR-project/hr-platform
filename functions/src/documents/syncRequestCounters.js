const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

/**
 * Trigger: documentRequests/{requestId}
 * Purpose: Update counters for requests (Pending, etc)
 */
exports.syncRequestCounters = functions.firestore
    .document('documentRequests/{requestId}')
    .onWrite(async (change, context) => {
        const db = admin.firestore();
        const before = change.before.exists ? change.before.data() : null;
        const after = change.after.exists ? change.after.data() : null;

        const companyId = after ? after.companyId : before.companyId;
        if (!companyId) return;

        const counterRef = db.collection('counters').doc(companyId);
        const updates = {};
        const atomicInc = (amt) => admin.firestore.FieldValue.increment(amt);

        if (!before && after) {
            // CREATE
            updates.totalRequests = atomicInc(1);
            if (after.status) updates[`req_status_${after.status}`] = atomicInc(1);
        }
        else if (before && !after) {
            // DELETE
            updates.totalRequests = atomicInc(-1);
            if (before.status) updates[`req_status_${before.status}`] = atomicInc(-1);
        }
        else {
            // UPDATE
            if (before.status !== after.status) {
                updates[`req_status_${before.status}`] = atomicInc(-1);
                updates[`req_status_${after.status}`] = atomicInc(1);
            }
        }

        if (Object.keys(updates).length > 0) {
            try {
                await counterRef.set(updates, { merge: true });
            } catch (e) {
                console.error('Error syncing request counters:', e);
            }
        }
    });
