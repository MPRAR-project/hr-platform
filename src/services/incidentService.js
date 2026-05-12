import apiClient from '../api/apiClient';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';

/**
 * Genuinely refactored Incident Service
 * Communicates with the Central Backend (Postgres) instead of Firebase Firestore.
 * 0% Firebase dependencies.
 */

export async function addIncidentReport(companyId, userId, data, photos = []) {
    const cleanCompanyId = companyId.replace('companies/', '');
    const token = localStorage.getItem('mprar_central_token');

    // 1. Upload Photos to Central Storage API
    const photoUrls = [];
    if (photos.length > 0) {
        for (const file of photos) {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('path', `incident-photos/${cleanCompanyId}/${Date.now()}_${file.name}`);

            const uploadRes = await axios.post(`${API_BASE}/hr/storage/upload`, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                    'Authorization': `Bearer ${token}`
                }
            });
            photoUrls.push({ url: uploadRes.data.url, name: file.name });
        }
    }

    // 2. Save Metadata to PostgreSQL
    const response = await apiClient.post(`/hr/${cleanCompanyId}/incidents`, {
        companyId: cleanCompanyId,
        submittedBy: userId,
        player: data.player,
        incidentDate: data.incidentDate,
        location: data.location,
        description: data.description,
        photos: photoUrls
    });

    return response.data;
}

export async function getIncidentReports(companyId, role, userId) {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.get(`/hr/${cleanCompanyId}/incidents`);
    return response.data;
}

export async function getIncidentReportById(id) {
    const response = await apiClient.get(`/hr/incidents/${id}`);
    return response.data;
}
