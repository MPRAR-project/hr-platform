import apiClient from '../api/apiClient';

/**
 * Genuinely refactored Sites Service
 * Communicates with the Central Backend (Postgres) instead of Firebase Firestore.
 */

export const getSites = async (companyId) => {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.get(`/hr/${cleanCompanyId}/sites`);
    return response.data;
};

export const getSite = async (siteId) => {
    const response = await apiClient.get(`/hr/sites/${siteId}`);
    return response.data;
};

export const addSite = async (companyId, siteData) => {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.post(`/hr/${cleanCompanyId}/sites`, siteData);
    return response.data;
};

export const updateSite = async (siteId, updates) => {
    const response = await apiClient.put(`/hr/sites/${siteId}`, updates);
    return response.data;
};

export const deleteSite = async (siteId) => {
    const response = await apiClient.delete(`/hr/sites/${siteId}`);
    return response.data;
};

// ... more refactored methods as needed
