import hrApiClient from '../lib/hrApiClient';

/**
 * Assignment Service (Phase 4 — REST Migration)
 */

export async function getUserAssignments(userId) {
  try {
    const { data } = await hrApiClient.get('/hr/assignments', {
      params: { userId },
    });
    return data.assignments || data || [];
  } catch (error) {
    console.error('[assignmentService] Error fetching assignments:', error);
    return [];
  }
}

export async function updateAssignmentRates(userId, rates) {
  try {
    const { data } = await hrApiClient.post(`/hr/assignments/user/${userId}/rates`, rates);
    return data;
  } catch (error) {
    console.error('[assignmentService] Error updating assignment rates:', error);
    throw error;
  }
}

const assignmentService = {
  getUserAssignments,
  updateAssignmentRates,
};

export default assignmentService;
