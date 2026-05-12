import apiClient from '../api/apiClient';

/**
 * Genuinely refactored Schedule Service
 * Communicates with the Central Backend (Postgres) instead of Firebase Firestore.
 */

export const createSchedule = async (scheduleData, managerId) => {
    const cleanCompanyId = scheduleData.companyId.replace('companies/', '');
    const response = await apiClient.post(`/hr/${cleanCompanyId}/schedules`, {
        ...scheduleData,
        managerId
    });
    return response.data;
};

export const getSchedules = async (companyId, startRange = null, endRange = null) => {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.get(`/hr/${cleanCompanyId}/schedules`, {
        params: { startRange, endRange }
    });
    return response.data;
};

export const updateScheduleStatus = async (scheduleId, status, employeeComment, userId) => {
    const response = await apiClient.put(`/hr/schedules/${scheduleId}/status`, {
        status,
        comment: employeeComment,
        userId
    });
    return response.data;
};

export const deleteSchedule = async (scheduleId) => {
    const response = await apiClient.delete(`/hr/schedules/${scheduleId}`);
    return response.data;
};

export const subscribeToSchedules = (companyId, onUpdate) => {
    // Polling fallback
    const interval = setInterval(async () => {
        try {
            const schedules = await getSchedules(companyId);
            onUpdate(schedules);
        } catch (e) {
            console.error('Polling schedules failed:', e);
        }
    }, 30000);

    return () => clearInterval(interval);
};
