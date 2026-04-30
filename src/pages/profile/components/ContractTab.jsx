import { Plus, Briefcase, FileText, CheckCircle, Clock } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import Button from '../../../components/ui/Button';
import { useAuth } from '../../../hooks/useAuth';
import { db } from '../../../firebase/client';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import ContractUploadModal from './ContractUploadModal';
import ContractViewerModal from './ContractViewerModal';
import { LoadingSkeleton } from '../../../components/ui/LoadingSkeleton';

export const ContractTab = ({ data = {}, isLoading = false, onUpdate, userId, allowUpload }) => {
    const { user } = useAuth();
    const [contracts, setContracts] = useState([]);
    const [loading, setLoading] = useState(isLoading);
    const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
    const [selectedContract, setSelectedContract] = useState(null);
    const [isViewerOpen, setIsViewerOpen] = useState(false);

    // Use passed userId or fallback to current user (for My Profile)
    const targetUserId = userId || user?.uid;

    const canAddContract = allowUpload;

    // Real-time contracts listener (includes both regular contracts and HR onboarding documents)
    useEffect(() => {
        if (!targetUserId) return;

        console.log('[ContractTab] Fetching contracts for userId:', targetUserId);
        setLoading(true);
        const contractsRef = collection(db, 'users', targetUserId, 'contracts');
        const q = query(contractsRef, orderBy('createdAt', 'desc'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            console.log('[ContractTab] Received contracts snapshot:', snapshot.docs.length, 'documents');
            const userContracts = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            console.log('[ContractTab] Contracts:', userContracts);
            setContracts(userContracts);
            setLoading(false);
        }, (error) => {
            console.error("[ContractTab] Error listening to contracts:", error);
            // Don't show toast on every error potential to avoid spam if permission denied temporarily
            setLoading(false);
        });

        return () => unsubscribe();
    }, [targetUserId]);

    const handleViewContract = (contract) => {
        setSelectedContract(contract);
        setIsViewerOpen(true);
    };

    return (
        <div className="space-y-6">
            <div className="bg-white rounded-lg border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <Briefcase className="w-5 h-5 text-purple-600" />
                        <h3 className="text-lg font-semibold text-gray-900">Employment Contracts</h3>
                    </div>
                    {canAddContract && !loading && (
                        <Button
                            variant="secondary"
                            size="sm"
                            icon={Plus}
                            onClick={() => setIsUploadModalOpen(true)}
                        >
                            Add Contract
                        </Button>
                    )}
                </div>
                {loading ? (
                <div className="space-y-3 animate-pulse">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="flex items-center gap-4 p-4 border border-gray-100 rounded-lg">
                            <LoadingSkeleton height="h-10" width="w-10" className="rounded flex-shrink-0" />
                            <div className="flex-1 space-y-2">
                                <LoadingSkeleton height="h-4" width="w-48" />
                                <LoadingSkeleton height="h-3" width="w-32" />
                            </div>
                            <LoadingSkeleton height="h-8" width="w-20" className="rounded" />
                        </div>
                    ))}
                </div>
                ) : (
                <>
                {contracts && contracts.length > 0 ? (
                    <div className="space-y-4">
                        {contracts.map((contract) => (
                            <div
                                key={contract.id}
                                className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition cursor-pointer"
                                onClick={() => handleViewContract(contract)}
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex items-start gap-4">
                                        <div className={`p-2 rounded-lg ${contract.status === 'signed' ? 'bg-green-100 text-green-600' : 'bg-yellow-100 text-yellow-600'
                                            }`}>
                                            <FileText className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <h4 className="font-semibold text-gray-900">
                                                {contract.title}
                                            </h4>
                                            <p className="text-sm text-gray-500 mt-1">
                                                Uploaded by {contract.uploadedByName} • {new Date(contract.createdAt?.toDate ? contract.createdAt.toDate() : Date.now()).toLocaleDateString()}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {contract.status === 'signed' ? (
                                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                                <CheckCircle className="w-3 h-3 mr-1" />
                                                Signed
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                                <Clock className="w-3 h-3 mr-1" />
                                                Pending Signature
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-12 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                        <Briefcase className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                        <p className="text-gray-600 font-medium">No contracts found</p>
                        <p className="text-sm text-gray-500 mb-4">Upload employment contracts for digital signing.</p>
                    </div>
                )}
                </>
                )}
            </div>

            <ContractUploadModal
                isOpen={isUploadModalOpen}
                onClose={() => setIsUploadModalOpen(false)}
                userId={targetUserId}
                onUploadSuccess={() => { }} // No-op, handled by real-time listener
            />

            <ContractViewerModal
                isOpen={isViewerOpen}
                onClose={() => setIsViewerOpen(false)}
                contract={selectedContract}
                userId={targetUserId}
                onSignSuccess={() => { }} // No-op, handled by real-time listener
            />
        </div>
    );
};
