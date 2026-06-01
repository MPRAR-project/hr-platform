// Timesheet-specific caching service for improved performance
import dataCache, { DataCache } from './dataCache';
import { measureAsync } from '../hooks/usePerformanceMonitor';

// Specialized cache for timesheet data with enhanced TTL strategies
class TimesheetCache extends DataCache {
  constructor() {
    super();
    this.cache = new Map();
    this.ttl = 5 * 60 * 1000; // default fallback TTL
    this.timesheetTTL = 5 * 60 * 1000; // 5 minutes for active timesheet data
    this.historicalTTL = 15 * 60 * 1000; // 15 minutes for historical data
    this.weeklyTTL = 10 * 60 * 1000; // 10 minutes for weekly aggregations
  }

  // Delete key from cache safely
  deleteKey(key) {
    try {
      return this.cache.delete(key);
    } catch (error) {
      console.error('TimesheetCache.deleteKey: Failed to delete key:', error);
      return false;
    }
  }

  // Delete wrapper for backward compatibility
  delete(key) {
    return this.deleteKey(key);
  }

  // Clear all cache entries
  clear() {
    try {
      this.cache.clear();
      return true;
    } catch (error) {
      console.error('TimesheetCache.clear: Failed to clear cache:', error);
      return false;
    }
  }

  // Cache weekly timesheet data for a specific user and week
  setWeeklyData(userId, weekStart, data) {
    try {
      if (!userId || !weekStart || !data) {
        console.warn('TimesheetCache.setWeeklyData: Invalid parameters', { userId, weekStart, data });
        return false;
      }

      const key = `timesheets:user:${userId}:weekly:${weekStart}`;
      const isHistorical = this._isHistoricalWeek(weekStart);
      const ttl = isHistorical ? this.historicalTTL : this.timesheetTTL;
      
      return this._setWithCustomTTL(key, data, ttl);
    } catch (error) {
      console.error('TimesheetCache.setWeeklyData: Failed to cache weekly data:', error);
      return false;
    }
  }

  // Get cached weekly timesheet data
  getWeeklyData(userId, weekStart) {
    try {
      if (!userId || !weekStart) {
        console.warn('TimesheetCache.getWeeklyData: Invalid parameters', { userId, weekStart });
        return null;
      }

      const key = `timesheets:user:${userId}:weekly:${weekStart}`;
      return this.get(key);
    } catch (error) {
      console.error('TimesheetCache.getWeeklyData: Failed to retrieve weekly data:', error);
      return null;
    }
  }

  // Cache user's timesheet summaries
  setUserTimesheets(userId, timesheets, maxWeeks = 12) {
    try {
      if (!userId || !Array.isArray(timesheets)) {
        console.warn('TimesheetCache.setUserTimesheets: Invalid parameters', { userId, timesheets });
        return false;
      }

      const key = `timesheets:user:${userId}:summary:${maxWeeks}`;
      return this._setWithCustomTTL(key, timesheets, this.weeklyTTL);
    } catch (error) {
      console.error('TimesheetCache.setUserTimesheets: Failed to cache user timesheets:', error);
      return false;
    }
  }

  // Get cached user timesheet summaries
  getUserTimesheets(userId, maxWeeks = 12) {
    try {
      if (!userId) {
        console.warn('TimesheetCache.getUserTimesheets: Invalid userId:', userId);
        return null;
      }

      const key = `timesheets:user:${userId}:summary:${maxWeeks}`;
      return this.get(key);
    } catch (error) {
      console.error('TimesheetCache.getUserTimesheets: Failed to retrieve user timesheets:', error);
      return null;
    }
  }

  // Cache individual timesheet details
  setTimesheetDetails(timesheetId, details) {
    try {
      if (!timesheetId || !details) {
        console.warn('TimesheetCache.setTimesheetDetails: Invalid parameters', { timesheetId, details });
        return false;
      }

      const key = `timesheets:details:${timesheetId}`;
      return this._setWithCustomTTL(key, details, this.timesheetTTL);
    } catch (error) {
      console.error('TimesheetCache.setTimesheetDetails: Failed to cache timesheet details:', error);
      return false;
    }
  }

