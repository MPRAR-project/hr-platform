import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import Header from '../../components/layout/Header';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '../../components/shared/Table';
import { useAuth } from '../../hooks/useAuth';
import { useCache } from '../../contexts/CacheContext';
import SeatRequestModal from '../../components/modals/SeatRequestModal';
import SeatRequestDetailsModal from '../../components/modals/SeatRequestDetailsModal';
import {
  createSeatRequest,
  emitSeatRequestEvent,
  fetchSeatRequests,
  updateSeatRequestStatus,
  calculateSeatRequestPayment
} from '../../services/seatRequestService';
import { recordSeatTopUp } from '../../services/billing';
import PaymentConfirmationModal from '../../components/modals/PaymentConfirmationModal';
import { toast } from 'react-toastify';
import { LoadingSkeleton } from '../../components/ui/LoadingSkeleton';

const statusVariant = (status = 'pending') => {
  switch (status.toLowerCase()) {
    case 'approved':
      return 'success';
    case 'cancelled':
      return 'secondary';
    case 'rejected':
      return 'danger';
    default:
      return 'warning';
  }
};

const SeatRequestPage = () => {
  const { user } = useAuth();
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requests, setRequests] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isProcessingAction, setIsProcessingAction] = useState(false);

  const companyPath = user?.companyId || '';
  const companyId = companyPath.includes('/') ? companyPath.split('/')[1] : companyPath;
  const sitePath = user?.siteId || '';
  const siteId = sitePath.includes('/') ? sitePath.split('/')[1] : sitePath;
  const { getItem, setItem } = useCache();

  const loadRequests = useCallback(async () => {
    if (!companyId) return;
    const cacheKey = `seatRequests_${companyId}`;
    const cached = getItem?.(cacheKey);
    if (Array.isArray(cached)) {
      setRequests(cached);
      setIsLoading(false);
    }
    try {
      if (!Array.isArray(cached)) setIsLoading(true);
      const data = await fetchSeatRequests(companyId);
      setRequests(data);
      setItem?.(cacheKey, data, 7 * 60 * 1000);
    } catch (error) {
      console.error('Failed to load seat requests:', error);
      toast.error('Failed to load seat requests');
    } finally {
      setIsLoading(false);
    }
  }, [companyId, getItem, setItem]);

  useEffect(() => {
    loadRequests();
    const handler = () => loadRequests();
    window.addEventListener('seatRequests:updated', handler);
    return () => window.removeEventListener('seatRequests:updated', handler);
  }, [loadRequests]);

  const handleRequestSeats = () => {
    setShowRequestModal(true);
  };

  const handleCreateRequest = async ({ additionalSeats, reason }) => {
    if (!companyId) {
      toast.error('Company information missing. Please contact support.');
      return;
    }
    try {
      await createSeatRequest(
        {
          companyId,
          siteId,
          requestedById: user?.uid,
          requestedByName: user?.displayName || user?.email || 'User',
          requestedByEmail: user?.email
        },
        { additionalSeats, reason }
      );
      toast.success('Seat request submitted.');
      setShowRequestModal(false);
      emitSeatRequestEvent();
    } catch (error) {
      console.error('Failed to submit seat request:', error);
      toast.error(error?.message || 'Failed to submit seat request');
    }
  };

  const handleCancelRequest = async (request) => {
    if (request.status !== 'pending') return;
    if (!window.confirm('Cancel this seat request?')) return;
    try {
      setIsProcessingAction(true);
      await updateSeatRequestStatus(request.id, 'cancelled', {
        resolvedById: user?.uid,
        resolvedByName: user?.displayName || user?.email || 'User',
        resolvedByEmail: user?.email,
        notes: 'Cancelled by requester'
      });
      toast.success('Seat request cancelled.');
      emitSeatRequestEvent();
    } catch (error) {
      console.error('Failed to cancel seat request:', error);
      toast.error(error?.message || 'Failed to cancel request');
    } finally {
      setIsProcessingAction(false);
      setIsDetailsOpen(false);
    }
  };

  const handleViewRequest = (request) => {
    setSelectedRequest(request);
    setIsDetailsOpen(true);
  };

  const pretty = (role = '') =>
    role.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());

  const formattedRequests = useMemo(
    () =>
      requests.map((req) => ({
        ...req,
        requestDate: req.requestedAt?.toDate
          ? req.requestedAt.toDate().toLocaleDateString()
          : '—',
        requestedAtDisplay: req.requestedAt?.toDate
          ? req.requestedAt.toDate().toLocaleString()
          : '—'
      })),
    [requests]
  );

    return (
        <div className="h-screen flex flex-col overflow-hidden">
            <Header
                title={`${pretty(user?.role)} Dashboard`}
                subtitle="Ensure compliance and manage onboarding from one place."
            />

            <div className="flex-1 overflow-y-auto p-3xl space-y-3xl scrollbar-custom">
                <div className="max-w-7xl mx-auto">
                    {/* Page Header */}
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4xl">
                        <h2 className="text-2xl font-bold text-text-primary">Seat Request Management</h2>
                        <Button
                            variant="gradient"
                            icon={ArrowRight}
                            onClick={handleRequestSeats}
                        >
                            Request Additional seats
                        </Button>
                    </div>

                    {/* Seat Requests Table */}
                    <div className="bg-white border border-border-primary rounded-base">
                        <Table>
                            <TableHeader>
                                <TableHeaderCell>Request Date</TableHeaderCell>
                                <TableHeaderCell>Additional Seats</TableHeaderCell>
                                <TableHeaderCell>Reason</TableHeaderCell>
                                <TableHeaderCell>Status</TableHeaderCell>
                                <TableHeaderCell>Requested By</TableHeaderCell>
                                <TableHeaderCell>Actions</TableHeaderCell>
                            </TableHeader>
                            <TableBody>
                                {isLoading && !requests.length ? (
                                    <>
                                        {[1, 2, 3, 4, 5].map((i) => (
                                            <TableRow key={i}>
                                                <TableCell><LoadingSkeleton height="h-4" width="w-24" /></TableCell>
                                                <TableCell><LoadingSkeleton height="h-4" width="w-12" /></TableCell>
                                                <TableCell><LoadingSkeleton height="h-4" width="w-32" /></TableCell>
                                                <TableCell><LoadingSkeleton height="h-6" width="w-20" className="rounded-full" /></TableCell>
                                                <TableCell><LoadingSkeleton height="h-4" width="w-28" /></TableCell>
                                                <TableCell><LoadingSkeleton height="h-9" width="w-24" /></TableCell>
                                            </TableRow>
                                        ))}
                                    </>
                                ) : formattedRequests.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6}>
                                            <p className="text-center text-sm text-text-secondary">No seat requests yet.</p>
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    formattedRequests.map((request) => (
                                    <TableRow key={request.id}>
                                        <TableCell>
                                                <span className="text-text-primary font-medium">
                                                    {request.requestDate}
                                                </span>
                                        </TableCell>
                                        <TableCell>
                                            <span className="text-text-primary font-medium">{request.additionalSeats}</span>
                                        </TableCell>
                                        <TableCell>
                                            <span className="text-text-secondary">{request.reason}</span>
                                        </TableCell>
                                        <TableCell>
                                                <Badge variant={statusVariant(request.status)}>
                                                    {request.status?.charAt(0).toUpperCase() + request.status?.slice(1)}
                                                </Badge>
                                        </TableCell>
                                        <TableCell>
                                                <span className="text-text-secondary">
                                                    {request.requestedBy?.name || '—'}
                                                </span>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col sm:flex-row gap-md">
                                                <Button
                                                    variant="outline-primary"
                                                        onClick={() => handleViewRequest(request)}
                                                >
                                                    View
                                                </Button>
                                                <Button
                                                    variant="outline-danger"
                                                        onClick={() => handleCancelRequest(request)}
                                                        disabled={request.status !== 'pending'}
                                                >
                                                    Cancel
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                        <p className="text-xs py-4 text-text-secondary text-center md:hidden">
                            ← Scroll horizontally to view all columns →
                        </p>
                    </div>
                </div>
            </div>

            <SeatRequestModal
                isOpen={showRequestModal}
                onClose={() => setShowRequestModal(false)}
                onSubmit={handleCreateRequest}
                companyName={user?.companyName || ''}
            />
            <SeatRequestDetailsModal
                isOpen={isDetailsOpen}
                onClose={() => setIsDetailsOpen(false)}
                request={selectedRequest}
                onCancel={handleCancelRequest}
                loadingAction={isProcessingAction}
            />
        </div>
    );
};

export default SeatRequestPage;