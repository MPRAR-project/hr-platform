import React, { useState, useMemo, useEffect, useCallback, useRef, Suspense } from 'react';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
// Lazy load heavy components
const EditTimesheetModal = React.lazy(() => import('../../../components/modals/EditTimesheetModal'));
import ViewTimesheetModal from '../../../components/modals/ViewTimesheetModal';

import { useTimesheetData } from '../../../hooks/useTimesheetData';
import { usePerformanceMonitor } from '../../../hooks/usePerformanceMonitor';
import timesheetUpdateManager from '../../../services/TimesheetUpdateManager';
import { TIMESHEET_EVENTS } from '../../../services/EventBus';
import { Loader2, RefreshCw, AlertCircle, AlertTriangle } from 'lucide-react';
import { formatTimeDisplay } from '../../../utils/numberFormatter';
import { timesheetDeduplication } from '../../../services/timesheetDeduplication';
import { getUserWeekContext, approveTimesheet, declineTimesheet } from '../../../services/timesheets';
import { DEFAULT_WEEK_START_DAY, getWeekRangeForDate, normalizeWeekStartDay } from '../../../utils/weekStartUtils';
import { useAuth } from '../../../hooks/useAuth';
import { canEditTargetTimesheet, getTimesheetEditPermissions, normalizeUserId } from '../../../utils/timesheetPermissions';

