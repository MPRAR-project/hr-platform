// User grouping service for organizing users by manager relationships
import { getUserDisplayName } from '../utils/dataParser';
import { db } from '../firebase/client';
import { collection, query, where, getDocs, limit, startAfter, documentId } from 'firebase/firestore';

const paginatedCache = new Map();

export async function fetchPaginatedUsers(companyId, pageSize = 20, lastDoc = null) {
  try {
    const companyIdCandidates = [`companies/${companyId}`, companyId];

    let usersQuery = query(
      collection(db, 'users'),
      where('companyId', 'in', companyIdCandidates),
      limit(pageSize)
    );

    if (lastDoc) {
      usersQuery = query(
        collection(db, 'users'),
        where('companyId', 'in', companyIdCandidates),
        startAfter(lastDoc),
        limit(pageSize)
      );
    }

    const snap = await getDocs(usersQuery);

    const hasValidEmail = (email) => {
      const e = (email || '').trim();
      return e.length > 0 && e !== 'No email' && e.includes('@');
    };

    const seenEmails = new Set();
    const seenIds = new Set();
    const uniqueUsers = [];

    snap.docs.forEach((d) => {
      const data = d.data();
      const id = d.id;
      const email = (data.email || '').toLowerCase();

      if (!hasValidEmail(data.email)) return;

      if (!seenIds.has(id)) {
        if (!email || !seenEmails.has(email)) {
          uniqueUsers.push({ userId: id, id, uid: id, ...data });
          seenIds.add(id);
          if (email) seenEmails.add(email);
        } else {
          console.warn(`[UserGrouping] Suppressed duplicate user for email: ${email} (ID: ${id})`);
        }
      }
    });

    if (uniqueUsers.length === 0) {
      return { users: [], lastDoc: null, hasMore: false };
    }

    return {
      users: uniqueUsers,
      lastDoc: snap.docs[snap.docs.length - 1],
      hasMore: snap.docs.length === pageSize
    };
  } catch (error) {
    console.error('fetchPaginatedUsers: Error', error);
    throw error;
  }
}

