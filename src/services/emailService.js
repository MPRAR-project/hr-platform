import hrApiClient from '../lib/hrApiClient';

/**
 * Email Service (REST Replacement for Firebase Functions)
 */

/**
 * Sends a payslip via email
 * @param {Object} payload 
 * @param {string} payload.email - Recipient email
 * @param {string} payload.subject - Email subject
 * @param {string} payload.body - Email body
 * @param {string} payload.attachment - Base64 encoded PDF
 * @param {string} payload.filename - Filename for the attachment
 */
export async function sendPayslipEmail(payload) {
    try {
        const { data } = await hrApiClient.post('/hr/emails/send-payslip', payload);
        return data;
    } catch (error) {
        console.error('[emailService] Error sending payslip email:', error);
        throw error;
    }
}
