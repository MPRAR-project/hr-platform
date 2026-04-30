/**
 * Training Service - Core business logic for training management
 * Handles CRUD operations, role-based permissions, and data validation
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
    serverTimestamp,
    writeBatch,
    arrayUnion,
    arrayRemove,
    Timestamp,
    documentId,
    onSnapshot
} from 'firebase/firestore';
import { getManagedEmployeeIdsForManager } from './teams';

/**
 * Training Service Class
 */
class TrainingService {
    constructor() {
        this.collection = 'trainings';
        this.assignmentsCollection = 'trainingAssignments';
        this.certificatesCollection = 'trainingCertificates';
        this.notificationsCollection = 'trainingNotifications';
        this.subscriptions = new Map();
    }

    /**
     * Subscribe to trainings for a company
     */
    subscribeTrainings(companyId, callback) {
        const q = query(
            collection(db, this.collection),
            where('companyId', '==', companyId)
        );

        return onSnapshot(q, (snapshot) => {
            const trainings = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            callback({ success: true, data: trainings });
        }, (error) => {
            console.error('Error in trainings subscription:', error);
            callback({ success: false, error: error.message });
        });
    }

    /**
     * Subscribe to training assignments
     */
    subscribeAssignments(companyId, userId = null, callback) {
        let q;
        if (userId) {
            q = query(
                collection(db, this.assignmentsCollection),
                where('companyId', '==', companyId),
                where('userId', '==', userId)
            );
        } else {
            q = query(
                collection(db, this.assignmentsCollection),
                where('companyId', '==', companyId)
            );
        }

        return onSnapshot(q, async (snapshot) => {
            const rawAssignments = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            // Enriched in component or here? 
            // Better to enrich here to keep current API behavior
            try {
                // 1. Collect unique IDs
                const trainingIds = [...new Set(rawAssignments.map(a => a.trainingId))].filter(Boolean);
                const extensionRequestIds = [...new Set(rawAssignments.map(a => a.extensionRequestId))].filter(Boolean);

                const trainings = {};
                const extensionRequests = {};

                // 2. Batch Fetch Trainings (Chunked by 10)
                const trainingChunks = [];
                for (let i = 0; i < trainingIds.length; i += 10) {
                    trainingChunks.push(trainingIds.slice(i, i + 10));
                }

                await Promise.all(trainingChunks.map(async (chunk) => {
                    const tSnap = await getDocs(query(collection(db, this.collection), where(documentId(), 'in', chunk)));
                    tSnap.forEach(doc => { trainings[doc.id] = doc.data(); });
                }));

                // 3. Batch Fetch Extension Requests
                if (extensionRequestIds.length > 0) {
                    const extChunks = [];
                    for (let i = 0; i < extensionRequestIds.length; i += 10) {
                        extChunks.push(extensionRequestIds.slice(i, i + 10));
                    }
                    await Promise.all(extChunks.map(async (chunk) => {
                        const eSnap = await getDocs(query(collection(db, 'trainingExtensionRequests'), where(documentId(), 'in', chunk)));
                        eSnap.forEach(doc => { extensionRequests[doc.id] = doc.data(); });
                    }));
                }

                const enriched = rawAssignments.map(assignment => ({
                    ...assignment,
                    training: trainings[assignment.trainingId] || null,
                    extensionRequest: assignment.extensionRequestId ? extensionRequests[assignment.extensionRequestId] : null
                }));

                callback({ success: true, data: enriched });
            } catch (err) {
                console.error('Error enriching subscriptions:', err);
                callback({ success: true, data: rawAssignments }); // Fallback to raw if enrichment fails
            }
        }, (error) => {
            console.error('Error in assignments subscription:', error);
            callback({ success: false, error: error.message });
        });
    }

