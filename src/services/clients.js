import hrApiClient from '../lib/hrApiClient';

/**
 * Clients Service (Phase 4 — REST Migration)
 * 
 * Replaces Firestore CRUD with HR REST API calls.
 * All method signatures preserved for compatibility.
 */

export async function addClient(companyId, data) {
    try {
        const { data: res } = await hrApiClient.post('/hr/clients', data);
        return res;
    } catch (error) {
        console.error('[clients] Error adding client:', error);
        throw error;
    }
}

export async function updateClient(clientId, data) {
    try {
        const { data: res } = await hrApiClient.put(`/hr/clients/${clientId}`, data);
        return res;
    } catch (error) {
        console.error('[clients] Error updating client:', error);
        throw error;
    }
}

export async function deleteClient(clientId) {
    try {
        await hrApiClient.delete(`/hr/clients/${clientId}`);
        return true;
    } catch (error) {
        console.error('[clients] Error deleting client:', error);
        throw error;
    }
}

// ── In-flight deduplication + TTL cache ──────────────────────────────────────
const _inFlight = {};
const _cache    = {};
function _dedupe(key, factory) {
  if (!_inFlight[key]) {
    _inFlight[key] = factory().finally(() => { delete _inFlight[key]; });
  }
  return _inFlight[key];
}
function _memGet(key) { const e = _cache[key]; return (e && Date.now() < e.exp) ? e.val : null; }
function _memSet(key, val, ttlMs = 5 * 60 * 1000) { _cache[key] = { val, exp: Date.now() + ttlMs }; }

export async function getClients(companyId) {
    const cacheKey = `clients_${companyId || 'all'}`;
    const cached = _memGet(cacheKey);
    if (cached) return cached;

    return _dedupe(cacheKey, async () => {
        try {
            const { data } = await hrApiClient.get('/hr/clients');
            const result = data || [];
            _memSet(cacheKey, result);
            return result;
        } catch (error) {
            console.error('[clients] Error fetching clients:', error);
            return [];
        }
    });
}

export async function getClient(clientId) {
    try {
        const { data } = await hrApiClient.get(`/hr/clients/${clientId}`);
        return data;
    } catch (error) {
        console.error('[clients] Error fetching client:', error);
        return null;
    }
}
