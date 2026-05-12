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
    writeBatch
} from 'firebase/firestore';

/**
 * HR Onboarding Service
 * Manages HR-driven onboarding process for new employees
 */

const COLLECTION_NAME = 'hrOnboardingProfiles';

/**
 * Create a new HR onboarding profile for a user
 */
export async function createHROnboardingProfile({ userId, companyId, siteId, createdBy }) {
    try {
        if (!userId || !companyId || !siteId) {
            throw new Error('userId, companyId, and siteId are required');
        }

        // Check if profile already exists
        const existingProfile = await getHROnboardingProfile(userId);
        if (existingProfile) {
            console.log('[hrOnboarding] Profile already exists for user:', userId);
            return existingProfile;
        }

        const profileRef = doc(collection(db, COLLECTION_NAME));
        const now = serverTimestamp();

        const profileData = {
            id: profileRef.id,
            userId,
            companyId,
            siteId,
            status: 'pending',
            completionPercent: 0,

            sections: {
                personalInfo: {
                    status: 'pending',
                    completedBy: null,
                    completedAt: null,
                    fields: {}
                },
                employmentDetails: {
                    status: 'pending',
                    completedBy: null,
                    completedAt: null,
                    fields: {}
                },
                contractDocuments: {
                    status: 'pending',
                    completedBy: null,
                    completedAt: null,
                    documents: []
                },
                allowances: {
                    status: 'pending',
                    completedBy: null,
                    completedAt: null,
                    allowances: []
                }
            },

            createdAt: now,
            createdBy: createdBy || null,
            updatedAt: now,
            lastUpdatedBy: createdBy || null,
            completedAt: null
        };

        await setDoc(profileRef, profileData);

        // Update user document with HR onboarding flags
        const userRef = doc(db, 'users', userId);
        await updateDoc(userRef, {
            requiresHROnboarding: true,
            hrOnboardingStatus: 'pending',
            hrOnboardingCompletionPercent: 0,
            updatedAt: now
        });

        return {
            id: profileRef.id,
            ...profileData
        };
    } catch (error) {
        console.error('[hrOnboarding] Error creating profile:', error);
        throw new Error(`Failed to create HR onboarding profile: ${error.message}`);
    }
}

/**
 * Get HR onboarding profile for a specific user
 */
export async function getHROnboardingProfile(userId) {
    try {
        if (!userId) {
            throw new Error('userId is required');
        }

        const q = query(
            collection(db, COLLECTION_NAME),
            where('userId', '==', userId),
            limit(1)
        );

        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return null;
        }

        const doc = snapshot.docs[0];
        return {
            id: doc.id,
            ...doc.data()
        };
    } catch (error) {
        console.error('[hrOnboarding] Error getting profile:', error);
        throw new Error(`Failed to get HR onboarding profile: ${error.message}`);
    }
}

/**
 * Get all HR onboarding profiles for a company with optional filters
 */
export async function getHROnboardingProfiles({
    companyId,
    status = null,
    searchTerm = null,
    limitCount = 50,
    orderByField = 'createdAt',
    orderDirection = 'desc'
}) {
    try {
        if (!companyId) {
            throw new Error('companyId is required');
        }

        let q = query(
            collection(db, COLLECTION_NAME),
            where('companyId', '==', companyId)
        );

        // Add status filter if provided
        if (status) {
            q = query(q, where('status', '==', status));
        }

        // Add ordering
        q = query(q, orderBy(orderByField, orderDirection));

        // Add limit
        q = query(q, limit(limitCount));

        const snapshot = await getDocs(q);
        let profiles = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        // Client-side search if searchTerm provided
        if (searchTerm) {
            const searchLower = searchTerm.toLowerCase();

            // Fetch user data for each profile to enable name search
            const userIds = profiles.map(p => p.userId);
            const userDocs = await Promise.all(
                userIds.map(userId => getDoc(doc(db, 'users', userId)))
            );

            const userMap = {};
            userDocs.forEach(userDoc => {
                if (userDoc.exists()) {
                    userMap[userDoc.id] = userDoc.data();
                }
            });

            profiles = profiles.filter(profile => {
                const user = userMap[profile.userId];
                if (!user) return false;

                const displayName = user.displayName || '';
                const email = user.email || '';
                const firstName = user.firstName || '';
                const lastName = user.lastName || '';

                return (
                    displayName.toLowerCase().includes(searchLower) ||
                    email.toLowerCase().includes(searchLower) ||
                    firstName.toLowerCase().includes(searchLower) ||
                    lastName.toLowerCase().includes(searchLower)
                );
            });
        }

        return {
            profiles,
            hasMore: snapshot.docs.length === limitCount
        };
    } catch (error) {
        const isIndexError = error?.code === 'failed-precondition' ||
            (error?.message && (error.message.includes('index') || error.message.includes('create_composite')));
        if (isIndexError) {
            console.warn('[hrOnboarding] Query requires an index (may be building). Returning empty list.', error?.message);
            return { profiles: [], hasMore: false };
        }
        console.error('[hrOnboarding] Error getting profiles:', error);
        throw new Error(`Failed to get HR onboarding profiles: ${error.message}`);
    }
}

