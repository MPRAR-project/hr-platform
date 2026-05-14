import hrApiClient from '../lib/hrApiClient';

/**
 * CENTRALIZED function to update user's site and client assignment
 * In REST mode, we simply update the employee record.
 */
export async function updateUserSiteAndClient(userId, newSiteId, newClientId = null) {
    try {
        console.log('[Sync] Updating user site/client via REST:', { userId, newSiteId, newClientId });

        let finalClientId = newClientId;
        
        // If site is provided but no explicit clientId, the backend could resolve it, 
        // but for consistency with previous logic, we can fetch site details if needed.
        if (newSiteId && !finalClientId) {
            try {
                const { data: site } = await hrApiClient.get(`/hr/sites/${newSiteId}`);
                finalClientId = site.clientId;
            } catch (err) {
                console.warn('[Sync] Could not resolve clientId for site', newSiteId);
            }
        }

        const { data } = await hrApiClient.patch(`/hr/employees/${userId}`, {
            siteId: newSiteId || null,
            clientId: finalClientId || null
        });

        console.log('[Sync] ✓ SUCCESS - User updated via REST');
        return {
            success: true,
            changed: true,
            newSiteId,
            newClientId: finalClientId,
            data
        };
    } catch (error) {
        console.error('[Sync] ✗ ERROR:', error);
        throw error;
    }
}

/**
 * Bulk update multiple users' site assignment
 */
export async function bulkUpdateUserSiteAssignments(changes, siteId) {
    const results = { assigned: 0, removed: 0, errors: [] };

    for (const [userId, { assign }] of Object.entries(changes)) {
        try {
            await updateUserSiteAndClient(userId, assign ? siteId : null);
            if (assign) results.assigned++; else results.removed++;
        } catch (error) {
            results.errors.push({ userId, error: error.message });
        }
    }
    return results;
}
