const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

/**
 * Aggregates timesheet statistics for a company's week.
 * Updates `companies/{companyId}/weeklyStats/{weekStartDate}`
 * Maintains counters: total, pending, approved, rejected.
 * 
 * Scalability Note: 
 * Uses FieldValue.increment to minimize race conditions.
 * For truly massive scale (100k+ users/company), this should be a scheduled task
 * or use DistributedCounter logic. For now, this covers the 99% case.
 */
exports.aggregateWeeklyStats = functions.firestore
    .document('timesheets/{timesheetId}')
    .onWrite(async (change, context) => {
        const db = admin.firestore();
        const newData = change.after.exists ? change.after.data() : null;
        const oldData = change.before.exists ? change.before.data() : null;

        if (!newData && !oldData) return null;

        // Determine Company and Week
        // Use newData if available, otherwise oldData (deletion)
        const data = newData || oldData;
        const { companyId, weekStartDate } = data;

        if (!companyId || !weekStartDate) {
            console.warn(`[aggregateWeeklyStats] Missing companyId or weekStartDate for ${context.params.timesheetId}`);
            return null;
        }

        // Clean companyId (handle 'companies/123' vs '123')
        const rawCompanyId = companyId.replace('companies/', '');
        const statsRef = db.collection('companies').doc(rawCompanyId).collection('weeklyStats').doc(weekStartDate);

        const batch = db.batch();
        const updates = {};
        let needsUpdate = false;

        // Helper to get status delta
        // status: 'draft' | 'pending' | 'approved' | 'rejected'
        const getStatus = (d) => d ? (d.status || 'draft') : null;
        const newStatus = getStatus(newData);
        const oldStatus = getStatus(oldData);

        // Case 1: New Document
        if (!oldData && newData) {
            updates[`count_${newStatus}`] = admin.firestore.FieldValue.increment(1);
            updates.total = admin.firestore.FieldValue.increment(1);
            needsUpdate = true;
        }
        // Case 2: Deleted Document
        else if (oldData && !newData) {
            updates[`count_${oldStatus}`] = admin.firestore.FieldValue.increment(-1);
            updates.total = admin.firestore.FieldValue.increment(-1);
            needsUpdate = true;
        }
        // Case 3: Updated Document (Status Change)
        else if (newStatus !== oldStatus) {
            updates[`count_${oldStatus}`] = admin.firestore.FieldValue.increment(-1);
            updates[`count_${newStatus}`] = admin.firestore.FieldValue.increment(1);
            needsUpdate = true;
        }

        if (needsUpdate) {
            // Ensure metadata exists
            updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

            // We use set with merge to create if not exists, but increment works with update too?
            // Safer to use set({ ...updates }, { merge: true }) for the increments? 
            // Firestore set with merge handles increments correctly.

            await statsRef.set(updates, { merge: true });
        }
    });