/**
 * Update a specific section of HR onboarding profile
 */
export async function updateHROnboardingSection({
    profileId,
    section,
    data,
    updatedBy
}) {
    try {
        if (!profileId || !section || !data) {
            throw new Error('profileId, section, and data are required');
        }

        const validSections = ['personalInfo', 'employmentDetails', 'contractDocuments', 'allowances'];
        if (!validSections.includes(section)) {
            throw new Error(`Invalid section: ${section}`);
        }

        const profileRef = doc(db, COLLECTION_NAME, profileId);
        const profileSnap = await getDoc(profileRef);

        if (!profileSnap.exists()) {
            throw new Error('HR onboarding profile not found');
        }

        const profile = profileSnap.data();
        const now = serverTimestamp();

        // Update the specific section
        const updateData = {
            [`sections.${section}`]: {
                ...profile.sections[section],
                ...data,
                completedBy: updatedBy || profile.sections[section].completedBy,
                completedAt: data.status === 'completed' ? now : profile.sections[section].completedAt
            },
            updatedAt: now,
            lastUpdatedBy: updatedBy || null
        };

        await updateDoc(profileRef, updateData);

        // Recalculate completion percentage
        const updatedProfile = await getDoc(profileRef);
        const completionPercent = calculateCompletionPercent(updatedProfile.data());

        // Update completion percentage and status
        const statusUpdate = {
            completionPercent,
            hrOnboardingCompletionPercent: completionPercent,
            updatedAt: now
        };

        // Update overall status
        if (completionPercent === 100) {
            statusUpdate.status = 'completed';
            statusUpdate.hrOnboardingStatus = 'completed';
            statusUpdate.completedAt = now;
        } else if (completionPercent > 0) {
            statusUpdate.status = 'in_progress';
            statusUpdate.hrOnboardingStatus = 'in_progress';
        }

        await updateDoc(profileRef, statusUpdate);

        // Also update user document
        const userRef = doc(db, 'users', profile.userId);
        await updateDoc(userRef, {
            hrOnboardingCompletionPercent: completionPercent,
            hrOnboardingStatus: statusUpdate.status || profile.status,
            updatedAt: now
        });

        return {
            id: profileId,
            completionPercent,
            status: statusUpdate.status || profile.status
        };
    } catch (error) {
        console.error('[hrOnboarding] Error updating section:', error);
        throw new Error(`Failed to update HR onboarding section: ${error.message}`);
    }
}

/**
 * Calculate completion percentage for an HR onboarding profile
 */
