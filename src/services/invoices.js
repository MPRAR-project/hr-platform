import hrApiClient from '../lib/hrApiClient';

/**
 * Invoices Service (Phase 4 — REST Migration)
 * 
 * Manages formal invoice documents via HR REST API.
 */

export const createInvoice = async (invoiceData) => {
    try {
        const { data } = await hrApiClient.post('/hr/billing/invoices', invoiceData);
        return data;
    } catch (error) {
        console.error('[invoices] Error creating invoice:', error);
        throw error;
    }
};

export const getInvoices = async (companyId) => {
    try {
        const { data } = await hrApiClient.get('/hr/billing/invoices');
        return data || [];
    } catch (error) {
        console.error('[invoices] Error fetching invoices:', error);
        return [];
    }
};
