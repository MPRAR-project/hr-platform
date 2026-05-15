import React, { useState, useRef, useEffect } from 'react';
import { X, CheckCircle, Smartphone, Edit2, AlertCircle } from 'lucide-react';
import Button from '../../../components/ui/Button';
import { signContract } from '../../../services/contractService';
import { toast } from 'react-toastify';
import SignatureCanvas from 'react-signature-canvas';
import { useAuth } from '../../../hooks/useAuth';

const ContractViewerModal = ({ isOpen, onClose, contract, userId, onSignSuccess }) => {
    const { user } = useAuth();
    const [pageNumber, setPageNumber] = useState(1);
    const [numPages, setNumPages] = useState(null);
    const [isSigning, setIsSigning] = useState(false);
    const [typedName, setTypedName] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const sigPad = useRef({});

    if (!isOpen || !contract) return null;

    const isSigned = contract.status === 'signed';
    const isEmployee = user.role === 'employee' || user.uid === userId; // Allow if it is the user's contract
    const canSign = !isSigned && isEmployee && contract.fileUrl;

    const clearSignature = () => {
        sigPad.current.clear();
    };

    const handleSign = async () => {
        if (sigPad.current.isEmpty && !typedName) {
            toast.error('Please sign or type your name.');
            return;
        }
        // Need at least one
        if (sigPad.current.isEmpty()) {
            toast.error('Please provide a digital signature.');
            return;
        }

        try {
            setIsSubmitting(true);

            // Get signature as blob
            const canvas = sigPad.current.getCanvas();
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));

            await signContract(userId, contract.id, blob, typedName);

            toast.success('Contract signed successfully');
            onSignSuccess();
            onClose();
        } catch (error) {
            console.error('Signing failed:', error);
            toast.error('Failed to sign contract');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 overflow-y-auto">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl m-4 flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="flex justify-between items-center p-4 border-b border-gray-200">
                    <div>
                        <h2 className="text-xl font-semibold text-gray-900">{contract.title}</h2>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${isSigned ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                            }`}>
                            {isSigned ? 'Signed' : 'Pending Signature'}
                        </span>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                {/* Content - Scrollable */}
                <div className="flex-1 overflow-y-auto p-4 bg-gray-100">
                    <div className="bg-white shadow-sm mx-auto max-w-3xl min-h-[500px]">
                        {/* PDF Embed */}
                        <iframe
                            src={contract.fileUrl}
                            className="w-full h-[600px] border-none"
                            title="Contract PDF"
                        />
                    </div>

                    {/* Signature Section */}
                    <div className="mt-8 max-w-3xl mx-auto bg-white p-6 rounded-lg shadow-sm">
                        <h3 className="text-lg font-medium text-gray-900 mb-4 border-b pb-2">
                            {isSigned ? 'Signed by Employee' : 'Employee Signature'}
                        </h3>

                        {isSigned ? (
                            <div className="flex flex-col md:flex-row gap-8">
                                <div className="flex-1">
                                    <p className="text-sm text-gray-500 mb-2">Digital Signature</p>
                                    <div className="border border-gray-200 rounded p-4 bg-gray-50">
                                        <img src={contract.signatureUrl} alt="Signature" className="h-24 object-contain" />
                                    </div>
                                </div>
                                <div className="flex-1">
                                    <p className="text-sm text-gray-500 mb-2">Details</p>
                                    <div className="space-y-2 text-sm">
                                        <div className="flex justify-between">
                                            <span className="text-gray-600">Signed Name:</span>
                                            <span className="font-medium">{contract.typedSignature || 'N/A'}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-600">Date:</span>
                                            <span className="font-medium">
                                                {contract.signedAt ? new Date(contract.signedAt).toLocaleString() : new Date().toLocaleString()}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : canSign ? (
                            <div className="flex flex-col gap-6">
                                {/* Type Name */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Type Full Name
                                    </label>
                                    <input
                                        type="text"
                                        value={typedName}
                                        onChange={(e) => setTypedName(e.target.value)}
                                        placeholder="Type your name to sign"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    />
                                </div>

                                {/* Draw Signature */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1 flex justify-between">
                                        <span>Draw Signature</span>
                                        <button
                                            type="button"
                                            onClick={clearSignature}
                                            className="text-xs text-blue-600 hover:text-blue-800"
                                        >
                                            Clear
                                        </button>
                                    </label>
                                    <div className="border border-gray-300 rounded-md bg-white touch-none">
                                        <SignatureCanvas
                                            ref={sigPad}
                                            penColor="black"
                                            canvasProps={{
                                                className: 'w-full h-40 rounded-md cursor-crosshair'
                                            }}
                                        />
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                                        <Smartphone className="w-3 h-3" />
                                        Sign using mouse or touch screen (mobile/tablet compatible)
                                    </p>
                                </div>

                                <div className="bg-blue-50 p-4 rounded-md flex gap-3 text-sm text-blue-700">
                                    <AlertCircle className="w-5 h-5 flex-shrink-0" />
                                    <p>
                                        By clicking "Sign & Submit", I acknowledge that I have read and agree to the terms of this contract.
                                        This digital signature is legally binding. The current date ({new Date().toLocaleDateString()}) will be recorded.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="text-center py-4 text-gray-500 italic">
                                This contract is pending signature by the employee.
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer - Actions */}
                <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-3 rounded-b-lg">
                    <Button variant="secondary" onClick={onClose}>
                        Close
                    </Button>
                    {canSign && (
                        <Button
                            variant="primary"
                            onClick={handleSign}
                            disabled={isSubmitting}
                            isLoading={isSubmitting}
                            leftIcon={Edit2}
                        >
                            Sign & Submit
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ContractViewerModal;
