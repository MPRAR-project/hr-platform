import { db } from '../firebase/client';
import { doc, getDoc } from 'firebase/firestore';

const DEFAULT_AUTO_LUNCH_CONFIG = {
    enabled: false,
    thresholdHours: 6,
    lunchBreakMinutes: 60,
};

function extractDocId(pathOrId = '') {
    if (!pathOrId) return '';
    return String(pathOrId).includes('/') ? pathOrId.split('/').pop() : String(pathOrId);
}

function buildCacheKey(companyId = '', siteId = '') {
    return `${companyId || ''}::${siteId || ''}`;
}

function normalizeAutoLunchConfig(config = {}) {
    const enabled = Boolean(config.enabled);
    // Use strictly positive number or default
    const rawThreshold = Number(config.thresholdHours);
    const thresholdHours = (Number.isFinite(rawThreshold) && rawThreshold > 0)
        ? rawThreshold
        : DEFAULT_AUTO_LUNCH_CONFIG.thresholdHours;

    const rawLunchMin = Number(config.lunchBreakMinutes);
    const lunchBreakMinutes = (Number.isFinite(rawLunchMin) && rawLunchMin >= 0)
        ? rawLunchMin
        : DEFAULT_AUTO_LUNCH_CONFIG.lunchBreakMinutes;

    return {
        enabled,
        thresholdHours,
        lunchBreakMinutes,
    };
}

const companyCache = new Map();
const siteCache = new Map();

async function fetchDoc(ref) {
    try {
        const snap = await getDoc(ref);
        return snap.exists() ? snap.data() : null;
    } catch (error) {
        console.warn('[autoLunch] failed to fetch doc', ref.path, error);
        return null;
    }
}

export async function getCompanyAutoLunchConfig(companyPathOrId) {
    const companyId = extractDocId(companyPathOrId);
    if (!companyId) return { ...DEFAULT_AUTO_LUNCH_CONFIG };

    if (companyCache.has(companyId)) {
        return companyCache.get(companyId);
    }

    const ref = doc(db, 'companies', companyId);
    const data = await fetchDoc(ref);
    const config = normalizeAutoLunchConfig({
        ...(data?.autoLunch || {}),
        lunchBreakMinutes: data?.lunchBreakMinutes,
    });

    companyCache.set(companyId, config);
    return config;
}

export async function getSiteAutoLunchOverride(companyPathOrId, sitePathOrId) {
    const companyId = extractDocId(companyPathOrId);
    const siteId = extractDocId(sitePathOrId);
    if (!companyId || !siteId) return null;

    const cacheKey = buildCacheKey(companyId, siteId);
    if (siteCache.has(cacheKey)) {
        return siteCache.get(cacheKey);
    }

    const ref = doc(db, 'sites', siteId);
    const data = await fetchDoc(ref);
    if (!data) {
        siteCache.set(cacheKey, null);
        return null;
    }

    if (data.companyId && extractDocId(data.companyId) !== companyId) {
        console.warn('[autoLunch] site/company mismatch, ignoring override', { companyId, siteId });
        siteCache.set(cacheKey, null);
        return null;
    }

    if (!data.autoLunch) {
        siteCache.set(cacheKey, null);
        return null;
    }

    const config = normalizeAutoLunchConfig({
        ...data.autoLunch,
        lunchBreakMinutes: data.lunchBreakMinutes,
    });
    siteCache.set(cacheKey, config);
    return config;
}

export async function resolveAutoLunchConfig(companyPathOrId, sitePathOrId) {
    const siteOverride = await getSiteAutoLunchOverride(companyPathOrId, sitePathOrId);
    if (siteOverride) {
        return siteOverride;
    }
    return getCompanyAutoLunchConfig(companyPathOrId);
}

export function invalidateAutoLunchCaches(companyPathOrId, sitePathOrId = null) {
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

export function getDefaultAutoLunchConfig() {
    return { ...DEFAULT_AUTO_LUNCH_CONFIG };
}