    /**
     * Create a new training course
     */
    async createTraining(trainingData, createdBy) {
        try {
            const trainingRef = doc(collection(db, this.collection));
            const now = serverTimestamp();

            const training = {
                id: trainingRef.id,
                name: trainingData.name,
                description: trainingData.description,
                category: trainingData.category || trainingData.trainingType || 'General',
                type: trainingData.type || 'mandatory',
                companyId: trainingData.companyId,
                createdBy,
                status: 'active',
                validityPeriod: trainingData.validityPeriod || 365, // days
                priority: trainingData.priority || 'medium',
                estimatedDuration: trainingData.estimatedDuration || 60, // minutes
                instructor: trainingData.instructor || this.getDefaultInstructor(trainingData.trainingType || trainingData.category),
                location: trainingData.location || this.getDefaultLocation(trainingData.trainingType || trainingData.category),
                learningObjectives: trainingData.learningObjectives?.length > 0 ? trainingData.learningObjectives : this.getDefaultObjectives(trainingData.name, trainingData.trainingType || trainingData.category),
                requirements: trainingData.requirements?.length > 0 ? trainingData.requirements : this.getDefaultRequirements(trainingData.trainingType || trainingData.category),
                materials: trainingData.materials || [],
                // Additional metadata
                trainingType: trainingData.trainingType || trainingData.category || 'Technical',
                createdAt: now,
                updatedAt: now
            };

            await setDoc(trainingRef, training);

            console.log('Training created successfully:', training.id);
            return { success: true, data: training };
        } catch (error) {
            console.error('Error creating training:', error);
            throw new Error(`Failed to create training: ${error.message}`);
        }
    }

    /**
     * Get trainings for a company with role-based filtering
     */
    async getTrainings(companyId, userRole, userId) {
        try {
            const trainingsQuery = query(
                collection(db, this.collection),
                where('companyId', '==', companyId)
            );

            const snapshot = await getDocs(trainingsQuery);
            let trainings = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            // Sort by createdAt in descending order (client-side)
            trainings.sort((a, b) => {
                const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
                const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
                return dateB - dateA;
            });

            // Filter based on role permissions
            if (userRole === 'teamManager') {
                // Team managers can only see trainings they created or trainings assigned to their managed employees
                const managedEmployeeIds = await getManagedEmployeeIdsForManager(userId, companyId);
                const managedUserIds = Array.from(managedEmployeeIds || []);

                const relevantTrainingIds = new Set();
                if (managedUserIds.length > 0) {
                    const userChunks = [];
                    for (let i = 0; i < managedUserIds.length; i += 10) {
                        userChunks.push(managedUserIds.slice(i, i + 10));
                    }

                    const snaps = await Promise.all(
                        userChunks.map(chunk =>
                            getDocs(
                                query(
                                    collection(db, this.assignmentsCollection),
                                    where('companyId', '==', companyId),
                                    where('userId', 'in', chunk)
                                )
                            )
                        )
                    );

                    snaps.forEach(snap => {
                        snap.docs.forEach(d => {
                            const data = d.data();
                            if (data?.trainingId) relevantTrainingIds.add(data.trainingId);
                        });
                    });
                }

                trainings = trainings.filter(training =>
                    training.createdBy === userId || relevantTrainingIds.has(training.id)
                );
            }

            return { success: true, data: trainings };
        } catch (error) {
            console.error('Error fetching trainings:', error);
            throw new Error(`Failed to fetch trainings: ${error.message}`);
        }
    }

    /**
     * Get training by ID with permission check
     */
    async getTrainingById(trainingId, companyId, userRole, userId) {
        try {
            const trainingRef = doc(db, this.collection, trainingId);
            const trainingSnap = await getDoc(trainingRef);

            if (!trainingSnap.exists()) {
                throw new Error('Training not found');
            }

            const training = { id: trainingSnap.id, ...trainingSnap.data() };

            // Verify company access
            if (training.companyId !== companyId) {
                throw new Error('Access denied: Training not in your company');
            }

            // Additional role-based checks for team managers
            if (userRole === 'teamManager') {
                const managedEmployeeIds = await getManagedEmployeeIdsForManager(userId, companyId);
                if (training.createdBy !== userId &&
                    !await this.isTrainingRelevantToManager(trainingId, managedEmployeeIds)) {
                    throw new Error('Access denied: Training not in your scope');
                }
            }

            return { success: true, data: training };
        } catch (error) {
            console.error('Error fetching training:', error);
            throw new Error(`Failed to fetch training: ${error.message}`);
        }
    }

