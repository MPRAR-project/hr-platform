import { db } from '../firebase/client';
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch,
  deleteDoc
} from 'firebase/firestore';

/**
 * Onboarding Service - Production Level Implementation
 * Handles all onboarding-related operations with proper error handling and validation
 */

// Collection names
const COLLECTIONS = {
  ONBOARDING_APPLICATIONS: 'onboardingApplications',
  USERS: 'users',
  COMPANIES: 'companies',
  SITES: 'sites'
};

// Onboarding statuses
export const ONBOARDING_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled'
};

// Onboarding steps
export const ONBOARDING_STEPS = {
  PERSONAL_INFO: 1,
  IDENTIFICATION: 2,
  BANKING: 3,
  HR_INFO: 4,
  POLICIES: 5,
  OPTIONAL_INFO: 6
};

/**
 * Validation schemas for each onboarding step
 */
const VALIDATION_SCHEMAS = {
  [ONBOARDING_STEPS.PERSONAL_INFO]: {
    required: ['firstName', 'lastName', 'email', 'phone', 'dateOfBirth'],
    email: ['email'],
    phone: ['phone']
  },
  [ONBOARDING_STEPS.IDENTIFICATION]: {
    required: ['nationalInsurance', 'rightToWork'],
    conditional: {
      passportNumber: ['issuingCountry', 'passportExpiry']
    }
  },
  [ONBOARDING_STEPS.BANKING]: {
    required: ['accountHolderName', 'bankName', 'accountNumber', 'sortCode']
  },
  [ONBOARDING_STEPS.HR_INFO]: {
    required: ['nextOfKinName', 'nextOfKinRelationship', 'nextOfKinPhone']
  },
  [ONBOARDING_STEPS.POLICIES]: {
    required: ['employmentContractAgreed', 'healthSafetyAgreed', 'signatureName', 'signatureDate']
  },
  [ONBOARDING_STEPS.OPTIONAL_INFO]: {
    required: [] // All fields are optional
  }
};

/**
 * Validate onboarding step data
 */
function validateStepData(stepNumber, data) {
  const schema = VALIDATION_SCHEMAS[stepNumber];
  if (!schema) {
    throw new Error(`Invalid step number: ${stepNumber}`);
  }

  const errors = [];

  // Check required fields
  schema.required.forEach(field => {
    if (!data[field] || (typeof data[field] === 'string' && data[field].trim() === '')) {
      errors.push(`${field} is required`);
    }
  });

  // Check email format
  if (schema.email) {
    schema.email.forEach(field => {
      if (data[field] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data[field])) {
        errors.push(`${field} must be a valid email address`);
      }
    });
  }

  // Check phone format
  if (schema.phone) {
    schema.phone.forEach(field => {
      if (data[field] && !/^[\+]?[1-9][\d]{0,15}$/.test(data[field].replace(/[\s\-\(\)]/g, ''))) {
        errors.push(`${field} must be a valid phone number`);
      }
    });
  }

  // Check conditional fields
  if (schema.conditional) {
    Object.entries(schema.conditional).forEach(([trigger, required]) => {
      if (data[trigger]) {
        required.forEach(field => {
          if (!data[field] || (typeof data[field] === 'string' && data[field].trim() === '')) {
            errors.push(`${field} is required when ${trigger} is provided`);
          }
        });
      }
    });
  }

  if (errors.length > 0) {
    throw new Error(`Validation failed: ${errors.join(', ')}`);
  }

  return true;
}

/**
 * Create a new onboarding application
 */
