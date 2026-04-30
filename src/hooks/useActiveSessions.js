/**
 * Hook to fetch and monitor active clock sessions across all company users
 * 
 * This hook retrieves users who are currently clocked in (have an open session)
 * and provides real-time updates whenever session status changes.
 * 
 * Returns:
 * - activeUsers: Array of users currently clocked in with their session details
 * - isLoading: Boolean indicating if data is being fetched
 * - error: Error message if something goes wrong
 * - refresh: Function to manually refresh the active users list
 */

import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { useCallback, useEffect, useRef, useState } from 'react';
import { db } from '../firebase/client';
import { useAuth } from './useAuth';

export function useActiveSessions() {
    const { user } = useAuth();
    const [activeUsers, setActiveUsers] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const unsubscribeRef = useRef(null);

    // Get user's company to filter sessions
    const userCompanyId = user?.companyId || null;

    // Extract just the ID if it has the "companies/" prefix (e.g., "companies/ABC123" -> "ABC123")
    const companyIdWithoutPrefix = userCompanyId?.includes('/')
        ? userCompanyId.split('/')[1]
        : userCompanyId;

    // Function to transform session data into user-friendly format
    const formatActiveUser = useCallback(async (sessionDoc) => {
        const data = sessionDoc.data();

        // Only include sessions that are open (not ended)
        if (data.status !== 'open') {
            return null;
        }

        // Convert Firestore Timestamp to JavaScript Date
        let startedAtDate = null;
        if (data.startedAt) {
            if (data.startedAt.toDate) {
                // Firestore Timestamp object
                startedAtDate = data.startedAt.toDate();
            } else if (data.startedAt instanceof Date) {
                // Already a Date
                startedAtDate = data.startedAt;
            } else if (typeof data.startedAt === 'string') {
                // ISO string
                startedAtDate = new Date(data.startedAt);
            }
        }

        // Calculate elapsed time (in hours and minutes)
        let elapsedTime = '0h 0m';
        if (startedAtDate && !isNaN(startedAtDate.getTime())) {
            const now = new Date();
            const elapsedMs = now - startedAtDate;
            const elapsedMinutes = Math.floor(elapsedMs / 60000);
            const hours = Math.floor(elapsedMinutes / 60);
            const minutes = elapsedMinutes % 60;
            elapsedTime = `${hours}h ${minutes}m`;
        }

        // Try to fetch actual user name from users collection
        let displayName = data.userName;
        let primaryRole = data.primaryRole || null;
        const userId = data.userId;

        if (userId) {
            try {
                const userDocRef = doc(db, 'users', userId);
                const userDocSnap = await getDoc(userDocRef);
                if (userDocSnap.exists()) {
                    const userData = userDocSnap.data();
                    if (!displayName) {
                        displayName = userData.firstName && userData.lastName
                            ? `${userData.firstName} ${userData.lastName}`
                            : userData.firstName || userData.lastName || userData.displayName || userId;
                        console.log('[useActiveSessions] Fetched user name:', { userId, displayName });
                    }
                    // Always prefer the primaryRole stored on the user document
                    primaryRole = userData.primaryRole || primaryRole;
                }
            } catch (err) {
                console.warn('[useActiveSessions] Failed to fetch user details:', err);
            }
        }

        // Fallback if still no display name
        if (!displayName) {
            displayName = userId || 'Unknown';
        }

        return {
            sessionId: sessionDoc.id,
            userId: userId,
            userName: displayName,
            userEmail: data.userEmail || '',
            userRole: data.userRole || 'Employee',
            primaryRole: primaryRole || data.userRole || 'Employee',
            clockInTime: startedAtDate,
            clockInTimeFormatted: startedAtDate
                ? startedAtDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : 'Unknown',
            elapsedTime: elapsedTime,
            location: data.location || 'Not specified',
            siteId: data.siteId || null,
            companyId: data.companyId || null,
            status: data.status || 'open'
        };
    }, []);

    // Subscribe to active sessions in real-time
    useEffect(() => {
        // Don't subscribe if no user or company
        if (!user || !userCompanyId) {
            setActiveUsers([]);
            setIsLoading(false);
            console.log('[useActiveSessions] Missing user or company:', { user: !!user, userCompanyId });
            return;
        }

        console.log('[useActiveSessions] Setting up real-time listener for company:', userCompanyId);
        console.log('[useActiveSessions] Company ID without prefix:', companyIdWithoutPrefix);
        console.log('[useActiveSessions] Looking for sessions with companyId:', companyIdWithoutPrefix);

        try {
            // Query for all open sessions in the user's company
            // Support both formats by checking if companyId matches either the raw ID or the prefixed ID
            const targetCompanyIds = [companyIdWithoutPrefix];
            if (userCompanyId && userCompanyId !== companyIdWithoutPrefix) {
                targetCompanyIds.push(userCompanyId);
            }

            const sessionsQuery = query(
                collection(db, 'timeClockSessions'),
                where('status', '==', 'open'),
                where('companyId', 'in', targetCompanyIds)
            );

            // Set up real-time listener
            unsubscribeRef.current = onSnapshot(
                sessionsQuery,
                async (snapshot) => {
                    console.log('[useActiveSessions] Received snapshot with', snapshot.docs.length, 'active sessions');

                    if (snapshot.docs.length > 0) {
                        console.log('[useActiveSessions] Sample session data:', snapshot.docs[0].data());
                    }

                    try {
                        // Transform session documents into active user format (async)
                        const formatPromises = snapshot.docs.map(doc => formatActiveUser(doc));
                        const formattedResults = await Promise.all(formatPromises);

                        const users = formattedResults
                            .filter(user => user !== null) // Remove null entries (closed sessions)
                            .sort((a, b) => {
                                // Sort by clock-in time (most recent first)
                                if (!a.clockInTime || !b.clockInTime) return 0;
                                return b.clockInTime - a.clockInTime;
                            });

                        console.log('[useActiveSessions] Formatted', users.length, 'active users:', users);
                        setActiveUsers(users);
                        setError(null);
                    } catch (err) {
                        console.error('[useActiveSessions] Error processing snapshot:', err);
                        setError('Failed to process active sessions');
                    }
                },
                (err) => {
                    console.error('[useActiveSessions] Firestore listener error:', err);
                    setError(err.message || 'Failed to fetch active sessions');
                }
            );

            // Mark as loaded once listener is set up
            setIsLoading(false);

        } catch (err) {
            console.error('[useActiveSessions] Error setting up listener:', err);
            setError(err.message || 'Failed to set up active sessions listener');
            setIsLoading(false);
        }

        // Cleanup: unsubscribe when component unmounts or dependencies change
        return () => {
            if (unsubscribeRef.current) {
                console.log('[useActiveSessions] Cleaning up listener');
                unsubscribeRef.current();
                unsubscribeRef.current = null;
            }
        };
    }, [user, userCompanyId, companyIdWithoutPrefix, formatActiveUser]);

    // Manual refresh function (though real-time updates should be sufficient)
    const refresh = useCallback(() => {
        console.log('[useActiveSessions] Manual refresh triggered');
        // The listener will automatically get new data
        // This is more of a placeholder for UI purposes
    }, []);

    return {
        activeUsers,
        isLoading,
        error,
        refresh,
        count: activeUsers.length
    };
}
