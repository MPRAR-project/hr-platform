import { db, weakClientHash } from '../firebase/client';
import { collection, doc, setDoc, serverTimestamp, getDoc, updateDoc, increment, writeBatch, arrayUnion, query, where, getDocs, onSnapshot, limit } from 'firebase/firestore';
import { createUserWithEmail, getUserByEmail } from './auth';
import { validateEmploymentData, transformEmploymentDataForStorage, resolveManagerName } from '../utils/employmentUtils';
import { createUserCompanyProfile, hasCompanyProfile } from './userCompanyProfiles';

export async function addUsersBySiteManager(companyId, siteId, usersPayload) {
    const now = serverTimestamp();

    // Set flag to prevent auth redirects during user creation
    localStorage.setItem('isCreatingUsers', 'true');

    try {
        // 1) Fetch company to validate seat limits and get week start day
        const companyRef = doc(db, 'companies', companyId);
        const companySnap = await getDoc(companyRef);
        if (!companySnap.exists()) {
            throw new Error('Company not found');
        }
        const company = companySnap.data();
        const seatCount = company.seatCount;
        const currentEmployeeCount = company.currentEmployeeCount;
        const companyWeekStartDay = company.weekStartDay || 'monday'; // Get company's week start day with fallback
        const toAdd = usersPayload.length;
        if (currentEmployeeCount + toAdd > seatCount) {
            throw new Error(`Seat limit exceeded: ${currentEmployeeCount + toAdd} > ${seatCount}`);
        }

        const batch = writeBatch(db);
        const created = [];
        const managerRoleTags = new Set(['teamManager', 'adminManager', 'hrManager']);

        // 2) Create Firebase Auth users and Firestore documents
        for (const u of usersPayload) {
            const full = (u.fullName || '').trim();
            const [firstName, ...rest] = full.split(' ');
            const lastName = rest.join(' ').trim();
            const primaryRole = u.role;
            const reportsToRaw = u.reportsTo || '';
            const email = (u.email || '').toLowerCase();

            // Use email as the default password for new users
            const tempPassword = email; // Use email as password by default

            try {
                let authUserId;
                let isExistingUser = false;
                let userRef;

                // Check if user already exists in Firebase Auth
                try {
                    const existingAuthUser = await getUserByEmail(email);
                    if (existingAuthUser) {
                        authUserId = existingAuthUser.uid;
                        isExistingUser = true;
                        console.log(`Found existing Firebase Auth user: ${authUserId}`);

                        // Check if user already has a profile for this company
                        const existingProfile = await hasCompanyProfile(authUserId, companyId);
                        if (existingProfile && existingProfile.status === 'active') {
                            throw new Error(`User ${email} is already registered with this company`);
                        }

                        if (existingProfile && existingProfile.status === 'archived') {
                            throw new Error(`User ${email} was previously with this company and is archived. Please use the re-hire feature instead.`);
                        }
                    }
                } catch (checkError) {
                    // If error is our custom message, re-throw it
                    if (checkError.message.includes('already registered') || checkError.message.includes('archived')) {
                        throw checkError;
                    }
                    // Otherwise, user doesn't exist - continue with creation
                    console.log(`User ${email} not found in Auth, will create new`);
                }

                // Create new Firebase Auth user if doesn't exist
                if (!isExistingUser) {
                    console.log(`Creating Firebase Auth user for: ${email}`);
                    const firebaseUser = await createUserWithEmail(email, tempPassword);
                    authUserId = firebaseUser.uid;
                    console.log(`Firebase Auth user created: ${authUserId}`);
                }

                // Prepare user document data
                userRef = doc(db, 'users', authUserId);
                const docData = {
                    userId: authUserId,
                    email,
                    firstName,
                    lastName,
                    displayName: full || email,
                    primaryCompanyId: `companies/${companyId}`, // New field for multi-company
                    companyId: `companies/${companyId}`, // Keep for backward compatibility
                    status: 'active',
                    tempPassword,
                    isOnboardingCompleted: false,
                    isOnboardingMandatory: u.isOnboardingMandatory || false,
                    weekStartDay: companyWeekStartDay, // Set company's week start day
                    createdAt: isExistingUser ? undefined : now, // Don't overwrite if existing
                    updatedAt: now,
                    shift: 'day', // Default shift
                    shiftUpdatedAt: now,
                };

                // Create or update user document
                if (isExistingUser) {
                    // Update existing user with new primary company
                    const existingUserSnap = await getDoc(userRef);
                    if (existingUserSnap.exists()) {
                        const existingData = existingUserSnap.data();
                        const companyProfiles = existingData.companyProfiles || [];

                        batch.update(userRef, {
                            primaryCompanyId: `companies/${companyId}`,
                            companyId: `companies/${companyId}`, // Update for backward compatibility
                            weekStartDay: companyWeekStartDay, // Update with company's week start day
                            updatedAt: now
                        });
                    } else {
                        // User exists in Auth but not in Firestore - create document
                        batch.set(userRef, docData);
                    }
                } else {
                    // New user - create document
                    batch.set(userRef, docData);
                }

                // Create company profile (Atomic with batch)
                const profileData = {
                    primaryRole,
                    roles: [primaryRole],
                    siteId: `sites/${siteId}`,
                    teamId: reportsToRaw || null,
                    reportsTo: reportsToRaw,
                    managerUserId: reportsToRaw || null,
                    weekStartDay: companyWeekStartDay, // Set company's week start day in profile
                };

                // Add to batch using the updated service
                await createUserCompanyProfile(authUserId, companyId, profileData, batch);

                created.push({
                    userId: authUserId,     // ← Use userId consistently
                    id: authUserId,        // Keep for backward compatibility
                    ...docData,
                    _profileData: profileData,
                    _isExistingUser: isExistingUser
                });

                // If reportsTo is a specific manager userId (not a role tag), create assignment
                const isManagerId = reportsToRaw && !managerRoleTags.has(reportsToRaw);
                if (isManagerId) {
                    const assignmentRef = doc(collection(db, 'assignments'));
                    const assignment = {
                        employeeId: authUserId,
                        managerId: reportsToRaw,
                        companyId: companyId,
                        siteId: siteId,
                        createdAt: now,
                        updatedAt: now,
                        source: 'siteManagerAdd'
                    };
                    batch.set(assignmentRef, assignment);

                    // Update manager document with managedEmployees array
                    const managerRef = doc(db, 'users', reportsToRaw);
                    batch.update(managerRef, { managedEmployees: arrayUnion(authUserId), updatedAt: now });
                }

            } catch (error) {
                console.error(`Failed to create user ${email}:`, error);
                localStorage.removeItem('isCreatingUsers');
                throw new Error(`Failed to create user ${email}: ${error.message}`);
            }
        }

        // 3) Increment currentEmployeeCount by added users in the same batch
        batch.update(companyRef, { currentEmployeeCount: increment(toAdd), updatedAt: now });

        // Commit all writes atomically
        await batch.commit();
        console.log(`Successfully committed batch for ${created.length} users`);

        // ──────────────────────────────────────────────────────────────────
        // 4) Best-effort sync to Central Platform Postgres
        //    So users created here are visible on the owner's /owner-users page.
        //    Uses the Central access token stored after SSO bridge login.
        // ──────────────────────────────────────────────────────────────────
        try {
            const centralApiUrl = import.meta.env.VITE_CENTRAL_API_URL || 'http://localhost:5000';
            const centralToken  = localStorage.getItem('mprar_central_token');
            const cleanCompanyId = companyId.replace('companies/', '');

            if (centralToken && centralApiUrl) {
                await Promise.allSettled(
                    created
                        .filter(u => !u._isExistingUser)  // only sync brand new users
                        .map(u => fetch(`${centralApiUrl}/companies/${cleanCompanyId}/users`, {
                            method:  'POST',
                            headers: {
                                'Content-Type':  'application/json',
                                'Authorization': `Bearer ${centralToken}`,
                            },
                            body: JSON.stringify({
                                email:       u.email,
                                firstName:   u.firstName,
                                lastName:    u.lastName,
                                hrRole:      u._profileData?.primaryRole || 'employee',
                                centralRole: null,
                            }),
                        })
                        .then(async res => {
                            if (!res.ok) {
                                const err = await res.json().catch(() => ({}));
                                console.warn('[HR→Central sync] Non-fatal error for', u.email, err.error || res.status);
                            } else {
                                console.info('[HR→Central sync] Synced', u.email, 'to Central Postgres');
                            }
                        })
                        .catch(err => console.warn('[HR→Central sync] Network error for', u.email, err.message))
                        )
                );
            }
        } catch (syncErr) {
            // Non-blocking: HR users are created in Firestore regardless
            console.warn('[HR→Central sync] Failed (non-fatal):', syncErr.message);
        }

        // Create automatic sick leave allowances for new employees
        try {
            const { automaticAllowanceService } = await import('./automaticAllowanceService');
            for (const user of created) {
                await automaticAllowanceService.ensureEmployeeSickLeave(user.userId, user);
            }
            console.log(`Processed automatic sick leave allowances for ${created.length} new employees`);
        } catch (error) {
            console.error('Error creating automatic sick leave allowances:', error);
            // Don't fail the entire user creation process if allowance creation fails
        }

        // Clear the flag to allow normal auth behavior
        localStorage.removeItem('isCreatingUsers');

        try { console.log('Users added with assignments (batch):', created); } catch (_) { }

        // Clear cache after successful user creation - DB updated, cache must reflect immediately
        try {
            const { invalidateCompanyCache } = await import('./cacheInvalidationService');
            await invalidateCompanyCache(companyId);
        } catch (_) { }

        return { ok: true, created };
    } catch (error) {
        // Clear the flag on any error
        localStorage.removeItem('isCreatingUsers');
        throw error;
    }
}

