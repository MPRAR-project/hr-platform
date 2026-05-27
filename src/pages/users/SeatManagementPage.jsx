import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, X } from 'lucide-react';
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
import wsClient from '../../lib/wsClient';

// Roles that can approve/reject seat requests
const SEAT_APPROVERS = ['siteManager', 'seniorManager'];

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

const parseRequestDate = (requestedAt) => {
  if (!requestedAt) return '—';
  // Firestore Timestamp
  if (requestedAt?.toDate) return requestedAt.toDate().toLocaleDateString();
  // ISO string or Date object
  const d = new Date(requestedAt);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
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
  const { getItem, setItem } = useCache();

  // Determine if the logged-in user can approve/reject requests
  const userRole = user?.role || user?.hrRole || '';
  const isApprover = SEAT_APPROVERS.includes(userRole);

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
      const data = await fetchSeatRequests();
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

  // Real-time WebSocket listeners for seat request events
  useEffect(() => {
    const handleCreated  = () => loadRequests();
    const handleApproved = () => loadRequests();
    const handleRejected = () => loadRequests();
    wsClient.on('seatRequest:created',  handleCreated);
    wsClient.on('seatRequest:approved', handleApproved);
    wsClient.on('seatRequest:rejected', handleRejected);
    return () => {
      wsClient.off('seatRequest:created',  handleCreated);
      wsClient.off('seatRequest:approved', handleApproved);
      wsClient.off('seatRequest:rejected', handleRejected);
    };
  }, [loadRequests]);

  const handleRequestSeats = () => {
    setShowRequestModal(true);
  };

  const handleCreateRequest = async ({ additionalSeats, reason }) => {
    try {
      await createSeatRequest({ seatCount: additionalSeats, reason });
      toast.success('Seat request submitted. You will be notified when it is approved.');
      setShowRequestModal(false);
      emitSeatRequestEvent();
    } catch (error) {
      console.error('Failed to submit seat request:', error);
      toast.error(error?.response?.data?.error || error?.message || 'Failed to submit seat request');
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

  const handleApproveRequest = async (request) => {
    if (request.status !== 'pending') return;
    try {
      setIsProcessingAction(true);
      await updateSeatRequestStatus(request.id, 'approved', {
        resolvedById: user?.uid,
        resolvedByName: user?.displayName || user?.email || 'Manager',
        resolvedByEmail: user?.email,
        notes: 'Approved by manager'
      });
      toast.success(`Seat request approved — ${request.additionalSeats} seat(s) added.`);
      emitSeatRequestEvent();
      window.dispatchEvent(new CustomEvent('seatRequests:updated'));
    } catch (error) {
      console.error('Failed to approve seat request:', error);
      toast.error(error?.message || 'Failed to approve request');
    } finally {
      setIsProcessingAction(false);
      setIsDetailsOpen(false);
    }
  };

  const handleRejectRequest = async (request) => {
    const reason = window.prompt('Reason for rejection (optional):');
    if (reason === null) return; // user pressed Cancel
    try {
      setIsProcessingAction(true);
      await updateSeatRequestStatus(request.id, 'rejected', {
        resolvedById: user?.uid,
        resolvedByName: user?.displayName || user?.email || 'Manager',
        resolvedByEmail: user?.email,
        notes: reason || 'Rejected by manager'
      });
      toast.success('Seat request rejected.');
      emitSeatRequestEvent();
      window.dispatchEvent(new CustomEvent('seatRequests:updated'));
    } catch (error) {
      console.error('Failed to reject seat request:', error);
      toast.error(error?.message || 'Failed to reject request');
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
        requestDate: parseRequestDate(req.requestedAt),
        requestedAtDisplay: (() => {
          if (!req.requestedAt) return '—';
          if (req.requestedAt?.toDate) return req.requestedAt.toDate().toLocaleString();
          const d = new Date(req.requestedAt);
          return isNaN(d.getTime()) ? '—' : d.toLocaleString();
        })()
      })),
    [requests]
  );

  // Column count changes if approver (extra columns shown)
  const colSpan = isApprover ? 7 : 6;

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
            <div>
              <h2 className="text-2xl font-bold text-text-primary">Seat Request Management</h2>
              {isApprover && (
                <p className="text-sm text-text-secondary mt-1">
                  As a manager, you can approve or reject pending seat requests.
                </p>
              )}
            </div>
            {/* Only non-approvers (hrManager, advisors) can request seats */}
            {!isApprover && (
              <Button
                variant="gradient"
                icon={ArrowRight}
                onClick={handleRequestSeats}
              >
                Request Additional Seats
              </Button>
            )}
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
                {isApprover && <TableHeaderCell>Approve / Reject</TableHeaderCell>}
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
                        {isApprover && <TableCell><LoadingSkeleton height="h-9" width="w-32" /></TableCell>}
                      </TableRow>
                    ))}
                  </>
                ) : formattedRequests.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={colSpan}>
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
                        <span className="text-text-primary font-medium">{request.additionalSeats ?? request.seatCount ?? '—'}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-text-secondary">{request.reason || '—'}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(request.status)}>
                          {request.status?.charAt(0).toUpperCase() + request.status?.slice(1)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-text-secondary">
                          {request.requestedBy?.name || request.requestedByName || '—'}
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
                          {/* Cancel is only available to the requester for their own pending requests */}
                          {!isApprover && (
                            <Button
                              variant="outline-danger"
                              onClick={() => handleCancelRequest(request)}
                              disabled={request.status !== 'pending' || isProcessingAction}
                            >
                              Cancel
                            </Button>
                          )}
                        </div>
                      </TableCell>
                      {/* Approve / Reject column — only shown to site/senior managers */}
                      {isApprover && (
                        <TableCell>
                          {request.status === 'pending' ? (
                            <div className="flex gap-sm">
                              <Button
                                variant="outline-success"
                                icon={Check}
                                onClick={() => handleApproveRequest(request)}
                                disabled={isProcessingAction}
                                title="Approve"
                              >
                                Approve
                              </Button>
                              <Button
                                variant="outline-danger"
                                icon={X}
                                onClick={() => handleRejectRequest(request)}
                                disabled={isProcessingAction}
                                title="Reject"
                              >
                                Reject
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-text-secondary italic">
                              {request.status === 'approved' ? 'Approved' : request.status === 'rejected' ? 'Rejected' : 'Closed'}
                            </span>
                          )}
                        </TableCell>
                      )}
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
        onCancel={isApprover ? undefined : handleCancelRequest}
        onApprove={isApprover ? handleApproveRequest : undefined}
        onReject={isApprover ? handleRejectRequest : undefined}
        loadingAction={isProcessingAction}
      />
    </div>
  );
};

export default SeatRequestPage;
