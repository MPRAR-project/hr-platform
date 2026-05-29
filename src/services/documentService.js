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
    async getDocumentTypes(companyId) {
        const defaults = [
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
        
        try {
            if (companyId) {
                const stored = localStorage.getItem(`document_types_${companyId}`);
                if (stored) {
                    const customTypes = JSON.parse(stored);
                    return [...defaults, ...customTypes];
                }
            }
        } catch (e) {
            console.error('[DocumentService] Error reading custom document types:', e);
        }
        
        return defaults;
    }

    /**
     * Add a custom document type
     */
    async addDocumentType(companyId, typeData) {
        try {
            if (!companyId) throw new Error('Company ID is required to add document type');
            const stored = localStorage.getItem(`document_types_${companyId}`);
            const customTypes = stored ? JSON.parse(stored) : [];
            
            const newType = {
                id: `custom_${Date.now()}`,
                value: typeData.label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
                label: typeData.label,
                description: typeData.description || ''
            };
            
            customTypes.push(newType);
            localStorage.setItem(`document_types_${companyId}`, JSON.stringify(customTypes));
            return { success: true, data: newType };
        } catch (error) {
            console.error('[DocumentService] Error adding custom document type:', error);
            throw error;
        }
    }

    /**
     * Delete a custom document type
     */
    async deleteDocumentType(companyId, typeId) {
        try {
            if (!companyId) throw new Error('Company ID is required to delete document type');
            const stored = localStorage.getItem(`document_types_${companyId}`);
            if (stored) {
                let customTypes = JSON.parse(stored);
                customTypes = customTypes.filter(t => t.id !== typeId);
                localStorage.setItem(`document_types_${companyId}`, JSON.stringify(customTypes));
            }
            return { success: true };
        } catch (error) {
            console.error('[DocumentService] Error deleting custom document type:', error);
            throw error;
        }
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
            const requestsArray = Array.isArray(data.requests) ? data.requests : (Array.isArray(data) ? data : []);
            return { success: true, data: requestsArray.map(r => ({ ...r, isRequest: true })) };
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
     * Approve a document
     */
    async approveDocument(documentId, userId, role, companyId, notes = null) {
        try {
            const { data: docs } = await this.getDocuments(companyId, role, userId, { id: documentId });
            const matchingDoc = Array.isArray(docs) ? docs.find(d => d.id === documentId) : docs;
            const requestId = matchingDoc?.requestId || null;
            return this.updateDocumentStatus(documentId, requestId, 'approved', notes);
        } catch (error) {
            return this.updateDocumentStatus(documentId, null, 'approved', notes);
        }
    }

    /**
     * Decline a document
     */
    async declineDocument(documentId, userId, role, companyId, reason = null) {
        try {
            const { data: docs } = await this.getDocuments(companyId, role, userId, { id: documentId });
            const matchingDoc = Array.isArray(docs) ? docs.find(d => d.id === documentId) : docs;
            const requestId = matchingDoc?.requestId || null;
            return this.updateDocumentStatus(documentId, requestId, 'declined', reason);
        } catch (error) {
            return this.updateDocumentStatus(documentId, null, 'declined', reason);
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
     * Update document
     */
    async updateDocument(documentId, updates, userId, role, companyId) {
        try {
            const { data } = await hrApiClient.put(`/hr/documents/${documentId}`, {
                title: updates.documentTitle || updates.title,
                description: updates.description,
                documentType: updates.documentType,
                metadata: updates.metadata
            });
            return { success: true, data };
        } catch (error) {
            console.error('[DocumentService] Error updating document:', error);
            throw error;
        }
    }

    /**
     * Update a document request
     */
    async updateDocumentRequest(requestId, updates, userId, role, companyId) {
        try {
            const { data } = await hrApiClient.put(`/hr/document-requests/${requestId}`, {
                documentTitle: updates.documentTitle,
                description: updates.description,
                documentType: updates.documentType,
                priority: updates.priority,
                dueDate: updates.dueDate
            });
            return { success: true, data };
        } catch (error) {
            console.error('[DocumentService] Error updating document request:', error);
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

    subscribeUserRequests(companyId, userId, callback) {
        // Use wsClient for real-time updates in Phase 6
        wsClient.on('document-request:updated', (data) => {
            if (data.employeeId === userId) {
                this.getDocumentRequests(companyId, 'employee', userId).then(res => callback(res));
            }
        });
        
        // Initial fetch
        this.getDocumentRequests(companyId, 'employee', userId).then(res => callback(res));
        
        return () => wsClient.off('document-request:updated');
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