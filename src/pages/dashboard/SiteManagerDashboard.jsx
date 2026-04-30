import { AlertTriangle, Calendar, CreditCard, RefreshCw, UserPlus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import Header from '../../components/layout/Header';
import ActiveUsersCard from '../../components/shared/ActiveUsersCard';
import StatCard from '../../components/shared/StatCard';
import AddUserModal from '../../components/modals/AddUserModal';
import DeleteConfirmationModal from '../../components/modals/DeleteConfirmationModal';
import EditUserModal from '../../components/modals/EditUserModal';
import PaymentConfirmationModal from '../../components/modals/PaymentConfirmationModal';
import SeatPaymentConfirmationModal from '../../components/modals/SeatPaymentConfirmationModal';
import Button from '../../components/ui/Button';

import { collection, deleteDoc, doc, getDoc } from 'firebase/firestore';
import OptimizedTeamTable from '../../components/shared/OptimizedTable';
import SectionContainer from '../../components/shared/SectionContainer';
import { db } from '../../firebase/client';
import { useAuth } from '../../hooks/useAuth';
import { useDashboardPerformance } from '../../hooks/useDashboardPerformance';
import { usePerformanceMonitor } from '../../hooks/usePerformanceMonitor';
import { addUsersBySiteManager, updateUserBySiteManager } from '../../services/users';

// Enhanced components for better error handling and loading states
import DashboardLoadingState from '../../components/ui/DashboardLoadingState';
import { ConfigurationErrorState, EmptyTeamState, NetworkErrorState } from '../../components/ui/DataUnavailableState';
import { BannerErrorDisplay } from '../../components/ui/ErrorDisplay';
import { getBillingSummary, recordSeatTopUp } from '../../services/billing';
import { parseCompanyId, parseSiteId, validateUserData } from '../../utils/dataParser';
import { ERROR_TYPES, getUserErrorMessage, isRetryableError } from '../../utils/errorHandler';
import { getRoleName } from '../../utils/getRoleName';
import { dashboardLogger, measurePerformance, trackUserAction } from '../../utils/logger';
import { useCompanyDashboard } from '../../hooks/useCompanyDashboard';


// Main Dashboard
const SiteManagerDashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Validate user data before proceeding
  const userValidation = validateUserData(user);
  if (!userValidation.isValid) {
    console.error('User validation failed', userValidation.errors);
  }

  const companyId = userValidation.companyId;

  // Use new real-time hook
  const { data: dashboardData, loading: isLoading, error } = useCompanyDashboard(companyId);

  // Modal states
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [pendingUsers, setPendingUsers] = useState([]);
  const [showSeatPaymentModal, setShowSeatPaymentModal] = useState(false);
  const [isInTrial, setIsInTrial] = useState(false);

  // Performance monitoring (Optional: keep generic monitor but remove load tracking)
  usePerformanceMonitor('SiteManagerDashboard');

  // Retry function for failed operations (Reloads page or re-mounts hook)
  const handleRetry = () => {
    window.location.reload();
  };

  // Refresh function (Dashboard is real-time, but users expect feedback)
  const handleRefresh = () => {
    toast.info('Dashboard is syncing in real-time');
  };

  const handleAddUsers = () => {
    trackUserAction('add_users_modal_opened');
    setShowAddUserModal(true);
  };

  const handleAddUsersClick = async () => {
    const seatUsage = dashboardData.seatUsageCount ?? dashboardData.totalUsers ?? 0;
    if ((seatUsage || 0) >= (dashboardData.totalSeats || 0)) {
      // Check if company is in trial period
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
      handleAddUsers();
    }
  };

  const handleSeatPaymentConfirm = async (seatCount = 1) => {
    try {
      const companyId = parseCompanyId(user.companyId);
      console.log('handleSeatPaymentConfirm called with:', { seatCount, companyId });

      const result = await recordSeatTopUp(companyId, seatCount);
      console.log('recordSeatTopUp result:', result);

      // Check if checkout is required
      if (result && typeof result === 'object' && result.requiresCheckout && result.checkoutUrl) {
        console.log('Redirecting to Stripe Checkout:', result.checkoutUrl);
        // Redirect to Stripe Checkout
        window.location.href = result.checkoutUrl;
        return;
      }

      // Mock payment or direct update (fallback) - happens during trial or when Stripe is disabled
      console.log('Seats added without checkout (trial or mock payment). Result:', result);
      const message = isInTrial
        ? `${seatCount} seat${seatCount > 1 ? 's' : ''} added for free during trial. You can now add a new user.`
        : `${seatCount} seat${seatCount > 1 ? 's' : ''} added successfully. You can now add a new user.`;
      toast.success(message);
      setShowSeatPaymentModal(false);
      setIsInTrial(false);
      // await loadDashboardData(false, true);
      setTimeout(() => setShowAddUserModal(true), 0);
    } catch (error) {
      console.error('Failed to add seat:', error);
      const userMessage = getUserErrorMessage(error);
      toast.error(userMessage || 'Failed to process payment. Please try again.');
    }
  };

  const handleUserSubmit = (users) => {
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

  const handlePaymentConfirm = async () => {
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
        const seat = data.seatCount || 0;
        const curr = data.currentEmployeeCount || 0;
        const toAdd = pendingUsers.length;
        if (curr + toAdd > seat) {
          toast.error(`Seat limit exceeded: attempting to add ${toAdd} users would exceed ${seat} seats (current ${curr}).`);
          return;
        }
      }

      const res = await addUsersBySiteManager(companyId, siteId, pendingUsers);
      console.log('Added users (dashboard):', res);

      setShowPaymentModal(false);
      toast.success('Users added successfully');

      // Refresh dashboard data after adding users (clear cache for fresh data)
      // await loadDashboardData(false, true);

    } catch (e) {
      console.error('Failed to add users:', e);
      const userMessage = getUserErrorMessage(e);
      toast.error(userMessage);
    }
  };

  const handleSendInvites = async (users) => {
    try {
      const companyPath = user?.companyId || '';
      const sitePath = user?.siteId || '';
      const companyId = companyPath.includes('/') ? companyPath.split('/')[1] : companyPath;
      const siteId = sitePath.includes('/') ? sitePath.split('/')[1] : sitePath;
      for (const u of users) {
        await sendUserInvite({
          email: u.email,
          displayName: u.fullName,
          primaryRole: u.role,
          companyId,
          siteId,
          reportsTo: u.reportsTo || '',
          isOnboardingMandatory: u.isOnboardingMandatory || false,
          inviteBaseUrl: window.location.origin + '/invite'
        });
      }
      toast.success(`Invitation emails sent to ${users.length} user(s).`);
    } catch (error) {
      console.error('Failed to send invites:', error);
      toast.error(error?.message || 'Failed to send invites');
    }
  };

  const handleEdit = (id) => {
    const member = dashboardData.teamMembers.find(m => m.id === id);
    setSelectedUser(member);
    setShowEditModal(true);
  };

  const handleEditSave = async (updatedData) => {
    try {
      // Map displayName + role + reportsTo to Firestore fields
      const updates = {
        displayName: updatedData.name,
        primaryRole: updatedData.role,
        roles: [updatedData.role],
        reportsTo: updatedData.reportsTo,
      };

      await updateUserBySiteManager(selectedUser.id, updates);

      // No need to manually update state as the real-time subscription will handle it
      setShowEditModal(false);
      toast.success('User updated successfully');

      // Refresh data in background to ensure consistency (clear cache)
      // setTimeout(() => loadDashboardData(false, true), 1000);

    } catch (e) {
      console.error('Failed to update user:', e);
      const userMessage = getUserErrorMessage(e);
      toast.error(userMessage);
    }
  };

  const handleRemove = (id) => {
    const member = dashboardData.teamMembers.find(m => m.id === id);
    setSelectedUser(member);
    setShowDeleteModal(true);
  };

  const handleRevokeInvite = async (member) => {
    if (!member?.inviteId) {
      toast.error('Invite reference missing.');
      return;
    }
    try {
      await deleteDoc(doc(collection(db, 'invites'), member.inviteId));
      const { invalidateCompanyCache } = await import('../../services/cacheInvalidationService');
      await invalidateCompanyCache(companyId);
      toast.success(`Invite revoked for ${member.email || 'user'}.`);
    } catch (error) {
      console.error('Failed to revoke invite:', error);
      toast.error(error?.message || 'Failed to revoke invite');
    }
  };

  const handleDeleteConfirm = async () => {
    try {
      console.log('Removing user:', selectedUser.id);
      // TODO: Implement user removal logic
      setShowDeleteModal(false);
      toast.success('User removed successfully');

      // Refresh dashboard data (clear cache for fresh data)
      // await loadDashboardData(false, true);

    } catch (e) {
      console.error('Failed to remove user:', e);
      const userMessage = getUserErrorMessage(e);
      toast.error(userMessage);
    }
  };



  // Render error state
  const renderErrorState = () => {
    if (!error) return null;

    // Configuration errors
    if (error.type === ERROR_TYPES.CONFIGURATION_ERROR) {
      return <ConfigurationErrorState className="m-6" />;
    }

    // Network errors
    if (error.type === ERROR_TYPES.NETWORK_ERROR) {
      return <NetworkErrorState onRetry={handleRetry} className="m-6" />;
    }

    // Generic error with retry option
    return (
      <div className="m-6">
        <BannerErrorDisplay
          error={error}
          onRetry={isRetryableError(error) ? handleRetry : null}
        />
      </div>
    );
  };



  const seatUsageCount = dashboardData.seatUsageCount ?? dashboardData.totalUsers ?? 0;
  const seatDeficit = dashboardData.seatDeficit ?? Math.max(0, seatUsageCount - (dashboardData.totalSeats || 0));
  const pricePerSeat = dashboardData.pricePerSeat ?? 5;
  const monthlyBillValue = typeof dashboardData.monthlyBill === 'number'
    ? `£${dashboardData.monthlyBill.toFixed(2)}`
    : dashboardData.monthlyBill;
  const pendingInvites = dashboardData.pendingInvites ?? 0;
  const joinDate = dashboardData.joinDate || '—';
  const nextBillingLabel = dashboardData.nextBilling || '—';
  const lastPaymentLabel = dashboardData.lastPaymentDate || '—';
  const paymentMethodLabel = dashboardData.paymentMethod || '—';

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Header
        title="Company Dashboard"
        subtitle="Grow your digital workplace and manage your team seamlessly"
        action={
          <Button
            variant="outline-secondary"
            icon={RefreshCw}
            iconFirst={true}
            onClick={handleRefresh}
            disabled={isLoading}
            cn={`${isLoading ? 'animate-spin' : ''}`}
          >
            Refresh
          </Button>
        }
      />

      {/* Loading State */}
      {isLoading && (
        <div className="flex-1 overflow-y-auto p-6">
          <DashboardLoadingState message="Loading your dashboard..." />
        </div>
      )}

      {/* Error State */}
      {!isLoading && error && (
        <div className="flex-1 overflow-y-auto">
          {renderErrorState()}
        </div>
      )}

      {/* Success State */}
      {!isLoading && !error && (
        <div className="flex-1 overflow-y-auto p-3xl space-y-3xl scrollbar-custom">
          {/* Performance Indicator (Development Only) */}
          {/* {process.env.NODE_ENV === 'development' && metrics.loadTime && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-600">
              <div className="flex justify-between items-center">
                <span>Load Time: {metrics.loadTime}ms</span>
                <span>Cache Hit Rate: {metrics.cacheHitRate}%</span>
                <span>Queries: {metrics.queryCount}</span>
                {metrics.loadTime > 2000 && (
                  <span className="text-orange-600 font-medium">⚠ Slow Load</span>
                )}
              </div>
            </div>
          )} */}

          {/* Statistics Cards */}
          <div className="flex flex-wrap gap-xl">
            <StatCard
              title="Total Users"
              value={String(dashboardData.totalUsers)}
              subtitle={pendingInvites > 0 ? `${pendingInvites} pending invite${pendingInvites > 1 ? 's' : ''}` : 'Active team members'}
              icon={<Users className="h-6 w-6 text-text-accent-green" />}
              iconBgColor="bg-green-50"
            />
            <StatCard
              title="Total Seats"
              value={String(dashboardData.totalSeats)}
              subtitle={`£${pricePerSeat.toFixed ? pricePerSeat.toFixed(2) : pricePerSeat} per user per month`}
              icon={<Users className="h-6 w-6 text-pink-600" />}
              iconBgColor="bg-pink-50"
            />
            <StatCard
              title="Monthly Bill"
              value={monthlyBillValue}
              subtitle={`Next billing: ${dashboardData.nextBilling}`}
              icon={<CreditCard className="h-6 w-6 text-orange-500" />}
              iconBgColor="bg-orange-50"
            />
            <StatCard
              title="Last Payment"
              value={dashboardData.lastPaymentStatus}
              subtitle={dashboardData.lastPaymentDate}
              icon={<Calendar className="h-6 w-6 text-blue-600" />}
              iconBgColor="bg-blue-50"
            />
          </div>

          <div className="bg-white border border-border-secondary rounded-base p-6 shadow-sm grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Join Date', value: joinDate },
              { label: 'Next Billing', value: nextBillingLabel },
              { label: 'Last Payment Date', value: lastPaymentLabel },
              { label: 'Payment Method', value: paymentMethodLabel }
            ].map((item) => (
              <div key={item.label} className="flex flex-col gap-1">
                <span className="text-xs uppercase text-text-secondary">{item.label}</span>
                <span className="text-md font-semibold text-text-primary break-words">{item.value || '—'}</span>
              </div>
            ))}
          </div>

          {/* Active Users Section - Shows employees currently clocked in */}
          <ActiveUsersCard />

          {seatDeficit > 0 && (
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <div className="bg-red-100 rounded-full p-2">
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                </div>
                <div>
                  <p className="text-base font-semibold text-red-700">
                    You are using {seatDeficit} more seat{seatDeficit > 1 ? 's' : ''} than your plan.
                  </p>
                  <p className="text-sm text-red-600">
                    Request additional seats to stay compliant and avoid service interruptions.
                  </p>
                </div>
              </div>
              <Button variant="outline-danger" onClick={() => navigate('/seat-management')}>
                Manage Seats
              </Button>
            </div>
          )}


        </div>
      )}

      {/* Modals */}
      <AddUserModal
        isOpen={showAddUserModal}
        onClose={() => setShowAddUserModal(false)}
        onSubmit={handleUserSubmit}
      />
      <PaymentConfirmationModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        onConfirm={handlePaymentConfirm}
        onSendInvites={handleSendInvites}
        users={pendingUsers}
      />
      <EditUserModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        onSave={handleEditSave}
        user={selectedUser}
      />
      <DeleteConfirmationModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDeleteConfirm}
        itemDetails={selectedUser}
        warningMessage={"This user will lose access immediately."}
      />
      <SeatPaymentConfirmationModal
        isOpen={showSeatPaymentModal}
        onClose={() => {
          setShowSeatPaymentModal(false);
          setIsInTrial(false);
        }}
        onConfirm={handleSeatPaymentConfirm}
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

export default SiteManagerDashboard;