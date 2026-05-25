import React, { memo, useMemo, Fragment } from 'react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { User, Edit2, Trash2, RefreshCw, Archive } from 'lucide-react';

const ProfilePicture = memo(({ photoURL, name }) => (
  photoURL ? (
    <div className="w-10 h-10 rounded-full overflow-hidden bg-purple-50 border-2 border-purple-200 flex-shrink-0">
      <img
        src={photoURL}
        alt={name}
        className="w-full h-full object-cover"
        onError={(e) => {
          e.target.style.display = 'none';
          const p = e.target.parentElement;
          p.className = 'w-10 h-10 rounded-full bg-purple-50 border-2 border-purple-200 flex items-center justify-center flex-shrink-0';
          p.innerHTML = '<svg class="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>';
        }}
      />
    </div>
  ) : (
    <div className="w-10 h-10 rounded-full bg-purple-50 border-2 border-purple-200 flex items-center justify-center flex-shrink-0">
      <User className="w-5 h-5 text-purple-600" />
    </div>
  )
));
ProfilePicture.displayName = 'ProfilePicture';

const getRoleBadgeVariant = (role) => {
  switch (role) {
    case 'Site Manager':     case 'siteManager':     return 'success';
    case 'Senior Manager':   case 'seniorManager':   return 'role';
    case 'HR Manager':       case 'hrManager':       return 'role';
    case 'Contract Manager': case 'contractManager': return 'role';
    case 'Admin Manager':    case 'adminManager':    return 'role';
    case 'Team Manager':     case 'teamManager':     return 'role';
    case 'HR Advisor':       case 'hrAdvisor':       return 'info';
    case 'Admin Advisor':    case 'adminAdvisor':    return 'info';
    default: return 'info';
  }
};

const getStatusBadgeVariant = (status) => {
  const s = (status || '').toLowerCase();
  if (s === 'active')    return 'success';
  if (s === 'archived')  return 'danger';
  if (s === 'suspended') return 'danger';
  if (s === 'inactive')  return 'danger';
  if (s === 'invited')   return 'info';
  return 'default';
};

