import apiClient from '../api/apiClient';
import { getDefaultRoundingRules, normalizeRoundingRules } from '../utils/timeRounding';

/**
 * Genuinely refactored Rounding Rules Service
 * Communicates with the Central Backend (Postgres) instead of Firebase Firestore.
 */

export async function getCompanyRoundingRules(companyId) {
    const cleanId = companyId.replace('companies/', '');
    // In our new architecture, companies are in the public schema
    const response = await apiClient.get(`/companies/${cleanId}`);
    const data = response.data;
    return normalizeRoundingRules(data?.roundingRules);
}

export async function getSiteOverrideRoundingRules(companyId, siteId) {
    if (!siteId) return null;
    const cleanSiteId = siteId.replace('sites/', '');
    const response = await apiClient.get(`/hr/sites/${cleanSiteId}`);
    const data = response.data;
    return data?.roundingRules ? normalizeRoundingRules(data.roundingRules) : null;
}

export async function resolveRoundingRules(companyId, siteId) {
    const siteRules = await getSiteOverrideRoundingRules(companyId, siteId);
    if (siteRules) return siteRules;
    return getCompanyRoundingRules(companyId);
}

export async function getRoundingRulesForUser(user) {
    if (!user) return getDefaultRoundingRules();
    return resolveRoundingRules(user.companyId, user.siteId);
}

export function invalidateRoundingCaches() {
    // No-op for now as we're moving to direct API calls
}
