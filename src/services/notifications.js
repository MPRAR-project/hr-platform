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
  limit,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';

/**
 * Notification Service - Production Level Implementation
 * Handles notifications for onboarding workflow and other system events
 */

// Collection names
const COLLECTIONS = {
  NOTIFICATIONS: 'notifications',
  USERS: 'users',
  ONBOARDING_APPLICATIONS: 'onboardingApplications'
};

// Notification types
export const NOTIFICATION_TYPES = {
  ONBOARDING_CREATED: 'onboarding_created',
  ONBOARDING_STEP_COMPLETED: 'onboarding_step_completed',
  ONBOARDING_COMPLETED: 'onboarding_completed',
  ONBOARDING_APPROVED: 'onboarding_approved',
  ONBOARDING_REJECTED: 'onboarding_rejected',
  ONBOARDING_ASSIGNED: 'onboarding_assigned',
  DOCUMENT_UPLOADED: 'document_uploaded',
  DOCUMENT_APPROVED: 'document_approved',
  DOCUMENT_REJECTED: 'document_rejected',
  DOCUMENT_REJECTED: 'document_rejected',
  SYSTEM_ALERT: 'system_alert',
  // New Types
  TIMESHEET_SUBMISSION: 'timesheet_submission',
  TIMESHEET_DECISION: 'timesheet_decision',
  LEAVE_REQUEST: 'leave_request',
  LEAVE_DECISION: 'leave_decision',
  ALLOWANCE_UPDATE: 'allowance_update'
};

// Notification priorities
export const NOTIFICATION_PRIORITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  URGENT: 'urgent'
};

// Notification status
export const NOTIFICATION_STATUS = {
  UNREAD: 'unread',
  READ: 'read',
  ARCHIVED: 'archived'
};

/**
 * Create a notification
 */
export async function createNotification({
  userId,
  type,
  title,
  message,
  priority = NOTIFICATION_PRIORITY.MEDIUM,
  data = {},
  relatedEntityId = null,
  relatedEntityType = null
}) {
  try {
    if (!userId || !type || !title || !message) {
      throw new Error('userId, type, title, and message are required');
    }

    const notificationRef = doc(collection(db, COLLECTIONS.NOTIFICATIONS));
    const now = serverTimestamp();

    const notificationData = {
      id: notificationRef.id,
      userId,
      type,
      title,
      message,
      priority,
      data,
      relatedEntityId,
      relatedEntityType,
      status: NOTIFICATION_STATUS.UNREAD,
      createdAt: now,
      updatedAt: now,
      readAt: null
    };

    await setDoc(notificationRef, notificationData);

    return {
      id: notificationRef.id,
      ...notificationData
    };
  } catch (error) {
    console.error('Error creating notification:', error);
    throw new Error(`Failed to create notification: ${error.message}`);
  }
}

/**
 * Get notifications for a user
 */
export async function getUserNotifications({
  userId,
  status = null,
  type = null,
  limitCount = 50,
  startAfter = null
}) {
  try {
    if (!userId) {
      throw new Error('userId is required');
    }

    let q = query(
      collection(db, COLLECTIONS.NOTIFICATIONS),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc')
    );

    // Add status filter
    if (status) {
      q = query(q, where('status', '==', status));
    }

    // Add type filter
    if (type) {
      q = query(q, where('type', '==', type));
    }

    // Add pagination
    if (startAfter) {
      q = query(q, startAfter);
    }

    q = query(q, limit(limitCount));

    const snap = await getDocs(q);
    const notifications = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return {
      notifications,
      hasMore: snap.docs.length === limitCount,
      lastDoc: snap.docs[snap.docs.length - 1]
    };
  } catch (error) {
    console.error('Error getting user notifications:', error);
    throw new Error(`Failed to get user notifications: ${error.message}`);
  }
}

/**
 * Mark notification as read
 */
