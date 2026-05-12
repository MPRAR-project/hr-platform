import apiClient from '../api/apiClient';

/**
 * Genuinely refactored Onboarding Service
 * Communicates with the Central Backend (Postgres) instead of Firebase Firestore.
 */

export const ONBOARDING_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled'
};

export const ONBOARDING_STEPS = {
  PERSONAL_INFO: 1,
  IDENTIFICATION: 2,
  BANKING: 3,
  HR_INFO: 4,
  POLICIES: 5,
  OPTIONAL_INFO: 6
};

export async function createOnboardingApplication({ userId, companyId, siteId, assignedTo = null }) {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.post(`/hr/${cleanCompanyId}/onboarding`, {
        userId,
        siteId,
        assignedTo
    });
    return response.data;
}

export async function submitOnboardingStep(applicationId, stepNumber, stepData) {
    // We assume the companyId is available in context or we can use a generic route
    const response = await apiClient.post(`/hr/onboarding/${applicationId}/step`, {
        stepNumber,
        stepData
    });
    return response.data;
}

export async function completeOnboardingApplication(applicationId, userId) {
    const response = await apiClient.post(`/hr/onboarding/${applicationId}/complete`);
    return response.data;
}

export async function getOnboardingApplications({ companyId, status = null, assignedTo = null }) {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.get(`/hr/${cleanCompanyId}/onboarding`, {
        params: { status, assignedTo }
    });
    return {
        applications: response.data,
        hasMore: false,
        lastDoc: null
    };
}

export async function getOnboardingApplication(applicationId) {
    const response = await apiClient.get(`/hr/onboarding/${applicationId}`);
    return response.data;
}

export async function getUserOnboardingApplication(userId) {
    // We need companyId for this route in our current structure, 
    // but we can also have a generic one if we want.
    // For now, assume we can fetch by userId from a generic endpoint
    const response = await apiClient.get(`/hr/onboarding/user/${userId}`);
    return response.data;
}

export async function updateOnboardingStatus(applicationId, status, notes = '') {
    const response = await apiClient.post(`/hr/onboarding/${applicationId}/status`, { status, notes });
    return response.data;
}

export async function assignOnboardingManager(applicationId, managerId) {
    const response = await apiClient.post(`/hr/onboarding/${applicationId}/assign`, { managerId });
    return response.data;
}

export async function getOnboardingStatistics(companyId) {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.get(`/hr/${cleanCompanyId}/onboarding/stats`);
    return response.data;
}
