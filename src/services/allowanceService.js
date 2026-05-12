import apiClient from '../api/apiClient';

/**
 * Genuinely refactored Allowance Service
 * Communicates with the Central Backend (Postgres) instead of Firebase Firestore.
 * 0% Firebase dependencies.
 */

export async function createAllowances(employeeId, allowances, currentUser) {
    const companyId = currentUser.companyId;
    const cleanCompanyId = companyId.replace('companies/', '');
    
    const results = [];
    for (const allowance of allowances) {
        const response = await apiClient.post(`/hr/${cleanCompanyId}/allowances`, {
            userId: employeeId,
            companyId: cleanCompanyId,
            leaveType: allowance.type,
            totalDays: parseFloat(allowance.totalDays),
            remainingDays: parseFloat(allowance.totalDays),
            year: parseInt(allowance.year || new Date().getFullYear()),
            validFrom: allowance.validFrom || `${new Date().getFullYear()}-01-01`,
            validUntil: allowance.validUntil || `${new Date().getFullYear()}-12-31`
        });
        results.push(response.data);
    }
    return results;
}

export async function getEmployeeAllowances(employeeId, currentUser, year = null) {
    const companyId = currentUser.companyId;
    const cleanCompanyId = companyId.replace('companies/', '');
    
    const response = await apiClient.get(`/hr/${cleanCompanyId}/allowances`, {
        params: { userId: employeeId, year }
    });
    
    return response.data.map(allowance => ({
        ...allowance,
        displayName: allowance.leaveType // Simple mapping for now
    }));
}

export async function updateAllowance(id, updates) {
    const response = await apiClient.put(`/hr/allowances/${id}`, updates);
    return response.data;
}

export async function deleteAllowance(id) {
    const response = await apiClient.delete(`/hr/allowances/${id}`);
    return response.data;
}

export function subscribeToEmployeeAllowances(employeeId, currentUser, year, onUpdate) {
    // Polling fallback
    const interval = setInterval(async () => {
        try {
            const data = await getEmployeeAllowances(employeeId, currentUser, year);
            onUpdate(data);
        } catch (e) {
            console.error('Polling allowances failed:', e);
        }
    }, 30000);

    return () => clearInterval(interval);
}

// Legacy utility methods kept for UI compatibility
export function normalizeLeaveType(leaveType) {
    if (!leaveType) return '';
    return leaveType.toLowerCase().replace(/[\s_]/g, '');
}

export function getLeaveTypeDisplayName(leaveType) {
    return leaveType || 'Unknown';
}

export const allowanceService = {
    createAllowances,
    getEmployeeAllowances,
    updateAllowance,
    deleteAllowance,
    subscribeToEmployeeAllowances,
    normalizeLeaveType,
    getLeaveTypeDisplayName
};

export default allowanceService;