  // Get cached timesheet details
  getTimesheetDetails(timesheetId) {
    try {
      if (!timesheetId) {
        console.warn('TimesheetCache.getTimesheetDetails: Invalid timesheetId:', timesheetId);
        return null;
      }

      const key = `timesheets:details:${timesheetId}`;
      return this.get(key);
    } catch (error) {
      console.error('TimesheetCache.getTimesheetDetails: Failed to retrieve timesheet details:', error);
      return null;
    }
  }

  // Cache manager's pending approvals
  setManagerPendingApprovals(managerId, approvals) {
    try {
      if (!managerId || !Array.isArray(approvals)) {
        console.warn('TimesheetCache.setManagerPendingApprovals: Invalid parameters', { managerId, approvals });
        return false;
      }

      const key = `timesheets:manager:${managerId}:pending`;
      // Shorter TTL for pending approvals as they change frequently
      return this._setWithCustomTTL(key, approvals, 2 * 60 * 1000); // 2 minutes
    } catch (error) {
      console.error('TimesheetCache.setManagerPendingApprovals: Failed to cache pending approvals:', error);
      return false;
    }
  }

  // Get cached manager's pending approvals
  getManagerPendingApprovals(managerId) {
    try {
      if (!managerId) {
        console.warn('TimesheetCache.getManagerPendingApprovals: Invalid managerId:', managerId);
        return null;
      }

      const key = `timesheets:manager:${managerId}:pending`;
      return this.get(key);
    } catch (error) {
      console.error('TimesheetCache.getManagerPendingApprovals: Failed to retrieve pending approvals:', error);
      return null;
    }
  }

  // Cache team timesheet data for managers
  setTeamTimesheets(managerId, weekStart, teamData) {
    try {
      if (!managerId || !weekStart || !teamData) {
        console.warn('TimesheetCache.setTeamTimesheets: Invalid parameters', { managerId, weekStart, teamData });
        return false;
      }

      const key = `timesheets:manager:${managerId}:team:${weekStart}`;
      return this._setWithCustomTTL(key, teamData, this.weeklyTTL);
    } catch (error) {
      console.error('TimesheetCache.setTeamTimesheets: Failed to cache team timesheets:', error);
      return false;
    }
  }

  // Get cached team timesheet data
  getTeamTimesheets(managerId, weekStart) {
    try {
      if (!managerId || !weekStart) {
        console.warn('TimesheetCache.getTeamTimesheets: Invalid parameters', { managerId, weekStart });
        return null;
      }

      const key = `timesheets:manager:${managerId}:team:${weekStart}`;
      return this.get(key);
    } catch (error) {
      console.error('TimesheetCache.getTeamTimesheets: Failed to retrieve team timesheets:', error);
      return null;
    }
  }

  // Invalidate all cache data for a specific user
  invalidateUserData(userId) {
    try {
      if (!userId) {
        console.warn('TimesheetCache.invalidateUserData: Invalid userId:', userId);
        return false;
      }

      const keysToDelete = [];
      for (const key of this.cache.keys()) {
        if (key.includes(`user:${userId}`) || key.includes(`details:`) && this.get(key)?.userId === userId) {
          keysToDelete.push(key);
        }
      }

      let deletedCount = 0;
      for (const key of keysToDelete) {
        if (this.delete(key)) {
          deletedCount++;
        }
      }

      console.log(`TimesheetCache.invalidateUserData: Invalidated ${deletedCount} cache entries for user ${userId}`);
      return deletedCount > 0;
    } catch (error) {
      console.error('TimesheetCache.invalidateUserData: Failed to invalidate user data:', error);
      return false;
    }
  }

