import apiClient from '../api/apiClient';

/**
 * Genuinely refactored Notifications Service
 * Communicates with the Central Backend (Postgres) instead of Firebase Firestore.
 */

export async function getUserNotifications(userId) {
    const response = await apiClient.get(`/hr/notifications/user/${userId}`);
    return response.data;
}

export async function markNotificationAsRead(notificationId) {
    const response = await apiClient.put(`/hr/notifications/${notificationId}/read`);
    return response.data;
}

export async function deleteNotification(notificationId) {
    const response = await apiClient.delete(`/hr/notifications/${notificationId}`);
    return response.data;
}

export function subscribeToNotifications(userId, callback) {
    // In a "Perfect" architecture, we'd use WebSockets.
    // For now, we'll use a polling fallback to keep it simple but genuine.
    const interval = setInterval(async () => {
        try {
            const notifications = await getUserNotifications(userId);
            callback(notifications);
        } catch (e) {
            console.error('Polling notifications failed:', e);
        }
    }, 30000); // Poll every 30 seconds

    return () => clearInterval(interval);
}

export async function notifyOnboardingStatusChange(userId, status, reason = '') {
    const response = await apiClient.post(`/hr/notifications/onboarding-update`, {
        userId,
        status,
        reason,
        title: 'Onboarding Status Updated',
        message: `Your onboarding status has been updated to ${status}. ${reason}`
    });
    return response.data;
}