export async function createOnboardingApplication({ userId, companyId, siteId, assignedTo = null }) {
  try {
    // Validate inputs
    if (!userId || !companyId || !siteId) {
      throw new Error('userId, companyId, and siteId are required');
    }




    // Check if user already has a pending/in_progress onboarding
    const existingQuery = query(
      collection(db, COLLECTIONS.ONBOARDING_APPLICATIONS),
      where('userId', '==', userId),
      where('status', 'in', [ONBOARDING_STATUS.PENDING, ONBOARDING_STATUS.IN_PROGRESS])
    );
    const existingSnap = await getDocs(existingQuery);

    if (!existingSnap.empty) {
      // Return the latest existing active onboarding instead of creating a duplicate
      let latest = existingSnap.docs[0];
      for (const d of existingSnap.docs) {
        const a = d.data();
        const aUpdated = (a.updatedAt?.toMillis?.() || (a.updatedAt?.seconds ? a.updatedAt.seconds * 1000 : 0))
          || (a.createdAt?.toMillis?.() || (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0));
        const l = latest.data();
        const lUpdated = (l.updatedAt?.toMillis?.() || (l.updatedAt?.seconds ? l.updatedAt.seconds * 1000 : 0))
          || (l.createdAt?.toMillis?.() || (l.createdAt?.seconds ? l.createdAt.seconds * 1000 : 0));
        if (aUpdated > lUpdated) latest = d;
      }
      return { id: latest.id, ...latest.data() };
    }

    // Create onboarding application
    const onboardingRef = doc(collection(db, COLLECTIONS.ONBOARDING_APPLICATIONS));
    const now = serverTimestamp();

    const onboardingData = {
      userId,
      companyId,
      siteId,
      status: ONBOARDING_STATUS.PENDING,
      currentStep: ONBOARDING_STEPS.PERSONAL_INFO,
      formData: {
        personalInfo: {},
        identification: {},
        banking: {},
        hrInfo: {},
        policies: {},
        optionalInfo: {}
      },
      employmentDetails: {},
      documents: [],
      assignedTo,
      createdAt: now,
      updatedAt: now,
      completedAt: null
    };

    await setDoc(onboardingRef, onboardingData);

    return {
      id: onboardingRef.id,
      ...onboardingData
    };
  } catch (error) {
    console.error('Error creating onboarding application:', error);
    throw new Error(`Failed to create onboarding application: ${error.message}`);
  }
}

/**
 * Submit onboarding step data
 */
export async function submitOnboardingStep(applicationId, stepNumber, stepData) {
  try {
    // Validate inputs
    if (!applicationId || !stepNumber || !stepData) {
      throw new Error('applicationId, stepNumber, and stepData are required');
    }

    // Validate step data
    validateStepData(stepNumber, stepData);

    // const userRef = doc(db, "users", userId);

    // Get current application
    const applicationRef = doc(db, COLLECTIONS.ONBOARDING_APPLICATIONS, applicationId);
    const applicationSnap = await getDoc(applicationRef);

    if (!applicationSnap.exists()) {
      throw new Error('Onboarding application not found');
    }

    const currentData = applicationSnap.data();

    // Check if step is valid for current status
    if (currentData.status === ONBOARDING_STATUS.COMPLETED ||
      currentData.status === ONBOARDING_STATUS.REJECTED) {
      throw new Error('Cannot modify completed or rejected application');
    }

    // Update form data for the specific step
    const stepNames = {
      [ONBOARDING_STEPS.PERSONAL_INFO]: 'personalInfo',
      [ONBOARDING_STEPS.IDENTIFICATION]: 'identification',
      [ONBOARDING_STEPS.BANKING]: 'banking',
      [ONBOARDING_STEPS.HR_INFO]: 'hrInfo',
      [ONBOARDING_STEPS.POLICIES]: 'policies',
      [ONBOARDING_STEPS.OPTIONAL_INFO]: 'optionalInfo'
    };

    const stepName = stepNames[stepNumber];
    if (!stepName) {
      throw new Error(`Invalid step number: ${stepNumber}`);
    }

    // Update the application
    const updateData = {
      [`formData.${stepName}`]: stepData,
      currentStep: Math.max(currentData.currentStep, stepNumber),
      status: currentData.status === ONBOARDING_STATUS.PENDING ?
        ONBOARDING_STATUS.IN_PROGRESS : currentData.status,
      updatedAt: serverTimestamp()
    };

    await updateDoc(applicationRef, updateData);

    return {
      id: applicationId,
      currentStep: updateData.currentStep,
      status: updateData.status
    };
  } catch (error) {
    console.error('Error submitting onboarding step:', error);
    throw new Error(`Failed to submit onboarding step: ${error.message}`);
  }
}

/**
 * Complete onboarding application
 */
