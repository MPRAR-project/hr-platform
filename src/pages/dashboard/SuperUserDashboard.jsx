import React, { useEffect, useState, useCallback } from 'react';
import { toast } from 'react-toastify';
import Header from '../../components/layout/Header';
import StatCard from '../../components/shared/StatCard';
import DashboardLoadingState from '../../components/ui/DashboardLoadingState';
import CompanyListContainer from '../../components/shared/CompanyListContainer';
import { Building2, Users, CircleDollarSign } from 'lucide-react';
import { fetchPlatformOverview, getCachedPlatformOverview, DEFAULT_STATS, subscribeToPlatformOverview } from '../../services/platformDashboardService';
import { fetchCompanyDetails } from '../../services/companyService';
import { useCache } from '../../contexts/CacheContext';
import eventBus from '../../services/EventBus';

const defaultOverview = {
  stats: DEFAULT_STATS,
  companies: []
};

const COMPANY_DETAIL_TTL = 2 * 60 * 1000; // 2 minutes — keeps data fresh, DB changes reflect quickly

const SuperUserDashboard = () => {
  // Sync initialization from persistent cache — show immediately, no wait
  const [overview, setOverview] = useState(() => getCachedPlatformOverview() || defaultOverview);
  const [isLoading, setIsLoading] = useState(!getCachedPlatformOverview());
  const [error, setError] = useState(null);
  const { setItem, getItem } = useCache();

  /**
   * Pre-warm the company details cache in the background.
   * Prioritize first 5 (visible) companies so they load instantly when clicked.
   */
  const prewarmCompanyCache = useCallback(async (companies) => {
    if (!companies || companies.length === 0) return;

    const CONCURRENCY = 5;
    const ids = companies.map(c => c.id).filter(Boolean);

    const fetchOne = async (id) => {
      const cacheKey = `company_${id}`;
      if (getItem(cacheKey)) return;
      try {
        const data = await fetchCompanyDetails(id);
        setItem(cacheKey, data, COMPANY_DETAIL_TTL);
      } catch {
        // Silently ignore — pre-warming is best-effort only
      }
    };

    // Prefetch first 5 visible companies immediately (user often clicks these first)
    const priorityIds = ids.slice(0, CONCURRENCY);
    await Promise.allSettled(priorityIds.map(fetchOne));

    // Then the rest in batches
    for (let i = CONCURRENCY; i < ids.length; i += CONCURRENCY) {
      const batch = ids.slice(i, i + CONCURRENCY).map(fetchOne);
      await Promise.allSettled(batch);
      if (i + CONCURRENCY < ids.length) {
        await new Promise(r => setTimeout(r, 300));
      }
    }
  }, [getItem, setItem]);

  const loadOverview = useCallback(async (isInitial = false, forceRefresh = false) => {
    try {
      if (isInitial && !overview.companies.length) {
        setIsLoading(true);
      }
      setError(null);
      const data = await fetchPlatformOverview({ skipCache: forceRefresh });
      if (data) setOverview(data);

      // After dashboard is ready, silently pre-warm all company detail pages
      if (data?.companies?.length) {
        setTimeout(() => prewarmCompanyCache(data.companies), 800);
      }
    } catch (err) {
      console.error('[SuperUserDashboard] Failed to load platform overview:', err);
      setError(err);
      toast.error(err?.message || 'Failed to load platform overview');
    } finally {
      setIsLoading(false);
    }
  }, [overview.companies.length, prewarmCompanyCache]);

  useEffect(() => {
    // 1. Initial load (fast cache or fetch)
    loadOverview(true);

    // 2. Real-time subscription (handles future changes + server sync)
    // This solves the 'deleting not updating' issue by keeping a live listener
    const unsubscribe = subscribeToPlatformOverview((freshData) => {
      console.log('[SuperUserDashboard] Real-time update received');
      setOverview(freshData);
      setIsLoading(false);
    });

    // 3. SWR Listener: If background refresh (triggered manually) finds new data
    const unsubEvent = eventBus.on('platform_cache_updated', (freshData) => {
      setOverview(freshData);
    }, 'SuperUserDashboard');

    return () => {
      unsubscribe();
      unsubEvent();
    };
  }, [loadOverview]);

  // Listen for company status changes (explicit refresh = bypass cache)
  useEffect(() => {
    const handleRefresh = () => loadOverview(false, true);
    window.addEventListener('companies:refresh', handleRefresh);
    return () => window.removeEventListener('companies:refresh', handleRefresh);
  }, [loadOverview]);

  const stats = overview?.stats || DEFAULT_STATS;
  const totalCompaniesValue = isLoading ? '—' : String(stats.totalCompanies);
  const totalCompaniesSubtitle = isLoading
    ? 'Loading companies...'
    : `${stats.activeCompanies} active, ${stats.inactiveCompanies} inactive`;

  const totalUsersValue = isLoading ? '—' : String(stats.totalUsers);
  const monthlyRevenueValue = isLoading ? '—' : stats.monthlyRevenueDisplay;
  const companies = overview.companies; // Always show — even during background refresh

  return (
    <div>
      <Header
        title="All companies"
        subtitle="Comprehensive view of all platform companies."
      />
      <div className="sm:p-3xl p-4 space-y-3xl overflow-y-auto">
        {isLoading && (
          <DashboardLoadingState
            showTeamTable={false}
            message="Loading platform overview..."
          />
        )}

        {/* Stats Section */}
        <div className="flex flex-wrap gap-xl">
          <StatCard
            title="Total Companies"
            value={totalCompaniesValue}
            subtitle={totalCompaniesSubtitle}
            icon={<Building2 className="h-6 w-6 text-text-accent-purple" />}
            iconBgColor="bg-purple-50"
          />
          <StatCard
            title="Total Users"
            value={totalUsersValue}
            subtitle="Across all companies"
            icon={<Users className="h-6 w-6 text-text-accent-green" />}
            iconBgColor="bg-green-50"
          />
          <StatCard
            title="Monthly Revenue"
            value={monthlyRevenueValue}
            subtitle="Estimated from active seats"
            icon={<CircleDollarSign className="h-6 w-6 text-orange-500" />}
            iconBgColor="bg-orange-50"
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-base p-3 text-sm">
            Failed to load some platform data. Please try again later.
          </div>
        )}

        {/* Company List — show immediately, even while background refreshing */}
        {!isLoading && <CompanyListContainer companies={companies} />}

        {!isLoading && !error && companies.length === 0 && (
          <p className="text-sm text-text-secondary">
            No companies available to display yet.
          </p>
        )}
      </div>
    </div>
  );
};

export default SuperUserDashboard;