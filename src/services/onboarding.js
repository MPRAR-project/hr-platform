import hrApiClient from '../lib/hrApiClient';

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
  try {
    const { data } = await hrApiClient.post('/hr/onboarding', {
      employeeId: userId,
      siteId,
      assignedTo
    });
    return data;
  } catch (error) {
    console.error('Error creating onboarding application:', error);
    throw error;
  }
}

export async function submitOnboardingStep(applicationId, stepNumber, stepData) {
  try {
    // We use the application ID or userId. The backend uses employeeId (which is userId in frontend)
    // For consistency with other HR services, let's assume applicationId passed here is the userId/employeeId
    // If not, we'd need to fetch the application first to get the employeeId.
    // In MPRAR HR, usually applicationId == docId == employeeId for onboarding.
    const { data } = await hrApiClient.post(`/hr/onboarding/${applicationId}/step`, {
      stepNumber,
      stepData
    });
    return data;
  } catch (error) {
    console.error('Error submitting onboarding step:', error);
    throw error;
  }
}

export async function completeOnboardingApplication(applicationId, userId, employmentDetails = {}) {
  try {
    const { data } = await hrApiClient.post(`/hr/onboarding/${userId}/complete`, {
      employmentDetails
    });
    return data;
  } catch (error) {
    console.error('Error completing onboarding application:', error);
    throw error;
  }
}

export async function getOnboardingApplications(filters = {}) {
  try {
    const { data } = await hrApiClient.get('/hr/onboarding', { params: filters });
    return data;
  } catch (error) {
    console.error('Error getting onboarding applications:', error);
    throw error;
  }
}

export async function getOnboardingApplication(applicationId) {
  try {
    const { data } = await hrApiClient.get(`/hr/onboarding/${applicationId}`);
    return data;
  } catch (error) {
    console.error('Error getting onboarding application:', error);
    throw error;
  }
}

export async function getUserOnboardingApplication(userId) {
  try {
    const { data } = await hrApiClient.get(`/hr/onboarding/${userId}`);
    return data;
  } catch (error) {
    if (error.response?.status === 404) return null;
    console.error('Error getting user onboarding application:', error);
    throw error;
  }
}

export async function updateOnboardingStatus(applicationId, status, updatedBy, notes = '') {
  try {
    const { data } = await hrApiClient.put(`/hr/onboarding/${applicationId}`, {
      status,
      statusNotes: notes
    });
    return data;
  } catch (error) {
    console.error('Error updating onboarding status:', error);
    throw error;
  }
}

export async function deleteOnboardingApplication(applicationId) {
  try {
    await hrApiClient.delete(`/hr/onboarding/${applicationId}`);
    return { success: true };
  } catch (error) {
    console.error('Error deleting onboarding application:', error);
    throw error;
  }
}

export async function assignOnboardingManager(applicationId, managerId) {
  try {
    const { data } = await hrApiClient.put(`/hr/onboarding/${applicationId}/assign`, {
      assignedTo: managerId
    });
    return data;
  } catch (error) {
    console.error('Error assigning onboarding manager:', error);
    throw error;
  }
}

export async function getOnboardingStatistics(companyId) {
  try {
    const { data } = await hrApiClient.get('/hr/onboarding/stats');
    return data;
  } catch (error) {
    console.error('Error getting onboarding statistics:', error);
    return { total: 0, pending: 0, completed: 0 };
  }
}
