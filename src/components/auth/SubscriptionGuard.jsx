import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { BILLING_EVENT_NAME, getBillingSummary } from '../../services/billing';

const ALLOWED_PATHS_WHILE_EXPIRED = ['/subscription-expired', '/manageSubscription', '/offlinePayment', '/billing'];

const SubscriptionGuard = ({ children }) => {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  const [state, setState] = useState({
    checking: true,
    expired: false,
    error: null
  });

  useEffect(() => {
    let isMounted = true;

    const fetchSummary = async () => {
      if (!user?.companyId) {
        if (isMounted) {
          setState({ checking: false, expired: false, error: null });
        }
        return;
      }

      if (isMounted) {
        setState((prev) => ({ ...prev, checking: true }));
      }

      try {
        const summary = await getBillingSummary(user.companyId);
        if (isMounted) {
          setState({
            checking: false,
            expired: summary?.isExpired ?? false,
            error: null
          });
        }
      } catch (error) {
        console.error('SubscriptionGuard: Failed to load billing summary', error);
        if (isMounted) {
          setState({
            checking: false,
            expired: false,
            error: error.message
          });
        }
      }
    };

    if (!isLoading && user) {
      fetchSummary();
    } else if (!user && !isLoading) {
      setState({ checking: false, expired: false, error: null });
    }

    const handleBillingEvent = () => {
      if (!isLoading && user) {
        fetchSummary();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener(BILLING_EVENT_NAME, handleBillingEvent);
    }

    return () => {
      isMounted = false;
      if (typeof window !== 'undefined') {
        window.removeEventListener(BILLING_EVENT_NAME, handleBillingEvent);
      }
    };
  }, [user, user?.companyId, isLoading]);

  // Only block on auth loading; let billing check run in background so app shell + page can show (faster on Vercel)
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Super Admins bypass all payment related restrictions
  const isSuperAdmin = ['superadmin', 'superAdmin', 'super_admin', 'superUser'].includes(user?.role);
  const path = location.pathname;
  const isAllowedPath = ALLOWED_PATHS_WHILE_EXPIRED.some((allowedPath) =>
    path.startsWith(allowedPath)
  );

  // If we are still checking, or a super admin, or on an allowed path, just show content
  if (isSuperAdmin || isAllowedPath) {
    return children;
  }

  return (
    <div className="relative w-full h-full">
      {/* Expiration Banner - Non-blocking overlay */}
      {!state.checking && state.expired && (
        <div className="bg-red-600 text-white px-4 py-2 text-center text-sm font-bold sticky top-0 z-[100] shadow-lg flex items-center justify-center gap-3 animate-in slide-in-from-top duration-300">
          <AlertCircle size={16} />
          <span>Your subscription has expired. Some features may be restricted until payment is processed.</span>
          <a href="/owner-billing" className="bg-white text-red-600 px-3 py-1 rounded-lg hover:bg-red-50 transition-colors ml-2">
            Manage Subscription
          </a>
        </div>
      )}
      
      {/* Show children even while checking (non-blocking) */}
      {children}
    </div>
  );
};

export default SubscriptionGuard;
