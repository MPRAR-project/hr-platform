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

  // If we are still checking, and NOT a super admin, show a loader to prevent dashboard and sensitive content flash
  if (state.checking && !isSuperAdmin && !isAllowedPath) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-bg-secondary w-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mb-4"></div>
        <p className="text-text-secondary animate-pulse text-sm font-medium">Verifying access...</p>
      </div>
    );
  }

  // Redirect based on final status
  if (!isSuperAdmin && state.expired && !isAllowedPath) {
    return <Navigate to="/subscription-expired" replace />;
  }

  return children;
};

export default SubscriptionGuard;

