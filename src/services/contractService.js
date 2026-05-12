import apiClient from '../api/apiClient';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';

/**
 * Genuinely refactored Contract Service
 * Communicates with the Central Backend (Postgres) instead of Firebase Firestore.
 * 0% Firebase dependencies.
 */

export const uploadContract = async (userId, file, metadata) => {
    const cleanCompanyId = (metadata.companyId || '').replace('companies/', '');
    const token = localStorage.getItem('mprar_central_token');

    // 1. Upload File to Central Storage API
    const formData = new FormData();
    formData.append('file', file);
    formData.append('path', `contracts/${userId}/${Date.now()}_${file.name}`);

    const uploadRes = await axios.post(`${API_BASE}/hr/storage/upload`, formData, {
        headers: {
            'Content-Type': 'multipart/form-data',
            'Authorization': `Bearer ${token}`
        }
    });

    const { url } = uploadRes.data;

    // 2. Save Metadata to PostgreSQL
    const response = await apiClient.post(`/hr/${cleanCompanyId}/contracts`, {
        userId,
        companyId: cleanCompanyId,
        title: metadata.title || file.name,
        fileName: file.name,
        fileUrl: url,
        type: metadata.type || 'Employment Contract',
        uploadedBy: metadata.uploadedBy,
        uploadedByName: metadata.uploadedByName || 'Manager'
    });

    return response.data;
};

export const getContracts = async (userId, companyId) => {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.get(`/hr/${cleanCompanyId}/contracts`, {
        params: { userId }
    });
    return response.data;
};

export const signContract = async (userId, contractId, signatureBlob, typedName, companyId) => {
    const cleanCompanyId = companyId.replace('companies/', '');
    const token = localStorage.getItem('mprar_central_token');

    // 1. Upload signature image
    const formData = new FormData();
    formData.append('file', signatureBlob, 'signature.png');
    formData.append('path', `signatures/${userId}/${contractId}_${Date.now()}.png`);

    const uploadRes = await axios.post(`${API_BASE}/hr/storage/upload`, formData, {
        headers: {
            'Content-Type': 'multipart/form-data',
            'Authorization': `Bearer ${token}`
        }
    });

    const signatureUrl = uploadRes.data.url;

    // 2. Update contract record
    const response = await apiClient.put(`/hr/contracts/${contractId}`, {
        status: 'signed',
        signedAt: new Date(),
        signatureUrl,
        typedSignature: typedName
    });

    return response.data;
};

export const deleteContract = async (userId, contractId) => {
    const response = await apiClient.delete(`/hr/contracts/${contractId}`);
    return response.data;
};
