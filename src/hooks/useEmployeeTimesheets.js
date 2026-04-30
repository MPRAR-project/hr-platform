/**
 * Real-time hook for fetching employee timesheets using Firestore listeners
 * Replaces async fetch calls with onSnapshot subscriptions
 * Processes data client-side - no Firestore queries after initial load
 */

import { useState, useEffect, useRef } from 'react';
// import { subscribeUserTimesheets, processWeeklySummaries } from '../services/firestoreSubscriptions'; // REPLACED
import { subscribeWeeklySummaries } from '../services/summarySubscriptions';

/**
 * Hook for subscribing to any user's timesheets in real-time
 * @param {string} userId - User ID to subscribe to
 * @param {Object} options - Options object
 * @param {number} options.maxWeeks - Maximum number of weeks to process (default: 12)
 * @returns {Object} { data, loading, error, lastUpdate }
 */
// Stable reference for deprecated return to prevent infinite loops in consumers (e.g. useEffect dependencies)
const EMPTY_ARRAY = [];

export function useEmployeeTimesheets(userId, options = {}) {
    const { maxWeeks = 12 } = options;

    // ... (rest of hook)

    const [weeklySummaries, setWeeklySummaries] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [lastUpdate, setLastUpdate] = useState(null);

    const unsubscribeRef = useRef(null);

    useEffect(() => {
        // Handle empty userId case inside effect
        if (!userId) {
            setWeeklySummaries([]);
            setIsLoading(false);
            setError(null);
            return;
        }

        console.log(`[useEmployeeTimesheets] Setting up HYBRID subscription for: ${userId}`);
        setIsLoading(true);
        setError(null);

        // 5s Timeout Safety for Loading State
        const timeoutId = setTimeout(() => {
            if (isLoading) setIsLoading(false);
        }, 5000);

        let isMounted = true;


        // Initialize async pattern for subscription
        subscribeWeeklySummaries(userId, async (summaries) => {
            if (!isMounted) return;

            try {
                // Fetch context to know current configuration
                // We do this inside the callback to ensure we always use the latest config logic if it changes
                const { getUserWeekContext } = await import('../services/timesheets');
                const { unifyTimesheetsByEntries } = await import('../services/timesheetUnification');

                const { weekStartDay } = await getUserWeekContext(userId);

                // UNIFICATION UPGRADE: Use Entry-Driven Discovery
                // Instead of trusting document boundaries, we rebuild the list from entries.
                // This ensures "Ghost Weeks" (with entries but missing/misaligned docs) are discovered.
                const unified = unifyTimesheetsByEntries(summaries, weekStartDay);

                // Filter maxWeeks
                const sliced = unified.slice(0, maxWeeks);

                setWeeklySummaries(sliced);
                setLastUpdate(new Date());
                setIsLoading(false);
            } catch (err) {
                console.error('[useEmployeeTimesheets] Error processing update:', err);
                // Fallback to raw if processing fails
                // Note: Without unification, raw summaries might be messy, but better than crash
                setWeeklySummaries(summaries.slice(0, maxWeeks));
                setIsLoading(false);
            }
        }).then(unsub => {
            if (isMounted) {
                unsubscribeRef.current = unsub;
            } else {
                // If unmounted before promise resolved, cleanup immediately
                unsub();
            }
        }).catch(err => {
            console.error('[useEmployeeTimesheets] Subscription failed:', err);
            if (isMounted) {
                setError(err);
                setIsLoading(false);
            }
        });

        return () => {
            isMounted = false;
            clearTimeout(timeoutId);
            if (unsubscribeRef.current) {
                try {
                    unsubscribeRef.current();
                } catch (e) {
                    console.warn('[useEmployeeTimesheets] Cleanup failed:', e);
                }
            }
            unsubscribeRef.current = null;
        };
    }, [userId, maxWeeks]);

    return {
        data: weeklySummaries,
        timesheetDocs: EMPTY_ARRAY, // DEPRECATED: Raw docs not available in optimized mode
        loading: isLoading,
        error,
        lastUpdate
    };
}
