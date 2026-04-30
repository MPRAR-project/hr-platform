/**
 * Clock Session Context Provider
 * Provides real-time clock session data using Firestore listeners
 * All components can subscribe to session data without re-fetching
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { subscribeUserSessions, processRecentEntries } from '../services/firestoreSubscriptions';

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

    // Subscribe to session documents
    useEffect(() => {
        if (!user?.uid) {
            setSessionDocs([]);
            setRecentEntries([]);
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        isInitialLoadRef.current = true;

        // Fallback timeout to ensure loading stops after reasonable time
        const timeoutId = setTimeout(() => {
            if (isInitialLoadRef.current) {
                setIsLoading(false);
                isInitialLoadRef.current = false;
            }
        }, 10000); // 10 second timeout

        const unsubscribe = subscribeUserSessions(user.uid, handleSessionUpdate);

        unsubscribeRef.current = unsubscribe;

        return () => {
            clearTimeout(timeoutId);
            if (unsubscribeRef.current) {
                unsubscribeRef.current();
                unsubscribeRef.current = null;
            }
        };
        // Only depend on user.uid - handleSessionUpdate is stable due to useCallback
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.uid]);

    // Get current open session
    const getOpenSession = useCallback(() => {
        return sessionDocs.find(s => s.status === 'open') || null;
    }, [sessionDocs]);

    // Get today's sessions
    const getTodaySessions = useCallback(() => {
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        return sessionDocs.filter(s => {
            const startedAt = s.startedAt?.toDate ? s.startedAt.toDate() : null;
            if (!startedAt) return false;
            const sessionDate = `${startedAt.getFullYear()}-${String(startedAt.getMonth() + 1).padStart(2, '0')}-${String(startedAt.getDate()).padStart(2, '0')}`;
            return sessionDate === todayStr;
        });
    }, [sessionDocs]);

    const refresh = useCallback(() => {
        // Force refresh by re-subscribing
        if (unsubscribeRef.current) {
            unsubscribeRef.current();
        }
        setIsLoading(true);
        isInitialLoadRef.current = true;
        const unsubscribe = subscribeUserSessions(user?.uid, handleSessionUpdate);
        unsubscribeRef.current = unsubscribe;
    }, [user?.uid, handleSessionUpdate]);

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

