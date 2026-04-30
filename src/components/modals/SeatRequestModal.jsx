import React, { useState } from 'react';
import { X } from 'lucide-react';
import Button from '../ui/Button';
import { toast } from 'react-toastify';

const SeatRequestModal = ({ isOpen, onClose, onSubmit, companyName = '' }) => {
  const [additionalSeats, setAdditionalSeats] = useState(1);
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!additionalSeats || Number(additionalSeats) <= 0) {
      return toast.error('Please enter how many additional seats you need.');
    }
    if (!reason.trim()) {
      return toast.error('Please provide a reason for this request.');
    }

    try {
      setIsSubmitting(true);
      await onSubmit({
        additionalSeats: Number(additionalSeats),
        reason: reason.trim()
      });
      setAdditionalSeats(1);
      setReason('');
    } catch (error) {
      console.error('Failed to submit seat request:', error);
      toast.error(error?.message || 'Failed to submit seat request');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40 px-4">
      <div className="w-full max-w-lg bg-white rounded-lg shadow-2xl border border-border-primary">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-primary">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Request Additional Seats</h2>
            {companyName && <p className="text-sm text-text-secondary">{companyName}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary"
            disabled={isSubmitting}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">
              Additional Seats Needed <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              min="1"
              value={additionalSeats}
              onChange={(e) => setAdditionalSeats(e.target.value)}
              className="w-full border border-border-primary rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-border-accent-purple"
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">
              Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Describe why your team needs more seats..."
              className="w-full border border-border-primary rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-border-accent-purple resize-none"
              disabled={isSubmitting}
            />
          </div>

  <div className="flex justify-end gap-3 pt-2">
    <Button variant="outline-secondary" onClick={onClose} disabled={isSubmitting}>
      Cancel
    </Button>
    <Button variant="gradient" type="submit" disabled={isSubmitting}>
      {isSubmitting ? 'Submitting...' : 'Submit Request'}
    </Button>
  </div>
        </form>
      </div>
    </div>
  );
};

export default SeatRequestModal;

