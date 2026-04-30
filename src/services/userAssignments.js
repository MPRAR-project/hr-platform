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

const COLLECTION = 'userAssignments';

/**
 * Create a new user-client assignment
 * @param {Object} assignmentData - Assignment details
 * @returns {Promise<Object>} Created assignment with ID
 */
export async function createAssignment(assignmentData) {
    try {
        const { userId, clientId, siteId, companyId, startDate, chargeRate, overtimeChargeRate } = assignmentData;

        // Validate required fields
        if (!userId || !clientId || !siteId || !companyId) {
            throw new Error('Missing required fields: userId, clientId, siteId, companyId');
        }

        // Check for overlapping active assignments for the same user and CLIENT
        // (User can have multiple sites, but only one active assignment per client)
        const assignmentsRef = collection(db, COLLECTION);
        const q = query(
            assignmentsRef,
            where('userId', '==', userId),
            where('clientId', '==', clientId),
            where('status', '==', 'active')
        );

        const snapshot = await getDocs(q);
        if (snapshot.docs.length > 0) {
            console.log(`User ${userId} already has an active assignment for client ${clientId}`);
            return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
        }

        const assignmentRef = doc(collection(db, COLLECTION));
        const payload = {
            userId,
            clientId,
            siteId,
            companyId,
            startDate: startDate || serverTimestamp(),
            endDate: null, // null means active/ongoing
            chargeRate: chargeRate || 0,
            overtimeChargeRate: overtimeChargeRate || 0,
            status: 'active',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };

        await setDoc(assignmentRef, payload);

        console.log('Assignment created:', assignmentRef.id);
        return { id: assignmentRef.id, ...payload };
    } catch (error) {
        console.error('Error creating assignment:', error);
        throw new Error(`Failed to create assignment: ${error.message}`);
    }
}

/**
 * Get active assignment for a user on a specific date
 * @param {string} userId - User ID
 * @param {Date|Timestamp} date - Date to check
 * @returns {Promise<Object|null>} Active assignment or null
 */
export async function getActiveAssignment(userId, date = new Date()) {
    try {
        const assignmentsRef = collection(db, COLLECTION);
        const q = query(
            assignmentsRef,
            where('userId', '==', userId),
            where('status', '==', 'active')
        );

        const snapshot = await getDocs(q);

        // Filter assignments that are active on the given date
        const targetDate = date instanceof Date ? Timestamp.fromDate(date) : date;

        for (const docSnap of snapshot.docs) {
            const assignment = { id: docSnap.id, ...docSnap.data() };
            const startDate = assignment.startDate?.toDate ? assignment.startDate.toDate() : new Date(assignment.startDate);
            const endDate = assignment.endDate?.toDate ? assignment.endDate.toDate() : null;

            // Check if date falls within assignment period
            if (startDate <= targetDate) {
                if (!endDate || endDate >= targetDate) {
                    return assignment;
                }
            }
        }

        return null;
    } catch (error) {
        console.error('Error getting active assignment:', error);
        throw error;
    }
}

/**
 * Get all active assignments for a user (optionally filtered by site)
 * @param {string} userId - User ID
 * @param {string} siteId - Optional site ID filter
 * @returns {Promise<Array>} Array of active assignments
 */
export async function getActiveAssignments(userId, siteId = null) {
    try {
        const assignmentsRef = collection(db, COLLECTION);
        let q = query(
            assignmentsRef,
            where('userId', '==', userId),
            where('status', '==', 'active')
        );

        if (siteId) {
            q = query(q, where('siteId', '==', siteId));
        }

        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        console.error('Error getting active assignments:', error);
        throw error;
    }
}

/**
 * Get all assignments for a user
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Array of all assignments
 */
export async function getUserAssignments(userId) {
    try {
        const assignmentsRef = collection(db, COLLECTION);
        const q = query(
            assignmentsRef,
            where('userId', '==', userId),
            orderBy('startDate', 'desc')
        );

        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        console.error('Error getting user assignments:', error);
        throw error;
    }
}

/**
 * Get all assignments for a client
 * @param {string} clientId - Client ID
 * @param {string} status - Optional status filter ('active', 'ended')
 * @returns {Promise<Array>} Array of assignments
 */
export async function getClientAssignments(clientId, status = null) {
    try {
        const assignmentsRef = collection(db, COLLECTION);
        let q = query(assignmentsRef, where('clientId', '==', clientId));

        if (status) {
            q = query(q, where('status', '==', status));
        }

        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        console.error('Error getting client assignments:', error);
        throw error;
    }
}

