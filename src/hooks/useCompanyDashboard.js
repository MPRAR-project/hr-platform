import { useState, useEffect, useRef } from 'react';
import apiClient from '../api/apiClient';
import { useAuth } from './useAuth';

/**
 * Genuinely refactored useCompanyDashboard hook
 * Communicates with the Central Backend (Postgres) instead of Firebase Firestore.
 * Uses polling to simulate real-time updates.
 */

export function useCompanyDashboard(companyId) {
    const { user: authUser } = useAuth();
    const [data, setData] = useState({
        teamMembers: [],
        totalUsers: 0,
        totalSeats: 0,
        monthlyBill: 0,
        pricePerSeat: 5,
        seatDeficit: 0,
        lastPaymentStatus: '—',
        lastPaymentDate: '—',
        nextBilling: '—',
        hasData: false,
        lastUpdated: null,
        seatUsageCount: 0,
        pendingInvites: 0,
        paymentMethod: '—',
        joinDate: '—'
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const pollIntervalRef = useRef(null);

    const fetchDashboard = async () => {
        if (!companyId) return;
        const cleanCompanyId = companyId.replace('companies/', '');
        
        try {
            const response = await apiClient.get(`/hr/${cleanCompanyId}/dashboard`);
            setData(prev => ({
                ...prev,
                ...response.data,
                hasData: true,
                lastUpdated: new Date().toISOString()
            }));
            setLoading(false);
            setError(null);
        } catch (err) {
            console.error('Error fetching dashboard data:', err);
            setError(err);
            if (loading) setLoading(false);
        }
    };

    useEffect(() => {
        if (!companyId) {
            setLoading(false);
            return;
        }

        fetchDashboard();

        // Polling for "real-time" updates (every 30 seconds)
        pollIntervalRef.current = setInterval(fetchDashboard, 30000);

        return () => {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        };
    }, [companyId]);

    return { data, loading, error, refresh: fetchDashboard };
}
