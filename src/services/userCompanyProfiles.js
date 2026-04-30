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
    serverTimestamp,
    writeBatch
} from 'firebase/firestore';

/**
 * User Company Profile Service
 * Manages user associations with multiple companies
 */

const COLLECTION_NAME = 'userCompanyProfiles';

/**
 * Create a new company profile for a user
 * @param {string} userId - Firebase Auth user ID
 * @param {string} companyId - Company ID
 * @param {Object} profileData - Profile data (role, siteId, etc.)
 * @returns {Promise<Object>} Created profile
 */
export async function createUserCompanyProfile(userId, companyId, profileData = {}, batch = null) {
    try {
        const profileRef = doc(collection(db, COLLECTION_NAME));
        const profileId = profileRef.id;

        const profile = {
            userId,
            companyId: companyId.includes('/') ? companyId : `companies/${companyId}`,
            status: 'active', // Use lowercase 'active' for DB consistency
            joinedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            ...profileData
        };

        if (batch) {
            batch.set(profileRef, profile);
        } else {
            await setDoc(profileRef, profile);
        }

        // Update user document to add this profile reference
        const userRef = doc(db, 'users', userId);

        // Note: In a batch context, we might not be able to read safely if we just created the user in the same batch.
        // However, arrayUnion is safe to use blindly.
        // But we also need to set 'primaryCompanyId'.

        const { arrayUnion } = await import('firebase/firestore');

        const userUpdates = {
            companyProfiles: arrayUnion(profileId),
            primaryCompanyId: profile.companyId,
            updatedAt: serverTimestamp()
        };

        if (batch) {
            batch.update(userRef, userUpdates);
        } else {
            // For non-batch, we can be more careful (read-then-write pattern logic was here, but standard update is fine)
            await updateDoc(userRef, userUpdates);
        }

        console.log(`Created company profile ${profileId} for user ${userId} at company ${companyId}`);
        return { id: profileId, ...profile };

    } catch (error) {
        console.error('Error creating user company profile:', error);
        throw new Error(`Failed to create company profile: ${error.message}`);
    }
}

/**
 * Get all company profiles for a user
 * @param {string} userId - Firebase Auth user ID
 * @returns {Promise<Array>} Array of company profiles
 */
export async function getUserCompanyProfiles(userId) {
    try {
        const profilesRef = collection(db, COLLECTION_NAME);
        const q = query(profilesRef, where('userId', '==', userId));
        const snapshot = await getDocs(q);

        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    } catch (error) {
        console.error('Error fetching user company profiles:', error);
        throw new Error(`Failed to fetch company profiles: ${error.message}`);
    }
}

/**
 * Get company profile for a user at a specific company (regardless of status)
 * @param {string} userId - Firebase Auth user ID
 * @param {string} companyId - Company ID
 * @returns {Promise<Object|null>} Company profile or null
 */
export async function getCompanyProfile(userId, companyId) {
    try {
        const normalizedCompanyId = companyId.includes('/') ? companyId : `companies/${companyId}`;
        const profilesRef = collection(db, COLLECTION_NAME);
        const q = query(
            profilesRef,
            where('userId', '==', userId),
            where('companyId', '==', normalizedCompanyId)
        );

        const snapshot = await getDocs(q);

        if (snapshot.empty) return null;

        const doc = snapshot.docs[0];
        return { id: doc.id, ...doc.data() };
    } catch (error) {
        console.error('Error fetching company profile:', error);
        throw new Error(`Failed to fetch company profile: ${error.message}`);
    }
}

/**
 * Get active company profile for a user at a specific company
 * @param {string} userId - Firebase Auth user ID
 * @param {string} companyId - Company ID
 * @returns {Promise<Object|null>} Company profile or null
 */
export async function getActiveCompanyProfile(userId, companyId) {
    try {
        const normalizedCompanyId = companyId.includes('/') ? companyId : `companies/${companyId}`;
        const profilesRef = collection(db, COLLECTION_NAME);
        const q = query(
            profilesRef,
            where('userId', '==', userId),
            where('companyId', '==', normalizedCompanyId),
            where('status', '==', 'active')
        );

        const snapshot = await getDocs(q);

        if (snapshot.empty) return null;

        const doc = snapshot.docs[0];
        return { id: doc.id, ...doc.data() };
    } catch (error) {
        console.error('Error fetching active company profile:', error);
        throw new Error(`Failed to fetch company profile: ${error.message}`);
    }
}

