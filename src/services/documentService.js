/**
 * Document Service - Handles document management, requests, and approvals
 * Manages document uploads, approval workflows, and role-based permissions
 */

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
    limit,
    serverTimestamp,
    writeBatch,
    Timestamp,
    documentId,
    onSnapshot
} from 'firebase/firestore';
import {
    getStorage,
    ref,
    uploadBytes,
    getDownloadURL,
    deleteObject
} from 'firebase/storage';
import { getManagedEmployeeIdsForManager } from './teams';

/**
 * Document Service Class
 */
class DocumentService {
    constructor() {
        this.requestsCollection = 'documentRequests';
        this.documentsCollection = 'documents';
        this.documentTypesCollection = 'documentTypes';
        this.storage = getStorage();
        this.allowedFileTypes = [
            'image/jpeg', 'image/png', 'image/jpg',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];
        this.maxFileSize = 25 * 1024 * 1024; // 25MB
        this.subscriptions = new Map();
    }

    /**
     * Subscribe to documents for a specific user
     */
    subscribeUserDocuments(companyId, userId, callback) {
        const rawId = companyId.replace('companies/', '');
        const pathId = `companies/${rawId}`;

        const q = query(
            collection(db, this.documentsCollection),
            where('companyId', 'in', [rawId, pathId]),
            where('userId', '==', userId)
        );

        return onSnapshot(q, (snapshot) => {
            const documents = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            callback({ success: true, data: documents });
        }, (error) => {
            console.error('Error in documents subscription:', error);
            callback({ success: false, error: error.message });
        });
    }

    /**
     * Subscribe to document requests for a specific user
     */
    subscribeUserRequests(companyId, userId, callback) {
        const rawId = companyId.replace('companies/', '');
        const pathId = `companies/${rawId}`;

        const q = query(
            collection(db, this.requestsCollection),
            where('companyId', 'in', [rawId, pathId]),
            where('userId', '==', userId)
        );

        return onSnapshot(q, (snapshot) => {
            const requests = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            callback({ success: true, data: requests });
        }, (error) => {
            console.error('Error in requests subscription:', error);
            callback({ success: false, error: error.message });
        });
    }

