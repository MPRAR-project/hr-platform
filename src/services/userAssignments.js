import hrApiClient from '../lib/hrApiClient';

/**
 * User Assignments Service (Phase 4 — REST Migration)
 * 
 * Manages history of user-client assignments via HR REST API.
 */

/**
 * Create a new user-client assignment
 */
export async function createAssignment(assignmentData) {
    try {
        const { data } = await hrApiClient.post('/hr/assignments', assignmentData);
        return data;
    } catch (error) {
        console.error('[userAssignments] Error creating assignment:', error);
        throw error;
    }
}

/**
 * Get active assignment for a user on a specific date
 * NOTE: REST API handles date filtering if needed.
 */
export async function getActiveAssignment(userId, date = new Date()) {
    try {
        const { data } = await hrApiClient.get('/hr/assignments', {
            params: { 
                employeeId: userId, 
                status: 'active' 
            }
        });
        
        // Find the one that covers the target date
        const target = date instanceof Date ? date : new Date(date);
        return data.find(a => {
            const start = new Date(a.startDate);
            const end = a.endDate ? new Date(a.endDate) : new Date(8640000000000000); // Max date
            return target >= start && target <= end;
        }) || null;
    } catch (error) {
        console.error('[userAssignments] Error getting active assignment:', error);
        throw error;
    }
}

/**
 * Get all active assignments for a user (optionally filtered by site)
 */
export async function getActiveAssignments(userId, siteId = null) {
    try {
        const { data } = await hrApiClient.get('/hr/assignments', {
            params: { employeeId: userId, siteId, status: 'active' }
        });
        return data || [];
    } catch (error) {
        console.error('[userAssignments] Error getting active assignments:', error);
        throw error;
    }
}

/**
 * Get all assignments for a user
 */
export async function getUserAssignments(userId) {
    try {
        const { data } = await hrApiClient.get('/hr/assignments', {
            params: { employeeId: userId }
        });
        return data || [];
    } catch (error) {
        console.error('[userAssignments] Error getting user assignments:', error);
        throw error;
    }
}

/**
 * Get all assignments for a client
 */
export async function getClientAssignments(clientId, status = null) {
    try {
        const { data } = await hrApiClient.get('/hr/assignments', {
            params: { clientId, status }
        });
        return data || [];
    } catch (error) {
        console.error('[userAssignments] Error getting client assignments:', error);
        throw error;
    }
}

/**
 * End an assignment
 */
export async function endAssignment(assignmentId, endDate = new Date()) {
    try {
        const { data } = await hrApiClient.put(`/hr/assignments/${assignmentId}/end`, { endDate });
        return data;
    } catch (error) {
        console.error('[userAssignments] Error ending assignment:', error);
        throw error;
    }
}

/**
 * Update assignment rates
 */
export async function updateAssignmentRates(assignmentId, rates) {
    try {
        const { data } = await hrApiClient.put(`/hr/assignments/${assignmentId}/rates`, rates);
        return data;
    } catch (error) {
        console.error('[userAssignments] Error updating assignment rates:', error);
        throw error;
    }
}

/**
 * Get assignment by ID
 */
export async function getAssignmentById(assignmentId) {
    try {
        const { data } = await hrApiClient.get('/hr/assignments', { params: { id: assignmentId } });
        return data[0] || null;
    } catch (error) {
        console.error('[userAssignments] Error getting assignment:', error);
        throw error;
    }
}