export async function updateUserBySiteManager(userId, updates, contextCompanyId = null) {
    // Only allow updating safe fields
    const allowed = ['displayName', 'firstName', 'lastName', 'primaryRole', 'roles', 'reportsTo', 'managerUserId', 'status', 'updatedAt', 'rates', 'cisDeduction', 'utrNumber', 'siteId', 'companyId'];
    const payload = {};
    for (const k of allowed) {
        if (k in updates) payload[k] = updates[k];
    }
    payload.updatedAt = serverTimestamp();

    const ref = doc(db, 'users', userId);

    // 1. Update the User Document (Legacy & Global Source)
    await updateDoc(ref, payload);
    try { console.log('User updated (doc):', userId, payload); } catch (_) { }

    // 2. Update the User Company Profile (Multi-Company Source)
    try {
        // We need to know which company to update. 
        // Use contextCompanyId if provided (preferred), otherwise infer from user doc.
        let targetCompanyId = contextCompanyId;

        if (!targetCompanyId) {
            const userSnap = await getDoc(ref);
            if (userSnap.exists()) {
                const userData = userSnap.data();
                targetCompanyId = userData.primaryCompanyId || userData.companyId;
            }
        }

        if (targetCompanyId) {
            // Ensure ID format
            const cleanCompanyId = targetCompanyId.replace('companies/', '');

            // Find the profile
            const { getActiveCompanyProfile } = await import('./userCompanyProfiles');
            const profile = await getActiveCompanyProfile(userId, cleanCompanyId);

            if (profile) {
                const profileUpdates = {
                    updatedAt: serverTimestamp()
                };

                // Map fields
                if (payload.primaryRole) {
                    profileUpdates.primaryRole = payload.primaryRole;
                    profileUpdates.roles = [payload.primaryRole]; // Simplify roles sync for now
                }
                if (payload.siteId) profileUpdates.siteId = payload.siteId;
                if (payload.reportsTo !== undefined) profileUpdates.reportsTo = payload.reportsTo;
                if (payload.managerUserId !== undefined) profileUpdates.managerUserId = payload.managerUserId;
                if (payload.teamId !== undefined) profileUpdates.teamId = payload.teamId;
                if (payload.status) profileUpdates.status = payload.status; // This will now receive 'Active' or 'Archived' from UI
                if (payload.rates) profileUpdates.rates = payload.rates;
                if (payload.cisDeduction) profileUpdates.cisDeduction = payload.cisDeduction;
                if (payload.utrNumber) profileUpdates.utrNumber = payload.utrNumber;

                // Execute Update
                const profileRef = doc(db, 'userCompanyProfiles', profile.id);
                await updateDoc(profileRef, profileUpdates);
                console.log('User Profile updated:', profile.id, profileUpdates);
            } else {
                console.warn(`No active profile found for user ${userId} in ${cleanCompanyId} to update`);
                // Optional: Create one if missing? Best to leave it to migration/repair scripts.
            }
        }
    } catch (err) {
        console.error('Failed to update user company profile:', err);
        // We don't throw here to avoid failing the whole operation if just the profile sync fails
        // but this implies data inconsistency.
    }

    // Clear cache after user update - DB updated, cache must reflect immediately
    try {
        const { invalidateCompanyCache, invalidateAllCache } = await import('./cacheInvalidationService');
        if (contextCompanyId) {
            await invalidateCompanyCache(contextCompanyId);
        } else {
            await invalidateAllCache();
        }
    } catch (_) { }

    return { ok: true };
}

