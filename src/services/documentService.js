import hrApiClient from '../lib/hrApiClient';
import wsClient from '../lib/wsClient';

/**
 * Document Service (Phase 4 — REST Migration)
 * 
 * All document-related operations now go through the HR REST API.
 * Firestore and Firebase Storage dependencies have been removed.
 */
class DocumentService {
    constructor() {
        this.allowedFileTypes = [
            'image/jpeg', 'image/png', 'image/jpg',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];
        this.maxFileSize = 25 * 1024 * 1024; // 25MB
    }

    /**
     * Get document types
     */
    async getDocumentTypes() {
        return [
            { value: 'passport', label: 'Passport' },
            { value: 'driving_license', label: 'Driving License' },
            { value: 'national_id', label: 'National ID' },
            { value: 'visa', label: 'Visa' },
            { value: 'work_permit', label: 'Work Permit' },
            { value: 'bank_statement', label: 'Bank Statement' },
            { value: 'utility_bill', label: 'Utility Bill' },
            { value: 'employment_contract', label: 'Employment Contract' },
            { value: 'cv_resume', label: 'CV/Resume' },
            { value: 'qualification_certificate', label: 'Qualification Certificate' },
            { value: 'medical_certificate', label: 'Medical Certificate' },
            { value: 'insurance_document', label: 'Insurance Document' },
            { value: 'other', label: 'Other Document' }
        ];
    }

    /**
     * Create a document request
     */
    async createDocumentRequest(requestData) {
        try {
            const { data } = await hrApiClient.post('/hr/document-requests', {
                employeeId: requestData.userId || requestData.employeeId,
                documentType: requestData.documentType,
                documentTitle: requestData.documentTitle,
                description: requestData.description,
                priority: requestData.priority || 'medium',
                dueDate: requestData.dueDate
            });
            return { success: true, data };
        } catch (error) {
            console.error('[DocumentService] Error creating document request:', error);
            throw error;
        }
    }

    /**
     * Get document requests
     */
    async getDocumentRequests(companyId, userRole, userId, filters = {}) {
        try {
            const { data } = await hrApiClient.get('/hr/document-requests', {
                params: {
                    ...filters,
                    employeeId: userRole === 'employee' ? userId : (filters.userId || filters.employeeId)
                }
            });
            return { success: true, data: data.requests || data || [] };
        } catch (error) {
            console.error('[DocumentService] Error fetching document requests:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get documents
     */
    async getDocuments(companyId, userRole, userId, filters = {}) {
        try {
            const { data } = await hrApiClient.get('/hr/documents', {
                params: {
                    ...filters,
                    employeeId: userRole === 'employee' ? userId : (filters.userId || filters.employeeId)
                }
            });
            return { success: true, data: data.documents || data || [] };
        } catch (error) {
            console.error('[DocumentService] Error fetching documents:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Upload and Submit document for a request
     */
    async submitDocument(requestId, file, userId, companyId, notes = null) {
        try {
            // 1. Upload file to S3 via backend
            const formData = new FormData();
            formData.append('file', file);
            const { data: uploadRes } = await hrApiClient.post('/hr/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });

            // 2. Create document record
            const { data: docRes } = await hrApiClient.post('/hr/documents', {
                employeeId: userId,
                requestId: requestId,
                title: file.name,
                documentType: 'requested_document',
                fileKey: uploadRes.fileKey,
                fileName: uploadRes.fileName,
                fileMimeType: uploadRes.mimeType,
                fileSizeBytes: uploadRes.size,
                fileUrl: uploadRes.url,
                metadata: { notes }
            });

            // 3. Update request status (backend might do this automatically, but keeping for safety)
            await hrApiClient.put(`/hr/document-requests/${requestId}`, {
                status: 'uploaded',
                documentId: docRes.id
            });

            return { success: true, data: docRes };
        } catch (error) {
            console.error('[DocumentService] Error submitting document:', error);
            throw error;
        }
    }

    /**
     * Approve or decline a document
     */
    async updateDocumentStatus(documentId, requestId, status, reason = null) {
        try {
            await hrApiClient.put(`/hr/documents/${documentId}`, { 
                status,
                rejectionReason: reason 
            });
            
            if (requestId) {
                await hrApiClient.put(`/hr/document-requests/${requestId}`, {
                    status: status === 'approved' ? 'approved' : 'declined',
                    metadata: { rejectionReason: reason }
                });
            }
            return { success: true };
        } catch (error) {
            console.error('[DocumentService] Error updating document status:', error);
            throw error;
        }
    }

    /**
     * Delete document
     */
    async deleteDocument(documentId) {
        try {
            await hrApiClient.delete(`/hr/documents/${documentId}`);
            return { success: true };
        } catch (error) {
            console.error('[DocumentService] Error deleting document:', error);
            throw error;
        }
    }

    /**
     * Get document statistics
     */
    async getDocumentStatistics(companyId, userRole, userId) {
        try {
            const { data } = await this.getDocuments(companyId, userRole, userId);
            const docs = data || [];
            const stats = {
                total: docs.length,
                byType: {},
                byCategory: {},
                totalSize: 0,
                pendingApproval: docs.filter(d => d.status === 'uploaded' || d.status === 'pending').length
            };

            docs.forEach(doc => {
                const type = doc.documentType || 'unknown';
                stats.byType[type] = (stats.byType[type] || 0) + 1;
                const cat = doc.metadata?.category || 'other';
                stats.byCategory[cat] = (stats.byCategory[cat] || 0) + 1;
                stats.totalSize += doc.fileSizeBytes || 0;
            });

            return { success: true, data: stats };
        } catch (error) {
            console.error('[DocumentService] Error getting document statistics:', error);
            return { success: false, error: error.message };
        }
    }

    // ── Real-time Subscriptions (Phase 6 — WebSocket) ──────────────────────────
    
    subscribeUserDocuments(companyId, userId, callback) {
        // Use wsClient for real-time updates in Phase 6
        wsClient.on('document:updated', (data) => {
            if (data.employeeId === userId) {
                this.getDocuments(companyId, 'employee', userId).then(res => callback(res));
            }
        });
        
        // Initial fetch
        this.getDocuments(companyId, 'employee', userId).then(res => callback(res));
        
        return () => wsClient.off('document:updated');
    }

    subscribeDocuments(companyId, role, userId, callback) {
        wsClient.on('document:updated', () => {
            this.getDocuments(companyId, role, userId).then(res => callback(res));
        });
        
        this.getDocuments(companyId, role, userId).then(res => callback(res));
        
        return () => wsClient.off('document:updated');
    }

    subscribeRequests(companyId, role, userId, callback) {
        wsClient.on('document-request:updated', () => {
            this.getDocumentRequests(companyId, role, userId).then(res => callback(res));
        });
        
        this.getDocumentRequests(companyId, role, userId).then(res => callback(res));
        
        return () => wsClient.off('document-request:updated');
    }
}

export const documentService = new DocumentService();
export default documentService;