/**
 * Get all users for a company (via company profiles)
 * @param {string} companyId - Company ID
 * @param {string} status - Filter by status (Active, Archived, all)
 * @returns {Promise<Array>} Array of users with their profiles
 */
export async function getUsersByCompanyProfile(companyId, status = 'active') {
    try {
        const normalizedCompanyId = companyId.includes('/') ? companyId : `companies/${companyId}`;
        const profilesRef = collection(db, COLLECTION_NAME);

        let q;
        if (status === 'all') {
            q = query(profilesRef, where('companyId', '==', normalizedCompanyId));
        } else {
            q = query(
                profilesRef,
                where('companyId', '==', normalizedCompanyId),
                where('status', '==', status)
            );
        }

        const snapshot = await getDocs(q);
        const profiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Fetch user details for each profile
        const userIds = [...new Set(profiles.map(p => p.userId))];
        const users = await Promise.all(
            userIds.map(async (userId) => {
                const userRef = doc(db, 'users', userId);
                const userSnap = await getDoc(userRef);
                return userSnap.exists() ? { id: userId, ...userSnap.data() } : null;
            })
        );

        const userMap = {};
        users.filter(Boolean).forEach(user => {
            userMap[user.id] = user;
        });

        // Merge user data with profiles
        return profiles.map(profile => ({
            ...profile,
            user: userMap[profile.userId] || null
        }));

    } catch (error) {
        console.error('Error fetching users by company profile:', error);
        throw new Error(`Failed to fetch company users: ${error.message}`);
    }
}

/**
 * Archive a user's company profile
 * @param {string} userId - Firebase Auth user ID
 * @param {string} companyId - Company ID
 * @returns {Promise<Object>} Updated profile
 */
export async function archiveCompanyProfile(userId, companyId) {
    try {
        // Get profile regardless of current status
        const profile = await getCompanyProfile(userId, companyId);

        if (!profile) {
            // User doesn't have a company profile yet (pre-migration user)
            // Create one first, then archive it
            console.warn(`User ${userId} has no company profile for ${companyId}. Creating one before archiving.`);

            // Get user data to populate profile
            const userRef = doc(db, 'users', userId);
            const userSnap = await getDoc(userRef);

            if (!userSnap.exists()) {
                throw new Error('User not found');
            }

            const userData = userSnap.data();
            const normalizedCompanyId = companyId.includes('/') ? companyId : `companies/${companyId}`;

            // Create profile with user's current data
            const profileRef = doc(collection(db, COLLECTION_NAME));
            const profileId = profileRef.id;

            const newProfile = {
                userId,
                companyId: normalizedCompanyId,
                status: 'Archived', // Capitalized 'Archived' directly
                joinedAt: userData.createdAt || serverTimestamp(),
                createdAt: serverTimestamp(),
                archivedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                // Copy user's company-specific data
                primaryRole: userData.primaryRole || 'employee',
                roles: userData.roles || [userData.primaryRole || 'employee'],
                siteId: userData.siteId || null,
                reportsTo: userData.reportsTo || null,
                managerUserId: userData.managerUserId || null,
                teamId: userData.teamId || null,
            };

            await setDoc(profileRef, newProfile);

            // Update user document
            const companyProfiles = userData.companyProfiles || [];
            await updateDoc(userRef, {
                companyProfiles: [...companyProfiles, profileId],
                primaryCompanyId: null, // No active company
                status: 'Archived', // Sync status capitalized
                archived: true,
                updatedAt: serverTimestamp()
            });

            console.log(`Created and archived company profile ${profileId} for user ${userId}`);
            return { id: profileId, ...newProfile };
        }

        // Normal flow: archive existing profile
        const profileRef = doc(db, COLLECTION_NAME, profile.id);
        const updates = {
            status: 'Archived', // Capitalized status
            archivedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };

        await updateDoc(profileRef, updates);

        // Check if user has other active profiles
        const allProfiles = await getUserCompanyProfiles(userId);
        // Check for 'Active' to handle existing data
        const activeProfiles = allProfiles.filter(p =>
            (p.status === 'active') && p.id !== profile.id
        );

        // Update user's primary company if needed
        const userRef = doc(db, 'users', userId);
        if (activeProfiles.length > 0) {
            // Set another active profile as primary
            await updateDoc(userRef, {
                primaryCompanyId: activeProfiles[0].companyId,
                updatedAt: serverTimestamp()
            });
        } else {
            // No active profiles left
            // Also update the legacy 'status' field so UserListPage filters work correctly
            await updateDoc(userRef, {
                primaryCompanyId: null,
                status: 'Archived', // Capitalized status
                archived: true,
                updatedAt: serverTimestamp()
            });
        }

        console.log(`Archived company profile ${profile.id} for user ${userId}`);
        return { id: profile.id, ...updates };

    } catch (error) {
        console.error('Error archiving company profile:', error);
        throw new Error(`Failed to archive company profile: ${error.message}`);
    }
}

