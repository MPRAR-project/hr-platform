import React, { useEffect, useMemo, useState, useRef } from 'react';

import { useNavigate } from 'react-router-dom';
import Header from '../../components/layout/Header';
import Button from '../../components/ui/Button';
import UserGroup from '../../components/shared/UserGroup';
import AddUserModal from '../../components/modals/AddUserModal';
import PaymentConfirmationModal from '../../components/modals/PaymentConfirmationModal';
import EditUserModal from '../../components/modals/EditUserModal';
import DeleteConfirmationModal from '../../components/modals/DeleteConfirmationModal';
import { UserPlus, RefreshCw } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { usePaginatedUsers } from '../../hooks/usePaginatedUsers';
import { addUsersBySiteManager, updateUserBySiteManager, subscribeToCompanyUsers, deleteUser } from '../../services/users';
import { getClients } from '../../services/clients';
import { getSites } from '../../services/sites';
import { doc, getDoc, deleteDoc, collection, getCountFromServer, query, where } from 'firebase/firestore';
import { db } from '../../firebase/client';
import { usePerformanceMonitor, measureAsync } from '../../hooks/usePerformanceMonitor';
import { LoadingSkeleton } from '../../components/ui/LoadingSkeleton';
import { toast } from 'react-toastify';
import { revokeUserInvite } from '../../services/invitations';
import OnboardingManagementPage from '../onboarding/OnboardingManagementPage';

// Additional imports for Team Management
import OptimizedTeamTable from '../../components/shared/OptimizedTable';
import SectionContainer from '../../components/shared/SectionContainer';
import SeatPaymentConfirmationModal from '../../components/modals/SeatPaymentConfirmationModal';

import { validateUserData, parseCompanyId, parseSiteId } from '../../utils/dataParser';
import { ERROR_TYPES, getUserErrorMessage, isRetryableError } from '../../utils/errorHandler';
import { BannerErrorDisplay } from '../../components/ui/ErrorDisplay';
import DashboardLoadingState from '../../components/ui/DashboardLoadingState';
import { ConfigurationErrorState, NetworkErrorState, EmptyTeamState } from '../../components/ui/DataUnavailableState';
import { getBillingSummary, recordSeatTopUp } from '../../services/billing';
import { trackUserAction, dashboardLogger } from '../../utils/logger';
import { invalidateCompanyCache } from '../../services/cacheInvalidationService';
import { useCache } from '../../contexts/CacheContext';
import { useCompanyDashboard } from '../../hooks/useCompanyDashboard';

// Removed duplicate normalizeRoleKey definition

const normalizeRoleKeyValue = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const getCanonicalRole = (value) => {
  const normalized = normalizeRoleKeyValue(value);
  switch (normalized) {
    case 'sitemanager': return 'siteManager';
    case 'teammanager': return 'teamManager';
    case 'seniormanager': return 'seniorManager';
    case 'adminmanager': return 'adminManager';
    case 'hrmanager': return 'hrManager';
    case 'adminadvisor': return 'adminAdvisor';
    case 'hradvisor': return 'hrAdvisor';
    case 'contractmanager': return 'contractManager';
    case 'superuser': return 'superUser';
    case 'owner': return 'owner';
    default: return 'employee';
  }
};

const roleToJobTitle = (role) => {
  switch (getCanonicalRole(role)) {
    case 'siteManager': return 'Site Manager';
    case 'teamManager': return 'Team Manager';
    case 'seniorManager': return 'Senior Manager';
    case 'adminManager': return 'Admin Manager';
    case 'hrManager': return 'HR Manager';
    case 'adminAdvisor': return 'Admin Advisor';
    case 'hrAdvisor': return 'HR Advisor';
    case 'contractManager': return 'Contract Manager';
    case 'superUser': return 'Super User';
    case 'owner': return 'Owner';
    case 'employee':
    default: return 'Employee';
  }
};
const roleToCategory = (role) => ['siteManager', 'teamManager', 'seniorManager', 'adminManager', 'hrManager'].includes(getCanonicalRole(role)) ? 'Manager' : 'Employee';

const ROLES_CAN_VIEW_USER_DETAILS = ['siteManager', 'seniorManager', 'teamManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor'];

