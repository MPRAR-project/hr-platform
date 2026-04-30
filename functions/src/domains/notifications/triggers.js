const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
// const db = admin.firestore(); // REMOVED GLOBAL INIT

// Notification Types
const NOTIFICATION_TYPES = {
    TIMESHEET_SUBMISSION: 'timesheet_submission',
    TIMESHEET_DECISION: 'timesheet_decision',
    LEAVE_REQUEST: 'leave_request',
    LEAVE_DECISION: 'leave_decision',
    ALLOWANCE_UPDATE: 'allowance_update'
};

/**
 * Helper to create a notification
 */
async function createNotification(userId, type, title, message, data, priority = 'medium') {
    try {
        const db = admin.firestore(); // Lazy load
        const notification = {
            userId,
            type,
            title,
            message,
            data,
            priority,
            status: 'unread',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        await db.collection('notifications').add(notification);
        console.log(`Notification created for user ${userId}: ${type}`);
    } catch (error) {
        console.error(`Error creating notification for user ${userId}:`, error);
    }
}

// Helper: Get Managers for User (Optimized)
async function getManagersForUser(companyId, siteId, userId, userData = null) {
    const managers = new Set();
    const db = admin.firestore(); // Lazy load

    try {
        const promises = [];

        // 1. Get Site Manager(s)
        if (siteId) {
            promises.push(
                db.collection('users')
                    .where('companyId', '==', companyId)
                    .where('siteId', '==', siteId)
                    .where('primaryRole', '==', 'siteManager')
                    .where('status', '==', 'active')
                    .get()
                    .then(snap => snap.forEach(doc => managers.add(doc.id)))
            );
        }

        // 2. Get Assigned Manager
        if (userId) {
            // Direct assignments
            promises.push(
                db.collection('assignments')
                    .where('employeeId', '==', userId)
                    .where('status', '==', 'active')
                    .get()
                    .then(snap => {
                        snap.forEach(doc => {
                            const data = doc.data();
                            const mgrId = data.managerUserId || data.managerId;
                            if (mgrId) {
                                const cleanId = mgrId.toString().split('/').pop();
                                if (cleanId) managers.add(cleanId);
                            }
                        });
                    })
            );

            // Reports To (User Profile)
            if (userData && userData.reportsTo) {
                const cleanId = userData.reportsTo.toString().split('/').pop();
                if (cleanId) managers.add(cleanId);
            } else if (userId) {
                promises.push(
                    db.collection('users').doc(userId).get()
                        .then(doc => {
                            if (doc.exists) {
                                const u = doc.data();
                                if (u.reportsTo) {
                                    const cleanId = u.reportsTo.toString().split('/').pop();
                                    if (cleanId) managers.add(cleanId);
                                }
                            }
                        })
                );
            }
        }

        // 3. Get HR and Admin (Optimized: Single Query for multiple roles)
        // note: 'in' query supports up to 10 values
        promises.push(
            db.collection('users')
                .where('companyId', '==', companyId)
                .where('primaryRole', 'in', ['hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor'])
                .where('status', '==', 'active')
                .get()
                .then(snap => snap.forEach(doc => managers.add(doc.id)))
        );

        await Promise.all(promises);

    } catch (error) {
        console.error('Error fetching managers:', error);
    }

    return Array.from(managers);
}

// ==================== TIMESHEET TRIGGERS ====================

/**
 * Trigger: On Timesheet Written (Create or Update)
 * Handle Submission and Decision
 */
exports.onTimesheetWrite = functions.firestore
    .document('timesheets/{timesheetId}')
    .onWrite(async (change, context) => {
        const newData = change.after.exists ? change.after.data() : null;
        const oldData = change.before.exists ? change.before.data() : null;
        const timesheetId = context.params.timesheetId;

        if (!newData) return null; // Deleted

        const statusChanged = oldData && newData.status !== oldData.status;
        const isNewSubmission = newData.status === 'pending' && (!oldData || oldData.status === 'draft');

        const db = admin.firestore();

        // 1. Handle Submission (Employee -> Managers)
        if (isNewSubmission) {
            let { userId, companyId, siteId, weekStartDate } = newData;

            // Robustness: Fallback to ID parsing if userId/weekStartDate missing
            // ID Format: "userId_2023-01-01"
            if (!userId || !weekStartDate) {
                const parts = timesheetId.split('_');
                if (parts.length >= 2) {
                    // Assume last part is date (YYYY-MM-DD)
                    if (!weekStartDate) weekStartDate = parts[parts.length - 1];
                    // Assume rest is userId (handle cases where userId might have underscores?)
                    // Usually userId is the first part if length is 2.
                    if (!userId) userId = parts.slice(0, parts.length - 1).join('_');
                    console.log(`[onTimesheetWrite] Parsed missing data from ID: ${userId}, ${weekStartDate}`);
                }
            }

            // Get Employee Data
            const userDoc = await db.collection('users').doc(userId).get();
            const userData = userDoc.exists ? userDoc.data() : {};
            const employeeName = userData.displayName || 'Employee';

            // Robustness: If timesheet missing company/site, fallback to User Profile
            // (Common issue: timesheets created via clock-in don't always store siteId)
            if (!companyId || !siteId) {
                console.log(`[onTimesheetWrite] Missing context in timesheet. Fetching from user ${userId}.`);
                if (!companyId && userData.companyId) companyId = userData.companyId;
                if (!siteId && userData.siteId) {
                    // Handle if siteId is stored as Reference path in user doc
                    siteId = (typeof userData.siteId === 'object' && userData.siteId.path)
                        ? userData.siteId.path
                        : userData.siteId;
                }
            }

            const managers = await getManagersForUser(companyId, siteId, userId, userData);

            const title = 'Timesheet Submitted';
            const message = `${employeeName} has submitted their timesheet for week of ${weekStartDate}.`;

            const notificationPromises = managers.map(managerId =>
                createNotification(
                    managerId,
                    NOTIFICATION_TYPES.TIMESHEET_SUBMISSION,
                    title,
                    message,
                    { timesheetId, employeeId: userId, weekStartDate },
                    'high'
                )
            );

            await Promise.all(notificationPromises);
        }

        // 2. Handle Decision (Manager -> Employee)
        if (statusChanged && (newData.status === 'approved' || newData.status === 'rejected')) {
            const { userId, weekStartDate, approvedBy, rejectedBy } = newData;
            const actorId = approvedBy || rejectedBy;

            let actorName = 'Manager';
            if (actorId) {
                const actorDoc = await db.collection('users').doc(actorId).get();
                if (actorDoc.exists) actorName = actorDoc.data().displayName || 'Manager';
            }

            const isApproved = newData.status === 'approved';
            const title = `Timesheet ${isApproved ? 'Approved' : 'Rejected'}`;
            const message = `Your timesheet for ${weekStartDate} has been ${isApproved ? 'approved' : 'rejected'} by ${actorName}.`;

            await createNotification(
                userId,
                NOTIFICATION_TYPES.TIMESHEET_DECISION,
                title,
                message,
                { timesheetId, status: newData.status, actorId },
                isApproved ? 'medium' : 'high'
            );
        }
    });

// ==================== ABSENCE (LEAVE) TRIGGERS ====================

/**
 * Reusable helper: Convert snake_case leaveType to human-readable format.
 * Handles known types via a lookup map, and falls back to generic
 * snake_case → Title Case conversion for any unknown types.
 *
 * Examples:
 *   'personal_leave'            → 'Personal Leave'
 *   'sick_leave'                → 'Sick Leave'
 *   'authorised_absence_unpaid' → 'Authorised Absence (Unpaid)'
 *   'some_future_type'          → 'Some Future Type'
 *   'Personal Leave'            → 'Personal Leave' (already formatted)
 */
function getLeaveTypeDisplayName(leaveType) {
    if (!leaveType) return 'Unknown';

    // Known leave types (snake_case key → display name)
    const displayNames = {
        'sick_leave': 'Sick Leave',
        'annual_leave': 'Annual Leave',
        'maternity_leave': 'Maternity Leave',
        'paternity_leave': 'Paternity Leave',
        'personal_leave': 'Personal Leave',
        'authorised_absence_unpaid': 'Authorised Absence (Unpaid)',
        'authorised_absence_paid': 'Authorised Absence (Paid)',
        'bereavement_leave': 'Bereavement Leave',
        'holiday': 'Annual Leave'
    };

    // Check the map first
    if (displayNames[leaveType]) {
        return displayNames[leaveType];
    }

    // If it already contains spaces (e.g. "Personal Leave"), return as-is
    if (leaveType.includes(' ')) {
        return leaveType;
    }

    // Generic fallback: convert snake_case to Title Case
    return leaveType
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

exports.onAbsenceCreate = functions.firestore
    .document('absences/{absenceId}')
    .onCreate(async (snap, context) => {
        const data = snap.data();
        const { userId, leaveType, startDate, endDate, companyId, siteId } = data;

        const db = admin.firestore();
        // Get Employee Name
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : {};
        const employeeName = userData.displayName || 'Employee';

        const managers = await getManagersForUser(companyId, siteId, userId, userData);

        const title = 'New Leave Request';
        const displayLeaveType = getLeaveTypeDisplayName(leaveType);
        const message = `${employeeName} requested ${displayLeaveType} from ${startDate} to ${endDate}.`;

        const notificationPromises = managers.map(managerId =>
            createNotification(
                managerId,
                NOTIFICATION_TYPES.LEAVE_REQUEST,
                title,
                message,
                { absenceId: context.params.absenceId, employeeId: userId, leaveType },
                'high'
            )
        );

        await Promise.all(notificationPromises);
    });

/**
 * Trigger: On Absence Update (Status Change) -> Notify Employee
 */
exports.onAbsenceUpdate = functions.firestore
    .document('absences/{absenceId}')
    .onUpdate(async (change, context) => {
        const db = admin.firestore();
        const newData = change.after.data();
        const oldData = change.before.data();

        if (newData.status === oldData.status) return null;

        if (newData.status === 'Approved' || newData.status === 'Rejected') {
            const { userId, leaveType, startDate, endDate, approvedBy, rejectedBy } = newData;
            const actorId = approvedBy || rejectedBy;

            let actorName = 'Manager';
            if (actorId) {
                const actorDoc = await db.collection('users').doc(actorId).get();
                if (actorDoc.exists) actorName = actorDoc.data().displayName || 'Manager';
            }

            const displayLeaveType = getLeaveTypeDisplayName(leaveType);
            const isApproved = newData.status === 'Approved';
            const title = `Leave Request ${isApproved ? 'Approved' : 'Rejected'}`;
            const message = `Your ${displayLeaveType} request (${startDate} - ${endDate}) has been ${isApproved ? 'approved' : 'rejected'} by ${actorName}.`;

            await createNotification(
                userId,
                NOTIFICATION_TYPES.LEAVE_DECISION,
                title,
                message,
                { absenceId: context.params.absenceId, status: newData.status },
                isApproved ? 'medium' : 'high'
            );
        }
    });
// ==================== ALLOWANCE TRIGGERS ====================

/**
 * Trigger: On Allowance Update/Create -> Notify Employee if updated by someone else
 */
exports.onAllowanceWrite = functions.firestore
    .document('allowances/{allowanceId}')
    .onWrite(async (change, context) => {
        const newData = change.after.exists ? change.after.data() : null;
        const oldData = change.before.exists ? change.before.data() : null;

        if (!newData) return null; // Deleted

        // Detect if this was a manual update/creation, not just usage update
        // Usage updates happen frequently, we only want to notify on "Granting" allowance

        // If totalDays changed, or it's a new allowance
        const totalDaysChanged = !oldData || (newData.totalDays !== oldData.totalDays);

        if (totalDaysChanged) {
            const { employeeId, leaveType, totalDays, createdBy } = newData;

            // Don't notify if user updated their own (unlikely for allowance, but good check)
            if (createdBy === employeeId) return null;

            const title = 'Allowance Updated';
            const message = `Your ${leaveType} allowance has been updated to ${totalDays} days.`;

            await createNotification(
                employeeId,
                NOTIFICATION_TYPES.ALLOWANCE_UPDATE,
                title,
                message,
                { allowanceId: context.params.allowanceId, leaveType, totalDays },
                'medium'
            );
        }
    });