export function calculateCompletionPercent(profile) {
    if (!profile || !profile.sections) {
        return 0;
    }

    const sections = profile.sections;
    let totalWeight = 0;
    let completedWeight = 0;

    // Personal Info: 25%
    totalWeight += 25;
    if (sections.personalInfo?.status === 'completed') {
        completedWeight += 25;
    } else if (sections.personalInfo?.fields) {
        // Partial completion based on fields
        const fields = sections.personalInfo.fields;
        const fieldKeys = Object.keys(fields);
        if (fieldKeys.length > 0) {
            const completedFields = fieldKeys.filter(k => fields[k]?.completed);
            completedWeight += (completedFields.length / fieldKeys.length) * 25;
        }
    }

    // Employment Details: 25%
    totalWeight += 25;
    if (sections.employmentDetails?.status === 'completed') {
        completedWeight += 25;
    } else if (sections.employmentDetails?.fields) {
        const fields = sections.employmentDetails.fields;
        const fieldKeys = Object.keys(fields);
        if (fieldKeys.length > 0) {
            const completedFields = fieldKeys.filter(k => fields[k]?.completed);
            completedWeight += (completedFields.length / fieldKeys.length) * 25;
        }
    }

    // Contract Documents: 25%
    totalWeight += 25;
    if (sections.contractDocuments?.status === 'completed') {
        completedWeight += 25;
    } else if (sections.contractDocuments?.documents) {
        const docs = sections.contractDocuments.documents;
        const requiredDocs = docs.filter(d => d.required);
        if (requiredDocs.length > 0) {
            const uploadedDocs = requiredDocs.filter(d => d.uploaded);
            completedWeight += (uploadedDocs.length / requiredDocs.length) * 25;
        }
    }

    // Allowances: 25%
    totalWeight += 25;
    if (sections.allowances?.status === 'completed') {
        completedWeight += 25;
    } else if (sections.allowances?.allowances) {
        const allowances = sections.allowances.allowances;
        const requiredAllowances = allowances.filter(a => a.required);
        if (requiredAllowances.length > 0) {
            const setAllowances = requiredAllowances.filter(a => a.set);
            completedWeight += (setAllowances.length / requiredAllowances.length) * 25;
        }
    }

    return Math.round((completedWeight / totalWeight) * 100);
}

/**
 * Mark HR onboarding as complete
 */
export async function completeHROnboarding(profileId, completedBy) {
    try {
        if (!profileId) {
            throw new Error('profileId is required');
        }

        const profileRef = doc(db, COLLECTION_NAME, profileId);
        const profileSnap = await getDoc(profileRef);

        if (!profileSnap.exists()) {
            throw new Error('HR onboarding profile not found');
        }

        const profile = profileSnap.data();
        const completionPercent = calculateCompletionPercent(profile);

        if (completionPercent < 100) {
            throw new Error('Cannot complete HR onboarding - not all sections are complete');
        }

        const now = serverTimestamp();

        // Update profile
        await updateDoc(profileRef, {
            status: 'completed',
            completionPercent: 100,
            completedAt: now,
            updatedAt: now,
            lastUpdatedBy: completedBy || null
        });

        // Update user document
        const userRef = doc(db, 'users', profile.userId);
        await updateDoc(userRef, {
            hrOnboardingStatus: 'completed',
            hrOnboardingCompletionPercent: 100,
            updatedAt: now
        });

        return {
            id: profileId,
            status: 'completed',
            completionPercent: 100,
            completedAt: now
        };
    } catch (error) {
        console.error('[hrOnboarding] Error completing onboarding:', error);
        throw new Error(`Failed to complete HR onboarding: ${error.message}`);
    }
}

/**
 * Sync employee personal info to HR onboarding profile
 */
