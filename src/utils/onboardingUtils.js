import hrApiClient from '../lib/hrApiClient';

/**
 * Onboarding Utilities - Centralized logic for onboarding operations
 * Handles role-based exemptions, company settings, and validation
 */

// Roles that are exempt from onboarding requirements
const EXEMPT_ROLES = ['siteManager', 'superUser'];

/**
 * Check if a user role is exempt from onboarding requirements
 * @param {string} userRole - The user's primary role
 * @returns {boolean} True if the role is exempt from onboarding
 */
export function isRoleExemptFromOnboarding(userRole) {
  if (!userRole || typeof userRole !== 'string') {
    return false;
  }
  return EXEMPT_ROLES.includes(userRole);
}

/**
 * Get company onboarding settings with error handling and fallbacks
 * @param {string} companyId - The company ID (without 'companies/' prefix)
 * @returns {Promise<Object>} Company onboarding settings
 */
export async function getCompanyOnboardingSettings(companyId) {
  try {
    if (!companyId) {
      throw new Error('Company ID is required');
    }

    // Handle both formats: 'companies/id' and just 'id'
    const cleanCompanyId = companyId.replace('companies/', '');
    
    // Use REST API instead of direct Firestore
    const { data: companyData } = await hrApiClient.get(`/hr/companies/${cleanCompanyId}`);

    if (!companyData) {
      console.warn(`Company data not found for ID: ${cleanCompanyId}`);
      return {
        isOnboardingMandatory: false,
        exists: false
      };
    }

    // Handle both old and new field names for backward compatibility
    const isOnboardingMandatory = 
      companyData.isOnboardingMandatory ?? 
      companyData.isOnbordingManadatory ?? 
      false;

    return {
      isOnboardingMandatory,
      exists: true,
      ...companyData
    };
  } catch (error) {
    console.error('Error fetching company onboarding settings:', error);
    // Return safe defaults on error
    return {
      isOnboardingMandatory: false,
      exists: false,
      error: error.message
    };
  }
}

/**
 * Check if a user should be required to complete onboarding
 * @param {Object} user - User object with role and onboarding status
 * @param {Object} companySettings - Company settings object (deprecated, kept for backward compatibility)
 * @returns {boolean} True if user should be required to complete onboarding
 */
export function shouldRequireOnboarding(user, companySettings = null) {
  try {
    // Validate inputs
    if (!user) {
      return false;
    }

    // Check if user role is exempt from onboarding
    if (isRoleExemptFromOnboarding(user.role)) {
      return false;
    }

    // NEW: Check user-specific onboarding mandatory setting first
    const isUserOnboardingMandatory = user.isOnboardingMandatory ?? false;
    
    // If user-specific setting is not set, fall back to company-wide setting for backward compatibility
    let isOnboardingRequired = isUserOnboardingMandatory;
    if (!isUserOnboardingMandatory && companySettings) {
      isOnboardingRequired = companySettings.isOnboardingMandatory ?? false;
    }

    // If onboarding is not mandatory for this user, don't require it
    if (!isOnboardingRequired) {
      return false;
    }

    // Check if user has already completed onboarding
    // Handle both old and new field names for backward compatibility
    const isOnboardingCompleted = 
      user.isOnboardingCompleted ?? 
      user.isOnbordingCompleted ?? 
      false;

    // Require onboarding if it's mandatory and user hasn't completed it
    return !isOnboardingCompleted;
  } catch (error) {
    console.error('Error checking onboarding requirement:', error);
    // Return false (don't require) on error to avoid blocking users
    return false;
  }
}

/**
 * Update company onboarding mandatory setting
 * @param {string} companyId - The company ID (without 'companies/' prefix)
 * @param {boolean} isRequired - Whether onboarding should be mandatory
 * @returns {Promise<Object>} Result of the update operation
 */
export async function updateOnboardingMandatory(companyId, isRequired) {
  try {
    if (!companyId) {
      throw new Error('Company ID is required');
    }

    if (typeof isRequired !== 'boolean') {
      throw new Error('isRequired must be a boolean value');
    }

    // Handle both formats: 'companies/id' and just 'id'
    const cleanCompanyId = companyId.replace('companies/', '');
    
    // Update via REST API
    await hrApiClient.put(`/hr/companies/${cleanCompanyId}`, {
      isOnboardingMandatory: isRequired
    });

    return {
      success: true,
      companyId: cleanCompanyId,
      isOnboardingMandatory: isRequired
    };
  } catch (error) {
    console.error('Error updating onboarding mandatory setting:', error);
    throw new Error(error.response?.data?.error || `Failed to update onboarding setting: ${error.message}`);
  }
}

/**
 * Validate onboarding completion status for a user
 * @param {string} userId - The user ID
 * @returns {Promise<Object>} Validation result with onboarding status
 */
export async function validateOnboardingStatus(userId) {
  try {
    if (!userId) {
      throw new Error('User ID is required');
    }

    // Use REST API
    const { data: userData } = await hrApiClient.get(`/hr/employees/${userId}`);

    if (!userData) {
      return {
        valid: false,
        error: 'User not found'
      };
    }

    // Handle both old and new field names for backward compatibility
    const isOnboardingCompleted = 
      userData.isOnboardingCompleted ?? 
      userData.isOnbordingCompleted ?? 
      false;

    return {
      valid: true,
      isOnboardingCompleted,
      onboardingCompletedAt: userData.onboardingCompletedAt || null,
      userId
    };
  } catch (error) {
    console.error('Error validating onboarding status:', error);
    return {
      valid: false,
      error: error.message
    };
  }
}

/**
 * Get the appropriate redirect path based on user role and onboarding status
 * @param {Object} user - User object
 * @param {Object} companySettings - Company settings object (deprecated, kept for backward compatibility)
 * @returns {string} The path to redirect to
 */
export function getOnboardingRedirectPath(user, companySettings = null) {
  try {
    // If onboarding is required, redirect to onboarding page
    if (shouldRequireOnboarding(user, companySettings)) {
      return '/emp/onboarding';
    }

    // Otherwise, redirect to dashboard
    return '/';
  } catch (error) {
    console.error('Error determining redirect path:', error);
    // Default to dashboard on error
    return '/';
  }
}

/**
 * Retry wrapper for async operations with exponential backoff
 * @param {Function} operation - The async operation to retry
 * @param {number} maxRetries - Maximum number of retry attempts
 * @param {number} baseDelay - Base delay in milliseconds
 * @returns {Promise} Result of the operation
 */
export async function retryOperation(operation, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      // Don't retry on certain error types
      if (error.code === 'permission-denied' || error.code === 'not-found') {
        throw error;
      }
      
      // If this was the last attempt, throw the error
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Wait before retrying with exponential backoff
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}