const TimesheetHistoryTab = ({ timesheets: propTimesheets, userId: contextUserId }) => {
    const { trackOperation } = usePerformanceMonitor('TimesheetHistoryTab');
    const componentId = useRef(`TimesheetHistoryTab_${Date.now()}`).current;
    const { user: viewer } = useAuth();
    const normalizedContextUserId = useMemo(() => normalizeUserId(contextUserId), [contextUserId]);
    const viewerUserId = normalizeUserId(viewer?.uid);
    const canEditContextTimesheets = canEditTargetTimesheet(
        viewer?.role,
        viewer?.uid,
        normalizedContextUserId
    );



    // Use optimized data fetching hook
    const {
        data: fetchedTimesheets,
        loading,
        error,
        refresh,
        lastFetch
    } = useTimesheetData(contextUserId, {
        maxWeeks: 12,
        autoRefresh: true,
        prefetchAdjacent: true
    });

    // State management
    const [editModalOpen, setEditModalOpen] = useState(false);
    const [viewTimesheetModalOpen, setViewTimesheetModalOpen] = useState(false);
    const [selectedTimesheet, setSelectedTimesheet] = useState(null);
    const [duplicateWarnings, setDuplicateWarnings] = useState({});
    const [optimisticUpdates, setOptimisticUpdates] = useState(new Map());
    const [realTimeUpdating, setRealTimeUpdating] = useState(false);
    const [selectedMonth, setSelectedMonth] = useState('all');
    const [selectedYear, setSelectedYear] = useState('all');
    const [targetUserWeekStartDay, setTargetUserWeekStartDay] = useState(DEFAULT_WEEK_START_DAY);

    // Fetch target user's week start day setting
    useEffect(() => {
        const fetchTargetUserWeekStartDay = async () => {
            if (!contextUserId) return;
            try {
                const context = await getUserWeekContext(contextUserId);
                setTargetUserWeekStartDay(context.weekStartDay || DEFAULT_WEEK_START_DAY);
            } catch (error) {
                console.warn('Failed to fetch target user week start day:', error);
                setTargetUserWeekStartDay(DEFAULT_WEEK_START_DAY);
            }
        };

        fetchTargetUserWeekStartDay();
    }, [contextUserId]);

    // Helper function to format seconds to readable time
    const formatReadable = (seconds) => {
        return formatTimeDisplay(seconds);
    };

    // Use fetched data if available, fallback to props, enhanced with optimistic updates
    const timesheets = useMemo(() => {
        let baseTimesheets = [];

        if (fetchedTimesheets && fetchedTimesheets.length > 0) {
            // Transform fetched data to match expected format
            baseTimesheets = fetchedTimesheets.map(w => {
                // ✅ FIXED: Use target user's week start day to calculate correct week range
                const baseDate = w.start instanceof Date ? w.start : new Date(w.start);
                const effectiveWeekStartDay = normalizeWeekStartDay(targetUserWeekStartDay);
                const { start: weekStart, end: weekEnd } = getWeekRangeForDate(baseDate, effectiveWeekStartDay);
                const periodLabel = `${weekStart.getFullYear()}, ${weekStart.toLocaleDateString('en-US', { month: 'long' })} ${weekStart.getDate()}-${weekEnd.getDate()}`;

                return {
                    id: w.weekKey,
                    week: periodLabel,
                    period: periodLabel,
                    hours: formatReadable(w.totals.effectiveSec || 0),
                    overtime: formatReadable(w.totals.overtimeSec || 0),
                    status: w.status,
                    submitted: w.submitted,
                    name: 'User',
                    approvedByName: w.approvedByName,
                    approvedAt: w.approvedAt,
                    approvedBy: w.approvedBy,
                    raw: { ...w, userId: contextUserId },
                    // Additional fields for editing
                    weekStart: weekStart.toISOString().slice(0, 10),
                    weekEnd: weekEnd.toISOString().slice(0, 10),
                    totals: w.totals,
                    entries: [], // Will be populated when needed
                    weekEndDate: weekEnd,
                    weekStartDate: weekStart // ✅ Add weekStartDate for modal use
                };
            });
        } else {
            baseTimesheets = propTimesheets || [];
        }

        // UNIFICATION FIX: Filter out legacy/overlapping weeks that don't match current config
        // If we have both a "Mon-Sun" and a "Sun-Sat" for the same period (due to setting change),
        // we should prefer the one matching the current User Context configuration.
        // However, historical data (months ago) should be left as is. Only recent overlaps matter.

        // 1. Sort by date desc
        baseTimesheets.sort((a, b) => new Date(b.weekEnd) - new Date(a.weekEnd));

        // 2. Filter overlapping weeks (simple heuristic: if end dates are within 3 days)
        const filtered = [];
        const processedPeriods = new Set();

        // We need to access contextUserId's preference? 
        // We don't strictly know it here easily without async fetch, 
        // BUT we can prefer "Active/Draft" over "Submitted/Approved" if they overlap? 
        // OR prefer the one that matches default week start?
        // Actually, the simpler logic: If two timesheets end within 3 days of each other, keep the one with the *latest* LastUpdate or *Active* status.

        for (const ts of baseTimesheets) {
            // Create a "Period Key" representing the approximate week (YYYY-WeekNum) or just check linear overlap
            // Let's use End Date as the anchor. 
            const endDate = new Date(ts.weekEnd);
            const time = endDate.getTime();

            // Check if we already processed a week "near" this one (within 3 days)
            let isOverlap = false;
            for (const processedTime of processedPeriods) {
                const diff = Math.abs(processedTime - time);
                if (diff < 3 * 24 * 60 * 60 * 1000) { // 3 days
                    isOverlap = true;
                    break;
                }
            }

            if (!isOverlap) {
                filtered.push(ts);
                processedPeriods.add(time);
            } else {
                // Optimization: If we skipped 'ts' but it's actually NEWER/BETTER than what we kept?
                // The list is sorted by End Date Desc. 
                // If we have Jan 20 (Mon) and Jan 19 (Sun).
                // We see Jan 20 first. We keep it.
                // We see Jan 19. It's within 1 day. We skip it.
                // Result: We keep the LATEST week definition. This auto-fixes the "Old vs New" logic usage.
                // The "New" logic produces the "New" End Date.
                // So sorting by End Date Desc implicitly favors the new logic.
                console.log('[TimesheetHistoryTab] Hiding overlapping legacy timesheet:', ts.id, ts.weekEnd);
            }
        }

        baseTimesheets = filtered;

        // Apply optimistic updates to the timesheets
        if (optimisticUpdates.size > 0) {
            return baseTimesheets.map(timesheet => {
                // Check if this timesheet has optimistic updates
                const relevantUpdates = Array.from(optimisticUpdates.values()).filter(update => {
                    const updateWeekStart = update.weekStart;
                    return updateWeekStart === timesheet.weekStart;
                });

                if (relevantUpdates.length === 0) {
                    return timesheet;
                }

                // Apply optimistic updates
                let updatedTimesheet = { ...timesheet };

                relevantUpdates.forEach(update => {
                    if (update.update?.displayData?.weekTotals) {
                        const optimisticTotals = update.update.displayData.weekTotals;
                        updatedTimesheet = {
                            ...updatedTimesheet,
                            hours: optimisticTotals.displayHours || updatedTimesheet.hours,
                            overtime: optimisticTotals.displayOvertime || updatedTimesheet.overtime,
                            totals: {
                                ...updatedTimesheet.totals,
                                effectiveSec: optimisticTotals.effectiveSec || updatedTimesheet.totals?.effectiveSec || 0,
                                overtimeSec: optimisticTotals.overtimeSec || updatedTimesheet.totals?.overtimeSec || 0
                            },
                            // Add visual indicator for optimistic update
                            isOptimisticallyUpdated: true,
                            lastOptimisticUpdate: update.timestamp
                        };
                    }
                });

                return updatedTimesheet;
            });
        }

        return baseTimesheets;
    }, [fetchedTimesheets, propTimesheets, contextUserId, optimisticUpdates, targetUserWeekStartDay]);

    const monthYearOptions = useMemo(() => {
        const months = new Map();
        const years = new Set();
        timesheets.forEach(ts => {
            if (!(ts.weekEndDate instanceof Date)) return;
            const monthIndex = ts.weekEndDate.getMonth();
            const monthLabel = ts.weekEndDate.toLocaleString('en-US', { month: 'long' });
            months.set(monthIndex, monthLabel);
            years.add(ts.weekEndDate.getFullYear());
        });
        return {
            months: Array.from(months.entries())
                .sort((a, b) => a[0] - b[0])
                .map(([value, label]) => ({ value: String(value), label })),
            years: Array.from(years.values())
                .sort((a, b) => b - a)
                .map((value) => ({ value: String(value), label: String(value) }))
        };
    }, [timesheets]);

    const filteredTimesheets = useMemo(() => {
        return timesheets.filter(ts => {
            if (!(ts.weekEndDate instanceof Date)) return true;
            const matchYear = selectedYear === 'all' || ts.weekEndDate.getFullYear() === Number(selectedYear);
            const matchMonth = selectedMonth === 'all' || ts.weekEndDate.getMonth() === Number(selectedMonth);
            return matchYear && matchMonth;
        });
    }, [timesheets, selectedMonth, selectedYear]);

    // Real-time update handler
    const handleRealTimeUpdate = useCallback((eventData, eventType) => {
        const startTime = Date.now();

        try {
            // Only process updates for this user
            if (eventData.userId !== contextUserId) {
                return;
            }

            console.log(`[TimesheetHistoryTab] Received real-time update:`, eventType, eventData);

            switch (eventType) {
                case TIMESHEET_EVENTS.EDIT_UPDATED:
                    // Handle optimistic updates
                    if (eventData.optimistic) {
                        setOptimisticUpdates(prev => {
                            const newMap = new Map(prev);
                            newMap.set(eventData.updateId, {
                                ...eventData,
                                timestamp: Date.now()
                            });
                            return newMap;
                        });
                        setRealTimeUpdating(true);
                    }
                    break;

                case TIMESHEET_EVENTS.EDIT_SAVED:
                    // Handle confirmed updates
                    setOptimisticUpdates(prev => {
                        const newMap = new Map(prev);
                        newMap.delete(eventData.updateId);
                        return newMap;
                    });
                    setRealTimeUpdating(false);

                    // Refresh data to get latest changes
                    refresh();
                    break;

                case TIMESHEET_EVENTS.EDIT_FAILED:
                    // Handle failed updates - remove optimistic update
                    setOptimisticUpdates(prev => {
                        const newMap = new Map(prev);
                        newMap.delete(eventData.updateId);
                        return newMap;
                    });
                    setRealTimeUpdating(false);
                    break;

                case TIMESHEET_EVENTS.DATA_UPDATED:
                    // Handle general data updates
                    setRealTimeUpdating(false);
                    refresh();
                    break;

                default:
                    console.log(`[TimesheetHistoryTab] Unhandled event type: ${eventType}`);
            }

            trackOperation('handleRealTimeUpdate', startTime);

        } catch (error) {
            console.error('[TimesheetHistoryTab] Error handling real-time update:', error);
            setRealTimeUpdating(false);
        }
    }, [contextUserId, refresh, trackOperation]);

    // Subscribe to real-time updates
    useEffect(() => {
        if (!contextUserId) return;

        console.log(`[TimesheetHistoryTab] Subscribing to real-time updates for user: ${contextUserId}`);

        const unsubscribe = timesheetUpdateManager.subscribeToUpdates(
            componentId,
            handleRealTimeUpdate
        );

        return () => {
            console.log(`[TimesheetHistoryTab] Unsubscribing from real-time updates`);
            unsubscribe();
        };
    }, [contextUserId, handleRealTimeUpdate, componentId]);

    // Clean up optimistic updates after timeout
    useEffect(() => {
        const cleanup = setInterval(() => {
            const now = Date.now();
            setOptimisticUpdates(prev => {
                const newMap = new Map();
                for (const [id, update] of prev.entries()) {
                    // Keep updates less than 30 seconds old
                    if (now - update.timestamp < 30000) {
                        newMap.set(id, update);
                    }
                }
                return newMap;
            });
        }, 10000); // Check every 10 seconds

        return () => clearInterval(cleanup);
    }, []);

    // Check for duplicates in background (debounced to improve performance)
    useEffect(() => {
        const timeoutId = setTimeout(() => {
            const checkDuplicates = async () => {
                if (!contextUserId || !timesheets.length) return;

                const warnings = {};
                let resolvedWeekStartDay = DEFAULT_WEEK_START_DAY;
                try {
                    const { weekStartDay } = await getUserWeekContext(contextUserId);
                    resolvedWeekStartDay = weekStartDay || DEFAULT_WEEK_START_DAY;
                } catch (error) {
                    console.warn('[TimesheetHistoryTab] Failed to resolve week start day for duplicate check', error);
                }

                // Only check the most recent 5 weeks to improve performance
                const recentTimesheets = timesheets.slice(0, 5);
                for (const timesheet of recentTimesheets) {
                    try {
                        const weekStart = timesheet.weekStart || timesheet.raw?.start?.toISOString?.()?.slice(0, 10);
                        if (weekStart) {
                            const duplicates = await timesheetDeduplication.detectDuplicateEntries(contextUserId, weekStart, { weekStartDay: resolvedWeekStartDay });
                            if (duplicates.hasDuplicates) {
                                warnings[timesheet.id] = {
                                    duplicateGroups: duplicates.duplicateGroups,
                                    totalDocs: duplicates.totalDocs
                                };
                            }
                        }
                    } catch (error) {
                        console.warn(`Failed to check duplicates for timesheet ${timesheet.id}:`, error);
                    }
                }

                setDuplicateWarnings(warnings);
            };

            // Only check duplicates if we have data and it's not loading
            if (!loading && timesheets.length > 0) {
                checkDuplicates();
            }
        }, 1000); // Debounce for 1 second

        return () => clearTimeout(timeoutId);
    }, [contextUserId, timesheets, loading]);


    const handleEdit = (timesheet) => {
        if (!getTimesheetEditPermissions(timesheet, viewer)) {
            return;
        }
        const startTime = Date.now();

        const normalizedUserId = normalizedContextUserId;

        const enhancedTimesheet = {
            ...timesheet,
            userId: timesheet?.userId || normalizedUserId,
            weekStart: timesheet.weekStart || (timesheet.raw?.start instanceof Date ? timesheet.raw.start.toISOString().slice(0, 10) : (typeof timesheet.raw?.start === 'string' ? timesheet.raw.start.slice(0, 10) : null)),
            entries: timesheet.entries || [],
            raw: {
                ...(timesheet?.raw || {}),
                userId: (timesheet?.raw?.userId || timesheet?.userId || normalizedUserId) || null,
            }
        };

        setSelectedTimesheet(enhancedTimesheet);

        setEditModalOpen(true);

        trackOperation('openEdit', startTime);
    };

    const handleOpenView = (timesheet) => {
        const startTime = Date.now();

        const normalizedUserId = normalizedContextUserId;

        const merged = {
            ...timesheet,
            userId: timesheet?.userId || normalizedUserId,
            weekStart: timesheet.weekStart || (timesheet.raw?.start instanceof Date ? timesheet.raw.start.toISOString().slice(0, 10) : (typeof timesheet.raw?.start === 'string' ? timesheet.raw.start.slice(0, 10) : null)),
            raw: {
                ...(timesheet?.raw || {}),
                userId: (timesheet?.raw?.userId || timesheet?.userId || normalizedUserId) || null,
            }
        };

        setSelectedTimesheet(merged);
        setViewTimesheetModalOpen(true);

        trackOperation('openView', startTime);
    };

    const handleSave = (saveResult) => {
        const startTime = Date.now();

        if (saveResult?.success) {
            // ENHANCEMENT: Show success message

            // ENHANCEMENT: Apply optimistic update to local state for immediate UI feedback
            if (saveResult.updatedTimesheet) {
                // Update the timesheet in the local state immediately
                const updatedTimesheets = timesheets.map(timesheet => {
                    if (timesheet.id === selectedTimesheet?.id) {
                        // Calculate new display values from the updated data
                        const updatedData = saveResult.updatedTimesheet;
                        return {
                            ...timesheet,
                            hours: formatReadable(updatedData.totals?.effectiveSec || 0),
                            overtime: formatReadable(updatedData.totals?.overtimeSec || 0),
                            entries: updatedData.entries || timesheet.entries,
                            totals: updatedData.totals || timesheet.totals,
                            lastUpdated: updatedData.lastUpdated || new Date().toISOString()
                        };
                    }
                    return timesheet;
                });

                // Note: Since we're using the useTimesheetData hook, we'll rely on the refresh() 
                // to update the data properly. The optimistic update above is for immediate feedback.
            }

            // Refresh data to get latest changes and ensure consistency
            refresh();
        } else {
            // Handle error case with proper user feedback
            // Error handling is already done in the modal, but we can add additional logging here
        }

        setEditModalOpen(false);
        setSelectedTimesheet(null);
        trackOperation('saveTimesheet', startTime);
    };

    const handleRefresh = async () => {
        const startTime = Date.now();
        try {
            await refresh();
        } catch (error) {
            // The error will be handled by the useTimesheetData hook
        }
        trackOperation('refreshData', startTime);
    };
    // Loading skeleton component
    const TimesheetSkeleton = () => (
        <div className="space-y-4">
            {[...Array(5)].map((_, index) => (
                <div key={index} className="grid grid-cols-12 gap-4 px-4 py-4 border border-border-secondary rounded-lg animate-pulse">
                    <div className="col-span-2 h-4 bg-gray-200 rounded"></div>
                    <div className="col-span-2 h-4 bg-gray-200 rounded"></div>
                    <div className="col-span-1 h-4 bg-gray-200 rounded"></div>
                    <div className="col-span-1 h-4 bg-gray-200 rounded"></div>
                    <div className="col-span-1 h-4 bg-gray-200 rounded"></div>
                    <div className="col-span-3 h-4 bg-gray-200 rounded"></div>
                </div>
            ))}
        </div>
    );

    return (
        <>
            <div className="space-y-6 bg-white p-6 rounded-base shadow-lg">
                <div className="flex items-center justify-between">
                    <h3 className="text-xl md:text-2xl font-bold text-text-primary">Timesheet History</h3>
                    <div className="flex items-center gap-3">
                        {lastFetch && (
                            <span className="text-xs text-text-secondary">
                                Last updated: {lastFetch.toLocaleTimeString()}
                            </span>
                        )}
                        <Button
                            variant="outline-secondary"
                            onClick={handleRefresh}
                            disabled={loading}
                            icon={loading ? Loader2 : RefreshCw}
                            className={loading ? 'animate-pulse' : ''}
                        >
                            {loading ? 'Loading...' : 'Refresh'}
                        </Button>
                    </div>
                </div>

                {/* Error State */}
                {error && (
                    <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
                        <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
                        <div>
                            <p className="text-sm font-medium text-red-800">Failed to load timesheet data</p>
                            <p className="text-xs text-red-600">{error.message}</p>
                        </div>
                        <Button
                            variant="outline-danger"
                            onClick={handleRefresh}
                            className="ml-auto"
                        >
                            Retry
                        </Button>
                    </div>
                )}

                <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-end">
                    <div className="flex items-center gap-2">
                        <label className="text-sm text-text-secondary">Month</label>
                        <select
                            value={selectedMonth}
                            onChange={(e) => setSelectedMonth(e.target.value)}
                            className="h-10 px-3 border border-border-secondary rounded-lg text-sm focus:outline-none focus:border-border-accent-purple"
                        >
                            <option value="all">All</option>
                            {monthYearOptions.months.map(option => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-sm text-text-secondary">Year</label>
                        <select
                            value={selectedYear}
                            onChange={(e) => setSelectedYear(e.target.value)}
                            className="h-10 px-3 border border-border-secondary rounded-lg text-sm focus:outline-none focus:border-border-accent-purple"
                        >
                            <option value="all">All</option>
                            {monthYearOptions.years.map(option => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Desktop View - Table */}
                {/* Desktop View - Table */}
                <div className="hidden md:block overflow-x-auto scrollbar-custom">
                    {loading ? (
                        <TimesheetSkeleton />
                    ) : filteredTimesheets.length === 0 ? (
                        <div className="text-center py-8">
                            <p className="text-text-secondary">No timesheet data available</p>
                        </div>
                    ) : (
                        <div className="min-w-[800px] space-y-2">
                            {/* Table Header */}
                            <div className="grid grid-cols-[1.8fr_1.5fr_1fr_1fr_1fr_1.2fr] gap-3 px-4 py-3 bg-gray-100 rounded-lg text-xs font-semibold text-gray-600 uppercase tracking-wide border-b">
                                <div>Period</div>
                                <div>Submitted</div>
                                <div>Overtime</div>
                                <div>Hours</div>
                                <div>Status</div>
                                <div className="text-right">Actions</div>
                            </div>

                            {/* Table Rows */}
                            {filteredTimesheets.map((row, index) => (
                                <div
                                    key={row.id || index}
                                    className="grid grid-cols-[1.8fr_1.5fr_1fr_1fr_1fr_1.2fr] gap-3 px-4 py-4 border border-gray-200 rounded-lg items-center hover:bg-gray-50 transition-colors"
                                >
                                    {/* Week Ending */}
                                    <div className="text-sm text-gray-900 font-medium flex items-center gap-2 truncate">
                                        {row.week}
                                        {duplicateWarnings[row.id] && (
                                            <div
                                                className="flex items-center gap-1 text-orange-600"
                                                title={`${duplicateWarnings[row.id].duplicateGroups.length} duplicate groups detected`}
                                            >
                                                <AlertTriangle className="h-3 w-3" />
                                                <span className="text-xs">Duplicates</span>
                                            </div>
                                        )}
                                        {row.isOptimisticallyUpdated && (
                                            <div
                                                className="flex items-center gap-1 text-blue-600"
                                                title="Updating in real-time..."
                                            >
                                                <Loader2 className="h-3 w-3 animate-spin" />
                                                <span className="text-xs">Updating</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Submitted */}
                                    <div className="text-sm text-gray-600 truncate">{row.submitted}</div>

                                    <div className={`text-sm ${row.isOptimisticallyUpdated ? 'text-blue-600' : 'text-gray-600'}`}>
                                        {row.overtime}
                                    </div>

                                    {/* Hours */}
                                    <div className={`text-sm font-semibold ${row.isOptimisticallyUpdated ? 'text-blue-600' : 'text-gray-900'}`}>
                                        {row.hours}
                                    </div>

                                    {/* Status */}
                                    <div className="flex items-center">
                                        <Badge variant={getStatusVariant(row.status)}>{row.status}</Badge>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex justify-end gap-2 whitespace-nowrap">
                                        {getTimesheetEditPermissions(row, viewer) && (
                                            <Button
                                                variant="outline-primary"
                                                size="sm"
                                                onClick={() => handleEdit(row)}
                                            >
                                                Edit
                                            </Button>
                                        )}
                                        <Button
                                            variant="outline-primary"
                                            size="sm"
                                            onClick={() => handleOpenView(row)}
                                        >
                                            View
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>


                {/* Mobile View - Cards */}
                <div className="md:hidden space-y-4">
                    {loading ? (
                        <div className="space-y-4">
                            {[...Array(3)].map((_, index) => (
                                <div key={index} className="border border-border-secondary rounded-lg p-4 space-y-3 animate-pulse">
                                    <div className="flex justify-between items-start gap-2">
                                        <div className="h-4 bg-gray-200 rounded flex-1"></div>
                                        <div className="h-6 w-16 bg-gray-200 rounded"></div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="h-4 bg-gray-200 rounded"></div>
                                        <div className="h-4 bg-gray-200 rounded"></div>
                                        <div className="h-4 bg-gray-200 rounded"></div>
                                        <div className="h-4 bg-gray-200 rounded"></div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : filteredTimesheets.length === 0 ? (
                        <div className="text-center py-8">
                            <p className="text-text-secondary">No timesheet data available</p>
                        </div>
                    ) : (
                        filteredTimesheets.map((row, index) => (
                            <div key={row.id || index} className="border border-border-secondary rounded-lg p-4 space-y-3 hover:bg-bg-secondary transition-colors">
                                {/* Week Ending and Status */}
                                <div className="flex justify-between items-start gap-2">
                                    <div className="flex-1">
                                        <p className="font-semibold text-text-primary text-sm line-clamp-2">{row.week}</p>
                                        {duplicateWarnings[row.id] && (
                                            <div className="flex items-center gap-1 text-orange-600 mt-1">
                                                <AlertTriangle className="h-3 w-3" />
                                                <span className="text-xs">Duplicates detected</span>
                                            </div>
                                        )}
                                        {row.isOptimisticallyUpdated && (
                                            <div className="flex items-center gap-1 text-blue-600 mt-1">
                                                <Loader2 className="h-3 w-3 animate-spin" />
                                                <span className="text-xs">Updating in real-time...</span>
                                            </div>
                                        )}
                                    </div>
                                    <Badge variant={getStatusVariant(row.status)}>{row.status}</Badge>
                                </div>

                                {/* Details Grid */}
                                <div className="grid grid-cols-2 gap-3 text-sm">
                                    <div>
                                        <span className="text-text-secondary block mb-1">Submitted:</span>
                                        <span className="font-medium text-text-primary">{row.submitted}</span>
                                    </div>
                                    <div>
                                        <span className="text-text-secondary block mb-1">Total:</span>
                                        <span className={`font-semibold ${row.isOptimisticallyUpdated ? 'text-blue-600' : 'text-text-primary'}`}>
                                            {row.hours}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-text-secondary block mb-1">Overtime:</span>
                                        <span className={`font-medium ${row.isOptimisticallyUpdated ? 'text-blue-600' : 'text-text-primary'}`}>
                                            {row.overtime}
                                        </span>
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex gap-2 justify-end">
                                    {getTimesheetEditPermissions(row, viewer) && (
                                        <Button variant="outline-primary" onClick={() => handleEdit(row)}>Edit</Button>
                                    )}
                                    <Button variant="outline-primary" onClick={() => handleOpenView(row)}>View</Button>
                                </div>
                            </div>
                        ))
                    )}
                </div>

            </div>

            {/* Modals */}
            <Suspense fallback={
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="bg-white p-4 rounded-lg shadow-xl flex items-center gap-3">
                        <Loader2 className="h-6 w-6 animate-spin text-purple-600" />
                        <span className="text-text-primary font-medium">Loading editor...</span>
                    </div>
                </div>
            }>
                {editModalOpen && (
                    <EditTimesheetModal
                        isOpen={editModalOpen}
                        onClose={() => {
                            setEditModalOpen(false);
                            setSelectedTimesheet(null);
                        }}
                        timesheet={selectedTimesheet}
                        onSave={handleSave}
                    />
                )}
            </Suspense>

            <ViewTimesheetModal
                isOpen={viewTimesheetModalOpen}
                onClose={() => {
                    setViewTimesheetModalOpen(false);
                    setSelectedTimesheet(null);
                }}
                timesheet={selectedTimesheet}
                fallbackUserId={contextUserId}
                isOwnTimesheet={viewer?.uid === contextUserId}
                canEdit={getTimesheetEditPermissions(selectedTimesheet, viewer)}
                onEdit={(ts) => {
                    setViewTimesheetModalOpen(false);
                    handleEdit(ts || selectedTimesheet);
                }}
                onApprove={async (timesheetDocId) => {
                    // Perform the actual approval using the real Firestore document ID
                    try {
                        if (timesheetDocId && viewer?.uid) {
                            const approverName = viewer?.firstName && viewer?.lastName
                                ? `${viewer.firstName} ${viewer.lastName}`
                                : viewer?.displayName || viewer?.name || 'Manager';
                            await approveTimesheet(timesheetDocId, viewer.uid, null, approverName);
                        }
                    } catch (err) {
                        console.error('[TimesheetHistoryTab] Approval failed:', err);
                        throw err; // Re-throw so ViewTimesheetModal can show the error toast
                    }
                    // Refresh data after successful approval
                    refresh();
                    // Close modal after refresh
                    setViewTimesheetModalOpen(false);
                    setSelectedTimesheet(null);
                }}
                onDecline={async (timesheetDocId) => {
                    // Perform the actual decline using the real Firestore document ID
                    try {
                        if (timesheetDocId && viewer?.uid) {
                            await declineTimesheet(timesheetDocId, viewer.uid);
                        }
                    } catch (err) {
                        console.error('[TimesheetHistoryTab] Decline failed:', err);
                        throw err; // Re-throw so ViewTimesheetModal can show the error toast
                    }
                    // Refresh data after successful decline
                    refresh();
                    // Close modal after refresh
                    setViewTimesheetModalOpen(false);
                    setSelectedTimesheet(null);
                }}
            />
        </>
    );

    // Helper function to get badge variant based on status
    function getStatusVariant(status) {
        switch (status?.toLowerCase()) {
            case 'pending':
                return 'warning';
            case 'approved':
                return 'success';
            case 'rejected':
                return 'danger';
            case 'draft':
                return 'info';
            default:
                return 'secondary';
        }
    }
};

export default TimesheetHistoryTab;