    /**
     * Update training
     */
    async updateTraining(trainingId, updates, updatedBy, userRole, companyId) {
        try {
            const trainingRef = doc(db, this.collection, trainingId);
            const trainingSnap = await getDoc(trainingRef);

            if (!trainingSnap.exists()) {
                throw new Error('Training not found');
            }

            const training = trainingSnap.data();

            // Permission checks
            if (training.companyId !== companyId) {
                throw new Error('Access denied: Training not in your company');
            }

            // For team managers, check if training is relevant to their team
            if (userRole === 'teamManager') {
                if (training.createdBy !== updatedBy) {
                    // Check if training is assigned to any of their managed employees
                    const managedEmployeeIds = await getManagedEmployeeIdsForManager(updatedBy, companyId);
                    const isRelevantToTeam = await this.isTrainingRelevantToManager(trainingId, managedEmployeeIds);
                    
                    if (!isRelevantToTeam) {
                        throw new Error('Access denied: You can only edit trainings you created or that are assigned to your team');
                    }
                }
            }

            const updateData = {
                ...updates,
                updatedAt: serverTimestamp(),
                updatedBy
            };

            // Sync category if trainingType is updated
            if (updates.trainingType && !updates.category) {
                updateData.category = updates.trainingType;
            }

            // Remove fields that shouldn't be updated
            delete updateData.id;
            delete updateData.companyId;
            delete updateData.createdBy;
            delete updateData.createdAt;

            await updateDoc(trainingRef, updateData);

            console.log('Training updated successfully:', trainingId);
            return { success: true, data: { id: trainingId, ...updateData } };
        } catch (error) {
            console.error('Error updating training:', error);
            throw new Error(`Failed to update training: ${error.message}`);
        }
    }

    /**
     * Delete training (elevated roles only)
     */
    async deleteTraining(trainingId, userId, userRole, companyId) {
        try {
            // Only elevated roles can delete trainings
            const elevatedRoles = ['adminManager', 'adminAdvisor', 'hrManager', 'siteManager'];
            if (!elevatedRoles.includes(userRole)) {
                throw new Error('Access denied: Insufficient permissions to delete training');
            }

            const trainingRef = doc(db, this.collection, trainingId);
            const trainingSnap = await getDoc(trainingRef);

            if (!trainingSnap.exists()) {
                throw new Error('Training not found');
            }

            const training = trainingSnap.data();
            if (training.companyId !== companyId) {
                throw new Error('Access denied: Training not in your company');
            }

            // Use batch to delete training and related assignments
            const batch = writeBatch(db);

            // Delete the training
            batch.delete(trainingRef);

            // Delete related assignments
            const assignmentsQuery = query(
                collection(db, this.assignmentsCollection),
                where('trainingId', '==', trainingId)
            );
            const assignmentsSnap = await getDocs(assignmentsQuery);
            assignmentsSnap.docs.forEach(doc => {
                batch.delete(doc.ref);
            });

            await batch.commit();

            console.log('Training deleted successfully:', trainingId);
            return { success: true };
        } catch (error) {
            console.error('Error deleting training:', error);
            throw new Error(`Failed to delete training: ${error.message}`);
        }
    }

