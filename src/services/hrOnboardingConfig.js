import { db } from '../firebase/client';
import {
    collection,
    doc,
    setDoc,
    getDoc,
    updateDoc,
    serverTimestamp
} from 'firebase/firestore';

/**
 * HR Onboarding Configuration Service
 * Manages company-level HR onboarding settings
 */

const COLLECTION_NAME = 'hrOnboardingConfigs';

/**
 * Get company HR onboarding configuration
 * Returns default config if none exists
 */
export async function getCompanyHROnboardingConfig(companyId) {
    try {
        if (!companyId) {
            throw new Error('companyId is required');
        }

        // Normalize company ID
        const normalizedCompanyId = companyId.includes('/') ? companyId : `companies/${companyId}`;

        const configRef = doc(db, COLLECTION_NAME, normalizedCompanyId);
        const configSnap = await getDoc(configRef);

        if (configSnap.exists()) {
            return {
                id: configSnap.id,
                ...configSnap.data()
            };
        }

        // Return default configuration
        return getDefaultConfig(normalizedCompanyId);
    } catch (error) {
        console.error('[hrOnboardingConfig] Error getting config:', error);
        throw new Error(`Failed to get HR onboarding config: ${error.message}`);
    }
}

/**
 * Update company HR onboarding configuration
 */
export async function updateCompanyHROnboardingConfig(companyId, config, updatedBy) {
    try {
        if (!companyId || !config) {
            throw new Error('companyId and config are required');
        }

        // Normalize company ID
        const normalizedCompanyId = companyId.includes('/') ? companyId : `companies/${companyId}`;

        const configRef = doc(db, COLLECTION_NAME, normalizedCompanyId);
        const configSnap = await getDoc(configRef);

        const now = serverTimestamp();

        if (configSnap.exists()) {
            // Update existing config
            await updateDoc(configRef, {
                ...config,
                updatedAt: now,
                updatedBy: updatedBy || null
            });
        } else {
            // Create new config
            await setDoc(configRef, {
                id: normalizedCompanyId,
                companyId: normalizedCompanyId,
                ...config,
                createdAt: now,
                updatedAt: now,
                updatedBy: updatedBy || null
            });
        }

        return {
            id: normalizedCompanyId,
            ...config
        };
    } catch (error) {
        console.error('[hrOnboardingConfig] Error updating config:', error);
        throw new Error(`Failed to update HR onboarding config: ${error.message}`);
    }
}

/**
 * Get default HR onboarding configuration
 */
function getDefaultConfig(companyId) {
    return {
        id: companyId,
        companyId,
        sections: {
            personalInfo: {
                enabled: true,
                requiredFields: [
                    'firstName',
                    'lastName',
                    'dateOfBirth',
                    'phone',
                    'email',
                    'addressLine1',
                    'city',
                    'country'
                ],
                assignedRole: 'employee',
                displayName: 'Personal Information'
            },
            employmentDetails: {
                enabled: true,
                requiredFields: [
                    'startDate',
                    'jobTitle',
                    'department',
                    'salary',
                    'employmentType',
                    'probationPeriod'
                ],
                assignedRole: 'hrManager',
                displayName: 'Employment Details'
            },
            contractDocuments: {
                enabled: true,
                requiredDocuments: [
                    { name: 'Employment Contract', required: true },
                    { name: 'Job Description', required: true },
                    { name: 'NDA', required: false }
                ],
                assignedRole: 'hrManager',
                displayName: 'Contract Documents'
            },
            allowances: {
                enabled: true,
                requiredAllowances: [
                    { type: 'annual_leave', name: 'Annual Leave', required: true, unit: 'days' },
                    { type: 'sick_leave', name: 'Sick Leave', required: true, unit: 'days' }
                ],
                assignedRole: 'adminManager',
                displayName: 'Allowances'
            }
        },
        createdAt: null,
        updatedAt: null
    };
}

/**
 * Initialize HR onboarding profile sections from config
 */
export function initializeProfileSectionsFromConfig(config) {
    const sections = {};

    if (config.sections.personalInfo?.enabled) {
        sections.personalInfo = {
            status: 'pending',
            completedBy: null,
            completedAt: null,
            fields: {}
        };

        // Initialize fields
        config.sections.personalInfo.requiredFields.forEach(field => {
            sections.personalInfo.fields[field] = {
                completed: false,
                value: null,
                required: true
            };
        });
    }

    if (config.sections.employmentDetails?.enabled) {
        sections.employmentDetails = {
            status: 'pending',
            completedBy: null,
            completedAt: null,
            fields: {}
        };

        // Initialize fields
        config.sections.employmentDetails.requiredFields.forEach(field => {
            sections.employmentDetails.fields[field] = {
                completed: false,
                value: null,
                required: true
            };
        });
    }

    if (config.sections.contractDocuments?.enabled) {
        sections.contractDocuments = {
            status: 'pending',
            completedBy: null,
            completedAt: null,
            documents: config.sections.contractDocuments.requiredDocuments.map((doc, index) => ({
                id: `doc_${index}`,
                name: doc.name,
                required: doc.required,
                uploaded: false,
                uploadedBy: null,
                uploadedAt: null,
                documentId: null
            }))
        };
    }

    if (config.sections.allowances?.enabled) {
        sections.allowances = {
            status: 'pending',
            completedBy: null,
            completedAt: null,
            allowances: config.sections.allowances.requiredAllowances.map(allowance => ({
                type: allowance.type,
                name: allowance.name,
                required: allowance.required,
                unit: allowance.unit,
                amount: null,
                set: false
            }))
        };
    }

    return sections;
}