  // Invalidate cache for a specific week across all users
  invalidateWeekData(weekStart) {
    try {
      if (!weekStart) {
        console.warn('TimesheetCache.invalidateWeekData: Invalid weekStart:', weekStart);
        return false;
      }

      const keysToDelete = [];
      for (const key of this.cache.keys()) {
        if (key.includes(`:weekly:${weekStart}`) || key.includes(`:team:${weekStart}`)) {
          keysToDelete.push(key);
        }
      }

      let deletedCount = 0;
      for (const key of keysToDelete) {
        if (this.delete(key)) {
          deletedCount++;
        }
      }

      console.log(`TimesheetCache.invalidateWeekData: Invalidated ${deletedCount} cache entries for week ${weekStart}`);
      return deletedCount > 0;
    } catch (error) {
      console.error('TimesheetCache.invalidateWeekData: Failed to invalidate week data:', error);
      return false;
    }
  }

  // Prefetch timesheet data for a range of weeks
  async prefetchWeekRange(userId, startWeek, endWeek, fetchFunction) {
    try {
      if (!userId || !startWeek || !endWeek || !fetchFunction) {
        console.warn('TimesheetCache.prefetchWeekRange: Invalid parameters');
        return false;
      }

      const weeks = this._getWeeksBetween(startWeek, endWeek);
      const prefetchPromises = weeks
        .filter(week => !this.getWeeklyData(userId, week)) // Only prefetch missing data
        .map(week => 
          measureAsync(`prefetch-week-${week}`, async () => {
            const data = await fetchFunction(userId, week);
            if (data) {
              this.setWeeklyData(userId, week, data);
            }
            return data;
          })
        );

      const results = await Promise.allSettled(prefetchPromises);
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      
      console.log(`TimesheetCache.prefetchWeekRange: Prefetched ${successCount}/${prefetchPromises.length} weeks for user ${userId}`);
      return successCount > 0;
    } catch (error) {
      console.error('TimesheetCache.prefetchWeekRange: Failed to prefetch week range:', error);
      return false;
    }
  }

  // Get cache statistics specific to timesheet data
  getTimesheetCacheStats() {
    try {
      const allKeys = Array.from(this.cache.keys());
      const timesheetKeys = allKeys.filter(key => key.startsWith('timesheets:'));
      
      const stats = {
        totalKeys: allKeys.length,
        timesheetKeys: timesheetKeys.length,
        userSummaries: timesheetKeys.filter(key => key.includes(':summary:')).length,
        weeklyData: timesheetKeys.filter(key => key.includes(':weekly:')).length,
        timesheetDetails: timesheetKeys.filter(key => key.includes(':details:')).length,
        managerData: timesheetKeys.filter(key => key.includes(':manager:')).length,
        memoryUsage: this._estimateMemoryUsage(),
        ttlSettings: {
          timesheet: this.timesheetTTL,
          historical: this.historicalTTL,
          weekly: this.weeklyTTL
        }
      };

      return stats;
    } catch (error) {
      console.error('TimesheetCache.getTimesheetCacheStats: Failed to get stats:', error);
      return { error: error.message };
    }
  }

  // Private helper methods
  _setWithCustomTTL(key, data, ttl) {
    try {
      this.cache.set(key, {
        data,
        timestamp: Date.now(),
        ttl
      });
      return true;
    } catch (error) {
      console.error('TimesheetCache._setWithCustomTTL: Failed to set with custom TTL:', error);
      return false;
    }
  }

  _isHistoricalWeek(weekStart) {
    try {
      const weekDate = new Date(weekStart);
      const now = new Date();
      const twoWeeksAgo = new Date(now.getTime() - (14 * 24 * 60 * 60 * 1000));
      return weekDate < twoWeeksAgo;
    } catch (error) {
      console.error('TimesheetCache._isHistoricalWeek: Failed to check if historical:', error);
      return false;
    }
  }

