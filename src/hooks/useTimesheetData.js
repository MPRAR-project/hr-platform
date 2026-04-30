// Unified timesheet data fetching hooks with caching and performance optimization
import { useState, useEffect, useCallback, useRef } from 'react';
import {
    fetchWeeklySummaries,
    fetchWeekDetails,
    fetchTimesheetsForUsers,
    fetchPendingApprovalsForManager,
    prefetchAdjacentWeeks,
    invalidateTimesheetCache,
    getUserWeekContext
} from '../services/timesheets';
import { usePerformanceMonitor, measureAsync } from './usePerformanceMonitor';
import { timesheetCache } from '../services/timesheetCache';
import { timesheetConsistency } from '../utils/timesheetConsistency';
import { timesheetDeduplication } from '../services/timesheetDeduplication';
import { DEFAULT_WEEK_START_DAY } from '../utils/weekStartUtils';

// Main hook for fetching user timesheet data with caching and error handling
export const useTimesheetData = (userId, options = {}) => {
    const { maxWeeks = 12, autoRefresh = false, prefetchAdjacent = true } = options;
    const { trackOperation } = usePerformanceMonitor('useTimesheetData');

    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [lastFetch, setLastFetch] = useState(null);
    const weekStartDayRef = useRef(DEFAULT_WEEK_START_DAY);

    const retryCountRef = useRef(0);
    const maxRetries = 3;

    const fetchData = useCallback(async (forceRefresh = false) => {
        if (!userId) {
            setError(new Error('User ID is required'));
            setLoading(false);
            return;
        }

        const startTime = Date.now();
        setLoading(true);
        setError(null);

        try {
            // Clear cache if force refresh is requested
            if (forceRefresh) {
                invalidateTimesheetCache(userId);
            }

            const result = await measureAsync(`useTimesheetData-fetch-${userId}`, async () => {
                const summaries = await fetchWeeklySummaries(userId, maxWeeks);
                
                // Skip expensive operations for initial load to improve performance
                if (!forceRefresh && summaries && summaries.length > 0) {
                    return summaries.map(summary => ({
                        ...summary,
                        isConsolidated: false,
                        duplicatesResolved: 0
                    }));
                }

                const { weekStartDay } = await getUserWeekContext(userId);
                weekStartDayRef.current = weekStartDay || DEFAULT_WEEK_START_DAY;

                // UNIFICATION: Filter out cross-week overlaps (legacy vs new config)
                const { unifyTimesheetList } = await import('../services/timesheetUnification');
                const unifiedSummaries = unifyTimesheetList(summaries, weekStartDayRef.current);

                // ENHANCEMENT: Add consistency checks and deduplication (only for force refresh)
                const enhancedSummaries = [];

                for (const summary of unifiedSummaries) {
                    try {
                        // Check for duplicates in this week
                        const weekStart = summary.start instanceof Date ?
                            summary.start.toISOString().slice(0, 10) :
                            summary.start;

                        const duplicates = await timesheetDeduplication.detectDuplicateEntries(userId, weekStart, {
                            weekStartDay: weekStartDayRef.current
                        });

                        // If duplicates found, get consistent data (which auto-resolves duplicates)
                        if (duplicates.hasDuplicates) {
                            console.log(`useTimesheetData: Duplicates detected for week ${weekStart}, getting consistent data`);
                            const consistentData = await timesheetConsistency.getConsistentWeeklyData(userId, weekStart, {
                                weekStartDay: weekStartDayRef.current
                            });

                            // Update summary with consistent data
                            enhancedSummaries.push({
                                ...summary,
                                totals: consistentData.weekTotals,
                                status: consistentData.weekStatus,
                                isConsolidated: true,
                                duplicatesResolved: duplicates.duplicateGroups.length
                            });
                        } else {
                            enhancedSummaries.push({
                                ...summary,
                                isConsolidated: false,
                                duplicatesResolved: 0
                            });
                        }
                    } catch (error) {
                        console.warn(`useTimesheetData: Failed to check consistency for week ${summary.weekKey}:`, error);
                        // Include original summary if consistency check fails
                        enhancedSummaries.push({
                            ...summary,
                            isConsolidated: false,
                            duplicatesResolved: 0,
                            consistencyError: error.message
                        });
                    }
                }

                return enhancedSummaries;
            });

            setData(result);
            setLastFetch(new Date());
            retryCountRef.current = 0;

            trackOperation('fetchTimesheetData', startTime);

            console.log(`useTimesheetData: Successfully fetched ${result.length} weeks for user ${userId}`);
        } catch (err) {
            console.error('useTimesheetData: Failed to fetch timesheet data:', err);

            // Implement retry logic with exponential backoff
            if (retryCountRef.current < maxRetries) {
                retryCountRef.current += 1;
                const delay = Math.min(1000 * Math.pow(2, retryCountRef.current - 1), 5000);

                console.log(`useTimesheetData: Retrying in ${delay}ms (attempt ${retryCountRef.current}/${maxRetries})`);

                setTimeout(() => {
                    fetchData(forceRefresh);
                }, delay);

                return;
            }

            setError(err);
        } finally {
            setLoading(false);
        }
    }, [userId, maxWeeks]);

    // Initial data fetch
    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Auto-refresh functionality
    useEffect(() => {
        if (!autoRefresh || !userId) return;

        const interval = setInterval(() => {
            // Only refresh if data is older than 5 minutes
            if (lastFetch && Date.now() - lastFetch.getTime() > 5 * 60 * 1000) {
                fetchData();
            }
        }, 60 * 1000); // Check every minute

        return () => clearInterval(interval);
    }, [autoRefresh, userId, lastFetch, fetchData]);

    // Prefetch adjacent weeks for better UX
    useEffect(() => {
        if (!prefetchAdjacent || !data || data.length === 0) return;

        const currentWeek = data[0]; // Most recent week
        if (currentWeek?.start) {
            prefetchAdjacentWeeks(userId, currentWeek.start, { weeksBefore: 2, weeksAfter: 2, weekStartDay: weekStartDayRef.current }).catch(err => {
                console.warn('useTimesheetData: Failed to prefetch adjacent weeks:', err);
            });
        }
    }, [prefetchAdjacent, userId, data]);

    const refresh = useCallback(() => {
        fetchData(true);
    }, [fetchData]);

    const invalidateCache = useCallback(() => {
        invalidateTimesheetCache(userId);
    }, [userId]);

    return {
        data,
        loading,
        error,
        lastFetch,
        refresh,
        invalidateCache,
        cacheStats: timesheetCache.getTimesheetCacheStats()
    };
};

