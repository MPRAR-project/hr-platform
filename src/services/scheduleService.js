import { db } from '../firebase/client';
import {
    collection,
    doc,
    addDoc,
    updateDoc,
    deleteDoc,
    getDocs,
    query,
    where,
    serverTimestamp,
    getDoc,
    onSnapshot,
    setDoc
} from 'firebase/firestore';
import { createNotification, NOTIFICATION_TYPES, NOTIFICATION_PRIORITY } from './notifications';

const COLLECTION_NAME = 'schedules';

/**
 * Create a new schedule (shift)
 * @param {Object} scheduleData 
 * @param {string} managerId - ID of the manager creating the schedule
 */
export const createSchedule = async (scheduleData, managerId) => {
    console.log('[scheduleService] createSchedule called with:', { scheduleData, managerId });

    try {
        const { companyId, employeeId, siteId, locationId, start, end } = scheduleData;

        if (!companyId || !employeeId || !start || !end) {
            console.error('[scheduleService] Missing required fields:', { companyId, employeeId, start, end });
            throw new Error('Missing required schedule fields');
        }

        if (!managerId) {
            console.error('[scheduleService] Manager ID is missing');
            throw new Error('Manager ID is required to create a schedule');
        }

        const docData = {
            ...scheduleData,
            status: 'pending', // pending, accepted, declined
            createdBy: managerId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };

        console.log('[scheduleService] Adding document to Firestore...', docData);
        const docRef = await addDoc(collection(db, COLLECTION_NAME), docData);
        console.log('[scheduleService] Document created with ID:', docRef.id);

        // Notify Employee
        // First get site name and location name for the message
        let siteName = 'a site';
        let locationName = '';
        try {
            console.log('[scheduleService] Fetching site name for:', siteId);
            if (siteId) {
                const siteDoc = await getDoc(doc(db, 'sites', siteId));
                if (siteDoc.exists()) {
                    siteName = siteDoc.data().name;
                    console.log('[scheduleService] Site name retrieved:', siteName);
                } else {
                    console.warn('[scheduleService] Site document not found for ID:', siteId);
                }
            }

            // Fetch location name if locationId is provided
            if (locationId) {
                console.log('[scheduleService] Fetching location name for:', locationId);
                const locationDoc = await getDoc(doc(db, 'scheduling_locations', locationId));
                if (locationDoc.exists()) {
                    locationName = locationDoc.data().name;
                    console.log('[scheduleService] Location name retrieved:', locationName);
                }
            }
        } catch (e) {
            console.warn('[scheduleService] Could not fetch site/location name for notification', e);
        }

        const startDate = new Date(start).toLocaleDateString();
        const startTime = new Date(start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // Build notification message with location if available
        const locationInfo = locationName ? ` at ${locationName}` : '';
        const message = `You have been assigned a shift at ${siteName}${locationInfo} on ${startDate} at ${startTime}. Please accept or decline.`;

        console.log('[scheduleService] Creating notification for employee:', employeeId);
        await createNotification({
            userId: employeeId,
            type: NOTIFICATION_TYPES.SYSTEM_ALERT, // Using generically as 'shift_assigned' isn't in types yet
            title: 'New Shift Assigned',
            message: message,
            priority: NOTIFICATION_PRIORITY.HIGH,
            data: {
                scheduleId: docRef.id,
                siteId,
                locationId: locationId || null,
                start,
                end
            },
            relatedEntityId: docRef.id,
            relatedEntityType: 'schedule'
        });
        console.log('[scheduleService] Notification created successfully');

        const result = { id: docRef.id, ...docData };
        console.log('[scheduleService] createSchedule completed successfully:', result);
        return result;
    } catch (error) {
        console.error('[scheduleService] Error creating schedule:', error);
        console.error('[scheduleService] Error stack:', error.stack);
        throw error;
    }
};


/**
 * Get schedules for a company within a date range (optional)
 * For now, fetches all for simplicity, or filtered by week start/end if provided
 */
export const getSchedules = async (companyId, startRange = null, endRange = null) => {
    try {
        let q = query(
            collection(db, COLLECTION_NAME),
            where('companyId', '==', companyId)
        );

        // Date filtering in Firestore is tricky with range on 'start' field
        // For MVP/simple implementation, we might fetch company schedules and filter client side 
        // if the dataset isn't huge. Or use composite index.
        // Let's stick to companyId query for now.

        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                // Convert Timestamps to dates for frontend
                start: data.start?.toDate ? data.start.toDate() : new Date(data.start),
                end: data.end?.toDate ? data.end.toDate() : new Date(data.end)
            };
        });
    } catch (error) {
        console.error('Error fetching schedules:', error);
        throw error;
    }
};

/**
 * Real-time subscription to schedules
 */
export const subscribeToSchedules = (companyId, onUpdate) => {
    const q = query(
        collection(db, COLLECTION_NAME),
        where('companyId', '==', companyId)
    );

    return onSnapshot(q, (snapshot) => {
        const schedules = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                start: data.start?.toDate ? data.start.toDate() : new Date(data.start),
                end: data.end?.toDate ? data.end.toDate() : new Date(data.end)
            };
        });
        onUpdate(schedules);
    }, (error) => {
        console.error('Error in schedules subscription:', error);
    });
};

/**
 * Update schedule status (Accept/Decline) by Employee
 */
export const updateScheduleStatus = async (scheduleId, status, employeeComment, userId) => {
    try {
        const cleanId = String(scheduleId).trim();
        const docRef = doc(db, COLLECTION_NAME, cleanId);

        // Fetch current schedule to get manager ID and details
        const scheduleSnap = await getDoc(docRef);
        if (!scheduleSnap.exists()) {
            console.error(`[scheduleService] Schedule ${cleanId} NOT FOUND during update.`);
            throw new Error('Schedule not found');
        }
        const scheduleData = scheduleSnap.data();

        // Use setDoc with merge for robustness against "No document to update" flake
        await setDoc(docRef, {
            status,
            employeeComment,
            updatedBy: userId,
            updatedAt: serverTimestamp()
        }, { merge: true });

        // Notify Manager (Creator)
        if (scheduleData.createdBy) {
            // Get Employee Name
            let employeeName = 'Employee';
            try {
                const userDoc = await getDoc(doc(db, 'users', userId));
                if (userDoc.exists()) {
                    employeeName = userDoc.data().displayName || userDoc.data().email || 'Employee';
                }
            } catch (e) {
                console.warn('Could not fetch employee name', e);
            }

            const startDate = new Date(scheduleData.start).toLocaleDateString();
            const message = `${employeeName} has ${status} the shift on ${startDate}.${employeeComment ? ` Comment: "${employeeComment}"` : ''}`;

            await createNotification({
                userId: scheduleData.createdBy,
                type: NOTIFICATION_TYPES.SYSTEM_ALERT,
                title: `Shift ${status.charAt(0).toUpperCase() + status.slice(1)}`,
                message: message,
                priority: NOTIFICATION_PRIORITY.MEDIUM,
                data: {
                    scheduleId,
                    employeeId: userId,
                    status
                },
                relatedEntityId: scheduleId,
                relatedEntityType: 'schedule'
            });
        }
    } catch (error) {
        console.error('Error updating schedule status:', error);
        throw error;
    }
};

/**
 * Delete a schedule
 */
export const deleteSchedule = async (scheduleId) => {
    try {
        await deleteDoc(doc(db, COLLECTION_NAME, scheduleId));
    } catch (error) {
        console.error('Error deleting schedule:', error);
        throw error;
    }
};