  _getWeeksBetween(startWeek, endWeek) {
    try {
      const weeks = [];
      const start = new Date(startWeek);
      const end = new Date(endWeek);
      
      const current = new Date(start);
      while (current <= end) {
        weeks.push(current.toISOString().slice(0, 10));
        current.setDate(current.getDate() + 7);
      }
      
      return weeks;
    } catch (error) {
      console.error('TimesheetCache._getWeeksBetween: Failed to get weeks between:', error);
      return [];
    }
  }

  _estimateMemoryUsage() {
    try {
      let totalSize = 0;
      for (const [key, value] of this.cache.entries()) {
        totalSize += key.length * 2; // Approximate string size
        totalSize += JSON.stringify(value).length * 2; // Approximate object size
      }
      return Math.round(totalSize / 1024 / 1024 * 100) / 100; // MB with 2 decimal places
    } catch (error) {
      console.error('TimesheetCache._estimateMemoryUsage: Failed to estimate memory usage:', error);
      return 0;
    }
  }

  // Override get method to handle custom TTL
  get(key) {
    try {
      if (!key || typeof key !== 'string') {
        console.warn('TimesheetCache.get: Invalid cache key:', key);
        return null;
      }

      const cached = this.cache.get(key);
      if (!cached) {
        return null;
      }
      
      // Check if cache is expired using custom TTL if available
      const ttl = cached.ttl || this.ttl;
      if (Date.now() - cached.timestamp > ttl) {
        this.cache.delete(key);
        return null;
      }
      
      return cached.data;
    } catch (error) {
      console.error('TimesheetCache.get: Failed to retrieve cached data:', error);
      return null;
    }
  }
}

// Create and export singleton instance
const timesheetCache = new TimesheetCache();

// Export cache instance and utility functions
export default timesheetCache;

export {
  TimesheetCache,
  timesheetCache
};

// Export convenience functions for common operations
export const cacheWeeklyData = (userId, weekStart, data) => 
  timesheetCache.setWeeklyData(userId, weekStart, data);

export const getCachedWeeklyData = (userId, weekStart) => 
  timesheetCache.getWeeklyData(userId, weekStart);

export const cacheUserTimesheets = (userId, timesheets, maxWeeks) => 
  timesheetCache.setUserTimesheets(userId, timesheets, maxWeeks);

export const getCachedUserTimesheets = (userId, maxWeeks) => 
  timesheetCache.getUserTimesheets(userId, maxWeeks);

export const invalidateUserTimesheets = (userId) => 
  timesheetCache.invalidateUserData(userId);

export const getTimesheetCacheStats = () => 
  timesheetCache.getTimesheetCacheStats();

// Enhanced cache invalidation system for real-time updates
class TimesheetCacheInvalidator {
  constructor(cacheService) {
    this.cacheService = cacheService;
    this.debugMode = process.env.NODE_ENV === 'development';
  }

