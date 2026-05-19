import React, { useState, useEffect, useMemo } from 'react';
import { Search, FileText, ChevronDown, AlertCircle, CheckCircle, XCircle, Clock, Plus, UserPlus, Briefcase, Calendar, User, AlertTriangle } from 'lucide-react';
import Header from '../../components/layout/Header';
import Tabs from '../../components/ui/Tabs';
import StatCard from '../../components/shared/StatCard';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import AddDocumentModal from '../../components/modals/AddDocumentModal';
import ApprovalConfirmationModal from '../../components/modals/ApprovalConfirmationModal';
import DeleteConfirmationModal from '../../components/modals/DeleteConfirmationModal';
import AddTrainingModal from '../../components/modals/AddTrainingModal';
import ViewTrainingModal from '../../components/modals/ViewTrainingModal';
import AssignTrainingModal from '../../components/modals/AssignTrainingModal';
import RequestExtensionModal from '../../components/modals/RequestExtensionModal';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { trainingService } from '../../services/trainingService';
import { certificateService } from '../../services/certificateService';
import { trainingPermissionService } from '../../services/trainingPermissions';
import { extensionService } from '../../services/extensionService';
import { getManagedEmployeeIdsForManager } from '../../services/teams';
import { getUserById } from '../../services/users';
import hrApiClient from '../../lib/hrApiClient';
import { toast } from 'react-toastify';
import { getRoleName } from '../../utils/getRoleName';
import Loader from '../../components/ui/Loader';
import { useCache } from '../../contexts/CacheContext';
import { LoadingSkeleton } from '../../components/ui/LoadingSkeleton';

const TrainingManagementPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { getItem, setItem } = useCache();

  // State management
  const [loading, setLoading] = useState(true);
  const [trainings, setTrainings] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [employeeTrainingData, setEmployeeTrainingData] = useState([]);
  const [loadingEmployeeData, setLoadingEmployeeData] = useState(false);
  const [statistics, setStatistics] = useState({});
  const [error, setError] = useState(null);

  // Skeleton-first: show layout shell when user not yet available
  if (!user) {
    return (
      <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6 animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="h-4 bg-gray-200 rounded w-20 mb-2" />
              <div className="h-8 bg-gray-200 rounded w-16 mb-2" />
              <div className="h-3 bg-gray-200 rounded w-32" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Determine available tabs based on role
  const getAvailableTabs = () => {
    if (user.role === 'siteManager') {
      return [{ label: 'Employee Training' }];
    } else if (user.role === 'employee') {
      return [{ label: 'My Training' }];
    } else {
      // teamManager, admin, superUser, etc. have both
      return [{ label: 'My Training' }, { label: 'Employee Training' }];
    }
  };

  const availableTabs = getAvailableTabs();
  // Read params from URL to persist state across refreshes
  const queryParams = new URL(window.location.href).searchParams;
  
  const getInitialSuperTab = () => {
    const urlTab = queryParams.get('tab');
    if (urlTab && availableTabs.some(t => t.label === urlTab)) return urlTab;
    return location.state?.activeTab || availableTabs[0].label;
  };

  const [superTab, setSuperTab] = useState(getInitialSuperTab());
  const [subTab, setSubTab] = useState(queryParams.get('subtab') || 'By Employee');

  // Sync tabs with URL to prevent losing position on refresh
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let changed = false;
    
    if (params.get('tab') !== superTab) {
      params.set('tab', superTab);
      changed = true;
    }
    if (params.get('subtab') !== subTab) {
      params.set('subtab', subTab);
      changed = true;
    }
    
    if (changed) {
      navigate(`?${params.toString()}`, { replace: true });
    }
  }, [superTab, subTab, navigate]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRole, setFilterRole] = useState('All Roles');
  const [filterStatus, setFilterStatus] = useState('All States');

  // Modal states
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showDeclineModal, setShowDeclineModal] = useState(false);
  const [showAddTrainingModal, setShowAddTrainingModal] = useState(false);
  const [showViewTrainingModal, setShowViewTrainingModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showExtensionModal, setShowExtensionModal] = useState(false);
  const [selectedTraining, setSelectedTraining] = useState(null);
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [selectedExtensionRequest, setSelectedExtensionRequest] = useState(null);
  const [showApproveExtensionModal, setShowApproveExtensionModal] = useState(false);
  const [showDeclineExtensionModal, setShowDeclineExtensionModal] = useState(false);
  const [uploaderName, setUploaderName] = useState(null);
  const [isLoadingUploaderName, setIsLoadingUploaderName] = useState(false);

  // User capabilities based on role
  const userCapabilities = {
    canCreateTraining: trainingPermissionService.hasPermission(user.role, 'createTraining'),
    canEditTraining: trainingPermissionService.hasPermission(user.role, 'editTraining'),
    canDeleteTraining: trainingPermissionService.hasPermission(user.role, 'deleteTraining'),
    canAssignTraining: trainingPermissionService.hasPermission(user.role, 'assignTraining'),
    canApproveTraining: trainingPermissionService.hasPermission(user.role, 'approveTraining'),
    canViewAnalytics: trainingPermissionService.hasPermission(user.role, 'viewAnalytics')
  };

  // Extension approval permission check
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

  // Update cache when real-time data changes
  useEffect(() => {
    if (!user || !user.companyId) return;
    
    const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
    const cacheKey = `training_${companyId}_${user.userId}`;
    
    // Update cache with current real-time data
    if (trainings.length > 0 || assignments.length > 0) {
      setItem?.(cacheKey, {
        trainings: trainings,
        assignments: assignments,
        statistics: statistics,
        employeeTrainingData: employeeTrainingData || []
      }, 7 * 60 * 1000);
    }
  }, [trainings, assignments, statistics, employeeTrainingData, user]);

  // Set up real-time listeners for trainings and assignments
  useEffect(() => {
    if (!user || !user.companyId) return;

    const companyIdRaw = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;

    console.log('[TrainingManagement] Setting up real-time subscriptions');

    // Subscribe to trainings
    const unsubscribeTrainings = trainingService.subscribeTrainings(companyIdRaw, (result) => {
      if (result.success) {
        console.log('[TrainingManagement] Trainings updated:', result.data.length);
        setTrainings(result.data);
      } else {
        console.error('[TrainingManagement] Trainings subscription error:', result.error);
      }
    });

    // Subscribe to assignments
    const unsubscribeAssignments = trainingService.subscribeAssignments(companyIdRaw, null, (result) => {
      if (result.success) {
        console.log('[TrainingManagement] Assignments updated:', result.data.length);
        setAssignments(result.data);
      } else {
        console.error('[TrainingManagement] Assignments subscription error:', result.error);
      }
    });

    return () => {
      console.log('[TrainingManagement] Cleaning up subscriptions');
      unsubscribeTrainings();
      unsubscribeAssignments();
    };
  }, [user?.companyId]);

  // Load initial data and stats
  useEffect(() => {
    loadTrainingData();
  }, [user]);

  // Lazy load employee training data only when needed
  useEffect(() => {
    if (!user || !user.companyId) return;
    if (superTab !== 'Employee Training') return;
    if (subTab !== 'By Employee') return;
    if (loading) return;
    if (loadingEmployeeData) return;
    if ((assignments || []).length === 0) return;
    if (employeeTrainingData && employeeTrainingData.length > 0) return; // Prevent double load if already populated

    const run = async () => {
      try {
        setLoadingEmployeeData(true);
        const employeeData = await processEmployeeTrainingData(assignments);
        setEmployeeTrainingData(employeeData);

        const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
        const cacheKey = `training_${companyId}_${user.userId}`;
        const cached = getItem?.(cacheKey);
        setItem?.(cacheKey, {
          trainings: cached?.trainings || trainings,
          assignments: cached?.assignments || assignments,
          statistics: cached?.statistics || statistics,
          employeeTrainingData: employeeData
        }, 7 * 60 * 1000);
      } finally {
        setLoadingEmployeeData(false);
      }
    };

    run();
  }, [user, superTab, subTab, loading, assignments]);

  const loadTrainingData = async () => {
    if (!user || !user.companyId) return;

    const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
    const cacheKey = `training_${companyId}_${user.userId}`;
    const cached = getItem?.(cacheKey);
    
    // Only load from cache if we don't already have real-time data
    if (cached?.trainings && cached?.assignments && trainings.length === 0 && assignments.length === 0) {
      setTrainings(cached.trainings);
      setAssignments(cached.assignments);
      if (cached.statistics) setStatistics(cached.statistics);
      if (cached.employeeTrainingData) setEmployeeTrainingData(cached.employeeTrainingData);
      setLoading(false);
    } else if (trainings.length === 0 && assignments.length === 0) {
      setLoading(true);
    } else {
      // We have real-time data, just update stats if needed
      setLoading(false);
    }
    
    setError(null);

    try {
      // Statistics are still polled/refreshed on mount for now
      const statsResult = await trainingService.getTrainingStatistics(companyId, user.role, user.uid);

      const statsData = statsResult.success ? statsResult.data : {};

      setStatistics(statsData);
      setItem?.(cacheKey, {
        trainings: trainings.length > 0 ? trainings : cached?.trainings || [],
        assignments: assignments.length > 0 ? assignments : cached?.assignments || [],
        statistics: statsData,
        employeeTrainingData: employeeTrainingData || cached?.employeeTrainingData || []
      }, 7 * 60 * 1000);

      // Employee training data is computed lazily when the Employee Training -> By Employee tab is opened.
    } catch (error) {
      console.error('Error loading training data:', error);
      setError(error.message);
      toast.error('Failed to load training data');
    } finally {
      setLoading(false);
      setLoadingEmployeeData(false);
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

        // If missing from assignment, fetch from user service
        if (!uploadedByUserId) {
          // This would ideally come from the assignment metadata in REST
          setUploaderName('Admin');
          return;
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

        // Optimization: If employee is the uploader, use their own name if we can find it
        if (uploadedByUserId === selectedAssignment.userId) {
          setUploaderName(selectedAssignment.userName || selectedAssignment.employeeName || 'Employee');
          return;
        }

        // Fetch user data for other uploaders
        const userData = await getUserById(uploadedByUserId);
        if (userData) {
          const displayName = userData.displayName || `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || userData.email || 'Unknown User';
          setUploaderName(displayName);
        } else {
          setUploaderName('Unknown User');
        }
      } catch (error) {
        console.error('Error fetching uploader name:', error);
        setUploaderName('Admin');
      } finally {
        setIsLoadingUploaderName(false);
      }
    };

    fetchUploaderNameForAssignment();
  }, [selectedAssignment?.id, selectedAssignment?.certificateId, selectedAssignment?.certificateUploadedBy, user?.uid, user?.displayName]);

  const getUploadedByDisplay = (assignment) => {
    if (!assignment?.certificateId) {
      return 'No Upload';
    }

    // If this is the selected assignment, use the fetched name
    if (assignment.id === selectedAssignment?.id || assignment.certificateId === selectedAssignment?.certificateId) {
      if (isLoadingUploaderName) {
        return 'Loading...';
      }
      return uploaderName || (assignment.certificateUploadedBy === assignment.userId ? 'Employee' : 'Admin');
    }

    // For other assignments, use simple check
    if (assignment.certificateUploadedBy === assignment.userId) {
      return 'Employee';
    }

    return 'Admin';
  };

  // Get user's training assignments for "My Training" tab
  const getUserTrainingAssignments = () => {
    return assignments.filter(assignment => assignment.userId === user.userId);
  };

  // Get filtered trainings based on search and filters
  const getFilteredTrainings = () => {
    let filtered = trainings;

    if (searchQuery) {
      filtered = filtered.filter(training =>
        training.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        training.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        training.category.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    if (filterStatus !== 'All States') {
      filtered = filtered.filter(training => training.status?.toLowerCase() === filterStatus.toLowerCase());
    }

    return filtered;
  };

  // Get all company users based on role
  const getCompanyUsers = async () => {
    try {
      const { data } = await hrApiClient.get('/hr/employees');
      const allUsers = data.employees || data || [];

      // Filter to only managed employees if needed (or let backend handle it)
      // For now, return all minus current user
      return allUsers.filter(u => u.id !== user.userId && u.id !== user.uid);
    } catch (error) {
      console.error('Error getting company users:', error);
      return [];
    }
  };

  // Process employee training data based on user role
  const processEmployeeTrainingData = async (assignmentsData) => {
    const allUsers = await getCompanyUsers();

    // Create a map of users with their training data
    const employeeMap = new Map();

    // Initialize all users with empty training stats
    allUsers.forEach(user => {
      employeeMap.set(user.id, {
        userId: user.id,
        userInfo: user,
        assignments: [],
        stats: {
          total: 0,
          completed: 0,
          pending: 0,
          expired: 0
        }
      });
    });

    // Add training assignments to users
    assignmentsData.forEach(assignment => {
      const userId = assignment.userId;
      if (employeeMap.has(userId)) {
        const employee = employeeMap.get(userId);
        employee.assignments.push(assignment);
        employee.stats.total++;

        switch (assignment.status) {
          case 'completed':
            employee.stats.completed++;
            break;
          case 'assigned':
          case 'in_progress':
          case 'pending_approval':
            employee.stats.pending++;
            break;
          case 'expired':
          case 'overdue':
          case 'declined':
            employee.stats.expired++;
            break;
        }
      }
    });
    return Array.from(employeeMap.values());
  };

  // Get employee training data for Employee Training tab (uses cached state)
  const getEmployeeTrainingData = () => {
    return employeeTrainingData || [];
  };

  // Get unique roles from employees for filter dropdown
  const availableRoles = useMemo(() => {
    const roles = new Set();

    (getEmployeeTrainingData() || []).forEach(employee => {
      const primaryRole = employee?.userInfo?.primaryRole;
      if (!primaryRole) return;

      const roleName = getRoleName(primaryRole);
      if (!roleName) return;

      const lower = roleName.toLowerCase();

      // Skip the current user's own role from the role filter list
      const userRoleName = getRoleName(user.role);
      if (roleName === userRoleName) return;

      roles.add(roleName);
    });

    return Array.from(roles).sort();
  }, [employeeTrainingData]);


  // Event handlers for training management
  const handleCreateTraining = async (trainingData) => {
    try {
      const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
      const result = await trainingService.createTraining({
        ...trainingData,
        companyId
      }, user.userId);

      if (result) {
        toast.success('Training created successfully');
        setShowAddTrainingModal(false);
        loadTrainingData();
      }
    } catch (error) {
      console.error('Error creating training:', error);
      toast.error(error.message);
    }
  };

  const handleEditTraining = async (trainingData) => {
    try {
      const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
      const result = await trainingService.updateTraining(
        selectedTraining.id,
        trainingData,
        user.uid,
        user.role,
        companyId
      );

      if (result) {
        toast.success('Training updated successfully');
        setShowAddTrainingModal(false);
        setSelectedTraining(null);
        loadTrainingData();
      }
    } catch (error) {
      console.error('Error updating training:', error);
      toast.error(error.message);
    }
  };

  const handleDeleteTraining = async () => {
    try {
      const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
      const result = await trainingService.deleteTraining(
        selectedTraining.id,
        user.uid,
        user.role,
        companyId
      );

      if (result) {
        toast.success('Training deleted successfully');
        setShowDeclineModal(false);
        setSelectedTraining(null);
        loadTrainingData();
      }
    } catch (error) {
      console.error('Error deleting training:', error);
      toast.error(error.message);
    }
  };

  // Certificate handling
  const handleUploadCertificate = async (file, notes, title = null) => {
    try {
      if (!selectedAssignment) {
        throw new Error('No assignment selected');
      }

      const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
      const result = await certificateService.submitCertificate(
        selectedAssignment.id,
        file,
        user.uid,
        companyId,
        notes,
        title,
        user.role
      );

      if (result.success) {
        toast.success('Certificate uploaded successfully');
        // Real-time subscriptions will automatically update the UI
        // Don't manage modal state here - let the modal handle it
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

  const handleApproveCertificate = async (certificateId, notes) => {
    try {
      const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
      const result = await certificateService.approveCertificate(
        certificateId,
        user.uid,
        user.role,
        companyId,
        notes
      );

      if (result.success) {
        toast.success('Certificate approved successfully');
        setShowApproveModal(false);
        setSelectedAssignment(null);
        // Real-time subscriptions will automatically update the UI
      }
    } catch (error) {
      console.error('Error approving certificate:', error);
      toast.error(error.message);
    }
  };

  const handleDeclineCertificate = async (certificateId, reason) => {
    try {
      const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
      const result = await certificateService.declineCertificate(
        certificateId,
        user.uid,
        user.role,
        companyId,
        reason
      );

      if (result.success) {
        toast.success('Certificate declined');
        setShowDeclineModal(false);
        setSelectedAssignment(null);
        // Real-time subscriptions will automatically update the UI
      } else {
        throw new Error(result.error || 'Failed to decline certificate');
      }
    } catch (error) {
      console.error('Error declining certificate:', error);
      toast.error(error.message || 'Failed to decline certificate');
      // Re-throw so the modal can handle it
      throw error;
    }
  };

  // Additional handlers for training management
  const handleViewTraining = (training) => {
    setSelectedTraining(training);
    setShowViewTrainingModal(true);
  };

  const handleEditTrainingClick = (training) => {
    setSelectedTraining(training);
    setShowAddTrainingModal(true);
  };

  const handleDeleteTrainingClick = (training) => {
    setSelectedTraining(training);
    setShowDeclineModal(true);
  };

  const handleAssignTraining = (training) => {
    setSelectedTraining(training);
    setShowAssignModal(true);
  };

  const handleAssignToUsers = async (trainingId, userIds, dueDate) => {
    try {
      const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
      const result = await trainingService.assignTraining(
        trainingId,
        userIds,
        user.uid,
        companyId,
        user.role,
        dueDate
      );

      if (result.success) {
        toast.success(`Training assigned to ${userIds.length} user${userIds.length !== 1 ? 's' : ''}`);
        setShowAssignModal(false);
        setSelectedTraining(null);
        // Real-time subscriptions will automatically update the UI
      }
    } catch (error) {
      console.error('Error assigning training:', error);
      toast.error(error.message);
    }
  };

  const handleApproveClick = (assignment) => {
    setSelectedAssignment(assignment);
    setShowApproveModal(true);
  };

  const handleDeclineClick = (assignment) => {
    setSelectedAssignment(assignment);
    setShowDeclineModal(true);
  };

  const handleCertificateUpload = async (uploadData) => {
    try {
      // Extract file, notes and title from the upload data object
      const { file, documentDescription, documentTitle } = uploadData;
      await handleUploadCertificate(file, documentDescription || '', documentTitle);

      // Close modal and reset state only after successful upload
      setShowUploadModal(false);
      setSelectedAssignment(null);
    } catch (error) {
      // Error is already handled in handleUploadCertificate
      // Just re-throw to let the modal know the operation failed
      throw error;
    }
  };

  const handleApproveConfirm = async (notes) => {
    if (selectedAssignment?.certificateId) {
      await handleApproveCertificate(selectedAssignment.certificateId, notes);
    }
  };

  const handleDeclineConfirm = async (itemId, reason) => {
    // For certificate decline, reason is required and passed as second parameter
    if (selectedAssignment?.certificateId) {
      if (!reason || !reason.trim()) {
        toast.error('Decline reason is required');
        return;
      }
      try {
        await handleDeclineCertificate(selectedAssignment.certificateId, reason.trim());
      } catch (error) {
        // Error is already handled in handleDeclineCertificate, but don't close modal on error
        throw error;
      }
    } else if (selectedTraining) {
      // For training deletion, no reason needed
      await handleDeleteTraining();
    }
  };

  // Extension approval handlers
  const handleApproveExtensionClick = (assignment) => {
    setSelectedAssignment(assignment);
    setSelectedExtensionRequest({
      id: assignment.extensionRequestId,
      trainingName: assignment.trainingName || selectedTraining?.name,
      requestedDueDate: assignment.requestedDueDate,
      reason: assignment.extensionReason,
      justification: assignment.extensionJustification || assignment.extensionRequest?.justification || ''
    });
    setShowApproveExtensionModal(true);
  };

  const handleDeclineExtensionClick = (assignment) => {
    setSelectedAssignment(assignment);
    setSelectedExtensionRequest({
      id: assignment.extensionRequestId,
      trainingName: assignment.trainingName || selectedTraining?.name,
      requestedDueDate: assignment.requestedDueDate,
      reason: assignment.extensionReason
    });
    setShowDeclineExtensionModal(true);
  };

  const handleApproveExtensionConfirm = async (notes) => {
    try {
      if (!selectedExtensionRequest?.id) {
        toast.error('No extension request selected');
        return;
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
        toast.success('Extension request approved successfully');
        // Real-time subscriptions will automatically update the UI
      } else {
        toast.error(result.error || 'Failed to approve extension request');
      }
    } catch (error) {
      console.error('Error approving extension:', error);
      toast.error('Failed to approve extension request');
    } finally {
      setShowApproveExtensionModal(false);
      setSelectedExtensionRequest(null);
      setSelectedAssignment(null);
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
        // Real-time subscriptions will automatically update the UI
      } else {
        toast.error(result.error || 'Failed to decline extension request');
      }
    } catch (error) {
      console.error('Error declining extension:', error);
      toast.error('Failed to decline extension request');
    } finally {
      setShowDeclineExtensionModal(false);
      setSelectedExtensionRequest(null);
      setSelectedAssignment(null);
    }
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
        // Real-time subscriptions will automatically update the UI
      }
    } catch (error) {
      console.error('Error submitting extension request:', error);
      toast.error(error.message);
    }
  };

  // Helper functions for data transformation
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
      default: return status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ');
    }
  };

  const getStatusMessage = (assignment) => {
    const now = new Date();
    const dueDate = assignment.dueDate?.toDate ? assignment.dueDate.toDate() : new Date(assignment.dueDate);
    const expiryDate = assignment.expiryDate?.toDate ? assignment.expiryDate.toDate() : new Date(assignment.expiryDate);

    // Calculate days until due date
    const daysUntilDue = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
    const daysUntilExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));

    switch (assignment.status) {
      case 'pending_approval':
        return 'Certificate uploaded - awaiting admin approval';

      case 'completed':
        if (daysUntilExpiry <= 0) {
          return 'This training has expired. Please contact your administrator to request reassignment.';
        } else if (daysUntilExpiry <= 30) {
          return `Training expires in ${daysUntilExpiry} day${daysUntilExpiry !== 1 ? 's' : ''}. Consider renewal soon.`;
        } else {
          return 'Training completed successfully and is valid.';
        }

      case 'declined':
        return assignment.declineReason || 'Certificate was declined. Please upload a new certificate with the required corrections.';

      case 'assigned':
      case 'in_progress':
        // Check if extension is pending
        if (assignment.extensionStatus === 'pending') {
          return 'Extension request submitted - awaiting approval. Continue working on training while request is reviewed.';
        } else if (assignment.extensionStatus === 'declined') {
          return 'Extension request was declined. Please complete training by the original due date or contact your manager.';
        } else if (daysUntilDue <= 0) {
          // Check if extension is approved
          if (assignment.extensionStatus === 'approved') {
            return 'Extension approved! You can now upload your certificate with the new deadline.';
          } else {
            return 'This training is overdue. Certificate upload is disabled. Please request an extension to continue.';
          }
        } else if (daysUntilDue <= 7) {
          return `Training due in ${daysUntilDue} day${daysUntilDue !== 1 ? 's' : ''}. Please complete soon.`;
        } else if (daysUntilDue <= 14) {
          return `Training due in ${daysUntilDue} days. Please plan to complete this training.`;
        } else {
          return `Training assigned. Due date: ${formatDate(assignment.dueDate)}`;
        }

      case 'expired':
      case 'overdue':
        return 'This training has expired. Please contact your administrator to request reassignment.';

      default:
        return 'Training status unknown. Please contact your administrator.';
    }
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

  // Get processed user training assignments
  const getUserTrainingData = () => {
    const userAssignments = getUserTrainingAssignments();
    const now = new Date();

    const processedData = userAssignments.map(assignment => {
      const dueDate = assignment.dueDate?.toDate ? assignment.dueDate.toDate() : new Date(assignment.dueDate);
      const expiryDate = assignment.expiryDate?.toDate ? assignment.expiryDate.toDate() : new Date(assignment.expiryDate);
      const daysUntilDue = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
      const daysUntilExpiry = assignment.expiryDate ? Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24)) : 999;

      // Determine if training is critical (overdue or expiring soon)
      // FIX: If completed but expired, treat as expired
      const isExpiredCompleted = assignment.status === 'completed' && assignment.expiryDate && daysUntilExpiry <= 0;

      const isCritical = (assignment.status === 'assigned' && daysUntilDue <= 0) ||
        isExpiredCompleted ||
        assignment.status === 'expired' || assignment.status === 'overdue';

      const isUrgent = (assignment.status === 'assigned' && daysUntilDue <= 7 && daysUntilDue > 0) ||
        (assignment.status === 'completed' && daysUntilExpiry <= 30 && daysUntilExpiry > 0);

      // FIX: Override status if expired
      let displayStatus = assignment.status;
      if (isExpiredCompleted) {
        displayStatus = 'expired';
      }

      return {
        id: assignment.id,
        title: assignment.training?.name || 'Unknown Training',
        description: assignment.training?.description || '',
        assigned: formatDate(assignment.assignedDate),
        due: formatDate(assignment.dueDate),
        completed: formatDate(assignment.completedDate),
        expiry: formatDate(assignment.expiryDate),
        status: displayStatus,
        statusVariant: getStatusVariant(displayStatus),
        message: getStatusMessage({ ...assignment, status: displayStatus }), // Ensure message reflects overridden status
        hasExpired: isCritical,
        isUrgent: isUrgent,
        daysUntilDue: daysUntilDue,
        daysUntilExpiry: daysUntilExpiry,
        training: assignment.training,
        assignmentId: assignment.id
      };
    });

    // FIX: Sort by priority (Critical > Urgent > Others)
    return processedData.sort((a, b) => {
      if (a.hasExpired && !b.hasExpired) return -1;
      if (!a.hasExpired && b.hasExpired) return 1;

      if (a.isUrgent && !b.isUrgent) return -1;
      if (!a.isUrgent && b.isUrgent) return 1;

      // Secondary sort: by due date or expiry date
      // If critical/urgent, typically closest date first
      // If completed (and valid), maybe recently completed first? Or expiry?
      // For now, let's just keep stable or sort by ID if dates equal
      return 0;
    });
  };

  // Calculate user training statistics
  const getUserStats = () => {
    const userAssignments = getUserTrainingAssignments();
    const now = new Date();

    const stats = {
      totalRecords: userAssignments.length,
      completed: userAssignments.filter(a => a.status === 'completed').length,
      pending: userAssignments.filter(a => ['assigned', 'in_progress', 'pending_approval'].includes(a.status)).length,
      expiredMissing: userAssignments.filter(a => ['expired', 'overdue', 'declined'].includes(a.status)).length,
      expiringSoon: userAssignments.filter(a => {
        if (!a.dueDate || a.status === 'completed') return false;
        const dueDate = a.dueDate.toDate ? a.dueDate.toDate() : new Date(a.dueDate);
        const daysUntilDue = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
        return daysUntilDue <= 7 && daysUntilDue > 0;
      }).length
    };

    return stats;
  };

  const pretty = (role) =>
    role.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());

  // Render My Training Content
  const renderMyTraining = () => {
    const userStats = getUserStats();
    const userTrainingData = getUserTrainingData();

    if (loading && !trainings.length) {
      return (
        <div className="space-y-3xl">
          <div className="flex flex-wrap gap-xl">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="bg-white border border-border-primary rounded-base p-4xl min-w-[180px] animate-pulse">
                <LoadingSkeleton height="h-4" width="w-24" className="mb-2" />
                <LoadingSkeleton height="h-8" width="w-12" className="mb-1" />
                <LoadingSkeleton height="h-3" width="w-20" />
              </div>
            ))}
          </div>
          <div className="bg-white border border-border-primary rounded-base p-4xl space-y-4">
            <LoadingSkeleton height="h-6" width="w-48" />
            <LoadingSkeleton height="h-4" width="w-full" />
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <LoadingSkeleton key={i} height="h-16" width="w-full" className="rounded-lg" />
              ))}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-3xl">
        {/* Stats Cards */}
        <div className="flex flex-wrap gap-xl">
          <StatCard
            title="Total Records"
            value={userStats.totalRecords.toString()}
            subtitle="Records"
            icon={<AlertCircle className="h-6 w-6 text-yellow-500" />}
            iconBgColor="bg-yellow-50"
          />
          <StatCard
            title="Completed"
            value={userStats.completed.toString()}
            subtitle="All requirements met"
            icon={<CheckCircle className="h-6 w-6 text-green-500" />}
            iconBgColor="bg-green-50"
          />
          <StatCard
            title="Pending"
            value={userStats.pending.toString()}
            subtitle="In progress or assigned"
            icon={<Clock className="h-6 w-6 text-blue-500" />}
            iconBgColor="bg-blue-50"
          />
          <StatCard
            title="Expired / Missing"
            value={userStats.expiredMissing.toString()}
            subtitle="Renewal needed"
            icon={<XCircle className="h-6 w-6 text-red-500" />}
            iconBgColor="bg-red-50"
          />
          <StatCard
            title="Expiring Soon"
            value={userStats.expiringSoon.toString()}
            subtitle="Within 7 days"
            icon={<Clock className="h-6 w-6 text-orange-500" />}
            iconBgColor="bg-orange-50"
          />
        </div>

        {/* Training Compliance Section */}
        <div className="bg-white border border-border-primary rounded-base p-4xl space-y-4xl">
          <div>
            <h2 className="text-2xl font-bold text-text-primary mb-1">Training Compliance</h2>
            <p className="text-text-secondary">Automatic reminders keep your workforce certified.</p>
          </div>

          {/* Search and Filter */}
          <div className="flex flex-col sm:flex-row gap-3xl">
            <div className="relative flex-1">
              <Search className="absolute left-base top-1/2 -translate-y-1/2 h-5 w-5 text-text-secondary" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="search by name or phone or email..."
                className="w-full h-12 pl-12 pr-base border border-border-secondary rounded-lg text-md focus:outline-none focus:border-border-accent-purple"
              />
            </div>
            <div className="flex items-center gap-md">
              <span className="text-text-secondary whitespace-nowrap">Filtered by:</span>
              <div className="relative">
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="h-12 px-base pr-10 border border-border-secondary rounded-lg text-md appearance-none focus:outline-none focus:border-border-accent-purple"
                >
                  <option>All States</option>
                  <option>Assigned</option>
                  <option>Completed</option>
                  <option>Expired</option>
                </select>
                <ChevronDown className="absolute right-base top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Training List */}
          <div className="space-y-3xl">
            {userTrainingData.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No training assignments</h3>
                <p className="text-gray-600">You don't have any training assignments at the moment.</p>
              </div>
            ) : (
              userTrainingData
                .filter(training => {
                  if (filterStatus === 'All States') return true;
                  return training.status === filterStatus.toLowerCase().replace(' ', '_');
                })
                .filter(training => {
                  if (!searchQuery) return true;
                  return training.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    training.description.toLowerCase().includes(searchQuery.toLowerCase());
                })
                .map((training) => (
                  <div key={training.id} className="border border-border-primary rounded-base p-4xl">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
                      <div className="flex items-start gap-3 flex-1">
                        <div className="w-12 h-12 bg-bg-accent-purple-light rounded-lg flex items-center justify-center flex-shrink-0">
                          <FileText className="h-6 w-6 text-text-accent-purple" />
                        </div>
                        <div className="flex-1">
                          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-2">
                            <h3 className="text-lg font-semibold text-text-primary">{training.title}</h3>
                            <Badge variant={training.statusVariant}>{getStatusDisplay(training.status)}</Badge>
                          </div>
                          <p className="text-text-secondary mb-2">{training.description}</p>
                          <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-sm text-text-secondary">
                            <span>Assigned: {training.assigned}</span>
                            <span className="hidden sm:inline">•</span>
                            <span>Due: {training.due}</span>
                            {training.completed && training.completed !== 'N/A' && (
                              <>
                                <span className="hidden sm:inline">•</span>
                                <span>Completed: {training.completed}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-md sm:ml-4">
                        {/* Upload Certificate buttons - only show if not overdue OR extension is approved */}
                        {(training.status === 'pending_approval' || training.status === 'declined') &&
                          (training.daysUntilDue >= 0 || training.extensionStatus === 'approved') && (
                            <Button
                              variant="outline-primary"
                              onClick={() => {
                                setSelectedAssignment({ id: training.assignmentId, ...training });
                                setShowUploadModal(true);
                              }}
                            >
                              {training.status === 'pending_approval' ? 'Reupload Certificate' : 'Reupload Certificate'}
                            </Button>
                          )}
                        {training.status === 'assigned' &&
                          (training.daysUntilDue >= 0 || training.extensionStatus === 'approved') && (
                            <Button
                              variant="gradient"
                              onClick={() => {
                                setSelectedAssignment({ id: training.assignmentId, ...training });
                                setShowUploadModal(true);
                              }}
                            >
                              Upload Certificate
                            </Button>
                          )}

                        {/* Show Request Extension button if not already pending and training is due soon or overdue */}
                        {(() => {
                          // Don't show if extension is already pending
                          if (training.status === 'extension_pending') return null;

                          // Show for declined status when due date is missed
                          if (training.status === 'declined' && training.daysUntilDue < 0) {
                            return (
                              <Button
                                variant="outline-warning"
                                onClick={() => handleExtensionClick({ id: training.assignmentId, ...training })}
                              >
                                Request Extension
                              </Button>
                            );
                          }

                          // Show for overdue trainings (assigned status with negative days until due)
                          if (training.status === 'assigned' && training.daysUntilDue <= 0) {
                            return (
                              <Button
                                variant="outline-warning"
                                onClick={() => handleExtensionClick({ id: training.assignmentId, ...training })}
                              >
                                Request Extension
                              </Button>
                            );
                          }

                          // Show for trainings due within 7 days (assigned status with 1-7 days until due)
                          if (training.status === 'assigned' && training.daysUntilDue > 0 && training.daysUntilDue <= 7) {
                            return (
                              <Button
                                variant="outline-secondary"
                                onClick={() => handleExtensionClick({ id: training.assignmentId, ...training })}
                              >
                                Request Extension
                              </Button>
                            );
                          }

                          return null;
                        })()}

                        <Button
                          variant="outline-secondary"
                          onClick={() => {
                            setSelectedTraining(training.training);
                            setShowViewTrainingModal(true);
                          }}
                        >
                          View Details
                        </Button>
                      </div>
                    </div>

                    {training.message && (
                      <div className={`mt-3 p-3 rounded-lg ${training.hasExpired ? 'bg-red-50 text-text-accent-red' : 'bg-purple-50 text-text-accent-purple'}`}>
                        <p className="text-sm">{training.message}</p>
                      </div>
                    )}
                  </div>
                ))
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Header
        title={`${pretty(user.role)} Dashboard`}
        subtitle={user.role === 'employee' ? 'Easily manage your timesheets and documents.' : 'Ensure compliance and manage onboarding from one place.'}
      />

      <div className="flex-1 overflow-y-auto p-4 md:p-3xl scrollbar-custom">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Page Title */}
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-text-primary">Training Management</h1>
            <p className="text-sm text-text-secondary mt-1">Manage your training and employee documents</p>
          </div>

          {/* Tabs - Only show if user has more than one tab */}
          {availableTabs.length > 1 && (
            <Tabs
              tabs={availableTabs}
              activeTab={superTab}
              onTabChange={(tab) => setSuperTab(tab)}
            />
          )}

          {/* Tab Content */}
          <div className="mt-4xl">
            {/* My Training Tab */}
            {superTab === 'My Training' && renderMyTraining()}

            {/* Employee Training Tab */}
            {superTab === 'Employee Training' && (
              <div className="space-y-4xl">
                {/* Sub-tabs for Employee Training */}
                <Tabs
                  tabs={[{ label: 'By Employee' }, { label: 'By Course' }]}
                  activeTab={subTab}
                  onTabChange={(tab) => setSubTab(tab)}
                />

                {/* Content based on sub-tab */}
                {subTab === 'By Employee' && (
                  <div className="bg-white border border-border-primary rounded-base p-4xl space-y-4xl">
                    <div>
                      <h2 className="text-2xl font-bold text-text-primary mb-1">Employee Training</h2>
                      <p className="text-text-secondary">Manage training assignments by employee.</p>
                    </div>

                    {/* Search and Filter */}
                    <div className="flex flex-col sm:flex-row gap-3xl">
                      <div className="relative flex-1">
                        <Search className="absolute left-base top-1/2 -translate-y-1/2 h-5 w-5 text-text-secondary" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search employees..."
                          className="w-full h-12 pl-12 pr-base border border-border-secondary rounded-lg text-md focus:outline-none focus:border-border-accent-purple"
                        />
                      </div>
                      <div className="flex items-center gap-md">
                        <span className="text-text-secondary whitespace-nowrap">Filter by:</span>
                        <div className="relative">
                          <select
                            value={filterRole}
                            onChange={(e) => setFilterRole(e.target.value)}
                            aria-label="Filter by employee role"
                            className="h-12 px-base pr-10 border border-border-secondary rounded-lg text-md appearance-none focus:outline-none focus:border-border-accent-purple"
                          >
                            <option>All Roles</option>
                            {availableRoles.map(role => (
                              <option key={role} value={role}>{role}</option>
                            ))}
                          </select>
                          <ChevronDown className="absolute right-base top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3xl">
                      {(loading || loadingEmployeeData) && (getEmployeeTrainingData() || []).length === 0 ? (
                        <div className="space-y-4">
                          {[1, 2, 3, 4].map((i) => (
                            <div key={i} className="flex items-center gap-4 py-4 border-b border-gray-100 animate-pulse">
                              <LoadingSkeleton height="h-12" width="w-12" className="rounded-full flex-shrink-0" />
                              <div className="flex-1 space-y-2">
                                <LoadingSkeleton height="h-4" width="w-40" />
                                <LoadingSkeleton height="h-3" width="w-56" />
                              </div>
                              <LoadingSkeleton height="h-8" width="w-24" className="rounded" />
                            </div>
                          ))}
                        </div>
                      ) : (getEmployeeTrainingData() || []).length === 0 ? (
                        <div className="text-center py-12">
                          <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                          <h3 className="text-lg font-medium text-gray-900 mb-2">No employees found</h3>
                          <p className="text-gray-600">
                            {user.role === 'teamManager'
                              ? "You don't have any employees assigned to your team with training assignments."
                              : "No employees have training assignments at the moment."
                            }
                          </p>
                        </div>
                      ) : (
                        (getEmployeeTrainingData() || [])
                          .filter(employee => {
                            // Exclude the current logged-in user from the employee list
                            if (employee.userId === user?.uid) {
                              return false;
                            }


                            // Filter by role if provided
                            if (filterRole !== 'All Roles') {
                              const userInfo = employee.userInfo;
                              if (!userInfo) return false;
                              const employeeRoleName = getRoleName(userInfo.primaryRole);
                              if (employeeRoleName !== filterRole) {
                                return false;
                              }
                            }

                            // Filter by search query if provided
                            if (searchQuery) {
                              const userInfo = employee.userInfo;
                              if (!userInfo) return false;
                              const searchTerm = searchQuery.toLowerCase();
                              const userName = userInfo.displayName || (userInfo.firstName + ' ' + userInfo.lastName).trim();
                              const userEmail = userInfo.email || '';
                              return (
                                userEmail.toLowerCase().includes(searchTerm) ||
                                userName.toLowerCase().includes(searchTerm)
                              );
                            }
                            return true;
                          })
                          .map((employee) => {
                            // Get user info from the database
                            const userInfo = employee.userInfo;
                            const userName = userInfo?.displayName ||
                              `${userInfo?.firstName || ''} ${userInfo?.lastName || ''}`.trim() ||
                              userInfo?.email ||
                              '';

                            // Skip unidentified users
                            if (!userName || userName === 'Unknown User') return null;

                            const userEmail = userInfo?.email || 'unknown@company.com';
                            const userDepartment = userInfo?.employmentDetails?.department || userInfo?.department || 'Development';
                            const userHireDate = userInfo?.employmentDetails?.startDate || userInfo?.hireDate || '2022-03-15';

                            return (
                              <div key={employee.userId} className="border border-border-primary rounded-base p-4xl">
                                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-start gap-6">
                                  {/* Employee Info */}
                                  <div className="flex items-center gap-4 flex-1">
                                    <div className="w-12 h-12 bg-bg-accent-purple-light rounded-full flex items-center justify-center flex-shrink-0">
                                      <User className="h-6 w-6 text-text-accent-purple" />
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                                        <h3 className="text-lg font-semibold text-text-primary">{userName}</h3>
                                        <Badge variant="role">{getRoleName(userInfo?.primaryRole) || 'Employee'}</Badge>
                                      </div>
                                      <p className="text-sm text-text-secondary mb-2">{userEmail}</p>
                                      <div className="flex flex-wrap items-center gap-4 text-sm">
                                        <span className="flex items-center gap-1 text-purple-500">
                                          <Briefcase className="h-3 w-3" />
                                          {userDepartment}
                                        </span>
                                        <span className="flex items-center gap-1 text-blue-500">
                                          <Calendar className="h-3 w-3" />
                                          Hired: {userHireDate}
                                        </span>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Stats and Button */}
                                  <div className="flex flex-wrap sm:justify-end justify-center w-full lg:w-auto items-center gap-6 lg:gap-8">
                                    <div className="text-center">
                                      <div className="flex items-center justify-center gap-2 mb-1">
                                        <FileText className="h-5 w-5 text-blue-500" />
                                        <p className="text-3xl font-bold text-blue-500">{employee.stats.total}</p>
                                      </div>
                                      <p className="text-xs text-text-secondary">Total<br />Training</p>
                                    </div>
                                    <div className="text-center">
                                      <div className="flex items-center justify-center gap-2 mb-1">
                                        <CheckCircle className="h-5 w-5 text-green-500" />
                                        <p className="text-3xl font-bold text-green-500">{employee.stats.completed}</p>
                                      </div>
                                      <p className="text-xs text-text-secondary">Completed<br />Training</p>
                                    </div>
                                    <div className="text-center">
                                      <div className="flex items-center justify-center gap-2 mb-1">
                                        <AlertTriangle className="h-5 w-5 text-orange-500" />
                                        <p className="text-3xl font-bold text-orange-500">{employee.stats.pending}</p>
                                      </div>
                                      <p className="text-xs text-text-secondary">Pending<br />Training</p>
                                    </div>
                                    <Button
                                      variant="outline-primary"
                                      onClick={() => navigate(`/training/${employee.userId}`, {
                                        state: {
                                          preloadedEmployee: employee.userInfo || null,
                                          preloadedAssignments: employee.assignments || [],
                                          from: 'trainingManagement'
                                        }
                                      })}
                                      cn="sm:max-w-36 w-full"
                                    >
                                      View Training
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            );
                          })
                      )}
                    </div>
                  </div>
                )}

                {subTab === 'By Course' && (
                  <div className="bg-white border border-border-primary rounded-base p-4xl space-y-4xl">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                      <div>
                        <h2 className="text-2xl font-bold text-text-primary mb-1">Training Courses</h2>
                        <p className="text-text-secondary">Manage training courses and assignments.</p>
                      </div>
                      {userCapabilities.canCreateTraining && (
                        <Button
                          variant="gradient"
                          icon={Plus}
                          onClick={() => setShowAddTrainingModal(true)}
                        >
                          Add Training
                        </Button>
                      )}
                    </div>

                    {/* Search and Filter */}
                    <div className="flex flex-col sm:flex-row gap-3xl">
                      <div className="relative flex-1">
                        <Search className="absolute left-base top-1/2 -translate-y-1/2 h-5 w-5 text-text-secondary" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search trainings..."
                          className="w-full h-12 pl-12 pr-base border border-border-secondary rounded-lg text-md focus:outline-none focus:border-border-accent-purple"
                        />
                      </div>
                      <div className="flex items-center gap-md">
                        <span className="text-text-secondary whitespace-nowrap">Filtered by:</span>
                        <div className="relative">
                          <select
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value)}
                            className="h-12 px-base pr-10 border border-border-secondary rounded-lg text-md appearance-none focus:outline-none focus:border-border-accent-purple"
                          >
                            <option>All States</option>
                            <option>Active</option>
                            <option>Inactive</option>
                            <option>Draft</option>
                          </select>
                          <ChevronDown className="absolute right-base top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
                        </div>
                      </div>
                    </div>

                    {/* Training List */}
                    <div className="space-y-3xl">
                      {loading && !trainings.length ? (
                        <div className="space-y-4">
                          {[1, 2, 3].map((i) => (
                            <div key={i} className="border border-border-primary rounded-base p-4xl animate-pulse">
                              <div className="flex gap-3">
                                <LoadingSkeleton height="h-12" width="w-12" className="rounded-lg flex-shrink-0" />
                                <div className="flex-1 space-y-2">
                                  <LoadingSkeleton height="h-5" width="w-48" />
                                  <LoadingSkeleton height="h-4" width="w-full" />
                                  <LoadingSkeleton height="h-3" width="w-64" />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : getFilteredTrainings().length === 0 ? (
                        <div className="text-center py-12">
                          <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                          <h3 className="text-lg font-medium text-gray-900 mb-2">No training courses</h3>
                          <p className="text-gray-600">No training courses found matching your criteria.</p>
                        </div>
                      ) : (
                        getFilteredTrainings().map((training) => (
                          <div key={training.id} className="border border-border-primary rounded-base p-4xl">
                            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
                              <div className="flex items-start gap-3 flex-1">
                                <div className="w-12 h-12 bg-bg-accent-purple-light rounded-lg flex items-center justify-center flex-shrink-0">
                                  <FileText className="h-6 w-6 text-text-accent-purple" />
                                </div>
                                <div className="flex-1">
                                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-2">
                                    <h3 className="text-lg font-semibold text-text-primary">{training.name}</h3>
                                    <Badge variant={training.status?.toLowerCase() === 'active' ? 'success' : 'secondary'}>
                                      {training.status}
                                    </Badge>
                                  </div>
                                  <p className="text-text-secondary mb-2">{training.description}</p>
                                  <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-sm text-text-secondary">
                                    <span>Category: {training.category}</span>
                                    <span className="hidden sm:inline">•</span>
                                    <span>Type: {training.type}</span>
                                    <span className="hidden sm:inline">•</span>
                                    <span>Duration: {training.estimatedDuration || 60} min</span>
                                  </div>
                                </div>
                              </div>
                              <div className="flex flex-col sm:flex-row gap-md sm:ml-4">
                                <Button
                                  variant="outline-secondary"
                                  onClick={() => handleViewTraining(training)}
                                >
                                  View Details
                                </Button>
                                {userCapabilities.canAssignTraining && (
                                  <Button
                                    variant="outline-primary"
                                    onClick={() => handleAssignTraining(training)}
                                  >
                                    Assign
                                  </Button>
                                )}
                                {userCapabilities.canEditTraining && (
                                  <Button
                                    variant="outline-secondary"
                                    onClick={() => handleEditTrainingClick(training)}
                                  >
                                    Edit
                                  </Button>
                                )}
                                {userCapabilities.canDeleteTraining && (
                                  <Button
                                    variant="outline-danger"
                                    onClick={() => handleDeleteTrainingClick(training)}
                                  >
                                    Delete
                                  </Button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      <AddDocumentModal
        isOpen={showUploadModal}
        onClose={() => {
          setShowUploadModal(false);
          setSelectedAssignment(null);
        }}
        onUpload={handleCertificateUpload}
        employee={{ name: user.displayName || user.email }}
        initialTitle={selectedAssignment?.training?.name || selectedAssignment?.title || ''}
        initialTag="Training"
      />

      <ApprovalConfirmationModal
        isOpen={showApproveModal}
        onClose={() => {
          setShowApproveModal(false);
          setSelectedAssignment(null);
        }}
        onConfirm={handleApproveConfirm}
        title="Approve Training Certificate"
        description="Are you sure you want to approve this training certificate?"
        confirmButtonText="Approve Certificate"
        cancelButtonText="Cancel"
      >
        {selectedAssignment && (
          <div className="space-y-4">
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

      <AddTrainingModal
        isOpen={showAddTrainingModal}
        onClose={() => {
          setShowAddTrainingModal(false);
          setSelectedTraining(null);
        }}
        onAdd={selectedTraining ? handleEditTraining : handleCreateTraining}
        training={selectedTraining}
        employee={{ name: user.displayName || user.email }}
      />

      <ViewTrainingModal
        isOpen={showViewTrainingModal}
        onClose={() => {
          setShowViewTrainingModal(false);
          setSelectedTraining(null);
        }}
        training={selectedTraining}
        assignment={null}
        user={user}
        allAssignments={assignments}
        onApprove={handleApproveClick}
        onDecline={handleDeclineClick}
        onApproveExtension={handleApproveExtensionClick}
        onDeclineExtension={handleDeclineExtensionClick}
      />

      <AssignTrainingModal
        isOpen={showAssignModal}
        onClose={() => {
          setShowAssignModal(false);
          setSelectedTraining(null);
        }}
        training={selectedTraining}
        onAssign={handleAssignToUsers}
      />

      {/* Request Extension Modal */}
      <RequestExtensionModal
        isOpen={showExtensionModal}
        onClose={() => {
          setShowExtensionModal(false);
          setSelectedAssignment(null);
        }}
        onSubmit={handleExtensionSubmit}
        assignment={selectedAssignment}
      />

      {/* Decline Certificate Modal */}
      {selectedAssignment && (
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
            documentTitle: selectedAssignment.training?.name
          } : null}
          title="Decline Training Certificate"
          description="Are you sure you want to decline this certificate?"
          confirmButtonText="Decline Certificate"
          cancelButtonText="Cancel"
          type="decline"
          requireReason={true}
        >
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
            <p className="text-sm text-orange-800">
              Declining this certificate will notify the employee that their submission was rejected.
            </p>
          </div>
        </ApprovalConfirmationModal>
      )}

      {/* Delete Training Modal */}
      {selectedTraining && !selectedAssignment && (
        <DeleteConfirmationModal
          isOpen={showDeclineModal}
          onClose={() => {
            setShowDeclineModal(false);
            setSelectedTraining(null);
          }}
          onConfirm={() => handleDeclineConfirm(null, null)}
          title="Delete Training"
          description="Are you sure you want to delete this training?"
          warningMessage="This action cannot be undone. All related assignments will also be deleted."
          confirmButtonText="Delete Training"
          cancelButtonText="Cancel"
          variant="danger"
        />
      )}

      {/* Extension Approval Modals */}
      <ApprovalConfirmationModal
        isOpen={showApproveExtensionModal}
        onClose={() => {
          setShowApproveExtensionModal(false);
          setSelectedExtensionRequest(null);
          setSelectedAssignment(null);
        }}
        onConfirm={handleApproveExtensionConfirm}
        title="Approve Extension Request"
        description={`Are you sure you want to approve the extension request for "${selectedExtensionRequest?.trainingName}"?`}
        confirmButtonText="Approve Extension"
        cancelButtonText="Cancel"
      >
        {selectedExtensionRequest && (
          <div className="space-y-4">
            {/* Extension Details */}
            <div className="flex items-start justify-between p-3 border border-border-secondary rounded-lg">
              <div className="flex items-start gap-3 flex-1">
                <div className="flex flex-col gap-1 flex-1">
                  <span className="text-md font-semibold text-text-primary">
                    {selectedExtensionRequest.trainingName}
                  </span>
                  <span className="text-xs text-text-secondary">
                    Reason: {selectedExtensionRequest.reason}
                  </span>
                </div>
              </div>
            </div>

            {/* Date Changes */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
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

      <ApprovalConfirmationModal
        isOpen={showDeclineExtensionModal}
        onClose={() => {
          setShowDeclineExtensionModal(false);
          setSelectedExtensionRequest(null);
          setSelectedAssignment(null);
        }}
        onConfirm={handleDeclineExtensionConfirm}
        title="Decline Extension Request"
        description={`Are you sure you want to decline the extension request for "${selectedExtensionRequest?.trainingName}"?`}
        confirmButtonText="Decline Extension"
        cancelButtonText="Cancel"
        variant="danger"
      />
    </div>
  );
};

export default TrainingManagementPage;