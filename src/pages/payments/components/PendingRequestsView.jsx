import React, { useState, useEffect, useCallback, useRef } from 'react';
import PaymentVerificationCard from './PaymentVerificationCard';
import { getPendingOfflinePaymentRequests } from '../../../services/offlinePaymentService';
import { Loader2 } from 'lucide-react';

import { useCache } from '../../../contexts/CacheContext';

const PendingRequestsView = ({ onRefresh }) => {
    const { getItem, setItem } = useCache();
    const CACHE_KEY = 'admin_pending_payment_requests';

    const [requests, setRequests] = useState(() => getItem(CACHE_KEY) || []);
    const [isLoading, setIsLoading] = useState(!getItem(CACHE_KEY));
    const [error, setError] = useState(null);
    const hasLoadedOnce = useRef(false);
    const onRefreshRef = useRef(onRefresh);
    onRefreshRef.current = onRefresh;

    const loadRequests = useCallback(async () => {
        try {
            setError(null);
            const pendingRequests = await getPendingOfflinePaymentRequests();
            setRequests(pendingRequests);
            setItem(CACHE_KEY, pendingRequests, 10 * 60 * 1000); // 10 mins cache
            hasLoadedOnce.current = true;
        } catch (err) {
            console.error('Failed to load pending requests:', err);
            if (!hasLoadedOnce.current) setError(err);
        } finally {
            setIsLoading(false);
        }
    }, [setItem]);

    useEffect(() => {
        loadRequests();

        const handleRefresh = () => {
            loadRequests();
            onRefreshRef.current?.();
        };
        window.addEventListener('offlinePayments:updated', handleRefresh);

        return () => {
            window.removeEventListener('offlinePayments:updated', handleRefresh);
        };
    }, []); // Run once on mount - loadRequests is stable, onRefresh from parent

    return (
        <div className="bg-white p-4xl rounded-base shadow-lg flex flex-col gap-xl">
            {/* Title and Subtitle */}
            <div>
                <h3 className="text-[20px] font-semibold text-text-primary">Pending Offline Payment Verification</h3>
                <p className="text-base text-text-secondary mt-xs">
                    Site managers have submitted these offline payments for verification. Approve to activate their dashboard access.
                </p>
            </div>

            {/* List of Requests */}
            <div className="space-y-md">
                {isLoading ? (
                    <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-text-accent-purple" />
                        <span className="ml-2 text-sm text-text-secondary">Loading pending requests...</span>
                    </div>
                ) : error ? (
                    <div className="text-center py-8">
                        <p className="text-sm text-red-600">Failed to load pending requests. Please try again.</p>
                    </div>
                ) : requests.length === 0 ? (
                    <div className="text-center py-8">
                        <p className="text-sm text-text-secondary">No pending payment verification requests.</p>
                    </div>
                ) : (
                    requests.map(req => (
                        <PaymentVerificationCard
                            key={req.id}
                            request={{
                                id: req.id,
                                company: req.companyName,
                                details: `£${req.amount.toFixed(2)} via ${req.paymentMethod}`,
                                status: req.status,
                                submittedDate: req.submittedDate,
                                evidence: req.paymentEvidence,
                                notes: req.additionalNotes,
                                companyId: req.companyId,
                                seatCount: req.seatCount,
                                amount: req.amount
                            }}
                        />
                    ))
                )}
            </div>
        </div>
    );
};

export default PendingRequestsView;