    /**
     * Assign training to users
     */
    async assignTraining(trainingId, userIds, assignedBy, companyId, userRole, dueDate, additionalData = {}) {
        try {
            // For team managers, use a more permissive check - they can assign any company training to their managed employees
            let trainingResult;
            if (userRole === 'teamManager') {
                // Team managers can access any training in their company for assignment purposes
                const trainingRef = doc(db, this.collection, trainingId);
                const trainingSnap = await getDoc(trainingRef);

                if (!trainingSnap.exists()) {
                    throw new Error('Training not found');
                }

                const training = { id: trainingSnap.id, ...trainingSnap.data() };

                // Verify company access
                if (training.companyId !== companyId) {
                    throw new Error('Access denied: Training not in your company');
                }

                trainingResult = { success: true, data: training };
            } else {
                // For other roles, use the strict getTrainingById check
                trainingResult = await this.getTrainingById(trainingId, companyId, userRole, assignedBy);
            }

            if (!trainingResult.success) {
                throw new Error('Training not found or access denied');
            }

            // For team managers, validate they can assign to these users
            if (userRole === 'teamManager') {
                const managedEmployeeIds = await getManagedEmployeeIdsForManager(assignedBy, companyId);
                const unauthorizedUsers = userIds.filter(userId => !managedEmployeeIds.has(userId));
                if (unauthorizedUsers.length > 0) {
                    throw new Error(`Access denied: Cannot assign training to users outside your team`);
                }
            }

            const batch = writeBatch(db);
            const now = serverTimestamp();
            const assignments = [];

            for (const userId of userIds) {
                const assignmentRef = doc(collection(db, this.assignmentsCollection));

                // Convert date strings to Firestore timestamps if provided
                const assignmentDate = additionalData.assignmentDate
                    ? Timestamp.fromDate(new Date(additionalData.assignmentDate))
                    : now;
                const dueDateTimestamp = dueDate
                    ? Timestamp.fromDate(new Date(dueDate))
                    : null;
                const expiryDateTimestamp = additionalData.expiryDate
                    ? Timestamp.fromDate(new Date(additionalData.expiryDate))
                    : null;

                // Fetch user data to get siteId
                let siteId = null;
                try {
                    const userSnap = await getDoc(doc(db, 'users', userId));
                    if (userSnap.exists()) {
                        siteId = userSnap.data().siteId || null;
                    }
                } catch (err) {
                    console.warn(`Failed to fetch siteId for user ${userId}`, err);
                }

                const assignment = {
                    id: assignmentRef.id,
                    trainingId,
                    userId,
                    companyId,
                    siteId, // Link assignment to user's current site
                    assignedBy,
                    status: 'assigned',
                    assignedDate: assignmentDate,
                    dueDate: dueDateTimestamp,
                    expiryDate: expiryDateTimestamp,
                    createdAt: now,
                    updatedAt: now
                };

                batch.set(assignmentRef, assignment);
                assignments.push(assignment);
            }

            await batch.commit();

            console.log(`Training assigned to ${userIds.length} users`);
            return { success: true, data: assignments };
        } catch (error) {
            console.error('Error assigning training:', error);
            throw new Error(`Failed to assign training: ${error.message}`);
        }
    }

