import apiClient from '../api/apiClient';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export const DOCUMENT_TYPES = {
  IDENTIFICATION: 'identification',
  BANKING: 'banking',
  HR: 'hr',
  POLICY: 'policy',
  EMPLOYMENT: 'employment',
  OTHER: 'other'
};

export const DOCUMENT_CATEGORIES = {
    IDENTIFICATION: 'Identification',
    CONTRACT: 'Contract',
    POLICY: 'Policy',
    CERTIFICATE: 'Certificate',
    BANKING: 'Banking',
    OTHER: 'Other'
};

/**
 * Genuinely refactored Document Service
 * Uses the Central Backend for storage and metadata.
 * 0% Firebase dependencies.
 */

export async function uploadDocument({
  file,
  userId,
  companyId,
  documentType,
  category,
  description = '',
  onboardingApplicationId = null,
  onProgress = null
}) {
    const cleanCompanyId = companyId.replace('companies/', '');
    const token = localStorage.getItem('mprar_central_token');

    // 1. Upload File to Central Storage API
    const formData = new FormData();
    formData.append('file', file);
    formData.append('path', `employee-documents/${userId}/${documentType}_${Date.now()}_${file.name}`);

    const uploadRes = await axios.post(`${API_BASE}/hr/storage/upload`, formData, {
        headers: {
            'Content-Type': 'multipart/form-data',
            'Authorization': `Bearer ${token}`
        },
        onUploadProgress: (progressEvent) => {
            if (onProgress) {
                const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                onProgress(percentCompleted);
            }
        }
    });

    const { url } = uploadRes.data;

    // 2. Save Metadata to PostgreSQL via our new documents endpoint
    const docResponse = await apiClient.post(`/hr/${cleanCompanyId}/documents`, {
        userId,
        companyId: cleanCompanyId,
        name: file.name,
        fileUrl: url,
        category,
        documentType,
        description,
        status: 'active',
        uploadedBy: userId // Assuming self-upload for now
    });

    return docResponse.data;
}

export async function getUserDocuments(companyId, userId, documentType = null) {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.get(`/hr/${cleanCompanyId}/documents`, {
        params: { userId, documentType }
    });
    return response.data;
}

export async function deleteDocument(documentId) {
    const response = await apiClient.delete(`/hr/documents/${documentId}`);
    return response.data;
}

export async function createDocumentRequest(companyId, requestData) {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.post(`/hr/${cleanCompanyId}/document-requests`, requestData);
    return response.data;
}

export async function listDocumentRequests(companyId, filters = {}) {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.get(`/hr/${cleanCompanyId}/document-requests`, {
        params: filters
    });
    return response.data;
}

export async function getOnboardingDocuments(companyId, userId) {
    return await getUserDocuments(companyId, userId);
}

export async function updateDocument(documentId, updates) {
    const response = await apiClient.put(`/hr/documents/${documentId}`, updates);
    return response.data;
}

export async function getDocument(documentId) {
    const response = await apiClient.get(`/hr/documents/${documentId}`);
    return response.data;
}
