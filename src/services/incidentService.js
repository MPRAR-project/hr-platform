import hrApiClient from '../lib/hrApiClient';

/**
 * Incident Management Service (REST Migration)
 */

export async function addIncidentReport(companyId, userId, data, photos = [], role = 'employee') {
    try {
        // 1. Upload Photos first using REST API
        const photoUrls = [];
        if (photos.length > 0) {
            const uploadPromises = photos.map(async (file) => {
                const formData = new FormData();
                formData.append('file', file);
                const { data: uploadRes } = await hrApiClient.post('/hr/upload', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' }
                });
                return { 
                    url: uploadRes.url, 
                    path: uploadRes.fileKey, 
                    name: uploadRes.fileName 
                };
            });
            const results = await Promise.all(uploadPromises);
            photoUrls.push(...results);
        }

        // 2. Save Incident
        const { data: incidentRes } = await hrApiClient.post('/hr/incidents', {
            employeeId: userId,
            incidentType: data.type || 'General',
            severity: data.severity || 'low',
            description: data.description,
            occurredAt: data.incidentDate || new Date().toISOString(),
            metadata: {
                player: data.player,
                location: data.location,
                photos: photoUrls
            }
        });

        return incidentRes;
    } catch (error) {
        console.error('Error adding incident report:', error);
        throw error;
    }
}

export async function getIncidentReports(companyId, role, userId, options = {}) {
    try {
        const { data } = await hrApiClient.get('/hr/incidents', {
            params: {
                employeeId: ['siteManager', 'adminManager', 'hrManager'].includes(role) ? undefined : userId
            }
        });

        const incidents = data.incidents || [];
        
        // Map to expected frontend shape
        return incidents.map(inc => ({
            ...inc,
            id: inc.id,
            submittedBy: inc.employeeId,
            incidentDate: inc.occurredAt,
            player: inc.metadata?.player,
            location: inc.metadata?.location,
            photos: inc.metadata?.photos || [],
            submitterName: inc.employee ? `${inc.employee.firstName} ${inc.employee.lastName}` : 'Unknown'
        }));
    } catch (error) {
        console.error('Error fetching incident reports:', error);
        return [];
    }
}
