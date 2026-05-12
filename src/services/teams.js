import apiClient from '../api/apiClient';

/**
 * Genuinely refactored Teams Service
 * Communicates with the Central Backend (Postgres) instead of Firebase Firestore.
 * 0% Firebase dependencies.
 */

export async function getManagedEmployeeIdsForManager(managerId, companyId) {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.get(`/hr/${cleanCompanyId}/managers/${managerId}/managed-employees`);
    return new Set(response.data.map(emp => emp.id));
}

export async function isEmployeeManagedByManager(employeeId, managerId, companyId) {
    const managedIds = await getManagedEmployeeIdsForManager(managerId, companyId);
    return managedIds.has(employeeId);
}

export async function getTeamMembers(managerId, companyId) {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.get(`/hr/${cleanCompanyId}/managers/${managerId}/team-members`);
    return response.data;
}

export async function getEmployeeManager(employeeId, companyId) {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.get(`/hr/${cleanCompanyId}/users/${employeeId}/manager`);
    return response.data;
}

export async function getTeamStatistics(managerId, companyId) {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.get(`/hr/${cleanCompanyId}/managers/${managerId}/team-stats`);
    return response.data;
}

export async function hasTeamManagementPermissions(userId, companyId) {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.get(`/hr/${cleanCompanyId}/users/${userId}/permissions`);
    return response.data.canManageTeam;
}

export async function getCompanyManagers(companyId) {
    const cleanCompanyId = companyId.replace('companies/', '');
    const response = await apiClient.get(`/hr/${cleanCompanyId}/managers`);
    return response.data;
}

export function approverEmployeeRoleMatch(approverRole, employeeRole) {
  const roleHierarchy = {
    'superUser': ['employee', 'teamManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor', 'contractManager', 'siteManager', 'seniorManager'],
    'siteManager': ['employee', 'teamManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor', 'contractManager', 'seniorManager'],
    'seniorManager': ['employee', 'teamManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor', 'contractManager'],
    'adminManager': ['employee', 'teamManager', 'adminAdvisor'],
    'hrManager': ['employee', 'teamManager', 'hrAdvisor'],
    'adminAdvisor': ['employee'],
    'hrAdvisor': ['employee'],
    'teamManager': ['employee'],
    'contractManager': ['employee']
  };

  const canApproveFor = roleHierarchy[approverRole] || [];
  return canApproveFor.includes(employeeRole);
}