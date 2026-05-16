import React, { memo, useMemo } from 'react';
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from './Table';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { User, Edit2, Trash2, RefreshCw, Archive } from 'lucide-react';

// Profile Picture Component
const ProfilePicture = memo(({ photoURL, name }) => (
  photoURL ? (
    <div className="w-10 h-10 rounded-full overflow-hidden bg-purple-50 border-2 border-purple-200 flex-shrink-0">
      <img
        src={photoURL}
        alt={name}
        className="w-full h-full object-cover"
        onError={(e) => {
          // Fallback to User icon if image fails to load
          e.target.style.display = 'none';
          const parent = e.target.parentElement;
          parent.className = 'w-10 h-10 rounded-full bg-purple-50 border-2 border-purple-200 flex items-center justify-center flex-shrink-0';
          parent.innerHTML = '<svg class="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>';
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

// Memoized table row component to prevent unnecessary re-renders
const TeamMemberRow = memo(({ member, onEdit, onDeactivate, onActivate, onDeleteForever, onRevokeInvite, onViewDetails, getRoleBadgeVariant, getStatusBadgeVariant, activatingUserId, currentUserRole }) => {
  const isUnarchiving = activatingUserId === member.id;

  // Check if Edit button should be disabled
  const memberRole = member.primaryRole || member.role;
  const currentUserRoleNormalized = (currentUserRole || '').toLowerCase().replace(/\s/g, '');
  const isEditDisabled =
    (currentUserRoleNormalized === 'adminmanager' && (member.role === 'Site Manager' || memberRole === 'siteManager')) ||
    ((member.role === 'Senior Manager' || memberRole === 'seniorManager') && !['superuser', 'siteowner', 'sitemanager'].includes(currentUserRoleNormalized));

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-lg">
          <ProfilePicture photoURL={member.photoURL} name={member.name} />
          <div>
            <p className="font-semibold text-text-primary">{member.name}</p>
            <p className="text-sm text-text-secondary">{member.email}</p>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant={getRoleBadgeVariant(member.role)}>{member.role}</Badge>
      </TableCell>
      <TableCell>
        <Badge variant={getStatusBadgeVariant(member.status)}>
          {member.status ? member.status.charAt(0).toUpperCase() + member.status.slice(1).toLowerCase() : '—'}
        </Badge>
      </TableCell>
      <TableCell>
        {!member.isInvited ? (
          <div className="flex justify-center items-center gap-md flex-wrap">
            {onViewDetails && (
              <Button
                variant="outline-primary"
                iconFirst
                onClick={() => onViewDetails(member)}
              >
                View Details
              </Button>
            )}
            {member.status === 'Archived' ? (
              <Button
                variant="outline-primary"
                iconFirst
                icon={RefreshCw}
                onClick={() => !isUnarchiving && onActivate(member)}
                isLoading={isUnarchiving}
                disabled={isUnarchiving}
              >
                Unarchive
              </Button>
            ) : (
              <>
                <Button
                  variant="outline-primary"
                  iconFirst
                  icon={Edit2}
                  onClick={() => onEdit(member)}
                  disabled={isEditDisabled}
                  title={
                    isEditDisabled
                      ? (member.role === 'Senior Manager' || memberRole === 'seniorManager')
                        ? "Senior Manager profile cannot be edited from this view"
                        : "Admin Manager cannot edit Site Manager"
                      : undefined
                  }
                >
                  Edit
                </Button>
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
          <div className="flex justify-center items-center">
            <Button
              variant="outline-danger"
              iconFirst
              icon={Trash2}
              onClick={() => onRevokeInvite(member)}
            >
              Revoke Invite
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
});

TeamMemberRow.displayName = 'TeamMemberRow';

// Optimized team members table
const OptimizedTeamTable = memo(({ teamMembers, onEdit, onDeactivate, onActivate, onDeleteForever, onRevokeInvite, onViewDetails, activatingUserId = null, currentUserRole = null }) => {
  // Memoize badge variant functions to prevent recreation on each render
  const getRoleBadgeVariant = useMemo(() => (role) => {
    switch (role) {
      case 'Site Manager':
      case 'siteManager': return 'success';
      case 'Senior Manager':
      case 'seniorManager': return 'role';
      case 'HR Manager':
      case 'hrManager': return 'role';
      case 'Contract Manager':
      case 'contractManager': return 'role';
      case 'Admin Manager':
      case 'adminManager': return 'role';
      case 'Team Manager':
      case 'teamManager': return 'role';
      case 'HR Advisor':
      case 'hrAdvisor': return 'info';
      case 'Admin Advisor':
      case 'adminAdvisor': return 'info';
      case 'Employee':
      case 'employee': return 'info';
      default: return 'info';
    }
  }, []);

  const getStatusBadgeVariant = useMemo(() => (status) => {
    const s = (status || '').toLowerCase();
    if (s === 'active')   return 'success';
    if (s === 'archived') return 'danger';
    if (s === 'inactive') return 'warning';
    if (s === 'invited')  return 'info';
    return 'default';
  }, []);

  // Memoize the table rows to prevent unnecessary re-renders
  const tableRows = useMemo(() =>
    teamMembers.map((member) => (
      <TeamMemberRow
        key={member.id}
        member={member}
        onEdit={onEdit}
        onDeactivate={onDeactivate}
        onActivate={onActivate}
        onDeleteForever={onDeleteForever}
        onRevokeInvite={onRevokeInvite}
        onViewDetails={onViewDetails}
        getRoleBadgeVariant={getRoleBadgeVariant}
        getStatusBadgeVariant={getStatusBadgeVariant}
        activatingUserId={activatingUserId}
        currentUserRole={currentUserRole}
      />
    )), [teamMembers, onEdit, onDeactivate, onActivate, onDeleteForever, onRevokeInvite, onViewDetails, getRoleBadgeVariant, getStatusBadgeVariant, activatingUserId, currentUserRole]);

  return (
    <Table>
      <TableHeader>
        <TableHeaderCell>User</TableHeaderCell>
        <TableHeaderCell>Role</TableHeaderCell>
        <TableHeaderCell>Status</TableHeaderCell>
        <TableHeaderCell>
          <div className="text-center">Actions</div>
        </TableHeaderCell>
      </TableHeader>
      <TableBody>
        {tableRows}
      </TableBody>
    </Table>
  );
});

OptimizedTeamTable.displayName = 'OptimizedTeamTable';

export default OptimizedTeamTable;