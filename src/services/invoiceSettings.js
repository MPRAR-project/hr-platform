import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase/client';

const COLLECTION_NAME = 'invoice_settings';

/**
 * Get invoice settings for a company
 * @param {string} companyId - Company ID
 * @returns {Promise<Object>} Settings or null
 */
export const getInvoiceSettings = async (companyId) => {
    try {
        if (!companyId) return null;
        // Sanitize companyId (in case it contains "companies/" prefix)
        const safeId = companyId.includes('/') ? companyId.split('/').pop() : companyId;
        const ref = doc(db, COLLECTION_NAME, safeId);
        const snap = await getDoc(ref);
        if (snap.exists()) {
            return {
                weekStartDay: 1, // Default to Monday if not set
                ...snap.data()
            };
        }
        // Return default structure if not found
        return {
            companyName: '',
            address: '',
            logoUrl: '',
            bankDetails: '',
            utrNumber: '',
            vatNumber: '',
            nextInvoiceNumber: 1,
            nextInvoicePrefix: 'INV-',
            defaultAdminDeduction: 0,
            weekStartDay: 1
        };
    } catch (error) {
        console.error('Error fetching invoice settings:', error);
        throw error;
    }
};

/**
 * Update invoice settings for a company
 * @param {string} companyId 
 * @param {Object} settings 
 */
export const updateInvoiceSettings = async (companyId, settings) => {
    try {
        if (!companyId) throw new Error('Company ID is required');
        const safeId = companyId.includes('/') ? companyId.split('/').pop() : companyId;
        const ref = doc(db, COLLECTION_NAME, safeId);
        await setDoc(ref, {
            ...settings,
            updatedAt: serverTimestamp(),
            companyId // redundancy but useful
        }, { merge: true });
        return { ok: true };
    } catch (error) {
        console.error('Error updating invoice settings:', error);
        throw error;
    }
};
