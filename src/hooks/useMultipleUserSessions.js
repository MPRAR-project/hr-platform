import React, { useState, useEffect, useRef } from 'react';
import wsClient from '../lib/wsClient';
import { getSessionsForDateRange } from '../services/timeClock';

/**
 * Hook for subscribing to multiple users' sessions in real-time
 * Optimizes performance by consuming one stream for the company
 * and filtering in memory, rather than opening N connections.
 * 
 * @param {Array<string>} userIds - Array of user IDs to filter for
 * @param {string} companyId - Company ID to scope the listener
 * @returns {Object} { sessionsByUser, isLoading, error }
 */
export function useMultipleUserSessions(userIds = [], companyId = null) {
    const isMounted = useRef(true);

    useEffect(() => {
        isMounted.current = true;
        return () => { isMounted.current = false; };
    }, []);

    const [rawSessions, setRawSessions] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    // REST Polling + WebSocket listener for the company
    useEffect(() => {
        if (!companyId) {
            if (isMounted.current) {
                setRawSessions([]);
                setIsLoading(false);
            }
            return;
        }

        const fetchSessions = async () => {
            try {
                if (!isMounted.current) return;
                setError(null);

                const cleanCompanyId = companyId.replace('companies/', '');
                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                thirtyDaysAgo.setHours(0, 0, 0, 0);

                const allSessions = await getSessionsForDateRange({
                    companyId: cleanCompanyId,
                    startDate: thirtyDaysAgo
                });

                if (!isMounted.current) return;

                // Sort descending by startedAt
                allSessions.sort((a, b) => {
                    const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0;
                    const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0;
                    return bTime - aTime;
                });

                setRawSessions(allSessions);
                setIsLoading(false);
            } catch (err) {
                console.error('[useMultipleUserSessions] Fetch Error:', err);
                if (isMounted.current) {
                    setError(err);
                    setIsLoading(false);
                }
            }
        };

        fetchSessions();

        // Polling as fallback for real-time
        const interval = setInterval(fetchSessions, 60000); // 1 minute

        // WebSocket listener
        const wsHandler = () => fetchSessions();
        wsClient.on('session:updated', wsHandler);
        wsClient.on('timesheet:updated', wsHandler);

        // Focus listener for fresh data when coming back to tab
        const onFocus = () => fetchSessions();
        window.addEventListener('focus', onFocus);

        return () => {
            clearInterval(interval);
            wsClient.off('session:updated', wsHandler);
            wsClient.off('timesheet:updated', wsHandler);
            window.removeEventListener('focus', onFocus);
        };
    }, [companyId]);

    // Filter and group sessions in memory when rawSessions OR userIds change
    const sessionsByUser = React.useMemo(() => {
        if (!rawSessions.length || !userIds || userIds.length === 0) return {};

        const grouped = {};
        // Initialize empty arrays for requested users
        userIds.forEach(uid => {
            grouped[uid] = [];
        });

        // Distribute sessions
        rawSessions.forEach(session => {
            if (grouped[session.userId] !== undefined) {
                grouped[session.userId].push(session);
            }
        });

        return grouped;
    }, [rawSessions, JSON.stringify(userIds)]); // Stringify userIds to prevent infinite loop from array reference changes

    return {
        sessionsByUser,
        isLoading,
        error
    };
}
