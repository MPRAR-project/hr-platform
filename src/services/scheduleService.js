import hrApiClient from '../lib/hrApiClient';

/**
 * Genuinely refactored Schedule Service
 * Communicates with the Central Backend (Postgres) instead of Firebase Firestore.
 */

export const createSchedule = async (scheduleData, managerId) => {
    const response = await hrApiClient.post('/hr/schedules', {
        ...scheduleData,
        managerId
    });
    return response.data;
};

export const getSchedules = async (filters = {}) => {
    const response = await hrApiClient.get('/hr/schedules', {
        params: filters
    });
    return response.data;
};

export const getUserSchedules = async (employeeId, startRange = null, endRange = null) => {
    const response = await hrApiClient.get('/hr/schedules', {
        params: { employeeId, startRange, endRange }
    });
    return response.data;
};

export const updateScheduleStatus = async (scheduleId, status, employeeComment = '') => {
    const response = await hrApiClient.put(`/hr/schedules/${scheduleId}/status`, {
        status,
        notes: employeeComment
    });
    return response.data;
};

export const deleteSchedule = async (scheduleId) => {
    const response = await hrApiClient.delete(`/hr/schedules/${scheduleId}`);
    return response.data;
};

export const subscribeToSchedules = (companyId, onUpdate, filters = {}) => {
    const fetchAndNotify = async () => {
        try {
            const schedules = await getSchedules({ companyId, ...filters });
            onUpdate(schedules);
        } catch (e) {
            console.error('Polling schedules failed:', e);
        }
    };

    fetchAndNotify(); // fetch immediately on subscribe
    const interval = setInterval(fetchAndNotify, 30000);
    return () => clearInterval(interval);
};
