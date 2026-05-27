/**
 * sites.js — Phase 4 Migration (REST Only)
 * teams.js equivalent is at the bottom of this file.
 *
 * Replaces Firestore reads/writes for sites management.
 *
 * Note: addSite is an alias for createSite — preserved for SitesPage.jsx compat.
 */

import hrApiClient from '../lib/hrApiClient';

function normalizeDates(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  ['createdAt','updatedAt'].forEach((k) => {
    if (out[k]?.toDate)  out[k] = out[k].toDate().toISOString();
    if (out[k]?.seconds) out[k] = new Date(out[k].seconds * 1000).toISOString();
  });
  return out;
}

// ── In-flight deduplication — prevents duplicate concurrent requests ──────────
const _inFlight = {};
function dedupe(key, factory) {
  if (!_inFlight[key]) {
    _inFlight[key] = factory().finally(() => { delete _inFlight[key]; });
  }
  return _inFlight[key];
}

// Simple TTL memory cache to avoid hammering the endpoint on rapid re-renders
const _cache = {};
function memGet(key) { const e = _cache[key]; return (e && Date.now() < e.exp) ? e.val : null; }
function memSet(key, val, ttlMs = 5 * 60 * 1000) { _cache[key] = { val, exp: Date.now() + ttlMs }; }

// ── Sites ─────────────────────────────────────────────────────────────────────
export async function getSites(companyId) {
  const cacheKey = `sites_${companyId || 'all'}`;
  const cached = memGet(cacheKey);
  if (cached) return cached;

  return dedupe(cacheKey, async () => {
    try {
      const { data } = await hrApiClient.get('/hr/sites');
      const result = (data.sites || data || []).map(normalizeDates);
      memSet(cacheKey, result);
      return result;
    } catch (err) {
      if (err.response?.status === 403) return [];
      throw new Error(err.response?.data?.error || 'Failed to fetch sites');
    }
  });
}

export async function getSiteById(siteId) {
  try {
    const { data } = await hrApiClient.get(`/hr/sites/${siteId}`);
    return normalizeDates(data);
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw new Error(err.response?.data?.error || 'Failed to fetch site');
  }
}

export async function createSite(siteData, companyId, createdBy) {
  try {
    const { data } = await hrApiClient.post('/hr/sites', {
      ...siteData,
      companyId: companyId || siteData.companyId,
      createdBy: createdBy || null,
    });
    return normalizeDates(data);
  } catch (err) {
    throw new Error(err.response?.data?.error || 'Failed to create site');
  }
}

export async function updateSite(siteId, updateData) {
  try {
    const { data } = await hrApiClient.put(`/hr/sites/${siteId}`, updateData);
    return normalizeDates(data);
  } catch (err) {
    if (err.response?.status === 404) throw new Error('Site not found');
    if (err.response?.status === 403) throw new Error('Permission denied');
    throw new Error(err.response?.data?.error || 'Failed to update site');
  }
}

export async function deleteSite(siteId) {
  try {
    await hrApiClient.delete(`/hr/sites/${siteId}`);
    return true;
  } catch (err) {
    if (err.response?.status === 404) throw new Error('Site not found');
    if (err.response?.status === 403) throw new Error('Permission denied');
    throw new Error(err.response?.data?.error || 'Failed to delete site');
  }
}

// ── Sites subscribe stub ─────────────────────────────────────────────────────
export function subscribeToSites(companyId, callback) {
  getSites(companyId).then(callback).catch(() => {});
  return () => {};
}

const sitesService = {
  getSites,
  getSiteById,
  createSite,
  addSite: createSite,  // alias
  updateSite,
  deleteSite,
  subscribeToSites,
};

export default sitesService;
// Named alias for backward compat (SitesPage.jsx uses addSite)
export const addSite = createSite;
// Named aliases used by various pages
export const getSite = getSiteById;  // userSiteClientSync, etc.

