import React from 'react';
import Button from '../ui/Button';
import Badge from '../ui/Badge';

const badgeVariantMap = {
  pending: 'warning',
  approved: 'success',
  cancelled: 'secondary',
  rejected: 'danger'
};

const SeatRequestsPanel = ({
  requests = [],
  isLoading = false,
  onRefresh = () => {},
  onView = () => {},
  onCancel = () => {},
  onApprove = () => {},
  title = 'Seat Requests'
}) => {
  return (
    <div className="bg-white border border-border-primary rounded-base p-4 w-full">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
        <div>
          <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
          <p className="text-sm text-text-secondary">
            Track seat requests from managers and approve when ready.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onRefresh} disabled={isLoading}>
            Refresh
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-text-secondary">Loading seat requests…</p>
      ) : requests.length === 0 ? (
        <p className="text-sm text-text-secondary">No seat requests yet.</p>
      ) : (
        <div className="space-y-3">
          {requests.map((request) => {
            const status = (request.status || 'pending').toLowerCase();
            const canApprove = typeof onApprove === 'function' && status === 'pending';
            const canCancel = typeof onCancel === 'function' && status === 'pending';

            return (
              <div
                key={request.id}
                className="border border-border-primary rounded-lg px-3 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
              >
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-text-primary">
                      {request.requestedBy?.name || 'Unknown'}
                    </p>
                    <Badge variant={badgeVariantMap[status] || 'warning'}>
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </Badge>
                    <p className="text-sm text-text-secondary">
                      {request.additionalSeats} seats
                    </p>
                  </div>
                  <p className="text-sm text-text-secondary">
                    {request.reason || 'No reason provided'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline-primary" onClick={() => onView(request)}>
                    View
                  </Button>
                  {canCancel && (
                    <Button variant="outline-secondary" onClick={() => onCancel(request)}>
                      Cancel
                    </Button>
                  )}
                  {canApprove && (
                    <Button variant="gradient" onClick={() => onApprove(request)}>
                      Approve
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SeatRequestsPanel;

