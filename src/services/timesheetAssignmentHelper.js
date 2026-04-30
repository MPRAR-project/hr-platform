import { getActiveAssignment } from './userAssignments';

/**
 * Helper to auto-assign assignment info to timesheet entries
 * @param {string} userId - User ID
 * @param {string} entryDate - Entry date (YYYY-MM-DD)
 * @returns {Promise<Object>} Assignment info {assignmentId, clientId} or nulls
 */
export async function getAssignmentForTimesheetEntry(userId, entryDate) {
    try {
        const entryDateObj = new Date(entryDate);
        const assignment = await getActiveAssignment(userId, entryDateObj);

        if (assignment) {
            return {
                assignmentId: assignment.id,
                clientId: assignment.clientId,
                chargeRate: assignment.chargeRate,
                overtimeChargeRate: assignment.overtimeChargeRate
            };
        }

        // No active assignment found
        console.warn(`[getAssignmentForTimesheetEntry] No active assignment found for user ${userId} on ${entryDate}`);
        return {
            assignmentId: null,
            clientId: null,
            chargeRate: null,
            overtimeChargeRate: null
        };
    } catch (error) {
        console.error('[getAssignmentForTimesheetEntry] Error:', error);
        return {
            assignmentId: null,
            clientId: null,
            chargeRate: null,
            overtimeChargeRate: null
        };
    }
}
