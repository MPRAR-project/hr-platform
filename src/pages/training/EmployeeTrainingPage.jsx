import React, { useMemo, useState, useEffect } from 'react';
import { deleteDoc, doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/client';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { Search, Briefcase, Calendar, ArrowLeft, FileText, CheckCircle, AlertTriangle, XCircle, CreditCard, Plus, ChevronDown } from 'lucide-react';
import Header from '../../components/layout/Header';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import StatCard from '../../components/shared/StatCard';
import ViewTrainingModal from '../../components/modals/ViewTrainingModal';
import AddTrainingModal from '../../components/modals/AddTrainingModal';
import EditTrainingAssignmentModal from '../../components/modals/EditTrainingAssignmentModal';
import ApprovalConfirmationModal from '../../components/modals/ApprovalConfirmationModal';
import DeleteConfirmationModal from '../../components/modals/DeleteConfirmationModal';
import AddDocumentModal from '../../components/modals/AddDocumentModal';
import RequestExtensionModal from '../../components/modals/RequestExtensionModal';
import { useAuth } from '../../hooks/useAuth';
import { trainingService } from '../../services/trainingService';
import { certificateService } from '../../services/certificateService';
import { trainingPermissionService } from '../../services/trainingPermissions';
import { extensionService } from '../../services/extensionService';
import { getUserById, getUserOnboardingDetails } from '../../services/users';
import { toast } from 'react-toastify';
import Loader from '../../components/ui/Loader';

const EmployeeTrainingPage = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { id: employeeId } = useParams();
    const { user } = useAuth();

    const preloadedEmployee = location?.state?.preloadedEmployee || null;
    const preloadedAssignments = location?.state?.preloadedAssignments || null;

    const hasPreloaded = useMemo(() => Array.isArray(preloadedAssignments) && preloadedAssignments.length >= 0, [preloadedAssignments]);

    // State management
    const [loading, setLoading] = useState(!hasPreloaded);
    const [refreshing, setRefreshing] = useState(false);
    const [employee, setEmployee] = useState(null);
    const [assignments, setAssignments] = useState([]);
    const [error, setError] = useState(null);

    // UI state
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState('All Status');
    const [showViewModal, setShowViewModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [showApproveModal, setShowApproveModal] = useState(false);
    const [showDeclineModal, setShowDeclineModal] = useState(false);
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [showExtensionModal, setShowExtensionModal] = useState(false);
    const [showExtensionApprovalModal, setShowExtensionApprovalModal] = useState(false);
    const [showExtensionDeclineModal, setShowExtensionDeclineModal] = useState(false);
    const [selectedTraining, setSelectedTraining] = useState(null);
    const [selectedAssignment, setSelectedAssignment] = useState(null);
    const [selectedExtensionRequest, setSelectedExtensionRequest] = useState(null);
    const [uploaderName, setUploaderName] = useState(null); // Store uploader name for selected assignment
    const [isLoadingUploaderName, setIsLoadingUploaderName] = useState(false);

    // User capabilities based on role
    const userCapabilities = {
        canCreateTraining: trainingPermissionService.hasPermission(user?.role, 'createTraining'),
        canEditTraining: trainingPermissionService.hasPermission(user?.role, 'editTraining'),
        canDeleteTraining: trainingPermissionService.hasPermission(user?.role, 'deleteTraining'),
        canAssignTraining: trainingPermissionService.hasPermission(user?.role, 'assignTraining'),
        canApproveTraining: trainingPermissionService.hasPermission(user?.role, 'approveTraining'),
        canViewAnalytics: trainingPermissionService.hasPermission(user?.role, 'viewAnalytics')
    };

    // Helper functions for self-approval prevention
    const canApproveAssignment = (assignment) => {
        // User must have approval permissions
        if (!userCapabilities.canApproveTraining) {
            return false;
        }

        // Prevent self-approval: user cannot approve their own training assignments
        if (assignment.userId === user?.uid) {
            return false;
        }

        return true;
    };

    const canApproveExtension = (assignment) => {
        // User must have approval permissions
        if (!userCapabilities.canApproveTraining) {
            return false;
        }

        // Prevent self-approval: user cannot approve their own extension requests
        if (assignment.userId === user?.uid) {
            return false;
        }

        return true;
    };

    const isViewingOwnTraining = () => {
        return employeeId === user?.uid;
    };

    const buildEmployeeFromUserDoc = (userDoc) => {
        if (!userDoc) return null;
        const employmentDetails = userDoc.employmentDetails || {};
        const name = userDoc.displayName || `${userDoc.firstName || ''} ${userDoc.lastName || ''}`.trim() || '';
        return {
            id: employeeId,
            name,
            email: userDoc.email || 'unknown@company.com',
            role: userDoc.primaryRole || 'Employee',
            department: employmentDetails.department || userDoc.department || 'Development',
            hireDate: employmentDetails.startDate || employmentDetails.hireDate || userDoc.hireDate || '2022-03-15',
            employeeId: employmentDetails.employeeId || userDoc.employeeId || userDoc.employeeNumber || `EMP${new Date().getFullYear()}${employeeId.slice(-4)}`,
            jobTitle: employmentDetails.jobTitle || employmentDetails.position || userDoc.jobTitle || 'Employee',
            manager: employmentDetails.manager || userDoc.reportsTo || 'Not Assigned',
            phone: userDoc.phone || 'Not Provided',
            address: userDoc.address || 'Not Provided'
        };
    };

    // Hydrate instantly from route state and fetch employee data
    useEffect(() => {
        if (!user || !employeeId) return;

        if (preloadedEmployee) {
            setEmployee(buildEmployeeFromUserDoc(preloadedEmployee));
        }

        if (Array.isArray(preloadedAssignments)) {
            setAssignments(preloadedAssignments);
        }

        if (hasPreloaded) {
            setLoading(false);
        }

        // Fetch employee data if not preloaded
        if (!employee) {
            loadEmployeeTrainingData();
        }
    }, [user, employeeId, preloadedEmployee, preloadedAssignments]);

    // REAL-TIME SUBSCRIPTIONS: Listen for changes to training assignments
    useEffect(() => {
        if (!user || !user.companyId || !employeeId) return;

        const companyIdRaw = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;

        console.log('[EmployeeTraining] Setting up real-time subscriptions for:', employeeId);

        // Subscribe to assignments for this specific employee
        const unsubscribeAssignments = trainingService.subscribeAssignments(companyIdRaw, employeeId, (result) => {
            if (result.success) {
                console.log('[EmployeeTraining] Assignments updated:', result.data.length);
                setAssignments(result.data);
            }
        });

        return () => {
            console.log('[EmployeeTraining] Cleaning up subscriptions');
            unsubscribeAssignments();
        };
    }, [user?.companyId, employeeId]);

    const loadEmployeeTrainingData = async ({ background = false } = {}) => {
        if (!user || !user.companyId || !employeeId) return;

        try {
            if (background) {
                setRefreshing(true);
            } else {
                setLoading(true);
            }
            setError(null);

            const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;

            // Fetch real user data from users collection
            const [userData, onboardingData] = await Promise.all([
                getUserById(employeeId),
                getUserOnboardingDetails(employeeId)
            ]);

            // Note: assignments are now handled by real-time subscriptions

            // Set employee data from real user information
            if (userData) {
                const employmentDetails = userData.employmentDetails || {};
                const personalDetails = onboardingData?.personalDetails || {};

                // Debug logging to see what data is available
                console.log('User Data:', userData);
                console.log('Employment Details:', employmentDetails);
                console.log('Personal Details:', personalDetails);
                console.log('Onboarding Data:', onboardingData);

                // Try multiple possible fields for employee ID
                const possibleEmployeeId =
                    employmentDetails.employeeId ||
                    employmentDetails.employeeNumber ||
                    personalDetails.employeeId ||
                    personalDetails.employeeNumber ||
                    userData.employeeId ||
                    userData.employeeNumber ||
                    onboardingData?.employeeId ||
                    onboardingData?.employeeNumber ||
                    // Generate a more realistic employee ID based on user data
                    (() => {
                        const year = new Date().getFullYear();
                        const firstName = userData.firstName || '';
                        const lastName = userData.lastName || '';
                        const initials = (firstName.charAt(0) + lastName.charAt(0)).toUpperCase();
                        const shortId = employeeId.slice(-4);
                        return initials ? `${initials}${year}${shortId}` : `EMP${year}${shortId}`;
                    })();

                setEmployee({
                    id: employeeId,
                    name: userData.displayName || `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || '',
                    email: userData.email || 'unknown@company.com',
                    role: userData.primaryRole || 'Employee',
                    department: employmentDetails.department || personalDetails.department || userData.department || 'Development',
                    hireDate: employmentDetails.startDate || employmentDetails.hireDate || personalDetails.startDate || userData.hireDate || '2022-03-15',
                    employeeId: possibleEmployeeId,
                    jobTitle: employmentDetails.jobTitle || employmentDetails.position || personalDetails.jobTitle || personalDetails.position || userData.jobTitle || 'Employee',
                    manager: employmentDetails.manager || personalDetails.manager || userData.reportsTo || 'Not Assigned',
                    phone: personalDetails.phone || userData.phone || 'Not Provided',
                    address: personalDetails.address || userData.address || 'Not Provided'
                });
            } else {
                // Fallback if user not found
                const fallbackEmployeeId = `EMP${new Date().getFullYear()}${employeeId.slice(-4)}`;
                setEmployee({
                    id: employeeId,
                    name: '',
                    email: 'unknown@company.com',
                    role: 'Employee',
                    department: 'Development',
                    hireDate: '2022-03-15',
                    employeeId: fallbackEmployeeId,
                    jobTitle: 'Employee',
                    manager: 'Not Assigned',
                    phone: 'Not Provided',
                    address: 'Not Provided'
                });
            }

        } catch (error) {
            console.error('Error loading employee training data:', error);
            setError(error.message);
            toast.error('Failed to load employee training data');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const handleBack = () => {
        navigate('/training', { state: { activeTab: 'Employee Training' } });
    };

    const handleViewDetails = (assignment) => {
        setSelectedTraining(assignment.training);
        setSelectedAssignment(assignment);
        setShowViewModal(true);
    };

    const handleEditAssignment = (assignment) => {
        setSelectedAssignment(assignment);
        setShowEditModal(true);
    };

    const handleApproveClick = (assignment) => {
        setSelectedAssignment(assignment);
        setShowApproveModal(true);
    };

    const handleDeclineClick = (assignment) => {
        setSelectedAssignment(assignment);
        setShowDeclineModal(true);
    };

    const handleUploadClick = (assignment) => {
        setSelectedAssignment(assignment);
        setShowUploadModal(true);
    };

    const handleExtensionClick = (assignment) => {
        setSelectedAssignment(assignment);
        setShowExtensionModal(true);
    };

    const handleExtensionSubmit = async (extensionData) => {
        try {
            const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
            const result = await extensionService.submitExtensionRequest(
                extensionData,
                user.uid,
                companyId
            );

            if (result.success) {
                toast.success('Extension request submitted successfully');
                setShowExtensionModal(false);
                setSelectedAssignment(null);
                loadEmployeeTrainingData(); // Reload data to show updated status
            }
        } catch (error) {
            console.error('Error submitting extension request:', error);
            toast.error(error.message);
        }
    };

    const handleApproveExtensionClick = (assignment) => {
        // Only open modal if extension is still pending
        if (assignment.extensionStatus !== 'pending') {
            toast.warning('Extension request is no longer pending');
            return;
        }
        setSelectedAssignment(assignment);
        setSelectedExtensionRequest({
            id: assignment.extensionRequestId,
            trainingName: assignment.training?.name,
            currentDueDate: assignment.dueDate,
            requestedDueDate: assignment.requestedDueDate || assignment.dueDate,
            reason: assignment.extensionReason || 'Extension requested',
            justification: assignment.extensionJustification || assignment.extensionRequest?.justification || ''
        });
        setShowExtensionApprovalModal(true);
    };

    const handleDeclineExtensionClick = (assignment) => {
        setSelectedAssignment(assignment);
        setSelectedExtensionRequest({
            id: assignment.extensionRequestId,
            trainingName: assignment.training?.name,
            currentDueDate: assignment.dueDate,
            requestedDueDate: assignment.requestedDueDate || assignment.dueDate,
            reason: assignment.extensionReason || 'Extension requested'
        });
        setShowExtensionDeclineModal(true);
    };

    const handleApproveExtensionConfirm = async (notes) => {
        if (!selectedExtensionRequest?.id) {
            toast.error('No extension request selected');
            throw new Error('No extension request selected');
        }

        const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
        const result = await extensionService.approveExtensionRequest(
            selectedExtensionRequest.id,
            user.uid,
            user.role,
            companyId,
            notes
        );

        if (result.success) {
            // Close modal and clear state BEFORE reloading data
            setShowExtensionApprovalModal(false);
            setSelectedAssignment(null);
            setSelectedExtensionRequest(null);

            toast.success('Extension request approved successfully');

            // Reload data after a small delay to ensure state is cleared
            setTimeout(async () => {
                await loadEmployeeTrainingData();
            }, 100);
        } else {
            throw new Error(result.error || 'Failed to approve extension request');
        }
    };

    const handleDeclineExtensionConfirm = async (reason) => {
        try {
            if (!selectedExtensionRequest?.id) {
                toast.error('No extension request selected');
                return;
            }

            const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
            const result = await extensionService.declineExtensionRequest(
                selectedExtensionRequest.id,
                user.uid,
                user.role,
                companyId,
                reason
            );

            if (result.success) {
                toast.success('Extension request declined');
                setShowExtensionDeclineModal(false);
                setSelectedAssignment(null);
                setSelectedExtensionRequest(null);
                loadEmployeeTrainingData(); // Reload data
            }
        } catch (error) {
            console.error('Error declining extension request:', error);
            toast.error(error.message);
        }
    };

    const handleApproveConfirm = async (notes) => {
        try {
            if (selectedAssignment?.certificateId) {
                const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
                const result = await certificateService.approveCertificate(
                    selectedAssignment.certificateId,
                    user.uid,
                    user.role,
                    companyId,
                    notes
                );

                if (result.success) {
                    toast.success('Certificate approved successfully');
                    setShowApproveModal(false);
                    setSelectedAssignment(null);
                    loadEmployeeTrainingData(); // Reload data
                }
            }
        } catch (error) {
            console.error('Error approving certificate:', error);
            toast.error(error.message);
        }
    };

    const handleDeclineConfirm = async (itemId, reason) => {
        try {
            // reason is passed as second parameter from ApprovalConfirmationModal
            if (!reason || !reason.trim()) {
                toast.error('Decline reason is required');
                return;
            }

            if (selectedAssignment?.certificateId) {
                const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
                const result = await certificateService.declineCertificate(
                    selectedAssignment.certificateId,
                    user.uid,
                    user.role,
                    companyId,
                    reason.trim()
                );

                if (result.success) {
                    toast.success('Certificate declined');
                    setShowDeclineModal(false);
                    setSelectedAssignment(null);
                    await loadEmployeeTrainingData(); // Reload data
                } else {
                    throw new Error(result.error || 'Failed to decline certificate');
                }
            }
        } catch (error) {
            console.error('Error declining certificate:', error);
            toast.error(error.message || 'Failed to decline certificate');
            // Don't close modal on error so user can try again
        }
    };

    const handleCertificateUpload = async (uploadData) => {
        try {
            if (!selectedAssignment) {
                throw new Error('No assignment selected');
            }

            const { file, documentDescription, documentTitle } = uploadData;
            const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
            const result = await certificateService.submitCertificate(
                selectedAssignment.id,
                file,
                user.uid,
                companyId,
                documentDescription || '',
                documentTitle,
                user.role
            );

            if (result.success) {
                toast.success('Certificate uploaded successfully');
                await loadEmployeeTrainingData(); // Reload data

                // Close modal and reset state only after successful upload
                setShowUploadModal(false);
                setSelectedAssignment(null);
                return result;
            } else {
                throw new Error(result.error || 'Upload failed');
            }
        } catch (error) {
            console.error('Error uploading certificate:', error);
            toast.error(error.message);
            throw error; // Re-throw to let the modal handle the error
        }
    };

    const handleCreateAndAssignTraining = async (trainingData) => {
        try {
            if (!user || !user.companyId || !employeeId) return;

            const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;

            // Extract assignment-specific data
            const { assignmentDate, dueDate, expiryDate, ...trainingFields } = trainingData;

            // First create the training
            const createResult = await trainingService.createTraining({
                ...trainingFields,
                companyId
            }, user.userId);

            if (createResult.success) {
                // Then assign it to the specific employee with custom dates
                const assignResult = await trainingService.assignTraining(
                    createResult.data.id, // training ID
                    [employeeId], // array of user IDs (just this employee)
                    user.uid, // assigned by
                    companyId,
                    user.role,
                    dueDate, // use the due date from form
                    {
                        assignmentDate: assignmentDate,
                        expiryDate: expiryDate
                    }
                );

                if (assignResult.success) {
                    toast.success('Training created and assigned successfully');
                    setShowAddModal(false);
                    loadEmployeeTrainingData(); // Reload data to show the new assignment
                } else {
                    toast.error('Training created but failed to assign: ' + assignResult.error);
                }
            } else {
                toast.error('Failed to create training: ' + createResult.error);
            }
        } catch (error) {
            console.error('Error creating and assigning training:', error);
            toast.error(error.message);
        }
    };

    const getStatusVariant = (status) => {
        switch (status) {
            case 'completed': return 'success';
            case 'pending_approval': return 'warning';
            case 'assigned': return 'info';
            case 'in_progress': return 'info';
            case 'declined': return 'danger';
            case 'expired': return 'danger';
            case 'overdue': return 'danger';
            default: return 'secondary';
        }
    };

    const getStatusDisplay = (status) => {
        switch (status) {
            case 'pending_approval': return 'Pending Approval';
            case 'in_progress': return 'In Progress';
            case 'assigned': return 'Assigned';
            case 'completed': return 'Completed';
            case 'declined': return 'Declined';
            case 'expired': return 'Expired';
            case 'overdue': return 'Overdue';
            default: return status.charAt(0).toUpperCase() + status.slice(1);
        }
    };

    // Fetch uploader name when assignment is selected
    useEffect(() => {
        const fetchUploaderNameForAssignment = async () => {
            if (!selectedAssignment?.certificateId) {
                setUploaderName(null);
                return;
            }

            setIsLoadingUploaderName(true);
            try {
                // Determine uploader ID
                let uploadedByUserId = selectedAssignment.certificateUploadedBy;

                // If missing from assignment, fetch the certificate document
                if (!uploadedByUserId) {
                    const certRef = doc(db, 'trainingCertificates', selectedAssignment.certificateId);
                    const certSnap = await getDoc(certRef);
                    if (certSnap.exists()) {
                        uploadedByUserId = certSnap.data().uploadedBy;
                    }
                }

                if (!uploadedByUserId) {
                    setUploaderName('Admin');
                    return;
                }

                // Optimization: If current user is the uploader, use their name from state
                if (uploadedByUserId === user?.uid) {
                    setUploaderName(user.displayName || user.email || 'Admin');
                    return;
                }

                // Optimization: If employee is the uploader, use employee name from state
                if (uploadedByUserId === selectedAssignment.userId) {
                    setUploaderName(employee?.name || 'Employee');
                    return;
                }

                // Fetch user data for other uploaders
                const userData = await getUserById(uploadedByUserId);
                if (userData) {
                    const displayName = userData.displayName || `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || userData.email || '';
                    setUploaderName(displayName);
                } else {
                    setUploaderName('');
                }
            } catch (error) {
                console.error('Error fetching uploader name:', error);
                setUploaderName('Admin');
            } finally {
                setIsLoadingUploaderName(false);
            }
        };

        fetchUploaderNameForAssignment();
    }, [selectedAssignment?.id, selectedAssignment?.certificateId, selectedAssignment?.certificateUploadedBy, user?.uid, user?.displayName, employee?.name]);

    const getUploadedByDisplay = (assignment) => {
        if (!assignment?.certificateId) {
            return 'No Upload';
        }

        // If this is the selected assignment, use the fetched name
        if (assignment.id === selectedAssignment?.id || assignment.certificateId === selectedAssignment?.certificateId) {
            if (isLoadingUploaderName) {
                return 'Loading...';
            }
            return uploaderName || (assignment.certificateUploadedBy === assignment.userId ? (employee?.name || 'Employee') : 'Admin');
        }

        // For other assignments, use simple check
        if (assignment.certificateUploadedBy === assignment.userId) {
            return employee?.name || 'Employee';
        }

        return 'Admin';
    };

    const getTrainingStatusMessage = (assignment) => {
        const now = new Date();
        const dueDate = assignment.dueDate?.toDate ? assignment.dueDate.toDate() : new Date(assignment.dueDate);
        const expiryDate = assignment.expiryDate?.toDate ? assignment.expiryDate.toDate() : new Date(assignment.expiryDate);

        // Calculate days until due date
        const daysUntilDue = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
        const daysUntilExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));

        switch (assignment.status) {
            case 'pending_approval':
                return {
                    message: 'Certificate uploaded - awaiting admin approval',
                    type: 'warning',
                    bgColor: 'bg-yellow-50',
                    textColor: 'text-yellow-800'
                };

            case 'completed':
                if (daysUntilExpiry <= 0) {
                    return {
                        message: 'This training has expired. Please contact your administrator to request reassignment.',
                        type: 'error',
                        bgColor: 'bg-red-50',
                        textColor: 'text-red-800'
                    };
                } else if (daysUntilExpiry <= 30) {
                    return {
                        message: `Training expires in ${daysUntilExpiry} day${daysUntilExpiry !== 1 ? 's' : ''}. Consider renewal soon.`,
                        type: 'warning',
                        bgColor: 'bg-orange-50',
                        textColor: 'text-orange-800'
                    };
                } else {
                    return {
                        message: 'Training completed successfully and is valid.',
                        type: 'success',
                        bgColor: 'bg-green-50',
                        textColor: 'text-green-800'
                    };
                }

            case 'declined':
                return {
                    message: 'Certificate was declined. Please upload a new certificate with the required corrections.',
                    type: 'error',
                    bgColor: 'bg-red-50',
                    textColor: 'text-red-800'
                };

            case 'assigned':
            case 'in_progress':
                // Check if extension is pending
                if (assignment.extensionStatus === 'pending') {
                    return {
                        message: 'Extension request submitted - awaiting approval. Continue working on training while request is reviewed.',
                        type: 'info',
                        bgColor: 'bg-blue-50',
                        textColor: 'text-blue-800'
                    };
                } else if (assignment.extensionStatus === 'declined') {
                    return {
                        message: 'Extension request was declined. Please complete training by the original due date or contact your manager.',
                        type: 'warning',
                        bgColor: 'bg-orange-50',
                        textColor: 'text-orange-800'
                    };
                } else if (daysUntilDue <= 0) {
                    // Check if extension is approved
                    if (assignment.extensionStatus === 'approved') {
                        return {
                            message: 'Extension approved! You can now upload your certificate with the new deadline.',
                            type: 'success',
                            bgColor: 'bg-green-50',
                            textColor: 'text-green-800'
                        };
                    } else {
                        return {
                            message: 'This training is overdue. Certificate upload is disabled. Please request an extension to continue.',
                            type: 'error',
                            bgColor: 'bg-red-50',
                            textColor: 'text-red-800'
                        };
                    }
                } else if (daysUntilDue <= 7) {
                    return {
                        message: `Training due in ${daysUntilDue} day${daysUntilDue !== 1 ? 's' : ''}. Please complete soon or request an extension if needed.`,
                        type: 'warning',
                        bgColor: 'bg-orange-50',
                        textColor: 'text-orange-800'
                    };
                } else if (daysUntilDue <= 14) {
                    return {
                        message: `Training due in ${daysUntilDue} days. Please plan to complete this training.`,
                        type: 'info',
                        bgColor: 'bg-blue-50',
                        textColor: 'text-blue-800'
                    };
                } else {
                    return {
                        message: `Training assigned. Due date: ${formatDate(assignment.dueDate)}`,
                        type: 'info',
                        bgColor: 'bg-purple-50',
                        textColor: 'text-purple-800'
                    };
                }

            case 'expired':
            case 'overdue':
                return {
                    message: 'This training has expired. Please contact your administrator to request reassignment.',
                    type: 'error',
                    bgColor: 'bg-red-50',
                    textColor: 'text-red-800'
                };

            default:
                return {
                    message: 'Training status unknown. Please contact your administrator.',
                    type: 'info',
                    bgColor: 'bg-gray-50',
                    textColor: 'text-gray-800'
                };
        }
    };

    const getEmployeeStats = () => {
        const stats = {
            total: assignments.length,
            completed: assignments.filter(a => a.status === 'completed').length,
            pending: assignments.filter(a => ['assigned', 'in_progress', 'pending_approval'].includes(a.status)).length,
            expired: assignments.filter(a => ['expired', 'overdue', 'declined'].includes(a.status)).length
        };
        return stats;
    };

    const formatDate = (timestamp) => {
        if (!timestamp) return 'N/A';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
    };

    const pretty = (role) =>
        role.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());

    // Early return for loading or no user
    if (!user) {
        return (
            <Loader variant="spinner" size="lg" text="Loading page..." fullScreen={true} />
        );
    }

    if (loading) {
        return (
            <div className="h-screen flex flex-col overflow-hidden">
                <Header
                    title={`${pretty(user.role)} Dashboard`}
                    subtitle="Ensure compliance and manage onboarding from one place."
                />
                <div className="flex-1 flex items-center justify-center">
                    <Loader variant="spinner" size="lg" text="Loading page..." />
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="h-screen flex flex-col overflow-hidden">
                <Header
                    title={`${pretty(user.role)} Dashboard`}
                    subtitle="Ensure compliance and manage onboarding from one place."
                />
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-center">
                        <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 mb-2">Error Loading Data</h3>
                        <p className="text-gray-600 mb-4">{error}</p>
                        <Button onClick={() => loadEmployeeTrainingData()}>Try Again</Button>
                    </div>
                </div>
            </div>
        );
    }

    const handleAssignmentUpdated = (updatedAssignment) => {
        console.log('[EmployeeTrainingPage] Optimistically updating assignment:', updatedAssignment);

        setAssignments(prev => prev.map(a =>
            a.id === updatedAssignment.id ? { ...a, ...updatedAssignment } : a
        ));

        if (selectedAssignment?.id === updatedAssignment.id) {
            setSelectedAssignment(prev => ({ ...prev, ...updatedAssignment }));
        }
    };

    const employeeStats = getEmployeeStats();


    return (
        <div className="h-screen flex flex-col overflow-hidden">
            <Header
                title={`${pretty(user.role)} Dashboard`}
                subtitle="Ensure compliance and manage onboarding from one place."
            />

            <div className="flex-1 overflow-y-auto p-4 md:p-3xl scrollbar-custom">
                <div className="max-w-7xl mx-auto space-y-6">
                    {/* Back Button */}
                    <button
                        onClick={handleBack}
                        className="flex items-center gap-2 text-text-primary hover:text-text-accent-purple transition-colors mb-4"
                    >
                        <ArrowLeft className="h-5 w-5" />
                        <span className="text-xl font-bold">Employee Training Management</span>
                    </button>
                    <p className="text-sm text-text-secondary -mt-2">Manage employee Training Documents</p>

                    {/* Employee Info Card */}
                    <div className="bg-white shadow-md rounded-base p-4 md:p-6">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                                <img
                                    src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${employee?.name || 'User'}`}
                                    alt={employee?.name || 'Employee'}
                                    className="w-12 h-12 rounded-full"
                                />
                                <div>
                                    <div className="flex items-center gap-3 mb-2">
                                        <h2 className="text-lg font-bold text-text-primary">{employee?.name || 'Employee'}</h2>
                                    </div>
                                    <p className="text-sm text-text-secondary mb-2">{employee?.email || 'unknown@company.com'}</p>
                                    <div className="flex flex-wrap items-center gap-4 text-sm">
                                        <span className="flex items-center gap-1 text-orange-500">
                                            <Briefcase className="h-3 w-3" />
                                            {employee?.jobTitle || employee?.role || 'Employee'} - {employee?.department || 'Development'}
                                        </span>
                                        <span className="flex items-center gap-1 text-blue-500">
                                            <Calendar className="h-3 w-3" />
                                            Hired: {employee?.hireDate || '2022-03-15'}
                                        </span>
                                        <span className="flex items-center gap-1 text-green-500">
                                            <CreditCard className="h-3 w-3" />
                                            ID: {employee?.employeeId || 'EMP-2024-001'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <Badge variant="info">{employee?.role || 'Employee'}</Badge>
                        </div>
                    </div>

                    {/* Stats */}
                    <div className="flex flex-wrap gap-xl">
                        <StatCard
                            title="Total"
                            value={employeeStats.total.toString()}
                            subtitle=""
                            icon={<FileText className="h-6 w-6 text-blue-500" />}
                            iconBgColor="bg-blue-50"
                        />
                        <StatCard
                            title="Completed"
                            value={employeeStats.completed.toString()}
                            subtitle=""
                            icon={<CheckCircle className="h-6 w-6 text-green-500" />}
                            iconBgColor="bg-green-50"
                        />
                        <StatCard
                            title="Pending"
                            value={employeeStats.pending.toString()}
                            subtitle=""
                            icon={<AlertTriangle className="h-6 w-6 text-orange-500" />}
                            iconBgColor="bg-orange-50"
                        />
                        <StatCard
                            title="Expired"
                            value={employeeStats.expired.toString()}
                            subtitle=""
                            icon={<XCircle className="h-6 w-6 text-red-500" />}
                            iconBgColor="bg-red-50"
                        />
                    </div>

                    {/* Search and Filter */}
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div className='flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full sm:w-auto'>
                            <div className="relative w-full sm:w-96">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-text-secondary" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="search by name or phone or email..."
                                    className="w-full h-12 pl-12 pr-4 border border-border-secondary rounded-full text-sm placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
                                />
                            </div>

                            <div className="flex items-center gap-3">
                                <span className="text-sm text-text-secondary">Filtered by:</span>
                                <div className="relative">
                                    <select
                                        value={filterStatus}
                                        onChange={(e) => setFilterStatus(e.target.value)}
                                        className="h-12 px-4 pr-10 border border-border-secondary rounded-lg text-sm appearance-none focus:outline-none focus:border-border-accent-purple"
                                    >
                                        <option>All Status</option>
                                        <option>Pending Approval</option>
                                        <option>Valid</option>
                                        <option>Expired</option>
                                        <option>Missing</option>
                                    </select>
                                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
                                </div>
                            </div>
                        </div>

                        {/* Do not allow assigning training to senior accounts (Site/Admin/Senior Manager) */}
                        {userCapabilities.canAssignTraining &&
                            !['sitemanager', 'adminmanager', 'seniormanager'].includes((employee?.role || '').toLowerCase()) && (
                            <Button
                                variant="gradient"
                                icon={Plus}
                                onClick={() => setShowAddModal(true)}
                            >
                                Add Training
                            </Button>
                        )}
                    </div>

                    {/* Trainings List */}
                    <div className="space-y-4">
                        {assignments.length === 0 ? (
                            <div className="text-center py-12">
                                <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                                <h3 className="text-lg font-medium text-gray-900 mb-2">No training assignments</h3>
                                <p className="text-gray-600">This employee doesn't have any training assignments at the moment.</p>
                            </div>
                        ) : (
                            assignments
                                .filter(assignment => {
                                    if (filterStatus === 'All Status') return true;
                                    const statusMap = {
                                        'Pending Approval': 'pending_approval',
                                        'Valid': 'completed',
                                        'Expired': 'expired',
                                        'Missing': 'assigned'
                                    };
                                    return assignment.status === statusMap[filterStatus];
                                })
                                .filter(assignment => {
                                    if (!searchQuery) return true;
                                    const searchTerm = searchQuery.toLowerCase();
                                    return (
                                        assignment.training?.name?.toLowerCase().includes(searchTerm) ||
                                        assignment.training?.description?.toLowerCase().includes(searchTerm)
                                    );
                                })
                                .map((assignment) => (
                                    <div key={assignment.id} className="bg-white border border-border-secondary rounded-lg p-6 space-y-4 hover:shadow-md transition-shadow">
                                        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                                            <div className="flex items-center gap-4 flex-1">
                                                <div className="w-12 h-12 bg-purple-50 rounded-lg flex items-center justify-center flex-shrink-0">
                                                    <FileText className="h-6 w-6 text-purple-500" />
                                                </div>
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                                                        <h3 className="font-semibold text-text-primary text-lg">
                                                            {assignment.training?.name || 'Unknown Training'}
                                                        </h3>
                                                        <Badge variant={getStatusVariant(assignment.status)}>
                                                            {getStatusDisplay(assignment.status)}
                                                        </Badge>
                                                    </div>
                                                    <p className="text-sm text-text-secondary mb-2">
                                                        {assignment.training?.description || 'No description available'}
                                                    </p>
                                                    <p className="text-xs text-text-secondary">
                                                        Assigned: {formatDate(assignment.assignedDate)} •
                                                        Due: {formatDate(assignment.dueDate)} •
                                                        Completed: {formatDate(assignment.completedDate)}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex gap-2">
                                                <Button
                                                    variant="outline-primary"
                                                    onClick={() => handleViewDetails(assignment)}
                                                >
                                                    View Details
                                                </Button>
                                                {/* Show Edit button for authorized roles (Site Manager, Admin Manager, Admin Advisor, HR Manager, HR Advisor) */}
                                                {userCapabilities.canEditTraining &&
                                                    ['siteManager', 'adminManager', 'adminAdvisor', 'hrManager', 'hrAdvisor'].includes(user?.role) &&
                                                    assignment.userId !== user?.uid && (
                                                        <Button
                                                            variant="outline-secondary"
                                                            onClick={() => {
                                                                // Find the latest assignment data from the current assignments state
                                                                const latestAssignment = assignments.find(a => a.id === assignment.id) || assignment;
                                                                setSelectedAssignment(latestAssignment);
                                                                setShowEditModal(true);
                                                            }}
                                                        >
                                                            Edit
                                                        </Button>
                                                    )}
                                            </div>
                                        </div>

                                        {/* Status Message */}
                                        {(() => {
                                            const statusInfo = getTrainingStatusMessage(assignment);
                                            return (
                                                <div className={`p-3 rounded-lg ${statusInfo.bgColor} border-l-4 ${statusInfo.type === 'error' ? 'border-red-400' :
                                                    statusInfo.type === 'warning' ? 'border-orange-400' :
                                                        statusInfo.type === 'success' ? 'border-green-400' :
                                                            'border-blue-400'
                                                    }`}>
                                                    <p className={`text-sm font-medium ${statusInfo.textColor}`}>
                                                        {statusInfo.message}
                                                    </p>
                                                </div>
                                            );
                                        })()}

                                        {/* Upload Badge and Actions */}
                                        <div className="flex justify-between items-center flex-wrap gap-3">
                                            <Badge variant="role" className="text-sm">
                                                {getUploadedByDisplay(assignment)}
                                            </Badge>

                                            <div className="flex gap-3 flex-wrap">
                                                {assignment.status === 'pending_approval' && canApproveAssignment(assignment) && (
                                                    <>
                                                        <Button
                                                            variant="outline-danger"
                                                            icon={XCircle}
                                                            onClick={() => handleDeclineClick(assignment)}
                                                        >
                                                            Decline
                                                        </Button>
                                                        <Button
                                                            variant="solid-success"
                                                            icon={CheckCircle}
                                                            onClick={() => handleApproveClick(assignment)}
                                                        >
                                                            Approve
                                                        </Button>
                                                    </>
                                                )}

                                                {/* Show message when user cannot approve their own certificate */}
                                                {assignment.status === 'pending_approval' && userCapabilities.canApproveTraining && assignment.userId === user?.uid && (
                                                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
                                                        <AlertTriangle className="h-4 w-4 inline mr-2" />
                                                        You cannot approve your own training certificate. Another manager must review and approve this.
                                                    </div>
                                                )}

                                                {/* Extension approval buttons for managers/admins */}
                                                {assignment.extensionStatus === 'pending' && canApproveExtension(assignment) && (
                                                    <>
                                                        <Button
                                                            variant="outline-danger"
                                                            icon={XCircle}
                                                            onClick={() => handleDeclineExtensionClick(assignment)}
                                                        >
                                                            Decline Extension
                                                        </Button>
                                                        <Button
                                                            variant="solid-success"
                                                            icon={CheckCircle}
                                                            onClick={() => handleApproveExtensionClick(assignment)}
                                                        >
                                                            Approve Extension
                                                        </Button>
                                                    </>
                                                )}

                                                {/* Show message when user cannot approve their own extension request */}
                                                {assignment.extensionStatus === 'pending' && userCapabilities.canApproveTraining && assignment.userId === user?.uid && (
                                                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
                                                        <AlertTriangle className="h-4 w-4 inline mr-2" />
                                                        You cannot approve your own extension request. Another manager must review and approve this.
                                                    </div>
                                                )}

                                                {/* Employee actions for assigned/declined trainings */}
                                                {(assignment.status === 'assigned' || assignment.status === 'declined') && (
                                                    <>
                                                        {/* Only show Upload Certificate button if not overdue OR extension is approved */}
                                                        {(() => {
                                                            const now = new Date();
                                                            let dueDate;

                                                            // Handle different date formats
                                                            if (assignment.dueDate?.toDate) {
                                                                dueDate = assignment.dueDate.toDate();
                                                            } else if (assignment.dueDate) {
                                                                dueDate = new Date(assignment.dueDate);
                                                            } else {
                                                                return true; // No due date, allow upload
                                                            }

                                                            const isOverdue = dueDate < now;
                                                            const hasApprovedExtension = assignment.extensionStatus === 'approved';

                                                            // Show button if not overdue OR has approved extension
                                                            return !isOverdue || hasApprovedExtension;
                                                        })() && (
                                                                <Button
                                                                    variant="outline-primary"
                                                                    onClick={() => handleUploadClick(assignment)}
                                                                >
                                                                    Upload Certificate
                                                                </Button>
                                                            )}

                                                        {/* Request Extension button - Hidden on this page */}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))
                        )}
                    </div>
                </div>
            </div>

            {/* Modals */}
            <ViewTrainingModal
                isOpen={showViewModal}
                onClose={() => {
                    setShowViewModal(false);
                    setSelectedTraining(null);
                    setSelectedAssignment(null);
                }}
                training={selectedTraining}
                assignment={selectedAssignment}
                onApprove={() => handleApproveClick(selectedAssignment)}
                onDecline={() => handleDeclineClick(selectedAssignment)}
                employee={employee}
                user={user}
            />

            <EditTrainingAssignmentModal
                key={selectedAssignment?.id || 'edit-modal'} // Force re-render when assignment changes
                isOpen={showEditModal}
                onClose={() => {
                    setShowEditModal(false);
                    setSelectedAssignment(null);
                }}
                assignment={(() => {
                    // Always get the latest assignment from the assignments state
                    if (selectedAssignment?.id) {
                        const latestAssignment = assignments.find(a => a.id === selectedAssignment.id);
                        if (latestAssignment) {
                            console.log('[EmployeeTrainingPage] Using latest assignment from state:', {
                                id: latestAssignment.id,
                                hasHistory: !!latestAssignment.history,
                                historyLength: latestAssignment.history?.length || 0,
                                history: latestAssignment.history
                            });
                            return latestAssignment;
                        }
                    }
                    return selectedAssignment;
                })()}
                training={(() => {
                    // Get training from the latest assignment
                    if (selectedAssignment?.id) {
                        const latestAssignment = assignments.find(a => a.id === selectedAssignment.id);
                        return latestAssignment?.training || selectedAssignment?.training;
                    }
                    return selectedAssignment?.training;
                })()}
                user={user}
                onUpdate={handleAssignmentUpdated}
            />

            <AddTrainingModal
                isOpen={showAddModal}
                onClose={() => setShowAddModal(false)}
                employee={employee}
                onAdd={handleCreateAndAssignTraining}
            />

            <AddDocumentModal
                isOpen={showUploadModal}
                employee={employee}
                onClose={() => {
                    setShowUploadModal(false);
                    setSelectedAssignment(null);
                }}
                onUpload={handleCertificateUpload}
                initialTitle={selectedAssignment?.training?.name || ''}
                initialTag="Training"
            />

            <RequestExtensionModal
                isOpen={showExtensionModal}
                onClose={() => {
                    setShowExtensionModal(false);
                    setSelectedAssignment(null);
                }}
                assignment={selectedAssignment}
                employee={employee}
                onSubmit={handleExtensionSubmit}
            />

            {/* Approve Modal */}
            <ApprovalConfirmationModal
                isOpen={showApproveModal}
                onClose={() => {
                    setShowApproveModal(false);
                    setSelectedAssignment(null);
                }}
                onConfirm={handleApproveConfirm}
                title="Approve Training Certificate"
                description={`Are you sure you want to approve "${selectedAssignment?.training?.name}" for ${employee?.name}? This will mark the training as completed and verified.`}
                confirmButtonText="Approve Training"
                cancelButtonText="Cancel"
            >
                {selectedAssignment && (
                    <div className="space-y-4">
                        {/* Training Details */}
                        <div className="flex items-start justify-between p-3 border border-border-secondary rounded-lg">
                            <div className="flex items-start gap-3 flex-1">
                                <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center flex-shrink-0">
                                    <FileText className="h-5 w-5 text-purple-500" />
                                </div>
                                <div className="flex flex-col gap-1 flex-1">
                                    <span className="text-md font-semibold text-text-primary">
                                        {selectedAssignment.training?.name}
                                    </span>
                                    <span className="text-xs text-text-secondary">
                                        {selectedAssignment.training?.description}
                                    </span>
                                    <span className="text-xs text-text-secondary">
                                        Employee: {employee?.name}
                                    </span>
                                </div>
                            </div>
                            <Badge variant={getStatusVariant(selectedAssignment.status)}>
                                {getStatusDisplay(selectedAssignment.status)}
                            </Badge>
                        </div>

                        {/* Training Timeline */}
                        <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-2">
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-green-800">Assigned Date:</span>
                                <span className="text-sm font-semibold text-green-800">{formatDate(selectedAssignment.assignedDate)}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-green-800">Due Date:</span>
                                <span className="text-sm font-semibold text-green-800">{formatDate(selectedAssignment.dueDate)}</span>
                            </div>
                            {selectedAssignment.completedDate && (
                                <div className="border-t border-green-300 pt-2 flex justify-between items-center">
                                    <span className="text-sm font-bold text-green-900">Completed Date:</span>
                                    <span className="text-sm font-bold text-green-900">{formatDate(selectedAssignment.completedDate)}</span>
                                </div>
                            )}
                        </div>

                        {/* Uploaded By */}
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-gray-700">Uploaded By:</span>
                                <Badge variant="role">
                                    {isLoadingUploaderName ? (
                                        <span className="text-xs">Loading...</span>
                                    ) : (
                                        uploaderName || getUploadedByDisplay(selectedAssignment)
                                    )}
                                </Badge>
                            </div>
                        </div>
                    </div>
                )}
            </ApprovalConfirmationModal>

            {/* Decline Modal */}
            <ApprovalConfirmationModal
                isOpen={showDeclineModal}
                onClose={() => {
                    setShowDeclineModal(false);
                    setSelectedAssignment(null);
                }}
                onConfirm={handleDeclineConfirm}
                item={selectedAssignment ? {
                    id: selectedAssignment.certificateId,
                    name: selectedAssignment.training?.name,
                    documentTitle: selectedAssignment.training?.name,
                    user: employee ? { name: employee.name } : null
                } : null}
                title="Decline Training Certificate"
                description={`Are you sure you want to decline "${selectedAssignment?.training?.name}" for ${employee?.name}?`}
                confirmButtonText="Decline Training"
                cancelButtonText="Cancel"
                type="decline"
                requireReason={true}
            >
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                    <p className="text-sm text-orange-800">
                        Declining this training certificate will notify the employee that their submission was rejected. They will need to upload a corrected or different certificate to complete the training requirement.
                    </p>
                </div>
            </ApprovalConfirmationModal>

            {/* Extension Approval Modal */}
            <ApprovalConfirmationModal
                isOpen={showExtensionApprovalModal}
                onClose={() => {
                    setShowExtensionApprovalModal(false);
                    setSelectedAssignment(null);
                    setSelectedExtensionRequest(null);
                }}
                onConfirm={handleApproveExtensionConfirm}
                title="Approve Extension Request"
                description={`Are you sure you want to approve the extension request for "${selectedExtensionRequest?.trainingName}" for ${employee?.name}?`}
                confirmButtonText="Approve Extension"
                cancelButtonText="Cancel"
            >
                {selectedExtensionRequest && (
                    <div className="space-y-4">
                        {/* Extension Details */}
                        <div className="flex items-start justify-between p-3 border border-border-secondary rounded-lg">
                            <div className="flex items-start gap-3 flex-1">
                                <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                                    <Calendar className="h-5 w-5 text-blue-500" />
                                </div>
                                <div className="flex flex-col gap-1 flex-1">
                                    <span className="text-md font-semibold text-text-primary">
                                        {selectedExtensionRequest.trainingName}
                                    </span>
                                    <span className="text-xs text-text-secondary">
                                        Employee: {employee?.name}
                                    </span>
                                    <span className="text-xs text-text-secondary">
                                        Reason: {selectedExtensionRequest.reason}
                                    </span>
                                </div>
                            </div>
                            <Badge variant="warning">Extension Requested</Badge>
                        </div>

                        {/* Date Changes */}
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-blue-800">Current Due Date:</span>
                                <span className="text-sm font-semibold text-blue-800">{formatDate(selectedExtensionRequest.currentDueDate)}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-blue-800">Requested Due Date:</span>
                                <span className="text-sm font-semibold text-blue-800">{formatDate(selectedExtensionRequest.requestedDueDate)}</span>
                            </div>
                        </div>

                        {/* Justification */}
                        {selectedExtensionRequest.justification && (
                            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                                <div className="flex items-start gap-2 mb-2">
                                    <span className="text-sm font-medium text-gray-700">Justification:</span>
                                </div>
                                <p className="text-sm text-gray-800 whitespace-pre-wrap">{selectedExtensionRequest.justification}</p>
                            </div>
                        )}
                    </div>
                )}
            </ApprovalConfirmationModal>

            {/* Extension Decline Modal */}
            <DeleteConfirmationModal
                isOpen={showExtensionDeclineModal}
                onClose={() => {
                    setShowExtensionDeclineModal(false);
                    setSelectedAssignment(null);
                    setSelectedExtensionRequest(null);
                }}
                onConfirm={handleDeclineExtensionConfirm}
                title="Decline Extension Request"
                description={`Are you sure you want to decline the extension request for "${selectedExtensionRequest?.trainingName}" for ${employee?.name}?`}
                warningMessage="Declining this extension request will notify the employee that their request was rejected. They will need to complete the training by the original due date."
                confirmButtonText="Decline Extension"
                cancelButtonText="Cancel"
                itemDetails={
                    selectedExtensionRequest
                        ? {
                            name: selectedExtensionRequest.trainingName,
                            subtitle: `Extension request from ${formatDate(selectedExtensionRequest.currentDueDate)} to ${formatDate(selectedExtensionRequest.requestedDueDate)}`,
                            email: `Employee: ${employee?.name}`,
                            badge: 'Extension Requested'
                        }
                        : null
                }
                variant="danger"
            />
        </div>
    );
};

export default EmployeeTrainingPage;