export async function fetchEnhancedUserGroups(companyId, viewMode = 'active') {
  try {
    const MAX_GROUPING_PROFILES = 2000;
    const [profilesSnap, invitesSnapResult, assignSnapResult] = await Promise.all([
      getDocs(query(
        collection(db, 'userCompanyProfiles'),
        where('companyId', 'in', [companyId, `companies/${companyId}`]),
        limit(MAX_GROUPING_PROFILES)
      )),
      getDocs(query(
        collection(db, 'invites'),
        where('companyId', 'in', [companyId, `companies/${companyId}`]),
        where('status', '==', 'pending')
      )).catch(() => ({ docs: [] })),
      getDocs(query(
        collection(db, 'assignments'),
        where('companyId', 'in', [companyId, `companies/${companyId}`])
      )).catch(() => ({ docs: [] }))
    ]);

    const profiles = profilesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const getEffectiveUserId = (p) => (p.userId || p.id || '').trim();

    const userIds = [...new Set(profiles.map((p) => getEffectiveUserId(p)).filter(Boolean))];
    const profileMap = new Map();
    profiles.forEach((p) => {
      const uid = getEffectiveUserId(p);
      if (uid) profileMap.set(uid, p);
    });

    const users = [];
    const idsNeedingFetch = [];
    for (const uid of userIds) {
      const profile = profileMap.get(uid);
      if (profile && profile.displayName && profile.email && profile.isHydrated) {
        users.push({
          id: uid,
          userId: uid,
          uid: uid,
          ...profile,
          displayName: profile.displayName,
          email: profile.email,
          profileImage: profile.profileImage || null,
          employmentDetails: { jobTitle: profile.jobTitle || null },
          isHydrated: true
        });
      } else {
        idsNeedingFetch.push(uid);
      }
    }

    if (idsNeedingFetch.length > 0) {
      const batchPromises = [];
      for (let i = 0; i < idsNeedingFetch.length; i += 10) {
        const chunk = idsNeedingFetch.slice(i, i + 10);
        if (!chunk.length) continue;
        batchPromises.push(
          getDocs(query(collection(db, 'users'), where(documentId(), 'in', chunk)))
            .then((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })))
            .catch(() => [])
        );
      }
      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach((batch) => users.push(...batch));
    }

    const userMap = new Map();
    users.filter(Boolean).forEach((u) => userMap.set(u.id, u));

    const mergedUsers = profiles
      .map((profile) => {
        const uid = getEffectiveUserId(profile);
        const userGlobal = uid ? userMap.get(uid) : null;

        if (!userGlobal) {
          let effectiveStatus = profile.status || 'active';
          const ns = effectiveStatus.toLowerCase();
          if (ns === 'archived') effectiveStatus = 'Archived';
          else if (ns === 'active') effectiveStatus = 'active';
          else if (ns === 'inactive') effectiveStatus = 'Inactive';

          return {
            id: uid || profile.id,
            userId: uid || profile.id,
            uid: uid || profile.id,
            displayName: profile.displayName || profile.email || 'Unknown User',
            email: profile.email || '',
            profileImage: profile.profileImage || null,
            ...profile,
            status: effectiveStatus,
            profileId: profile.id,
            archived: effectiveStatus === 'Archived',
            isFallback: true
          };
        }

        let effectiveStatus = userGlobal.status || profile.status || 'active';
        const ns = effectiveStatus.toLowerCase();
        if (ns === 'archived') effectiveStatus = 'Archived';
        else if (ns === 'active') effectiveStatus = 'active';
        else if (ns === 'inactive') effectiveStatus = 'Inactive';

        return {
          ...userGlobal,
          ...profile,
          id: userGlobal.id,
          status: effectiveStatus,
          profileId: profile.id,
          archived: effectiveStatus === 'Archived'
        };
      })
      .filter(Boolean);

    const pendingInvites = (invitesSnapResult.docs || []).map((d) => {
      const data = d.data();
      return {
        id: `invite_${d.id}`,
        inviteId: d.id,
        isInvited: true,
        status: 'Pending',
        displayName: data.displayName || data.email || 'Invited',
        email: data.email,
        primaryRole: data.primaryRole || 'employee',
        createdAt: data.createdAt,
        managerUserId: data.reportsTo || null,
        reportsTo: data.reportsTo || null
      };
    });

    const hasValidEmail = (u) => {
      const e = (u.email || '').trim();
      return e.length > 0 && e !== 'No email' && e.includes('@');
    };
    const activeEmails = new Set(mergedUsers.map((u) => (u.email || '').toLowerCase()));
    const uniqueInvites = pendingInvites.filter((i) => !activeEmails.has((i.email || '').toLowerCase()));
    const filteredMerged = mergedUsers.filter(hasValidEmail);
    const filteredInvites = uniqueInvites.filter(hasValidEmail);

    const allUsers = [...filteredMerged, ...filteredInvites];

    const filteredUsers = allUsers.filter((u) => {
      const isArchived = u.status === 'Archived';
      if (viewMode === 'all') return true;
      if (viewMode === 'archived') return isArchived;
      return !isArchived;
    });

    const assignments = (assignSnapResult.docs || []).map((d) => ({ id: d.id, ...d.data() }));
    const groups = groupUsersByManager(filteredUsers, assignments);

    return {
      groups: groups.map((g) => ({
        manager: g.primary,
        members: g.associated,
        teamStats: {
          totalMembers: g.associated.length,
          activeMembers: g.associated.filter((m) => m.status === 'active' || m.status === 'Pending').length,
          archivedMembers: g.associated.filter((m) => m.status === 'Archived').length
        },
        managerType: g.primary.roleCategory,
        type: g.primary.id === 'Unassigned' ? 'unassigned' : 'managed'
      })),
      metadata: {
        totalUsers: filteredUsers.length,
        activeUsers: filteredUsers.filter((u) => u.status === 'active' || u.status === 'Pending').length,
        managerCount: groups.length - (groups.find((g) => g.primary.id === 'Unassigned') ? 1 : 0),
        unassignedCount: groups.find((g) => g.primary.id === 'Unassigned')?.associated.length || 0
      }
    };
  } catch (error) {
    console.error('fetchEnhancedUserGroups: Error', error);
    throw error;
  }
}

