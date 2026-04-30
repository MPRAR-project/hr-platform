import React from 'react';
import UserListItem from './UserListItem';

// Enhanced UserGroup component - Static Grouping (No Collapsible)
const UserGroup = ({ group, userRole, onInviteDelete, onArchive, onUnarchive, onDeleteForever }) => {
  const isManagerGroup = group.primary.isManager;
  // [FIX] If primary (manager) is not matching the current view mode (e.g. Active manager in Archived tab),
  // treat them as a read-only header.
  const isPrimaryActionable = group.isPrimaryInView !== false;

  return (
    <div className="mb-6">
      {/* Group Header (Manager Profile or Group Title) */}
      <div className="flex items-center">
        {/* Primary User Item (Manager or Unassigned Header) */}
        <div className="flex-1">
          <UserListItem
            user={group.primary}
            variant="primary" // Always primary for the header/manager
            userRole={userRole}
            onInviteDelete={isPrimaryActionable ? onInviteDelete : null}
            onArchive={isPrimaryActionable ? onArchive : null}
            onUnarchive={isPrimaryActionable ? onUnarchive : null}
            onDeleteForever={isPrimaryActionable ? onDeleteForever : null}
          />
        </div>
      </div>

      {/* Group Members (Always Visible) */}
      {group.associated && group.associated.length > 0 && (
        <div className="mt-3 ml-6 pl-4 border-l-2 border-gray-200">
          {/* Team Members */}
          <div className="space-y-2">
            {group.associated.map(user => (
              <UserListItem
                key={user.id || user.email}
                user={user}
                variant="outline" // Distinct look for children
                userRole={userRole}
                isTeamMember={true}
                onInviteDelete={onInviteDelete}
                onArchive={onArchive}
                onUnarchive={onUnarchive}
                onDeleteForever={onDeleteForever}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty State for Managers */}
      {isManagerGroup && (!group.associated || group.associated.length === 0) && (
        <div className="mt-2 ml-10 text-gray-400 text-sm italic">
          No team members assigned
        </div>
      )}
    </div>
  );
};

export default UserGroup;