import React, { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle, Lock, Play, RefreshCw, LogOut } from 'lucide-react';
import { trainingService } from '../../services/trainingService';
import ViewTrainingModal from '../modals/ViewTrainingModal';
import Button from '../ui/Button';
import Loader from '../ui/Loader';
import { useAuth } from '../../hooks/useAuth';

const MandatoryTrainingCompletion = ({ assignments, onRefresh }) => {
    const { user, signOut } = useAuth();
    const [selectedTraining, setSelectedTraining] = useState(null);
    const [selectedAssignment, setSelectedAssignment] = useState(null);
    const [showModal, setShowModal] = useState(false);

    const handleOpenTraining = async (assignment) => {
        // If we have the full training object in the assignment, use it
        // Otherwise we might need to fetch it, but usually listed assignments include training stub
        // For ViewTrainingModal, we ideally need the full training details.

        let trainingData = assignment.training;
        if (!trainingData || !trainingData.description) {
            // Fetch full training if needed (optional optimization)
            const result = await trainingService.getTrainingById(assignment.trainingId);
            if (result.success) {
                trainingData = result.data;
            }
        }

        setSelectedTraining(trainingData);
        setSelectedAssignment(assignment);
        setShowModal(true);
    };

    const handleModalClose = () => {
        setShowModal(false);
        setSelectedTraining(null);
        setSelectedAssignment(null);
        if (onRefresh) onRefresh();
    };

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
            <div className="max-w-3xl w-full bg-white rounded-2xl shadow-xl overflow-hidden">
                {/* Header */}
                <div className="bg-gradient-to-r from-red-600 to-red-700 p-8 text-center">
                    <div className="mx-auto w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mb-4 backdrop-blur-sm">
                        <Lock className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-3xl font-bold text-white mb-2">Mandatory Training Required</h1>
                    <p className="text-red-100 text-lg max-w-xl mx-auto">
                        You must complete the following mandatory training(s) before accessing the dashboard.
                    </p>
                </div>

                {/* Content */}
                <div className="p-8">
                    <div className="mb-6 flex justify-between items-center">
                        <h2 className="text-xl font-semibold text-gray-800">Pending Assignments</h2>
                        <Button
                            variant="outline-secondary"
                            size="sm"
                            onClick={onRefresh}
                            icon={RefreshCw}
                        >
                            Refresh Status
                        </Button>
                    </div>

                    <div className="space-y-4">
                        {assignments.map((assignment) => {
                            const isCompleted = assignment.status === 'completed';
                            return (
                                <div
                                    key={assignment.id}
                                    className={`border rounded-xl p-5 transition-all ${isCompleted ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200 hover:border-purple-200 hover:shadow-sm'
                                        }`}
                                >
                                    <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                {isCompleted ? (
                                                    <CheckCircle className="w-5 h-5 text-green-600" />
                                                ) : (
                                                    <AlertCircle className="w-5 h-5 text-orange-500" />
                                                )}
                                                <h3 className={`font-bold text-lg ${isCompleted ? 'text-green-800' : 'text-gray-900'}`}>
                                                    {assignment.training?.name || 'Mandatory Training'}
                                                </h3>
                                            </div>
                                            <p className="text-sm text-gray-500 pl-7">
                                                {assignment.training?.description || 'Please complete this training to proceed.'}
                                            </p>
                                        </div>

                                        <div>
                                            {isCompleted ? (
                                                <span className="px-4 py-2 bg-white text-green-700 font-medium rounded-lg border border-green-200 text-sm flex items-center gap-2">
                                                    <CheckCircle className="w-4 h-4" /> Completed
                                                </span>
                                            ) : (
                                                <Button
                                                    onClick={() => handleOpenTraining(assignment)}
                                                    variant="solid-primary"
                                                    icon={Play}
                                                >
                                                    Start Training
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <div className="mt-8 pt-6 border-t border-gray-100 flex justify-center">
                        <Button variant="ghost" className="text-gray-500 hover:text-gray-700" onClick={signOut} icon={LogOut}>
                            Log Out
                        </Button>
                    </div>
                </div>
            </div>

            {/* Re-use existing ViewTrainingModal */}
            {selectedTraining && (
                <ViewTrainingModal
                    isOpen={showModal}
                    onClose={handleModalClose}
                    training={selectedTraining}
                    assignment={selectedAssignment}
                    user={user}
                    employee={{ name: user?.displayName || 'User', id: user?.uid }}
                // We can assume auto-approval or self-upload depending on training type logic
                // But usually ViewTrainingModal allows upload if configured.
                />
            )}
        </div>
    );
};

export default MandatoryTrainingCompletion;