/**
 * Get all assignments for a site
 * @param {string} siteId - Site ID
 * @param {string} status - Optional status filter
 * @returns {Promise<Array>} Array of assignments
 */
export async function getSiteAssignments(siteId, status = null) {
    try {
        const assignmentsRef = collection(db, COLLECTION);
        let q = query(assignmentsRef, where('siteId', '==', siteId));

        if (status) {
            q = query(q, where('status', '==', status));
        }

        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        console.error('Error getting site assignments:', error);
        throw error;
    }
}

/**
 * End an assignment
 * @param {string} assignmentId - Assignment ID
 * @param {Date|Timestamp} endDate - End date (defaults to now)
 * @returns {Promise<Object>} Updated assignment
 */
export async function endAssignment(assignmentId, endDate = new Date()) {
    try {
        const assignmentRef = doc(db, COLLECTION, assignmentId);
        const assignmentSnap = await getDoc(assignmentRef);

        if (!assignmentSnap.exists()) {
            throw new Error('Assignment not found');
        }

        const updates = {
            endDate: endDate instanceof Date ? Timestamp.fromDate(endDate) : endDate,
            status: 'ended',
            updatedAt: serverTimestamp()
        };

        await updateDoc(assignmentRef, updates);

        console.log('Assignment ended:', assignmentId);
        return { id: assignmentId, ...assignmentSnap.data(), ...updates };
    } catch (error) {
        console.error('Error ending assignment:', error);
        throw new Error(`Failed to end assignment: ${error.message}`);
    }
}

/**
 * Update assignment rates
 * @param {string} assignmentId - Assignment ID
 * @param {Object} rates - Rate updates
 * @returns {Promise<Object>} Updated assignment
 */
export async function updateAssignmentRates(assignmentId, rates) {
    try {
        const { chargeRate, overtimeChargeRate } = rates;

        if (chargeRate === undefined && overtimeChargeRate === undefined) {
            throw new Error('At least one rate must be provided');
        }

        const assignmentRef = doc(db, COLLECTION, assignmentId);
        const updates = {
            updatedAt: serverTimestamp()
        };

        if (chargeRate !== undefined) updates.chargeRate = chargeRate;
        if (overtimeChargeRate !== undefined) updates.overtimeChargeRate = overtimeChargeRate;

        await updateDoc(assignmentRef, updates);

        console.log('Assignment rates updated:', assignmentId);
        return { id: assignmentId, ...updates };
    } catch (error) {
        console.error('Error updating assignment rates:', error);
        throw new Error(`Failed to update assignment rates: ${error.message}`);
    }
}

/**
 * Get assignment by ID
 * @param {string} assignmentId - Assignment ID
 * @returns {Promise<Object|null>} Assignment data or null
 */
export async function getAssignmentById(assignmentId) {
    try {
        const assignmentRef = doc(db, COLLECTION, assignmentId);
        const assignmentSnap = await getDoc(assignmentRef);

        if (!assignmentSnap.exists()) {
            return null;
        }

        return { id: assignmentId, ...assignmentSnap.data() };
    } catch (error) {
        console.error('Error getting assignment:', error);
        throw error;
    }
}

/**
 * Get assignments for invoice calculation
 * @param {string} clientId - Client ID
 * @param {string} siteId - Optional site ID filter
 * @param {Date} startDate - Start date for period
 * @param {Date} endDate - End date for period
 * @returns {Promise<Array>} Array of assignments active during period
 */
export async function getAssignmentsForInvoice(clientId, siteId, startDate, endDate) {
    try {
        const assignmentsRef = collection(db, COLLECTION);
        let q = query(assignmentsRef, where('clientId', '==', clientId));

        if (siteId) {
            q = query(q, where('siteId', '==', siteId));
        }

        const snapshot = await getDocs(q);
        const assignments = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Filter assignments that were active during the period
        const start = Timestamp.fromDate(startDate);
        const end = Timestamp.fromDate(endDate);

        return assignments.filter(assignment => {
            const assignStart = assignment.startDate;
            const assignEnd = assignment.endDate || Timestamp.now(); // If still active, use current time

            // Check if assignment period overlaps with invoice period
            return assignStart <= end && assignEnd >= start;
        });
    } catch (error) {
        console.error('Error getting assignments for invoice:', error);
        throw error;
    }
}
