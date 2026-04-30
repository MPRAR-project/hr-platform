/**
 * Extension Service - Handles training deadline extension requests
 * Manages extension requests, approvals, and notifications
 */

import { db } from '../firebase/client';
import {
    collection,
    doc,
    setDoc,
    getDoc,
    getDocs,
    updateDoc,
    query,
    where,
    orderBy,
    serverTimestamp,
    Timestamp
} from 'firebase/firestore';
import { getManagedEmployeeIdsForManager } from './teams';

/**
 * Extension Service Class
 */
class ExtensionService {
    constructor() {
        this.collection = 'trainingExtensionRequests';
        this.assignmentsCollection = 'trainingAssignments';
    }

    /**
     * Submit extension request
     */
    async submitExtensionRequest(requestData, userId, companyId) {
        try {
            // Validate assignment exists and user has access
            const assignmentRef = doc(db, this.assignmentsCollection, requestData.assignmentId);
            const assignmentSnap = await getDoc(assignmentRef);

            if (!assignmentSnap.exists()) {
                throw new Error('Training assignment not found');
            }

            const assignment = assignmentSnap.data();
            
            // Verify user owns this assignment
            if (assignment.userId !== userId || assignment.companyId !== companyId) {
                throw new Error('Access denied: This assignment does not belong to you');
            }

            // Check if there's already a pending request for this assignment
            const existingRequestQuery = query(
                collection(db, this.collection),
                where('assignmentId', '==', requestData.assignmentId),
                where('status', '==', 'pending')
            );
            const existingRequests = await getDocs(existingRequestQuery);
            
            if (!existingRequests.empty) {
                throw new Error('You already have a pending extension request for this training');
            }

            // Create extension request
            const requestRef = doc(collection(db, this.collection));
            const now = serverTimestamp();
            
            // Handle different date formats for currentDueDate
            let currentDueDateTimestamp;
            if (requestData.currentDueDate?.toDate) {
                // Firestore Timestamp
                currentDueDateTimestamp = requestData.currentDueDate;
            } else if (requestData.currentDueDate) {
                // String or Date object
                currentDueDateTimestamp = Timestamp.fromDate(new Date(requestData.currentDueDate));
            } else {
                // Fallback to assignment's due date
                currentDueDateTimestamp = assignment.dueDate;
            }

            const extensionRequest = {
                id: requestRef.id,
                assignmentId: requestData.assignmentId,
                trainingId: assignment.trainingId,
                userId: userId,
                companyId: companyId,
                trainingName: requestData.trainingName,
                currentDueDate: currentDueDateTimestamp,
                requestedDueDate: Timestamp.fromDate(new Date(requestData.requestedDueDate)),
                reason: requestData.reason,
                justification: requestData.justification,
                status: 'pending',
                requestedAt: now,
                requestedBy: userId,
                createdAt: now,
                updatedAt: now
            };

            await setDoc(requestRef, extensionRequest);

            // Update assignment to indicate extension is pending
            await updateDoc(assignmentRef, {
                extensionStatus: 'pending',
                extensionRequestId: requestRef.id,
                updatedAt: now
            });

            console.log('Extension request submitted successfully:', requestRef.id);
            return { success: true, data: extensionRequest };
        } catch (error) {
            console.error('Error submitting extension request:', error);
            throw new Error(`Failed to submit extension request: ${error.message}`);
        }
    }

    /**
     * Get extension requests for a user or company
     */
    async getExtensionRequests(companyId, userId = null, userRole, requesterId) {
        try {
            let requestsQuery;

            if (userId) {
                // Get requests for specific user
                requestsQuery = query(
                    collection(db, this.collection),
                    where('companyId', '==', companyId),
                    where('userId', '==', userId),
                    orderBy('requestedAt', 'desc')
                );
            } else {
                // Get all requests for company (with role-based filtering)
                requestsQuery = query(
                    collection(db, this.collection),
                    where('companyId', '==', companyId),
                    orderBy('requestedAt', 'desc')
                );
            }

            const snapshot = await getDocs(requestsQuery);
            let requests = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            // Filter based on role permissions
            if (userRole === 'teamManager') {
                const managedEmployeeIds = await getManagedEmployeeIdsForManager(requesterId, companyId);
                requests = requests.filter(request => 
                    managedEmployeeIds.has(request.userId) || request.userId === requesterId
                );
            } else if (userRole === 'employee') {
                requests = requests.filter(request => request.userId === requesterId);
            }

            console.log(`Retrieved ${requests.length} extension requests`);
            return { success: true, data: requests };
        } catch (error) {
            console.error('Error fetching extension requests:', error);
            throw new Error(`Failed to fetch extension requests: ${error.message}`);
        }
    }

