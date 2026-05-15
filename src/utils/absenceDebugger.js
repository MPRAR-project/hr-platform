/**
 * Absence Debugger Utility
 * Helps identify and fix incorrect absence data
 */

import { absenceService } from '../services/absenceService';

/**
 * Get all approved absences for a user
 */
export async function getUserApprovedAbsences(userId) {
    const absences = await absenceService.getEmployeeAbsencesById(userId, { role: 'admin' });
    return absences.filter(a => a.status === 'Approved');
}

/**
 * Find absences for specific dates
 */
export async function findAbsencesForDates(userId, dates) {
    const allAbsences = await getUserApprovedAbsences(userId);
    const matchingAbsences = [];
    
    dates.forEach(targetDate => {
        const target = new Date(targetDate);
        
        allAbsences.forEach(absence => {
            const startDate = new Date(absence.startDate);
            const endDate = new Date(absence.endDate);
            
            if (target >= startDate && target <= endDate) {
                matchingAbsences.push({
                    ...absence,
                    coversDate: targetDate
                });
            }
        });
    });
    
    return matchingAbsences;
}

/**
 * Update absence status
 */
export async function updateAbsenceStatus(absenceId, newStatus) {
    await absenceService.updateAbsence(absenceId, { status: newStatus }, { role: 'admin' });
    console.log(`Updated absence ${absenceId} status to ${newStatus}`);
}

/**
 * Debug specific user's absences for March 9-11, 2026
 */
export async function debugMarchAbsences(userId) {
    console.log(`=== DEBUGGING ABSENCES FOR USER ${userId} ===`);
    
    const targetDates = ['2026-03-09', '2026-03-10', '2026-03-11'];
    const matchingAbsences = await findAbsencesForDates(userId, targetDates);
    
    console.log(`Found ${matchingAbsences.length} absences covering March 9-11:`);
    
    matchingAbsences.forEach(absence => {
        console.log('\n--- ABSENCE ---');
        console.log('ID:', absence.id);
        console.log('Leave Type:', absence.leaveType);
        console.log('Status:', absence.status);
        console.log('Start Date:', absence.startDate);
        console.log('End Date:', absence.endDate);
        console.log('Covers Date:', absence.coversDate);
        console.log('Reason:', absence.reason || 'No reason');
    });
    
    return matchingAbsences;
}
