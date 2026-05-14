/**
 * notifications.js — Phase 4 Migration (REST Only)
 *
 * Replaces Firestore real-time listener with REST + WS stub.
 * All exported function names preserved.
 */

import hrApiClient from '../lib/hrApiClient';

// ── Constants (backward compat — scheduleService, hrOnboarding, etc. import these) ─
export const NOTIFICATION_TYPES = {
  SYSTEM_ALERT:     'system_alert',
  ABSENCE_REQUEST:  'absence_request',
  ABSENCE_APPROVED: 'absence_approved',
  ABSENCE_REJECTED: 'absence_rejected',
  TIMESHEET_SUBMITTED: 'timesheet_submitted',
  TIMESHEET_APPROVED:  'timesheet_approved',
  TRAINING_ASSIGNED:   'training_assigned',
  ONBOARDING_STATUS:   'onboarding_status_change',
  SCHEDULE_ASSIGNED:   'schedule_assigned',
};

export const NOTIFICATION_PRIORITY = {
  LOW:    'low',
  MEDIUM: 'medium',
  HIGH:   'high',
};

// ── Create notification (used by scheduleService, hrOnboarding, etc.) ─────────
export async function createNotification({
  userId,
  type,
  title,
  message,
  priority = NOTIFICATION_PRIORITY.MEDIUM,
  data = {},
  relatedEntityId = null,
  relatedEntityType = null,
}) {
  try {
    await hrApiClient.post('/hr/notifications', {
      recipientId:       userId,
      type,
      title,
      message,
      priority,
      data,
      relatedEntityId,
      relatedEntityType,
    });
    return true;
  } catch {
    // Non-fatal — notification failure should not block the operation
    return false;
  }
}

import wsClient from '../lib/wsClient';

// ── Get My Notifications ─────────────────────────────────────────────────────
export async function getMyNotifications(userId, options = {}) {
  try {
    const { limit = 50, unreadOnly = false } = options;
    const { data } = await hrApiClient.get('/hr/notifications', {
      params: { limit, unreadOnly: unreadOnly || undefined },
    });
    return data.notifications || data || [];
  } catch (err) {
    if (err.response?.status === 404) return [];
    throw new Error(err.response?.data?.error || 'Failed to fetch notifications');
  }
}

// ── Mark Single Notification Read ────────────────────────────────────────────
export async function markNotificationRead(notificationId) {
  try {
    const { data } = await hrApiClient.post(`/hr/notifications/${notificationId}/read`);
    return data;
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw new Error(err.response?.data?.error || 'Failed to mark notification read');
  }
}

// ── Mark All Read ────────────────────────────────────────────────────────────
export async function markAllNotificationsRead(userId) {
  try {
    const { data } = await hrApiClient.post('/hr/notifications/read-all');
    return data;
  } catch (err) {
    throw new Error(err.response?.data?.error || 'Failed to mark all notifications read');
  }
}

// ── Get Unread Count ─────────────────────────────────────────────────────────
export async function getUnreadCount(userId) {
  try {
    const notifications = await getMyNotifications(userId, { unreadOnly: true });
    return Array.isArray(notifications) ? notifications.length : 0;
  } catch {
    return 0;
  }
}

// ── Subscribe (WS integration — Phase 6) ─────────────────────────────────────────
export function subscribeToNotifications(userId, callback) {
  // Initial fetch for baseline
  getMyNotifications(userId)
    .then(callback)
    .catch((err) => console.warn('[notifications] initial fetch failed:', err));

  const onFocus = () => {
    getMyNotifications(userId).then(callback).catch(() => {});
  };
  window.addEventListener('focus', onFocus);

  // WebSocket handler
  const wsHandler = () => {
    getMyNotifications(userId).then(callback).catch(() => {});
  };
  wsClient.on('notification:new', wsHandler);

  return () => {
    window.removeEventListener('focus', onFocus);
    wsClient.off('notification:new', wsHandler);
  };
}

// ── Onboarding notification helper (used by OnboardingManagementPage) ────────
export async function notifyOnboardingStatusChange(employeeId, status, message, companyId) {
  try {
    await hrApiClient.post('/hr/notifications', {
      recipientId: employeeId,
      type:        'onboarding_status_change',
      status,
      message:     message || `Your onboarding status has been updated to: ${status}`,
      companyId:   companyId || null,
    });
    return true;
  } catch {
    // Non-fatal — notification failure should not block the operation
    return false;
  }
}

// ── Default export object (original shape) ───────────────────────────────────
const notificationsService = {
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadCount,
  subscribeToNotifications,
};

export default notificationsService;
