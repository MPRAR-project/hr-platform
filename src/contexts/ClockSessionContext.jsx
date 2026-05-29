// @refresh reset
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
    const { user, isLoading: isAuthLoading, companySettings } = useAuth();
    const [sessionDocs, setSessionDocs] = useState([]);
    const [recentEntries, setRecentEntries] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const unsubscribeRef = useRef(null);
    const isInitialLoadRef = useRef(true);

    // Derive per-day hours from company settings (used for overtime threshold)
    const perDayHours = companySettings?.perDayHours || 8;

    // Process sessions into recent entries
    const updateRecentEntries = useCallback((docs) => {
        try {
            const entries = processRecentEntries(docs, 7, perDayHours);
            setRecentEntries(entries);
        } catch (err) {
            console.error('[ClockSessionProvider] Error processing recent entries:', err);
        }
    }, [perDayHours]);

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
        // Wait for auth bootstrap to complete before making any API calls.
        // Auth restores `user` from localStorage cache immediately, but the
        // in-memory access token is only set after the async bootstrap finishes.
        // Fetching before that completes causes a 401 on every page load.
        if (isAuthLoading) return;

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
                setRecentEntries(processRecentEntries(sessions, 7, perDayHours));
            } catch (err) {
                console.error('[ClockSessionProvider] Fetch error:', err);
                setError(err.message);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();

        // WebSocket listener for real-time clock updates
        // Backend broadcasts 'clock:in' and 'clock:out' — match those event names
        const handleWsUpdate = (data) => {
            if (data.employeeId === user.uid || data.employeeId === user.userId || data.userId === user.uid) {
                fetchData();
            }
        };

        wsClient.on('clock:in', handleWsUpdate);
        wsClient.on('clock:out', handleWsUpdate);
        wsClient.on('timesheet:updated', handleWsUpdate);

        return () => {
            wsClient.off('clock:in', handleWsUpdate);
            wsClient.off('clock:out', handleWsUpdate);
            wsClient.off('timesheet:updated', handleWsUpdate);
        };
    }, [user?.uid, isAuthLoading]);

    // Get current open session
    const getOpenSession = useCallback(() => {
        return sessionDocs.find(s => s.status === 'open') || null;
    }, [sessionDocs]);

    // Get today's sessions — uses LOCAL date so day boundaries match the user's timezone
    const getTodaySessions = useCallback(() => {
        const now = new Date();
        const todayLocalStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        return sessionDocs.filter(s => {
            if (!s.startedAt) return false;
            const d = new Date(s.startedAt);
            const localStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            return localStr === todayLocalStr;
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
                    setRecentEntries(processRecentEntries(sessions, 7, perDayHours));
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function processRecentEntries(sessions = [], limit = 7, perDayHours = 8) {
  if (!Array.isArray(sessions)) return [];

  // Group sessions by LOCAL date so the day boundary matches the user's timezone
  const groups = {};

  // Sort sessions descending by startedAt
  const sortedSessions = [...sessions].sort((a, b) => {
    const da = a.startedAt ? new Date(a.startedAt) : new Date(0);
    const db = b.startedAt ? new Date(b.startedAt) : new Date(0);
    return db - da;
  });

  for (const s of sortedSessions) {
    if (!s.startedAt) continue;
    const startDate = new Date(s.startedAt);
    if (isNaN(startDate.getTime())) continue;

    // Use LOCAL date string so sessions group by the user's local day, not UTC
    const localDate = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
    if (!groups[localDate]) {
      groups[localDate] = [];
    }
    groups[localDate].push(s);
  }
  
  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dailyLimitMins = (perDayHours || 8) * 60;

  const entries = Object.keys(groups).slice(0, limit).map(dateKey => {
    const daySessions = groups[dateKey];
    const dateObj = new Date(dateKey + 'T12:00:00'); // noon avoids DST shift at midnight

    const dayName = daysOfWeek[dateObj.getDay()] || 'Unknown';
    const dateStr = `${months[dateObj.getMonth()]} ${dateObj.getDate()}`;

    let totalMins = 0;
    let breakMins = 0;

    const clockInOutPairs = daySessions.map(s => {
      totalMins += Number(s.totalMinutes) || 0;
      breakMins += Number(s.breakMinutes) || 0;

      const inTime = s.startedAt
        ? new Date(s.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '—';
      const outTime = s.endedAt
        ? new Date(s.endedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '—';

      return { clockIn: inTime, clockOut: outTime };
    });

    const totalHours = (totalMins / 60).toFixed(1);
    const breakHours = (breakMins / 60).toFixed(1);
    const overtime = totalMins > dailyLimitMins ? ((totalMins - dailyLimitMins) / 60).toFixed(1) : '0.0';
    
    return {
      day: dayName,
      date: dateStr,
      clockInOutPairs,
      totalHours,
      breakHours,
      overtime
    };
  });
  
  return entries;
}

