/**
 * timesheetPermissions.js
 *
 * Central authority for timesheet access control.
 *
 * Rules:
 *  - Only seniorManager and siteManager can APPROVE or REJECT
 *  - Draft and Rejected → editable by owner and managers
 *  - Submitted and Approved → locked for everyone (no edits)
 */

// Roles that can approve / reject timesheets
export const APPROVER_ROLES = new Set(['seniorManager', 'siteManager', 'superUser']);

// Roles that can view and manage other employees' timesheets
const MANAGER_ROLES = new Set([
  'adminAdvisor', 'adminManager', 'hrAdvisor', 'hrManager',
  'teamManager', 'siteManager', 'seniorManager', 'superUser', 'contractManager',
]);

export const TIMESHEET_EDITOR_ROLES_LIST = Array.from(MANAGER_ROLES);

export function normalizeUserId(idOrPath) {
  if (!idOrPath) return null;
  const value = String(idOrPath);
  if (value.includes('/')) {
    const parts = value.split('/').filter(Boolean);
    return parts[parts.length - 1] || null;
  }
  return value || null;
}

/**
 * Can the given role approve or reject a timesheet?
 */
export function canApproveTimesheets(role) {
  if (!role) return false;
  return APPROVER_ROLES.has(role);
}

export function canEditTimesheets(role) {
  if (!role) return false;
  const normalizedRole = String(role).toLowerCase().replace(/[\s_-]+/g, '');
  const allowedNormalized = Array.from(MANAGER_ROLES).map(r =>
    r.toLowerCase().replace(/[\s_-]+/g, '')
  );
  return allowedNormalized.includes(normalizedRole);
}

export function canEditTargetTimesheet(viewerRole, viewerUserId, targetUserId) {
  if (!viewerRole) return false;
  const normalizedViewerId = normalizeUserId(viewerUserId);
  const normalizedTargetId = normalizeUserId(targetUserId);
  if (!normalizedViewerId || !normalizedTargetId) return false;
  if (normalizedViewerId === normalizedTargetId) return false;
  return canEditTimesheets(viewerRole);
}

/**
 * Determines if a user can EDIT a specific timesheet.
 *
 * Edit is only possible when status is 'draft' or 'rejected'.
 * Once submitted or approved, no one can edit.
 *
 * @param {Object} timesheet - Must have { status, userId }
 * @param {Object} user      - Must have { userId, id, role }
 * @returns {boolean}
 */
export function getTimesheetEditPermissions(timesheet, user) {
  if (!timesheet || !user) return false;

  const status = String(timesheet.status || 'draft').toLowerCase();

  // Submitted and approved are locked for EVERYONE — no exceptions
  if (['submitted', 'pending', 'approved'].includes(status)) return false;

  // Only 'draft' and 'rejected' are editable
  if (!['draft', 'rejected', ''].includes(status)) return false;

  const normalizedViewerId = normalizeUserId(user.userId || user.id || user.uid);
  const normalizedOwnerId  = normalizeUserId(timesheet.userId || timesheet.employeeId);

  // Owner can edit their own draft/rejected
  if (normalizedViewerId && normalizedOwnerId && normalizedViewerId === normalizedOwnerId) {
    return true;
  }

  // Managers can also help edit draft/rejected timesheets
  return canEditTimesheets(user.role || user.hrRole);
}
