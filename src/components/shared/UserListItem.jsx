import React, { useEffect, useState } from 'react';
import { User, Mail, Briefcase } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { useNavigate } from 'react-router-dom';
import ApprovalConfirmationModal from '../modals/ApprovalConfirmationModal';
import DeleteConfirmationModal from '../modals/DeleteConfirmationModal';
import { setUserStatus } from '../../services/users';
import { useAuth } from '../../hooks/useAuth';

const UserListItem = ({ user, variant = 'primary', userRole = null, isTeamMember = false, onInviteDelete = null, onArchive = null, onUnarchive = null, onDeleteForever = null }) => {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const [canViewDetails, setCanViewDetails] = useState(false);
  const [isActivateModalOpen, setIsActivateModalOpen] = useState(false);
  const [isDeactivateModalOpen, setIsDeactivateModalOpen] = useState(false);
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const [isUnarchiveModalOpen, setIsUnarchiveModalOpen] = useState(false);

  // Normalize user IDs for comparison (handle both 'uid' and 'users/uid' formats)
  const normalizeUserId = (userId) => {
    if (!userId) return null;
    return userId.includes('/') ? userId.split('/').pop() : userId;
  };


  const isCurrentUser = normalizeUserId(user?.id) === normalizeUserId(currentUser?.uid);
  const canManageUsers = userRole === 'siteManager' || userRole === 'superUser';
  const isPendingInvite = Boolean((user?.isInvited || user?.sourceType === 'invite') && user?.inviteId);

  const variants = {
    primary: 'bg-purple-50 border border-border-accent-purple',
    secondary: isTeamMember ? 'bg-gray-50 border-l-4 border-l-purple-300 ml-4' : 'bg-background-primary',
    separated: 'bg-background-primary border-b border-border-secondary last:border-0',
    outline: 'bg-background-primary border border-border-secondary'
  };

  const handleNavigate = () => {
    console.log('Navigating to user details for user :', user);
    navigate(`/userDetails`, { state: { userId: user.id } });
  };

  const handleActivate = async () => {
    try {
      await setUserStatus(user.id, 'active');
      setIsActivateModalOpen(false);
      // naive reload signal
      window.dispatchEvent(new Event('users:reload'));
    } catch (e) { console.error(e); }
  };

  const handleDeactivate = async () => {
    try {
      await setUserStatus(user.id, 'inactive');
      setIsDeactivateModalOpen(false);
      window.dispatchEvent(new Event('users:reload'));
    } catch (e) { console.error(e); }
  };

  const handleInviteDeleteClick = () => {
    if (onInviteDelete) {
      onInviteDelete(user);
    }
  };

  const handleArchiveConfirm = async () => {
    if (onArchive) {
      await onArchive(user);
    }
    setIsArchiveModalOpen(false);
  };

  const handleUnarchiveConfirm = async () => {
    if (onUnarchive) await onUnarchive(user);
    setIsUnarchiveModalOpen(false);
  };

  useEffect(() => {
    const isSuperUser = (role) => {
      // console.log(role);
      if (role === "superUser") setCanViewDetails(false);
      else setCanViewDetails(true);
    }
    isSuperUser(userRole);
  }, [userRole]);



  const statusBadgeVariant = user.status?.toLowerCase() === 'active'
    ? 'success'
    : user.status?.toLowerCase() === 'pending'
      ? 'warning'
      : user.status?.toLowerCase() === 'archived'
        ? 'neutral'
        : 'danger';

  // Profile Picture Component
  const ProfilePicture = ({ size = 'w-11 h-11' }) => (
    user?.photoURL ? (
      <div className={`${size} rounded-full overflow-hidden bg-bg-accent-purple-light border-2 border-border-accent-purple flex-shrink-0`}>
        <img
          src={user.photoURL}
          alt={user.name}
          className="w-full h-full object-cover"
          onError={(e) => {
            // Fallback to User icon if image fails to load
            e.target.style.display = 'none';
            e.target.parentElement.innerHTML = '<div class="w-full h-full flex items-center justify-center"><svg class="h-6 w-6 text-text-accent-purple" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg></div>';
          }}
        />
      </div>
    ) : (
      <div className={`${size} bg-bg-accent-purple-light rounded-full flex items-center justify-center flex-shrink-0`}>
        <User className="h-6 w-6 text-text-accent-purple" />
      </div>
    )
  );

  return (
    <>
      <div className={`w-full rounded-base ${variants[variant]}`}>
        {/* Mobile View */}
        <div className="block lg:hidden p-base">
          <div className="flex items-center gap-base mb-3">
            <ProfilePicture />
            <div className="flex-1">
              <p className="text-lg font-semibold text-text-primary capitalize">{user.name}</p>
              <div className="flex flex-wrap items-center gap-x-xl gap-y-xs text-text-secondary text-base mt-1">
                <span className="flex items-center gap-xs"><Mail className="h-4 w-4" /> {user.email}</span>
                <span className="flex items-center gap-xs"><Briefcase className="h-4 w-4" /> {user.jobTitle}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 mb-3">
            <Badge variant={(() => {
              if (!user.roleCategory) return 'info';
              const role = user.roleCategory.toUpperCase();
              //console.log('role123456', role);
              return (role.includes('MANAGER') || role.includes('ADVISOR') || role.includes('DIRECTOR') || role.includes('ADMIN')) ? 'role' : 'info';
            })()}>{user.roleCategory}</Badge>

            <Badge variant={statusBadgeVariant}>{user.status}</Badge>
          </div>

          <div className="text-xs text-text-secondary mb-3">
            Last active: {user.lastActive ? new Date(user.lastActive.toDate ? user.lastActive.toDate() : user.lastActive).toLocaleString() : 'Never'}
          </div>

          {user.roleCategory !== 'Group' && (
            <div className="flex gap-md">
              {isPendingInvite && canManageUsers ? (
                <Button
                  variant="outline-danger"
                  cn="flex-1"
                  onClick={handleInviteDeleteClick}
                >
                  Delete Invite
                </Button>
              ) : (
                <>
                  {user.status === 'active' ? (
                    <Button
                      variant="outline-danger"
                      cn="flex-1"
                      onClick={() => setIsArchiveModalOpen(true)}
                    >
                      Archive
                    </Button>
                  ) : user.status === 'Archived' ? (
                    <Button
                      variant="outline-primary"
                      cn="flex-1"
                      onClick={() => setIsUnarchiveModalOpen(true)}
                    >
                      Unarchive
                    </Button>
                  ) : (
                    <Button
                      variant="outline-success"
                      cn="flex-1"
                      onClick={() => setIsActivateModalOpen(true)}
                    >
                      Activate
                    </Button>
                  )}
                  {canViewDetails && !isPendingInvite && !isCurrentUser && (
                    <Button variant="outline-primary" onClick={handleNavigate} cn="flex-1">View Details</Button>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Desktop View - Flexbox Row (Replaces Table) */}
        <div className="hidden lg:flex items-center w-full">
          {/* User Info Column */}
          <div className="p-base flex-1 min-w-0">
            <div className="flex items-center space-x-4">
              {/* Profile Image */}
              <div className="flex-shrink-0">
                {user.photoURL ? (
                  <div className="h-10 w-10 rounded-full overflow-hidden bg-gray-100 border border-gray-200">
                    <img className="h-full w-full object-cover" src={user.photoURL} alt="" />
                  </div>
                ) : (
                  <div className={`h-10 w-10 rounded-full flex items-center justify-center ${variant === 'primary' ? 'bg-purple-100 text-purple-600' : 'bg-gray-100 text-gray-500'}`}>
                    <span className="text-sm font-medium">{user.name?.charAt(0) || user.email?.charAt(0) || '?'}</span>
                  </div>
                )}
              </div>

              {/* User Details */}
              <div className="min-w-0 flex-1">
                <p className="text-lg font-semibold text-text-primary capitalize truncate">{user.name}</p>
                <div className="flex flex-wrap items-center gap-x-xl gap-y-xs text-text-secondary text-base">
                  <span className="flex items-center gap-xs truncate"><Mail className="h-4 w-4" /> {user.email}</span>
                  <span className="flex items-center gap-xs truncate"><Briefcase className="h-4 w-4" /> {user.jobTitle}</span>
                </div>
                <div className="text-xs text-text-secondary mt-1">
                  Last active: {user.lastActive ? new Date(user.lastActive.toDate ? user.lastActive.toDate() : user.lastActive).toLocaleString() : 'Never'}
                </div>
              </div>
            </div>
          </div>

          {/* Role Badge Column */}
          <div className="p-base text-center w-[15%] flex justify-center">
            <Badge variant={(() => {
              if (!user.roleCategory) return 'info';
              const role = user.roleCategory.toUpperCase();
              return (role.includes('MANAGER') || role.includes('ADVISOR') || role.includes('DIRECTOR') || role.includes('ADMIN')) ? 'role' : 'info';
            })()}>
              {user.roleCategory}
            </Badge>
          </div>

          {/* Status Badge Column */}
          {currentUser?.role === 'superUser' || currentUser?.role === 'adminManager' || currentUser?.role === 'adminAdvisor' || currentUser?.role === 'hrManager' || currentUser?.role === 'hrAdvisor'
            ? <div className="p-base text-center w-[15%] flex justify-center">
              <Badge variant={statusBadgeVariant}>
                {user.status}
              </Badge>
            </div>
            : null}

          {/* Actions Column */}
          <div className="p-base w-[30%] flex justify-end">
            {user.roleCategory !== 'Group' && (
              <div className="flex items-center justify-end gap-md w-full">
                {
                  userRole === "siteManager" && (
                    isPendingInvite ? (
                      <Button
                        type="button"
                        variant="outline-danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleInviteDeleteClick();
                        }}
                      >
                        Delete Invite
                      </Button>
                    ) : (
                      (user.status === 'active' ? (
                        <Button
                          type="button"
                          variant="outline-danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsArchiveModalOpen(true);
                          }}
                        >
                          Archive
                        </Button>
                      ) : user.status === 'Archived' ? (
                        <Button
                          type="button"
                          variant="outline-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsUnarchiveModalOpen(true);
                          }}
                        >
                          Unarchive
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="outline-success"
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsActivateModalOpen(true);
                          }}
                        >
                          Activate
                        </Button>
                      ))
                    )
                  )
                }
                {canViewDetails && !isPendingInvite && !isCurrentUser && (
                  <Button
                    type="button"
                    variant="outline-primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleNavigate();
                    }}
                  >
                    View Details
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>


      <ApprovalConfirmationModal
        isOpen={isActivateModalOpen}
        onClose={() => setIsActivateModalOpen(false)}
        onConfirm={handleActivate}
        title="Activate User"
        description={`Are you sure you want to activate ${user.name}? This will restore their access to the system and all associated permissions.`}
        confirmButtonText="Activate User"
        cancelButtonText="Cancel"
      >
        <div className="flex items-center justify-between p-3 border border-border-secondary rounded-lg">
          <div className="flex flex-col gap-1 flex-1">
            <span className="text-md font-semibold text-text-primary capitalize">
              {user.name}
            </span>
            <span className="text-xs text-text-secondary">
              {user.email}
            </span>
            <span className="text-xs text-text-secondary capitalize">
              {user.jobTitle}
            </span>
          </div>
          <div className="px-3 py-1.5 bg-purple-100 rounded-full">
            <span className="text-[13px] font-medium text-purple-600">
              {user.roleCategory}
            </span>
          </div>
        </div>
      </ApprovalConfirmationModal>

      <DeleteConfirmationModal
        isOpen={isDeactivateModalOpen}
        onClose={() => setIsDeactivateModalOpen(false)}
        onConfirm={handleDeactivate}
        title="Deactivate User"
        description={`Are you sure you want to deactivate ${user.name}? They will lose access to the system.`}
        warningMessage="This user will no longer be able to log in or access any system resources. You can reactivate them later if needed."
        confirmButtonText="Deactivate User"
        cancelButtonText="Cancel"
        itemDetails={{
          name: user.name,
          email: user.email,
          subtitle: user.jobTitle,
          role: user.roleCategory
        }}
        variant="warning"
      />

      <DeleteConfirmationModal
        isOpen={isArchiveModalOpen}
        onClose={() => setIsArchiveModalOpen(false)}
        onConfirm={handleArchiveConfirm}
        title="Archive User"
        description={`Are you sure you want to archive ${user.name}? They will lose access to the system and be moved to the Archived tab.`}
        warningMessage="You can unarchive them later to restore access."
        confirmButtonText="Archive User"
        cancelButtonText="Cancel"
        itemDetails={{
          name: user.name,
          email: user.email,
          subtitle: user.jobTitle,
          role: user.roleCategory
        }}
        variant="danger"
      />

      <ApprovalConfirmationModal
        isOpen={isUnarchiveModalOpen}
        onClose={() => setIsUnarchiveModalOpen(false)}
        onConfirm={handleUnarchiveConfirm}
        title="Unarchive User"
        description={`Are you sure you want to unarchive ${user.name}? This will restore their access to the system.`}
        confirmButtonText="Unarchive User"
        cancelButtonText="Cancel"
      >
        <div className="flex items-center justify-between p-3 border border-border-secondary rounded-lg">
          <div className="flex flex-col gap-1 flex-1">
            <span className="text-md font-semibold text-text-primary capitalize">
              {user.name}
            </span>
            <span className="text-xs text-text-secondary">
              {user.email}
            </span>
          </div>
        </div>
      </ApprovalConfirmationModal>

    </>
  );
};

export default UserListItem;