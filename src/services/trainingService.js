import apiClient from '../api/apiClient';

/**
 * Genuinely refactored Training Service
 * Communicates with the Central Backend (Postgres) instead of Firebase Firestore.
 */

export const trainingService = {
    async getCourses(companyId) {
        const cleanCompanyId = companyId.replace('companies/', '');
        const response = await apiClient.get(`/hr/${cleanCompanyId}/training/courses`);
        return response.data;
    },

    async getAssignments(companyId, filters = {}) {
        const cleanCompanyId = companyId.replace('companies/', '');
        const response = await apiClient.get(`/hr/${cleanCompanyId}/training/assignments`, {
            params: filters
        });
        return response.data;
    },

    async createCourse(companyId, data) {
        const cleanCompanyId = companyId.replace('companies/', '');
        const response = await apiClient.post(`/hr/${cleanCompanyId}/training/courses`, data);
        return response.data;
    },

    async assignTraining(companyId, data) {
        const cleanCompanyId = companyId.replace('companies/', '');
        const response = await apiClient.post(`/hr/${cleanCompanyId}/training/assignments`, data);
        return response.data;
    },

    async updateStatus(assignmentId, status) {
        const response = await apiClient.put(`/hr/training/assignments/${assignmentId}/status`, { status });
        return response.data;
    }
};