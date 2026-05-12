import apiClient from '../api/apiClient';

/**
 * Genuinely refactored Billing Service
 * Communicates with the Central Backend (Postgres) instead of Firebase Firestore/Functions.
 */

export const BILLING_EVENT_NAME = 'billing:updated';

export const getBillingSummary = async (companyId) => {
    const cleanCompanyId = companyId.replace('companies/', '');
    // In our new architecture, we'll fetch the summary from the backend
    const response = await apiClient.get(`/billing/company/${cleanCompanyId}/summary`);
    return response.data;
};

export const startTrial = async (companyId, seatCount) => {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.post(`/billing/company/${cleanCompanyId}/trial`, { seatCount });
    return response.data;
};

export const recordSeatTopUp = async (companyId, addedSeats = 1, requestId = null) => {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.post(`/billing/company/${cleanCompanyId}/seats`, { addedSeats, requestId });
    return response.data;
};

export const addPluginService = async (companyId, addonKey) => {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.post(`/billing/addons/purchase`, { companyId: cleanCompanyId, addonKey });
    return response.data;
};

export const removePluginService = async (companyId, addonKey) => {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.post(`/billing/addons/remove`, { companyId: cleanCompanyId, addonKey });
    return response.data;
};

export const getInvoices = async (companyId) => {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.get(`/billing/company/${cleanCompanyId}/invoices`);
    return response.data.invoices;
};

export const createStripePortalSession = async (companyId) => {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.post(`/billing/company/${cleanCompanyId}/portal`);
    return response.data.url;
};

export const BILLING_CONSTANTS = {
    PLATFORM_FEE: 10,
    SEAT_PRICE: 2
};

export const recordSubscriptionPayment = async (companyId, amount, description) => {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.post(`/billing/company/${cleanCompanyId}/payments`, { amount, description });
    return response.data;
};
