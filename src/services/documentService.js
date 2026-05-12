import apiClient from '../api/apiClient';

/**
 * Genuinely refactored Document Service (Legacy Class Wrapper)
 * Communicates with the Central Backend (Postgres) instead of Firebase Firestore.
 * 0% Firebase dependencies.
 */
class DocumentService {
    constructor() {
        this.requestsCollection = 'documentRequests';
        this.documentsCollection = 'documents';
    }

    async getDocumentTypes(companyId) {
        const response = await apiClient.get(`/hr/${companyId}/document-types`);
        return response.data;
    }

    async createDocumentRequest(requestData, requestedBy, companyId) {
        const response = await apiClient.post(`/hr/${companyId}/document-requests`, {
            ...requestData,
            requestedBy
        });
        return { success: true, data: response.data };
    }

    async getDocumentRequests(companyId, userRole, userId, filters = {}) {
        const response = await apiClient.get(`/hr/${companyId}/document-requests`, {
            params: { ...filters, userRole, userId }
        });
        return { success: true, data: response.data };
    }

    async getDocuments(companyId, userRole, userId, filters = {}) {
        const response = await apiClient.get(`/hr/${companyId}/documents`, {
            params: { ...filters, userRole, userId }
        });
        return { success: true, data: response.data };
    }

    async deleteDocument(companyId, documentId) {
        const response = await apiClient.delete(`/hr/documents/${documentId}`);
        return { success: true };
    }

    // Compatibility shims for subscriptions
    subscribeUserDocuments(companyId, userId, callback) {
        const interval = setInterval(async () => {
            try {
                const data = await this.getDocuments(companyId, 'employee', userId);
                callback(data);
            } catch (e) {}
        }, 30000);
        return () => clearInterval(interval);
    }

    subscribeUserRequests(companyId, userId, callback) {
        const interval = setInterval(async () => {
            try {
                const data = await this.getDocumentRequests(companyId, 'employee', userId);
                callback(data);
            } catch (e) {}
        }, 30000);
        return () => clearInterval(interval);
    }
}

export const documentService = new DocumentService();
export default documentService;