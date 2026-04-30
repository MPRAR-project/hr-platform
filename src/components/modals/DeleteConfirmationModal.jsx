import React from 'react';
import { createPortal } from 'react-dom';
import { X, ArrowRight, AlertTriangle, Trash2 } from 'lucide-react';
import Button from '../ui/Button';
import Loader from '../ui/Loader';

const DeleteConfirmationModal = ({
    isOpen,
    onClose,
    onConfirm,
    title = "Remove User",
    description = "Are you sure you want to remove this team member's access?",
    warningMessage,
    confirmButtonText = "Remove User",
    cancelButtonText = "Cancel",
    itemDetails = null,
    variant = "danger" // 'danger' or 'warning'
}) => {
    if (!isOpen) return null;

    const buttonColors = {
        danger: 'bg-red-500 hover:bg-red-600',
        warning: 'bg-orange-500 hover:bg-orange-600'
    };

    const iconColors = {
        danger: 'text-red-500',
        warning: 'text-orange-500'
    };

    const bgColors = {
        danger: 'bg-red-50',
        warning: 'bg-orange-50'
    };

    const [isLoading, setIsLoading] = React.useState(false);

    const handleConfirm = async () => {
        try {
            setIsLoading(true);
            const result = onConfirm();
            if (result && typeof result.then === 'function') {
                await result;
            }
            setIsLoading(false);
            onClose();
        } catch (error) {
            console.error('Error in delete confirmation:', error);
            setIsLoading(false);
            // Keep modal open on error so user can retry or cancel
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]"
                onClick={isLoading ? undefined : onClose}
            ></div>

            {/* Modal */}
            <div className="relative w-full max-w-[492px] bg-white rounded-base shadow-[0_4px_20px_rgba(0,0,0,0.1)] max-h-[90vh] flex flex-col">
                {/* Header - Fixed */}
                <div className="flex justify-between items-start gap-5 p-6 border-b border-gray-100 flex-shrink-0">
                    <div className="flex flex-col gap-1">
                        <h2 className="text-xl font-semibold text-text-primary">{title}</h2>
                        <p className="text-[13px] leading-5 text-text-secondary">
                            {description}
                        </p>
                    </div>
                    <button
                        onClick={isLoading ? undefined : onClose}
                        disabled={isLoading}
                        className={`w-6 h-6 flex items-center justify-center bg-black/10 rounded-full transition-colors flex-shrink-0 ${isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-black/20'}`}
                    >
                        <X className="h-4 w-4 text-text-secondary" />
                    </button>
                </div>

                {/* Scrollable Content */}
                <div className="p-6 overflow-y-auto flex-1 custom-scrollbar flex flex-col gap-6">
                    {/* Item Details (if provided) */}
                    {itemDetails && (
                        <div className="flex items-center justify-between p-3 border border-border-secondary rounded-lg">
                            <div className="flex flex-col gap-1 flex-1">
                                <span className="text-md font-semibold text-text-primary capitalize">
                                    {itemDetails.name}
                                </span>
                                {itemDetails.subtitle && (
                                    <span className="text-xs text-text-secondary capitalize">
                                        {itemDetails.subtitle}
                                    </span>
                                )}
                                {itemDetails.email && (
                                    <span className="text-xs text-text-secondary capitalize">
                                        {itemDetails.email}
                                    </span>
                                )}

                            </div>
                            {(itemDetails.badge || itemDetails.role) && (
                                <div className="px-3 py-1.5 bg-purple-100 rounded-full">
                                    <span className="text-[13px] font-medium text-purple-600">
                                        {itemDetails.badge || itemDetails.role}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Warning Message */}
                    {
                        warningMessage && (
                            <div className={`flex items-center gap-2 p-4 ${bgColors[variant]} rounded-lg`}>
                                <AlertTriangle className={`h-4 w-4 ${iconColors[variant]} flex-shrink-0`} />
                                <span className={`text-[13px] leading-5 ${iconColors[variant]}`}>
                                    {warningMessage}
                                </span>
                            </div>
                        )
                    }
                </div>

                {/* Action Buttons - Fixed */}
                <div className="p-6 border-t border-gray-100 flex-shrink-0">
                    <div className="grid grid-cols-3 gap-4">
                        <Button
                            onClick={onClose}
                            variant='outline-secondary'
                            cn='h-12 col-span-1'
                            disabled={isLoading}
                        >
                            {cancelButtonText}
                        </Button>
                        <Button
                            onClick={handleConfirm}
                            variant='danger'
                            cn={`h-12 col-span-2 flex items-center justify-center gap-2`}
                            icon={isLoading ? null : Trash2}
                            iconFirst={true}
                            disabled={isLoading}
                        >
                            {isLoading ? (
                                <span className="inline-flex items-center justify-center gap-2 text-white font-medium" aria-live="polite">
                                    <Loader variant="wave" size="sm" color="inverse" />
                                    <span>Processing...</span>
                                </span>
                            ) : (
                                <span>{confirmButtonText}</span>
                            )}
                        </Button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default DeleteConfirmationModal;