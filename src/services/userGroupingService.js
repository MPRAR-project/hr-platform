// User grouping service for organizing users by manager relationships
import { getUserDisplayName } from '../utils/dataParser';
import hrApiClient from '../lib/hrApiClient';

const paginatedCache = new Map();

/**
 * Fetch users with pagination from the HR API
 */
export async function fetchPaginatedUsers(companyId, pageSize = 20, lastDoc = null) {
  try {
    // REST API handles page numbers rather than lastDoc tokens
    const page = lastDoc ? (lastDoc.page || 1) + 1 : 1;

    const { data } = await hrApiClient.get('/hr/employees', {
      params: {
        page,
        limit: pageSize,
        status: 'active'
      }
    });

    const employees = data.employees || [];
    const total = data.total || 0;

    const uniqueUsers = employees.map(emp => ({
      userId: emp.id,
      id: emp.id,
      uid: emp.id,
      ...emp,
      displayName: `${emp.firstName} ${emp.lastName}`.trim() || emp.email
    }));

    return {
      users: uniqueUsers,
      lastDoc: { page },
      hasMore: uniqueUsers.length === pageSize && (page * pageSize) < total
    };
  } catch (error) {
    console.error('fetchPaginatedUsers: Error', error);
    throw error;
  }
}

/**
 * Fetch enhanced user groups using REST API
 */
export async function fetchEnhancedUserGroups(companyId, viewMode = 'active') {
  try {
    // Fetch both employees and teams from the REST API
    const [empRes, teamRes] = await Promise.all([
      hrApiClient.get('/hr/employees', {
        params: {
          limit: 1000, // Fetch a large batch for grouping
          status: viewMode === 'all' ? undefined : (viewMode === 'archived' ? 'archived' : 'active')
        }
      }),
      hrApiClient.get('/hr/teams')
    ]);

    const employees = empRes.data.employees || [];
    const teams = teamRes.data || [];

    // Map employees to the expected UI shape
    const processedUsers = employees.map(emp => {
      const name = `${emp.firstName} ${emp.lastName}`.trim() || emp.email;
      return {
        ...emp,
        userId: emp.id,
        uid: emp.id,
        displayName: name,
        name: name,
        primaryRole: emp.hrRole,
        roleCategory: ['siteManager', 'teamManager', 'adminManager', 'hrManager'].includes(emp.hrRole) ? 'Manager' : 'Employee'
      };
    });

    // Grouping logic (simplified to use team associations if available)
    // or fallback to manager relationship (reportsTo)
    const groups = groupUsersByManager(processedUsers, []); // assignments not used in backend yet

    return {
      groups: groups.map((g) => ({
        manager: g.primary,
        members: g.associated,
        teamStats: {
          totalMembers: g.associated.length,
          activeMembers: g.associated.filter((m) => m.status === 'active').length,
          archivedMembers: g.associated.filter((m) => m.status === 'archived').length
        },
        managerType: g.primary.roleCategory,
        type: g.primary.id === 'Unassigned' ? 'unassigned' : 'managed'
      })),
      metadata: {
        totalUsers: processedUsers.length,
        activeUsers: processedUsers.filter((u) => u.status === 'active').length,
        managerCount: groups.length - (groups.find((g) => g.primary.id === 'Unassigned') ? 1 : 0),
        unassignedCount: groups.find((g) => g.primary.id === 'Unassigned')?.associated.length || 0
      }
    };
  } catch (error) {
    console.error('fetchEnhancedUserGroups: Error', error);
    throw error;
  }
}

/**
 * Local grouping logic remains largely the same but uses REST property names
 */
export function groupUsersByManager(users, assignments = []) {
  const userIdToUser = new Map();
  const allUsers = [];

  for (const user of users) {
    if (user.hrRole === 'siteManager') continue;

    const row = {
      ...user,
      id: user.id,
      userId: user.id,
      name: user.displayName || `${user.firstName} ${user.lastName}`.trim(),
      roleCategory: ['siteManager', 'teamManager', 'adminManager', 'hrManager'].includes(user.hrRole) ? 'Manager' : 'Employee'
    };

    userIdToUser.set(user.id, row);
    allUsers.push(row);
  }

  const managerRoles = new Set(['teamManager', 'adminManager', 'hrManager', 'siteManager']);
  const managerIds = new Set(allUsers.filter((u) => managerRoles.has(u.hrRole)).map((u) => u.id));

  const managerIdToEmployees = new Map();

  for (const user of allUsers) {
    const managerId = user.reportsTo;
    if (!managerId || !userIdToUser.has(managerId)) continue;

    managerIds.add(managerId);
    if (!managerIdToEmployees.has(managerId)) {
      managerIdToEmployees.set(managerId, new Set());
    }
    managerIdToEmployees.get(managerId).add(user.id);
  }

  const assignedEmployeeIds = new Set();
  managerIdToEmployees.forEach((empSet) => empSet.forEach((eid) => assignedEmployeeIds.add(eid)));

  const unassignedRows = allUsers.filter((u) => !assignedEmployeeIds.has(u.id) && !managerIds.has(u.id));

  const groups = [];
  const seenManagers = new Set();

  for (const managerId of managerIds) {
    const managerRow = userIdToUser.get(managerId);
    if (!managerRow || seenManagers.has(managerId)) continue;
    seenManagers.add(managerId);

    const empIds = managerIdToEmployees.get(managerId);
    const members = empIds ? [...empIds].map((eid) => userIdToUser.get(eid)).filter(Boolean) : [];

    groups.push({
      primary: managerRow,
      associated: members,
      type: 'managed'
    });
  }

  if (unassignedRows.length > 0) {
    groups.push({
      primary: {
        id: 'Unassigned',
        name: 'Unassigned',
        hrRole: null,
        roleCategory: 'Employee'
      },
      associated: unassignedRows,
      type: 'unassigned'
    });
  }

  return groups;
}

export const userGroupingService = {
  fetchPaginatedUsers,
  clearCache: () => paginatedCache.clear(),
  clearAllCache: () => paginatedCache.clear()
};
