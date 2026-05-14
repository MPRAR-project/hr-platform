import hrApiClient from '../lib/hrApiClient';

/**
 * Onboarding Policy Service (Phase 4 — REST Migration)
 * 
 * Replaces Firestore logic with HR REST API calls.
 */

/**
 * Add a company onboarding policy
 */
export async function addCompanyOnboardingPolicy({
  companyId,
  title,
  description = '',
  category = 'policy',
  isRequired = false,
  file,
  uploadedBy
}) {
  if (!file) throw new Error('File is required');
  if (!title) throw new Error('Title is required');

  // 1. Upload the file first
  const formData = new FormData();
  formData.append('file', file);
  const { data: uploadRes } = await hrApiClient.post('/hr/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });

  // 2. Create the policy record
  const { data } = await hrApiClient.post('/hr/onboarding-policies', {
    title,
    description,
    category,
    isRequired,
    fileName: uploadRes.fileName,
    fileKey: uploadRes.fileKey,
    fileUrl: uploadRes.url,
    uploadedBy,
    status: 'active',
    steps: [] // Policies can have associated steps if needed
  });

  return { 
    id: data.id, 
    ...data, 
    downloadURL: data.fileUrl // Maintain backward compatibility with UI
  };
}

/**
 * Get all active company onboarding policies
 */
export async function getCompanyOnboardingPolicies(companyId) {
  try {
    const { data } = await hrApiClient.get('/hr/onboarding-policies');
    
    // Normalize data for UI compatibility
    return (data || []).map(policy => ({
      ...policy,
      downloadURL: policy.fileUrl,
      createdAt: policy.createdAt ? { toDate: () => new Date(policy.createdAt) } : null
    }));
  } catch (error) {
    console.error('[onboardingPolicyService] Error getting policies:', error);
    throw error;
  }
}

/**
 * Soft-delete a company onboarding policy
 */
export async function deleteCompanyOnboardingPolicy(policyId) {
  if (!policyId) throw new Error('Policy ID is required');

  try {
    await hrApiClient.delete(`/hr/onboarding-policies/${policyId}`);
    return { success: true };
  } catch (error) {
    console.error('[onboardingPolicyService] Error deleting policy:', error);
    throw error;
  }
}
