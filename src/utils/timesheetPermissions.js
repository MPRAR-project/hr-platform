const TIMESHEET_EDITOR_ROLES = new Set([
  'adminAdvisor',
  'adminManager',
  'hrAdvisor',
  'hrManager',
  'teamManager',
  'siteManager',
  'seniorManager'
]);

export const TIMESHEET_EDITOR_ROLES_LIST = Array.from(TIMESHEET_EDITOR_ROLES);

export function normalizeUserId(idOrPath) {
  if (!idOrPath) return null;
  const value = String(idOrPath);
  if (value.includes('/')) {
    const parts = value.split('/').filter(Boolean);
    return parts[parts.length - 1] || null;
  }
  return value || null;
}

export function canEditTimesheets(role) {
  if (!role) return false;
  // Normalize role to handle case variations and spacing
  const normalizedRole = String(role).toLowerCase().replace(/[_\s-]/g, '');

  // Check against normalized role names - ensure hrManager is included
  const allowedRoles = [
    'adminadvisor',
    'adminmanager',
    'hradvisor',
    'hrmanager',
    'teammanager',
    'sitemanager',
    'seniormanager',
    'employee'
  ];

  return allowedRoles.includes(normalizedRole);
}

export function canEditTargetTimesheet(viewerRole, viewerUserId, targetUserId) {
  if (!canEditTimesheets(viewerRole)) return false;
  const normalizedViewerId = normalizeUserId(viewerUserId);
  const normalizedTargetId = normalizeUserId(targetUserId);
  if (!normalizedViewerId || !normalizedTargetId) return false;
  if (normalizedViewerId === normalizedTargetId) return true;
  return true;
}


/**
 * Determines if a user can edit a specific timesheet based on their role and the timesheet status.
 * 
 * @param {Object} timesheet - The timesheet object (must have status and userId)
 * @param {Object} user - The current user object (must have userId and role)
 * @returns {boolean} True if the user can edit this timesheet
 */
export function getTimesheetEditPermissions(timesheet, user) {
  if (!timesheet || !user) return false;

  const status = String(timesheet.status || 'draft').toLowerCase();
  const normalizedUserId = normalizeUserId(user.userId || user.id);
  const normalizedOwnerId = normalizeUserId(timesheet.userId);

  const isOwner = normalizedUserId === normalizedOwnerId;

  if (isOwner) {
    // Owners can edit their own timesheets ONLY if they are in 'draft' or 'rejected' status.
    // Once sent for approval ('pending'), they must Wait for a decline/rejection to edit again.
    return ['draft', 'rejected', ''].includes(status);
  }

  // Check if user has manager/admin permissions to edit this target user's timesheets
  const hasManagerPermission = canEditTargetTimesheet(user.role, normalizedUserId, normalizedOwnerId);

  if (hasManagerPermission) {
    // Managers can edit 'draft' (to assist), 'pending' (to correct), 
    // or 'approved-by-team' (site managers correcting team manager's input).
    // They can also edit 'rejected' to help fix errors.
    // Senior roles CAN edit 'approved' timesheets (post-approval corrections).
    return ['draft', 'pending', 'approved-by-team', 'submitted', 'rejected', 'approved'].includes(status);
  }

  return false;
}
