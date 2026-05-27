import React from 'react';
import { X } from 'lucide-react';
import Button from '../ui/Button';
import Badge from '../ui/Badge';

const statusVariantMap = {
  pending: 'warning',
  approved: 'success',
  cancelled: 'secondary',
  rejected: 'danger'
};

const SeatRequestDetailsModal = ({
  isOpen,
  onClose = () => {},
  request,
  onApprove,
  onReject,
  onCancel,
  loadingAction = false
}) => {
  if (!isOpen || !request) return null;

  const status = (request.status || 'pending').toLowerCase();
  const canApprove = typeof onApprove === 'function' && status === 'pending';
  const canReject  = typeof onReject  === 'function' && status === 'pending';
  const canCancel  = typeof onCancel  === 'function' && status === 'pending';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40 px-4">
      <div className="w-full max-w-xl bg-white rounded-lg shadow-2xl border border-border-primary">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-primary">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Seat Request Details</h2>
            <p className="text-sm text-text-secondary">Requested on {request.requestedAtDisplay || '—'}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary"
            disabled={loadingAction}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-secondary">Status</p>
              <Badge variant={statusVariantMap[status] || 'warning'}>
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </Badge>
            </div>
            <div>
              <p className="text-sm text-text-secondary">Requested Seats</p>
              <p className="text-xl font-semibold text-text-primary">{request.additionalSeats ?? request.seatCount ?? '—'}</p>
            </div>
          </div>

          <div>
            <p className="text-sm text-text-secondary mb-1">Reason</p>
            <p className="text-text-primary whitespace-pre-wrap border border-border-primary rounded-lg px-3 py-2 bg-bg-secondary">
              {request.reason || '—'}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-text-secondary">Requested By</p>
              <p className="font-medium text-text-primary">{request.requestedBy?.name || request.requestedByName || '—'}</p>
              <p className="text-sm text-text-secondary">{request.requestedBy?.email || request.requestedByEmail || ''}</p>
            </div>
            <div>
              <p className="text-sm text-text-secondary">Company</p>
              <p className="font-medium text-text-primary">{request.companyName || '—'}</p>
              {request.siteName && <p className="text-sm text-text-secondary">{request.siteName}</p>}
            </div>
          </div>

          {request.resolutionNotes && (
            <div>
              <p className="text-sm text-text-secondary mb-1">Notes</p>
              <p className="text-text-primary whitespace-pre-wrap border border-border-primary rounded-lg px-3 py-2 bg-bg-secondary">
                {request.resolutionNotes}
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row justify-end gap-3 px-6 py-4 border-t border-border-primary">
          <Button variant="outline-secondary" onClick={onClose} disabled={loadingAction}>
            Close
          </Button>
          {canCancel && (
            <Button
              variant="outline-danger"
              onClick={() => onCancel(request)}
              disabled={loadingAction}
            >
              Cancel Request
            </Button>
          )}
          {canReject && (
            <Button
              variant="outline-danger"
              onClick={() => onReject(request)}
              disabled={loadingAction}
            >
              Reject Request
            </Button>
          )}
          {canApprove && (
            <Button
              variant="gradient"
              onClick={() => onApprove(request)}
              disabled={loadingAction}
            >
              Approve Request
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default SeatRequestDetailsModal;