export function groupUsersByManager(users, assignments = []) {
  const strip = (v) => (typeof v === 'string' ? (v.includes('/') ? v.split('/').pop() : v) : null);

  const normalizeRole = (r) => {
    if (!r) return '';
    const lower = r.toLowerCase().replace(/\s+/g, '');
    const map = {
      hrmanager: 'hrManager',
      adminmanager: 'adminManager',
      teammanager: 'teamManager',
      sitemanager: 'siteManager',
      employee: 'employee'
    };
    return map[lower] || r;
  };

  const userIdToUser = new Map();
  const allUsers = [];

  const roleToJobTitle = (role) => {
    const norm = normalizeRole(role);
    const mapping = {
      siteManager: 'Site Manager',
      teamManager: 'Team Manager',
      adminManager: 'Admin Manager',
      hrManager: 'HR Manager',
      employee: 'Employee'
    };
    return mapping[norm] || 'Employee';
  };

  const roleToCategory = (role) => {
    const norm = normalizeRole(role);
    return ['siteManager', 'teamManager', 'adminManager', 'hrManager'].includes(norm) ? 'Manager' : 'Employee';
  };

  for (const user of users) {
    try {
      const rawRole = user.primaryRole || '';
      const normalizedRoleVal = normalizeRole(rawRole);

      // Exclude site managers here; they are fetched & rendered separately
      if (normalizedRoleVal === 'siteManager') continue;
      if (user.hideFromCompanyView === true) continue;

      const name = getUserDisplayName(user);
      const jobTitle = roleToJobTitle(rawRole);
      const roleCategory = roleToCategory(rawRole);

      let status;
      if (user.archived === true || user.status === 'Archived' || user.status === 'archived') {
        status = 'Archived';
      } else if (user.status?.toLowerCase() === 'active') {
        status = 'active';
      } else if (user.status === 'pending' || user.status === 'invited' || user.isInvited === true) {
        status = 'Pending';
      } else {
        status = 'active';
      }

      const row = {
        id: user.id,
        userId: user.id,
        uid: user.id,
        name,
        email: user.email || '',
        jobTitle,
        roleCategory,
        status,
        primaryRole: user.primaryRole,
        isInvited: user.isInvited || false,
        inviteId: user.inviteId
      };

      userIdToUser.set(user.id, { ...user, _row: row });
      allUsers.push(row);
    } catch (e) {
      console.warn('[groupUsersByManager] Skip user:', user?.id, e);
    }
  }

  const managerRoles = new Set(['teamManager', 'adminManager', 'hrManager', 'siteManager']);
  const managerIds = new Set(allUsers.filter((u) => managerRoles.has(u.primaryRole)).map((u) => u.id));

  const managerIdToEmployees = new Map();
  for (const a of assignments) {
    const employeeId = strip(a.employeeId || a.employeeUid || a.assigneeId || a.userId);
    const managerId = strip(a.managerId || a.managerUid || a.assignedToId);

    if (!employeeId || !managerId) continue;
    if (!userIdToUser.has(employeeId) || !userIdToUser.has(managerId)) continue;

    if (!managerIdToEmployees.has(managerId)) {
      managerIdToEmployees.set(managerId, new Set());
    }
    managerIdToEmployees.get(managerId).add(employeeId);
    managerIds.add(managerId);
  }

  for (const [id, userDoc] of userIdToUser.entries()) {
    const managed = Array.isArray(userDoc.managedEmployees) ? userDoc.managedEmployees : [];
    if (!managed.length) continue;

    const normalizedManaged = managed.map(strip).filter(Boolean).filter((eid) => userIdToUser.has(eid));
    if (normalizedManaged.length) {
      if (!managerIdToEmployees.has(id)) {
        managerIdToEmployees.set(id, new Set());
      }
      normalizedManaged.forEach((eid) => managerIdToEmployees.get(id).add(eid));
      managerIds.add(id);
    }
  }

  for (const [employeeId, userDoc] of userIdToUser.entries()) {
    const managerId = strip(userDoc.managerUserId || userDoc.reportsTo);
    if (!managerId) continue;
    if (!userIdToUser.has(managerId)) continue;

    managerIds.add(managerId);
    if (!managerIdToEmployees.has(managerId)) {
      managerIdToEmployees.set(managerId, new Set());
    }
    managerIdToEmployees.get(managerId).add(employeeId);
  }

  const assignedEmployeeIds = new Set();
  managerIdToEmployees.forEach((empSet) => empSet.forEach((eid) => assignedEmployeeIds.add(eid)));

  const unassignedRows = allUsers.filter((u) => !assignedEmployeeIds.has(u.id) && !managerIds.has(u.id));

  const groups = [];
  const seenManagers = new Set();

  for (const managerId of managerIds) {
    const managerRow = allUsers.find((u) => u.id === managerId);
    if (!managerRow || seenManagers.has(managerId)) continue;
    seenManagers.add(managerId);

    const empIds = managerIdToEmployees.get(managerId);
    const members = empIds ? [...empIds].map((eid) => allUsers.find((u) => u.id === eid)).filter(Boolean) : [];

    groups.push({
      primary: managerRow,
      associated: members,
      teamStats: {
        totalMembers: members.length,
        activeMembers: members.filter((m) => m.status === 'active' || m.status === 'Pending').length,
        archivedMembers: members.filter((m) => m.status === 'Archived').length
      },
      managerType: managerRow.roleCategory,
      type: 'managed'
    });
  }

  if (unassignedRows.length > 0) {
    groups.push({
      primary: {
        id: 'Unassigned',
        name: 'Unassigned',
        email: '',
        jobTitle: '—',
        roleCategory: 'Employee',
        status: '—',
        primaryRole: null
      },
      associated: unassignedRows,
      teamStats: {
        totalMembers: unassignedRows.length,
        activeMembers: unassignedRows.filter((m) => m.status === 'active' || m.status === 'Pending').length,
        archivedMembers: unassignedRows.filter((m) => m.status === 'Archived').length
      },
      managerType: 'Employee',
      type: 'unassigned'
    });
  }

  return groups;
}

export const userGroupingService = {
  fetchPaginatedUsers,

  clearCache(companyId) {
    if (!companyId) return;
    const prefix = String(companyId).replace(/^companies\//, '');
    for (const key of paginatedCache.keys()) {
      if (key.startsWith(prefix)) {
        paginatedCache.delete(key);
      }
    }
  },

  clearAllCache() {
    paginatedCache.clear();
  }
};
