import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import Header from '../../components/layout/Header';
import CompanyInformation from './components/CompanyInformation';
import QuickStats from './components/QuickStats';
import UserManagementPanel from './components/UserManagementPanel';
import { fetchCompanyDetails } from '../../services/companyService';
import { useCache } from '../../contexts/CacheContext';
import { LoadingSkeleton } from '../../components/ui/LoadingSkeleton';

const CompanyDetailsPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { getItem, setItem } = useCache();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const companyIdFromState = location.state?.companyId;
  const companyIdFromQuery = searchParams.get('id');
  const companyId = companyIdFromState || companyIdFromQuery;
  const rawCompanyId = companyId ? companyId.replace(/^companies\//, '') : null;

  const [companyData, setCompanyData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Use a ref to track current data — lets us read it inside callbacks without
  // adding it to dependency arrays (which would cause infinite re-fetch loops).
  const companyDataRef = React.useRef(null);
  const setCompanyDataSafe = (data) => {
    companyDataRef.current = data;
    setCompanyData(data);
  };

  const isMounted = React.useRef(true);
  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  const loadCompanyData = React.useCallback(async (forceRefresh = false) => {
    if (!companyId || !rawCompanyId) {
      if (isMounted.current) {
        setIsLoading(false);
        setError(new Error('No company selected. Please navigate from the companies list.'));
      }
      return;
    }

    const cacheKey = `company_${rawCompanyId}`;
    const cached = !forceRefresh ? getItem?.(cacheKey) : null;

    // Show cached data immediately while fetching fresh in background
    if (cached && isMounted.current) {
      setCompanyDataSafe(cached);
      setIsLoading(false);
      setError(null);
    }

    // Show loader only on first load (no cached data)
    if (!cached && isMounted.current) {
      setIsLoading(true);
      setError(null);
    }

    try {
      const data = await fetchCompanyDetails(rawCompanyId);

      // If user navigated away while loading, discard result
      if (!isMounted.current) return;

      const TTL = 2 * 60 * 1000; // 2 minutes — short TTL so DB changes reflect quickly
      setItem?.(cacheKey, data, TTL);
      setCompanyDataSafe(data);
    } catch (err) {
      console.error('[CompanyDetailsPage] Failed to load company data:', err);
      if (!isMounted.current) return;

      // Only show error if we have no fallback data to display
      if (!companyDataRef.current) {
        setError(err);
        toast.error(
          err?.message?.includes('timed out')
            ? 'Connection timed out — please try again.'
            : err?.message || 'Failed to load company details'
        );
      }
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
    // ⚠️ Do NOT add companyData here — it would cause an infinite re-fetch loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, rawCompanyId, getItem, setItem]);

  useEffect(() => {
    loadCompanyData();
  }, [loadCompanyData]);

  const handleArchiveUser = async (user) => {
    if (!user?.id) return;
    if (!window.confirm(`Are you sure you want to archive ${user.name}?`)) return;

    try {
      const { archiveUser } = await import('../../services/users');
      // Pass companyId to ensure correct profile is archived and seat count updated
      await archiveUser(user.id, companyId);
      toast.success(`${user.name} has been archived.`);
      loadCompanyData();
    } catch (error) {
      console.error('Failed to archive user:', error);
      toast.error('Failed to archive user');
    }
  };

  const handleUnarchiveUser = async (user) => {
    if (!user?.id) return;
    try {
      const { unarchiveUser } = await import('../../services/users');
      // Pass companyId
      await unarchiveUser(user.id, companyId);
      toast.success(`${user.name} has been unarchived.`);
      loadCompanyData();
    } catch (error) {
      console.error('Failed to unarchive user:', error);
      toast.error('Failed to unarchive user');
    }
  };

  const handleInviteDelete = async (user) => {
    const inviteId = user.inviteId || user.id.replace('invite-', '');
    if (!inviteId) return;

    if (!window.confirm(`Are you sure you want to revoke the invite for ${user.email || user.name}?`)) return;

    try {
      // Import from users service which contains revokeUserInvite
      const { revokeUserInvite } = await import('../../services/users');
      await revokeUserInvite(inviteId);
      toast.success('Invite revoked successfully');
      loadCompanyData();
    } catch (error) {
      console.error('Failed to revoke invite:', error);
      toast.error('Failed to revoke invite');
    }
  };

  const pageTitle = companyData?.company?.name || 'Company details';
  const pageSubtitle = companyId
    ? 'Company Details & Management'
    : 'Select a company from the dashboard to view details';

  return (
    <>
      <Header
        title={pageTitle}
        subtitle={pageSubtitle}
        backButton
        onBack={() => navigate(-1)}
      />
      <div className="sm:px-3xl py-3xl space-y-3xl">
        {isLoading && !companyData && (
          <div className="bg-white sm:px-7 px-4 py-5 border-1 shadow-lg rounded-sm flex flex-wrap lg:flex-nowrap gap-xl">
            <div className="flex-1 min-w-[200px] space-y-3">
              <LoadingSkeleton height="h-6" width="w-48" />
              <LoadingSkeleton height="h-4" width="w-full" />
              <LoadingSkeleton height="h-4" width="w-3/4" />
            </div>
            <div className="flex flex-wrap gap-4">
              {[1, 2, 3].map((i) => (
                <LoadingSkeleton key={i} height="h-20" width="w-32" className="rounded-lg" />
              ))}
            </div>
          </div>
        )}

        {!isLoading && error && (
          <div className="bg-red-50 border border-red-200 rounded-base p-4 text-red-700 text-sm">
            {error.message || 'Failed to load company data.'}
          </div>
        )}

        {!isLoading && !error && companyData && (
          <>
            <div className="bg-white sm:px-7 px-4 py-5 border-1 shadow-lg rounded-sm flex flex-wrap lg:flex-nowrap gap-xl">
              <CompanyInformation company={companyData.company} />
              <QuickStats stats={companyData.stats} />
            </div>

            <UserManagementPanel
              groups={companyData.userGroups}
              subscriptionHistory={companyData.subscriptionHistory}
              onArchive={handleArchiveUser}
              onUnarchive={handleUnarchiveUser}
              onInviteDelete={handleInviteDelete}
            />
          </>
        )}
      </div>
    </>
  );
};

export default CompanyDetailsPage;
