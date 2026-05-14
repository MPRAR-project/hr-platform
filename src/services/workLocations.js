import hrApiClient from '../lib/hrApiClient';

/**
 * Get all work locations for a company
 * @param {string} companyId - Company ID (preserved for signature compat)
 * @returns {Promise<Array>} List of locations
 */
export const getWorkLocations = async (companyId) => {
    try {
        const { data } = await hrApiClient.get('/hr/sites');
        // The backend returns an array directly based on the user's company context
        return Array.isArray(data) ? data : (data.sites || []);
    } catch (error) {
        console.error('Error fetching work locations:', error);
        throw error;
    }
};

/**
 * Add a new work location
 * @param {string} companyId - Company ID
 * @param {Object} locationData - Location details (name, address, latitude, longitude, radius)
 * @returns {Promise<Object>} Created location with ID
 */
export const addWorkLocation = async (companyId, locationData) => {
    try {
        const { data } = await hrApiClient.post('/hr/sites', {
            name: locationData.name,
            address: locationData.address || null,
            latitude: locationData.latitude || null,
            longitude: locationData.longitude || null,
            radius: locationData.radius || null,
            notes: locationData.notes || null,
            parentSiteId: locationData.parentSiteId || null
        });
        return data;
    } catch (error) {
        console.error('Error adding work location:', error);
        throw error;
    }
};

/**
 * Update a work location
 * @param {string} locationId - Location ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<void>}
 */
export const updateWorkLocation = async (locationId, updates) => {
    try {
        await hrApiClient.put(`/hr/sites/${locationId}`, updates);
    } catch (error) {
        console.error('Error updating work location:', error);
        throw error;
    }
};

/**
 * Delete a work location
 * @param {string} locationId - Location ID
 * @returns {Promise<void>}
 */
export const deleteWorkLocation = async (locationId) => {
    try {
        await hrApiClient.delete(`/hr/sites/${locationId}`);
    } catch (error) {
        console.error('Error deleting work location:', error);
        throw error;
    }
};