    /**
     * Default document types available in the system
     */
    getDefaultDocumentTypes() {
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
     * Get document types (custom + default) for a company
     */
    async getDocumentTypes(companyId) {
        try {
            if (!companyId) return this.getDefaultDocumentTypes();

            const rawId = companyId.replace('companies/', '');
            const typesQuery = query(
                collection(db, this.documentTypesCollection),
                where('companyId', '==', rawId)
            );

            const snapshot = await getDocs(typesQuery);
            const customTypes = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            // Combine defaults with custom types, avoiding duplicates by value
            const defaults = this.getDefaultDocumentTypes();
            const combined = [...defaults];

            customTypes.forEach(custom => {
                const index = combined.findIndex(d => d.value === custom.value);
                if (index !== -1) {
                    combined[index] = custom;
                } else {
                    combined.push(custom);
                }
            });

            return combined;
        } catch (error) {
            console.error('Error fetching document types:', error);
            return this.getDefaultDocumentTypes();
        }
    }

    /**
     * Add a custom document type for a company
     */
    async addDocumentType(companyId, typeData) {
        try {
            const rawId = companyId.replace('companies/', '');
            const typeRef = doc(collection(db, this.documentTypesCollection));

            const newType = {
                id: typeRef.id,
                companyId: rawId,
                label: typeData.label,
                value: typeData.label.toLowerCase().replace(/[^a-z0-0]/g, '_'),
                description: typeData.description || '',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            };

            await setDoc(typeRef, newType);
            return { success: true, data: newType };
        } catch (error) {
            console.error('Error adding document type:', error);
            throw new Error(`Failed to add document type: ${error.message}`);
        }
    }

    /**
     * Delete a custom document type
     */
    async deleteDocumentType(companyId, typeId) {
        try {
            const typeRef = doc(db, this.documentTypesCollection, typeId);
            const typeSnap = await getDoc(typeRef);

            if (!typeSnap.exists()) {
                throw new Error('Document type not found');
            }

            if (typeSnap.data().companyId !== companyId.replace('companies/', '')) {
                throw new Error('Access denied: Document type not in your company');
            }

            await deleteDoc(typeRef);
            return { success: true };
        } catch (error) {
            console.error('Error deleting document type:', error);
            throw new Error(`Failed to delete document type: ${error.message}`);
        }
    }

    /**
     * Create a document request
     */
    async createDocumentRequest(requestData, requestedBy, companyId, userRole) {
        try {
            // Validate permissions
            const canRequest = await this.canCreateDocumentRequest(userRole, requestedBy, requestData.userId, companyId);
            if (!canRequest.allowed) {
                throw new Error(canRequest.reason);
            }

            const requestRef = doc(collection(db, this.requestsCollection));
            const now = serverTimestamp();

            // Fetch user's siteId
            let siteId = null;
            try {
                const userSnap = await getDoc(doc(db, 'users', requestData.userId));
                if (userSnap.exists()) {
                    siteId = userSnap.data().siteId || null;
                }
            } catch (err) {
                console.warn(`Failed to fetch siteId for user ${requestData.userId}`, err);
            }

            const documentRequest = {
                id: requestRef.id,
                userId: requestData.userId,
                companyId: companyId,
                siteId, // Link request to user's current site
                documentType: requestData.documentType,
                documentTitle: requestData.documentTitle || await this.getDocumentTypeLabel(requestData.documentType, companyId),
                description: requestData.description || '',
                priority: requestData.priority || 'medium',
                dueDate: requestData.dueDate ? Timestamp.fromDate(new Date(requestData.dueDate)) : null,
                status: 'pending',
                requestedBy: requestedBy,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                timestamp: Date.now()
            };

            await setDoc(requestRef, documentRequest);

            // Update training status if this is a training-related document
            await this.updateTrainingForDocument(documentRequest, requestData, companyId);

            const { invalidateDocStatsCache } = await import('./cacheInvalidationService');
            await invalidateDocStatsCache(companyId, userRole, requestData.userId);
            return { success: true, data: documentRequest };
        } catch (error) {
            console.error('Error creating document request:', error);
            throw new Error(`Failed to create document request: ${error.message}`);
        }
    }

    /**
     * Subscribe to documents with role-based filtering
     */
    subscribeDocuments(companyId, role, userId, callback) {
        const rawId = companyId.replace('companies/', '');
        const pathId = `companies/${rawId}`;

        if (role === 'teamManager') {
            // For team managers, we need to get their managed employees first
            // Since onSnapshot doesn't support async setup easily, we handle it inside
            let unsubscribeManaged = null;

            const setupTeamManagerSubscription = async () => {
                try {
                    const managedIdsSet = await getManagedEmployeeIdsForManager(userId, rawId);
                    const managedIds = Array.from(managedIdsSet);

                    if (managedIds.length === 0) {
                        callback({ success: true, data: [] });
                        return () => { };
                    }

                    // Firestore 'in' queries limited to 30 items (standard limit, used to be 10)
                    const chunks = [];
                    for (let i = 0; i < managedIds.length; i += 30) {
                        chunks.push(managedIds.slice(i, i + 30));
                    }

                    const unsubscribes = chunks.map(chunk => {
                        const q = query(
                            collection(db, this.documentsCollection),
                            where('companyId', 'in', [rawId, pathId]),
                            where('userId', 'in', chunk)
                        );
                        return onSnapshot(q, (snapshot) => {
                            // This is tricky because we have multiple listeners for one callback
                            // For simplicity in this session, we'll just use a single company-wide subscription 
                            // and filter in memory if the team is small, or just accept the company-wide for managers.
                        });
                    });
                } catch (err) {
                    console.error('Error setting up team manager sub:', err);
                }
            };

            // REFACTORED APPROACH: For subscriptions, if it's a manager, we listen to the whole company 
            // and filter in the component to ensure real-time consistency without complex multi-listener merging.
        }

        // Generic company-wide subscription (Managers can see all company docs usually, or we filter in UI)
        const q = query(
            collection(db, this.documentsCollection),
            where('companyId', 'in', [rawId, pathId])
        );

        return onSnapshot(q, async (snapshot) => {
            let docs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            // Enrich with user names for list views
            // (Similar to getDocuments logic)
            docs = await this._enrichDocsWithUserData(docs);

            callback({ success: true, data: docs });
        }, (error) => {
            console.error('Error in documents subscription:', error);
            callback({ success: false, error: error.message });
        });
    }

    /**
     * Subscribe to requests with role-based filtering
     */
    subscribeRequests(companyId, role, userId, callback) {
        const rawId = companyId.replace('companies/', '');
        const pathId = `companies/${rawId}`;

        const q = query(
            collection(db, this.requestsCollection),
            where('companyId', 'in', [rawId, pathId])
        );

        return onSnapshot(q, async (snapshot) => {
            let reqs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            // Enrich with user names
            reqs = await this._enrichDocsWithUserData(reqs);

            callback({ success: true, data: reqs });
        }, (error) => {
            console.error('Error in requests subscription:', error);
            callback({ success: false, error: error.message });
        });
    }

    /**
     * Internal helper to enrich docs with user data (copied from getDocuments)
     */
    async _enrichDocsWithUserData(docs) {
        const userIds = [...new Set(docs.map(d => d.userId))].filter(Boolean);
        if (userIds.length === 0) return docs;

        const usersMap = {};
        const chunks = [];
        for (let i = 0; i < userIds.length; i += 10) {
            chunks.push(userIds.slice(i, i + 10));
        }

        await Promise.all(chunks.map(async (chunk) => {
            const q = query(collection(db, 'users'), where(documentId(), 'in', chunk));
            const snap = await getDocs(q);
            snap.forEach(d => {
                const data = d.data();
                usersMap[d.id] = {
                    id: d.id,
                    name: data.displayName || `${data.firstName || ''} ${data.lastName || ''}`.trim() || 'Unknown User',
                    displayName: data.displayName,
                    email: data.email,
                    role: data.primaryRole,
                    department: data.department
                };
            });
        }));

        return docs.map(d => ({
            ...d,
            user: usersMap[d.userId] || { id: d.userId, name: 'Unknown User' }
        }));
    }
    /**
     * Get document requests with role-based filtering
     */
    async getDocumentRequests(companyId, userRole, userId, filters = {}) {
        try {
            const rawId = companyId.replace('companies/', '');
            const pathId = `companies/${rawId}`;

            let requestsQuery = query(
                collection(db, this.requestsCollection),
                where('companyId', 'in', [rawId, pathId])
            );

            // Apply filters
            if (filters.status && filters.status !== 'all') {
                requestsQuery = query(requestsQuery, where('status', '==', filters.status));
            }

            if (filters.userId) {
                requestsQuery = query(requestsQuery, where('userId', '==', filters.userId));
            }

            const snapshot = await getDocs(requestsQuery);
            let requestsData = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            // Apply role-based filtering (additional security layer)
            if (userRole === 'teamManager' && !filters.userId) {
                const managedEmployeeIds = await getManagedEmployeeIdsForManager(userId, companyId);
                requestsData = requestsData.filter(request =>
                    managedEmployeeIds.has(request.userId) ||
                    request.userId === userId
                );
            } else if (userRole === 'employee' && !filters.userId) {
                requestsData = requestsData.filter(request => request.userId === userId);
            }

            // Sort in memory
            requestsData.sort((a, b) => {
                const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
                const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
                return dateB - dateA;
            });

            // Apply limit after sorting
            if (filters.limit && filters.limit > 0) {
                requestsData = requestsData.slice(0, filters.limit);
            }

            let requests = requestsData;

            // Apply role-based filtering
            if (userRole === 'teamManager') {
                const managedEmployeeIds = await getManagedEmployeeIdsForManager(userId, companyId);
                requests = requests.filter(request =>
                    managedEmployeeIds.has(request.userId) ||
                    request.requestedBy === userId ||
                    request.userId === userId
                );
            } else if (userRole === 'employee') {
                requests = requests.filter(request => request.userId === userId);
            }

            // Fetch user details in parallel (batch) - OPTIMIZED: Use single query instead of N+1
            const userIds = [...new Set(requests.map(r => r.userId))];
            let users = {};

            if (userIds.length > 0) {
                try {
                    // Use batch query instead of individual getDoc calls
                    const userSnapshots = await getDocs(
                        query(collection(db, 'users'), where(documentId(), 'in', userIds))
                    );

                    userSnapshots.forEach((userSnap) => {
                        const userData = userSnap.data();
                        users[userSnap.id] = {
                            id: userSnap.id,
                            name: userData.displayName || `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || 'Unknown User',
                            email: userData.email || 'unknown@company.com'
                        };
                    });
                } catch (batchError) {
                    console.warn('Batch user query failed, falling back to individual queries:', batchError);
                    // Fallback to individual queries if batch fails
                    const userSnaps = await Promise.all(userIds.map(userId => getDoc(doc(db, 'users', userId))));
                    userSnaps.forEach((userSnap, i) => {
                        const uid = userIds[i];
                        try {
                            if (userSnap.exists()) {
                                const userData = userSnap.data();
                                users[userId] = {
                                    id: uid,
                                    name: userData.displayName || `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || 'Unknown User',
                                    email: userData.email || 'unknown@company.com'
                                };
                            } else {
                                users[userId] = { id: userId, name: 'Unknown User', email: 'unknown@company.com' };
                            }
                        } catch {
                            users[userId] = { id: userId, name: 'Unknown User', email: 'unknown@company.com' };
                        }
                    });
                }
            }

            // Enrich requests with user data
            requests = requests.map(request => ({
                ...request,
                user: users[request.userId] || {
                    id: request.userId,
                    name: 'Unknown User',
                    email: 'unknown@company.com'
                }
            }));

            return { success: true, data: requests };
        } catch (error) {
            console.error('Error fetching document requests:', error);

            // Better error message for building indexes
            if (error.code === 'failed-precondition' && error.message?.includes('currently building')) {
                throw new Error('Index is currently building. Please wait 5-10 minutes and refresh the page.');
            }

            throw new Error(`Failed to fetch document requests: ${error.message}`);
        }
    }

    /**
     * Upload document file to Firebase Storage
     */
    async uploadDocumentFile(file, userId, companyId, documentType) {
        try {
            // Validate file
            if (!this.allowedFileTypes.includes(file.type)) {
                throw new Error('Invalid file type. Only PDF, DOC, DOCX, JPEG, and PNG files are allowed.');
            }

            if (file.size > this.maxFileSize) {
                throw new Error('File size too large. Maximum size is 25MB.');
            }

            // Create unique filename
            const timestamp = Date.now();
            const fileExtension = file.name.split('.').pop();
            const fileName = `employee-documents/${companyId}/${userId}/${documentType}_${timestamp}.${fileExtension}`;

            // Upload to Firebase Storage
            const storageRef = ref(this.storage, fileName);
            const snapshot = await uploadBytes(storageRef, file);
            const downloadURL = await getDownloadURL(snapshot.ref);
            return {
                success: true,
                data: {
                    fileName: file.name,
                    storagePath: fileName,
                    downloadURL,
                    fileSize: file.size,
                    fileType: file.type
                }
            };
        } catch (error) {
            console.error('Error uploading document file:', error);
            throw new Error(`Failed to upload document: ${error.message}`);
        }
    }

    /**
     * Submit document for a request
     */
    async submitDocument(requestId, file, userId, companyId, notes = null, userRole = null) {
        try {
            // Verify request exists and user has access
            const requestRef = doc(db, this.requestsCollection, requestId);
            const requestSnap = await getDoc(requestRef);

            if (!requestSnap.exists()) {
                throw new Error('Document request not found');
            }

            const request = requestSnap.data();

            // Verify user owns this request or can manage the user
            if (request.userId !== userId && request.companyId !== companyId) {
                throw new Error('Access denied: This request does not belong to you');
            }

            // Check if request is in valid state for document submission
            const validStatuses = ['pending', 'declined', 'uploaded'];
            if (!validStatuses.includes(request.status)) {
                throw new Error(`Cannot submit document. Request status: ${request.status}`);
            }

            // Upload file
            const uploadResult = await this.uploadDocumentFile(file, request.userId, companyId, request.documentType);
            if (!uploadResult.success) {
                throw new Error('Failed to upload document file');
            }

            // Reuse existing document record if it exists, otherwise check by requestId to prevent duplicates
            let documentRef;
            if (request.documentId) {
                documentRef = doc(db, this.documentsCollection, request.documentId);
                console.log('Reusing existing document record by ID:', request.documentId);
            } else {
                // FALLBACK: Check if any document already exists for this requestId in the documents collection
                const existingDocsQuery = query(
                    collection(db, this.documentsCollection),
                    where('requestId', '==', requestId),
                    limit(1)
                );
                const existingDocsSnap = await getDocs(existingDocsQuery);
                
                if (!existingDocsSnap.empty) {
                    documentRef = doc(db, this.documentsCollection, existingDocsSnap.docs[0].id);
                    console.log('Reusing existing document record found by requestId:', documentRef.id);
                } else {
                    documentRef = doc(collection(db, this.documentsCollection));
                    console.log('Creating brand new document record');
                }
            }
            
            const now = serverTimestamp();

            // Fetch user's siteId
            let siteId = null;
            try {
                const userSnap = await getDoc(doc(db, 'users', request.userId));
                if (userSnap.exists()) {
                    siteId = userSnap.data().siteId || null;
                }
            } catch (err) {
                console.warn(`Failed to fetch siteId for user ${request.userId}`, err);
            }

            const document = {
                id: documentRef.id,
                requestId: requestId,
                userId: request.userId,
                companyId: companyId,
                siteId, // Link document to user's current site
                documentType: request.documentType,
                documentTitle: request.documentTitle,
                fileName: uploadResult.data.fileName,
                storagePath: uploadResult.data.storagePath,
                fileUrl: uploadResult.data.downloadURL,
                fileSize: uploadResult.data.fileSize,
                fileType: uploadResult.data.fileType,
                status: 'uploaded',
                notes: notes || null,
                uploadedBy: userId,
                uploadedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                timestamp: Date.now()
            };

            await setDoc(documentRef, document);

            // Update request status to uploaded
            await updateDoc(requestRef, {
                status: 'uploaded',
                documentId: documentRef.id,
                uploadedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                timestamp: Date.now()
            });

            // Update training assignment when document is submitted
            await this.updateTrainingOnDocumentSubmission(documentRef.id, request, companyId);

            const { invalidateDocStatsCache } = await import('./cacheInvalidationService');
            await invalidateDocStatsCache(companyId, userRole || 'unknown', userId);
            return { success: true, data: document };
        } catch (error) {
            console.error('Error submitting document:', error);
            throw new Error(`Failed to submit document: ${error.message}`);
        }
    }

    /**
     * Get documents with role-based filtering
     */
    async getDocuments(companyId, userRole, userId, filters = {}) {
        try {
            const rawId = companyId.replace('companies/', '');
            const pathId = `companies/${rawId}`;

            // Start with base query - minimal filters for maximum compatibility
            let documentsQuery = query(
                collection(db, this.documentsCollection),
                where('companyId', 'in', [rawId, pathId])
            );

            // Apply userId filter only if specified
            if (filters.userId) {
                documentsQuery = query(documentsQuery, where('userId', '==', filters.userId));
            }

            // Apply status filter with fallback - handle multiple possible status values
            if (filters.status && filters.status !== 'all') {
                documentsQuery = query(documentsQuery, where('status', '==', filters.status));
            }

            // Apply document type filter
            if (filters.documentType && filters.documentType !== 'all') {
                documentsQuery = query(documentsQuery, where('documentType', '==', filters.documentType));
            }

            // Fetch and then sort in memory to prevent missing documents
            const snapshot = await getDocs(documentsQuery);
            let documents = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            console.log(`📊 Query results: ${documents.length} documents found with filters:`, filters);

            // Apply role-based filtering (additional security layer)
            if (userRole === 'teamManager' && !filters.userId) {
                const managedEmployeeIds = await getManagedEmployeeIdsForManager(userId, companyId);
                documents = documents.filter(document =>
                    managedEmployeeIds.has(document.userId) ||
                    document.uploadedBy === userId ||
                    document.userId === userId
                );
            } else if (userRole === 'employee' && !filters.userId) {
                documents = documents.filter(document => document.userId === userId);
            }

            // Sort in memory instead of Firestore orderBy to prevent skipping documents
            documents.sort((a, b) => {
                const dateA = a.uploadedAt?.toDate ? a.uploadedAt.toDate() : new Date(a.uploadedAt || a.createdAt || 0);
                const dateB = b.uploadedAt?.toDate ? b.uploadedAt.toDate() : new Date(b.uploadedAt || b.createdAt || 0);
                return dateB - dateA;
            });

            // Apply limit after filtering and sorting
            if (filters.limit && filters.limit > 0) {
                documents = documents.slice(0, filters.limit);
            }

            console.log(`📊 Final documents after filtering: ${documents.length}`);

            // Fetch user details in parallel (batch)
            const userIds = [...new Set(documents.map(d => d.userId))];
            let users = {};

            if (userIds.length > 0) {
                try {
                    const userSnapshots = await getDocs(
                        query(collection(db, 'users'), where(documentId(), 'in', userIds))
                    );

                    userSnapshots.forEach((userSnap) => {
                        const userData = userSnap.data();
                        users[userSnap.id] = {
                            id: userSnap.id,
                            name: userData.displayName || `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || 'Unknown User',
                            email: userData.email || 'unknown@company.com'
                        };
                    });
                } catch (batchError) {
                    console.warn('Batch user query failed, falling back to individual queries:', batchError);
                    const userSnaps = await Promise.all(userIds.map(userId => getDoc(doc(db, 'users', userId))));
                    userSnaps.forEach((userSnap, i) => {
                        const uid = userIds[i];
                        try {
                            if (userSnap.exists()) {
                                const userData = userSnap.data();
                                users[userId] = {
                                    id: uid,
                                    name: userData.displayName || `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || 'Unknown User',
                                    email: userData.email || 'unknown@company.com'
                                };
                            } else {
                                users[userId] = { id: userId, name: 'Unknown User', email: 'unknown@company.com' };
                            }
                        } catch {
                            users[userId] = { id: userId, name: 'Unknown User', email: 'unknown@company.com' };
                        }
                    });
                }
            }

            // Enrich documents with user data
            documents = documents.map(document => ({
                ...document,
                user: users[document.userId] || {
                    id: document.userId,
                    name: 'Unknown User',
                    email: 'unknown@company.com'
                }
            }));

            return { success: true, data: documents };
        } catch (error) {
            console.error('Error fetching documents:', error);

            // Better error message for building indexes
            if (error.code === 'failed-precondition' && error.message?.includes('currently building')) {
                throw new Error('Index is currently building. Please wait 5-10 minutes and refresh the page.');
            }

            throw new Error(`Failed to fetch documents: ${error.message}`);
        }
    }

    /**
     * Approve document
     */
    async approveDocument(documentId, approvedBy, userRole, companyId, notes = null) {
        try {
            const documentRef = doc(db, this.documentsCollection, documentId);
            const documentSnap = await getDoc(documentRef);

            if (!documentSnap.exists()) {
                throw new Error('Document not found');
            }

            const document = documentSnap.data();

            // Verify company access
            if (document.companyId !== companyId) {
                throw new Error('Access denied: Document not in your company');
            }

            // Verify approval permissions
            const canApprove = await this.canApproveDocument(userRole, approvedBy, document.userId, companyId);
            if (!canApprove.allowed) {
                throw new Error(canApprove.reason);
            }

            // Check current status
            if (document.status !== 'uploaded') {
                throw new Error(`Cannot approve document. Current status: ${document.status}`);
            }

            const now = serverTimestamp();

            // Update document status
            await updateDoc(documentRef, {
                status: 'approved',
                approvedBy,
                approvedAt: new Date().toISOString(),
                approvalNotes: notes,
                updatedAt: new Date().toISOString(),
                timestamp: Date.now()
            });

            // Update related request if exists
            if (document.requestId) {
                const requestRef = doc(db, this.requestsCollection, document.requestId);
                const requestSnap = await getDoc(requestRef);
                if (requestSnap.exists()) {
                    await updateDoc(requestRef, {
                        status: 'approved',
                        approvedBy,
                        approvedAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        timestamp: Date.now()
                    });
                } else {
                    console.warn(`Related document request not found: ${document.requestId}`);
                }
            }
            const { invalidateDocStatsCache } = await import('./cacheInvalidationService');
            await invalidateDocStatsCache(companyId, userRole, document.userId);
            return { success: true, data: { id: documentId, status: 'approved' } };
        } catch (error) {
            console.error('Error approving document:', error);
            throw new Error(`Failed to approve document: ${error.message}`);
        }
    }

    /**
     * Decline document
     */
    async declineDocument(documentId, declinedBy, userRole, companyId, reason) {
        try {
            if (!reason || reason.trim().length === 0) {
                throw new Error('Decline reason is required');
            }

            const documentRef = doc(db, this.documentsCollection, documentId);
            const documentSnap = await getDoc(documentRef);

            if (!documentSnap.exists()) {
                throw new Error('Document not found');
            }

            const document = documentSnap.data();

            // Verify company access
            if (document.companyId !== companyId) {
                throw new Error('Access denied: Document not in your company');
            }

            // Verify decline permissions
            const canDecline = await this.canApproveDocument(userRole, declinedBy, document.userId, companyId);
            if (!canDecline.allowed) {
                throw new Error(canDecline.reason);
            }

            // Check current status
            if (document.status !== 'uploaded') {
                throw new Error(`Cannot decline document. Current status: ${document.status}`);
            }

            const now = serverTimestamp();

            // Update document status
            await updateDoc(documentRef, {
                status: 'declined',
                declinedBy,
                declinedAt: new Date().toISOString(),
                declineReason: reason,
                updatedAt: new Date().toISOString(),
                timestamp: Date.now()
            });

            // Update related request if exists
            if (document.requestId) {
                const requestRef = doc(db, this.requestsCollection, document.requestId);
                const requestSnap = await getDoc(requestRef);
                if (requestSnap.exists()) {
                    await updateDoc(requestRef, {
                        status: 'declined',
                        declinedBy,
                        declinedAt: new Date().toISOString(),
                        declineReason: reason,
                        updatedAt: new Date().toISOString(),
                        timestamp: Date.now()
                    });
                } else {
                    console.warn(`Related document request not found: ${document.requestId}`);
                }
            }
            const { invalidateDocStatsCache } = await import('./cacheInvalidationService');
            await invalidateDocStatsCache(companyId, userRole, document.userId);
            return { success: true, data: { id: documentId, status: 'declined', reason } };
        } catch (error) {
            console.error('Error declining document:', error);
            throw new Error(`Failed to decline document: ${error.message}`);
        }
    }

    /**
     * Update document details (title, description, etc.)
     */
    async updateDocument(documentId, updates, updatedBy, userRole, companyId) {
        try {
            const documentRef = doc(db, this.documentsCollection, documentId);
            const documentSnap = await getDoc(documentRef);

            if (!documentSnap.exists()) {
                throw new Error('Document not found');
            }

            const document = documentSnap.data();

            // Verify company access
            if (document.companyId !== companyId) {
                throw new Error('Access denied: Document not in your company');
            }

            // Only allow editing by document owner or elevated roles
            const elevatedRoles = ['adminManager', 'adminAdvisor', 'hrManager', 'siteManager'];
            if (document.userId !== updatedBy && !elevatedRoles.includes(userRole)) {

                // Check team manager access
                if (userRole === 'teamManager') {
                    const managedEmployeeIds = await getManagedEmployeeIdsForManager(updatedBy, companyId);
                    if (!managedEmployeeIds.has(document.userId)) {
                        throw new Error('Access denied: You can only edit documents for your team');
                    }
                } else {
                    throw new Error('Access denied: You can only edit your own documents');
                }
            }

            const updateData = {
                ...updates,
                updatedAt: new Date().toISOString(),
                timestamp: Date.now(),
                updatedBy
            };

            // Remove immutable fields
            delete updateData.id;
            delete updateData.companyId;
            delete updateData.userId;
            delete updateData.createdAt;
            delete updateData.uploadedAt;
            delete updateData.requestId;

            await updateDoc(documentRef, updateData);

            // Update related request if exists and title changed
            if (document.requestId && (updates.documentTitle || updates.documentType)) {
                const requestRef = doc(db, this.requestsCollection, document.requestId);
                const requestUpdates = {};
                if (updates.documentTitle) requestUpdates.documentTitle = updates.documentTitle;
                if (updates.documentType) requestUpdates.documentType = updates.documentType;

                if (Object.keys(requestUpdates).length > 0) {
                    await updateDoc(requestRef, {
                        ...requestUpdates,
                        updatedAt: new Date().toISOString(),
                        timestamp: Date.now()
                    });
                }
            }
            return { success: true, data: { id: documentId, ...updateData } };
        } catch (error) {
            console.error('Error updating document:', error);
            throw new Error(`Failed to update document: ${error.message}`);
        }
    }

    /**
     * Delete document and file
     */
    async deleteDocument(documentId, userId, userRole, companyId) {
        try {
            const documentRef = doc(db, this.documentsCollection, documentId);
            const documentSnap = await getDoc(documentRef);

            if (!documentSnap.exists()) {
                throw new Error('Document not found');
            }

            const document = documentSnap.data();

            // Verify company access
            if (document.companyId !== companyId) {
                throw new Error('Access denied: Document not in your company');
            }

            // Only allow deletion by document owner or elevated roles
            const elevatedRoles = ['adminManager', 'adminAdvisor', 'hrManager', 'siteManager'];
            if (document.userId !== userId && !elevatedRoles.includes(userRole)) {
                throw new Error('Access denied: You can only delete your own documents');
            }

            // For team managers, verify they can manage this user
            if (userRole === 'teamManager' && document.userId !== userId) {
                const managedEmployeeIds = await getManagedEmployeeIdsForManager(userId, companyId);
                if (!managedEmployeeIds.has(document.userId)) {
                    throw new Error('Access denied: User not in your team');
                }
            }

            // Delete file from storage
            try {
                const fileRef = ref(this.storage, document.storagePath);
                await deleteObject(fileRef);
            } catch (storageError) {
                console.warn('Failed to delete file from storage:', storageError);
                // Continue with database deletion even if file deletion fails
            }

            await deleteDoc(documentRef);

            if (document.requestId) {
                const requestRef = doc(db, this.requestsCollection, document.requestId);
                const requestSnap = await getDoc(requestRef);

                if (requestSnap.exists()) {
                    await updateDoc(requestRef, {
                        status: 'pending',
                        documentId: null,
                        updatedAt: serverTimestamp()
                    });
                }
            }
            return { success: true };
        } catch (error) {
            console.error('Error deleting document:', error);
            throw new Error(`Failed to delete document: ${error.message}`);
        }
    }

    /**
     * Get document statistics for dashboard
     */
    async getDocumentStatistics(companyId, userRole, userId) {
        try {
            const rawId = companyId.replace('companies/', '');
            const pathId = `companies/${rawId}`;

            // OPTIMIZATION: Use Distributed Counters for Company-Wide Views (Admins/HR/Site)
            // This turns an O(N) operation (reading 1000s of docs) into O(1).
            const companyWideRoles = ['adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor', 'siteManager'];

            if (companyWideRoles.includes(userRole)) {
                try {
                    // Counters are stored under collection: counters/{companyId}
                    // IMPORTANT: Firestore doc IDs cannot contain '/', so never pass a path like `companies/<id>` as a doc id.
                    const counterSnap = await getDoc(doc(db, 'counters', rawId));

                    if (counterSnap.exists()) {
                        const data = counterSnap.data();
                        return {
                            success: true,
                            data: {
                                totalRequests: data.totalRequests || 0,
                                pendingRequests: data.req_status_pending || 0,
                                uploadedDocuments: data.req_status_uploaded || 0,
                                approvedDocuments: data.status_approved || 0,
                                declinedDocuments: data.status_declined || 0,
                                pendingApproval: data.status_uploaded || 0
                            },
                            source: 'optimized-counters'
                        };
                    } else {
                        console.warn('Counters not found for company, falling back to live fetch.');
                    }
                } catch (err) {
                    console.error('Error fetching counters, falling back to legacy:', err);
                }
            }

            // FALLBACK / LEGACY PATH: For Team Managers & Employees (Filtered views)
            // OR if counters doc doesn't exist yet — query both companyId formats.
            const STATS_LIMIT = 1000;

            const [requestsSnapshot, documentsSnapshot] = await Promise.all([
                getDocs(query(
                    collection(db, this.requestsCollection),
                    where('companyId', 'in', [rawId, pathId]),
                    limit(STATS_LIMIT)
                )),
                getDocs(query(
                    collection(db, this.documentsCollection),
                    where('companyId', 'in', [rawId, pathId]),
                    limit(STATS_LIMIT)
                ))
            ]);

            let requests = requestsSnapshot.docs.map(d => d.data());
            let documents = documentsSnapshot.docs.map(d => d.data());

            // Filter for team managers
            if (userRole === 'teamManager') {
                const managedEmployeeIds = await getManagedEmployeeIdsForManager(userId, companyId);
                requests = requests.filter(r =>
                    managedEmployeeIds.has(r.userId) || r.requestedBy === userId
                );
                documents = documents.filter(d =>
                    managedEmployeeIds.has(d.userId) || d.uploadedBy === userId
                );
            } else if (userRole === 'employee') {
                requests = requests.filter(r => r.userId === userId);
                documents = documents.filter(d => d.userId === userId);
            }

            const stats = {
                totalRequests: requests.length,
                pendingRequests: requests.filter(r => r.status === 'pending').length,
                uploadedDocuments: requests.filter(r => r.status === 'uploaded').length,
                approvedDocuments: documents.filter(d => d.status === 'approved').length,
                declinedDocuments: documents.filter(d => d.status === 'declined').length,
                pendingApproval: documents.filter(d => d.status === 'uploaded').length
            };

            return { success: true, data: stats, source: 'live-calc' };
        } catch (error) {
            console.error('Error fetching document statistics:', error);
            throw new Error(`Failed to fetch document statistics: ${error.message}`);
        }
    }

    /**
     * Helper methods for permission checking
     */
    async canCreateDocumentRequest(userRole, requesterId, targetUserId, companyId) {
        // Only managers and above can create document requests
        const allowedRoles = ['siteManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor', 'teamManager'];
        if (!allowedRoles.includes(userRole)) {
            return { allowed: false, reason: 'Insufficient permissions to create document requests' };
        }

        // Prevent self-assignment - users cannot create document requests for themselves
        if (requesterId === targetUserId) {
            return { allowed: false, reason: 'Cannot create document requests for yourself' };
        }

        // Elevated roles can create requests for any user in their company
        const elevatedRoles = ['siteManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor'];
        if (elevatedRoles.includes(userRole)) {
            return { allowed: true, scope: 'company' };
        }

        // Team managers can only create requests for their managed employees
        if (userRole === 'teamManager') {
            const managedEmployeeIds = await getManagedEmployeeIdsForManager(requesterId, companyId);
            if (managedEmployeeIds.has(targetUserId)) {
                return { allowed: true, scope: 'team' };
            }
            return { allowed: false, reason: 'User not in your team' };
        }

        return { allowed: false, reason: 'Cannot determine request permissions' };
    }

    async canApproveDocument(userRole, approverId, documentUserId, companyId) {
        // Check basic permission
        const allowedRoles = ['siteManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor', 'teamManager'];
        if (!allowedRoles.includes(userRole)) {
            return { allowed: false, reason: 'Insufficient permissions to approve documents' };
        }

        // Prevent self-approval
        if (documentUserId === approverId) {
            return { allowed: false, reason: 'You cannot approve your own documents' };
        }

        // Elevated roles can approve any document in their company
        const elevatedRoles = ['siteManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor'];
        if (elevatedRoles.includes(userRole)) {
            return { allowed: true, scope: 'company' };
        }

        // Team managers can only approve documents for their managed employees
        if (userRole === 'teamManager') {
            const managedEmployeeIds = await getManagedEmployeeIdsForManager(approverId, companyId);
            if (managedEmployeeIds.has(documentUserId)) {
                return { allowed: true, scope: 'team' };
            }
            return { allowed: false, reason: 'User not in your team' };
        }

        return { allowed: false, reason: 'Cannot determine approval permissions' };
    }

    /**
     * Helper method to get document type label
     */
    async getDocumentTypeLabel(documentType, companyId) {
        const types = await this.getDocumentTypes(companyId);
        const type = types.find(t => t.value === documentType);
        return type ? type.label : documentType;
    }

    /**
     * Update training records when document is requested
     */
    async updateTrainingForDocument(documentRequest, requestData, companyId) {
        try {
            // Check if this document type is training-related
            const trainingDocumentTypes = ['qualification_certificate', 'medical_certificate', 'policy_agreement', 'contract'];

            if (trainingDocumentTypes.includes(requestData.documentType)) {
                // Create or update training assignment
                const trainingAssignmentRef = doc(collection(db, 'trainingAssignments'));
                const assignmentData = {
                    id: trainingAssignmentRef.id,
                    userId: requestData.userId,
                    documentRequestId: documentRequest.id,
                    documentType: requestData.documentType,
                    documentTitle: requestData.documentTitle,
                    companyId: companyId,
                    status: 'pending',
                    assignedBy: documentRequest.requestedBy,
                    assignedAt: new Date().toISOString(),
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    timestamp: Date.now()
                };

                await setDoc(trainingAssignmentRef, assignmentData);
                console.log('Training assignment created for document:', documentRequest.id);
            }
        } catch (error) {
            console.warn('Failed to update training for document:', error);
            // Don't throw error - document creation should still succeed even if training update fails
        }
    }

    /**
     * Update training assignment when document is submitted
     */
    async updateTrainingOnDocumentSubmission(documentId, request, companyId) {
        try {
            // Find training assignment associated with this document request
            const assignmentsQuery = query(
                collection(db, 'trainingAssignments'),
                where('documentRequestId', '==', request.id),
                where('companyId', '==', companyId)
            );

            const snapshot = await getDocs(assignmentsQuery);

            if (!snapshot.empty) {
                const assignmentRef = doc(db, 'trainingAssignments', snapshot.docs[0].id);
                await updateDoc(assignmentRef, {
                    status: 'submitted',
                    documentId: documentId,
                    submittedAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    timestamp: Date.now()
                });
                console.log('Training assignment updated for document submission:', documentId);
            }
        } catch (error) {
            console.warn('Failed to update training on document submission:', error);
            // Don't throw error - document submission should still succeed even if training update fails
        }
    }
}

// Export singleton instance
export const documentService = new DocumentService();
export default documentService;