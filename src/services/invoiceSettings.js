import hrApiClient from '../lib/hrApiClient';

/**
 * Invoice Settings Service (Phase 4 — REST Migration)
 */

export const getInvoiceSettings = async (companyId) => {
    try {
        const { data } = await hrApiClient.get('/hr/billing/invoice-settings');
        return data;
    } catch (error) {
        console.error('[invoiceSettings] Error fetching settings:', error);
        return null;
    }
};

export const updateInvoiceSettings = async (companyId, settings) => {
    try {
        const { data } = await hrApiClient.put('/hr/billing/invoice-settings', settings);
        return data;
    } catch (error) {
        console.error('[invoiceSettings] Error updating settings:', error);
        throw error;
    }
};

export const uploadInvoiceLogo = async (file) => {
    try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('type', 'invoice_logo');

        const { data } = await hrApiClient.post('/hr/billing/upload-logo', formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });
        return data.url;
    } catch (error) {
        console.error('[invoiceSettings] Error uploading logo:', error);
        throw error;
    }
};
