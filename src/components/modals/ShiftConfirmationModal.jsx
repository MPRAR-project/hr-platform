import React from 'react';
import { X, Moon, Sun } from 'lucide-react';
import Button from '../ui/Button';
import { SHIFT_TYPES, formatShiftName } from '../../services/shiftService';

const ShiftConfirmationModal = ({ isOpen, onClose, onConfirm, currentShift, suggestedShift, reason, clockInTime }) => {
  if (!isOpen) return null;

  const formatTime = (date) => {
    if (!date) return '';
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  const handleConfirm = () => {
    onConfirm(suggestedShift);
    onClose();
  };

  const handleDecline = () => {
    onConfirm(currentShift); // Keep current shift
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]" onClick={onClose}></div>

      <div className="relative w-full max-w-md bg-white rounded-[24px] shadow-[0_4px_20px_rgba(0,0,0,0.1)] p-6">
        <div className="flex justify-between items-start mb-4">
          <div className="flex items-center gap-3">
            {suggestedShift === SHIFT_TYPES.NIGHT ? (
              <Moon className="h-6 w-6 text-blue-600" />
            ) : (
              <Sun className="h-6 w-6 text-yellow-600" />
            )}
            <h2 className="text-xl font-bold text-text-primary">Shift Confirmation</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center bg-black/10 rounded-full hover:bg-black/20 transition-colors"
          >
            <X className="h-4 w-4 text-text-secondary" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800 mb-2">
              <strong>Clock-in Time:</strong> {formatTime(clockInTime)}
            </p>
            <p className="text-sm text-blue-800">
              <strong>Current Shift:</strong> {formatShiftName(currentShift)}
            </p>
          </div>

          <p className="text-text-primary">
            {reason || `You are clocking in at ${formatTime(clockInTime)}. Are you starting a ${formatShiftName(suggestedShift)}?`}
          </p>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <p className="text-sm text-gray-700 mb-2">
              <strong>Suggested Shift:</strong> {formatShiftName(suggestedShift)}
            </p>
            <p className="text-xs text-gray-600">
              If you confirm, your shift preference will be updated to {formatShiftName(suggestedShift)} for future clock-ins.
            </p>
          </div>

          <div className="flex gap-3 justify-end pt-4">
            <Button
              variant="outline-secondary"
              onClick={handleDecline}
            >
              No, Keep Current Shift
            </Button>
            <Button
              variant="gradient"
              onClick={handleConfirm}
            >
              Yes, Switch to {formatShiftName(suggestedShift)}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShiftConfirmationModal;

