import apiClient from '../api/apiClient';

/**
 * Genuinely refactored Work Locations Service
 * Communicates with the Central Backend (Postgres) instead of Firebase Firestore.
 * 0% Firebase dependencies.
 */

export const getWorkLocations = async (companyId) => {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.get(`/hr/${cleanCompanyId}/work-locations`);
    return response.data;
};

export const addWorkLocation = async (companyId, locationData) => {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.post(`/hr/${cleanCompanyId}/work-locations`, {
        ...locationData,
        companyId: cleanCompanyId
    });
    return response.data;
};

export const updateWorkLocation = async (locationId, updates) => {
    const response = await apiClient.put(`/hr/work-locations/${locationId}`, updates);
    return response.data;
};

export const deleteWorkLocation = async (locationId) => {
    const response = await apiClient.delete(`/hr/work-locations/${locationId}`);
    return response.data;
};