    /**
     * Approve extension request
     */
    async approveExtensionRequest(requestId, approvedBy, userRole, companyId, notes = null) {
        try {
            const requestRef = doc(db, this.collection, requestId);
            const requestSnap = await getDoc(requestRef);

            if (!requestSnap.exists()) {
                throw new Error('Extension request not found');
            }

            const request = requestSnap.data();

            // Verify company access
            if (request.companyId !== companyId) {
                throw new Error('Access denied: Request not in your company');
            }

            // Role-based permission check
            if (userRole === 'employee') {
                throw new Error('Access denied: Employees cannot approve extension requests');
            }

            // Prevent self-approval: users cannot approve their own extension requests
            if (request.userId === approvedBy) {
                throw new Error('Access denied: You cannot approve your own extension request');
            }

            if (userRole === 'teamManager') {
                const managedEmployeeIds = await getManagedEmployeeIdsForManager(approvedBy, companyId);
                if (!managedEmployeeIds.has(request.userId)) {
                    throw new Error('Access denied: User not in your team');
                }
            }

            const now = serverTimestamp();

            // Update extension request
            await updateDoc(requestRef, {
                status: 'approved',
                approvedBy: approvedBy,
                approvedAt: now,
                approvalNotes: notes,
                updatedAt: now
            });

            // Update the training assignment with new due date
            const assignmentRef = doc(db, this.assignmentsCollection, request.assignmentId);
            await updateDoc(assignmentRef, {
                dueDate: request.requestedDueDate,
                extensionStatus: 'approved',
                extensionApprovedBy: approvedBy,
                extensionApprovedAt: now,
                updatedAt: now
            });

            console.log('Extension request approved successfully:', requestId);
            return { success: true, data: { id: requestId, status: 'approved' } };
        } catch (error) {
            console.error('Error approving extension request:', error);
            throw new Error(`Failed to approve extension request: ${error.message}`);
        }
    }

    /**
     * Decline extension request
     */
    async declineExtensionRequest(requestId, declinedBy, userRole, companyId, reason) {
        try {
            if (!reason || reason.trim().length === 0) {
                throw new Error('Decline reason is required');
            }

            const requestRef = doc(db, this.collection, requestId);
            const requestSnap = await getDoc(requestRef);

            if (!requestSnap.exists()) {
                throw new Error('Extension request not found');
            }

            const request = requestSnap.data();

            // Verify company access
            if (request.companyId !== companyId) {
                throw new Error('Access denied: Request not in your company');
            }

            // Role-based permission check
            if (userRole === 'employee') {
                throw new Error('Access denied: Employees cannot decline extension requests');
            }

            // Prevent self-approval: users cannot decline their own extension requests
            if (request.userId === declinedBy) {
                throw new Error('Access denied: You cannot decline your own extension request');
            }

            if (userRole === 'teamManager') {
                const managedEmployeeIds = await getManagedEmployeeIdsForManager(declinedBy, companyId);
                if (!managedEmployeeIds.has(request.userId)) {
                    throw new Error('Access denied: User not in your team');
                }
            }

            const now = serverTimestamp();

            // Update extension request
            await updateDoc(requestRef, {
                status: 'declined',
                declinedBy: declinedBy,
                declinedAt: now,
                declineReason: reason,
                updatedAt: now
            });

            // Update assignment to remove pending status
            const assignmentRef = doc(db, this.assignmentsCollection, request.assignmentId);
            await updateDoc(assignmentRef, {
                extensionStatus: 'declined',
                extensionDeclinedBy: declinedBy,
                extensionDeclinedAt: now,
                updatedAt: now
            });

            console.log('Extension request declined successfully:', requestId);
            return { success: true, data: { id: requestId, status: 'declined', reason } };
        } catch (error) {
            console.error('Error declining extension request:', error);
            throw new Error(`Failed to decline extension request: ${error.message}`);
        }
    }

    /**
     * Get pending extension requests for approval
     */
    async getPendingExtensionRequests(companyId, userRole, userId) {
        try {
            const requestsQuery = query(
                collection(db, this.collection),
                where('companyId', '==', companyId),
                where('status', '==', 'pending'),
                orderBy('requestedAt', 'asc')
            );

            const snapshot = await getDocs(requestsQuery);
            let requests = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            // Filter based on role permissions
            if (userRole === 'teamManager') {
                const managedEmployeeIds = await getManagedEmployeeIdsForManager(userId, companyId);
                requests = requests.filter(request => 
                    managedEmployeeIds.has(request.userId)
                );
            } else if (userRole === 'employee') {
                // Employees can't see pending requests for approval
                requests = [];
            }

            console.log(`Retrieved ${requests.length} pending extension requests`);
            return { success: true, data: requests };
        } catch (error) {
            console.error('Error fetching pending extension requests:', error);
            throw new Error(`Failed to fetch pending extension requests: ${error.message}`);
        }
    }
}

// Export singleton instance
export const extensionService = new ExtensionService();