  /**
   * Invalidate caches for timesheet edits with precise targeting
   * @param {string} userId - User ID
   * @param {string} weekStart - Week start date
   * @param {Array} affectedDays - Optional array of specific days that were affected
   * @param {Object} options - Invalidation options
   */
  invalidateTimesheetEdits(userId, weekStart, affectedDays = null, options = {}) {
    const {
      cascade = true,
      immediate = true,
      scope = 'user'
    } = options;

    try {
      if (!userId || !weekStart) {
        console.warn('TimesheetCacheInvalidator: Invalid parameters', { userId, weekStart });
        return { success: false, deletedCount: 0 };
      }

      const weekStartStr = typeof weekStart === 'string' ? weekStart : formatISODate(weekStart);
      let deletedCount = 0;
      const deletedKeys = [];

      // 1. Clear specific week cache entries
      const weekCacheKeys = [
        `weekDetails:${userId}:${weekStartStr}`,
        `timesheets:user:${userId}:weekly:${weekStartStr}`,
        `fetchWeekDetailsForModal:${userId}:${weekStartStr}`
      ];

      weekCacheKeys.forEach(key => {
        if (this.cacheService.deleteKey(key)) {
          deletedCount++;
          deletedKeys.push(key);
        }
      });

      // 2. Clear user timesheet summaries (all variations)
      const userSummaryPatterns = [
        `timesheets:user:${userId}:summary:`,
        `timesheets:user:${userId}:details:`
      ];

      userSummaryPatterns.forEach(pattern => {
        for (const key of this.cacheService.cache.keys()) {
          if (key.startsWith(pattern)) {
            if (this.cacheService.deleteKey(key)) {
              deletedCount++;
              deletedKeys.push(key);
            }
          }
        }
      });

      // 3. Clear related data if cascade is enabled
      if (cascade) {
        const cascadeResult = this.invalidateRelatedData(userId, weekStartStr, options);
        deletedCount += cascadeResult.deletedCount;
        deletedKeys.push(...cascadeResult.deletedKeys);
      }

      // 4. Clear day-specific caches if affected days are specified
      if (affectedDays && Array.isArray(affectedDays)) {
        affectedDays.forEach(date => {
          const dayKeys = [
            `timesheet:day:${userId}:${date}`,
            `sessions:day:${userId}:${date}`
          ];

          dayKeys.forEach(key => {
            if (this.cacheService.deleteKey(key)) {
              deletedCount++;
              deletedKeys.push(key);
            }
          });
        });
      }

      if (this.debugMode) {
        console.log(`TimesheetCacheInvalidator: Cleared ${deletedCount} cache entries for user ${userId}, week ${weekStartStr}`, {
          deletedKeys,
          affectedDays,
          options
        });
      }

      return {
        success: true,
        deletedCount,
        deletedKeys,
        scope,
        cascade
      };

    } catch (error) {
      console.error('TimesheetCacheInvalidator: Failed to invalidate timesheet edits:', error);
      return {
        success: false,
        error: error.message,
        deletedCount: 0
      };
    }
  }

  /**
   * Invalidate related data (manager views, team summaries, etc.)
   * @param {string} userId - User ID
   * @param {string} weekStart - Week start date
   * @param {Object} options - Invalidation options
   */
  invalidateRelatedData(userId, weekStart, options = {}) {
    let deletedCount = 0;
    const deletedKeys = [];

    try {
      // Clear manager-related caches
      const managerPatterns = [
        `timesheets:manager:`,
        `timesheets:team:`
      ];

      managerPatterns.forEach(pattern => {
        for (const key of this.cacheService.cache.keys()) {
          if (key.startsWith(pattern) && (key.includes(userId) || key.includes(weekStart))) {
            if (this.cacheService.deleteKey(key)) {
              deletedCount++;
              deletedKeys.push(key);
            }
          }
        }
      });

      // Clear dashboard-related caches that might include this user's data
      const dashboardPatterns = [
        `dashboard:timesheet:`,
        `summary:weekly:`,
        `analytics:timesheet:`
      ];

      dashboardPatterns.forEach(pattern => {
        for (const key of this.cacheService.cache.keys()) {
          if (key.startsWith(pattern) && key.includes(weekStart)) {
            if (this.cacheService.deleteKey(key)) {
              deletedCount++;
              deletedKeys.push(key);
            }
          }
        }
      });

      return { deletedCount, deletedKeys };

    } catch (error) {
      console.error('TimesheetCacheInvalidator: Failed to invalidate related data:', error);
      return { deletedCount: 0, deletedKeys: [] };
    }
  }

  /**
   * Selective invalidation based on update scope
   * @param {string} scope - 'user', 'week', 'timesheet', 'global'
   * @param {Object} params - Parameters for the scope
   */
  invalidateByScope(scope, params = {}) {
    const { userId, weekStart, timesheetId } = params;

    switch (scope) {
      case 'user':
        return this.invalidateUserScope(userId);
      case 'week':
        return this.invalidateWeekScope(userId, weekStart);
      case 'timesheet':
        return this.invalidateTimesheetScope(timesheetId);
      case 'global':
        return this.invalidateGlobalScope();
      default:
        console.warn(`TimesheetCacheInvalidator: Unknown scope: ${scope}`);
        return { success: false, deletedCount: 0 };
    }
  }

