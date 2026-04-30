import React, { useState } from 'react';
import { User, Check, X, Loader2 } from 'lucide-react';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import ApprovalConfirmationModal from '../../../components/modals/ApprovalConfirmationModal';
import DeleteConfirmationModal from '../../../components/modals/DeleteConfirmationModal';
import { approveOfflinePaymentRequest, declineOfflinePaymentRequest } from '../../../services/offlinePaymentService';
import { parseCompanyId } from '../../../utils/dataParser';

const DetailItem = ({ label, value }) => (
    <div>
        <p className="text-base text-text-secondary">{label}</p>
        <p className="text-md font-semibold text-text-primary mt-xs">{value || '—'}</p>
    </div>
);

const PaymentVerificationCard = ({ request }) => {
  const [isApproveModalOpen, setIsApproveModalOpen] = useState(false);
  const [isDeclineModalOpen, setIsDeclineModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleApprove = async () => {
    if (!request.id) {
      console.error('Request ID is missing');
      return;
    }

    try {
      setIsProcessing(true);
      await approveOfflinePaymentRequest(request.id);
      setIsApproveModalOpen(false);
      // Trigger refresh
      window.dispatchEvent(new CustomEvent('offlinePayments:updated'));
    } catch (error) {
      console.error('Failed to approve payment request:', error);
      // Error toast is handled in the service
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDecline = async () => {
    if (!request.id) {
      console.error('Request ID is missing');
      return;
    }

    try {
      setIsProcessing(true);
      await declineOfflinePaymentRequest(request.id);
      setIsDeclineModalOpen(false);
      // Trigger refresh
      window.dispatchEvent(new CustomEvent('offlinePayments:updated'));
    } catch (error) {
      console.error('Failed to decline payment request:', error);
      // Error toast is handled in the service
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      <div className="flex flex-col p-lg lg:p-xl border border-border-accent-purple rounded-sm gap-xl">
        {/* Top Section */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-md">
          <div className="flex items-center gap-base">
            <div className="w-11 h-11 bg-bg-accent-purple-light rounded-full flex items-center justify-center flex-shrink-0">
              <User className="h-6 w-6 text-text-accent-purple" />
            </div>
            <div>
              <p className="text-lg font-semibold text-text-primary">{request.company}</p>
              <p className="text-base text-text-secondary">{request.details}</p>
            </div>
          </div>
          <div className="flex items-center gap-3xl flex-shrink-0">
            <Badge variant="warning">{request.status}</Badge>
            <p className="text-base text-text-secondary">Submitted: {request.submittedDate}</p>
          </div>
        </div>
        
        <hr className="border-t border-border-primary" />
        
        {/* Bottom Section */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-lg">
          <div className="flex flex-col gap-3xl">
            <DetailItem label="Evidence:" value={request.evidence} />
            <DetailItem label="Notes:" value={request.notes} />
          </div>
          <div className="flex gap-2xl mt-md lg:mt-0 flex-shrink-0">
            <Button 
              variant="solid-success" 
              cn='w-full' 
              icon={isProcessing ? Loader2 : Check}
              onClick={() => setIsApproveModalOpen(true)}
              disabled={isProcessing}
            >
              {isProcessing ? 'Processing...' : 'Approve'}
            </Button>
            <Button 
              variant="outline-danger" 
              icon={isProcessing ? Loader2 : X}
              onClick={() => setIsDeclineModalOpen(true)}
              disabled={isProcessing}
            >
              {isProcessing ? 'Processing...' : 'Decline'}
            </Button>
          </div>
        </div>
      </div>

      {/* Approve Modal */}
      <ApprovalConfirmationModal
        isOpen={isApproveModalOpen}
        onClose={() => setIsApproveModalOpen(false)}
        onConfirm={handleApprove}
        title="Approve Payment Verification"
        description={`Are you sure you want to approve this payment verification request from ${request.company}? This will confirm the payment and update the company's billing status.`}
        confirmButtonText="Approve Payment"
        cancelButtonText="Cancel"
      >
        <div className="space-y-4">
          {/* Request Details */}
          <div className="flex items-start justify-between p-3 border border-border-secondary rounded-lg">
            <div className="flex items-start gap-3 flex-1">
              <div className="w-10 h-10 bg-bg-accent-purple-light rounded-full flex items-center justify-center flex-shrink-0">
                <User className="h-5 w-5 text-text-accent-purple" />
              </div>
              <div className="flex flex-col gap-1 flex-1">
                <span className="text-md font-semibold text-text-primary">
                  {request.company}
                </span>
                <span className="text-xs text-text-secondary">
                  {request.details}
                </span>
                <span className="text-xs text-text-secondary">
                  Submitted: {request.submittedDate}
                </span>
              </div>
            </div>
            <Badge variant="warning">{request.status}</Badge>
          </div>

          {/* Evidence & Notes */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-2">
            <div>
              <p className="text-xs font-semibold text-green-800">Evidence:</p>
              <p className="text-sm text-green-700">{request.evidence}</p>
            </div>
            {request.notes && (
              <div>
                <p className="text-xs font-semibold text-green-800">Notes:</p>
                <p className="text-sm text-green-700">{request.notes}</p>
              </div>
            )}
          </div>
        </div>
      </ApprovalConfirmationModal>

      {/* Decline Modal */}
      <DeleteConfirmationModal
        isOpen={isDeclineModalOpen}
        onClose={() => setIsDeclineModalOpen(false)}
        onConfirm={handleDecline}
        title="Decline Payment Verification"
        description={`Are you sure you want to decline this payment verification request from ${request.company}?`}
        warningMessage="Declining this request will notify the company that their payment verification was rejected. They may need to resubmit with additional evidence."
        confirmButtonText="Decline Request"
        cancelButtonText="Cancel"
        itemDetails={{
          name: request.company,
          subtitle: request.details,
          email: `Submitted: ${request.submittedDate}`,
          badge: request.status
        }}
        variant="danger"
      />
    </>
  );
};

export default PaymentVerificationCard;