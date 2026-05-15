import hrApiClient from '../lib/hrApiClient';

/**
 * Document Service (REST Migration)
 */

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
    // 1. Upload to Storage
    const formData = new FormData();
    formData.append('file', file);
    
    const { data: uploadRes } = await hrApiClient.post('/hr/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (progressEvent) => {
        if (onProgress) {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(percentCompleted);
        }
      }
    });

    // 2. Register Document in DB
    const { data: docRes } = await hrApiClient.post('/hr/documents', {
      employeeId: userId,
      title: file.name,
      description,
      documentType,
      fileKey: uploadRes.fileKey,
      fileName: uploadRes.fileName,
      fileMimeType: uploadRes.mimeType,
      fileSizeBytes: uploadRes.size,
      metadata: { category, onboardingApplicationId }
    });

    return docRes;
  } catch (error) {
    console.error('Error uploading document:', error);
    throw error;
  }
}

export async function getUserDocuments(userId, documentType = null) {
  try {
    const { data } = await hrApiClient.get('/hr/documents', {
      params: { employeeId: userId, type: documentType }
    });
    return data.documents || [];
  } catch (error) {
    console.error('Error getting user documents:', error);
    return [];
  }
}

export const getOnboardingDocuments = getUserDocuments;

export async function getDocument(documentId) {
  try {
    const { data } = await hrApiClient.get(`/hr/documents/${documentId}`);
    return data;
  } catch (error) {
    console.error('Error getting document:', error);
    return null;
  }
}

export async function updateDocument(documentId, updates) {
  try {
    const { data } = await hrApiClient.put(`/hr/documents/${documentId}`, updates);
    return data;
  } catch (error) {
    console.error('Error updating document:', error);
    throw error;
  }
}

export async function deleteDocument(documentId, userId) {
  try {
    await hrApiClient.delete(`/hr/documents/${documentId}`);
    return { success: true };
  } catch (error) {
    console.error('Error deleting document:', error);
    throw error;
  }
}

export async function getDocumentStatistics(userId) {
  try {
    const docs = await getUserDocuments(userId);
    const stats = {
      total: docs.length,
      byType: {},
      byCategory: {},
      totalSize: 0
    };

    docs.forEach(doc => {
      stats.byType[doc.documentType] = (stats.byType[doc.documentType] || 0) + 1;
      const cat = doc.metadata?.category || 'other';
      stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1;
      stats.totalSize += doc.fileSizeBytes || 0;
    });

    return stats;
  } catch (error) {
    console.error('Error getting document statistics:', error);
    return { total: 0, byType: {}, byCategory: {}, totalSize: 0 };
  }
}

export async function bulkUploadDocuments({
  files,
  userId,
  documentType,
  category,
  description = '',
  onProgress = null
}) {
  const results = [];
  for (let i = 0; i < files.length; i++) {
    const res = await uploadDocument({
      file: files[i],
      userId,
      documentType,
      category,
      description,
      onProgress: (p) => onProgress && onProgress(i, p)
    });
    results.push(res);
  }
  return { successful: results, successCount: results.length };
}