  /**
   * Invalidate all caches for a specific user
   */
  invalidateUserScope(userId) {
    if (!userId) return { success: false, deletedCount: 0 };

    let deletedCount = 0;
    const deletedKeys = [];

    for (const key of this.cacheService.cache.keys()) {
      if (key.includes(`user:${userId}`) || key.includes(`:${userId}:`)) {
        if (this.cacheService.deleteKey(key)) {
          deletedCount++;
          deletedKeys.push(key);
        }
      }
    }

    return { success: true, deletedCount, deletedKeys, scope: 'user' };
  }

  /**
   * Invalidate all caches for a specific week across all users
   */
  invalidateWeekScope(userId, weekStart) {
    if (!weekStart) return { success: false, deletedCount: 0 };

    let deletedCount = 0;
    const deletedKeys = [];

    for (const key of this.cacheService.cache.keys()) {
      if (key.includes(weekStart) || key.includes(`:weekly:${weekStart}`) || key.includes(`:team:${weekStart}`)) {
        if (this.cacheService.deleteKey(key)) {
          deletedCount++;
          deletedKeys.push(key);
        }
      }
    }

    return { success: true, deletedCount, deletedKeys, scope: 'week' };
  }

  /**
   * Invalidate caches for a specific timesheet
   */
  invalidateTimesheetScope(timesheetId) {
    if (!timesheetId) return { success: false, deletedCount: 0 };

    let deletedCount = 0;
    const deletedKeys = [];

    for (const key of this.cacheService.cache.keys()) {
      if (key.includes(timesheetId)) {
        if (this.cacheService.deleteKey(key)) {
          deletedCount++;
          deletedKeys.push(key);
        }
      }
    }

    return { success: true, deletedCount, deletedKeys, scope: 'timesheet' };
  }

  /**
   * Clear all timesheet-related caches (nuclear option)
   */
  invalidateGlobalScope() {
    let deletedCount = 0;
    const deletedKeys = [];

    const timesheetPatterns = [
      'timesheets:',
      'timesheet:',
      'weekDetails:',
      'fetchWeekDetailsForModal:'
    ];

    for (const key of this.cacheService.cache.keys()) {
      if (timesheetPatterns.some(pattern => key.startsWith(pattern))) {
        if (this.cacheService.deleteKey(key)) {
          deletedCount++;
          deletedKeys.push(key);
        }
      }
    }

    return { success: true, deletedCount, deletedKeys, scope: 'global' };
  }

  /**
   * Get invalidation statistics
   */
  getInvalidationStats() {
    const allKeys = Array.from(this.cacheService.cache.keys());
    const timesheetKeys = allKeys.filter(key => 
      key.startsWith('timesheets:') || 
      key.startsWith('timesheet:') || 
      key.startsWith('weekDetails:')
    );

    return {
      totalKeys: allKeys.length,
      timesheetKeys: timesheetKeys.length,
      invalidationCandidates: timesheetKeys.length,
      cacheUtilization: timesheetKeys.length / allKeys.length
    };
  }
}

// Create invalidator instance
const cacheInvalidator = new TimesheetCacheInvalidator(timesheetCache);

// ENHANCEMENT: Specific cache invalidation for timesheet edits
export const invalidateTimesheetCache = (userId, weekStart, affectedDays = null, options = {}) => {
  return cacheInvalidator.invalidateTimesheetEdits(userId, weekStart, affectedDays, options);
};

// Export additional invalidation methods
export const invalidateCacheByScope = (scope, params) => {
  return cacheInvalidator.invalidateByScope(scope, params);
};

export const getInvalidationStats = () => {
  return cacheInvalidator.getInvalidationStats();
};

// Helper function to format date consistently
const formatISODate = (date) => {
  if (typeof date === 'string') return date;
  if (date instanceof Date) {
    return date.toISOString().slice(0, 10);
  }
  return new Date(date).toISOString().slice(0, 10);
};