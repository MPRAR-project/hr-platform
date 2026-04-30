import { db } from '../../firebase/client';
import { collection, getDocs, writeBatch, doc } from 'firebase/firestore';

/**
 * Migration: Denormalize User Hierarchy (One-time run)
 * 1. Reads all 'assignments'
 * 2. Updates 'users' with 'reportsTo' and 'teamId'
 * 3. Sets 'teamId' = 'reportsTo' for simple hierarchy
 */
export async function migrateHierarchyDenormalization() {
    console.log('Starting Hierarchy Denormalization Migration...');
    const results = {
        scannedAssignments: 0,
        usersUpdated: 0,
        errors: []
    };

    try {
        // 1. Fetch all assignments
        console.log('Fetching assignments...');
        const assignSnap = await getDocs(collection(db, 'assignments'));
        const assignments = assignSnap.docs.map(d => d.data());
        results.scannedAssignments = assignments.length;

        // Map Employee -> Manager
        const employeeToManager = {};
        assignments.forEach(a => {
            const eid = a.employeeId || a.employeeUid;
            const mid = a.managerId || a.managerUid;
            if (eid && mid) {
                // Warning: If multiple assignments exist, last one wins. 
                // In this app, users usually have 1 active manager.
                employeeToManager[eid] = mid;
            }
        });

        // 2. Fetch all users
        console.log('Fetching users...');
        const usersSnap = await getDocs(collection(db, 'users'));
        const users = usersSnap.docs;

        // 3. Prepare Batches
        const batches = [];
        let currentBatch = writeBatch(db);
        let batchCount = 0;

        for (const userDoc of users) {
            const userId = userDoc.id;
            const userData = userDoc.data();
            let needsUpdate = false;
            const updates = {};

            const assignedManager = employeeToManager[userId];

            // Rule 1: specific assignment overrides existing reportsTo? 
            // Or backfill only if missing?
            // Plan: Standardize. If assignment exists, IT is the source of truth.
            if (assignedManager && userData.reportsTo !== assignedManager) {
                updates.reportsTo = assignedManager;
                needsUpdate = true;
            }

            // Rule 2: teamId defaults to reportsTo (Manager's Team)
            // For now, simpler: TeamId = ManagerID
            const targetManager = assignedManager || userData.reportsTo;
            if (targetManager && userData.teamId !== targetManager) {
                updates.teamId = targetManager;
                needsUpdate = true;
            }

            if (needsUpdate) {
                currentBatch.update(doc(db, 'users', userId), updates);
                batchCount++;
                results.usersUpdated++;

                // Commit batch if full
                if (batchCount >= 450) {
                    batches.push(currentBatch.commit());
                    currentBatch = writeBatch(db);
                    batchCount = 0;
                }
            }
        }

        // Commit remaining
        if (batchCount > 0) {
            batches.push(currentBatch.commit());
        }

        await Promise.all(batches);
        console.log('Migration Completed!', results);
        return { success: true, ...results };

    } catch (e) {
        console.error('Migration Failed', e);
        return { success: false, error: e.message };
    }
}
