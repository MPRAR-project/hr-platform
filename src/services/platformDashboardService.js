import hrApiClient from '../lib/hrApiClient';
import DataCache from './dataCache';

/**
 * Platform Dashboard Service (Phase 4 — REST Migration)
 * 
 * Aggregates statistics across all companies for SuperUsers.
 * Replaces Firestore logic with HR REST API calls.
 */

const GBP_FORMATTER = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0
});

const DEFAULT_STATS = {
  totalCompanies: 0,
  activeCompanies: 0,
  inactiveCompanies: 0,
  totalUsers: 0,
  totalSeats: 0,
  monthlyRevenue: 0,
  monthlyRevenueDisplay: GBP_FORMATTER.format(0)
};

const CACHE_KEY = 'platform-overview';

const formatCurrency = (value = 0) => {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  return GBP_FORMATTER.format(safeValue);
};

/**
 * Returns the cached platform overview data synchronously if available
 */
export function getCachedPlatformOverview() {
  try {
    return DataCache.get(CACHE_KEY);
  } catch (err) {
    return null;
  }
}

/**
 * Clears the platform overview cache
 */
export function clearPlatformCache() {
  try {
    DataCache.delete(CACHE_KEY);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Fetch platform overview data from the REST API
 */
export async function fetchPlatformOverview({ skipCache = false } = {}) {
  // 1. CACHE-FIRST: Return cached data if available
  if (!skipCache) {
    const cached = getCachedPlatformOverview();
    if (cached) return cached;
  }

  try {
    const { data } = await hrApiClient.get('/hr/platform/dashboard');
    
    // Normalize data to match existing UI expectation
    const result = {
      stats: {
        ...data.stats,
        monthlyRevenueDisplay: formatCurrency(data.stats.monthlyRevenue)
      },
      companies: (data.companies || []).map(c => ({
        ...c,
        revenue: formatCurrency(c.revenue),
        joinDate: c.createdAt ? new Date(c.createdAt).toISOString().slice(0, 10) : '—'
      })),
      lastUpdated: data.lastUpdated || new Date().toISOString()
    };

    // Save to cache
    DataCache.set(CACHE_KEY, result);
    return result;
  } catch (error) {
    console.error('[platformDashboardService] Failed to fetch platform overview:', error);
    throw error;
  }
}

/**
 * Subscribe to platform overview updates (Polling fallback until Phase 6 WebSocket)
 */
export function subscribeToPlatformOverview(callback) {
  const fetch = () => fetchPlatformOverview({ skipCache: true }).then(callback).catch(() => {});
  
  // Initial fetch
  fetch();
  
  // Polling every 60 seconds
  const interval = setInterval(fetch, 60000);
  
  return () => clearInterval(interval);
}

export { DEFAULT_STATS };
