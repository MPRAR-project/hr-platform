
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import Button from '../ui/Button';
import Loader from '../ui/Loader';

/**
 * Reusable Approval/Decline Confirmation Modal Component
 * 
 * @param {boolean} isOpen - Controls modal visibility
 * @param {function} onClose - Callback when modal is closed
 * @param {function} onConfirm - Callback when action is confirmed (can be async)
 * @param {Object} item - Item being acted upon
 * @param {string} title - Modal title (default: "Approve Item")
 * @param {string} description - Confirmation description
 * @param {string} confirmButtonText - Text for confirm button (default: "Approve")
 * @param {string} cancelButtonText - Text for cancel button (default: "Cancel")
 * @param {string} type - Type of action: 'approve' or 'decline' (default: 'approve')
 * @param {boolean} requireReason - Whether reason is required for the action
 * @param {node} children - Optional additional content
 */
const ApprovalConfirmationModal = ({
  isOpen,
  onClose,
  onConfirm,
  item,
  title = "Approve Item",
  description,
  confirmButtonText = "Approve",
  cancelButtonText = "Cancel",
  type = "approve",
  requireReason = false,
  children
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setReason('');
      setError('');
      setIsLoading(false);
    }
  }, [isOpen]);

  const handleConfirm = async () => {
    if (!onConfirm) return;

    // Validate reason if required
    if (requireReason && !reason.trim()) {
      setError('Please provide a reason');
      return;
    }

    try {
      setIsLoading(true);
      setError('');

      // Pass the item ID and reason/notes to the confirm handler
      const result = type === 'decline'
        ? onConfirm(item?.id, reason.trim())
        : onConfirm(item?.id, reason.trim() || null);

      if (result && typeof result.then === 'function') {
        // It's a promise, wait for it to complete
        await result;
      }

      // Don't close the modal here - let the onConfirm handler manage modal state
      // This prevents race conditions and allows proper error handling
    } catch (error) {
      console.error('Error in confirmation handler:', error);
      setError(error.message || 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const getIcon = () => {
    switch (type) {
      case 'decline':
        return XCircle;
      case 'approve':
        return CheckCircle;
      default:
        return CheckCircle;
    }
  };

  const getButtonVariant = () => {
    switch (type) {
      case 'decline':
        return 'solid-danger';
      case 'approve':
        return 'solid-success';
      default:
        return 'solid-success';
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]" onClick={isLoading ? undefined : onClose}></div>

      <div className="relative w-full max-w-[540px] bg-white rounded-[24px] shadow-[0_4px_20px_rgba(0,0,0,0.1)] max-h-[90vh] flex flex-col">

        {/* Header - Fixed */}
        <div className="flex justify-between items-start p-6 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-xl font-bold text-text-primary">{title}</h2>
          <button
            onClick={isLoading ? undefined : onClose}
            disabled={isLoading}
            className={`w-6 h-6 flex items-center justify-center bg-black/10 rounded-full transition-colors flex-shrink-0 ${isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-black/20'
              }`}
          >
            <X className="h-4 w-4 text-text-secondary" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
          <div className="space-y-6">
            {/* Description */}
            <p className="text-sm text-text-secondary leading-relaxed">
              {description || `Are you sure you want to ${type} ${item?.documentTitle || item?.name || 'this item'}?`}
            </p>

            {/* Item Information */}
            {item && (
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-600">Document:</span>
                    <span className="text-sm font-medium text-gray-900">{item.documentTitle || item.name}</span>
                  </div>
                  {item.user && (
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Employee:</span>
                      <span className="text-sm font-medium text-gray-900">{item.user.name}</span>
                    </div>
                  )}
                  {item.documentType && (
                    <div className="flex justify-between">
                      <span className="text-sm text-gray-600">Type:</span>
                      <span className="text-sm font-medium text-gray-900">{item.documentType}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Notes Input - Always show for timesheet approvals */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {requireReason && type === 'decline' ? 'Reason *' : 'Notes (Optional)'}
              </label>
              <textarea
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  if (error) setError('');
                }}
                placeholder={type === 'decline' ? 'Please provide a reason for declining...' : 'Add any notes for the employee...'}
                rows={3}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent ${error ? 'border-red-500' : 'border-gray-300'
                  }`}
              />
              {error && (
                <p className="mt-1 text-sm text-red-600 flex items-center">
                  <AlertCircle className="h-4 w-4 mr-1" />
                  {error}
                </p>
              )}
            </div>

            {/* Optional Children Content */}
            {children && (
              <div>{children}</div>
            )}
          </div>
        </div>

        {/* Action Buttons - Fixed */}
        <div className="p-6 border-t border-gray-100 flex-shrink-0">
          <div className="grid grid-cols-3 gap-4">
            <Button
              onClick={onClose}
              variant='outline-secondary'
              cn="col-span-1 h-12"
              disabled={isLoading}
            >
              {cancelButtonText}
            </Button>
            <Button
              onClick={handleConfirm}
              variant={getButtonVariant()}
              cn="col-span-2 h-12 flex justify-center items-center gap-2"
              disabled={isLoading}
              icon={!isLoading ? getIcon() : null}
              iconFirst={!isLoading}
            >
              {isLoading ? (
                <>
                  <Loader variant="wave" size="sm" />
                  <span>Processing...</span>
                </>
              ) : (
                confirmButtonText
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ApprovalConfirmationModal;