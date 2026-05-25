import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { useAuth } from '../../hooks/useAuth';
import SeatPaymentConfirmationModal from '../modals/SeatPaymentConfirmationModal';
import SeatRequestDetailsModal from '../modals/SeatRequestDetailsModal';
import SeatRequestsPanel from '../seatRequests/SeatRequestsPanel';
import {
    calculateSeatRequestPayment,
    emitSeatRequestEvent,
    fetchSeatRequests,
    updateSeatRequestStatus,
    approveSeatRequest,
} from '../../services/seatRequestService';
import { getBillingSummary, recordSeatTopUp } from '../../services/billing';

const SeatSettingsTab = () => {
    const { user } = useAuth();
    const companyId = user?.companyId?.split('/').pop();

    const [seatRequests, setSeatRequests] = useState([]);
    const [isSeatRequestsLoading, setIsSeatRequestsLoading] = useState(false);
    const [selectedSeatRequest, setSelectedSeatRequest] = useState(null);
    const [isSeatDetailsOpen, setIsSeatDetailsOpen] = useState(false);
    const [isSeatActionProcessing, setIsSeatActionProcessing] = useState(false);
    const [pendingSeatRequestApproval, setPendingSeatRequestApproval] = useState(null);
    const [showSeatPaymentModal, setShowSeatPaymentModal] = useState(false);
    const [seatsToCharge, setSeatsToCharge] = useState(0);
    const [isInTrial, setIsInTrial] = useState(false);

    const loadSeatRequests = useCallback(async () => {
        if (!['siteManager', 'seniorManager'].includes(user?.role) || !companyId) return;
        try {
            setIsSeatRequestsLoading(true);
            const data = await fetchSeatRequests({ limit: 10 });
            setSeatRequests(data);
        } catch (error) {
            console.error('Failed to load seat requests:', error);
            toast.error('Failed to load seat requests');
        } finally {
            setIsSeatRequestsLoading(false);
        }
    }, [companyId, user?.role]);

    useEffect(() => {
        loadSeatRequests();
        const handler = () => loadSeatRequests();
        window.addEventListener('seatRequests:updated', handler);
        return () => window.removeEventListener('seatRequests:updated', handler);
    }, [loadSeatRequests]);

    const handleSeatRequestView = (request) => {
        setSelectedSeatRequest(request);
        setIsSeatDetailsOpen(true);
    };

    const handleSeatRequestAction = async (request, status, notes) => {
        if (!request) return;

        // If approving, check if payment is needed
        if (status === 'approved') {
            try {
                setIsSeatActionProcessing(true);
                const paymentInfo = await calculateSeatRequestPayment(request.id);

                // Check if company is in trial period
                let trialStatus = false;
                try {
                    const billingSummary = await getBillingSummary();
                    trialStatus = billingSummary?.subscriptionStatus === 'trial' && !billingSummary?.isExpired;
                    setIsInTrial(trialStatus);
                } catch (error) {
                    console.warn('Failed to check trial status:', error);
                    setIsInTrial(false);
                }

                // If payment is needed (and not in trial), open payment modal
                if (paymentInfo.seatsToCharge > 0 && !trialStatus) {
                    setPendingSeatRequestApproval({ request, status, notes });
                    setSeatsToCharge(paymentInfo.seatsToCharge);
                    setShowSeatPaymentModal(true);
                    setIsSeatActionProcessing(false);
                    return;
                } else if (paymentInfo.seatsToCharge > 0 && trialStatus) {
                    // In trial - show modal but with free message
                    setPendingSeatRequestApproval({ request, status, notes });
                    setSeatsToCharge(paymentInfo.seatsToCharge);
                    setShowSeatPaymentModal(true);
                    setIsSeatActionProcessing(false);
                    return;
                }
            } catch (error) {
                console.error('Failed to calculate payment:', error);
                toast.error(error?.message || 'Failed to process request');
                setIsSeatActionProcessing(false);
                return;
            }
        }

        // If no payment needed or cancelling, proceed directly
        try {
            setIsSeatActionProcessing(true);
            await updateSeatRequestStatus(request.id, status, {
                notes,
                resolvedById: user?.uid,
                resolvedByName: user?.displayName || user?.email || 'Site Manager',
                resolvedByEmail: user?.email
            });
            toast.success(`Request ${status}.`);
            emitSeatRequestEvent();
        } catch (error) {
            console.error(`Failed to update seat request (${status})`, error);
            toast.error(error?.message || 'Failed to update request');
        } finally {
            setIsSeatActionProcessing(false);
            setIsSeatDetailsOpen(false);
        }
    };

    const handleSeatPaymentConfirm = async (seatQuantity) => {
        if (!pendingSeatRequestApproval) return;

        try {
            setIsSeatActionProcessing(true);
            const { request, status, notes } = pendingSeatRequestApproval;

            // Process payment first (this updates both seatCount and billingSeatQuota)
            // recordSeatTopUp will handle trial status and skip payment if in trial
            const result = await recordSeatTopUp(companyId, seatQuantity, request.id);

            // Check if checkout is required
            if (result && typeof result === 'object' && result.requiresCheckout && result.checkoutUrl) {
                // Redirect to Stripe Checkout
                window.location.href = result.checkoutUrl;
                return;
            }

            // Then approve the request (only if payment was processed directly or in trial)
            // Pass seatsToCharge so the function knows how many were already added
            await updateSeatRequestStatus(request.id, status, {
                notes,
                resolvedById: user?.uid,
                resolvedByName: user?.displayName || user?.email || 'Site Manager',
                resolvedByEmail: user?.email,
                skipBillingUpdate: true, // Flag to skip billing update since we already did it
                seatsToCharge: seatQuantity // Pass the amount that was charged (0 if in trial)
            });

            const message = isInTrial
                ? `Request approved. ${seatQuantity} seat(s) added for free during trial.`
                : `Request approved. ${seatQuantity} seat(s) added and payment processed.`;
            toast.success(message);
            emitSeatRequestEvent();
            setShowSeatPaymentModal(false);
            setPendingSeatRequestApproval(null);
            setIsInTrial(false);
            setIsSeatDetailsOpen(false);
        } catch (error) {
            console.error('Failed to process seat payment:', error);
            toast.error(error?.message || 'Failed to process payment');
        } finally {
            setIsSeatActionProcessing(false);
        }
    };

    const visibleSeatRequests = useMemo(() => seatRequests, [seatRequests]); // Show all or limit? UserListPage limited to 5. The prompt says "show the information inside that tab", usually tabs have more space. I'll show all or maybe 10. The fetch uses limit 10. `visibleSeatRequests` in UserListPage was slice(0, 5). I'll keep it simple and just show what's fetched for now. `SeatRequestsPanel` might handle lists.

    if (!['siteManager', 'seniorManager'].includes(user?.role)) {
        return (
            <div className="p-8 text-center text-text-secondary">
                You do not have permission to view seat requests.
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="bg-white rounded-base p-6 shadow-lg">
                {/* Removing title prop if passed to internal panel to avoid double headers if needed, but keeping it for now as it was in UserListPage */}
                <SeatRequestsPanel
                    requests={visibleSeatRequests}
                    isLoading={isSeatRequestsLoading}
                    onRefresh={loadSeatRequests}
                    onView={handleSeatRequestView}
                    onCancel={(req) => handleSeatRequestAction(req, 'cancelled', 'Cancelled by site manager')}
                    onApprove={(req) => handleSeatRequestAction(req, 'approved', 'Approved by site manager')}
                    title="Team Seat Requests"
                />
            </div>

            {/* Modals */}
            <SeatRequestDetailsModal
                isOpen={isSeatDetailsOpen}
                onClose={() => setIsSeatDetailsOpen(false)}
                request={selectedSeatRequest}
                onApprove={(req) => handleSeatRequestAction(req, 'approved', 'Approved by site manager')}
                onCancel={(req) => handleSeatRequestAction(req, 'cancelled', 'Cancelled by site manager')}
                loadingAction={isSeatActionProcessing}
            />
            {pendingSeatRequestApproval && (
                <SeatPaymentConfirmationModal
                    isOpen={showSeatPaymentModal}
                    onClose={() => {
                        setShowSeatPaymentModal(false);
                        setPendingSeatRequestApproval(null);
                        setSeatsToCharge(0);
                        setIsInTrial(false);
                    }}
                    onConfirm={handleSeatPaymentConfirm}
                    user={{
                        fullName: pendingSeatRequestApproval.request?.requestedBy?.name || 'Seat Request',
                        email: pendingSeatRequestApproval.request?.requestedBy?.email || user?.email || 'employee@gmail.com',
                        role: 'Seat Request Approval'
                    }}
                    isTrial={isInTrial}
                    initialSeatCount={seatsToCharge}
                />
            )}
        </div>
    );
};

export default SeatSettingsTab;
