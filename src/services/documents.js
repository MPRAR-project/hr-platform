import { db } from '../firebase/client';
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  updateDoc, 
  deleteDoc,
  query, 
  where, 
  orderBy, 
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { 
  getStorage, 
  ref, 
  uploadBytes, 
  getDownloadURL, 
  deleteObject,
  uploadBytesResumable,
  getMetadata
} from 'firebase/storage';

/**
 * Document Service - Production Level Implementation
 * Handles document upload, storage, and management for onboarding
 */

// Initialize Firebase Storage
const storage = getStorage();

// Collection names
const COLLECTIONS = {
  DOCUMENTS: 'documents',
  ONBOARDING_APPLICATIONS: 'onboardingApplications'
};

// Document types and categories
export const DOCUMENT_TYPES = {
  IDENTIFICATION: 'identification',
  BANKING: 'banking',
  HR: 'hr',
  POLICY: 'policy',
  EMPLOYMENT: 'employment',
  OTHER: 'other'
};

export const DOCUMENT_CATEGORIES = {
  PASSPORT: 'passport',
  DRIVERS_LICENSE: 'drivers_license',
  NATIONAL_ID: 'national_id',
  BANK_STATEMENT: 'bank_statement',
  PAYSLIP: 'payslip',
  CONTRACT: 'contract',
  POLICY_AGREEMENT: 'policy_agreement',
  MEDICAL_CERTIFICATE: 'medical_certificate',
  OTHER: 'other'
};

// Allowed file types and sizes
const ALLOWED_FILE_TYPES = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx'
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Validate file before upload
 */
function validateFile(file) {
  if (!file) {
    throw new Error('No file provided');
  }

  // Check file type
  if (!ALLOWED_FILE_TYPES[file.type]) {
    const allowedTypes = Object.keys(ALLOWED_FILE_TYPES).join(', ');
    throw new Error(`Invalid file type. Allowed types: ${allowedTypes}`);
  }

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File size too large. Maximum size: ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
  }

  return true;
}

/**
 * Generate unique filename
 */
function generateFileName(originalName, userId, documentType) {
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 15);
  const extension = originalName.split('.').pop();
  return `${userId}_${documentType}_${timestamp}_${randomString}.${extension}`;
}

/**
 * Upload document to Firebase Storage
 */
export async function uploadDocument({
  file,
  userId,
  documentType,
  category,
  description = '',
  onboardingApplicationId = null,
  onProgress = null
}) {
  try {
    // Validate inputs
    if (!file || !userId || !documentType) {
      throw new Error('file, userId, and documentType are required');
    }

    // Validate file
    validateFile(file);

    // Generate unique filename
    const fileName = generateFileName(file.name, userId, documentType);
    const storageRef = ref(storage, `employee-documents/${userId}/${documentType}_${fileName}`);

    // Upload file with progress tracking
    let uploadTask;
    if (onProgress) {
      uploadTask = uploadBytesResumable(storageRef, file);
      
      uploadTask.on('state_changed', 
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          onProgress(progress);
        },
        (error) => {
          throw new Error(`Upload failed: ${error.message}`);
        }
      );

      await uploadTask;
    } else {
      await uploadBytes(storageRef, file);
    }

    // Get download URL
    const downloadURL = await getDownloadURL(storageRef);

    // Get file metadata
    const metadata = await getMetadata(storageRef);

    // Save document record to Firestore
    const documentRef = doc(collection(db, COLLECTIONS.DOCUMENTS));
    const documentData = {
      id: documentRef.id,
      userId,
      fileName: file.name,
      storageFileName: fileName,
      storagePath: storageRef.fullPath,
      downloadURL,
      documentType,
      category,
      description,
      fileSize: file.size,
      mimeType: file.type,
      onboardingApplicationId,
      uploadedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      timestamp: Date.now(),
      status: 'active'
    };

    await setDoc(documentRef, documentData);

    // Update onboarding application if provided
    if (onboardingApplicationId) {
      await addDocumentToOnboarding(onboardingApplicationId, documentRef.id);
    }

    return {
      id: documentRef.id,
      ...documentData
    };
  } catch (error) {
    console.error('Error uploading document:', error);
    throw new Error(`Failed to upload document: ${error.message}`);
  }
}

