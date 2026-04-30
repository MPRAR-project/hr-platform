import React, { useState } from 'react';
import { X, ArrowRight, CreditCard, Loader2 } from 'lucide-react';
import Button from '../ui/Button';

const RenewalPaymentConfirmationModal = ({
  isOpen,
  onClose,
  onConfirm,
  selectedUsers = [],
  newUsers = [],
  isProcessing,
  seatCountOverride = null,
  pricePerSeat = 5,
  hasScheduling = false
}) => {
  const pricePerUser = Number(pricePerSeat) || 5;
  const totalUsers = selectedUsers.length + newUsers.length;
  const billedSeatCount =
    Number.isFinite(seatCountOverride) && seatCountOverride > 0
      ? seatCountOverride
      : totalUsers || 0;

  const addOnsCost = hasScheduling ? 2.50 : 0;
  const totalCost = ((billedSeatCount * pricePerUser) + addOnsCost).toFixed(2);

  const [internalProcessing, setInternalProcessing] = useState(false);
  const processing = typeof isProcessing === 'boolean' ? isProcessing : internalProcessing;

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (typeof onConfirm !== 'function' || processing) {
      return;
    }
    const shouldManageLocalState = typeof isProcessing !== 'boolean';
    try {
      if (shouldManageLocalState) {
        setInternalProcessing(true);
      }
      await onConfirm();
      onClose();
    } catch (error) {
      console.error('RenewalPaymentConfirmationModal: confirmation failed', error);
    } finally {
      if (shouldManageLocalState) {
        setInternalProcessing(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]" onClick={onClose}></div>

      <div className="relative w-full max-w-[500px] bg-white rounded-base shadow-[0_4px_20px_rgba(0,0,0,0.1)] p-6 max-h-[90vh] overflow-y-auto scrollbar-custom">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-xl font-semibold text-text-primary">Confirm Payment</h2>
              <p className="text-[13px] text-text-secondary mt-1">
                Review your subscription and complete payment to restore access
              </p>
            </div>
            <button onClick={onClose} className="w-6 h-6 flex items-center justify-center bg-black/10 rounded-full hover:bg-black/20 transition-colors">
              <X className="h-4 w-4 text-text-secondary" />
            </button>
          </div>

          {/* Order Summary */}
          <div className="border border-border-secondary rounded-lg p-4 space-y-4">
            <h3 className="text-lg font-semibold text-text-primary">Order Summary</h3>

            <div className="space-y-3">
              <div className="flex justify-between items-center py-2">
                <span className="text-sm text-text-secondary">Selected existing users:</span>
                <span className="text-md font-semibold text-text-primary">{selectedUsers.length}</span>
              </div>

              <div className="flex justify-between items-center py-2">
                <span className="text-sm text-text-secondary">New users to add:</span>
                <span className="text-md font-semibold text-text-primary">{newUsers.length}</span>
              </div>

              <div className="border-t border-border-secondary my-2"></div>

              <div className="flex justify-between items-center py-2">
                <span className="text-sm font-semibold text-text-primary">Total users selected:</span>
                <span className="text-md font-semibold text-text-primary">{totalUsers}</span>
              </div>

              <div className="flex justify-between items-center py-2">
                <span className="text-sm text-text-secondary">Price per user per month:</span>
                <span className="text-md font-semibold text-text-primary">£{pricePerUser.toFixed(2)}</span>
              </div>

              <div className="flex justify-between items-center py-2">
                <span className="text-sm text-text-secondary">
                  Seats billed this cycle{seatCountOverride ? ' (based on plan)' : ''}
                </span>
                <span className="text-md font-semibold text-text-primary">{billedSeatCount}</span>
              </div>

              {hasScheduling && (
                <div className="flex justify-between items-center py-2">
                  <span className="text-sm text-text-secondary">Shift Scheduling Add-on</span>
                  <span className="text-md font-semibold text-text-primary">£2.50</span>
                </div>
              )}

              <div className="border-t border-border-secondary my-2"></div>

              <div className="flex justify-between items-center py-2">
                <span className="text-lg font-bold text-text-primary">Total monthly cost:</span>
                <span className="text-2xl font-bold text-text-primary">£{totalCost}</span>
              </div>
            </div>

            {/* Info Box */}
            <div className="bg-background-accent-purple-light border border-border-accent-purple rounded-lg p-3">
              <p className="text-xs leading-relaxed text-text-secondary">
                Your subscription will be renewed immediately using your seat allowance so your team can keep working.
              </p>
            </div>
          </div>

          {/* Payment Method */}
          <div className="border border-border-secondary rounded-lg p-4">
            <h3 className="text-lg font-semibold text-text-primary mb-4">Payment Method</h3>

            <div className="flex items-center gap-3 p-3 border border-border-accent-purple rounded-lg bg-background-accent-purple-light">
              <CreditCard className="h-6 w-6 text-text-accent-purple" />
              <div className="flex flex-col gap-1">
                <span className="text-sm text-text-secondary">Secure payment via Stripe</span>
                <span className="text-xs text-text-secondary">You will be redirected to complete payment</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-3 gap-4">
            <Button
              onClick={onClose}
              variant='outline-secondary'
              cn='h-12 col-span-1'
            >
              Back
            </Button>
            <Button
              onClick={handleConfirm}
              variant='gradient'
              cn="col-span-2 h-12 "
              icon={ArrowRight}
              disabled={processing}
            >
              {processing ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing...
                </span>
              ) : (
                <span>Pay £{totalCost} & Restore Access</span>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RenewalPaymentConfirmationModal;