// Shared row — used by both flat and hierarchical tables.
// isManager → purple tinted row, bold name
// isReport  → indented name cell with left border accent
const TeamMemberRow = memo(({
  member, onEdit, onDeactivate, onActivate, onDeleteForever, onRevokeInvite, onViewDetails,
  activatingUserId, currentUserRole,
  isManager = false, isReport = false,
}) => {
  const isUnarchiving = activatingUserId === member.id;
  const memberRole = member.primaryRole || member.role;
  const currentNorm = (currentUserRole || '').toLowerCase().replace(/\s/g, '');
  const isEditDisabled =
    (currentNorm === 'adminmanager' && (member.role === 'Site Manager' || memberRole === 'siteManager')) ||
    ((member.role === 'Senior Manager' || memberRole === 'seniorManager') &&
      !['superuser', 'siteowner', 'sitemanager'].includes(currentNorm));

  const rowBg = isManager ? 'bg-purple-50' : 'hover:bg-gray-50';
  const borderTop = isManager ? 'border-t-2 border-purple-100' : '';

  return (
    <tr className={`${rowBg} ${borderTop} transition-colors`}>
      {/* Name */}
      <td className="px-6 py-3">
        <div className={`flex items-center gap-3 ${isReport ? 'pl-6 border-l-2 border-gray-200' : ''}`}>
          <ProfilePicture photoURL={member.photoURL} name={member.name} />
          <div>
            <p className={`font-semibold ${isManager ? 'text-purple-900' : 'text-gray-900'}`}>{member.name}</p>
            <p className="text-sm text-gray-500">{member.email}</p>
          </div>
        </div>
      </td>

      {/* Role */}
      <td className="px-6 py-3">
        <Badge variant={getRoleBadgeVariant(member.role)}>{member.role}</Badge>
      </td>

      {/* Status */}
      <td className="px-6 py-3">
        <Badge variant={getStatusBadgeVariant(member.status)}>
          {member.status
            ? (['archived', 'suspended', 'inactive'].includes(member.status.toLowerCase()) 
                ? 'Inactive' 
                : member.status.charAt(0).toUpperCase() + member.status.slice(1).toLowerCase())
            : '—'}
        </Badge>
      </td>

      {/* Actions */}
      <td className="px-6 py-3">
        {!member.isInvited ? (
          <div className="flex justify-center items-center gap-2 flex-wrap">
            {onViewDetails && (
              <Button variant="outline-primary" iconFirst onClick={() => onViewDetails(member)}>
                View Details
              </Button>
            )}
            {['archived', 'suspended', 'inactive'].includes((member.status || '').toLowerCase()) ? (
              <Button
                variant="outline-primary"
                iconFirst
                icon={RefreshCw}
                onClick={() => !isUnarchiving && onActivate(member)}
                isLoading={isUnarchiving}
                disabled={isUnarchiving}
              >
                Reactivate
              </Button>
            ) : (
              <>
                {onEdit && (
                  <Button
                    variant="outline-primary"
                    iconFirst
                    icon={Edit2}
                    onClick={() => onEdit(member)}
                    disabled={isEditDisabled}
                    title={isEditDisabled ? 'Cannot edit this role from this view' : undefined}
                  >
                    Edit
                  </Button>
                )}
                <Button
                  variant="outline-warning"
                  iconFirst
                  icon={Archive}
                  onClick={() => onDeactivate(member)}
                >
                  Archive
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="flex justify-center">
            {member.inviteId && onRevokeInvite ? (
              <Button variant="outline-danger" iconFirst icon={Trash2} onClick={() => onRevokeInvite(member)}>
                Revoke Invite
              </Button>
            ) : (
              <Button variant="outline-danger" iconFirst icon={Trash2} onClick={() => onDeactivate && onDeactivate(member)}>
                Delete
              </Button>
            )}
          </div>
        )}
      </td>
    </tr>
  );
});
TeamMemberRow.displayName = 'TeamMemberRow';

const TABLE_HEADER = (
  <thead className="bg-gray-50 border-b border-gray-200">
    <tr>
      <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">User</th>
      <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Position</th>
      <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
      <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-center">Actions</th>
    </tr>
  </thead>
);

// Hierarchical table — renders manager groups with their direct reports indented below.
const HierarchicalTeamTable = memo(({
  groups, onEdit, onDeactivate, onActivate, onDeleteForever, onRevokeInvite, onViewDetails,
  activatingUserId = null, currentUserRole = null,
}) => {
  const shared = { onEdit, onDeactivate, onActivate, onDeleteForever, onRevokeInvite, onViewDetails, activatingUserId, currentUserRole };

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        {TABLE_HEADER}
        <tbody>
          {groups.map((group, gi) => (
            <Fragment key={group.manager?.id || `unmanaged-${gi}`}>
              {gi > 0 && (
                <tr><td colSpan={4} className="h-2 bg-gray-100 border-y border-gray-200" /></tr>
              )}

              {group.manager ? (
                <TeamMemberRow member={group.manager} isManager {...shared} />
              ) : (
                <tr className="bg-gray-50">
                  <td colSpan={4} className="px-6 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    No Manager Assigned
                  </td>
                </tr>
              )}

              {group.reports.map(member => (
                <TeamMemberRow key={member.id} member={member} isReport {...shared} />
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
});
HierarchicalTeamTable.displayName = 'HierarchicalTeamTable';

// Flat table — kept for any existing consumers.
const OptimizedTeamTable = memo(({
  teamMembers, onEdit, onDeactivate, onActivate, onDeleteForever, onRevokeInvite, onViewDetails,
  activatingUserId = null, currentUserRole = null,
}) => {
  const shared = { onEdit, onDeactivate, onActivate, onDeleteForever, onRevokeInvite, onViewDetails, activatingUserId, currentUserRole };
  const rows = useMemo(() =>
    teamMembers.map(m => <TeamMemberRow key={m.id} member={m} {...shared} />),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [teamMembers, onEdit, onDeactivate, onActivate, onDeleteForever, onRevokeInvite, onViewDetails, activatingUserId, currentUserRole]
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        {TABLE_HEADER}
        <tbody className="divide-y divide-gray-100">{rows}</tbody>
      </table>
    </div>
  );
});
OptimizedTeamTable.displayName = 'OptimizedTeamTable';

export { HierarchicalTeamTable };
export default OptimizedTeamTable;
