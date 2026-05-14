import hrApiClient from '../lib/hrApiClient';

/**
 * HR Onboarding Configuration Service (Phase 4 — REST Migration)
 * 
 * Replaces Firestore storage for company-level onboarding settings with HR REST API.
 */

/**
 * Get company HR onboarding configuration
 */
export async function getCompanyHROnboardingConfig(companyId) {
    try {
        const { data } = await hrApiClient.get('/hr/onboarding-policies');
        // If the backend returns a list, find the active one or return default
        const policies = data.policies || data || [];
        const active = policies.find(p => p.isActive) || policies[0];
        
        if (active) {
            return {
                id: active.id,
                ...active,
                // Ensure sections structure matches what the frontend expects
                sections: active.sections || active.steps || getDefaultConfig(companyId).sections
            };
        }

        return getDefaultConfig(companyId);
    } catch (error) {
        console.error('[hrOnboardingConfig] Error getting config:', error);
        return getDefaultConfig(companyId);
    }
}

/**
 * Update company HR onboarding configuration
 */
export async function updateCompanyHROnboardingConfig(companyId, config, updatedBy) {
    try {
        const payload = {
            title: 'Company Onboarding Policy',
            description: 'Main onboarding workflow',
            sections: config.sections,
            steps: config.sections, // Backward compat for backend schema
            isActive: true
        };

        const { data } = await hrApiClient.post('/hr/onboarding-policies', payload);
        return {
            id: data.id,
            ...data,
            sections: data.sections || data.steps
        };
    } catch (error) {
        console.error('[hrOnboardingConfig] Error updating config:', error);
        throw error;
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
                    'firstName', 'lastName', 'dateOfBirth', 'phone', 'email',
                    'addressLine1', 'city', 'country'
                ],
                assignedRole: 'employee',
                displayName: 'Personal Information'
            },
            employmentDetails: {
                enabled: true,
                requiredFields: [
                    'startDate', 'jobTitle', 'department', 'salary',
                    'employmentType', 'probationPeriod'
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
        }
    };
}

export function initializeProfileSectionsFromConfig(config) {
    const sections = {};
    const cfgSections = config.sections || config.steps || {};

    if (cfgSections.personalInfo?.enabled) {
        sections.personalInfo = {
            status: 'pending',
            completedBy: null,
            completedAt: null,
            fields: {}
        };
        (cfgSections.personalInfo.requiredFields || []).forEach(field => {
            sections.personalInfo.fields[field] = { completed: false, value: null, required: true };
        });
    }

    if (cfgSections.employmentDetails?.enabled) {
        sections.employmentDetails = {
            status: 'pending',
            completedBy: null,
            completedAt: null,
            fields: {}
        };
        (cfgSections.employmentDetails.requiredFields || []).forEach(field => {
            sections.employmentDetails.fields[field] = { completed: false, value: null, required: true };
        });
    }

    if (cfgSections.contractDocuments?.enabled) {
        sections.contractDocuments = {
            status: 'pending',
            completedBy: null,
            completedAt: null,
            documents: (cfgSections.contractDocuments.requiredDocuments || []).map((doc, index) => ({
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

    if (cfgSections.allowances?.enabled) {
        sections.allowances = {
            status: 'pending',
            completedBy: null,
            completedAt: null,
            allowances: (cfgSections.allowances.requiredAllowances || []).map(allowance => ({
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
