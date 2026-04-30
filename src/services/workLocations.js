import { db } from '../firebase/client';
import { collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc, query, where, serverTimestamp } from 'firebase/firestore';

const COLLECTION_NAME = 'work_locations';

/**
 * Get all work locations for a company
 * @param {string} companyId - Company ID
 * @returns {Promise<Array>} List of locations
 */
export const getWorkLocations = async (companyId) => {
    try {
        const q = query(
            collection(db, COLLECTION_NAME),
            where('companyId', '==', companyId)
        );
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    } catch (error) {
        console.error('Error fetching work locations:', error);
        throw error;
    }
};

/**
 * Add a new work location
 * @param {string} companyId - Company ID
 * @param {Object} locationData - Location details (name, address, latitude, longitude, radius)
 * @returns {Promise<Object>} Created location with ID
 */
export const addWorkLocation = async (companyId, locationData) => {
    try {
        const docData = {
            name: locationData.name,
            address: locationData.address || null,
            latitude: locationData.latitude || null,
            longitude: locationData.longitude || null,
            radius: locationData.radius || null,
            notes: locationData.notes || null,
            parentSiteId: locationData.parentSiteId || null,
            companyId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };
        const docRef = await addDoc(collection(db, COLLECTION_NAME), docData);
        return { id: docRef.id, ...docData };
    } catch (error) {
        console.error('Error adding work location:', error);
        throw error;
    }
};

/**
 * Update a work location
 * @param {string} locationId - Location ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<void>}
 */
export const updateWorkLocation = async (locationId, updates) => {
    try {
        const docRef = doc(db, COLLECTION_NAME, locationId);
        await updateDoc(docRef, {
            ...updates,
            updatedAt: serverTimestamp()
        });
    } catch (error) {
        console.error('Error updating work location:', error);
        throw error;
    }
};

/**
 * Delete a work location
 * @param {string} locationId - Location ID
 * @returns {Promise<void>}
 */
export const deleteWorkLocation = async (locationId) => {
    try {
        await deleteDoc(doc(db, COLLECTION_NAME, locationId));
    } catch (error) {
        console.error('Error deleting work location:', error);
        throw error;
    }
};