export async function completeOnboardingApplication(applicationId, userId, employmentDetails = {}) {
  try {
    if (!applicationId) {
      throw new Error('applicationId is required');
    }
    const userRef = doc(db, "users", userId);
    const applicationRef = doc(db, COLLECTIONS.ONBOARDING_APPLICATIONS, applicationId);
    const applicationSnap = await getDoc(applicationRef);

    if (!applicationSnap.exists()) {
      throw new Error('Onboarding application not found');
    }

    const currentData = applicationSnap.data();

    // Check if all steps are completed
    if (currentData.currentStep < ONBOARDING_STEPS.OPTIONAL_INFO) {
      throw new Error('All onboarding steps must be completed before submission');
    }

    // Update application status
    const updateData = {
      status: ONBOARDING_STATUS.COMPLETED,
      employmentDetails,
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };



    await updateDoc(applicationRef, updateData);

    await updateDoc(userRef, {
      isOnboardingCompleted: true,
      updatedAt: serverTimestamp()
    })

    // Sync personal info to HR onboarding profile if it exists
    try {
      const { syncPersonalInfoToHRProfile } = await import('./hrOnboarding.js');
      const personalInfoData = currentData.formData?.personalInfo || {};

      if (Object.keys(personalInfoData).length > 0) {
        await syncPersonalInfoToHRProfile(userId, personalInfoData);
        console.log('[onboarding] Synced personal info to HR onboarding profile');
      }
    } catch (syncError) {
      // Don't fail the onboarding completion if sync fails
      console.warn('[onboarding] Failed to sync to HR profile:', syncError);
    }

    return {
      id: applicationId,
      status: ONBOARDING_STATUS.COMPLETED,
      completedAt: updateData.completedAt
    };
  } catch (error) {
    console.error('Error completing onboarding application:', error);
    throw new Error(`Failed to complete onboarding application: ${error.message}`);
  }
}

/**
 * Get onboarding applications for a company with filtering and pagination
 */
export async function getOnboardingApplications({
  companyId,
  status = null,
  assignedTo = null,
  limitCount = 50,
  startAfter = null
}) {
  try {
    if (!companyId) {
      throw new Error('companyId is required');
    }

    let q = query(
      collection(db, COLLECTIONS.ONBOARDING_APPLICATIONS),
      where('companyId', '==', companyId),
      orderBy('createdAt', 'desc')
    );

    // Add status filter
    if (status) {
      q = query(q, where('status', '==', status));
    }

    // Add assignedTo filter
    if (assignedTo) {
      q = query(q, where('assignedTo', '==', assignedTo));
    }

    // Add pagination
    if (startAfter) {
      q = query(q, startAfter);
    }

    q = query(q, limit(limitCount));

    const snap = await getDocs(q);
    const applications = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return {
      applications,
      hasMore: snap.docs.length === limitCount,
      lastDoc: snap.docs[snap.docs.length - 1]
    };
  } catch (error) {
    console.error('Error getting onboarding applications:', error);
    
    // Check if this is an index building error
    if (error.code === 'failed-precondition' && error.message?.includes('currently building')) {
      console.warn('[onboarding] Index is still building. Returning empty results temporarily.');
      return {
        applications: [],
        hasMore: false,
        lastDoc: null
      };
    }
    
    throw new Error(`Failed to get onboarding applications: ${error.message}`);
  }
}

/**
 * Get onboarding application by ID
 */
export async function getOnboardingApplication(applicationId) {
  try {
    if (!applicationId) {
      throw new Error('applicationId is required');
    }

    const applicationRef = doc(db, COLLECTIONS.ONBOARDING_APPLICATIONS, applicationId);
    const applicationSnap = await getDoc(applicationRef);

    if (!applicationSnap.exists()) {
      throw new Error('Onboarding application not found');
    }

    return {
      id: applicationSnap.id,
      ...applicationSnap.data()
    };
  } catch (error) {
    console.error('Error getting onboarding application:', error);
    throw new Error(`Failed to get onboarding application: ${error.message}`);
  }
}

/**
 * Get user's onboarding application
 */
export async function getUserOnboardingApplication(userId) {
  try {
    if (!userId) {
      throw new Error('userId is required');
    }

    const q = query(
      collection(db, COLLECTIONS.ONBOARDING_APPLICATIONS),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc'),
      limit(1)
    );

    const snap = await getDocs(q);

    if (snap.empty) {
      return null;
    }

    const doc = snap.docs[0];
    return {
      id: doc.id,
      ...doc.data()
    };
  } catch (error) {
    console.error('Error getting user onboarding application:', error);
    throw new Error(`Failed to get user onboarding application: ${error.message}`);
  }
}

