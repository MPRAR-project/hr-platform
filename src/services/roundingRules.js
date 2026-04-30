import { db } from '../firebase/client';
import { doc, getDoc } from 'firebase/firestore';
import { getDefaultRoundingRules, normalizeRoundingRules } from '../utils/timeRounding';

const companyCache = new Map();
const siteCache = new Map();

function buildCacheKey(companyId = '', siteId = '') {
    return `${companyId || ''}::${siteId || ''}`;
}

function extractDocId(pathOrId = '') {
    if (!pathOrId) return '';
    return String(pathOrId).includes('/') ? pathOrId.split('/').pop() : pathOrId;
}

async function fetchDoc(path) {
    try {
        const snap = await getDoc(path);
        return snap.exists() ? snap.data() : null;
    } catch (error) {
        console.warn('[roundingRules] failed to fetch document', path.path, error);
        return null;
    }
}

export async function getCompanyRoundingRules(companyPathOrId) {
    const companyId = extractDocId(companyPathOrId);
    if (!companyId) {
        return getDefaultRoundingRules();
    }

    if (companyCache.has(companyId)) {
        return companyCache.get(companyId);
    }

    const ref = doc(db, 'companies', companyId);
    const data = await fetchDoc(ref);

    const rounded = normalizeRoundingRules(data?.roundingRules);
    companyCache.set(companyId, rounded);
    return rounded;
}

export async function getSiteOverrideRoundingRules(companyPathOrId, sitePathOrId) {
    const companyId = extractDocId(companyPathOrId);
    const siteId = extractDocId(sitePathOrId);
    if (!companyId || !siteId) {
        return null;
    }

    const cacheKey = buildCacheKey(companyId, siteId);
    if (siteCache.has(cacheKey)) {
        return siteCache.get(cacheKey);
    }

    const ref = doc(db, 'sites', siteId);
    const data = await fetchDoc(ref);

    if (data?.companyId && extractDocId(data.companyId) !== companyId) {
        console.warn('[roundingRules] site/company mismatch, ignoring override', { companyId, siteId });
        siteCache.set(cacheKey, null);
        return null;
    }

    const rounded = data?.roundingRules ? normalizeRoundingRules(data.roundingRules) : null;
    siteCache.set(cacheKey, rounded);
    return rounded;
}

export async function getRoundingRulesForUser(user) {
    if (!user) {
        return getDefaultRoundingRules();
    }

    const companyId = extractDocId(user.companyId);
    const siteId = extractDocId(user.siteId);

    const siteRules = await getSiteOverrideRoundingRules(companyId, siteId);
    if (siteRules) {
        return siteRules;
    }
    return getCompanyRoundingRules(companyId);
}

export async function resolveRoundingRules(companyPathOrId, sitePathOrId) {
    const siteRules = await getSiteOverrideRoundingRules(companyPathOrId, sitePathOrId);
    if (siteRules) {
        return siteRules;
    }
    return getCompanyRoundingRules(companyPathOrId);
}

export function invalidateRoundingCaches(companyPathOrId, sitePathOrId = null) {
    const companyId = extractDocId(companyPathOrId);
    if (companyId && companyCache.has(companyId)) {
        companyCache.delete(companyId);
    }

    if (sitePathOrId) {
        const siteId = extractDocId(sitePathOrId);
        if (siteId) {
            const key = buildCacheKey(companyId, siteId);
            siteCache.delete(key);
        }
    } else {
        Array.from(siteCache.keys()).forEach((key) => {
            if (key.startsWith(`${companyId || ''}::`)) {
                siteCache.delete(key);
            }
        });
    }
}