// Hook for fetching week-specific timesheet data
export const useWeeklyTimesheets = (userId, weekStart, options = {}) => {
    const { prefetchAdjacent = true, autoRefresh = false } = options;
    const { trackOperation } = usePerformanceMonitor('useWeeklyTimesheets');

    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [lastFetch, setLastFetch] = useState(null);

    const retryCountRef = useRef(0);
    const maxRetries = 3;
    const weekStartDayRef = useRef(DEFAULT_WEEK_START_DAY);

    const fetchWeekData = useCallback(async (forceRefresh = false) => {
        if (!userId || !weekStart) {
            setError(new Error('User ID and week start are required'));
            setLoading(false);
            return;
        }

        const startTime = Date.now();
        setLoading(true);
        setError(null);

        try {
            // Clear cache if force refresh is requested
            if (forceRefresh) {
                timesheetCache.invalidateWeekData(weekStart);
            }

            const { weekStartDay } = await getUserWeekContext(userId);
            weekStartDayRef.current = weekStartDay || DEFAULT_WEEK_START_DAY;

            const result = await measureAsync(`useWeeklyTimesheets-fetch-${userId}-${weekStart}`, async () => {
                return await fetchWeekDetails(userId, weekStart, { weekStartDay: weekStartDayRef.current });
            });

            setData(result);
            setLastFetch(new Date());
            retryCountRef.current = 0;

            trackOperation('fetchWeekData', startTime);

            console.log(`useWeeklyTimesheets: Successfully fetched week ${weekStart} for user ${userId}`);
        } catch (err) {
            console.error('useWeeklyTimesheets: Failed to fetch week data:', err);

            // Implement retry logic
            if (retryCountRef.current < maxRetries) {
                retryCountRef.current += 1;
                const delay = Math.min(1000 * Math.pow(2, retryCountRef.current - 1), 5000);

                console.log(`useWeeklyTimesheets: Retrying in ${delay}ms (attempt ${retryCountRef.current}/${maxRetries})`);

                setTimeout(() => {
                    fetchWeekData(forceRefresh);
                }, delay);

                return;
            }

            setError(err);
        } finally {
            setLoading(false);
        }
    }, [userId, weekStart, trackOperation]);

    // Initial data fetch
    useEffect(() => {
        fetchWeekData();
    }, [fetchWeekData]);

    // Prefetch adjacent weeks
    useEffect(() => {
        if (!prefetchAdjacent || !userId || !weekStart) return;

        prefetchAdjacentWeeks(userId, weekStart, { weeksBefore: 1, weeksAfter: 1, weekStartDay: weekStartDayRef.current }).catch(err => {
            console.warn('useWeeklyTimesheets: Failed to prefetch adjacent weeks:', err);
        });
    }, [prefetchAdjacent, userId, weekStart]);

    // Auto-refresh functionality
    useEffect(() => {
        if (!autoRefresh || !userId || !weekStart) return;

        const interval = setInterval(() => {
            if (lastFetch && Date.now() - lastFetch.getTime() > 5 * 60 * 1000) {
                fetchWeekData();
            }
        }, 60 * 1000);

        return () => clearInterval(interval);
    }, [autoRefresh, userId, weekStart, lastFetch, fetchWeekData]);

    const refresh = useCallback(() => {
        fetchWeekData(true);
    }, [fetchWeekData]);

    const invalidateCache = useCallback(() => {
        timesheetCache.invalidateWeekData(weekStart);
    }, [weekStart]);

    return {
        data,
        loading,
        error,
        lastFetch,
        refresh,
        invalidateCache
    };
};

