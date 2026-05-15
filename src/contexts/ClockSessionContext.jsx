/**
 * Clock Session Context Provider
 * Provides real-time clock session data using Firestore listeners
 * All components can subscribe to session data without re-fetching
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { getMyActiveSession, getSessionsForDateRange, normalizeSession } from '../services/timeClock';
import wsClient from '../lib/wsClient';

// Provide default context value to prevent React warnings
const defaultContextValue = {
    sessionDocs: [],
    recentEntries: [],
    isLoading: false,
    error: null,
    getOpenSession: () => null,
    getTodaySessions: () => [],
    refresh: () => { }
};

const ClockSessionContext = createContext(defaultContextValue);

export const useClockSessionContext = () => {
    // With default context value, this will never be null
    // But we keep the check for safety in case provider is not mounted
    const context = useContext(ClockSessionContext);
    return context || defaultContextValue;
};

export const ClockSessionProvider = ({ children }) => {
    const { user } = useAuth();
    const [sessionDocs, setSessionDocs] = useState([]);
    const [recentEntries, setRecentEntries] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const unsubscribeRef = useRef(null);
    const isInitialLoadRef = useRef(true);

    // Process sessions into recent entries
    const updateRecentEntries = useCallback((docs) => {
        try {
            const entries = processRecentEntries(docs, 7);
            setRecentEntries(entries);
        } catch (err) {
            console.error('[ClockSessionProvider] Error processing recent entries:', err);
        }
    }, []);

    // Handle session document updates
    const handleSessionUpdate = useCallback((docs, metadata) => {

        setSessionDocs(docs);
        updateRecentEntries(docs);

        // Mark as loaded after first snapshot (even if from cache)
        // Firestore may return cached data first, then real data
        if (isInitialLoadRef.current) {
            // If metadata exists and data is loaded, consider it ready
            if (metadata && (!metadata.fromCache || docs.length >= 0)) {
                // Set loading to false, even if from cache
                // Real-time updates will still come through
                setTimeout(() => {
                    setIsLoading(false);
                    isInitialLoadRef.current = false;
                }, 100);
            }
        }
    }, [updateRecentEntries]);

    // Subscribe to session documents via REST + WebSocket
    useEffect(() => {
        if (!user?.uid) {
            setSessionDocs([]);
            setRecentEntries([]);
            setIsLoading(false);
            return;
        }

        const fetchData = async () => {
            setIsLoading(true);
            try {
                // Fetch sessions for the last 30 days
                const now = new Date();
                const startDate = new Date(now);
                startDate.setDate(now.getDate() - 30);
                
                const sessions = await getSessionsForDateRange({ 
                    userId: user.uid, 
                    startDate, 
                    endDate: now 
                });
                
                setSessionDocs(sessions);
                // Simple processRecentEntries equivalent for now
                setRecentEntries(sessions.slice(0, 7));
            } catch (err) {
                console.error('[ClockSessionProvider] Fetch error:', err);
                setError(err.message);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();

        // WebSocket listener for real-time updates
        const handleWsUpdate = (data) => {
            if (data.employeeId === user.uid || data.userId === user.uid) {
                fetchData();
            }
        };

        wsClient.on('time-entry:updated', handleWsUpdate);
        wsClient.on('time-entry:created', handleWsUpdate);

        return () => {
            wsClient.off('time-entry:updated', handleWsUpdate);
            wsClient.off('time-entry:created', handleWsUpdate);
        };
    }, [user?.uid]);

    // Get current open session
    const getOpenSession = useCallback(() => {
        return sessionDocs.find(s => s.status === 'open') || null;
    }, [sessionDocs]);

    // Get today's sessions
    const getTodaySessions = useCallback(() => {
        const todayStr = new Date().toISOString().split('T')[0];

        return sessionDocs.filter(s => {
            const date = s.startedAt ? (typeof s.startedAt === 'string' ? s.startedAt : s.startedAt.toISOString()) : '';
            return date.startsWith(todayStr);
        });
    }, [sessionDocs]);

    const refresh = useCallback(() => {
        if (user?.uid) {
            setIsLoading(true);
            const now = new Date();
            const startDate = new Date(now);
            startDate.setDate(now.getDate() - 30);
            
            getSessionsForDateRange({ userId: user.uid, startDate, endDate: now })
                .then(sessions => {
                    setSessionDocs(sessions);
                    setRecentEntries(sessions.slice(0, 7));
                })
                .finally(() => setIsLoading(false));
        }
    }, [user?.uid]);

    const value = React.useMemo(() => ({
        sessionDocs,
        recentEntries,
        isLoading,
        error,
        getOpenSession,
        getTodaySessions,
        refresh
    }), [sessionDocs, recentEntries, isLoading, error, getOpenSession, getTodaySessions, refresh]);

    return (
        <ClockSessionContext.Provider value={value}>
            {children}
        </ClockSessionContext.Provider>
    );
};

