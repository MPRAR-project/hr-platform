import React, { useState, useEffect, useCallback } from 'react';
import Header from '../../components/layout/Header';
import Tabs from '../../components/ui/Tabs';
import PaymentRecordsView from './components/PaymentRecordsView';
import PendingRequestsView from './components/PendingRequestsView';
import { getPendingOfflinePaymentRequests } from '../../services/offlinePaymentService';

import { useCache } from '../../contexts/CacheContext';

const PaymentsPage = () => {
    const { getItem, setItem } = useCache();
    const CACHE_KEY = 'admin_pending_payment_requests';

    const [activeTab, setActiveTab] = useState('Payment Records');

    const getInitialRequests = () => {
        const cached = getItem(CACHE_KEY);
        if (Array.isArray(cached)) return cached;
        return [];
    };

    const [pendingRequests, setPendingRequests] = useState(getInitialRequests);
    const [isLoadingCount, setIsLoadingCount] = useState(getInitialRequests().length === 0);

    const loadPendingCount = useCallback(async () => {
        try {
            // If we have a cached count, don't show a new loader for it
            const requests = await getPendingOfflinePaymentRequests();
            setPendingRequests(requests);
            setItem(CACHE_KEY, requests, 10 * 60 * 1000);
        } catch (error) {
            console.error('Failed to load pending count:', error);
            // Don't reset if we have a cache
        } finally {
            setIsLoadingCount(false);
        }
    }, [getItem, setItem]);

    useEffect(() => {
        loadPendingCount();

        // Refresh count when tab changes or when requests are updated
        const handleRefresh = () => loadPendingCount();
        window.addEventListener('offlinePayments:updated', handleRefresh);

        return () => {
            window.removeEventListener('offlinePayments:updated', handleRefresh);
        };
    }, [loadPendingCount]);

    const tabOptions = [
        { label: 'Payment Records' },
        { label: isLoadingCount ? 'Pending...' : `Pending (${pendingRequests.length})` }
    ];

    return (
        <>
            <Header title="Payments" subtitle="Review payments and pending requests." />
            <div className="p-3xl space-y-3xl">
                <Tabs tabs={tabOptions} onTabChange={setActiveTab} />

                {activeTab === 'Payment Records' && <PaymentRecordsView />}

                {activeTab.startsWith('Pending') && (
                    <PendingRequestsView
                        requests={pendingRequests}
                        isLoading={isLoadingCount}
                        onRefresh={loadPendingCount}
                    />
                )}
            </div>
        </>
    );
};

export default PaymentsPage;