// Hook for manager views - batch fetch multiple users' timesheets
export const useManagerTimesheets = (managerId, userIds, options = {}) => {
    const { maxWeeks = 12, includeDetails = false, autoRefresh = false } = options;
    const { trackOperation } = usePerformanceMonitor('useManagerTimesheets');

    const [data, setData] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [lastFetch, setLastFetch] = useState(null);

    const retryCountRef = useRef(0);
    const maxRetries = 3;

    const fetchManagerData = useCallback(async (forceRefresh = false) => {
        if (!managerId || !Array.isArray(userIds) || userIds.length === 0) {
            setError(new Error('Manager ID and user IDs are required'));
            setLoading(false);
            return;
        }

        const startTime = Date.now();
        setLoading(true);
        setError(null);

        try {
            // Clear cache if force refresh is requested
            if (forceRefresh) {
                userIds.forEach(userId => invalidateTimesheetCache(userId));
                timesheetCache.delete(`timesheets:manager:${managerId}:pending`);
            }

            const result = await measureAsync(`useManagerTimesheets-fetch-${managerId}`, async () => {
                return await fetchTimesheetsForUsers(userIds, { maxWeeks, includeDetails });
            });

            setData(result);
            setLastFetch(new Date());
            retryCountRef.current = 0;

            trackOperation('fetchManagerData', startTime);

            console.log(`useManagerTimesheets: Successfully fetched data for ${Object.keys(result).length} users`);
        } catch (err) {
            console.error('useManagerTimesheets: Failed to fetch manager data:', err);

            // Implement retry logic
            if (retryCountRef.current < maxRetries) {
                retryCountRef.current += 1;
                const delay = Math.min(1000 * Math.pow(2, retryCountRef.current - 1), 5000);

                console.log(`useManagerTimesheets: Retrying in ${delay}ms (attempt ${retryCountRef.current}/${maxRetries})`);

                setTimeout(() => {
                    fetchManagerData(forceRefresh);
                }, delay);

                return;
            }

            setError(err);
        } finally {
            setLoading(false);
        }
    }, [managerId, userIds, maxWeeks, includeDetails, trackOperation]);

    // Initial data fetch
    useEffect(() => {
        fetchManagerData();
    }, [fetchManagerData]);

    // Auto-refresh functionality
    useEffect(() => {
        if (!autoRefresh || !managerId) return;

        const interval = setInterval(() => {
            if (lastFetch && Date.now() - lastFetch.getTime() > 5 * 60 * 1000) {
                fetchManagerData();
            }
        }, 60 * 1000);

        return () => clearInterval(interval);
    }, [autoRefresh, managerId, lastFetch, fetchManagerData]);

    const refresh = useCallback(() => {
        fetchManagerData(true);
    }, [fetchManagerData]);

    const invalidateCache = useCallback(() => {
        userIds.forEach(userId => invalidateTimesheetCache(userId));
        timesheetCache.delete(`timesheets:manager:${managerId}:pending`);
    }, [managerId, userIds]);

    return {
        data,
        loading,
        error,
        lastFetch,
        refresh,
        invalidateCache
    };
};