export async function setUserStatus(userId, status) {
    const allowed = ['Active', 'Inactive', 'Archived', 'active', 'inactive', 'archived'];
    if (!allowed.includes(status)) throw new Error('Invalid status');
    const ref = doc(db, 'users', userId);
    await updateDoc(ref, { status, updatedAt: serverTimestamp() });
    try { console.log('User status updated:', userId, status); } catch (_) { }
    try {
        const { invalidateAllCache } = await import('./cacheInvalidationService');
        await invalidateAllCache();
    } catch (_) { }
    return { ok: true };
}

/**
 * Update employment details for a user
 * @param {string} userId - User document ID
 * @param {Object} employmentData - Employment details object
 * @param {string} updatedBy - ID of user making the update
 * @returns {Promise<Object>} Success response or throws error
 */
export async function updateUserEmploymentDetails(userId, employmentData, updatedBy) {
    try {
        // Validate employment data
        const validation = validateEmploymentData(employmentData);
        if (!validation.isValid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Transform data for storage
        const transformedData = transformEmploymentDataForStorage(employmentData, updatedBy);

        // Update user document with employment details
        const userRef = doc(db, 'users', userId);
        const updateData = {
            employmentDetails: transformedData,
            updatedAt: serverTimestamp()
        };

        await updateDoc(userRef, updateData);

        try {
            console.log('Employment details updated:', userId, transformedData);
        } catch (_) { }

        // Clear cache after employment details update
        try {
            const { invalidateAllCache } = await import('./cacheInvalidationService');
            await invalidateAllCache();
        } catch (_) { }

        return {
            ok: true,
            employmentDetails: transformedData
        };

    } catch (error) {
        console.error('Error updating employment details:', error);
        throw new Error(`Failed to update employment details: ${error.message}`);
    }
}

/**
 * Get employment details for a user
 * @param {string} userId - User document ID
 * @returns {Promise<Object|null>} Employment details or null if not found
 */
export async function getUserEmploymentDetails(userId) {
    try {
        // First, try to get from user document
        const userRef = doc(db, 'users', userId);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
            return null;
        }

        const userData = userSnap.data();
        let employmentDetails = userData.employmentDetails || {};

        // Also fetch from HR Onboarding profile if it exists
        try {
            const hrProfilesRef = collection(db, 'hrOnboardingProfiles');
            const q = query(hrProfilesRef, where('userId', '==', userId));
            const hrSnapshot = await getDocs(q);

            if (!hrSnapshot.empty) {
                const hrProfile = hrSnapshot.docs[0].data();
                const hrFields = hrProfile.sections?.employmentDetails?.fields || {};

                // Merge HR onboarding data with user employment details
                // HR onboarding data takes precedence as it's more recent/complete
                const mergedDetails = {
                    // Position Details
                    jobTitle: hrFields.jobTitle?.value || employmentDetails.jobTitle || '',
                    department: hrFields.department?.value || employmentDetails.department || '',
                    employmentType: hrFields.employmentType?.value || employmentDetails.employmentType || '',
                    startDate: hrFields.startDate?.value || employmentDetails.startDate || '',
                    probationPeriod: hrFields.probationPeriod?.value || employmentDetails.probationPeriod || '',

                    // Work Location
                    primaryWorkLocation: hrFields.primaryWorkLocation?.value || employmentDetails.primaryWorkLocation || '',
                    workPattern: hrFields.workPattern?.value || employmentDetails.workPattern || '',
                    officeAddress: hrFields.officeAddress?.value || employmentDetails.officeAddress || '',

                    // Bank Details
                    bankAccountName: hrFields.bankAccountName?.value || employmentDetails.bankAccountName || '',
                    bankName: hrFields.bankName?.value || employmentDetails.bankName || '',
                    bankAccountNumber: hrFields.bankAccountNumber?.value || employmentDetails.bankAccountNumber || '',
                    sortCode: hrFields.sortCode?.value || employmentDetails.sortCode || '',
                    branchName: hrFields.branchName?.value || employmentDetails.branchName || '',
                    iban: hrFields.iban?.value || employmentDetails.iban || '',

                    // Compensation
                    annualSalary: hrFields.annualSalary?.value || employmentDetails.annualSalary || '',
                    payFrequency: hrFields.payFrequency?.value || employmentDetails.payFrequency || '',
                    hourlyRate: hrFields.hourlyRate?.value || employmentDetails.hourlyRate || '',
                    chargeRate: hrFields.chargeRate?.value || employmentDetails.chargeRate || '',
                    benefits: hrFields.benefits?.value || employmentDetails.benefits || '',

                    // Additional Notes
                    adminNotes: hrFields.adminNotes?.value || employmentDetails.adminNotes || employmentDetails.notes || ''
                };

                return mergedDetails;
            }
        } catch (hrError) {
            console.warn('Could not fetch HR onboarding data, using user employment details:', hrError);
        }

        // Return user employment details if no HR profile found
        return employmentDetails;

    } catch (error) {
        console.error('Error fetching employment details:', error);
        throw new Error(`Failed to fetch employment details: ${error.message}`);
    }
}

