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

export async function getClients(companyId) {
    try {
        const { data } = await hrApiClient.get('/hr/clients');
        return data || [];
    } catch (error) {
        console.error('[clients] Error fetching clients:', error);
        return [];
    }
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