/**
 * Update onboarding status (for managers)
 */
export async function updateOnboardingStatus(applicationId, status, updatedBy, notes = '') {
  try {
    if (!applicationId || !status || !updatedBy) {
      throw new Error('applicationId, status, and updatedBy are required');
    }

    if (!Object.values(ONBOARDING_STATUS).includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }

    const applicationRef = doc(db, COLLECTIONS.ONBOARDING_APPLICATIONS, applicationId);
    const applicationSnap = await getDoc(applicationRef);

    if (!applicationSnap.exists()) {
      throw new Error('Onboarding application not found');
    }

    const updateData = {
      status,
      updatedBy,
      updatedAt: serverTimestamp(),
      statusNotes: notes
    };

    // Add completion timestamp if status is completed
    if (status === ONBOARDING_STATUS.COMPLETED) {
      updateData.completedAt = serverTimestamp();
    }

    await updateDoc(applicationRef, updateData);

    return {
      id: applicationId,
      status,
      updatedBy,
      updatedAt: updateData.updatedAt
    };
  } catch (error) {
    console.error('Error updating onboarding status:', error);
    throw new Error(`Failed to update onboarding status: ${error.message}`);
  }
}

/**
 * Assign onboarding to a manager
 */
export async function assignOnboardingManager(applicationId, managerId, assignedBy) {
  try {
    if (!applicationId || !managerId || !assignedBy) {
      throw new Error('applicationId, managerId, and assignedBy are required');
    }

    const applicationRef = doc(db, COLLECTIONS.ONBOARDING_APPLICATIONS, applicationId);
    const applicationSnap = await getDoc(applicationRef);

    if (!applicationSnap.exists()) {
      throw new Error('Onboarding application not found');
    }

    const updateData = {
      assignedTo: managerId,
      assignedBy,
      assignedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await updateDoc(applicationRef, updateData);

    return {
      id: applicationId,
      assignedTo: managerId,
      assignedBy,
      assignedAt: updateData.assignedAt
    };
  } catch (error) {
    console.error('Error assigning onboarding manager:', error);
    throw new Error(`Failed to assign onboarding manager: ${error.message}`);
  }
}

/**
 * Delete onboarding application (admin only)
 */
export async function deleteOnboardingApplication(applicationId) {
  try {
    if (!applicationId) {
      throw new Error('applicationId is required');
    }

    const applicationRef = doc(db, COLLECTIONS.ONBOARDING_APPLICATIONS, applicationId);
    const applicationSnap = await getDoc(applicationRef);

    if (!applicationSnap.exists()) {
      throw new Error('Onboarding application not found');
    }

    await deleteDoc(applicationRef);

    return { success: true };
  } catch (error) {
    console.error('Error deleting onboarding application:', error);
    throw new Error(`Failed to delete onboarding application: ${error.message}`);
  }
}

/**
 * Get onboarding statistics for a company
 */
export async function getOnboardingStatistics(companyId) {
  try {
    if (!companyId) {
      throw new Error('companyId is required');
    }

    const q = query(
      collection(db, COLLECTIONS.ONBOARDING_APPLICATIONS),
      where('companyId', '==', companyId)
    );

    const snap = await getDocs(q);
    const applications = snap.docs.map(doc => doc.data());

    const stats = {
      total: applications.length,
      pending: applications.filter(app => app.status === ONBOARDING_STATUS.PENDING).length,
      inProgress: applications.filter(app => app.status === ONBOARDING_STATUS.IN_PROGRESS).length,
      completed: applications.filter(app => app.status === ONBOARDING_STATUS.COMPLETED).length,
      rejected: applications.filter(app => app.status === ONBOARDING_STATUS.REJECTED).length,
      cancelled: applications.filter(app => app.status === ONBOARDING_STATUS.CANCELLED).length
    };

    return stats;
  } catch (error) {
    console.error('Error getting onboarding statistics:', error);
    throw new Error(`Failed to get onboarding statistics: ${error.message}`);
  }
}