/**
 * Get user details by user ID
 * @param {string} userId - User document ID
 * @returns {Promise<Object|null>} User data or null if not found
 */
export async function getUserById(userId) {
    try {
        const userRef = doc(db, 'users', userId);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
            return null;
        }

        const userData = userSnap.data();
        return {
            userId: userId,     // ← Use userId consistently
            id: userId,        // Keep for backward compatibility
            ...userData
        };

    } catch (error) {
        console.error('Error fetching user:', error);
        throw new Error(`Failed to fetch user: ${error.message}`);
    }
}

/**
 * Get onboarding details for a user
 * @param {string} userId - User document ID
 * @returns {Promise<Object|null>} Onboarding data or null if not found
 */
export async function getUserOnboardingDetails(userId) {
    try {
        const onboardingRef = doc(db, 'onboardings', userId);
        const onboardingSnap = await getDoc(onboardingRef);

        if (!onboardingSnap.exists()) {
            return null;
        }

        return {
            userId: userId,     // ← Use userId consistently
            id: userId,        // Keep for backward compatibility
            ...onboardingSnap.data()
        };

    } catch (error) {
        console.error('Error fetching onboarding details:', error);
        throw new Error(`Failed to fetch onboarding details: ${error.message}`);
    }
}

/**
 * Generate and optionally store an employee ID for a user
 * @param {Object} userData - User data object
 * @param {string} userId - User document ID
 * @param {boolean} store - Whether to store the generated ID back to the database
 * @returns {string} Generated employee ID
 */