const UserListPage = () => {
  const { user, refreshClaims } = useAuth();
  const navigate = useNavigate();
  const { getItem, setItem, clearItem } = useCache();
  const companyId = parseCompanyId(user?.companyId);

  const [activeTab, setActiveTab] = useState('users'); // 'users' or 'team_management'

  const { data: dashboardData, loading: isDashboardLoading, error: dashboardError } = useCompanyDashboard(
    activeTab === 'team_management' ? companyId : null
  );

  // --- Existing UserListPage State ---
  const [groupedUsers, setGroupedUsers] = useState([]);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [pendingUsers, setPendingUsers] = useState([]);
  const [inviteToDelete, setInviteToDelete] = useState(null);
  const [isInviteDeleteModalOpen, setIsInviteDeleteModalOpen] = useState(false);
  const [isProcessingInviteDelete, setIsProcessingInviteDelete] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Client and Site Filters
  const [clients, setClients] = useState([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [sites, setSites] = useState([]);
  const [selectedSiteId, setSelectedSiteId] = useState('');

  // View State: 'active' or 'archived'
  const [viewMode, setViewMode] = useState('active'); // 'active' | 'archived'

  const [totalUsersCount, setTotalUsersCount] = useState(null);
  const [countRefreshTrigger, setCountRefreshTrigger] = useState(0);

  // --- Team Management State (from SiteManagerDashboard) ---
  const [showSeatPaymentModal, setShowSeatPaymentModal] = useState(false);
  const [isInTrial, setIsInTrial] = useState(false);
  const [unarchivingUserId, setUnarchivingUserId] = useState(null);

  // --- Pagination Hook ---
  const {
    users: paginatedUsers,
    loadMore,
    hasMore,
    loading: isPaginatedLoading,
    error: paginatedError,
    reload: reloadPaginated
  } = usePaginatedUsers(activeTab === 'users' ? companyId : null, 20);

  // Helper: identify Site Owner / Site Manager style roles
  const normalizeRoleKey = (value) =>
    String(value || '')
      .toLowerCase()
      .replace(/[\s_-]+/g, '');

  const SITE_OWNER_ROLE_KEYS = new Set(['superuser', 'siteowner', 'sitemanager', 'owner']);

  const isSiteOwnerOrManager = (rawRole) => SITE_OWNER_ROLE_KEYS.has(normalizeRoleKey(rawRole));

  // Normalize data for OptimizedTeamTable and filter by viewMode, site, client, and HR Advisor visibility rules
  const flatUserList = useMemo(() => {
    let normalized = paginatedUsers.map(u => ({
      id: u.id,
      name: u.displayName || u.email,
      email: u.email,
      role: roleToJobTitle(u.primaryRole || u.role), // Map camelCase to Title Case
      status: u.status, // 'Active', 'Archived', etc.
      profileImage: u.profileImage,
      isInvited: u.sourceType === 'invite',
      inviteId: u.inviteId,
      ...u
    }));

    // Filter out the current user and any system owners
    const currentUserId = user?.userId || user?.uid || user?.id;
    const currentUserEmail = user?.email?.toLowerCase();
    normalized = normalized.filter(u => 
      u.id !== currentUserId && 
      u.userId !== currentUserId &&
      u.email?.toLowerCase() !== currentUserEmail &&
      u.centralRole !== 'owner'
    );

    // HR Advisors must not see Site Owner / Site Manager users
    if (user?.role === 'hrAdvisor') {
      normalized = normalized.filter((u) => !isSiteOwnerOrManager(u.primaryRole || u.role));
    }

    // Filter by selected site
    if (selectedSiteId) {
      console.log('[DEBUG] Filtering by site:', selectedSiteId);
      console.log('[DEBUG] Users before site filter:', normalized.map(u => ({ id: u.id, name: u.name, siteId: u.siteId })));

      normalized = normalized.filter(u => {
        const userSiteId = u.siteId?.includes('/') ? u.siteId.split('/')[1] : u.siteId;
        const matches = userSiteId === selectedSiteId;
        if (!matches && u.siteId) {
          console.log('[DEBUG] User filtered out by site:', { id: u.id, name: u.name, userSiteId, selectedSiteId });
        }
        return matches;
      });

      console.log('[DEBUG] Users after site filter:', normalized.length);
    }

    // Filter by selected client
    if (selectedClientId) {
      console.log('[DEBUG] Filtering by client:', selectedClientId);
      console.log('[DEBUG] Users before client filter:', normalized.map(u => ({ id: u.id, name: u.name, clientId: u.clientId })));

      normalized = normalized.filter(u => {
        const userClientId = u.clientId?.includes('/') ? u.clientId.split('/')[1] : u.clientId;
        const matches = userClientId === selectedClientId;
        if (!matches && u.clientId) {
          console.log('[DEBUG] User filtered out:', { id: u.id, name: u.name, userClientId, selectedClientId });
        }
        return matches;
      });

      console.log('[DEBUG] Users after client filter:', normalized.length);
    }

    // Filter by viewMode (active vs archived)
    if (viewMode === 'archived') {
      return normalized.filter(u => {
        const status = (u.status || '').toLowerCase();
        return status === 'archived';
      });
    } else {
      // Active view: show all non-archived users
      return normalized.filter(u => {
        const status = (u.status || '').toLowerCase();
        return status !== 'archived';
      });
    }
  }, [paginatedUsers, viewMode, user?.role, selectedSiteId, selectedClientId]);



  // Performance monitoring
  usePerformanceMonitor('UserListPage');

  // --- Existing UserListPage Effects ---

  useEffect(() => {
    const fetchFilters = async () => {
      if (!companyId) return;
      try {
        const [clientsData, sitesData] = await Promise.all([
          getClients(companyId),
          getSites(companyId)
        ]);
        setClients(clientsData);
        setSites(sitesData);
      } catch (e) {
        console.error('Failed to load filters', e);
      }
    };
    fetchFilters();

    // Initial load for pagination
    if (activeTab === 'users') {
      loadMore();
    }
  }, [companyId, activeTab]);

  useEffect(() => {
    if (!companyId || activeTab !== 'users') {
      if (!companyId) setTotalUsersCount(null);
      return;
    }

    const cacheKey = `user_count_${companyId}`;
    const cached = getItem?.(cacheKey);
    if (cached != null && typeof cached === 'number') {
      setTotalUsersCount(cached);
      return;
    }

    let cancelled = false;
    const fetchTotalCount = async () => {
      try {
        const companyIdCandidates = [`companies/${companyId}`, companyId];
        const q = query(
          collection(db, 'users'),
          where('companyId', 'in', companyIdCandidates)
        );
        const snap = await getCountFromServer(q);
        const count = snap.data().count ?? 0;
        if (!cancelled) {
          setTotalUsersCount(count);
          setItem?.(cacheKey, count, 2 * 60 * 1000); // 2 min cache
        }
      } catch (e) {
        if (!cancelled) {
          console.error('Failed to count users', e);
          setTotalUsersCount(null);
        }
      }
    };

    fetchTotalCount();
    return () => { cancelled = true; };
  }, [companyId, activeTab, countRefreshTrigger]);



  // Reload pagination when User actions happen
  useEffect(() => {
    const handleReload = () => {
      if (companyId) clearItem?.(`user_count_${companyId}`);
      setCountRefreshTrigger((t) => t + 1);
      reloadPaginated();
    };
    window.addEventListener('users:reload', handleReload);
    return () => window.removeEventListener('users:reload', handleReload);
  }, [reloadPaginated]);

  // Track previous viewMode to prevent unnecessary reloads
  const prevViewModeRef = useRef(viewMode);
  const prevActiveTabRef = useRef(activeTab);
  const reloadTimeoutRef = useRef(null);

  // Reload pagination when viewMode changes (active vs archived)
  // Note: We only reload if activeTab changes, not for viewMode since filtering is client-side
  useEffect(() => {
    // Clear any pending reload
    if (reloadTimeoutRef.current) {
      clearTimeout(reloadTimeoutRef.current);
    }

    // Only reload if activeTab actually changed (switching between 'users' and 'team_management')
    const activeTabChanged = prevActiveTabRef.current !== activeTab;

    if (activeTabChanged && activeTab === 'users') {
      prevActiveTabRef.current = activeTab;
      // Debounce reload to prevent rapid-fire requests
      reloadTimeoutRef.current = setTimeout(() => {
        reloadPaginated();
        reloadTimeoutRef.current = null;
      }, 100);
    } else {
      // Update refs even if we don't reload
      prevViewModeRef.current = viewMode;
      prevActiveTabRef.current = activeTab;
    }

    return () => {
      if (reloadTimeoutRef.current) {
        clearTimeout(reloadTimeoutRef.current);
        reloadTimeoutRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]); // Only depend on activeTab, not viewMode (filtering is client-side)

  // --- Existing UserListPage Handlers ---

  const handleAddUser = () => setShowAddUserModal(true);

  const handleUserSubmitLocal = async (users) => {
    try {
      const sitePath = user?.siteId || '';
      const siteId = sitePath.split('/')[1];

      // pre-check seat availability
      const companyRef = doc(db, 'companies', companyId);
      const cSnap = await getDoc(companyRef);
      if (cSnap.exists()) {
        const data = cSnap.data();
        const seat = data.seatCount || 0;
        const curr = data.currentEmployeeCount || 0;
        const toAdd = users.length;
        if (curr + toAdd > seat) {
          alert(`Seat limit exceeded: attempting to add ${toAdd} users would exceed ${seat} seats (current ${curr}).`);
          return;
        }
      }

      const res = await addUsersBySiteManager(companyId, siteId, users);
      // try { :', res); } catch (_) { }
      setShowAddUserModal(false);
      // alert('Users added successfully');
    } catch (e) {
      console.error(e);
      alert(e.message || 'Failed to add users');
    }
  };

  const handlePaymentConfirmLocal = async () => {
    try {
      const sitePath = user?.siteId || '';
      const siteId = sitePath.split('/')[1];

      // pre-check seat limit to show friendly alert
      const companyRef = doc(db, 'companies', companyId);
      const cSnap = await getDoc(companyRef);
      if (cSnap.exists()) {
        const data = cSnap.data();
        const seat = data.seatCount || 0;
        const curr = data.currentEmployeeCount || 0;
        const toAdd = pendingUsers.length;
        if (curr + toAdd > seat) {
          alert(`Seat limit exceeded: attempting to add ${toAdd} users would exceed ${seat} seats (current ${curr}).`);
          return;
        }
      }

      const res = await addUsersBySiteManager(companyId, siteId, pendingUsers);
      try { } catch (_) { }
      setShowPaymentModal(false);
    } catch (e) {
      console.error(e);
      alert(e.message || 'Failed to add users');
    }
  };

  const handleEditLocal = (userToEdit) => {
    const roleKey = normalizeRoleKey(userToEdit?.primaryRole || userToEdit?.role);
    const userRoleKey = normalizeRoleKey(user?.primaryRole || user?.role);
    // Prevent editing Senior Manager profiles from the Users route unless Super User/Owner
    if (roleKey === 'seniormanager' && !['superuser', 'siteowner', 'sitemanager', 'owner'].includes(userRoleKey)) {
      toast.error('Senior Manager profile cannot be edited from this view.');
      return;
    }
    setSelectedUser(userToEdit);
    setShowEditModal(true);
  };

  const handleViewDetails = (member) => {
    const userId = member?.id ?? member?.userId;
    if (userId) {
      navigate('/userDetails', { state: { userId } });
    }
  };

  const handleEditSaveLocal = async (updatedData) => {
    try {
      const userId = updatedData?.userId ?? selectedUser?.id;
      if (!userId) {
        throw new Error('No user selected for update');
      }

      const { userId: _uid, ...dataToSave } = updatedData || {};
      const [firstName, ...lastNameParts] = (dataToSave.name || '').trim().split(' ');
      const lastName = lastNameParts.join(' ').trim();
      const normalizedRole = normalizeRoleKey(dataToSave.role);
      const updates = {
        displayName: dataToSave.name,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        primaryRole: normalizedRole,
        roles: [normalizedRole],
        reportsTo: dataToSave.reportsTo || '',
        managerUserId: dataToSave.reportsTo || ''
      };
      // [FIX] Pass companyId to ensure we update the correct company profile
      const effectiveCompanyId = companyId || user?.companyId;
      await updateUserBySiteManager(userId, updates, effectiveCompanyId);

      setShowEditModal(false);
      setSelectedUser(null);

      // No need to manually update state as the real-time subscription will handle it
    } catch (error) {
      console.error('Error updating user:', error);
      toast.error(error.message || 'Failed to update user');
    }
  };

  const handleDeactivate = (userOrMember) => {
    const u = typeof userOrMember === 'object' && userOrMember !== null
      ? userOrMember
      : flatUserList.find((x) => x.id === userOrMember);
    if (!u?.id) {
      toast.error('User not found.');
      return;
    }
    setSelectedUser(u);
    setShowDeleteModal(true);
  };

  const handleDeleteConfirmLocal = async () => {
    if (!selectedUser?.id) {
      toast.error('No user selected.');
      throw new Error('No user selected');
    }
    try {
      const { archiveUser } = await import('../../services/users');

      // [FIX] Pass companyId to ensure we archive from the correct company and update seats
      const effectiveCompanyId = companyId || user?.companyId || selectedUser.companyId;

      await archiveUser(selectedUser.id, effectiveCompanyId);

      setShowDeleteModal(false);
      toast.success(`${selectedUser.name || 'User'} has been deactivated/archived.`);

      // Trigger reload of user lists
      window.dispatchEvent(new CustomEvent('users:reload'));
    } catch (error) {
      console.error('Failed to deactivate user:', error);
      toast.error(error.message || 'Failed to deactivate user');
    }
  };

  const handleInviteDeleteRequest = (pendingUser) => {
    if (!pendingUser?.inviteId) {
      toast.error('Unable to reject invite: missing identifier.');
      return;
    }
    setInviteToDelete(pendingUser);
    setIsInviteDeleteModalOpen(true);
  };

  const handleInviteDeleteConfirm = async () => {
    if (!inviteToDelete?.inviteId || isProcessingInviteDelete) return;
    try {
      setIsProcessingInviteDelete(true);
      await revokeUserInvite(inviteToDelete.inviteId, {
        revokedBy: user?.uid || null,
        revokedByEmail: user?.email || null,
        reason: 'Invite rejected from users page'
      });
      toast.success(`Invitation for ${inviteToDelete.email || inviteToDelete.name} has been rejected.`);
      window.dispatchEvent(new CustomEvent('users:reload'));
    } catch (error) {
      console.error('Failed to revoke invite', error);
      toast.error(error?.message || 'Failed to reject invitation.');
    } finally {
      setIsProcessingInviteDelete(false);
      setInviteToDelete(null);
    }
  };

  const handleInviteModalClose = () => {
    setIsInviteDeleteModalOpen(false);
    setInviteToDelete(null);
  };

  const handleArchiveUser = async (user) => {

    try {

      const { archiveUser } = await import('../../services/users');

      // [FIX] Pass companyId to ensure we archive from the correct company and update seats
      const effectiveCompanyId = companyId || user.companyId;
      await archiveUser(user.id, effectiveCompanyId);

      toast.success(`${user.name} has been archived.`);

      window.dispatchEvent(new CustomEvent('users:reload'));
    } catch (error) {
      console.error('[UserListPage] Failed to archive user:', error);
      toast.error('Failed to archive user');
    }
  };

  const handleUnarchiveUser = async (userOrMember) => {
    const u = typeof userOrMember === 'object' && userOrMember !== null
      ? userOrMember
      : flatUserList.find((x) => x.id === userOrMember);
    if (!u?.id) {
      toast.error('User not found.');
      return;
    }
    setUnarchivingUserId(u.id);
    try {
      const { unarchiveUser } = await import('../../services/users');
      const effectiveCompanyId = companyId || user?.companyId || u.companyId;
      if (!effectiveCompanyId) {
        toast.error('Cannot determine company. Please refresh and try again.');
        return;
      }
      await unarchiveUser(u.id, effectiveCompanyId);
      toast.success(`${u.name || u.email} has been unarchived and is now Active.`);
      window.dispatchEvent(new CustomEvent('users:reload'));
    } catch (error) {
      console.error('Failed to unarchive user:', error);
      toast.error(error?.message || 'Failed to unarchive user');
    } finally {
      setUnarchivingUserId(null);
    }
  };

  // --- Team Management Handlers (from SiteManagerDashboard) ---

  const handleRetry = () => {
    window.location.reload();
  };

  const handleRefresh = async () => {
    if (!companyId) return;
    try {
      await invalidateCompanyCache(companyId);
      window.dispatchEvent(new CustomEvent('users:reload'));
      toast.success('Data synced with server');
    } catch (e) {
      toast.error('Failed to sync. Please try again.');
    }
  };

  const handleAddUsersTM = () => {
    trackUserAction('add_users_modal_opened');
    setShowAddUserModal(true);
  };

  const handleAddUsersClickTM = async () => {
    let seatUsage = dashboardData.seatUsageCount ?? dashboardData.totalUsers ?? 0;
    let totalSeats = dashboardData.totalSeats || 0;

    // Smart refresh: If limit reached, try refreshing claims first to see if they bought seats
    if (seatUsage >= totalSeats && refreshClaims) {
      try {
        const freshClaims = await refreshClaims();
        if (freshClaims && freshClaims.seat_count > totalSeats) {
          totalSeats = freshClaims.seat_count;
        }
      } catch (e) {
        console.warn('[UserListPage] Failed to refresh claims on add user click:', e);
      }
    }

    if (seatUsage >= totalSeats) {
      // Still exceeded, check for trial or show payment modal
      try {
        const companyId = parseCompanyId(user?.companyId);
        if (companyId) {
          const billingSummary = await getBillingSummary(companyId);
          setIsInTrial(billingSummary?.subscriptionStatus === 'trial' && !billingSummary?.isExpired);
        }
      } catch (error) {
        console.warn('Failed to check trial status:', error);
        setIsInTrial(false);
      }
      setShowSeatPaymentModal(true);
    } else {
      handleAddUsersTM();
    }
  };

  const handleSeatPaymentConfirmTM = async (seatCount = 1) => {
    try {
      const companyId = parseCompanyId(user.companyId);

      const result = await recordSeatTopUp(companyId, seatCount);

      // Check if checkout is required
      if (result && typeof result === 'object' && result.requiresCheckout && result.checkoutUrl) {
        // Redirect to Stripe Checkout
        window.location.href = result.checkoutUrl;
        return;
      }

      // Mock payment or direct update (fallback) - happens during trial or when Stripe is disabled
      const message = isInTrial
        ? `${seatCount} seat${seatCount > 1 ? 's' : ''} added for free during trial. You can now add a new user.`
        : `${seatCount} seat${seatCount > 1 ? 's' : ''} added successfully. You can now add a new user.`;
      toast.success(message);
      setShowSeatPaymentModal(false);
      setIsInTrial(false);
      setTimeout(() => setShowAddUserModal(true), 0);
    } catch (error) {
      console.error('Failed to add seat:', error);
      const userMessage = getUserErrorMessage(error);
      toast.error(userMessage || 'Failed to process payment. Please try again.');
    }
  };

  const handleUserSubmitTM = (users) => {
    trackUserAction('users_submitted_for_payment', {
      userCount: users.length,
      roles: users.map(u => u.role)
    });

    dashboardLogger.info('Users submitted for payment confirmation', {
      userCount: users.length,
      users: users.map(u => ({ email: u.email, role: u.role }))
    });

    // Stage users only; no success toast here
    setPendingUsers(users);
    setShowAddUserModal(false);
    setShowPaymentModal(true);
  };

  const handlePaymentConfirmTM = async () => {
    try {
      // Use enhanced parsing utilities
      const companyId = parseCompanyId(user.companyId);
      const siteId = parseSiteId(user.siteId);

      if (!companyId) {
        toast.error('Company configuration is invalid. Please contact your administrator.');
        return;
      }

      if (!siteId) {
        toast.error('Site configuration is invalid. Please contact your administrator.');
        return;
      }

      // seat availability check
      const companyRef = doc(db, 'companies', companyId);
      const cSnap = await getDoc(companyRef);
      if (cSnap.exists()) {
        const data = cSnap.data();
        
        // Use the most authoritative seat count (prefer claims/authedUser)
        const seat = Math.max(data.seatCount || 0, user?.seatCount || 0);
        const curr = data.currentEmployeeCount || 0;
        const toAdd = pendingUsers.length;
        if (curr + toAdd > seat) {
          toast.error(`Seat limit exceeded: attempting to add ${toAdd} users would exceed ${seat} seats (current ${curr}).`);
          return;
        }
      }

      const res = await addUsersBySiteManager(companyId, siteId, pendingUsers);

      setShowPaymentModal(false);
      toast.success('Users added successfully');

    } catch (e) {
      console.error('Failed to add users:', e);
      const userMessage = getUserErrorMessage(e);
      toast.error(userMessage);
    }
  };

  const handleEditTM = (memberOrId) => {
    const member = memberOrId && typeof memberOrId === 'object'
      ? memberOrId
      : dashboardData?.teamMembers?.find(m => m.id === memberOrId);
    if (member) {
      const roleKey = normalizeRoleKey(member.primaryRole || member.role);
      const userRoleKey = normalizeRoleKey(user?.primaryRole || user?.role);

      // Prevent editing Senior Manager profiles from the Team Management view
      // HR Managers, Team Managers, and lower roles cannot edit Senior Managers
      if (roleKey === 'seniormanager' &&
        !['superuser', 'siteowner', 'sitemanager', 'owner'].includes(userRoleKey)) {
        toast.error('Senior Manager profile cannot be edited from this view.');
        return;
      }
      setSelectedUser(member);
      setShowEditModal(true);
    }
  };

  const handleEditSaveTM = async (updatedData) => {
    try {
      const userId = updatedData?.userId ?? selectedUser?.id;
      if (!userId) {
        throw new Error('No user selected for update');
      }
      const normalizedRole = normalizeRoleKey(updatedData.role);
      const updates = {
        displayName: updatedData.name,
        primaryRole: normalizedRole,
        roles: [normalizedRole],
        reportsTo: updatedData.reportsTo,
        managerUserId: updatedData.reportsTo || ''
      };

      await updateUserBySiteManager(userId, updates, companyId);

      // No need to manually update state as the real-time subscription will handle it
      setShowEditModal(false);
      setSelectedUser(null);

    } catch (e) {
      console.error('Failed to update user:', e);
      const userMessage = getUserErrorMessage(e);
      toast.error(userMessage);
    }
  };

  const handleRemoveTM = (member) => {
    if (!member?.id) {
      toast.error('User not found.');
      return;
    }
    setSelectedUser(member);
    setShowDeleteModal(true);
  };

  const handleRevokeInviteTM = async (member) => {
    if (!member?.inviteId) {
      toast.error('Invite reference missing.');
      return;
    }
    try {
      await deleteDoc(doc(collection(db, 'invites'), member.inviteId));
      toast.success(`Invite revoked for ${member.email || 'user'}.`);
    } catch (error) {
      console.error('Failed to revoke invite:', error);
      toast.error(error?.message || 'Failed to revoke invite');
    }
  };

  const handleDeleteConfirmTM = async () => {
    if (!selectedUser?.id) {
      toast.error('No user selected.');
      throw new Error('No user selected');
    }
    try {
      const { archiveUser } = await import('../../services/users');

      // Pass companyId to ensure we archive from the correct company and update seats
      // companyId is available in component scope
      const effectiveCompanyId = companyId || user?.companyId || selectedUser.companyId;

      await archiveUser(selectedUser.id, effectiveCompanyId);

      setShowDeleteModal(false);
      toast.success('User removed successfully');

    } catch (e) {
      console.error('Failed to remove user:', e);
      const userMessage = getUserErrorMessage(e);
      toast.error(userMessage);
    }
  };

  const handleActivateTM = async (member) => {
    const userId = typeof member === 'object' && member?.id != null ? member.id : member;
    if (!userId) {
      toast.error('User not found.');
      return;
    }
    setUnarchivingUserId(userId);
    try {
      const { unarchiveUser } = await import('../../services/users');
      const effectiveCompanyId = companyId || user?.companyId || (typeof member === 'object' ? member.companyId : null);
      if (!effectiveCompanyId) {
        toast.error('Cannot determine company. Please refresh and try again.');
        return;
      }
      await unarchiveUser(userId, effectiveCompanyId);
      toast.success('User activated successfully');
    } catch (e) {
      console.error('Failed to activate user:', e);
      toast.error(e?.message || 'Failed to activate user');
    } finally {
      setUnarchivingUserId(null);
    }
  };

  const handleDeleteForeverTM = async (id) => {
    if (!window.confirm('Are you sure you want to permanently delete this user? This action cannot be undone.')) return;
    try {
      const { deleteUser } = await import('../../services/users');
      await deleteUser(id);

      toast.success('User permanently deleted');
    } catch (e) {
      console.error('Failed to delete user:', e);
      toast.error('Failed to delete user');
    }
  };

  // Render error state for TM
  const renderErrorStateTM = () => {
    if (!dashboardError) return null;
    if (dashboardError.type === ERROR_TYPES.CONFIGURATION_ERROR) return <ConfigurationErrorState className="m-6" />;
    if (dashboardError.type === ERROR_TYPES.NETWORK_ERROR) return <NetworkErrorState onRetry={handleRetry} className="m-6" />;
    return <div className="m-6"><BannerErrorDisplay error={dashboardError} onRetry={isRetryableError(dashboardError) ? handleRetry : null} /></div>;
  };

  // Render empty state for TM
  const renderTeamContentTM = () => {
    if (dashboardData.teamMembers.length === 0 && dashboardData.hasData) {
      return <EmptyTeamState onAddUsers={handleAddUsersTM} />;
    }
    const currentUserId = user?.userId || user?.uid || user?.id;
    const currentUserEmail = user?.email?.toLowerCase();
    const isHighLevelAdmin = ['owner', 'siteManager', 'superUser', 'site_manager'].includes(user?.role);
    
    const filteredTeamMembers = dashboardData.teamMembers.filter(m => {
      const isMe = m.id === currentUserId || m.userId === currentUserId || m.email?.toLowerCase() === currentUserEmail;
      if (isMe) return false;
      
      const memberRole = (m.roleKey || '').toLowerCase();
      const isMemberAdmin = ['owner', 'sitemanager', 'site_manager', 'superuser', 'seniormanager'].includes(memberRole);
      
      // HR Managers and lower roles should not see Site Managers/Owners/Senior Managers in their team list
      if (isMemberAdmin && !isHighLevelAdmin) return false;
      
      return true;
    });

    return (
      <>
        <OptimizedTeamTable
          teamMembers={filteredTeamMembers}
          onEdit={handleEditTM}
          onDeactivate={handleRemoveTM}
          onActivate={handleActivateTM}
          onDeleteForever={handleDeleteForeverTM}
          onRevokeInvite={handleRevokeInviteTM}
          activatingUserId={unarchivingUserId}
          currentUserRole={user?.role}
        />
        <p className="text-xs py-4 text-text-secondary text-center md:hidden">
          ← Scroll horizontally to view all columns →
        </p>
      </>
    );
  };

  const pretty = (role = '') =>
    role.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());

  const showUsersSkeleton = activeTab === 'users' && isPaginatedLoading && flatUserList.length === 0;

  return (
    <div className="h-screen flex flex-col overflow-hidden">

      <Header
        title={`${pretty(user?.role)} Dashboard`}
        subtitle="Ensure compliance and manage onboarding from one place."
      />

      <div className="flex-1 overflow-y-auto p-4 md:p-3xl scrollbar-custom">
        {/* Top Tabs: Users vs Team Management */}
        {(user?.role === 'siteManager' || ['seniorManager', 'teamManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor'].includes(user?.role)) && (
          <div className="flex items-center space-x-1 mb-6 border-b border-gray-200">
            <button
              onClick={() => setActiveTab('users')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'users'
                ? 'border-purple-600 text-purple-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              Users
            </button>
            {(user?.role === 'siteManager' || ['seniorManager', 'teamManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor'].includes(user?.role)) && (
              <button
                onClick={() => setActiveTab('team_management')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'team_management'
                  ? 'border-purple-600 text-purple-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
              >
                Team Management
              </button>
            )}

            {/* {['siteManager', 'seniorManager', 'teamManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor'].includes(user?.role) && (
              <button
                onClick={() => setActiveTab('onboarding')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'onboarding'
                  ? 'border-purple-600 text-purple-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
              >
                Onboarding
              </button>
            )} */}
          </div>
        )}

        {paginatedError && (
          <div className="bg-red-50 text-red-600 p-4 rounded-lg mb-4">
            Error loading users: {paginatedError.message}.
            {paginatedError.message?.includes('index') && ' This usually means a Firestore index is missing.'}
          </div>
        )}

        {activeTab === 'users' && (
          <>
            {/* Page Header - always visible for skeleton-first */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4xl">
              <div className="flex flex-col">
                <h2 className="text-2xl font-bold text-text-primary">Users</h2>
              </div>
              <div className="flex gap-2 items-center">
                <div className="relative w-48">
                  <select
                    value={selectedSiteId}
                    onChange={(e) => {
                      console.log('[DEBUG] Site dropdown changed to:', e.target.value);
                      setSelectedSiteId(e.target.value);
                    }}
                    aria-label="Filter by Site"
                    className="w-full h-10 px-3 border border-border-secondary rounded-lg text-sm bg-white focus:outline-none focus:border-purple-500"
                  >
                    <option value="">All Sites</option>
                    {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="relative w-48">
                  <select
                    value={selectedClientId}
                    onChange={(e) => {
                      console.log('[DEBUG] Client dropdown changed to:', e.target.value);
                      setSelectedClientId(e.target.value);
                    }}
                    aria-label="Filter by Client"
                    className="w-full h-10 px-3 border border-border-secondary rounded-lg text-sm bg-white focus:outline-none focus:border-purple-500"
                  >
                    <option value="">All Clients</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* View Tabs */}
            <div className="flex items-center justify-between mb-6 border-b border-gray-200">
              <div className="flex items-center space-x-1">
                <button
                  onClick={() => setViewMode('active')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${viewMode === 'active'
                    ? 'border-purple-600 text-purple-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                >
                  Active Employees
                </button>
                <button
                  onClick={() => setViewMode('archived')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${viewMode === 'archived'
                    ? 'border-purple-600 text-purple-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                >
                  Archived Employees
                </button>
              </div>
            </div>

            {/* User Groups List - skeleton inside content when loading and empty */}
            <div className="space-y-md">
              {showUsersSkeleton ? (
                <div className="bg-white rounded-lg shadow border border-border-secondary overflow-hidden">
                  <div className="p-4 border-b border-gray-100">
                    <div className="flex gap-4">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <LoadingSkeleton key={i} height="h-4" width="w-24" className="flex-1" />
                      ))}
                    </div>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                      <div key={i} className="flex items-center gap-4 p-4 animate-pulse">
                        <LoadingSkeleton height="h-10" width="w-10" className="rounded-full flex-shrink-0" />
                        <div className="flex-1 space-y-2">
                          <LoadingSkeleton height="h-4" width="w-40" />
                          <LoadingSkeleton height="h-3" width="w-56" />
                        </div>
                        <LoadingSkeleton height="h-6" width="w-20" className="rounded-full" />
                        <LoadingSkeleton height="h-8" width="w-16" />
                      </div>
                    ))}
                  </div>
                </div>
              ) : flatUserList.length === 0 && !isPaginatedLoading ? (
                <div className="text-center p-8 text-gray-500">
                  {viewMode === 'active' ? 'No active users found.' : 'No archived users found.'}
                </div>
              ) : (
                <>
                  <div className="bg-white rounded-lg shadow border border-border-secondary overflow-hidden">
                    <OptimizedTeamTable
                      teamMembers={flatUserList}
                      onEdit={handleEditLocal}
                      onDeactivate={handleDeactivate}
                      onActivate={handleUnarchiveUser}
                      onDeleteForever={handleDeleteForeverTM}
                      onRevokeInvite={handleInviteDeleteRequest}
                      onViewDetails={ROLES_CAN_VIEW_USER_DETAILS.includes(user?.role) ? handleViewDetails : undefined}
                      activatingUserId={unarchivingUserId}
                      currentUserRole={user?.role}
                    />

                    {hasMore && (
                      <div className="p-4 flex justify-center border-t border-gray-100">
                        <Button
                          variant="outline-primary"
                          onClick={() => loadMore()}
                          isLoading={isPaginatedLoading}
                        >
                          {isPaginatedLoading ? 'Loading more users...' : 'Load More Users'}
                        </Button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {activeTab === 'team_management' && (user?.role === 'siteManager' || ['seniorManager', 'teamManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor'].includes(user?.role)) && (
          <>
            {isDashboardLoading && <DashboardLoadingState message="Loading Team Management..." />}
            {!isDashboardLoading && dashboardError && renderErrorStateTM()}
            {!isDashboardLoading && !dashboardError && (
              <SectionContainer
                title="Team Management"
                subtitle="Manage your team, roles, and subscriptions seamlessly."
                action={
                  <Button
                    variant="gradient"
                    icon={UserPlus}
                    iconFirst={true}
                    onClick={handleAddUsersClickTM}
                  >
                    Add Users
                  </Button>
                }
              >
                {renderTeamContentTM()}
              </SectionContainer>
            )}
          </>
        )}

        {activeTab === 'onboarding' && ['siteManager', 'seniorManager', 'teamManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor'].includes(user?.role) && (
          <OnboardingManagementPage isEmbedded={true} />
        )}
      </div>

      {/* Modals - Shared or separate based on handler logic */}
      {/* Reusing existing modals with conditional props where possible, but mapping ensures correct handlers */}

      {/* Add User Modal */}
      <AddUserModal
        isOpen={showAddUserModal}
        onClose={() => setShowAddUserModal(false)}
        onSubmit={activeTab === 'users' ? handleUserSubmitLocal : handleUserSubmitTM}
      />

      {/* Payment Confirmation */}
      <PaymentConfirmationModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        onConfirm={activeTab === 'users' ? handlePaymentConfirmLocal : handlePaymentConfirmTM}
        users={pendingUsers}
      />

      {/* Edit User Modal */}
      <EditUserModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        onSave={activeTab === 'users' ? handleEditSaveLocal : handleEditSaveTM}
        user={selectedUser}
      />

      {/* Delete/Deactivate Modal */}
      <DeleteConfirmationModal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setSelectedUser(null);
        }}
        onConfirm={activeTab === 'users' ? handleDeleteConfirmLocal : handleDeleteConfirmTM}
        user={selectedUser} // Fallback for legacy
        itemDetails={selectedUser} // For TM Modal support if distinct
        title="Deactivate User"
        description="Are you sure you want to deactivate this team member's access?"
        warningMessage="This user will lose access immediately."
        confirmButtonText="Deactivate"
      />

      <DeleteConfirmationModal
        isOpen={isInviteDeleteModalOpen}
        onClose={handleInviteModalClose}
        onConfirm={handleInviteDeleteConfirm}
        title="Reject Invitation"
        description={`Are you sure you want to reject the invitation for ${inviteToDelete?.name || inviteToDelete?.email || 'this user'}?`}
        warningMessage="The invited user will no longer be able to create an account and will see a rejection message when attempting to sign in."
        confirmButtonText="Reject Invite"
      />

      <SeatPaymentConfirmationModal
        isOpen={showSeatPaymentModal}
        onClose={() => {
          setShowSeatPaymentModal(false);
          setIsInTrial(false);
        }}
        onConfirm={handleSeatPaymentConfirmTM}
        user={{
          fullName: 'Additional Seat',
          email: user?.email || 'accounts@company.com',
          role: 'Seat Upgrade'
        }}
        isTrial={isInTrial}
      />

    </div>
  );
};

export default UserListPage;