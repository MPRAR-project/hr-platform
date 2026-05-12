import { useState, useEffect, useRef, useCallback } from 'react';
import apiClient from '../api/apiClient';
import { useAuth } from './useAuth';

/**
 * Genuinely refactored useActiveSessions hook
 * Communicates with the Central Backend (Postgres) instead of Firebase Firestore.
 */

export function useActiveSessions() {
    const { user } = useAuth();
    const [activeUsers, setActiveUsers] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const pollIntervalRef = useRef(null);

    const userCompanyId = user?.companyId || null;
    const cleanCompanyId = userCompanyId?.replace('companies/', '');

    const fetchActiveSessions = useCallback(async () => {
        if (!cleanCompanyId) return;
        
        try {
            const response = await apiClient.get(`/hr/${cleanCompanyId}/active-sessions`);
            setActiveUsers(response.data.map(session => {
                const startedAt = new Date(session.startedAt);
                const now = new Date();
                const elapsedMs = now - startedAt;
                const elapsedMinutes = Math.floor(elapsedMs / 60000);
                const hours = Math.floor(elapsedMinutes / 60);
                const minutes = elapsedMinutes % 60;

                return {
                    sessionId: session.id,
                    userId: session.userId,
                    userName: session.userName || 'Unknown User',
                    primaryRole: session.primaryRole || 'Employee',
                    clockInTime: startedAt,
                    clockInTimeFormatted: startedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                    elapsedTime: `${hours}h ${minutes}m`,
                    status: session.status
                };
            }));
            setError(null);
            setIsLoading(false);
        } catch (err) {
            console.error('Error fetching active sessions:', err);
            setError(err.message);
            if (isLoading) setIsLoading(false);
        }
    }, [cleanCompanyId, isLoading]);

    useEffect(() => {
        if (!cleanCompanyId) {
            setIsLoading(false);
            return;
        }

        fetchActiveSessions();
        pollIntervalRef.current = setInterval(fetchActiveSessions, 30000);

        return () => {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        };
    }, [cleanCompanyId, fetchActiveSessions]);

    return {
        activeUsers,
        isLoading,
        error,
        refresh: fetchActiveSessions,
        count: activeUsers.length
    };
}