export function generateEmployeeId(userData, userId, store = false) {
    try {
        const year = new Date().getFullYear();
        const firstName = userData.firstName || '';
        const lastName = userData.lastName || '';

        // Try to create initials-based ID
        if (firstName && lastName) {
            const initials = (firstName.charAt(0) + lastName.charAt(0)).toUpperCase();
            const shortId = userId.slice(-4);
            return `${initials}${year}${shortId}`;
        }

        // Fallback to standard format
        const shortId = userId.slice(-4);
        return `EMP${year}${shortId}`;

    } catch (error) {
        console.error('Error generating employee ID:', error);
        return `EMP${new Date().getFullYear()}${userId.slice(-4)}`;
    }
}

/**
 * Get all users by company ID
 * @param {string} companyId - Company ID
 * @returns {Promise<Array>} Array of users in the company
 */
export async function getUsersByCompany(companyId) {
    try {
        const rawId = companyId.replace('companies/', '');
        const pathId = `companies/${rawId}`;

        const usersRef = collection(db, 'users');
        const q = query(
            usersRef,
            where('companyId', 'in', [rawId, pathId])
        );

        const querySnapshot = await getDocs(q);
        const users = [];

        querySnapshot.forEach((doc) => {
            const userData = doc.data();
            const status = (userData.status || '').toLowerCase();
            // Client-side filtering for status and role to avoid Firestore query limitations
            if (status === 'active' && userData.primaryRole !== 'siteManager') {
                users.push({
                    userId: doc.id,     // ← Use userId consistently
                    id: doc.id,        // Keep for backward compatibility
                    ...userData
                });
            }
        });

        return users;
    } catch (error) {
        console.error('Error fetching users by company:', error);
        throw new Error('Failed to fetch users');
    }
}