export async function syncPersonalInfoToHRProfile(userId, personalInfoData) {
    try {
        console.log('[hrOnboarding] Syncing personal info for user:', userId);
        console.log('[hrOnboarding] Personal info data:', personalInfoData);

        const profile = await getHROnboardingProfile(userId);
        
        // 1. Update HR Onboarding Profile (if it exists)
        if (profile) {
            console.log('[hrOnboarding] Found HR profile:', profile.id);

            // Map ALL personal info fields to completion status
            const fields = {};

            // Map fields with potential name variations
            const fieldMappings = {
                firstName: personalInfoData.firstName,
                lastName: personalInfoData.lastName,
                email: personalInfoData.email,
                phone: personalInfoData.phone,
                dateOfBirth: personalInfoData.dateOfBirth,
                gender: personalInfoData.gender,
                maritalStatus: personalInfoData.maritalStatus,
                nationality: personalInfoData.nationality,
                addressLine1: personalInfoData.addressLine1 || personalInfoData.address,
                addressLine2: personalInfoData.addressLine2,
                city: personalInfoData.city,
                postcode: personalInfoData.postcode,
                country: personalInfoData.country,
                nationalInsurance: personalInfoData.nationalInsurance,
                taxCode: personalInfoData.taxCode,
                passportNumber: personalInfoData.passportNumber,
                issuingCountry: personalInfoData.issuingCountry,
                passportExpiryDate: personalInfoData.passportExpiryDate || personalInfoData.passportExpiry,
                rightToWorkStatus: personalInfoData.rightToWorkStatus || personalInfoData.rightToWork
            };

            const requiredFieldsList = ['firstName', 'lastName', 'dateOfBirth', 'phone', 'email', 'addressLine1', 'city', 'country'];

            Object.entries(fieldMappings).forEach(([key, value]) => {
                if (value !== undefined && value !== null) {
                    fields[key] = {
                        completed: Boolean(value),
                        value: value,
                        required: requiredFieldsList.includes(key)
                    };
                }
            });

            console.log('[hrOnboarding] Mapped fields:', fields);

            // Check if all required fields are completed
            const allCompleted = requiredFieldsList.every(field => Boolean(fieldMappings[field]));

            console.log('[hrOnboarding] All required fields completed:', allCompleted);

            await updateHROnboardingSection({
                profileId: profile.id,
                section: 'personalInfo',
                data: {
                    fields,
                    status: allCompleted ? 'completed' : 'in_progress'
                },
                updatedBy: userId
            });

            console.log('[hrOnboarding] Successfully synced personal info to HR profile');
        } else {
            console.log('[hrOnboarding] No HR onboarding profile found (skipping section update)');
        }
        
        // 2. --- SYNC TO CENTRAL PLATFORM POSTGRES ---
        try {
            const centralApiUrl = import.meta.env.VITE_CENTRAL_API_URL || 'http://localhost:5000';
            const centralToken = localStorage.getItem('mprar_central_token');
            const auth = (await import('../firebase/client')).auth;
            const currentUserId = auth.currentUser?.uid;

            if (centralToken && centralApiUrl) {
                const normalizedUserId = userId.includes('/') ? userId.split('/').pop() : userId;
                const isSelfUpdate = currentUserId === normalizedUserId;
                
                let syncUrl = `${centralApiUrl}/auth/profile`;
                let syncBody = {
                    firstName: personalInfoData.firstName,
                    lastName: personalInfoData.lastName,
                    email: personalInfoData.email
                };

                if (!isSelfUpdate) {
                    // Manager updating someone else
                    // Try to get companyId from onboarding profile, or from user document as fallback
                    let companyIdRaw = profile?.companyId;
                    
                    if (!companyIdRaw) {
                        try {
                            const { doc, getDoc } = await import('firebase/firestore');
                            const { db } = await import('../firebase/client');
                            const userSnap = await getDoc(doc(db, 'users', normalizedUserId));
                            if (userSnap.exists()) {
                                companyIdRaw = userSnap.data().primaryCompanyId || userSnap.data().companyId;
                            }
                        } catch (e) {
                            console.warn('[HR Onboarding Sync] Failed to fetch companyId from user doc:', e);
                        }
                    }

                    const cleanCompanyId = (companyIdRaw || '').replace('companies/', '');
                    
                    if (cleanCompanyId) {
                        syncUrl = `${centralApiUrl}/companies/${cleanCompanyId}/users/${normalizedUserId}`;
                    } else {
                        console.warn('[HR Onboarding Sync] No companyId found for sync');
                        syncUrl = null;
                    }
                }

                if (syncUrl) {
                    console.log(`[HR Onboarding Sync] Syncing to: ${syncUrl}`);
                    fetch(syncUrl, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${centralToken}`
                        },
                        body: JSON.stringify(syncBody)
                    }).then(res => {
                        if (!res.ok) console.warn('[HR Onboarding Sync] Central sync failed:', res.status);
                        else console.info('[HR Onboarding Sync] Central sync success');
                    }).catch(err => console.warn('[HR Onboarding Sync] Central sync error:', err));
                }
            }
        } catch (syncErr) {
            console.warn('[HR Onboarding Sync] Central sync non-fatal error:', syncErr);
        }

        return { success: true };
    } catch (error) {
        console.error('[hrOnboarding] Error syncing personal info:', error);
        return { success: false, error: error.message };
    }
}