/**
 * Add document to onboarding application
 */
async function addDocumentToOnboarding(onboardingApplicationId, documentId) {
  try {
    const applicationRef = doc(db, COLLECTIONS.ONBOARDING_APPLICATIONS, onboardingApplicationId);
    const applicationSnap = await getDoc(applicationRef);
    
    if (!applicationSnap.exists()) {
      throw new Error('Onboarding application not found');
    }

    const currentData = applicationSnap.data();
    const documents = currentData.documents || [];
    
    if (!documents.includes(documentId)) {
      documents.push(documentId);
      
      await updateDoc(applicationRef, {
        documents,
        updatedAt: new Date().toISOString(),
        timestamp: Date.now()
      });
    }
  } catch (error) {
    console.error('Error adding document to onboarding:', error);
    throw new Error(`Failed to add document to onboarding: ${error.message}`);
  }
}

/**
 * Get documents for a user
 */
export async function getUserDocuments(userId, documentType = null) {
  try {
    if (!userId) {
      throw new Error('userId is required');
    }

    let q = query(
      collection(db, COLLECTIONS.DOCUMENTS),
      where('userId', '==', userId),
      where('status', '==', 'active'),
      orderBy('uploadedAt', 'desc')
    );

    if (documentType) {
      q = query(q, where('documentType', '==', documentType));
    }

    const snap = await getDocs(q);
    const documents = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return documents;
  } catch (error) {
    console.error('Error getting user documents:', error);
    throw new Error(`Failed to get user documents: ${error.message}`);
  }
}

/**
 * Get documents for an onboarding application
 */
export async function getOnboardingDocuments(onboardingApplicationId) {
  try {
    if (!onboardingApplicationId) {
      throw new Error('onboardingApplicationId is required');
    }

    const q = query(
      collection(db, COLLECTIONS.DOCUMENTS),
      where('onboardingApplicationId', '==', onboardingApplicationId),
      where('status', '==', 'active'),
      orderBy('uploadedAt', 'desc')
    );

    const snap = await getDocs(q);
    const documents = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return documents;
  } catch (error) {
    console.error('Error getting onboarding documents:', error);
    throw new Error(`Failed to get onboarding documents: ${error.message}`);
  }
}

/**
 * Get document by ID
 */
export async function getDocument(documentId) {
  try {
    if (!documentId) {
      throw new Error('documentId is required');
    }

    const documentRef = doc(db, COLLECTIONS.DOCUMENTS, documentId);
    const documentSnap = await getDoc(documentRef);
    
    if (!documentSnap.exists()) {
      throw new Error('Document not found');
    }

    return {
      id: documentSnap.id,
      ...documentSnap.data()
    };
  } catch (error) {
    console.error('Error getting document:', error);
    throw new Error(`Failed to get document: ${error.message}`);
  }
}

/**
 * Update document metadata
 */
export async function updateDocument(documentId, updates) {
  try {
    if (!documentId || !updates) {
      throw new Error('documentId and updates are required');
    }

    const documentRef = doc(db, COLLECTIONS.DOCUMENTS, documentId);
    const documentSnap = await getDoc(documentRef);
    
    if (!documentSnap.exists()) {
      throw new Error('Document not found');
    }

    const allowedUpdates = ['description', 'category', 'documentType'];
    const filteredUpdates = {};
    
    Object.keys(updates).forEach(key => {
      if (allowedUpdates.includes(key)) {
        filteredUpdates[key] = updates[key];
      }
    });

    if (Object.keys(filteredUpdates).length === 0) {
      throw new Error('No valid updates provided');
    }

    filteredUpdates.updatedAt = new Date().toISOString();
    filteredUpdates.timestamp = Date.now();

    await updateDoc(documentRef, filteredUpdates);

    return {
      id: documentId,
      ...filteredUpdates
    };
  } catch (error) {
    console.error('Error updating document:', error);
    throw new Error(`Failed to update document: ${error.message}`);
  }
}

/**
 * Delete document
 */
