import hrApiClient from '../lib/hrApiClient';

export async function createHROnboardingProfile({ userId, companyId, siteId, createdBy }) {
    try {
        const { data } = await hrApiClient.post('/hr/onboarding', {
            employeeId: userId,
            siteId,
            assignedTo: createdBy
        });
        return data;
    } catch (error) {
        console.error('[hrOnboarding] Error creating profile:', error);
        throw error;
    }
}

export async function getHROnboardingProfile(userId) {
    try {
        const { data } = await hrApiClient.get(`/hr/onboarding/${userId}`);
        return data;
    } catch (error) {
        if (error.response?.status === 404) return null;
        console.error('[hrOnboarding] Error getting profile:', error);
        throw error;
    }
}

export async function getHROnboardingProfiles(filters = {}) {
    try {
        const { data } = await hrApiClient.get('/hr/onboarding', { params: filters });
        return data;
    } catch (error) {
        console.error('[hrOnboarding] Error getting profiles:', error);
        throw error;
    }
}

export async function updateHROnboardingSection({ profileId, section, data, updatedBy }) {
    try {
        // In the new backend, we use the employeeId (profileId) and the step endpoint or update endpoint
        // For simplicity, we can use a generic update if the backend supports it, 
        // or map these sections to steps.
        // Let's assume the backend 'update' endpoint handles partial formData updates.
        const { data: result } = await hrApiClient.put(`/hr/onboarding/${profileId}`, {
            [`sections.${section}`]: data,
            updatedBy
        });
        return result;
    } catch (error) {
        console.error('[hrOnboarding] Error updating section:', error);
        throw error;
    }
}

export function calculateCompletionPercent(profile) {
    if (!profile || !profile.sections) return 0;
    const sections = profile.sections;
    let totalWeight = 0;
    let completedWeight = 0;

    // Logic kept for UI calculations
    totalWeight += 25; if (sections.personalInfo?.status === 'completed') completedWeight += 25;
    totalWeight += 25; if (sections.employmentDetails?.status === 'completed') completedWeight += 25;
    totalWeight += 25; if (sections.contractDocuments?.status === 'completed') completedWeight += 25;
    totalWeight += 25; if (sections.allowances?.status === 'completed') completedWeight += 25;

    return Math.round((completedWeight / totalWeight) * 100);
}

export async function completeHROnboarding(profileId, completedBy) {
    try {
        const { data } = await hrApiClient.post(`/hr/onboarding/${profileId}/complete`, {
            updatedBy: completedBy
        });
        return data;
    } catch (error) {
        console.error('[hrOnboarding] Error completing onboarding:', error);
        throw error;
    }
}

export async function syncPersonalInfoToHRProfile(userId, personalInfoData) {
    try {
        // Backend now handles cross-service sync in the complete/update methods
        const { data } = await hrApiClient.post(`/hr/onboarding/${userId}/step`, {
            stepNumber: 1, // personalInfo is usually step 1
            stepData: personalInfoData
        });
        return { success: true, data };
    } catch (error) {
        console.error('[hrOnboarding] Error syncing personal info:', error);
        return { success: false, error: error.message };
    }
}
