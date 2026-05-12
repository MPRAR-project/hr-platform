import apiClient from '../api/apiClient';

/**
 * Genuinely refactored Seat Request Service
 * Communicates with the Central Backend (Postgres) instead of Firebase Firestore.
 */

export async function createSeatRequest(context, data) {
    const cleanCompanyId = context.companyId.replace('companies/', '');
    const response = await apiClient.post(`/hr/${cleanCompanyId}/seat-requests`, {
        ...context,
        ...data,
        requestedById: context.requestedById
    });
    return response.data;
}

export async function fetchSeatRequests(companyId, { status = null } = {}) {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.get(`/hr/${cleanCompanyId}/seat-requests`, {
        params: { status }
    });
    return response.data;
}

export async function updateSeatRequestStatus(requestId, status, metadata = {}) {
    const response = await apiClient.put(`/hr/seat-requests/${requestId}/status`, {
        status,
        ...metadata
    });
    return response.data;
}

export function emitSeatRequestEvent() {
    window.dispatchEvent(new CustomEvent('seatRequests:updated'));
}

export async function calculateSeatRequestPayment(requestId) {
    // This calculation should now happen on the backend
    const response = await apiClient.get(`/hr/seat-requests/${requestId}/payment-calc`);
    return response.data;
}
