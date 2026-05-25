import hrApiClient from '../lib/hrApiClient';
import { getDefaultRoundingRules, normalizeRoundingRules } from '../utils/timeRounding';

export async function getCompanyRoundingRules(companyId) {
    const response = await hrApiClient.get('/hr/company');
    const data = response.data;
    return normalizeRoundingRules(data?.company?.roundingRules);
}

export async function getSiteOverrideRoundingRules(companyId, siteId) {
    if (!siteId) return null;
    const cleanSiteId = siteId.replace('sites/', '');
    const response = await hrApiClient.get(`/hr/sites/${cleanSiteId}`);
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
