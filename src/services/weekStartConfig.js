import { db } from '../firebase/client';
import { doc, getDoc } from 'firebase/firestore';
import { normalizeWeekStartDay, DEFAULT_WEEK_START_DAY } from '../utils/weekStartUtils';

const companyCache = new Map();

function extractId(pathOrId) {
    if (!pathOrId) return '';
    return String(pathOrId).includes('/') ? pathOrId.split('/').pop() : String(pathOrId);
}

async function safeGetDoc(ref) {
    try {
        const snap = await getDoc(ref);
        return snap.exists() ? snap.data() : null;
    } catch (error) {
        console.warn('[weekStartConfig] failed to load doc', ref.path, error);
        return null;
    }
}

export async function getCompanyWeekStartDay(companyPathOrId) {
    const companyId = extractId(companyPathOrId);
    if (!companyId) {
        console.warn('[weekStartConfig] Missing companyId when resolving weekStartDay. Falling back to DEFAULT_WEEK_START_DAY.');
        return DEFAULT_WEEK_START_DAY;
    }
    if (companyCache.has(companyId)) {
        return companyCache.get(companyId);
    }
    const ref = doc(db, 'companies', companyId);
    const data = await safeGetDoc(ref);

    if (!data || !data.weekStartDay) {
        console.error('[weekStartConfig] Company document is missing mandatory weekStartDay field', { companyId });
        // Hard fallback to DEFAULT_WEEK_START_DAY as a last resort;
        // configuration should ensure this never happens in production.
        companyCache.set(companyId, DEFAULT_WEEK_START_DAY);
        return DEFAULT_WEEK_START_DAY;
    }

    const weekStart = normalizeWeekStartDay(data.weekStartDay);
    companyCache.set(companyId, weekStart);
    return weekStart;
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

