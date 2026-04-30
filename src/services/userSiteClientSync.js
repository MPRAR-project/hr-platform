import { doc, getDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase/client';
import { createAssignment, getActiveAssignments, endAssignment } from './userAssignments';
import { getSite } from './sites';

/**
 * CENTRALIZED function to update user's site and client assignment
 * Use this EVERYWHERE to ensure consistency across the app
 * 
 * Handles:
 * - Ending old assignments
 * - Creating new assignments
 * - Updating user document
 * - Validating site has client
 * - CLEARING assignments (setting to null)
 * 
 * @param {string} userId - User ID
 * @param {string} newSiteId - New site ID (or null to remove)
 * @param {string} newClientId - Optional: explicit client ID (if not provided, gets from site)
 * @returns {Promise<Object>} Result with success status and details
 */
export async function updateUserSiteAndClient(userId, newSiteId, newClientId = null) {
    try {
        console.log('[Sync] ========= SYNC STARTED =========');
        console.log('[Sync] Input:', { userId, newSiteId, newClientId });

        // Get user's current state
        const userRef = doc(db, 'users', userId);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
            throw new Error('User not found');
        }

        const userData = userSnap.data();
        const currentSiteId = userData.siteId?.includes('/')
            ? userData.siteId.split('/')[1]
            : userData.siteId;
        const currentClientId = userData.clientId;

        console.log('[Sync] Current state:', { currentSiteId, currentClientId, companyId: userData.companyId });

        // Normalize values for comparison - treat null, undefined, and empty string as equivalent
        const normalizedCurrentSiteId = currentSiteId || null;
        const normalizedNewSiteId = newSiteId || null;
        const normalizedCurrentClientId = currentClientId || null;
        const normalizedNewClientId = newClientId || null;

        // If no change (including null to null), return early
        if (normalizedCurrentSiteId === normalizedNewSiteId && normalizedCurrentClientId === normalizedNewClientId) {
            console.log('[Sync] No changes detected (values are equivalent), skipping');
            console.log('[Sync] ========= SYNC ENDED (no changes) =========');
            return { success: true, changed: false };
        }

        console.log('[Sync] Change detected:', {
            siteChange: normalizedCurrentSiteId !== normalizedNewSiteId,
            clientChange: normalizedCurrentClientId !== normalizedNewClientId
        });

        // Get companyId
        const companyId = userData.companyId?.includes('/')
            ? userData.companyId.split('/')[1]
            : userData.companyId;

        let finalClientId = newClientId || null;

        // If site is provided but no explicit clientId, get it from site
        if (newSiteId && !finalClientId) {
            const site = await getSite(newSiteId);
            if (!site) {
                // Site not found - warn but don't fail, proceed without site
                console.warn(`[Sync] Site ${newSiteId} not found in database - proceeding without site assignment`);
                newSiteId = null; // Clear the site ID since it doesn't exist
            } else if (!site.clientId) {
                // Site has no client - that's okay, we can still assign to site only
                console.log(`[Sync] Site ${newSiteId} has no client assigned - proceeding without client`);
            } else {
                finalClientId = site.clientId;
                console.log('[Sync] Resolved clientId from site:', finalClientId);
            }
        }

        // Log if we're clearing assignments
        if (!newSiteId && !finalClientId) {
            console.log('[Sync] CLEARING site and client assignment for user');
        }

        // Step 1: DELETE old assignment(s) completely if client is changing (fresh start)
        if (currentClientId && currentClientId !== finalClientId) {
            console.log(`[Sync] Client changing from ${currentClientId} to ${finalClientId}, DELETING old assignments`);
            const oldAssignments = await getActiveAssignments(userId, currentClientId);
            for (const assignment of oldAssignments) {
                // DELETE completely instead of ending - allows fresh creation
                const assignmentRef = doc(db, 'userAssignments', assignment.id);
                await deleteDoc(assignmentRef);
                console.log(`[Sync] DELETED assignment ${assignment.id}`);
            }
        }

        // Step 2: Create/Update assignment if we have a client (site is optional)
        if (finalClientId) {
            console.log(`[Sync] Creating/updating assignment for user ${userId} -> client ${finalClientId}`);
            try {
                // Get rates - support BOTH field formats!
                const chargeRate = Number(userData.rates?.chargeBackBasic)
                    || Number(userData.rates?.standardChargeRate)
                    || 0;
                const overtimeChargeRate = Number(userData.rates?.chargeBackOvertime)
                    || Number(userData.rates?.overtimeChargeRate)
                    || 0;

                console.log(`[Sync] Using rates for assignment:`, { chargeRate, overtimeChargeRate });

                // Check if assignment already exists
                const { updateAssignmentRates } = await import('./userAssignments');
                const existingAssignments = await getActiveAssignments(userId, finalClientId);

                if (existingAssignments.length > 0) {
                    // Update existing assignment rates
                    const existingAssignment = existingAssignments[0];
                    await updateAssignmentRates(existingAssignment.id, {
                        chargeRate,
                        overtimeChargeRate
                    });
                    console.log(`[Sync] Updated existing assignment ${existingAssignment.id} with rates: ${chargeRate}/${overtimeChargeRate}`);
                } else {
                    // NEW: Check for earliest unassigned hours to backdate assignment
                    const { getEarliestUnassignedEntryDate } = await import('./retroactiveHourHelper');
                    const earliestUnassignedDate = await getEarliestUnassignedEntryDate(userId, companyId);

                    // Use earliest unassigned date or current date
                    const assignmentStartDate = earliestUnassignedDate || new Date();

                    if (earliestUnassignedDate) {
                        console.log(`[Sync] Backdating assignment start to: ${earliestUnassignedDate.toISOString().split('T')[0]} (earliest unassigned hours)`);
                    }

                    // Create new assignment with backdated start
                    await createAssignment({
                        userId,
                        clientId: finalClientId,
                        siteId: newSiteId,
                        companyId,
                        startDate: assignmentStartDate,
                        chargeRate,
                        overtimeChargeRate
                    });
                    console.log(`[Sync] Created new assignment starting from: ${assignmentStartDate.toISOString().split('T')[0]}`);
                }
            } catch (assignmentError) {
                console.error('[Sync] Assignment error:', assignmentError.message);
            }
        }

        // Step 3: Update user document
        const userUpdates = {
            siteId: newSiteId ? `sites/${newSiteId}` : null,
            clientId: finalClientId || null,
            updatedAt: serverTimestamp()
        };

        await updateDoc(userRef, userUpdates);
        console.log('[Sync] User document updated');

        // Step 4: CRITICAL - Also update userCompanyProfiles to keep in sync
        console.log('[Sync] Step 4: Updating userCompanyProfiles...');
        try {
            const { collection, query, where, getDocs } = await import('firebase/firestore');
            const profilesRef = collection(db, 'userCompanyProfiles');
            const profilesQ = query(
                profilesRef,
                where('userId', '==', userId),
                where('companyId', '==', `companies/${companyId}`)
            );
            console.log('[Sync] Querying profiles with:', { userId, companyId: `companies/${companyId}` });
            const profilesSnap = await getDocs(profilesQ);
            console.log('[Sync] Found', profilesSnap.size, 'profile document(s)');

            if (!profilesSnap.empty) {
                const profileDoc = profilesSnap.docs[0];
                const profileRef = doc(db, 'userCompanyProfiles', profileDoc.id);
                await updateDoc(profileRef, {
                    siteId: newSiteId ? `sites/${newSiteId}` : null,
                    updatedAt: serverTimestamp()
                });
                console.log(`[Sync] userCompanyProfiles document ${profileDoc.id} updated`);
            } else {
                console.warn('[Sync] No userCompanyProfiles document found for user', userId);
            }
        } catch (profileError) {
            console.error('[Sync] Failed to update userCompanyProfiles:', profileError.message);
            // Don't throw - user document was already updated, profile sync is secondary
        }

        console.log('[Sync] ========= SYNC COMPLETED SUCCESSFULLY =========');
        const result = {
            success: true,
            changed: true,
            oldSiteId: currentSiteId,
            newSiteId,
            oldClientId: currentClientId,
            newClientId: finalClientId
        };
        console.log('[Sync] Result:', result);
        return result;

    } catch (error) {
        console.error('[Sync] ========= SYNC FAILED =========');
        console.error('[Sync] Error:', error);
        throw error;
    }
}

/**
 * Bulk update multiple users' site assignment
 * Used by Sites Management "Manage Users" modal
 * 
 * @param {Object} changes - Map of userId -> { assign: boolean }
 * @param {string} siteId - Site ID
 * @returns {Promise<Object>} Summary of changes
 */
export async function bulkUpdateUserSiteAssignments(changes, siteId) {
    const results = {
        assigned: 0,
        removed: 0,
        errors: []
    };

    for (const [userId, { assign }] of Object.entries(changes)) {
        try {
            if (assign) {
                await updateUserSiteAndClient(userId, siteId);
                results.assigned++;
            } else {
                await updateUserSiteAndClient(userId, null);
                results.removed++;
            }
        } catch (error) {
            results.errors.push({ userId, error: error.message });
        }
    }

    return results;
}
