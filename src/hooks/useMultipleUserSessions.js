/**
 * Real-time hook for subscribing to multiple users' clock sessions
 * Uses a SINGLE Firestore onSnapshot listener for the company to prevent connection exhaustion
 */

import React, { useState, useEffect, useRef } from 'react';
import { collection, query, where, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '../firebase/client';

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
    // SessionsByUser is now derived from rawSessions via useMemo

    // Use a ref to track if we're mounted
    const isMounted = useRef(true);

    useEffect(() => {
        isMounted.current = true;
        return () => { isMounted.current = false; };
    }, []);

    // Helper to group sessions by user
    const groupSessions = (allSessions) => {
        const grouped = {};
        // Initialize empty arrays for requested users
        userIds.forEach(uid => {
            grouped[uid] = [];
        });

        // Distribute sessions
        allSessions.forEach(session => {
            // Only add if this user is in our requested list
            if (grouped[session.userId] !== undefined) {
                grouped[session.userId].push(session);
            }
        });

        return grouped;
    };

    const [rawSessions, setRawSessions] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    // Single subscription for the company - INDEPENDENT of userIds
    useEffect(() => {
        // If no companyId, we can't fetch.
        if (!companyId) {
            if (isMounted.current) {
                setRawSessions([]);
                setIsLoading(false);
            }
            return;
        }

        console.log(`[useMultipleUserSessions] Setting up SINGLE listener for Company: ${companyId}`);
        setIsLoading(true);
        setError(null);

        // Normalize companyId (handle "companies/xyz" format)
        const cleanCompanyId = companyId.includes('/') ? companyId.split('/')[1] : companyId;
        const fullCompanyId = `companies/${cleanCompanyId}`;

        // Optimization: Only fetch last 30 days instead of 90 for better performance
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        thirtyDaysAgo.setHours(0, 0, 0, 0);

        // Query: All sessions for this company started recently
        const sessionQuery = query(
            collection(db, 'timeClockSessions'),
            where('companyId', 'in', [cleanCompanyId, fullCompanyId]),
            where('startedAt', '>=', Timestamp.fromDate(thirtyDaysAgo))
        );

        const unsubscribe = onSnapshot(
            sessionQuery,
            (snapshot) => {
                if (!isMounted.current) return;

                const allSessions = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));

                // Sort descending
                allSessions.sort((a, b) => {
                    const aTime = a.startedAt?.toDate ? a.startedAt.toDate().getTime() : 0;
                    const bTime = b.startedAt?.toDate ? b.startedAt.toDate().getTime() : 0;
                    return bTime - aTime;
                });

                console.log(`[useMultipleUserSessions] Received ${allSessions.length} raw company sessions.`);
                setRawSessions(allSessions);
                setIsLoading(false);
            },
            (err) => {
                console.error('[useMultipleUserSessions] Listener Error:', err);
                if (isMounted.current) {
                    // Return empty array on index building errors to prevent UI crashes
                    if (err.code === 'failed-precondition') {
                        console.warn('[useMultipleUserSessions] Index is still building. This is expected during deployment.');
                        setRawSessions([]);
                        setError(null); // Don't show error to user during index building
                    } else {
                        setError(err);
                    }
                    setIsLoading(false);
                }
            }
        );

        return () => {
            console.log('[useMultipleUserSessions] Unsubscribing company listener');
            unsubscribe();
        };

    }, [companyId]); // Only re-subscribe if company changes

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
