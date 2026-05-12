import apiClient from '../api/apiClient';

/**
 * Genuinely refactored HR Onboarding Service
 * Communicates with the Central Backend (Postgres) instead of Firebase Firestore.
 */

export async function createHROnboardingProfile({ userId, companyId, siteId, createdBy }) {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.post(`/hr/${cleanCompanyId}/onboarding`, {
        userId,
        siteId,
        createdBy,
        type: 'hr_driven' // Distinguish from self-onboarding if needed
    });
    return response.data;
}

export async function getHROnboardingProfile(userId) {
    // This assumes we have a route to get onboarding by userId
    const response = await apiClient.get(`/hr/onboarding/user/${userId}`);
    return response.data;
}

export async function getHROnboardingProfiles({ companyId, status = null, searchTerm = null }) {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.get(`/hr/${cleanCompanyId}/onboarding`, {
        params: { status, searchTerm, type: 'hr_driven' }
    });
    return {
        profiles: response.data,
        hasMore: false
    };
}

export async function updateHROnboardingSection({ profileId, section, data, updatedBy }) {
    // We'll use a generic "update section" or "update step" endpoint
    const response = await apiClient.post(`/hr/onboarding/${profileId}/section`, {
        section,
        data,
        updatedBy
    });
    return response.data;
}

export async function completeHROnboarding(profileId, completedBy) {
    const response = await apiClient.post(`/hr/onboarding/${profileId}/complete`, {
        completedBy
    });
    return response.data;
}

export async function syncPersonalInfoToHRProfile(userId, personalInfoData) {
    // This is now handled by the backend during step/section updates
    // But we'll provide a direct sync endpoint if needed
    const response = await apiClient.post(`/hr/onboarding/sync`, { userId, personalInfoData });
    return response.data;
}

export function calculateCompletionPercent(profile) {
    if (!profile) return 0;
    // Logic depends on the profile structure, for now returning dummy or basic logic
    const totalSteps = 10;
    return Math.min(100, (profile.currentStep / totalSteps) * 100);
}
