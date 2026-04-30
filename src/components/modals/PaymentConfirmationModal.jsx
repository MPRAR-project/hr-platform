import React, { useEffect, useState } from 'react';
import { X, ArrowRight, CreditCard } from 'lucide-react';
import Button from '../ui/Button';

const PaymentConfirmationModal = ({
  isOpen,
  onClose,
  onConfirm,
  onSendInvites,
  users = [{}],
  isSeatPurchase = false,
  pricePerUser = 5,
  initialSeatCount = null
}) => {
  const [seatCount, setSeatCount] = useState(1);

  useEffect(() => {
    if (isOpen) {
      setSeatCount(initialSeatCount && initialSeatCount > 0 ? initialSeatCount : 1);
    }
  }, [isOpen, initialSeatCount]);

  if (!isOpen) return null;

  const totalUnits = isSeatPurchase ? seatCount : users.length;
  const totalCost = (totalUnits * pricePerUser).toFixed(2);

  const handleConfirmClick = async () => {
    if (typeof onConfirm !== 'function') return;
    try {
      const payload = isSeatPurchase ? seatCount : users;
      const result = onConfirm(payload);
      if (result && typeof result.then === 'function') {
        await result;
      }
      if (!isSeatPurchase && typeof onSendInvites === 'function') {
        const inviteResult = onSendInvites(users);
        if (inviteResult && typeof inviteResult.then === 'function') {
          await inviteResult;
        }
      }
      onClose();
    } catch (error) {
      console.error('PaymentConfirmationModal: confirmation failed', error);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]"
        onClick={onClose}
      ></div>

      {/* Modal */}
      <div className="relative w-full max-w-[492px] bg-white rounded-base shadow-[0_4px_20px_rgba(0,0,0,0.1)] p-4 max-h-[90vh] overflow-y-auto modal-scroll">
        <div className="flex flex-col gap-6 p-2">
          {/* Header */}
          <div className="flex justify-between items-start gap-5">
            <div className="flex flex-col gap-1">
              <h2 className="text-xl font-semibold text-text-primary">Confirm Payment</h2>
              <p className="text-[13px] text-text-secondary">
                {isSeatPurchase 
                  ? 'Review your order and confirm payment to add the new seats.'
                  : 'Review your order and confirm payment to add the new users.'}
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-6 h-6 flex items-center justify-center bg-black/10 rounded-full hover:bg-black/20 transition-colors flex-shrink-0"
            >
              <X className="h-4 w-4 text-text-secondary" />
            </button>
          </div>

          {/* Order Summary */}
          <div className="flex flex-col gap-6 p-4 border border-border-secondary rounded-base">
            <h3 className="text-xl font-semibold text-text-primary">Order Summary</h3>

            <div className="flex flex-col gap-6">
              {/* New users to add */}
              {isSeatPurchase ? (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-[13px] text-text-secondary">Seats to purchase:</span>
                    <input
                      type="number"
                      min="1"
                      value={seatCount}
                      onChange={(e) => setSeatCount(Math.max(1, Number(e.target.value) || 1))}
                      className="w-24 h-10 px-3 border border-border-secondary rounded-lg text-sm text-text-primary focus:outline-none focus:border-border-accent-purple"
                    />
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[13px] text-text-secondary">Price per seat:</span>
                    <span className="text-md font-semibold text-text-primary">£{pricePerUser.toFixed(2)}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-[13px] text-text-secondary">New users to add:</span>
                    <span className="text-md font-semibold text-text-primary">{users.length}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[13px] text-text-secondary">Price per user per month:</span>
                    <span className="text-md font-semibold text-text-primary">£{pricePerUser.toFixed(2)}</span>
                  </div>
                </>
              )}

              {/* Divider */}
              <div className="border-t border-border-secondary"></div>

              {/* Total monthly cost */}
              <div className="flex justify-between items-center">
                <span className="text-md font-semibold text-text-primary">Total monthly cost:</span>
                <span className="text-md font-semibold text-text-primary">£{totalCost}</span>
              </div>

              {/* Info Box */}
              <div className="bg-background-accent-purple-light border border-border-accent-purple rounded-lg p-4">
                <p className="text-[13px] leading-5 text-text-secondary">
                  {isSeatPurchase
                    ? 'This seat purchase will be charged immediately and added to your monthly billing. Your next month\'s bill will reflect the new total seat count.'
                    : 'This amount will be added to your next monthly bill. Your current billing cycle will be prorated.'}
                </p>
              </div>
            </div>
          </div>

          {!isSeatPurchase && (
            <div className="flex flex-col gap-6 p-4 border border-border-secondary rounded-base">
              <h3 className="text-xl font-semibold text-text-primary">Users to be Created</h3>
              <div className="flex flex-col gap-4">
                {users.map((user, index) => (
                  <div
                    key={index}
                    className="flex justify-between items-center p-3 bg-purple-50/40 rounded-lg"
                  >
                    <div className="flex flex-col gap-2">
                      <span className="text-md text-text-primary">{user.fullName || 'User Name'}</span>
                      <span className="text-[13px] text-text-secondary">{user.email || 'user@email.com'}</span>
                    </div>
                    <div className="px-3 py-1.5 bg-purple-100 rounded-full">
                      <span className="text-[13px] font-medium text-purple-600">{user.role || 'Employee'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Payment Method */}
          <div className="flex flex-col gap-6 p-4 border border-border-secondary rounded-base">
            <h3 className="text-xl font-semibold text-text-primary">Payment Method</h3>

            <div className="flex items-center gap-3 p-3 border border-border-accent-purple rounded-lg">
              <CreditCard className="h-6 w-6 text-text-accent-purple" />
              <div className="flex flex-col gap-2">
                <span className="text-[13px] text-text-secondary">Secure payment via Stripe</span>
                <span className="text-[13px] text-text-secondary">Payment will be processed securely</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-3 gap-4">
            <Button
              onClick={onClose}
              variant='outline-secondary'
              cn="col-span-1 h-12"
            >
              Back
            </Button>
            <Button
              onClick={handleConfirmClick}
              variant='gradient'
              cn="col-span-2 h-12 "
              icon={ArrowRight}
            >
              <span>{isSeatPurchase ? 'Confirm & Add Seat(s)' : 'Confirm & Add Users'}</span>

            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};


export default PaymentConfirmationModal;