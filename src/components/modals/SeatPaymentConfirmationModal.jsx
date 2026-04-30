import React, { useState, useEffect } from 'react';
import { X, ArrowRight } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';

const SeatPaymentConfirmationModal = ({ isOpen, onClose, onConfirm, user, isTrial = false, initialSeatCount = null }) => {
  const pricePerSeat = 5.00;
  const [seatCount, setSeatCount] = useState(initialSeatCount && initialSeatCount > 0 ? initialSeatCount : 1);

  // Update seat count when modal opens or initialSeatCount changes
  useEffect(() => {
    if (isOpen && initialSeatCount && initialSeatCount > 0) {
      setSeatCount(initialSeatCount);
    } else if (isOpen && (!initialSeatCount || initialSeatCount <= 0)) {
      setSeatCount(1);
    }
  }, [isOpen, initialSeatCount]);

  if (!isOpen || !user) return null;

  const totalCost = isTrial ? 0 : seatCount * pricePerSeat;
  const handleConfirm = () => {
    if (seatCount <= 0 || !Number.isFinite(seatCount)) {
      alert('Please enter a valid seat quantity.');
      return;
    }
    onConfirm(Number(seatCount));
    onClose();
    setSeatCount(1);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]" onClick={onClose}></div>

      <div className="relative w-full max-w-[500px] bg-white rounded-[24px] shadow-[0_4px_20px_rgba(0,0,0,0.1)] p-6">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-xl font-semibold text-text-primary">
                {isTrial ? 'Add Seats' : 'Confirm Payment'}
              </h2>
              <p className="text-[13px] text-text-secondary mt-1">
                {isTrial 
                  ? 'Seats are free during your trial period'
                  : 'Confirm the immediate charge for adding this new seat'
                }
              </p>
            </div>
            <button onClick={onClose} className="w-6 h-6 flex items-center justify-center bg-black/10 rounded-full hover:bg-black/20 transition-colors">
              <X className="h-4 w-4 text-text-secondary" />
            </button>
          </div>

          {/* New Seat Details */}
          <div className="border border-border-secondary rounded-lg p-4">
            <h3 className="text-lg font-semibold text-text-primary mb-4">New Seat Details</h3>

            <div className="flex justify-between items-center p-3 bg-blue-50/40 rounded-lg">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-text-primary">{user.fullName || "Employee"}</span>
                <span className="text-xs text-text-secondary">{user.email || "employee@gmail.com"}</span>
              </div>
              <Badge variant="info">{user.role}</Badge>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-text-secondary uppercase tracking-wide block mb-1">
              Seat Quantity
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="1"
                value={seatCount}
                onChange={(e) => setSeatCount(Math.max(1, Number(e.target.value) || 1))}
                className="flex-1 border border-border-primary rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-border-accent-purple"
              />
              <span className="text-sm text-text-secondary">x £{pricePerSeat.toFixed(2)}/seat</span>
            </div>
          </div>

          {/* Immediate Charge Info */}
          <div className={`rounded-lg p-4 ${isTrial ? 'bg-green-50 border border-green-200' : 'bg-background-accent-purple-light border border-border-accent-purple'}`}>
            <div className="flex justify-between items-center mb-2">
              <span className={`text-sm ${isTrial ? 'text-green-700' : 'text-text-accent-purple'}`}>
                {isTrial ? 'Trial period - No charge:' : 'Immediate charge:'}
              </span>
              <span className={`text-2xl font-bold ${isTrial ? 'text-green-700' : 'text-text-primary'}`}>
                {isTrial ? 'FREE' : `£${totalCost.toFixed(2)}`}
              </span>
            </div>
            <p className={`text-xs ${isTrial ? 'text-green-700' : 'text-text-accent-purple'}`}>
              {isTrial 
                ? 'These seats will be added for free. You\'ll be charged when your trial ends.'
                : 'These seats will be added to your monthly billing immediately'
              }
            </p>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-3 gap-4">
            <Button
              onClick={onClose}
              variant='outline-secondary'
              cn='h-12 col-span-1'
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              variant='gradient'
              cn='h-12 col-span-2'
              icon={ArrowRight}
            >
              <span>
                {isTrial 
                  ? `Confirm & Add ${seatCount} Seat${seatCount > 1 ? 's' : ''} (Free)`
                  : `Confirm & Pay £${totalCost.toFixed(2)}`
                }
              </span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SeatPaymentConfirmationModal;