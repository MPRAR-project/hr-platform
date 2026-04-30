/**
 * Central cache invalidation service - ensures DB updates immediately invalidate cache
 * and trigger reactive display updates.
 *
 * Usage: Call invalidateCompanyCache(companyId) or invalidatePlatformCache()
 * after ANY Firestore write that affects cached data.
 */

import eventBus from './EventBus';

// Event constants for cache invalidation - components can listen to refetch
export const CACHE_EVENTS = {
  COMPANY_INVALIDATED: 'cache:company:invalidated',
  PLATFORM_INVALIDATED: 'cache:platform:invalidated',
  DOC_STATS_INVALIDATED: 'cache:doc-stats:invalidated'
};

/**
 * Invalidate all caches for a company when DB is updated.
 * Call this after: user updates, company updates, billing updates, invites, etc.
 * Also call when you know DB was changed outside the app (e.g. manual edit in console)
 * so the next read is from DB and UI can refetch.
 * @param {string} companyId - Company ID (with or without "companies/" prefix)
 */
export async function invalidateCompanyCache(companyId) {
  if (!companyId || typeof companyId !== 'string') return;

  const cleanId = String(companyId).replace(/^companies\//, '');

  try {
    const [{ clearCompanyCache, default: cache }, { userGroupingService }] = await Promise.all([
      import('./dataCache'),
      import('./userGroupingService')
    ]);

    clearCompanyCache(cleanId);
    userGroupingService.clearCache(cleanId);

    // Clear doc-stats for this company so they refetch
    const stats = cache.getStats?.();
    if (stats?.keys) {
      const prefix = `doc-stats-${cleanId}`;
      stats.keys.filter(k => k.startsWith(prefix)).forEach(k => cache.delete(k));
    }

    eventBus.emit(CACHE_EVENTS.COMPANY_INVALIDATED, { companyId: cleanId });

    if (process.env.NODE_ENV === 'development') {
      console.log('[cacheInvalidation] Company cache invalidated:', cleanId);
    }
  } catch (err) {
    console.warn('[cacheInvalidation] Failed to invalidate company cache:', err);
  }
}

/**
 * Invalidate platform/overview cache. Call after company-level changes
 * that affect the super-admin platform dashboard.
 */
export async function invalidatePlatformCache() {
  try {
    const { default: cache } = await import('./dataCache');
    cache.delete('platform-overview');
    eventBus.emit(CACHE_EVENTS.PLATFORM_INVALIDATED, {});
    if (process.env.NODE_ENV === 'development') {
      console.log('[cacheInvalidation] Platform cache invalidated');
    }
  } catch (err) {
    console.warn('[cacheInvalidation] Failed to invalidate platform cache:', err);
  }
}

/**
 * Invalidate document stats cache for a company/user.
 * Call after document upload/approval/etc.
 */
export async function invalidateDocStatsCache(companyId, userRole, userId) {
  if (!companyId) return;

  try {
    const { default: cache } = await import('./dataCache');
    const prefix = `doc-stats-${String(companyId).replace(/^companies\//, '')}`;
    // Clear all doc-stats keys for this company (pattern: doc-stats-{companyId}-*)
    const stats = cache.getStats?.();
    if (stats?.keys) {
      stats.keys.filter(k => k.startsWith(prefix)).forEach(k => cache.delete(k));
    }
    eventBus.emit(CACHE_EVENTS.DOC_STATS_INVALIDATED, { companyId, userRole, userId });
  } catch (err) {
    console.warn('[cacheInvalidation] Failed to invalidate doc stats cache:', err);
  }
}

/**
 * Invalidate all caches. Use when company context is unknown
 * (e.g. sign-out, bulk migration).
 */
export async function invalidateAllCache() {
  try {
    const [{ clearAllCache }, { userGroupingService }] = await Promise.all([
      import('./dataCache'),
      import('./userGroupingService')
    ]);

    clearAllCache();
    userGroupingService.clearAllCache();
    eventBus.emit(CACHE_EVENTS.COMPANY_INVALIDATED, { companyId: '*', all: true });

    if (process.env.NODE_ENV === 'development') {
      console.log('[cacheInvalidation] All cache invalidated');
    }
  } catch (err) {
    console.warn('[cacheInvalidation] Failed to invalidate all cache:', err);
  }
}