export async function deleteDocument(documentId, userId) {
  try {
    if (!documentId || !userId) {
      throw new Error('documentId and userId are required');
    }

    const documentRef = doc(db, COLLECTIONS.DOCUMENTS, documentId);
    const documentSnap = await getDoc(documentRef);
    
    if (!documentSnap.exists()) {
      throw new Error('Document not found');
    }

    const documentData = documentSnap.data();

    // Verify user owns the document
    if (documentData.userId !== userId) {
      throw new Error('Unauthorized: You can only delete your own documents');
    }

    // Delete from Storage
    const storageRef = ref(storage, documentData.storagePath);
    await deleteObject(storageRef);

    // Delete from Firestore
    await deleteDoc(documentRef);

    // Remove from onboarding application if applicable
    if (documentData.onboardingApplicationId) {
      await removeDocumentFromOnboarding(documentData.onboardingApplicationId, documentId);
    }

    return { success: true };
  } catch (error) {
    console.error('Error deleting document:', error);
    throw new Error(`Failed to delete document: ${error.message}`);
  }
}

/**
 * Remove document from onboarding application
 */
async function removeDocumentFromOnboarding(onboardingApplicationId, documentId) {
  try {
    const applicationRef = doc(db, COLLECTIONS.ONBOARDING_APPLICATIONS, onboardingApplicationId);
    const applicationSnap = await getDoc(applicationRef);
    
    if (!applicationSnap.exists()) {
      return; // Application might already be deleted
    }

    const currentData = applicationSnap.data();
    const documents = currentData.documents || [];
    const updatedDocuments = documents.filter(id => id !== documentId);
    
    if (documents.length !== updatedDocuments.length) {
      await updateDoc(applicationRef, {
        documents: updatedDocuments,
        updatedAt: new Date().toISOString(),
        timestamp: Date.now()
      });
    }
  } catch (error) {
    console.error('Error removing document from onboarding:', error);
    // Don't throw error here as it's not critical
  }
}

/**
 * Get document statistics for a user
 */
export async function getDocumentStatistics(userId) {
  try {
    if (!userId) {
      throw new Error('userId is required');
    }

    const q = query(
      collection(db, COLLECTIONS.DOCUMENTS),
      where('userId', '==', userId),
      where('status', '==', 'active')
    );

    const snap = await getDocs(q);
    const documents = snap.docs.map(doc => doc.data());

    const stats = {
      total: documents.length,
      byType: {},
      byCategory: {},
      totalSize: 0
    };

    documents.forEach(doc => {
      // Count by type
      stats.byType[doc.documentType] = (stats.byType[doc.documentType] || 0) + 1;
      
      // Count by category
      stats.byCategory[doc.category] = (stats.byCategory[doc.category] || 0) + 1;
      
      // Sum file sizes
      stats.totalSize += doc.fileSize || 0;
    });

    return stats;
  } catch (error) {
    console.error('Error getting document statistics:', error);
    throw new Error(`Failed to get document statistics: ${error.message}`);
  }
}

/**
 * Bulk upload documents
 */
export async function bulkUploadDocuments({
  files,
  userId,
  documentType,
  category,
  description = '',
  onboardingApplicationId = null,
  onProgress = null
}) {
  try {
    if (!files || !Array.isArray(files) || files.length === 0) {
      throw new Error('files array is required and must not be empty');
    }

    if (!userId || !documentType) {
      throw new Error('userId and documentType are required');
    }

    const results = [];
    const errors = [];

    for (let i = 0; i < files.length; i++) {
      try {
        const file = files[i];
        const result = await uploadDocument({
          file,
          userId,
          documentType,
          category,
          description,
          onboardingApplicationId,
          onProgress: onProgress ? (progress) => onProgress(i, progress) : null
        });
        results.push(result);
      } catch (error) {
        errors.push({
          fileName: files[i].name,
          error: error.message
        });
      }
    }

    return {
      successful: results,
      failed: errors,
      totalProcessed: files.length,
      successCount: results.length,
      errorCount: errors.length
    };
  } catch (error) {
    console.error('Error in bulk upload:', error);
    throw new Error(`Failed to bulk upload documents: ${error.message}`);
  }
}