/**
 * Archive a user's company profile (soft delete from company)
 * @param {string} userId - User document ID
 * @param {string} companyId - Company ID (optional, uses user's current company if not provided)
 * @returns {Promise<Object>} Success response
 */
export async function archiveUser(userId, companyId = null) {
    try {
        // Import company profile service
        const { archiveCompanyProfile } = await import('./userCompanyProfiles');

        // Get user's company if not provided
        let targetCompanyId = companyId;
        if (!targetCompanyId) {
            const userRef = doc(db, 'users', userId);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
                const userData = userSnap.data();
                targetCompanyId = userData.primaryCompanyId || userData.companyId;
            }
        }

        if (!targetCompanyId) {
            throw new Error('Cannot determine company for user');
        }

        // Archive the company profile
        await archiveCompanyProfile(userId, targetCompanyId);

        console.log(`User ${userId} archived from company ${targetCompanyId}`);

        // [FIX] Decrement employee count to release seat
        const cleanCompanyId = targetCompanyId.replace('companies/', '');
        const companyRef = doc(db, 'companies', cleanCompanyId);
        try {
            await updateDoc(companyRef, {
                currentEmployeeCount: increment(-1),
                updatedAt: serverTimestamp()
            });
        } catch (err) {
            console.error('Failed to decrement employee count:', err);
            // Non-fatal, but seat count will be off
        }

        // Clear cache - DB updated, cache must reflect immediately
        try {
            const { invalidateCompanyCache } = await import('./cacheInvalidationService');
            await invalidateCompanyCache(cleanCompanyId);
        } catch (_) { }

        return { ok: true };
    } catch (error) {
        console.error('Error archiving user:', error);
        throw new Error(`Failed to archive user: ${error.message}`);
    }
}

/**
 * Unarchive a user's company profile
 * @param {string} userId - User document ID
 * @param {string} companyId - Company ID (optional, uses user's last company if not provided)
 * @returns {Promise<Object>} Success response
 */
