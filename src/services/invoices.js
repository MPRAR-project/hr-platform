import { collection, doc, addDoc, getDocs, query, where, orderBy, serverTimestamp, setDoc, increment } from 'firebase/firestore';
import { db } from '../firebase/client';

const COLLECTION_NAME = 'invoices';

/**
 * Create a new invoice
 * @param {Object} invoiceData 
 * @returns {Promise<Object>} Created invoice doc
 */
export const createInvoice = async (invoiceData) => {
    try {
        const { companyId, siteId, weekStart } = invoiceData;
        if (!companyId || !siteId || !weekStart) {
            console.error('[createInvoice] Validation failed:', { companyId, siteId, weekStart });
            throw new Error('Missing required invoice fields (Company ID, Site, or Week Start)');
        }

        // Sanitize companyId for consistent storage and settings lookup
        const safeCompanyId = companyId.includes('/') ? companyId.split('/').pop() : companyId;
        const settingsRef = doc(db, 'invoice_settings', safeCompanyId);

        const newInvoice = {
            ...invoiceData,
            companyId: safeCompanyId, // Store the sanitized ID for reliable querying
            createdAt: serverTimestamp(),
            status: 'generated'
        };

        // 2. Save Invoice Document
        const docRef = await addDoc(collection(db, COLLECTION_NAME), newInvoice);
        console.log('[createInvoice] Invoice doc created with ID:', docRef.id);

        // 3. Increment Invoice Number Atomically
        await setDoc(settingsRef, {
            nextInvoiceNumber: increment(1),
            updatedAt: serverTimestamp()
        }, { merge: true });

        return { id: docRef.id, ...newInvoice };
    } catch (error) {
        console.error('Error in createInvoice service:', error);
        throw error;
    }
};

/**
 * Get invoices for a company
 * @param {string} companyId 
 * @returns {Promise<Array>}
 */
export const getInvoices = async (companyId) => {
    try {
        if (!companyId) return [];
        
        // Sanitize companyId for query
        const safeId = companyId.includes('/') ? companyId.split('/').pop() : companyId;
        
        const q = query(
            collection(db, COLLECTION_NAME),
            where('companyId', '==', safeId),
            orderBy('createdAt', 'desc')
        );
        const snap = await getDocs(q);
        return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        console.error('Error fetching invoices:', error);
        throw error;
    }
};
