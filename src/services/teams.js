/**
 * teams.js — Phase 4 Migration (REST Only)
 *
 * Replaces Firestore reads/writes for team management.
 * All exports match original signatures.
 */

import hrApiClient from '../lib/hrApiClient';

function normalizeDates(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  ['createdAt','updatedAt'].forEach((k) => {
    if (out[k]?.toDate)  out[k] = out[k].toDate().toISOString();
    if (out[k]?.seconds) out[k] = new Date(out[k].seconds * 1000).toISOString();
  });
  return out;
}

// ── Get managed employee IDs for a manager (used by documentService etc.) ─────
export async function getManagedEmployeeIdsForManager(userId, companyId) {
  try {
    const { data } = await hrApiClient.get('/hr/employees', {
      params: { managerId: userId },
    });
    const employees = data.employees || data || [];
    return employees.map((e) => e.id || e.userId).filter(Boolean);
  } catch {
    return [];
  }
}

// ── Get managed employee objects for a manager (used by MyTeamPage) ───────────
export async function getManagedEmployeesForManager(userId, companyId) {
  try {
    const { data } = await hrApiClient.get('/hr/employees', {
      params: { managerId: userId },
    });
    const employees = data.employees || data || [];
    return employees.map((e) => ({
      ...e,
      userId:      e.id || e.userId || e.employeeId,
      id:          e.id || e.userId || e.employeeId,
      primaryRole: e.hrRole || e.primaryRole || e.role,
      displayName: e.displayName || `${e.firstName || ''} ${e.lastName || ''}`.trim() || e.email || 'Employee',
    }));
  } catch {
    return [];
  }
}

// ── Role-based approver match (pure logic, no Firebase) ──────────────────────
// Used by timesheets.js to determine if an approver's role matches the employee.
// Rules: teamManager can approve their reports, siteManager can approve anyone
// in their site, hrManager/adminManager can approve company-wide.
export function approverEmployeeRoleMatch(approverRole, employeeRole) {
  if (!approverRole) return false;
  const managerRoles = ['superUser', 'siteManager', 'hrManager', 'adminManager', 'hrAdvisor', 'adminAdvisor'];
  if (managerRoles.includes(approverRole)) return true;
  if (approverRole === 'teamManager') return true; // Team managers can approve their reports
  return false;
}

export async function getTeams(companyId) {
  try {
    const { data } = await hrApiClient.get('/hr/teams');
    return (data.teams || data || []).map(normalizeDates);
  } catch (err) {
    if (err.response?.status === 403) return [];
    throw new Error(err.response?.data?.error || 'Failed to fetch teams');
  }
}

export async function getTeamById(teamId) {
  try {
    const { data } = await hrApiClient.get(`/hr/teams/${teamId}`);
    return normalizeDates(data);
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw new Error(err.response?.data?.error || 'Failed to fetch team');
  }
}

export async function createTeam(teamData, companyId, createdBy) {
  try {
    const { data } = await hrApiClient.post('/hr/teams', {
      ...teamData,
      companyId: companyId || teamData.companyId,
      createdBy: createdBy || null,
    });
    return normalizeDates(data);
  } catch (err) {
    throw new Error(err.response?.data?.error || 'Failed to create team');
  }
}

export async function updateTeam(teamId, updateData) {
  try {
    const { data } = await hrApiClient.put(`/hr/teams/${teamId}`, updateData);
    return normalizeDates(data);
  } catch (err) {
    if (err.response?.status === 404) throw new Error('Team not found');
    if (err.response?.status === 403) throw new Error('Permission denied');
    throw new Error(err.response?.data?.error || 'Failed to update team');
  }
}

export async function deleteTeam(teamId) {
  try {
    await hrApiClient.delete(`/hr/teams/${teamId}`);
    return true;
  } catch (err) {
    if (err.response?.status === 404) throw new Error('Team not found');
    if (err.response?.status === 403) throw new Error('Permission denied');
    throw new Error(err.response?.data?.error || 'Failed to delete team');
  }
}

export async function addMemberToTeam(teamId, memberId) {
  try {
    const { data } = await hrApiClient.put(`/hr/teams/${teamId}`, {
      addMemberId: memberId,
    });
    return normalizeDates(data);
  } catch (err) {
    throw new Error(err.response?.data?.error || 'Failed to add team member');
  }
}

export async function removeMemberFromTeam(teamId, memberId) {
  try {
    const { data } = await hrApiClient.put(`/hr/teams/${teamId}`, {
      removeMemberId: memberId,
    });
    return normalizeDates(data);
  } catch (err) {
    throw new Error(err.response?.data?.error || 'Failed to remove team member');
  }
}

// ── Get members of a specific team ────────────────────────────────────────────
export async function getTeamMembers(teamId) {
  try {
    const team = await getTeamById(teamId);
    if (!team) return [];
    return team.members || team.employees || [];
  } catch {
    return [];
  }
}

// ── Get teams for a specific employee ─────────────────────────────────────────
export async function getEmployeeTeams(employeeId) {
  try {
    const { data } = await hrApiClient.get('/hr/teams', {
      params: { employeeId },
    });
    return (data.teams || data || []).map(normalizeDates);
  } catch {
    return [];
  }
}

export function subscribeToTeams(companyId, callback) {
  getTeams(companyId).then(callback).catch(() => {});
  return () => {};
}

const teamsService = {
  getTeams,
  getTeamById,
  createTeam,
  updateTeam,
  deleteTeam,
  addMemberToTeam,
  removeMemberFromTeam,
  subscribeToTeams,
  getManagedEmployeesForManager,
};

export default teamsService;