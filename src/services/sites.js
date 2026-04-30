import { db } from '../firebase/client';
import { collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc, query, where, serverTimestamp } from 'firebase/firestore';

const COLLECTION_NAME = 'sites';

/**
 * Get all sites for a company
 * @param {string} companyId - Company ID
 * @returns {Promise<Array>} List of sites
 */
export const getSites = async (companyId) => {
    try {
        const rawId = companyId.replace('companies/', '');
        const pathId = `companies/${rawId}`;

        const q = query(
            collection(db, COLLECTION_NAME),
            where('companyId', 'in', [rawId, pathId])
        );
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    } catch (error) {
        console.error('Error fetching sites:', error);
        throw error;
    }
};

/**
 * Get a single site by ID
 * @param {string} siteId - Site ID
 * @returns {Promise<Object>} Site data
 */
export const getSite = async (siteId) => {
    try {
        const docRef = doc(db, COLLECTION_NAME, siteId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            return { id: docSnap.id, ...docSnap.data() };
        }
        return null;
    } catch (error) {
        console.error('Error fetching site:', error);
        throw error;
    }
};


/**
 * Add a new site
 * @param {string} companyId - Company ID
 * @param {Object} siteData - Site details (must include clientId)
 * @returns {Promise<Object>} Created site with ID
 */
export const addSite = async (companyId, siteData) => {
    try {
        // Validate clientId is provided
        if (!siteData.clientId) {
            throw new Error('clientId is required when creating a site');
        }

        const docData = {
            ...siteData,
            companyId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };
        const docRef = await addDoc(collection(db, COLLECTION_NAME), docData);
        console.log('Site created with client:', docData.clientId);
        return { id: docRef.id, ...docData };
    } catch (error) {
        console.error('Error adding site:', error);
        throw error;
    }
};

/**
 * Update a site
 * @param {string} siteId - Site ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<void>}
 */
export const updateSite = async (siteId, updates) => {
    try {
        const docRef = doc(db, COLLECTION_NAME, siteId);
        await updateDoc(docRef, {
            ...updates,
            updatedAt: serverTimestamp()
        });
    } catch (error) {
        console.error('Error updating site:', error);
        throw error;
    }
};

/**
 * Delete a site
 * @param {string} siteId - Site ID
 * @returns {Promise<void>}
 */
export const deleteSite = async (siteId) => {
    try {
        await deleteDoc(doc(db, COLLECTION_NAME, siteId));
    } catch (error) {
        console.error('Error deleting site:', error);
        throw error;
    }
};

/**
 * Get all sites for a specific client
 * @param {string} clientId - Client ID
 * @returns {Promise<Array>} List of sites
 */
export const getSitesByClient = async (clientId) => {
    try {
        const q = query(
            collection(db, COLLECTION_NAME),
            where('clientId', '==', clientId)
        );
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    } catch (error) {
        console.error('Error fetching sites by client:', error);
        throw error;
    }
};

/**
 * Update site's client relationship
 * @param {string} siteId - Site ID
 * @param {string} clientId - New client ID
 * @returns {Promise<void>}
 */
export const updateSiteClient = async (siteId, clientId) => {
    try {
        if (!clientId) {
            throw new Error('clientId is required');
        }

        const docRef = doc(db, COLLECTION_NAME, siteId);
        await updateDoc(docRef, {
            clientId,
            updatedAt: serverTimestamp()
        });
        console.log('Site client updated:', siteId, '->', clientId);
    } catch (error) {
        console.error('Error updating site client:', error);
        throw error;
    }
};
