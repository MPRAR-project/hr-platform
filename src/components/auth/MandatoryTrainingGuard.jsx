import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { trainingService } from '../../services/trainingService';
import MandatoryTrainingCompletion from './MandatoryTrainingCompletion';
import Loader from '../ui/Loader';

const MandatoryTrainingGuard = ({ children }) => {
    const { user } = useAuth();
    const [checking, setChecking] = useState(true);
    const [blockingAssignments, setBlockingAssignments] = useState([]);

    // Usage of ref to prevent parallel checks (race condition fix) - Forced Rebuild
    const checkingRef = useRef(false);

    const checkCompliance = async () => {
        if (!user) {
            setChecking(false);
            return;
        }

        // Prevent concurrent checks
        if (checkingRef.current) return;
        checkingRef.current = true;

        // 1. Check if user is flagged for mandatory training
        if (!user.isTrainingMandatory) {
            setChecking(false);
            checkingRef.current = false;
            return;
        }

        try {
            const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
            const userId = user.userId || user.uid;

            // 1. Get user assignments via REST
            let userAssignments = await trainingService.getMyTrainingAssignments(userId);

            // 2. Get all active courses for the company via REST
            const courses = await trainingService.getTrainingCourses(companyId);
            const allMandatoryTrainings = courses
                .filter(t => t.status === 'active' && (t.category === 'Mandatory on Sign Up' || t.trainingType === 'Mandatory on Sign Up'));

            if (allMandatoryTrainings.length === 0) {
                setChecking(false);
                checkingRef.current = false;
                return;
            }

            // 3. Lazy Auto-Assignment Logic
            const assignedTrainingIds = new Set(userAssignments.map(a => a.trainingId));
            // FIXED: Ensure we don't double count if userAssignments has duplicates
            const missingTrainings = allMandatoryTrainings.filter(t => !assignedTrainingIds.has(t.id));

            if (missingTrainings.length > 0) {
                console.log(`MandatoryTrainingGuard: Auto-assigning ${missingTrainings.length} trainings to ${user.userId}`);
                const today = new Date();
                const dueDate = new Date();
                dueDate.setDate(today.getDate() + 7);

                await Promise.all(missingTrainings.map(training =>
                    trainingService.assignTraining(
                        training.id,
                        userId,
                        userId,
                        { isAutoAssigned: true }
                    )
                ));

                // Re-fetch assignments after creation
                userAssignments = await trainingService.getMyTrainingAssignments(userId);
            }

            // 4. Check status and Deduplicate
            const mandatoryTrainingIds = new Set(allMandatoryTrainings.map(t => t.id));
            const relevantAssignments = userAssignments.filter(a => mandatoryTrainingIds.has(a.trainingId));

            // DEDUPLICATION LOGIC:
            // If multiple assignments exist for the same training, pick the "best" one (Completed > Pending Approval > Assigned)
            const uniqueAssignmentsMap = new Map();

            const getStatusPriority = (status) => {
                if (status === 'completed') return 3;
                if (status === 'pending_approval') return 2;
                return 1;
            };

            relevantAssignments.forEach(assignment => {
                const existing = uniqueAssignmentsMap.get(assignment.trainingId);
                if (!existing) {
                    uniqueAssignmentsMap.set(assignment.trainingId, assignment);
                } else {
                    // Compare priorities
                    if (getStatusPriority(assignment.status) > getStatusPriority(existing.status)) {
                        uniqueAssignmentsMap.set(assignment.trainingId, assignment);
                    }
                }
            });

            const uniqueAssignments = Array.from(uniqueAssignmentsMap.values());

            // Enrich
            const enrichedAssignments = uniqueAssignments.map(a => {
                const training = allMandatoryTrainings.find(t => t.id === a.trainingId);
                return { ...a, training };
            });

            // FIXED: Allow 'pending_approval' to pass
            const incomplete = enrichedAssignments.filter(a => a.status !== 'completed' && a.status !== 'pending_approval');

            if (incomplete.length > 0) {
                // Pass ALL unique mandatory assignments so user sees the full list state
                setBlockingAssignments(enrichedAssignments);
            } else {
                console.log('MandatoryTrainingGuard: All mandatory trainings completed or pending approval.');
                setBlockingAssignments([]);
            }

        } catch (error) {
            console.error('MandatoryTrainingGuard Check Failed:', error);
        } finally {
            setChecking(false);
            checkingRef.current = false;
        }
    };

    useEffect(() => {
        checkCompliance();
    }, [user, user?.isOnboardingMandatory]); // Re-run if user or flag changes

    if (checking) {
        return <Loader variant="spinner" fullScreen text="Checking compliance..." />;
    }

    // If there are blocking assignments, show the completion screen
    // Double check the blocking condition here to be safe
    const isBlocked = blockingAssignments.some(a => a.status !== 'completed' && a.status !== 'pending_approval');

    if (blockingAssignments.length > 0 && isBlocked) {
        return (
            <MandatoryTrainingCompletion
                assignments={blockingAssignments}
                onRefresh={checkCompliance}
            />
        );
    }

    // Otherwise render the app
    return children;
};

export default MandatoryTrainingGuard;
