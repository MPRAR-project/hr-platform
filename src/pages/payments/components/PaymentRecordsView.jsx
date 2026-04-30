import React, { useState, useEffect, useCallback, useRef } from 'react';
import PaymentRecordRow from './PaymentRecordRow';
import { getAllPaymentRecords } from '../../../services/offlinePaymentService';
import { Loader2 } from 'lucide-react';

import { useCache } from '../../../contexts/CacheContext';

const PaymentRecordsView = () => {
    const { getItem, setItem } = useCache();
    const CACHE_KEY = 'admin_payment_records';

    const [records, setRecords] = useState(() => getItem(CACHE_KEY) || []);
    const [isLoading, setIsLoading] = useState(!getItem(CACHE_KEY));
    const [error, setError] = useState(null);
    const hasLoadedOnce = useRef(false);

    const loadRecords = useCallback(async () => {
        try {
            setError(null);
            const allRecords = await getAllPaymentRecords();
            setRecords(allRecords);
            setItem(CACHE_KEY, allRecords, 10 * 60 * 1000); // 10 mins cache
            hasLoadedOnce.current = true;
        } catch (err) {
            console.error('Failed to load payment records:', err);
            if (!hasLoadedOnce.current) setError(err);
        } finally {
            setIsLoading(false);
        }
    }, [setItem]);

    useEffect(() => {
        loadRecords();

        const handleRefresh = () => loadRecords();
        window.addEventListener('offlinePayments:updated', handleRefresh);

        return () => {
            window.removeEventListener('offlinePayments:updated', handleRefresh);
        };
    }, []);

    return (
        <div className="bg-white p-4 md:p-4xl rounded-base shadow-lg flex flex-col gap-xl">
            {/* Title and Subtitle */}
            <div>
                <h3 className="text-lg md:text-[20px] font-semibold text-text-primary">All Payment Records</h3>
                <p className="text-sm md:text-base text-text-secondary mt-xs">
                    Automatic payments from Stripe, website, and cardless are recorded automatically. Offline payments require manual verification.
                </p>
            </div>

            {/* Scrollable Table Container */}
            <div className="overflow-x-auto scrollbar-custom -mx-4 md:mx-0">
                <div className="inline-block min-w-full align-middle px-4 md:px-0">
                    {/* Header Row */}
                    <div className="flex justify-between items-center py-base border-b border-border-primary min-w-[800px]">
                        <span className="w-[160px] text-xs md:text-base font-medium text-text-secondary uppercase text-center">Company</span>
                        <span className="w-[100px] text-xs md:text-base font-medium text-text-secondary uppercase text-center">Amount</span>
                        <span className="w-[120px] text-xs md:text-base font-medium text-text-secondary uppercase text-center">Method</span>
                        <span className="w-[100px] text-xs md:text-base font-medium text-text-secondary uppercase text-center">Type</span>
                        <span className="w-[100px] text-xs md:text-base font-medium text-text-secondary uppercase text-center">Due Date</span>
                        <span className="w-[100px] text-xs md:text-base font-medium text-text-secondary uppercase text-center">Paid Date</span>
                        <span className="w-[100px] text-xs md:text-base font-medium text-text-secondary uppercase text-center">Status</span>
                    </div>

                    {/* List of Records */}
                    <div className="space-y-md py-4 min-w-[800px]">
                        {isLoading ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="h-6 w-6 animate-spin text-text-accent-purple" />
                                <span className="ml-2 text-sm text-text-secondary">Loading payment records...</span>
                            </div>
                        ) : error ? (
                            <div className="text-center py-8">
                                <p className="text-sm text-red-600">Failed to load payment records. Please try again.</p>
                            </div>
                        ) : records.length === 0 ? (
                            <div className="text-center py-8">
                                <p className="text-sm text-text-secondary">No payment records found.</p>
                            </div>
                        ) : (
                            records.map((rec) => <PaymentRecordRow key={rec.id} record={rec} />)
                        )}
                    </div>
                </div>
            </div>

            {/* Mobile Scroll Hint */}
            <p className="text-xs text-text-secondary text-center md:hidden">
                ← Scroll horizontally to view all columns →
            </p>
        </div>
    );
};

export default PaymentRecordsView;