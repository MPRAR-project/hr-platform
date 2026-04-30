import React, { useState } from 'react';
import { X, CheckCircle, XCircle, Ban } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { allowanceService } from '../../services/allowanceService';
import { safeParseDate } from '../../utils/safeDateParse';

const ViewAbsenceModal = ({ isOpen, onClose, absence, onApprove, onDecline, onCancel, currentUser }) => {
  const [rejectionReason, setRejectionReason] = useState('');
  const [cancellationReason, setCancellationReason] = useState('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // Define roles that can cancel approved absences (managers only)
  const CANCELLATION_ROLES = [
    'siteManager',
    'hrManager',
    'adminManager',
    'hrAdvisor',
    'adminAdvisor',
    'teamManager' // Added teamManager
  ];
  const getStatusVariant = (status) => {
    switch (status?.toLowerCase()) {
      case 'pending':
        return 'warning';
      case 'approved':
        return 'success';
      case 'rejected':
        return 'danger';
      case 'cancelled':
        return 'danger';
      default:
        return 'warning';
    }
  };

  // Check if current user can approve/decline this absence
  const canManageAbsence = () => {
    if (!currentUser || !absence) return false;

    // Users cannot approve their own absences
    if (absence.userId === currentUser.uid) return false;

    // Only certain roles can approve absences
    const managerRoles = ['siteManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor', 'teamManager'];
    return managerRoles.includes(currentUser.role);
  };

  // Check if current user can cancel approved absences (managers only)
  const canCancelAbsence = () => {
    if (!currentUser || !absence) return false;

    // Employees cannot cancel - only managers
    if (absence.userId === currentUser.uid) return false;

    // Only specific manager roles can cancel approved absences
    return CANCELLATION_ROLES.includes(currentUser.role);
  };

  const handleApprove = () => {
    if (onApprove) onApprove(absence?.id);
    onClose();
  };

  const handleDecline = () => {
    if (onDecline) onDecline(absence?.id, rejectionReason);
    onClose();
  };

  const handleCancelClick = () => {
    setShowCancelConfirm(true);
  };

  const handleCancelConfirm = () => {
    if (onCancel) {
      onCancel(absence?.id, cancellationReason);
    }
    setShowCancelConfirm(false);
    setCancellationReason('');
    onClose();
  };

  const handleCancelAbort = () => {
    setShowCancelConfirm(false);
    setCancellationReason('');
  };

  if (!isOpen || !absence) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]" onClick={onClose}></div>

        <div className="relative w-full max-w-[540px] bg-white rounded-[24px] shadow-[0_4px_20px_rgba(0,0,0,0.1)] max-h-[90vh] flex flex-col">
          {/* Header - Fixed */}
          <div className="flex-shrink-0 p-6 pb-0">
            <div className="flex justify-between items-start">
              <h2 className="text-xl font-bold text-text-primary">
                Absences Details - {absence.name || absence.employeeName || absence.displayName || (absence.userId === currentUser?.uid ? currentUser?.displayName : '')}
              </h2>
              <button onClick={onClose} className="w-6 h-6 flex items-center justify-center bg-black/10 rounded-full hover:bg-black/20 transition-colors flex-shrink-0">
                <X className="h-4 w-4 text-text-secondary" />
              </button>
            </div>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <div className="space-y-6">
              {/* Leave Type and Status */}
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm text-text-secondary mb-2">Leave Type</p>
                  <p className="text-lg font-semibold text-text-primary">
                    {allowanceService.getLeaveTypeDisplayName(absence.leaveType) || 'Annual Leave'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-text-secondary mb-2">Status</p> <Badge variant={getStatusVariant(absence.status)}>
                    {absence.status}
                  </Badge>

                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="text-sm text-text-secondary mb-2">Start Date</p>
                  <p className="text-md font-semibold text-text-primary">
                    {(() => {
                      const dateStr = absence.startDate || absence.dates?.split(' to ')[0];
                      const date = safeParseDate(dateStr);
                      return date && !isNaN(date.getTime())
                        ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : (dateStr || 'N/A');
                    })()}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-text-secondary mb-2">End Date</p>
                  <p className="text-md font-semibold text-text-primary">
                    {(() => {
                      const dateStr = absence.endDate || absence.dates?.split(' to ')[1];
                      const date = safeParseDate(dateStr);
                      return date && !isNaN(date.getTime())
                        ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : (dateStr || 'N/A');
                    })()}
                  </p>
                </div>
              </div>

              {/* Total Days */}
              <div className="text-center p-4 border border-border-secondary rounded-lg">
                <p className="text-5xl font-bold text-green-500 mb-1">
                  {absence.duration?.split(' ')[0] || '5'}
                </p>
                <p className="text-sm text-text-secondary">Total Days</p>
              </div>

              {/* Reason */}
              <div>
                <p className="text-sm text-text-secondary mb-2">Reason</p>
                <p className="text-md text-text-primary font-medium">
                  {absence.reason
                    ? absence.reason.charAt(0).toUpperCase() + absence.reason.slice(1)
                    : 'N/A'}
                </p>
              </div>

              {/* Allowance Information - Show for managers when allowance info is available */}
              {absence.allowanceInfo && canManageAbsence() && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm font-semibold text-blue-800 mb-3">Leave Allowance Information</p>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="text-lg font-bold text-blue-600">{absence.allowanceInfo.totalDays}</p>
                      <p className="text-xs text-blue-700">Total Allowed</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-orange-600">{absence.allowanceInfo.usedDays}</p>
                      <p className="text-xs text-orange-700">Used Days</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-green-600">{absence.allowanceInfo.remainingDays}</p>
                      <p className="text-xs text-green-700">Remaining</p>
                    </div>
                  </div>
                  {absence.allowanceInfo.autoApprovalReason && (
                    <p className="text-xs text-blue-600 mt-2 text-center">
                      {absence.allowanceInfo.autoApprovalReason}
                    </p>
                  )}
                </div>
              )}

              {/* Rejection Reason - Show for rejected absences */}
              {absence.status === "Rejected" && absence.declineReason && (
                <div>
                  <p className="text-sm text-text-secondary mb-2">Rejection Reason</p>
                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-md text-red-700 font-medium">
                      {absence.declineReason}
                    </p>
                  </div>
                </div>
              )}

              {/* Cancellation Reason - Show for cancelled absences */}
              {absence.status === "Cancelled" && absence.cancellationReason && (
                <div>
                  <p className="text-sm text-text-secondary mb-2">Cancellation Reason</p>
                  <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                    <p className="text-md text-gray-700 font-medium">
                      {absence.cancellationReason}
                    </p>
                    {absence.cancelledBy && (
                      <p className="text-xs text-gray-500 mt-2">
                        Cancelled by: {absence.cancelledByName || 'Manager'}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Rejection Reason Input - Show for pending absences that can be managed */}
              {absence.status === "Pending" && canManageAbsence() && (
                <div>
                  <label className="text-sm text-text-secondary mb-2 block">
                    Rejection Reason (Optional)
                  </label>
                  <textarea
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder="Enter reason for rejection..."
                    rows="3"
                    className="w-full px-4 py-3 border border-border-secondary rounded-lg text-sm text-text-primary placeholder:text-text-secondary resize-none focus:outline-none focus:border-border-accent-purple"
                  ></textarea>
                </div>
              )}

            </div>
          </div>

          {/* Action Buttons - Fixed at bottom */}
          <div className="flex-shrink-0 p-6 pt-0 border-t border-gray-100">
            {/* Pending Status - Show Approve/Decline */}
            {absence.status === "Pending" && canManageAbsence() && (
              <div className="grid grid-cols-3 gap-4">
                <Button
                  onClick={handleDecline}
                  variant='outline-danger'
                  icon={XCircle}
                  iconFirst={true}
                  cn='h-12 col-span-1'
                >
                  Decline
                </Button>
                <Button
                  onClick={handleApprove}
                  variant='solid-success'
                  icon={CheckCircle}
                  iconFirst={true}
                  cn='h-12 col-span-2'
                >
                  Approve
                </Button>
              </div>
            )}

          </div>
        </div>
      </div>

      {/* Cancel Confirmation Modal (Managers Only) */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={handleCancelAbort}></div>

          <div className="relative w-full max-w-md bg-white rounded-lg shadow-lg p-6">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                  <Ban className="h-5 w-5 text-orange-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Cancel Approved Absence</h3>
                  <p className="text-sm text-gray-600">This action will cancel the approved absence</p>
                </div>
              </div>

              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                <p className="text-sm text-orange-800">
                  <strong>Warning:</strong> Cancelling this absence will update its status to "Cancelled" and restore the employee's leave allowance. The record will be kept for audit purposes.
                </p>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  Cancellation Reason (Required)
                </label>
                <textarea
                  value={cancellationReason}
                  onChange={(e) => setCancellationReason(e.target.value)}
                  placeholder="Enter reason for cancelling this absence..."
                  rows="3"
                  className="w-full px-4 py-3 border border-border-secondary rounded-lg text-sm text-text-primary placeholder:text-text-secondary resize-none focus:outline-none focus:border-border-accent-purple"
                ></textarea>
              </div>

              <div className="flex gap-3 justify-end">
                <Button
                  variant="outline-secondary"
                  onClick={handleCancelAbort}
                >
                  Go Back
                </Button>
                <Button
                  variant="danger"
                  onClick={handleCancelConfirm}
                  disabled={!cancellationReason.trim()}
                >
                  Confirm Cancellation
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ViewAbsenceModal;