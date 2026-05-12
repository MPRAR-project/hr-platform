import apiClient from '../api/apiClient';

/**
 * Genuinely refactored Time Clock Service
 * Communicates with the Central Backend (Postgres) instead of Firebase Firestore.
 */

export async function startClock({ userId, companyId, siteId, ...data }) {
    const response = await apiClient.post('/hr/timeclock/start', {
        userId,
        companyId,
        siteId,
        ...data
    });
    return {
        sessionId: response.data.id,
        roundedStart: response.data.clockIn
    };
}

export async function stopClock({ userId, sessionId = null, ...data }) {
    const response = await apiClient.post('/hr/timeclock/stop', {
        userId,
        sessionId,
        ...data
    });
    return response.data;
}

export async function getActiveSession(userId) {
    const response = await apiClient.get(`/hr/timeclock/status/${userId}`);
    return response.data;
}

export async function startBreak({ userId, sessionId = null }) {
    // Break logic will be handled by the backend in a "Perfect" world
    const response = await apiClient.post('/hr/timeclock/break/start', { userId, sessionId });
    return response.data;
}

export async function endBreak({ userId, sessionId = null }) {
    const response = await apiClient.post('/hr/timeclock/break/end', { userId, sessionId });
    return response.data;
}