    /**
     * Get training assignments for a user or company
     */
    async getTrainingAssignments(companyId, userId = null, userRole, requesterId) {
        try {
            let assignmentsQuery;

            if (userId) {
                // Get assignments for specific user
                assignmentsQuery = query(
                    collection(db, this.assignmentsCollection),
                    where('companyId', '==', companyId),
                    where('userId', '==', userId)
                );
            } else {
                // Get all assignments for company (with role-based filtering)
                assignmentsQuery = query(
                    collection(db, this.assignmentsCollection),
                    where('companyId', '==', companyId)
                );
            }

            const snapshot = await getDocs(assignmentsQuery);
            let assignments = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    ...data,
                    history: data.history || null
                };
            });

            // Sort by assignedDate in descending order (client-side)
            assignments.sort((a, b) => {
                const dateA = a.assignedDate?.toDate ? a.assignedDate.toDate() : new Date(a.assignedDate || 0);
                const dateB = b.assignedDate?.toDate ? b.assignedDate.toDate() : new Date(b.assignedDate || 0);
                return dateB - dateA;
            });

            // Filter based on role permissions
            if (userRole === 'teamManager') {
                const managedEmployeeIds = await getManagedEmployeeIdsForManager(requesterId, companyId);
                assignments = assignments.filter(assignment =>
                    managedEmployeeIds.has(assignment.userId) || assignment.userId === requesterId
                );
            }

            // --- PERFORMANCE OPTIMIZATION: BATCH FETCHING ---

            // 1. Collect unique IDs
            const trainingIds = [...new Set(assignments.map(a => a.trainingId))].filter(Boolean);
            const extensionRequestIds = [...new Set(assignments.map(a => a.extensionRequestId))].filter(Boolean);

            const trainings = {};
            const extensionRequests = {};

            // 2. Batch Fetch Trainings (Chunked by 10)
            const trainingChunks = [];
            for (let i = 0; i < trainingIds.length; i += 10) {
                trainingChunks.push(trainingIds.slice(i, i + 10));
            }

            await Promise.all(trainingChunks.map(async (chunk) => {
                try {
                    const q = query(collection(db, this.collection), where(documentId(), 'in', chunk));
                    const snap = await getDocs(q);
                    snap.forEach(doc => {
                        trainings[doc.id] = doc.data();
                    });
                } catch (e) {
                    console.error('Error batch fetching trainings', e);
                }
            }));

            // 3. Batch Fetch Extension Requests (Chunked by 10)
            if (extensionRequestIds.length > 0) {
                const extChunks = [];
                for (let i = 0; i < extensionRequestIds.length; i += 10) {
                    extChunks.push(extensionRequestIds.slice(i, i + 10));
                }

                await Promise.all(extChunks.map(async (chunk) => {
                    try {
                        const q = query(collection(db, 'trainingExtensionRequests'), where(documentId(), 'in', chunk));
                        const snap = await getDocs(q);
                        snap.forEach(doc => {
                            extensionRequests[doc.id] = doc.data();
                        });
                    } catch (e) {
                        console.error('Error batch fetching extension requests', e);
                    }
                }));
            }

            // 4. Enrich assignments in memory
            assignments = assignments.map(assignment => ({
                ...assignment,
                training: trainings[assignment.trainingId] || null,
                extensionRequest: assignment.extensionRequestId ? extensionRequests[assignment.extensionRequestId] : null,
                // Add convenience fields for extension data
                extensionReason: assignment.extensionRequestId ? extensionRequests[assignment.extensionRequestId]?.reason : null,
                extensionJustification: assignment.extensionRequestId ? extensionRequests[assignment.extensionRequestId]?.justification : null,
                requestedDueDate: assignment.extensionRequestId ? extensionRequests[assignment.extensionRequestId]?.requestedDueDate : null
            }));

            return { success: true, data: assignments };
        } catch (error) {
            console.error('Error fetching training assignments:', error);
            throw new Error(`Failed to fetch training assignments: ${error.message}`);
        }
    }

    /**
     * Update assignment status (for approvals/declines)
     */
    async updateAssignmentStatus(assignmentId, status, updatedBy, userRole, companyId, notes = null) {
        try {
            const assignmentRef = doc(db, this.assignmentsCollection, assignmentId);
            const assignmentSnap = await getDoc(assignmentRef);

            if (!assignmentSnap.exists()) {
                throw new Error('Assignment not found');
            }

            const assignment = assignmentSnap.data();

            // Verify company access
            if (assignment.companyId !== companyId) {
                throw new Error('Access denied: Assignment not in your company');
            }

            // For team managers, verify they can manage this user
            if (userRole === 'teamManager') {
                const managedEmployeeIds = await getManagedEmployeeIdsForManager(updatedBy, companyId);
                if (!managedEmployeeIds.has(assignment.userId)) {
                    throw new Error('Access denied: User not in your team');
                }
            }

            const updateData = {
                status,
                updatedAt: serverTimestamp(),
                updatedBy
            };

            if (status === 'completed') {
                updateData.completedDate = serverTimestamp();
            } else if (status === 'declined') {
                updateData.declinedDate = serverTimestamp();
                updateData.declineReason = notes;
            }

            if (notes) {
                updateData.notes = notes;
            }

            await updateDoc(assignmentRef, updateData);

            console.log('Assignment status updated:', assignmentId, status);
            return { success: true, data: { id: assignmentId, ...updateData } };
        } catch (error) {
            console.error('Error updating assignment status:', error);
            throw new Error(`Failed to update assignment status: ${error.message}`);
        }
    }

    /**
     * Update training assignment (for editing history and dates)
     */
    async updateAssignment(assignmentId, updateData, updatedBy, companyId) {
        try {
            const assignmentRef = doc(db, this.assignmentsCollection, assignmentId);
            const assignmentSnap = await getDoc(assignmentRef);

            if (!assignmentSnap.exists()) {
                throw new Error('Assignment not found');
            }

            const assignment = assignmentSnap.data();

            // Verify company access
            if (assignment.companyId !== companyId) {
                throw new Error('Access denied: Assignment not in your company');
            }

            // Prepare update data
            const finalUpdateData = {
                ...updateData,
                updatedAt: serverTimestamp(),
                updatedBy
            };

            // Convert date strings to Timestamps if needed
            // Check if it's already a Firestore Timestamp (has toDate method) or a regular Timestamp
            if (updateData.assignedDate) {
                if (updateData.assignedDate instanceof Timestamp || (updateData.assignedDate.toDate && typeof updateData.assignedDate.toDate === 'function')) {
                    finalUpdateData.assignedDate = updateData.assignedDate;
                } else {
                    finalUpdateData.assignedDate = Timestamp.fromDate(new Date(updateData.assignedDate));
                }
            }
            if (updateData.completedDate) {
                if (updateData.completedDate instanceof Timestamp || (updateData.completedDate.toDate && typeof updateData.completedDate.toDate === 'function')) {
                    finalUpdateData.completedDate = updateData.completedDate;
                } else {
                    finalUpdateData.completedDate = Timestamp.fromDate(new Date(updateData.completedDate));
                }
            }
            if (updateData.expiryDate) {
                if (updateData.expiryDate instanceof Timestamp || (updateData.expiryDate.toDate && typeof updateData.expiryDate.toDate === 'function')) {
                    finalUpdateData.expiryDate = updateData.expiryDate;
                } else {
                    finalUpdateData.expiryDate = Timestamp.fromDate(new Date(updateData.expiryDate));
                }
            }

            // Process history array if provided
            if (updateData.history && Array.isArray(updateData.history)) {
                finalUpdateData.history = updateData.history.map(entry => {
                    // Helper function to convert to Timestamp
                    const toTimestamp = (date) => {
                        if (!date) return null;
                        if (date instanceof Timestamp || (date.toDate && typeof date.toDate === 'function')) {
                            return date;
                        }
                        if (date instanceof Date) {
                            return Timestamp.fromDate(date);
                        }
                        return Timestamp.fromDate(new Date(date));
                    };

                    return {
                        bookedDate: toTimestamp(entry.bookedDate),
                        completedDate: toTimestamp(entry.completedDate),
                        expiryDate: toTimestamp(entry.expiryDate),
                        status: entry.status,
                        createdAt: entry.createdAt ? toTimestamp(entry.createdAt) : Timestamp.now()
                    };
                });
            }

            await updateDoc(assignmentRef, finalUpdateData);

            console.log('Assignment updated:', assignmentId);
            return { success: true, data: { id: assignmentId, ...finalUpdateData } };
        } catch (error) {
            console.error('Error updating assignment:', error);
            throw new Error(`Failed to update assignment: ${error.message}`);
        }
    }

    /**
     * Helper method to check if training is relevant to a team manager
     */
    async isTrainingRelevantToManager(trainingId, managedEmployeeIds) {
        try {
            const assignmentsQuery = query(
                collection(db, this.assignmentsCollection),
                where('trainingId', '==', trainingId)
            );

            const snapshot = await getDocs(assignmentsQuery);
            return snapshot.docs.some(doc =>
                managedEmployeeIds.has(doc.data().userId)
            );
        } catch (error) {
            console.error('Error checking training relevance:', error);
            return false;
        }
    }

    /**
     * Get training statistics for dashboard
     */
    async getTrainingStatistics(companyId, userRole, userId) {
        try {
            let assignments = [];

            // OPTIMIZATION: Only fetch relevant assignments for Team Managers
            if (userRole === 'teamManager') {
                const managedEmployeeIds = await getManagedEmployeeIdsForManager(userId, companyId);
                const userIds = Array.from(managedEmployeeIds);

                if (userIds.length === 0) {
                    // Start of function - empty team
                    return {
                        success: true,
                        data: {
                            totalAssignments: 0,
                            completed: 0,
                            pending: 0,
                            overdue: 0,
                            pendingApproval: 0,
                            completionRate: 0
                        }
                    };
                }

                // Chunk queries to respect Firestore 'in' limit (10 or 30). Using 10.
                const userChunks = [];
                for (let i = 0; i < userIds.length; i += 10) {
                    userChunks.push(userIds.slice(i, i + 10));
                }

                const snaps = await Promise.all(userChunks.map(chunk =>
                    getDocs(query(
                        collection(db, this.assignmentsCollection),
                        where('companyId', '==', companyId),
                        where('userId', 'in', chunk)
                    ))
                ));

                assignments = snaps.flatMap(s => s.docs.map(d => d.data()));

            } else {
                // For Admin/HR, fetch all company assignments (Legacy behavior)
                // Note: For very large companies, this should eventually be aggregated.
                const assignmentsQuery = query(
                    collection(db, this.assignmentsCollection),
                    where('companyId', '==', companyId)
                );
                const snapshot = await getDocs(assignmentsQuery);
                assignments = snapshot.docs.map(doc => doc.data());
            }

            const stats = {
                totalAssignments: assignments.length,
                completed: assignments.filter(a => a.status === 'completed').length,
                pending: assignments.filter(a => a.status === 'assigned' || a.status === 'in_progress').length,
                overdue: assignments.filter(a => {
                    if (!a.dueDate || a.status === 'completed') return false;
                    const dueDate = a.dueDate.toDate ? a.dueDate.toDate() : new Date(a.dueDate);
                    return dueDate < new Date();
                }).length,
                pendingApproval: assignments.filter(a => a.status === 'pending_approval').length
            };

            stats.completionRate = stats.totalAssignments > 0
                ? Math.round((stats.completed / stats.totalAssignments) * 100)
                : 0;

            return { success: true, data: stats };
        } catch (error) {
            console.error('Error fetching training statistics:', error);
            throw new Error(`Failed to fetch training statistics: ${error.message}`);
        }
    }

    /**
     * Helper methods for generating default training content
     */
    getDefaultInstructor(trainingType) {
        const instructors = {
            'Technical': 'Technical Training Team',
            'Safety & Compliance': 'Safety Officer - John Smith',
            'Soft Skills': 'HR Development Team',
            'Leadership': 'Leadership Development - Sarah Johnson',
            'Mandatory on Sign Up': 'Onboarding Team',
            'Other': 'Training Department'
        };
        return instructors[trainingType] || 'Training Department';
    }

    getDefaultLocation(trainingType) {
        const locations = {
            'Technical': 'Computer Lab / Online',
            'Safety & Compliance': 'Main Conference Room',
            'Soft Skills': 'Training Room B',
            'Leadership': 'Executive Conference Room',
            'Mandatory on Sign Up': 'Online / Learning Portal',
            'Other': 'Online/Self-paced'
        };
        return locations[trainingType] || 'Online/Self-paced';
    }

    getDefaultObjectives(trainingName, trainingType) {
        const baseObjectives = {
            'Technical': [
                `Understand the technical concepts and principles of ${trainingName}`,
                'Apply learned technical skills in practical work situations',
                'Demonstrate proficiency through hands-on exercises',
                'Meet technical competency requirements'
            ],
            'Safety & Compliance': [
                'Understand safety procedures and compliance requirements',
                'Learn proper safety protocols and emergency procedures',
                'Know how to use safety equipment correctly',
                'Identify potential hazards and risk mitigation strategies'
            ],
            'Soft Skills': [
                'Develop effective communication and interpersonal skills',
                'Learn collaborative teamwork techniques',
                'Improve problem-solving and critical thinking abilities',
                'Enhance professional development and workplace effectiveness'
            ],
            'Leadership': [
                'Develop leadership and management capabilities',
                'Learn effective team management strategies',
                'Understand decision-making and strategic thinking',
                'Build skills for motivating and developing team members'
            ],
            'Mandatory on Sign Up': [
                'Complete essential onboarding requirements',
                'Understand company policies and culture',
                'Set up necessary accounts and tools',
                'Review and sign required documentation'
            ],
            'Other': [
                `Understand the key concepts and principles of ${trainingName}`,
                'Apply learned knowledge in practical work situations',
                'Meet compliance and performance requirements',
                'Demonstrate competency through assessment'
            ]
        };
        return baseObjectives[trainingType] || baseObjectives['Other'];
    }

    getDefaultRequirements(trainingType) {
        const requirements = {
            'Technical': [
                'Complete all technical modules and hands-on exercises',
                'Pass technical assessment with minimum 80% score',
                'Submit practical project or demonstration',
                'Attend all required lab sessions'
            ],
            'Safety & Compliance': [
                'Complete all safety training modules',
                'Pass written safety test with 85% score',
                'Complete practical safety drill',
                'Submit signed safety acknowledgment form'
            ],
            'Soft Skills': [
                'Participate in all interactive sessions and workshops',
                'Complete self-assessment and peer feedback exercises',
                'Submit reflection paper or case study analysis',
                'Demonstrate skills through role-playing scenarios'
            ],
            'Leadership': [
                'Complete leadership assessment and 360-degree feedback',
                'Participate in leadership simulation exercises',
                'Develop and present leadership action plan',
                'Complete mentoring or coaching sessions'
            ],
            'Mandatory on Sign Up': [
                'Complete all onboarding modules',
                'Submit all required employee forms',
                'Attend orientation session',
                'Pass policy understanding assessment'
            ],
            'Other': [
                'Complete all training modules and materials',
                'Pass required assessments with minimum score',
                'Submit certificate of completion',
                'Attend any mandatory sessions or workshops'
            ]
        };
        return requirements[trainingType] || requirements['Other'];
    }
}

// Export singleton instance
export const trainingService = new TrainingService();
export default trainingService;