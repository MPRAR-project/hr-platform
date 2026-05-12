import apiClient from '../api/apiClient';

/**
 * Genuinely refactored Users Service
 * Communicates with the Central Backend (Postgres) instead of Firebase Firestore.
 */

export async function addUsersBySiteManager(companyId, siteId, usersPayload) {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.post(`/hr/${cleanCompanyId}/employees/bulk`, {
        employees: usersPayload.map(u => ({
            ...u,
            siteId
        }))
    });
    return response.data;
}

export async function getUsersByCompany(companyId) {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.get(`/hr/${cleanCompanyId}/employees`);
    return response.data;
}

export async function getUserById(userId) {
    const response = await apiClient.get(`/hr/employees/${userId}`);
    return response.data;
}

export async function setUserStatus(userId, status) {
    const response = await apiClient.post(`/hr/employees`, {
        id: userId,
        status: status.toLowerCase()
    });
    return response.data;
}

export async function archiveUser(userId) {
    const response = await apiClient.delete(`/hr/employees/${userId}`);
    return response.data;
}

export async function syncUserToCentral() {
    // In the new architecture, we are already central, so this is a no-op or returns true
    return true;
}

export async function updateUserEmploymentDetails(userId, details) {
    const response = await apiClient.put(`/hr/employees/${userId}/employment`, details);
    return response.data;
}

export async function updateUserBySiteManager(userId, updates) {
    const response = await apiClient.put(`/hr/employees/${userId}`, updates);
    return response.data;
}

export async function getUserOnboardingDetails(userId) {
    const response = await apiClient.get(`/hr/employees/${userId}/onboarding`);
    return response.data;
}

export async function getUserEmploymentDetails(userId) {
    const response = await apiClient.get(`/hr/employees/${userId}/employment`);
    return response.data;
}

export function subscribeToCompanyUsers(companyId, onUpdate) {
    const interval = setInterval(async () => {
        try {
            const data = await getUsersByCompany(companyId);
            onUpdate(data);
        } catch (e) {}
    }, 30000);
    return () => clearInterval(interval);
}

export async function deleteUser(userId) {
    return await archiveUser(userId);
}

export async function getEmployeeCount(companyId) {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.get(`/hr/${cleanCompanyId}/employees/count`);
    return response.data.count;
}
