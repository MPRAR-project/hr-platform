/**
 * Migration Script: Fix All Assignments with Zero Rates
 * 
 * This script finds all assignments with chargeRate=0 and updates them
 * with the correct rates from the user's profile.
 * 
 * Run this ONCE to fix all existing assignments.
 */

import { db } from '../firebase';
import { collection, getDocs, doc, updateDoc, getDoc } from 'firebase/firestore';

export async function fixZeroRateAssignments() {
    console.log('🔧 Starting migration: Fix zero-rate assignments...');

    try {
        // Get all assignments
        const assignmentsRef = collection(db, 'userAssignments');
        const assignmentsSnap = await getDocs(assignmentsRef);

        let totalAssignments = 0;
        let fixedAssignments = 0;
        let skippedAssignments = 0;
        let errors = 0;

        for (const assignmentDoc of assignmentsSnap.docs) {
            totalAssignments++;
            const assignment = assignmentDoc.data();

            // Skip if already has rates
            if (assignment.chargeRate > 0) {
                console.log(`✓ Assignment ${assignmentDoc.id} already has rates, skipping`);
                skippedAssignments++;
                continue;
            }

            console.log(`🔍 Found zero-rate assignment ${assignmentDoc.id} for user ${assignment.userId}`);

            try {
                // Get user document to fetch rates
                const userRef = doc(db, 'users', assignment.userId);
                const userSnap = await getDoc(userRef);

                if (!userSnap.exists()) {
                    console.error(`✗ User ${assignment.userId} not found, skipping assignment ${assignmentDoc.id}`);
                    errors++;
                    continue;
                }

                const userData = userSnap.data();

                // Get rates - support BOTH field formats
                const chargeRate = Number(userData.rates?.chargeBackBasic)
                    || Number(userData.rates?.standardChargeRate)
                    || 0;
                const overtimeChargeRate = Number(userData.rates?.chargeBackOvertime)
                    || Number(userData.rates?.overtimeChargeRate)
                    || 0;

                if (chargeRate === 0) {
                    console.warn(`⚠️ User ${assignment.userId} has no rates set, skipping assignment ${assignmentDoc.id}`);
                    skippedAssignments++;
                    continue;
                }

                // Update assignment with correct rates
                await updateDoc(doc(db, 'userAssignments', assignmentDoc.id), {
                    chargeRate,
                    overtimeChargeRate,
                    updatedAt: new Date()
                });

                console.log(`✅ Fixed assignment ${assignmentDoc.id}: ${chargeRate}/${overtimeChargeRate}`);
                fixedAssignments++;

            } catch (error) {
                console.error(`✗ Error fixing assignment ${assignmentDoc.id}:`, error);
                errors++;
            }
        }

        console.log('\n📊 Migration Summary:');
        console.log(`   Total assignments: ${totalAssignments}`);
        console.log(`   ✅ Fixed: ${fixedAssignments}`);
        console.log(`   ⏭️  Skipped: ${skippedAssignments}`);
        console.log(`   ✗ Errors: ${errors}`);
        console.log('\n✨ Migration complete!');

        return {
            success: true,
            total: totalAssignments,
            fixed: fixedAssignments,
            skipped: skippedAssignments,
            errors
        };

    } catch (error) {
        console.error('❌ Migration failed:', error);
        return {
            success: false,
            error: error.message
        };
    }
}