export async function markNotificationAsRead(notificationId, userId) {
  try {
    if (!notificationId || !userId) {
      throw new Error('notificationId and userId are required');
    }

    const notificationRef = doc(db, COLLECTIONS.NOTIFICATIONS, notificationId);
    const notificationSnap = await getDoc(notificationRef);

    if (!notificationSnap.exists()) {
      throw new Error('Notification not found');
    }

    const notificationData = notificationSnap.data();

    // Verify user owns the notification
    if (notificationData.userId !== userId) {
      throw new Error('Unauthorized: You can only read your own notifications');
    }

    // Update notification status
    const updateData = {
      status: NOTIFICATION_STATUS.READ,
      readAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await updateDoc(notificationRef, updateData);

    return {
      id: notificationId,
      status: NOTIFICATION_STATUS.READ,
      readAt: updateData.readAt
    };
  } catch (error) {
    console.error('Error marking notification as read:', error);
    throw new Error(`Failed to mark notification as read: ${error.message}`);
  }
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllNotificationsAsRead(userId) {
  try {
    if (!userId) {
      throw new Error('userId is required');
    }

    const q = query(
      collection(db, COLLECTIONS.NOTIFICATIONS),
      where('userId', '==', userId),
      where('status', '==', NOTIFICATION_STATUS.UNREAD)
    );

    const snap = await getDocs(q);

    if (snap.empty) {
      return { updatedCount: 0 };
    }

    // Use batch update for better performance
    const batch = writeBatch(db);
    const now = serverTimestamp();

    snap.docs.forEach(doc => {
      batch.update(doc.ref, {
        status: NOTIFICATION_STATUS.READ,
        readAt: now,
        updatedAt: now
      });
    });

    await batch.commit();

    return { updatedCount: snap.docs.length };
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    throw new Error(`Failed to mark all notifications as read: ${error.message}`);
  }
}

/**
 * Archive notification
 */
export async function archiveNotification(notificationId, userId) {
  try {
    if (!notificationId || !userId) {
      throw new Error('notificationId and userId are required');
    }

    const notificationRef = doc(db, COLLECTIONS.NOTIFICATIONS, notificationId);
    const notificationSnap = await getDoc(notificationRef);

    if (!notificationSnap.exists()) {
      throw new Error('Notification not found');
    }

    const notificationData = notificationSnap.data();

    // Verify user owns the notification
    if (notificationData.userId !== userId) {
      throw new Error('Unauthorized: You can only archive your own notifications');
    }

    // Update notification status
    const updateData = {
      status: NOTIFICATION_STATUS.ARCHIVED,
      updatedAt: serverTimestamp()
    };

    await updateDoc(notificationRef, updateData);

    return {
      id: notificationId,
      status: NOTIFICATION_STATUS.ARCHIVED
    };
  } catch (error) {
    console.error('Error archiving notification:', error);
    throw new Error(`Failed to archive notification: ${error.message}`);
  }
}

/**
 * Get notification statistics for a user
 */
export async function getNotificationStatistics(userId) {
  try {
    if (!userId) {
      throw new Error('userId is required');
    }

    const q = query(
      collection(db, COLLECTIONS.NOTIFICATIONS),
      where('userId', '==', userId)
    );

    const snap = await getDocs(q);
    const notifications = snap.docs.map(doc => doc.data());

    const stats = {
      total: notifications.length,
      unread: notifications.filter(n => n.status === NOTIFICATION_STATUS.UNREAD).length,
      read: notifications.filter(n => n.status === NOTIFICATION_STATUS.READ).length,
      archived: notifications.filter(n => n.status === NOTIFICATION_STATUS.ARCHIVED).length,
      byType: {},
      byPriority: {}
    };

    notifications.forEach(notification => {
      // Count by type
      stats.byType[notification.type] = (stats.byType[notification.type] || 0) + 1;

      // Count by priority
      stats.byPriority[notification.priority] = (stats.byPriority[notification.priority] || 0) + 1;
    });

    return stats;
  } catch (error) {
    console.error('Error getting notification statistics:', error);
    throw new Error(`Failed to get notification statistics: ${error.message}`);
  }
}

/**
 * Onboarding-specific notification functions
 */

/**
 * Notify managers about new onboarding application
 */
export async function notifyOnboardingCreated(onboardingApplicationId, employeeName, companyId) {
  try {
    if (!onboardingApplicationId || !employeeName || !companyId) {
      throw new Error('onboardingApplicationId, employeeName, and companyId are required');
    }

    // Get all managers in the company
    const managersQuery = query(
      collection(db, COLLECTIONS.USERS),
      where('companyId', '==', companyId),
      where('primaryRole', 'in', ['siteManager', 'hrManager', 'adminManager'])
    );

    const managersSnap = await getDocs(managersQuery);

    if (managersSnap.empty) {
      return { notifiedCount: 0 };
    }

    // Create notifications for all managers
    const batch = writeBatch(db);
    const now = serverTimestamp();

    managersSnap.docs.forEach(doc => {
      const manager = doc.data();
      const notificationRef = doc(collection(db, COLLECTIONS.NOTIFICATIONS));

      batch.set(notificationRef, {
        id: notificationRef.id,
        userId: doc.id,
        type: NOTIFICATION_TYPES.ONBOARDING_CREATED,
        title: 'New Onboarding Application',
        message: `${employeeName} has submitted a new onboarding application and is waiting for review.`,
        priority: NOTIFICATION_PRIORITY.HIGH,
        data: {
          onboardingApplicationId,
          employeeName,
          companyId
        },
        relatedEntityId: onboardingApplicationId,
        relatedEntityType: 'onboarding_application',
        status: NOTIFICATION_STATUS.UNREAD,
        createdAt: now,
        updatedAt: now,
        readAt: null
      });
    });

    await batch.commit();

    return { notifiedCount: managersSnap.docs.length };
  } catch (error) {
    console.error('Error notifying onboarding created:', error);
    throw new Error(`Failed to notify onboarding created: ${error.message}`);
  }
}

/**
 * Notify employee about onboarding status change
 */
export async function notifyOnboardingStatusChange(onboardingApplicationId, status, employeeUserId, managerName) {
  try {
    if (!onboardingApplicationId || !status || !employeeUserId) {
      throw new Error('onboardingApplicationId, status, and employeeUserId are required');
    }

    let title, message, priority;

    switch (status) {
      case 'completed':
        title = 'Onboarding Approved';
        message = `Your onboarding application has been approved by ${managerName || 'your manager'}. Welcome to the team!`;
        priority = NOTIFICATION_PRIORITY.HIGH;
        break;
      case 'rejected':
        title = 'Onboarding Requires Attention';
        message = `Your onboarding application has been reviewed by ${managerName || 'your manager'}. Please check for any required updates.`;
        priority = NOTIFICATION_PRIORITY.HIGH;
        break;
      case 'in_progress':
        title = 'Onboarding In Progress';
        message = `Your onboarding application is being reviewed by ${managerName || 'your manager'}.`;
        priority = NOTIFICATION_PRIORITY.MEDIUM;
        break;
      default:
        title = 'Onboarding Status Update';
        message = `Your onboarding application status has been updated.`;
        priority = NOTIFICATION_PRIORITY.MEDIUM;
    }

    await createNotification({
      userId: employeeUserId,
      type: NOTIFICATION_TYPES.ONBOARDING_APPROVED,
      title,
      message,
      priority,
      data: {
        onboardingApplicationId,
        status,
        managerName
      },
      relatedEntityId: onboardingApplicationId,
      relatedEntityType: 'onboarding_application'
    });

    return { success: true };
  } catch (error) {
    console.error('Error notifying onboarding status change:', error);
    throw new Error(`Failed to notify onboarding status change: ${error.message}`);
  }
}

/**
 * Notify manager about onboarding step completion
 */
export async function notifyOnboardingStepCompleted(onboardingApplicationId, stepNumber, employeeName, managerUserId) {
  try {
    if (!onboardingApplicationId || !stepNumber || !employeeName || !managerUserId) {
      throw new Error('onboardingApplicationId, stepNumber, employeeName, and managerUserId are required');
    }

    const stepNames = {
      1: 'Personal Information',
      2: 'Identification & Compliance',
      3: 'Banking & Payroll',
      4: 'HR Information',
      5: 'Policies & Agreements',
      6: 'Optional Information'
    };

    const stepName = stepNames[stepNumber] || `Step ${stepNumber}`;

    await createNotification({
      userId: managerUserId,
      type: NOTIFICATION_TYPES.ONBOARDING_STEP_COMPLETED,
      title: 'Onboarding Step Completed',
      message: `${employeeName} has completed the ${stepName} step in their onboarding process.`,
      priority: NOTIFICATION_PRIORITY.MEDIUM,
      data: {
        onboardingApplicationId,
        stepNumber,
        stepName,
        employeeName
      },
      relatedEntityId: onboardingApplicationId,
      relatedEntityType: 'onboarding_application'
    });

    return { success: true };
  } catch (error) {
    console.error('Error notifying onboarding step completed:', error);
    throw new Error(`Failed to notify onboarding step completed: ${error.message}`);
  }
}

/**
 * Notify about document upload
 */
export async function notifyDocumentUploaded(documentId, employeeName, managerUserId, documentType) {
  try {
    if (!documentId || !employeeName || !managerUserId || !documentType) {
      throw new Error('documentId, employeeName, managerUserId, and documentType are required');
    }

    await createNotification({
      userId: managerUserId,
      type: NOTIFICATION_TYPES.DOCUMENT_UPLOADED,
      title: 'New Document Uploaded',
      message: `${employeeName} has uploaded a new ${documentType} document for review.`,
      priority: NOTIFICATION_PRIORITY.MEDIUM,
      data: {
        documentId,
        employeeName,
        documentType
      },
      relatedEntityId: documentId,
      relatedEntityType: 'document'
    });

    return { success: true };
  } catch (error) {
    console.error('Error notifying document uploaded:', error);
    throw new Error(`Failed to notify document uploaded: ${error.message}`);
  }
}

/**
 * Clean up old notifications (for maintenance)
 */
export async function cleanupOldNotifications(daysOld = 30) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const q = query(
      collection(db, COLLECTIONS.NOTIFICATIONS),
      where('status', '==', NOTIFICATION_STATUS.ARCHIVED),
      where('createdAt', '<', cutoffDate)
    );

    const snap = await getDocs(q);

    if (snap.empty) {
      return { deletedCount: 0 };
    }

    // Use batch delete for better performance
    const batch = writeBatch(db);

    snap.docs.forEach(doc => {
      batch.delete(doc.ref);
    });

    await batch.commit();

    return { deletedCount: snap.docs.length };
  } catch (error) {
    console.error('Error cleaning up old notifications:', error);
    throw new Error(`Failed to cleanup old notifications: ${error.message}`);
  }
}
