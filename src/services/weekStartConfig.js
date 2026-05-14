import hrApiClient from '../lib/hrApiClient';
import { normalizeWeekStartDay, DEFAULT_WEEK_START_DAY } from '../utils/weekStartUtils';

const companyCache = new Map();

function extractId(pathOrId) {
    if (!pathOrId) return '';
    return String(pathOrId).includes('/') ? pathOrId.split('/').pop() : String(pathOrId);
}

/**
 * Week Start Config Service (Phase 4 — REST Migration)
 * 
 * Fetches company-level week start configuration from the REST API.
 */

export async function getCompanyWeekStartDay(companyPathOrId) {
    const companyId = extractId(companyPathOrId);
    if (!companyId) return DEFAULT_WEEK_START_DAY;
    
    if (companyCache.has(companyId)) {
        return companyCache.get(companyId);
    }

    try {
        // Fetch company profile from REST API
        const { data } = await hrApiClient.get('/hr/company');
        
        const weekStart = normalizeWeekStartDay(data.weekStartDay || DEFAULT_WEEK_START_DAY);
        companyCache.set(companyId, weekStart);
        return weekStart;
    } catch (error) {
        console.warn('[weekStartConfig] Failed to fetch company profile for weekStartDay. Falling back to default.', error);
        return DEFAULT_WEEK_START_DAY;
    }
}

// Company-based resolution only: no site-level or user-level overrides.
export async function resolveWeekStartDay(companyPathOrId) {
    return getCompanyWeekStartDay(companyPathOrId);
}

export function invalidateWeekStartCaches(companyPathOrId) {
    const companyId = extractId(companyPathOrId);
    if (companyId && companyCache.has(companyId)) {
        companyCache.delete(companyId);
    }
}

export { DEFAULT_WEEK_START_DAY };
