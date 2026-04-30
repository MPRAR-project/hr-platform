import { db, storage } from '../firebase/client';
import { collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc, query, where, serverTimestamp, orderBy } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';

const COLLECTION_NAME = 'contracts';

/**
 * Upload a contract PDF for a user
 * @param {string} userId - ID of the employee
 * @param {File} file - PDF file object
 * @param {Object} metadata - Additional metadata (title, uploadedBy)
 * @returns {Promise<Object>} Created contract document
 */
export const uploadContract = async (userId, file, metadata) => {
    try {
        // 1. Upload file to Storage
        const fileRef = ref(storage, `contracts/${userId}/${Date.now()}_${file.name}`);
        const snapshot = await uploadBytes(fileRef, file);
        const downloadURL = await getDownloadURL(snapshot.ref);

        // 2. Create Firestore document in subcollection
        const contractData = {
            userId, // Store userId for easier querying if needed
            title: metadata.title || file.name,
            fileName: file.name,
            fileUrl: downloadURL,
            storagePath: snapshot.ref.fullPath,
            type: metadata.type || 'Employment Contract',
            status: 'pending',
            uploadedBy: metadata.uploadedBy,
            uploadedByName: metadata.uploadedByName || 'Manager',
            uploadedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };

        // Store in a root collection 'contracts' or subcollection?
        // Plan said users/{userId}/contracts, but root collection with filtering is often easier for querying all contracts.
        // Let's stick to the plan: users/{userId}/contracts for strict ownership.
        const contractsRef = collection(db, 'users', userId, 'contracts');
        const docRef = await addDoc(contractsRef, contractData);

        return { id: docRef.id, ...contractData };
    } catch (error) {
        console.error('Error uploading contract:', error);
        throw error;
    }
};

/**
 * Get all contracts for a user
 * @param {string} userId - ID of the employee
 * @returns {Promise<Array>} List of contracts
 */
export const getContracts = async (userId) => {
    try {
        const contractsRef = collection(db, 'users', userId, 'contracts');
        const q = query(contractsRef, orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);

        return querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    } catch (error) {
        console.error('Error fetching contracts:', error);
        throw error;
    }
};

/**
 * Sign a contract
 * @param {string} userId - ID of the employee
 * @param {string} contractId - ID of the contract doc
 * @param {Blob} signatureBlob - Image blob of the signature
 * @param {string} typedName - Typed name of the signer
 * @returns {Promise<void>}
 */
export const signContract = async (userId, contractId, signatureBlob, typedName) => {
    try {
        // 1. Upload signature image
        const sigPath = `signatures/${userId}/${contractId}_${Date.now()}.png`;
        const sigRef = ref(storage, sigPath);
        const snapshot = await uploadBytes(sigRef, signatureBlob);
        const signatureUrl = await getDownloadURL(snapshot.ref);

        // 2. Update contract document
        const contractRef = doc(db, 'users', userId, 'contracts', contractId);
        await updateDoc(contractRef, {
            status: 'signed',
            signedAt: serverTimestamp(),
            signatureUrl,
            typedSignature: typedName,
            updatedAt: serverTimestamp()
        });
    } catch (error) {
        console.error('Error signing contract:', error);
        throw error;
    }
};

/**
 * Delete a contract
 * @param {string} userId - ID of the employee
 * @param {string} contractId - ID of the contract doc
 * @param {string} storagePath - Path to the file in storage (optional, if known, else fetch)
 * @returns {Promise<void>}
 */
export const deleteContract = async (userId, contractId, storagePath) => {
    try {
        const contractRef = doc(db, 'users', userId, 'contracts', contractId);

        // If storagePath not provided, fetch it first
        let path = storagePath;
        if (!path) {
            const snap = await getDoc(contractRef);
            if (snap.exists()) {
                path = snap.data().storagePath;
            }
        }

        // Delete from Storage
        if (path) {
            const fileRef = ref(storage, path);
            try {
                await deleteObject(fileRef);
            } catch (e) {
                console.warn('Failed to delete file from storage, continuing to delete doc:', e);
            }
        }

        // Delete Firestore doc
        await deleteDoc(contractRef);

    } catch (error) {
        console.error('Error deleting contract:', error);
        throw error;
    }
};
