/**
 * Timesheet Context Provider
 * Provides real-time timesheet data using Firestore listeners
 * All components can subscribe to timesheet data without re-fetching
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useClockSessionContext } from './ClockSessionContext';
import {
    fetchWeeklySummaries,
    getUserTimesheetsByWeek,
    subscribeToTimesheets,
    getCompanyWorkSchedule
} from '../services/timesheets';
import { processWeekData, calculateWeekTotals } from '../services/weekDataProcessor';
import { getUserWeekContext } from '../services/timesheets';
import { getWeekRangeForDate, formatISODate, DEFAULT_WEEK_START_DAY } from '../utils/weekStartUtils';

// Provide default context value to prevent React warnings
const defaultTimesheetContextValue = {
    timesheetDocs: [],
    weeklySummaries: [],
    currentWeekData: { days: [], entries: [] },
    weeksByKey: {},
    currentSchedule: null,
    absencesMap: null, // Track as null to distinguish between 'loading' and 'empty'
    isLoading: false,
    error: null,
    getWeekDetails: () => null,
    isWeekDataReady: () => false,
    refresh: () => { }
};

const TimesheetContext = createContext(defaultTimesheetContextValue);

export const useTimesheetContext = () => {
    // With default context value, this will never be null
    // But we keep the check for safety in case provider is not mounted
    const context = useContext(TimesheetContext);
    return context || defaultTimesheetContextValue;
};

export const TimesheetProvider = ({ children }) => {
    const { user, companySettings, weekStartDay: authWeekStartDay } = useAuth();
    // Get sessions from ClockSessionContext (returns safe defaults if not available)
    const { sessionDocs: allSessionDocs } = useClockSessionContext();
    const [timesheetDocs, setTimesheetDocs] = useState([]);
    const [weeklySummaries, setWeeklySummaries] = useState([]);
    const [currentWeekData, setCurrentWeekData] = useState({ days: [], entries: [] });
    const [weeksByKey, setWeeksByKey] = useState({}); // Store processed week data by week key
    const [absencesMap, setAbsencesMap] = useState(null); 
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const unsubscribeRef = useRef(null);
    const isInitialLoadRef = useRef(true);
    const scheduleCacheRef = useRef({});
    const sessionDocsRef = useRef([]); // Keep latest sessions in ref to avoid dependency changes

    // Track last processed logs to prevent redundant updates
    const lastProcessedRef = useRef('');
    const [currentSchedule, setCurrentSchedule] = useState(null);

    // Sync company settings from AuthContext
    useEffect(() => {
        if (companySettings) {
            const schedule = companySettings.workSchedule || {};
            setCurrentSchedule(schedule);
            if (user?.uid) {
                scheduleCacheRef.current[user.uid] = schedule;
            }
        }
    }, [companySettings, user?.uid]);

    // Subscribe to absences for real-time updates
    useEffect(() => {
        if (!user?.uid) {
            setAbsencesMap(null);
            return;
        }

        const setupListeners = async () => {
            try {
                // Absences Listener/Fetch
                // We'll use the service to fetch them for the relevant range
                const { fetchApprovedAbsencesForWeek } = await import('../services/timesheetAbsenceIntegration');
                const today = new Date();
                const start = new Date(today);
                start.setDate(today.getDate() - 60);
                const end = new Date(today);
                end.setDate(today.getDate() + 14);

                const absences = await fetchApprovedAbsencesForWeek(user.uid, start, end);
                setAbsencesMap(absences);

                // Optional: Setup real-time listener for absences if needed, 
                // but for now a fetch on mount/user-change is better than no data.
            } catch (err) {
                console.error('[TimesheetProvider] Error setting up listeners:', err);
                // Fail-safe to prevent permanent loading hang
                setAbsencesMap(new Map());
            }
        };

        setupListeners();

        return () => {
            // No cleanup needed for manual fetch
        };
    }, [user?.uid]);

    // Process timesheet documents into weekly summaries
    const updateWeeklySummaries = useCallback(async (docs, force = false) => {
        if (!user?.uid) return;

        try {
            // docs are already normalized from REST in our service
            setWeeklySummaries(docs);
        } catch (err) {
            console.error('[TimesheetProvider] Error processing weekly summaries:', err);
        }
    }, [user?.uid]);

    // Process timesheet documents into current week data
    const updateCurrentWeekData = useCallback(async (docs) => {
        if (!user?.uid) return;

        try {
            const weekData = await processCurrentWeekTimesheets(docs, user.uid);
            setCurrentWeekData(weekData);
        } catch (err) {
            console.error('[TimesheetProvider] Error processing current week data:', err);
        }
    }, [user?.uid]);

    // Get company work schedule via REST
    const scheduleLastFetched = useRef({});
    const getCompanySchedule = useCallback(async (userId) => {
        if (!userId || !user?.companyId) return {};

        const now = Date.now();
        const lastFetch = scheduleLastFetched.current[userId] || 0;
        if (scheduleCacheRef.current[userId] && (now - lastFetch) < 2 * 60 * 1000) {
            return scheduleCacheRef.current[userId];
        }

        try {
            const schedule = await getCompanyWorkSchedule(user.companyId);
            scheduleCacheRef.current[userId] = schedule;
            scheduleLastFetched.current[userId] = now;
            return schedule;
        } catch (err) {
            console.error('[TimesheetProvider] Error getting company schedule:', err);
            return {};
        }
    }, [user?.companyId]);

    // Keep sessionDocs ref updated
    useEffect(() => {
        sessionDocsRef.current = allSessionDocs || [];
    }, [allSessionDocs]);

    // Track last processed weeks to prevent redundant updates
    const lastWeeksProcessedRef = useRef('');

    // Process all weeks with sessions merged
    const updateWeeksByKey = useCallback(async (docs, sessionDocs) => {
        if (!user?.uid) {
            setWeeksByKey({});
            return;
        }

        // Optimization: Create a hash of inputs to prevent redundant processing
        const docsHash = docs?.map(d => `${d.id}_${d.updatedAt?.seconds || ''}`).join('|') || '';
        // CRITICAL: must include session status + endedAt so a clock-out (open→closed) always
        // produces a different hash even though the session count hasn't changed.
        const sessionsHash = sessionDocs?.map(s =>
            `${s.id}_${s.status}_${s.endedAt?.seconds || 'noend'}_${s.updatedAt?.seconds || ''}`
        ).sort().join('|') || '';
        const currentHash = `${docsHash}__${sessionsHash}__sched_${JSON.stringify(currentSchedule)}`;

        // If hash matches and we have data, skip processing
        if (lastWeeksProcessedRef.current === currentHash) {
            // console.log('[TimesheetProvider] Skipping weeksByKey processing - data unchanged');
            return;
        }

        try {
            const sessionsToUse = sessionDocs || sessionDocsRef.current || [];

            // Get user's week start day
            const { companyIdPath } = await getUserWeekContext(user.uid);
            const { STORAGE_ANCHOR_DAY, isMondayAnchorEnabled } = await import('../utils/weekStartUtils');
            const weekStart = isMondayAnchorEnabled(companyIdPath) ? STORAGE_ANCHOR_DAY : (authWeekStartDay || DEFAULT_WEEK_START_DAY);

            // Get company schedule
            const schedule = await getCompanySchedule(user.uid);

            // Group timesheets by week key
            const weekTimesheetsMap = new Map();

            for (const timesheet of docs) {
                const period = timesheet.period; // YYYY-MM-DD
                if (!period) continue;

                // Parse as UTC to prevent timezone shift (IST causes local dates to shift to previous day in UTC)
                const date = new Date(period + 'T00:00:00Z');
                const { start, end } = getWeekRangeForDate(date, weekStart);
                const weekKey = `${formatISODate(start)}_${formatISODate(end)}`;

                if (!weekTimesheetsMap.has(weekKey)) {
                    weekTimesheetsMap.set(weekKey, {
                        weekStart: start,
                        weekEnd: end,
                        timesheets: [],
                        sessions: []
                    });
                }

                weekTimesheetsMap.get(weekKey).timesheets.push(timesheet);
            }

            // Process each week
            const processedWeeks = {};

            for (const [weekKey, weekData] of weekTimesheetsMap.entries()) {
                try {
                    const processedWeek = await processWeekData(
                        weekData.weekStart,
                        weekData.timesheets,
                        sessionsToUse,
                        user.uid,
                        schedule
                    );

                    processedWeeks[weekKey] = processedWeek;
                } catch (err) {
                    console.error(`[TimesheetProvider] Error processing week ${weekKey}:`, err);
                }
            }

            setWeeksByKey(processedWeeks);
            lastWeeksProcessedRef.current = currentHash;
        } catch (err) {
            console.error('[TimesheetProvider] Error processing weeksByKey:', err);
        }
    }, [user?.uid, getCompanySchedule, currentSchedule]);

    // Handle timesheet document updates
    const handleTimesheetUpdate = useCallback(async (docs, metadata) => {

        setTimesheetDocs(docs);

        // Mark as loaded after first snapshot (even if from cache)
        // Firestore may return cached data first, then real data
        if (isInitialLoadRef.current) {
            // Wait a bit to see if we get a non-cached snapshot
            // If metadata exists and data is loaded, consider it ready
            if (metadata && (!metadata.fromCache || docs.length >= 0)) {
                // Set loading to false after processing, even if from cache
                // Real-time updates will still come through
                setTimeout(() => {
                    setIsLoading(false);
                    isInitialLoadRef.current = false;
                }, 100);
            }
        }

        // Process data in parallel (including weeksByKey with sessions)
        // Use sessionDocsRef to avoid dependency on allSessionDocs changing
        const sessionsToUse = sessionDocsRef.current || [];
        await Promise.all([
            updateWeeklySummaries(docs),
            updateCurrentWeekData(docs),
            updateWeeksByKey(docs, sessionsToUse)
        ]).then(() => {
            // Ensure loading is false after processing completes
            if (isInitialLoadRef.current) {
                setIsLoading(false);
                isInitialLoadRef.current = false;
            }
        });
    }, [updateWeeklySummaries, updateCurrentWeekData, updateWeeksByKey]);

    // Update weeksByKey when sessions change (only if we already have timesheet data)
    // This ensures sessions are merged when they arrive after timesheets.
    // CRITICAL FIX: We must use a hash that includes session STATUS and endedAt,
    // not just length — a clock-out changes status/endedAt without changing the count.
    const sessionsSignature = useMemo(() => {
        if (!allSessionDocs) return '';
        return allSessionDocs
            .map(s => `${s.id}_${s.status}_${s.endedAt?.seconds || 'noend'}_${s.updatedAt?.seconds || ''}`)
            .sort()
            .join('|');
    }, [allSessionDocs]);

    useEffect(() => {
        if (timesheetDocs.length > 0 && sessionDocsRef.current.length >= 0) {
            // Only update if we have both timesheets and sessions loaded.
            // Triggered whenever session statuses change (e.g. clock-out).
            updateWeeksByKey(timesheetDocs, sessionDocsRef.current);
        }
    }, [sessionsSignature, timesheetDocs.length, updateWeeksByKey]);

    // Get week details by week key
    const getWeekDetails = useCallback((weekKey) => {
        return weeksByKey[weekKey] || null;
    }, [weeksByKey]);

    // Check if week data is ready
    const isWeekDataReady = useCallback((weekKey) => {
        return !!weeksByKey[weekKey];
    }, [weeksByKey]);

    // Subscribe to timesheet documents via REST + WebSocket
    useEffect(() => {
        if (!user?.uid) {
            setTimesheetDocs([]);
            setWeeklySummaries([]);
            setCurrentWeekData({ days: [], entries: [] });
            setIsLoading(false);
            return;
        }

        const fetchData = async () => {
            setIsLoading(true);
            try {
                const sheets = await fetchWeeklySummaries(user.uid, 12);
                handleTimesheetUpdate(sheets);
            } catch (err) {
                console.error('[TimesheetProvider] Fetch error:', err);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();

        // WebSocket listener
        const unsubscribe = subscribeToTimesheets(user.uid, user.companyId, '', (sheets) => {
            handleTimesheetUpdate(sheets);
        });

        return () => {
            if (unsubscribe) unsubscribe();
        };
    }, [user?.uid, user?.companyId]);

    const refresh = useCallback(() => {
        // Clear schedule cache so we always re-fetch fresh schedule data on refresh.
        // This ensures site manager schedule changes are immediately reflected.
        scheduleCacheRef.current = {};
        scheduleLastFetched.current = {};

        // Clear timesheet data cache
        import('../services/timesheetCache').then(({ invalidateUserTimesheets }) => {
            if (user?.uid) invalidateUserTimesheets(user.uid);
        });

        // Force refresh by re-subscribing
        if (unsubscribeRef.current) {
            unsubscribeRef.current();
        }
        setIsLoading(true);
        isInitialLoadRef.current = true;
        const unsubscribe = subscribeUserTimesheets(user?.uid, handleTimesheetUpdate);
        unsubscribeRef.current = unsubscribe;
    }, [user?.uid, handleTimesheetUpdate]);

    // ENHANCEMENT: isLoading is only truly false when timesheets, schedule, AND absences are processed
    const isMetadataReady = !user?.uid || (currentSchedule !== null && absencesMap !== null);
    const finalLoading = isLoading || !isMetadataReady;

    const value = useMemo(() => ({
        timesheetDocs,
        weeklySummaries,
        currentWeekData,
        weeksByKey, // All processed weeks with sessions
        currentSchedule,
        absencesMap,
        isLoading: finalLoading,
        error,
        getWeekDetails, // Get processed week data by week key
        isWeekDataReady, // Check if week data is available
        refresh
    }), [
        timesheetDocs,
        weeklySummaries,
        currentWeekData,
        weeksByKey,
        currentSchedule,
        absencesMap,
        finalLoading,
        error,
        getWeekDetails,
        isWeekDataReady,
        refresh
    ]);

    return (
        <TimesheetContext.Provider value={value}>
            {children}
        </TimesheetContext.Provider>
    );
};

