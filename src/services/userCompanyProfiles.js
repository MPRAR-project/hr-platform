import hrApiClient from '../lib/hrApiClient';

/**
 * User Company Profile Service (REST Migration)
 * In the new architecture, a "company profile" is simply an employee record 
 * within the scoped company of the HR API.
 */

/**
 * Create a new company profile for a user
 * @param {string} userId - Firebase Auth user ID (Central User ID)
 * @param {string} companyId - Company ID
 * @param {Object} profileData - Profile data (role, siteId, etc.)
 * @returns {Promise<Object>} Created profile
 */
export async function createUserCompanyProfile(userId, companyId, profileData = {}) {
    try {
        const { data } = await hrApiClient.post('/hr/employees', {
            centralUserId: userId,
            ...profileData
        });
        return data;
    } catch (error) {
        console.error('Error creating user company profile:', error);
        throw error;
    }
}

/**
 * Get all company profiles for a user
 * @param {string} userId - Central User ID
 * @returns {Promise<Array>} Array of company profiles (scoped to current company)
 */
export async function getUserCompanyProfiles(userId) {
    try {
        // In HR REST, we only see the profile for the current company context
        const { data } = await hrApiClient.get('/hr/employees/me');
        return data ? [data] : [];
    } catch (error) {
        console.error('Error fetching user company profiles:', error);
        return [];
    }
}

/**
 * Get company profile for a user at a specific company
 */
export async function getCompanyProfile(userId, companyId) {
    try {
        const { data } = await hrApiClient.get('/hr/employees/me');
        return data || null;
    } catch (error) {
        return null;
    }
}

/**
 * Get active company profile
 */
export async function getActiveCompanyProfile(userId, companyId) {
    const profile = await getCompanyProfile(userId, companyId);
    return profile?.status === 'active' ? profile : null;
}

/**
 * Get all users for a company
 */
export async function getUsersByCompanyProfile(companyId, status = 'active') {
    try {
        const { data } = await hrApiClient.get('/hr/employees', {
            params: { status: status === 'all' ? undefined : status }
        });
        return data.employees || [];
    } catch (error) {
        console.error('Error fetching users by company profile:', error);
        throw error;
    }
}

/**
 * Archive a user's company profile
 */
export async function archiveCompanyProfile(userId, companyId) {
    try {
        // We need the employee ID, which might not be the central userId
        // First get the profile to find the local ID
        const profile = await getCompanyProfile(userId, companyId);
        if (!profile) throw new Error('Profile not found');

        const { data } = await hrApiClient.delete(`/hr/employees/${profile.id}`);
        return data;
    } catch (error) {
        console.error('Error archiving company profile:', error);
        throw error;
    }
}

/**
 * Unarchive (reactivate) a user's company profile
 */
export async function unarchiveCompanyProfile(userId, companyId) {
    try {
        const profile = await getCompanyProfile(userId, companyId);
        if (!profile) throw new Error('Profile not found');

        const { data } = await hrApiClient.put(`/hr/employees/${profile.id}`, {
            status: 'active'
        });
        return data;
    } catch (error) {
        console.error('Error unarchiving company profile:', error);
        throw error;
    }
}

/**
 * Check if a user has any profile
 */
export async function hasCompanyProfile(userId, companyId) {
    return await getCompanyProfile(userId, companyId);
}