export async function unarchiveUser(userId, companyId = null) {
    try {
        // Import company profile service
        const { unarchiveCompanyProfile } = await import('./userCompanyProfiles');

        // Get user's company if not provided
        let targetCompanyId = companyId;
        if (!targetCompanyId) {
            const userRef = doc(db, 'users', userId);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
                const userData = userSnap.data();
                targetCompanyId = userData.primaryCompanyId || userData.companyId;
            }
        }

        if (!targetCompanyId) {
            throw new Error('Cannot determine company for user');
        }

        // Unarchive the company profile
        await unarchiveCompanyProfile(userId, targetCompanyId);

        console.log(`User ${userId} unarchived for company ${targetCompanyId}`);

        // [FIX] Increment employee count to consume seat
        const cleanCompanyId = targetCompanyId.replace('companies/', '');
        const companyRef = doc(db, 'companies', cleanCompanyId);
        try {
            await updateDoc(companyRef, {
                currentEmployeeCount: increment(1),
                updatedAt: serverTimestamp()
            });
        } catch (err) {
            console.error('Failed to increment employee count:', err);
        }

        // Clear cache - DB updated, cache must reflect immediately
        try {
            const { invalidateCompanyCache } = await import('./cacheInvalidationService');
            await invalidateCompanyCache(cleanCompanyId);
        } catch (_) { }

        return { ok: true };
    } catch (error) {
        console.error('Error unarchiving user:', error);
        throw new Error(`Failed to unarchive user: ${error.message}`);
    }
}


/**
 * Subscribe to real-time updates for users in a company
 * @param {string} companyId - Company ID
 * @param {Function} onUpdate - Callback function with (users)
 * @param {Function} onError - Callback function with (error)
 * @param {Object} options - Optional configuration
 * @param {string} options.status - Filter by status ('active', 'archived', 'inactive', or null for all)
 * @param {number} options.limit - Maximum number of users to fetch (default: 1000)
 * @returns {Function} Unsubscribe function
 */
export function subscribeToCompanyUsers(companyId, onUpdate, onError, options = {}) {
    if (!companyId) return () => { };

    try {
        const usersRef = collection(db, 'users');
        const { status = 'active', limit: maxLimit = 1000 } = options;

        const rawId = companyId.replace('companies/', '');
        const pathId = `companies/${rawId}`;

        // SCALABILITY: Build query with optional status filter and required limit
        // Query both formats to handle legacy + bridge-created users
        let q = query(
            usersRef,
            where('companyId', 'in', [rawId, pathId])
        );

        // Add status filter if specified
        if (status) {
            const lowerStatus = status.toLowerCase();
            if (lowerStatus === 'active') {
                q = query(q, where('status', 'in', ['active', 'Active']));
            } else if (lowerStatus === 'archived') {
                q = query(q, where('status', 'in', ['archived', 'Archived']));
            } else {
                q = query(q, where('status', '==', status));
            }
        }

        // SCALABILITY: Always add limit to prevent unbounded queries
        q = query(q, limit(maxLimit));

        const statusMsg = status ? ` (${status} users only)` : ' (all users)';
        console.log(`[users] Setting up real-time listener for company: ${companyId}${statusMsg} (limited to ${maxLimit} users)`);

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const users = [];
            snapshot.forEach((doc) => {
                users.push({
                    userId: doc.id,     // ← Use userId consistently
                    id: doc.id,        // Keep for backward compatibility
                    ...doc.data()
                });
            });
            onUpdate(users);
        }, (error) => {
            console.error('[users] Real-time listener error:', error);
            if (onError) onError(error);
        });

        return unsubscribe;
    } catch (error) {
        console.error('[users] Failed to set up listener:', error);
        if (onError) onError(error);
        return () => { };
    }
}

/**
 * Alias for archiveUser to maintain backward compatibility
 */
export const deleteUser = archiveUser;