/**
 * Unarchive (reactivate) a user's company profile
 * @param {string} userId - Firebase Auth user ID
 * @param {string} companyId - Company ID
 * @returns {Promise<Object>} Updated profile
 */
export async function unarchiveCompanyProfile(userId, companyId) {
    try {
        const normalizedCompanyId = companyId.includes('/') ? companyId : `companies/${companyId}`;
        const profilesRef = collection(db, COLLECTION_NAME);

        // Check for ANY profile for this user/company, not just archived ones
        const q = query(
            profilesRef,
            where('userId', '==', userId),
            where('companyId', '==', normalizedCompanyId)
        );

        const snapshot = await getDocs(q);
        let profileId;

        if (snapshot.empty) {
            console.warn(`No profile found for user ${userId} to unarchive. Creating new active profile.`);
            // Create new active profile for legacy user
            const newProfile = await createUserCompanyProfile(userId, companyId, { status: 'active' });
            profileId = newProfile.id;
        } else {
            const profileDoc = snapshot.docs[0];
            profileId = profileDoc.id;

            // Only update if not already active
            const currentStatus = profileDoc.data().status;
            if (currentStatus !== 'Active') {
                const profileRef = doc(db, COLLECTION_NAME, profileId);
                await updateDoc(profileRef, {
                    status: 'active', // Lowercase 'active'
                    archivedAt: null,
                    reactivatedAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                });
            }
        }

        // ALWAYS ensure user document is updated to Active state
        const userRef = doc(db, 'users', userId);
        await updateDoc(userRef, {
            primaryCompanyId: normalizedCompanyId,
            status: 'active', // [FIX] Use lowercase 'active' to match standardized status
            archived: false,
            updatedAt: serverTimestamp()
        });

        // [FIX] Increment currentEmployeeCount to occupy seat
        const cleanCompanyId = normalizedCompanyId.replace('companies/', '');
        const companyRef = doc(db, 'companies', cleanCompanyId);
        try {
            await updateDoc(companyRef, {
                currentEmployeeCount: increment(1),
                updatedAt: serverTimestamp()
            });
            console.log(`Incremented currentEmployeeCount for company ${cleanCompanyId}`);
        } catch (err) {
            console.error('Failed to increment employee count:', err);
            // Non-fatal, but seat count will be off
        }

        console.log(`Unarchived/Activated user ${userId} for company ${companyId}`);
        return { id: profileId, status: 'active' };

    } catch (error) {
        console.error('Error unarchiving company profile:', error);
        throw new Error(`Failed to unarchive company profile: ${error.message}`);
    }
}

/**
 * Check if a user has any profile (active or archived) with a company
 * @param {string} userId - Firebase Auth user ID
 * @param {string} companyId - Company ID
 * @returns {Promise<Object|null>} Profile if exists, null otherwise
 */
export async function hasCompanyProfile(userId, companyId) {
    try {
        const normalizedCompanyId = companyId.includes('/') ? companyId : `companies/${companyId}`;
        const profilesRef = collection(db, COLLECTION_NAME);
        const q = query(
            profilesRef,
            where('userId', '==', userId),
            where('companyId', '==', normalizedCompanyId)
        );

        const snapshot = await getDocs(q);

        if (snapshot.empty) return null;

        const doc = snapshot.docs[0];
        return { id: doc.id, ...doc.data() };
    } catch (error) {
        console.error('Error checking company profile:', error);
        return null;
    }
}