// Hook for pending approvals (manager view)
export const usePendingApprovals = (managerId, options = {}) => {
    const { includeTeamData = true, autoRefresh = true } = options;
    const { trackOperation } = usePerformanceMonitor('usePendingApprovals');

    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [lastFetch, setLastFetch] = useState(null);

    const retryCountRef = useRef(0);
    const maxRetries = 3;

    const fetchPendingData = useCallback(async (forceRefresh = false) => {
        if (!managerId) {
            setError(new Error('Manager ID is required'));
            setLoading(false);
            return;
        }

        const startTime = Date.now();
        setLoading(true);
        setError(null);

        try {
            // Clear cache if force refresh is requested
            if (forceRefresh) {
                timesheetCache.delete(`timesheets:manager:${managerId}:pending`);
            }

            const result = await measureAsync(`usePendingApprovals-fetch-${managerId}`, async () => {
                return await fetchPendingApprovalsForManager(managerId, { includeTeamData });
            });

            setData(result);
            setLastFetch(new Date());
            retryCountRef.current = 0;

            trackOperation('fetchPendingData', startTime);

            console.log(`usePendingApprovals: Successfully fetched ${result.length} pending items for manager ${managerId}`);
        } catch (err) {
            console.error('usePendingApprovals: Failed to fetch pending approvals:', err);

            // Implement retry logic
            if (retryCountRef.current < maxRetries) {
                retryCountRef.current += 1;
                const delay = Math.min(1000 * Math.pow(2, retryCountRef.current - 1), 5000);

                console.log(`usePendingApprovals: Retrying in ${delay}ms (attempt ${retryCountRef.current}/${maxRetries})`);

                setTimeout(() => {
                    fetchPendingData(forceRefresh);
                }, delay);

                return;
            }

            setError(err);
        } finally {
            setLoading(false);
        }
    }, [managerId, includeTeamData, trackOperation]);

    // Initial data fetch
    useEffect(() => {
        if (!managerId) {
            setLoading(false);
            return;
        }
        fetchPendingData();
    }, [fetchPendingData, managerId]);

    // Auto-refresh for pending approvals (more frequent)
    useEffect(() => {
        if (!autoRefresh || !managerId) return;

        const interval = setInterval(() => {
            // Refresh pending approvals more frequently (every 2 minutes)
            if (lastFetch && Date.now() - lastFetch.getTime() > 2 * 60 * 1000) {
                fetchPendingData();
            }
        }, 30 * 1000); // Check every 30 seconds

        return () => clearInterval(interval);
    }, [autoRefresh, managerId, lastFetch, fetchPendingData]);

    const refresh = useCallback(() => {
        fetchPendingData(true);
    }, [fetchPendingData]);

    const invalidateCache = useCallback(() => {
        timesheetCache.delete(`timesheets:manager:${managerId}:pending`);
    }, [managerId]);

    return {
        data,
        loading,
        error,
        lastFetch,
        refresh,
        invalidateCache
    };
};

// Utility hook for optimistic updates
export const useOptimisticTimesheetUpdate = () => {
    const [pendingUpdates, setPendingUpdates] = useState(new Map());

    const addOptimisticUpdate = useCallback((timesheetId, update) => {
        setPendingUpdates(prev => new Map(prev.set(timesheetId, {
            ...update,
            timestamp: Date.now()
        })));
    }, []);

    const removeOptimisticUpdate = useCallback((timesheetId) => {
        setPendingUpdates(prev => {
            const newMap = new Map(prev);
            newMap.delete(timesheetId);
            return newMap;
        });
    }, []);

    const clearAllOptimisticUpdates = useCallback(() => {
        setPendingUpdates(new Map());
    }, []);

    // Auto-cleanup old optimistic updates (after 30 seconds)
    useEffect(() => {
        const interval = setInterval(() => {
            const now = Date.now();
            setPendingUpdates(prev => {
                const newMap = new Map();
                for (const [id, update] of prev.entries()) {
                    if (now - update.timestamp < 30000) { // Keep updates less than 30 seconds old
                        newMap.set(id, update);
                    }
                }
                return newMap;
            });
        }, 5000); // Check every 5 seconds

        return () => clearInterval(interval);
    }, []);

    return {
        pendingUpdates,
        addOptimisticUpdate,
        removeOptimisticUpdate,
        clearAllOptimisticUpdates
    };
};

// Hook for cache statistics and monitoring
export const useTimesheetCacheStats = () => {
    const [stats, setStats] = useState(null);

    const refreshStats = useCallback(() => {
        const cacheStats = timesheetCache.getTimesheetCacheStats();
        setStats(cacheStats);
    }, []);

    useEffect(() => {
        refreshStats();

        // Refresh stats every 30 seconds
        const interval = setInterval(refreshStats, 30000);
        return () => clearInterval(interval);
    }, [refreshStats]);

    const clearCache = useCallback(() => {
        timesheetCache.clear();
        refreshStats();
    }, [refreshStats]);

    return {
        stats,
        refreshStats,
        clearCache
    };
};