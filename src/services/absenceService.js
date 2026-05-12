import apiClient from '../api/apiClient';

/**
 * Genuinely refactored Absence Service
 * Communicates with the Central Backend (Postgres) instead of Firebase Firestore.
 */

export async function getAbsences(companyId, userId = null) {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.get(`/hr/${cleanCompanyId}/absences`, {
        params: { userId }
    });
    return response.data;
}

export async function getAbsenceById(id) {
    const response = await apiClient.get(`/hr/absences/${id}`);
    return response.data;
}

export async function createAbsence(companyId, data) {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.post(`/hr/${cleanCompanyId}/absences`, data);
    return response.data;
}

export async function updateAbsence(id, data) {
    const response = await apiClient.post(`/hr/absences`, { id, ...data });
    return response.data;
}

export async function deleteAbsence(id) {
    const response = await apiClient.delete(`/hr/absences/${id}`);
    return response.data;
}

export async function getLeaveTypes(companyId) {
    // Leave types can be fetched via a dedicated endpoint or generic
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.get(`/hr/${cleanCompanyId}/leave-types`);
    return response.data;
}

export const absenceService = {
    getAbsences,
    getAbsenceById,
    createAbsence,
    updateAbsence,
    deleteAbsence,
    getLeaveTypes
};

export default absenceService;