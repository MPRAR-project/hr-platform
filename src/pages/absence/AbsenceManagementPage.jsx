import React, { useState, useEffect, useMemo } from 'react';

import { Search, User, Calendar, Clock, Briefcase, CheckCircle, Plus, XCircle } from 'lucide-react';
import Header from '../../components/layout/Header';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Tabs from '../../components/ui/Tabs';
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '../../components/shared/Table';
const ViewAbsenceModal = React.lazy(() => import('../../components/modals/ViewAbsenceModal'));
const EditAbsenceModal = React.lazy(() => import('../../components/modals/EditAbsenceModal'));
const AddAbsenceModal = React.lazy(() => import('../../components/modals/AddAbsenceModal'));
import { useAuth } from '../../hooks/useAuth';
import { useDebounce } from '../../hooks/useDebounce';
import { useNavigate, useLocation } from 'react-router-dom';
import { toast, Slide } from 'react-toastify';
import { absenceService } from '../../services/absenceService';
import { allowanceService } from '../../services/allowanceService';
import { getUsersByCompany } from '../../services/users';
import { getManagedEmployeeIdsForManager } from '../../services/teams';
import { getRoleName } from '../../utils/getRoleName';
import { useCache } from '../../contexts/CacheContext';
import { LoadingSkeleton } from '../../components/ui/LoadingSkeleton';
import { AllowancesTab } from '../profile/components/AllowanceTab';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { db } from '../../firebase/client';
import { safeParseDate } from '../../utils/safeDateParse';

const AbsenceManagementPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { getItem, setItem } = useCache();

  // Determine available tabs based on role
  const getAvailableTabs = () => {
    const role = user?.role || '';
    if (role === 'employee') {
      return [{ label: 'My Absences' }];
    }
    else if (role === 'siteManager') {
      return [{ label: 'Employee Absences' }];
    }
    else {
      // siteManager, teamManager, admin, superUser, etc. have both
      return [{ label: 'My Absences' }, { label: 'Employee Absences' }];
    }
  };

  const availableTabs = useMemo(() => getAvailableTabs(), [user?.role]);

  // State management
  const [activeTab, setActiveTab] = useState(location.state?.activeTab || availableTabs[0].label);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300); // 300ms debounce for search
  const [filterRole, setFilterRole] = useState('All Roles');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedAbsence, setSelectedAbsence] = useState(null);
  const [myAbsencesHistory, setMyAbsencesHistory] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [allowancesRefreshNonce, setAllowancesRefreshNonce] = useState(0);
  const [selectedLeaveType, setSelectedLeaveType] = useState('all');
  const [userAllowances, setUserAllowances] = useState([]);
  const [loadingAllowances, setLoadingAllowances] = useState(false);
  const [allowancesCache, setAllowancesCache] = useState(new Map());
  const [fetchTimeout, setFetchTimeout] = useState(null);

  // Optimistic UI state
  const [pendingAbsences, setPendingAbsences] = useState([]);
  const [syncingIds, setSyncingIds] = useState(new Set());

  // Set up real-time listeners on component mount and tab change
  useEffect(() => {
    if (!user) return;

    let unsubscribe = null;

    if (activeTab === 'My Absences') {
      setLoading(true);
      setError(null);
      // Subscribe to real-time updates for user's absences
      unsubscribe = absenceService.subscribeToUserAbsences(user.userId, (absences, error) => {
        if (error) {
          console.error('Error in absences subscription:', error);
          setError(error.message);
          setLoading(false);
          return;
        }

        if (absences) {
          const formattedAbsences = absences.map(absence => ({
            ...absence,
            name: user.displayName,
            leave: absence.leaveType,
            date: formatDateRange(absence.startDate, absence.endDate)
          }));

          // OPTIMIZED: Merge with pending optimistic updates and sort correctly
          const pendingIds = new Set(pendingAbsences.map(p => p.id));
          const mergedAbsences = [
            ...pendingAbsences,
            ...formattedAbsences.filter(a => !pendingIds.has(a.id))
          ].sort((a, b) => {
            const aT = a?.createdAt?.toMillis?.() || (a?.createdAt instanceof Date ? a.createdAt.getTime() : (a?.createdAt?.seconds * 1000) || 0);
            const bT = b?.createdAt?.toMillis?.() || (b?.createdAt instanceof Date ? b.createdAt.getTime() : (b?.createdAt?.seconds * 1000) || 0);
            return bT - aT;
          });

          setMyAbsencesHistory(mergedAbsences);
          // Refresh allowances widget when absences change so "Used" updates immediately.
          setAllowancesRefreshNonce((n) => n + 1);
          setLoading(false);
        }
      });
    } else if (activeTab === 'Employee Absences') {
      // Check if we already have employees data to avoid showing loader unnecessarily
      if (employees.length === 0) {
        loadEmployeesData();
      } else {
        // Refresh in background
        loadEmployeesData(true);
      }

      // REAL-TIME SUBSCRIPTION: Re-fetch summary stats whenever any company absence changes
      unsubscribe = absenceService.subscribeToEmployeeAbsences(user, (result) => {
        console.log('[AbsenceManagement] Global absences updated, refreshing employee data');
        // Since building the employee list requires users + allowances too, 
        // we trigger a background refresh of the whole set.
        loadEmployeesData(true);
      });
    }

    // Cleanup subscription on unmount or tab change
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
      if (fetchTimeout) {
        clearTimeout(fetchTimeout);
      }
    };
  }, [activeTab, user?.uid]); // Reduced dependencies to avoid excessive re-runs

  // Fetch user allowances to determine if Add Request button should be shown
  useEffect(() => {
    if (user?.userId && activeTab === 'My Absences') {
      const forceRefresh = allowancesRefreshNonce > 0;
      fetchUserAllowances(forceRefresh);
    }
  }, [user?.userId, activeTab, allowancesRefreshNonce]); // Add allowancesRefreshNonce to refetch when refreshed

  const fetchUserAllowances = async (forceRefresh = false) => {
    const currentYear = new Date().getFullYear();
    const cacheKey = `${user.userId}_${currentYear}`;

    // Check cache first (unless refresh was forced)
    if (!forceRefresh && allowancesCache.has(cacheKey)) {
      const cachedAllowances = allowancesCache.get(cacheKey);
      setUserAllowances(cachedAllowances);
      return;
    }

    // Clear existing timeout
    if (fetchTimeout) {
      clearTimeout(fetchTimeout);
    }

    // Debounce the API call
    const timeoutId = setTimeout(async () => {
      setLoadingAllowances(true);
      try {
        const allowances = await allowanceService.getEmployeeAllowances(
          user.userId,
          user,
          currentYear
        );

        // Update cache
        setAllowancesCache(prev => new Map(prev).set(cacheKey, allowances));
        setUserAllowances(allowances);
      } catch (error) {
        console.error('Error fetching user allowances:', error);
        setUserAllowances([]);
      } finally {
        setLoadingAllowances(false);
      }
    }, 300); // 300ms debounce

    setFetchTimeout(timeoutId);
  };



  const normalizeId = (id) => {
    if (!id) return '';
    if (typeof id !== 'string') {
      // Handle Firestore Reference or other objects
      return id.id || (typeof id.path === 'string' ? id.path.split('/').pop() : '');
    }
    const trimmed = id.trim();
    return trimmed.includes('/') ? trimmed.split('/').pop() : trimmed;
  };

  const buildEmployeesFromData = (allUsers, absencesDocs, excludeUserId, managedIds = null) => {
    const currentUserId = normalizeId(excludeUserId || user?.uid);
    const statsMap = new Map();

    // Single pass for stats calculation
    if (Array.isArray(absencesDocs)) {
      for (const abs of absencesDocs) {
        const uid = normalizeId(abs.userId);
        if (!uid) continue;

        let s = statsMap.get(uid);
        if (!s) {
          s = { total: 0, approved: 0, pending: 0, rejected: 0 };
          statsMap.set(uid, s);
        }

        const status = (abs.status || '').toLowerCase();

        s.total++;
        if (status === 'approved') s.approved++;
        else if (status === 'pending') s.pending++;
        else if (status === 'rejected') s.rejected++;
      }
    }

    const builtEmployees = [];
    // Single pass for employee mapping with filtering
    for (const employee of allUsers) {
      const empId = normalizeId(employee.id);
      if (empId === currentUserId) continue;
      if (managedIds && !managedIds.has(empId)) continue;

      const stats = statsMap.get(empId) || { total: 0, approved: 0, pending: 0, rejected: 0 };
      builtEmployees.push({
        id: employee.id,
        name: employee.displayName || 'Unknown',
        email: employee.email || 'No email',
        role: getRoleName(employee.primaryRole) || 'Employee',
        department: employee.department || 'N/A',
        hireDate: employee.hireDate || '2022-01-01',
        totalAbsences: stats.total,
        approved: stats.approved,
        pending: stats.pending,
        rejected: stats.rejected
      });
    }
    return builtEmployees;
  };

  const loadEmployeesData = async (isBackground = false) => {
    try {
      const companyIdRaw = normalizeId(user.companyId);
      const cacheKey = `absences_${companyIdRaw}`;

      if (!isBackground) {
        setLoading(true);
        setError(null);

        const cached = getItem?.(cacheKey);
        if (cached?.users && Array.isArray(cached.absences)) {
          let managedIds = null;
          if (user.role === 'teamManager') {
            try {
              managedIds = await getManagedEmployeeIdsForManager(user.userId, companyIdRaw);
            } catch (_) {
              managedIds = new Set();
            }
          }
          const built = buildEmployeesFromData(cached.users, cached.absences, null, managedIds);
          setEmployees(built);
          setLoading(false);
          // If cache is fresh (less than 2 mins old), don't even perform background fetch
          if (cached.timestamp && (Date.now() - cached.timestamp < 2 * 60 * 1000)) {
            return;
          }
        }
      }

      // Perform fetching
      if (!user?.companyId) {
        console.error('❌ User companyId is undefined, cannot fetch data');
        setEmployees([]);
        setLoading(false);
        return;
      }

      const usersPromise = getUsersByCompany(user.companyId);
      const absencesPromise = (async () => {
        try {
          const rawCompId = normalizeId(user.companyId);
          const pathCompId = `companies/${rawCompId}`;

          // Validate companyId before using in query
          if (!rawCompId || rawCompId === 'undefined') {
            console.error('❌ Invalid companyId for query:', rawCompId);
            return [];
          }

          // Simplified query to ensure it matches stored data regardless of format
          // and avoids composite index requirements
          const absenceQuery = query(
            collection(db, 'absences'),
            where('companyId', 'in', [rawCompId, pathCompId]),
            limit(5000) // Increased limit to ensure we get enough data
          );

          const absenceSnap = await getDocs(absenceQuery);
          return absenceSnap.docs.map(d => {
            const data = d.data();
            return {
              userId: data.userId,
              status: data.status,
              startDate: data.startDate // Still helpful to have if we need to filter client-side
            };
          });
        } catch (err) {
          console.warn('Failed to fetch absences', err);
          return [];
        }
      })();

      const [allUsers, absencesDocs] = await Promise.all([usersPromise, absencesPromise]);

      // Store in cache with timestamp for freshness check
      setItem?.(cacheKey, {
        users: allUsers,
        absences: absencesDocs,
        timestamp: Date.now()
      }, 7 * 60 * 1000);

      const currentUserId = normalizeId(user.userId);
      let managedEmployeeIds = null;
      if (user.role === 'teamManager') {
        try {
          managedEmployeeIds = await getManagedEmployeeIdsForManager(user.userId, normalizeId(user.companyId));
        } catch (error) {
          console.error('Error fetching managed employees:', error);
          managedEmployeeIds = new Set();
        }
      }

      // Build employees with stats
      const employeesWithStats = buildEmployeesFromData(allUsers, absencesDocs, currentUserId, managedEmployeeIds);

      // Sort employees: show those with recent pending absences or most recent absences first
      employeesWithStats.sort((a, b) => {
        // Priority 1: Pending absences count
        if (b.pending !== a.pending) return b.pending - a.pending;
        // Priority 2: Total absences
        return b.totalAbsences - a.totalAbsences;
      });

      setEmployees(employeesWithStats);
      setLoading(false);
    } catch (err) {
      console.error('Error loading employees data:', err);
      if (!isBackground) {
        setError(err.message);
        setLoading(false);
      }
    }
  };

  // Get unique roles from employees for filter dropdown
  const availableRoles = useMemo(() => {
    const roles = new Set(employees.map(emp => emp.role || emp.primaryRole).filter(Boolean));
    console.log('availableRoles', Array.from(roles).sort());
    return Array.from(roles).sort();
  }, [employees]);

  const formatDateRange = (startDate, endDate) => {
    if (!startDate || !endDate) return 'N/A';

    const start = safeParseDate(startDate);
    const end = safeParseDate(endDate);

    const formatDate = (date) => {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: start.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
      });
    };

    if (start.toDateString() === end.toDateString()) {
      return formatDate(start);
    }

    return `${formatDate(start)}-${formatDate(end)}`;
  };

  // Handler functions
  const handleViewAbsences = (employeeId) => {
    navigate(`/absences/${employeeId}`);
  };

  const handleViewAbsencesModal = async (absence) => {
    // Show modal immediately with existing data
    setSelectedAbsence(absence);
    setShowViewModal(true);

    // Only fetch fresh allowance data if user is a manager and absence has a leave type
    if (['siteManager', 'seniorManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor', 'teamManager'].includes(user?.role) && absence.leaveType) {
      try {
        const allowanceSummary = await allowanceService.getAllowanceSummary(absence.userId, absence.leaveType);
        if (allowanceSummary) {
          // Update the selected absence with fresh allowance data
          setSelectedAbsence(prev => ({
            ...prev,
            allowanceInfo: allowanceSummary
          }));
        }
      } catch (error) {
        console.error('Error fetching fresh allowance data:', error);
        // Modal is already open with existing data, so no need to handle error
      }
    }
  }
  const handleEditAbsence = (absence) => {
    setSelectedAbsence(absence);
    setShowEditModal(true);
  };

  const handleAddAbsence = async (newAbsence) => {
    // Generate temporary ID for optimistic update
    const tempId = `temp_${Date.now()}`;

    // Calculate duration for allowance check
    const startDate = new Date(newAbsence.startingDate);
    const endDate = new Date(newAbsence.endingDate);
    const durationMs = endDate.getTime() - startDate.getTime();
    const durationDays = Math.ceil(durationMs / (1000 * 60 * 60 * 24)) + 1;

    // Business rule: only Sick Leave can be auto-approved.
    const optimisticStatus = newAbsence.leaveType === 'sick_leave' ? 'Approved' : 'Pending';

    // Create optimistic absence entry
    const optimisticAbsence = {
      id: tempId,
      ...newAbsence,
      name: user.displayName,
      userId: user.userId,
      status: optimisticStatus,
      createdAt: new Date(),
      startDate: newAbsence.startingDate,
      endDate: newAbsence.endingDate,
      leaveType: newAbsence.leaveType,
      reason: newAbsence.reason,
      leave: newAbsence.leaveType,
      date: formatDateRange(newAbsence.startingDate, newAbsence.endingDate),
      duration: `${durationDays} days`,
      isOptimistic: true // Flag to identify optimistic updates
    };

    // Add to pending absences immediately
    setPendingAbsences(prev => [optimisticAbsence, ...prev]);
    setSyncingIds(prev => new Set([...prev, tempId]));

    try {
      // Create absence in Firebase
      const createdAbsence = await absenceService.createAbsence(newAbsence, user.userId);

      // Remove from pending and syncing once confirmed
      setPendingAbsences(prev => prev.filter(a => a.id !== tempId));
      setSyncingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(tempId);
        return newSet;
      });

      // Show success toast with custom style for holiday requests
      toast.success('Absence request created successfully!', {
        position: "top-center",
        transition: Slide,
        theme: "colored",
        autoClose: 3000
      });

      // Refresh employee list stats if currently on the employee tab
      if (activeTab === 'Employee Absences') {
        loadEmployeesData(true);
      }

    } catch (err) {
      console.error('Error adding absence:', err);
      setError(err.message);

      // Remove failed optimistic update
      setPendingAbsences(prev => prev.filter(a => a.id !== tempId));
      setSyncingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(tempId);
        return newSet;
      });

      // Show error toast
      toast.error('Failed to create absence request. Please try again.');
    }
  };

  const handleSaveAbsence = async (updatedData) => {
    const absenceId = selectedAbsence.id;

    // Optimistically update the absence in local state
    setMyAbsencesHistory(prev => prev.map(absence =>
      absence.id === absenceId
        ? {
          ...absence,
          ...updatedData,
          startDate: updatedData.startingDate || absence.startDate,
          endDate: updatedData.endingDate || absence.endDate,
          date: formatDateRange(updatedData.startingDate || absence.startDate, updatedData.endingDate || absence.endDate),
          isOptimistic: true
        }
        : absence
    ));

    setSyncingIds(prev => new Set([...prev, absenceId]));

    try {
      await absenceService.updateAbsence(absenceId, updatedData, user);

      // Remove from syncing once confirmed (real-time listener will update the data)
      setSyncingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(absenceId);
        return newSet;
      });

      toast.success('Absence request updated successfully!', {
        position: "top-center",
        transition: Slide,
        theme: "colored",
        autoClose: 3000
      });

    } catch (err) {
      console.error('Error saving absence:', err);
      setError(err.message);
      toast.error('Failed to update absence request. Please try again.');

      // Revert optimistic update on error
      setSyncingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(absenceId);
        return newSet;
      });

      // Note: Real-time listener will automatically revert to correct state
    }
  };

  const handleApprove = async (absenceId) => {
    // Optimistically update status
    setMyAbsencesHistory(prev => prev.map(absence =>
      absence.id === absenceId
        ? { ...absence, status: 'Approved', isOptimistic: true }
        : absence
    ));

    setSyncingIds(prev => new Set([...prev, absenceId]));

    try {
      await absenceService.approveAbsence(absenceId, user);
      setShowViewModal(false);

      setSyncingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(absenceId);
        return newSet;
      });

      toast.success('Absence request approved successfully!');

      // Refresh data to update stats and cache
      const companyIdRaw = normalizeId(user.companyId);
      setItem?.(`absences_${companyIdRaw}`, null); // Invalidate cache
      loadEmployeesData(true);
      if (activeTab === 'My Absences') {
        setAllowancesRefreshNonce((n) => n + 1);
      }

    } catch (err) {
      console.error('Error approving absence:', err);
      setError(err.message);
      toast.error('Failed to approve absence request. Please try again.');

      setSyncingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(absenceId);
        return newSet;
      });
    }
  };

  const handleDecline = async (absenceId, reason) => {
    // Optimistically update status
    setMyAbsencesHistory(prev => prev.map(absence =>
      absence.id === absenceId
        ? { ...absence, status: 'Rejected', declineReason: reason, isOptimistic: true }
        : absence
    ));

    setSyncingIds(prev => new Set([...prev, absenceId]));

    try {
      await absenceService.declineAbsence(absenceId, reason, user);
      setShowViewModal(false);

      setSyncingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(absenceId);
        return newSet;
      });

      toast.success('Absence request declined successfully!');

      // Refresh data to update stats and cache
      const companyIdRaw = normalizeId(user.companyId);
      setItem?.(`absences_${companyIdRaw}`, null); // Invalidate cache
      loadEmployeesData(true);

    } catch (err) {
      console.error('Error declining absence:', err);
      setError(err.message);
      toast.error('Failed to decline absence request. Please try again.');

      setSyncingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(absenceId);
        return newSet;
      });
    }
  };

  const getStatusVariant = (status) => {
    switch (status.toLowerCase()) {
      case 'pending':
        return 'warning';
      case 'approved':
        return 'success';
      case 'rejected':
        return 'danger';
      default:
        return 'warning';
    }
  };

  const pretty = (role) =>
    role.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());

  const filteredEmployees = useMemo(() => {
    return employees
      .filter(employee =>
        debouncedSearch === '' ||
        (employee.name || '').toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        (employee.email || '').toLowerCase().includes(debouncedSearch.toLowerCase())
      )
      .filter(employee =>
        filterRole === 'All Roles' ||
        employee.role === filterRole
      );
  }, [employees, debouncedSearch, filterRole]);

  return (
    <div className="h-screen flex flex-col overflow-hidden">

      <Header
        title={`${pretty(user?.role || 'employee')} Dashboard`}
        subtitle="Ensure compliance and manage onboarding from one place."
      />

      <div className="flex-1 overflow-y-auto p-3xl space-y-3xl scrollbar-custom">
        <div className="max-w-7xl mx-auto">
          {/* Page Title */}
          <div className="mb-4xl">
            <h1 className="text-2xl md:text-3xl font-bold text-text-primary">Absence Management</h1>
            <p className="text-sm text-text-secondary mt-1">Manage your absences and team requests</p>
          </div>

          {/* Tabs - Only show if user has more than one tab */}
          {availableTabs.length > 1 && (
            <Tabs
              tabs={availableTabs}
              activeTab={activeTab}
              onTabChange={(tab) => setActiveTab(tab)}
            />
          )}

          {/* Error Message */}
          {/* {error && (
            <div className="bg-red-50 border border-red-200 rounded-base p-4 mb-6">
              <p className="text-red-600">Error: {error}</p>
              <button 
                // onClick={loadData}
                className="mt-2 text-red-700 underline hover:no-underline"
              >
                Try again
              </button>
            </div>
          )} */}

          {/* Tab Content */}
          <div className="mt-4xl">
            {/* My Absences Tab */}
            {activeTab === 'My Absences' && (
              <div className="space-y-3xl">
                {/* Allowances Widget Section */}
                <div className="bg-white border border-border-primary rounded-base overflow-hidden">
                  <AllowancesTab
                    refreshToken={allowancesRefreshNonce}
                    selectedLeaveType={selectedLeaveType}
                    onLeaveTypeChange={setSelectedLeaveType}
                    absences={myAbsencesHistory}
                  />
                </div>

                {/* Absences History Section with Add Button */}
                <div className="bg-white border border-border-primary rounded-base">
                  <div className="p-4xl border-b border-border-primary">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                      <h2 className="text-xl font-bold text-text-primary">My Absences History</h2>
                      <Button
                        variant="gradient"
                        icon={Plus}
                        onClick={() => setShowAddModal(true)}
                        aria-label="Add new absence request"
                      >
                        Add Request
                      </Button>
                    </div>
                  </div>

                  {loading && myAbsencesHistory.length === 0 ? (
                    <div className="space-y-3 p-4xl">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="flex items-center gap-4 py-3 border-b border-border-primary animate-pulse">
                          <LoadingSkeleton height="h-4" width="w-24" />
                          <LoadingSkeleton height="h-4" width="w-32" />
                          <LoadingSkeleton height="h-4" width="w-20" />
                          <LoadingSkeleton height="h-6" width="w-16" className="rounded-full" />
                        </div>
                      ))}
                    </div>
                  ) : myAbsencesHistory.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-text-secondary">No absence requests found.</p>
                    </div>
                  ) : (
                    <>
                      {/* Filtered absences based on selected leave type */}
                      {(() => {
                        const filteredAbsences = selectedLeaveType === 'all'
                          ? myAbsencesHistory
                          : myAbsencesHistory.filter(absence => {
                            const leaveDisplayName = allowanceService.getLeaveTypeDisplayName(absence.leaveType);
                            return leaveDisplayName === selectedLeaveType;
                          });

                        return filteredAbsences.length === 0 ? (
                          <div className="text-center py-8">
                            <p className="text-text-secondary">
                              {selectedLeaveType === 'all'
                                ? 'No absence requests found.'
                                : `No ${selectedLeaveType} requests found.`}
                            </p>
                          </div>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableHeaderCell>Leave</TableHeaderCell>
                              <TableHeaderCell>Reason</TableHeaderCell>
                              <TableHeaderCell>Date</TableHeaderCell>
                              <TableHeaderCell>Status</TableHeaderCell>
                              <TableHeaderCell>Actions</TableHeaderCell>
                            </TableHeader>
                            <TableBody>
                              {filteredAbsences.map((absence) => {
                                const isSyncing = syncingIds.has(absence.id);
                                const isOptimistic = absence.isOptimistic;

                                return (
                                  <TableRow
                                    key={absence.id}
                                    className={isOptimistic ? 'opacity-75 bg-blue-50' : ''}
                                  >
                                    <TableCell>
                                      <div className="flex items-center gap-2">
                                        <span className="font-semibold text-text-primary">{absence.displayName || allowanceService.getLeaveTypeDisplayName(absence.leaveType)}</span>
                                        {isSyncing && (
                                          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                                        )}
                                      </div>
                                    </TableCell>
                                    <TableCell>
                                      <span className="text-text-secondary">{absence.reason}</span>
                                    </TableCell>
                                    <TableCell>
                                      <span className="text-text-secondary">
                                        {(() => {
                                          const getDates = () => {
                                            if (absence.startDate && absence.endDate) {
                                              return {
                                                start: absence.startDate,
                                                end: absence.endDate,
                                              };
                                            }

                                            if (absence.dates) {
                                              // Support both "to" and "-"
                                              const splitByTo = absence.dates.split(" to ");
                                              const splitByDash = absence.dates.split(" - ");

                                              const parts =
                                                splitByTo.length === 2 ? splitByTo :
                                                  splitByDash.length === 2 ? splitByDash :
                                                    [];

                                              return {
                                                start: parts[0],
                                                end: parts[1],
                                              };
                                            }

                                            return { start: null, end: null };
                                          };

                                          const { start, end } = getDates();
                                          const startDate = safeParseDate(start);
                                          const endDate = safeParseDate(end);

                                          if (!startDate || !endDate || isNaN(startDate) || isNaN(endDate)) {
                                            return "-";
                                          }

                                          const format = (d) =>
                                            d.toLocaleString("en-US", { month: "short", day: "numeric" });

                                          return startDate.toDateString() === endDate.toDateString()
                                            ? format(startDate)
                                            : `${format(startDate)}-${format(endDate)}`;
                                        })()}
                                      </span>
                                    </TableCell>
                                    <TableCell>
                                      <div className="flex items-center gap-2">
                                        <Badge variant={getStatusVariant(absence.status)}>
                                          {absence.status}
                                        </Badge>
                                        {isOptimistic && (
                                          <span className="text-xs text-blue-500">Syncing...</span>
                                        )}
                                      </div>
                                    </TableCell>

                                    <TableCell>
                                      <div className='flex gap-2'>
                                        <Button
                                          variant='outline-primary'
                                          onClick={() => handleViewAbsencesModal(absence)}
                                          disabled={isSyncing}
                                          aria-label={`View details for ${absence.leaveType} absence`}
                                        >
                                          View
                                        </Button>
                                        {absence.status === "Pending" && (
                                          <Button
                                            variant="outline-primary"
                                            onClick={() => handleEditAbsence(absence)}
                                            disabled={isSyncing}
                                            aria-label="Edit absence request"
                                          >
                                            Edit
                                          </Button>
                                        )}
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        );
                      })()}
                      <p className="text-xs py-4 text-text-secondary text-center md:hidden">
                        ← Scroll horizontally to view all columns →
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Employee Absences Tab */}
            {activeTab === 'Employee Absences' && (
              <div className="space-y-4xl">
                {/* Search and Filter */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div className="relative w-full sm:w-96">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-text-secondary" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="search by name or phone or email..."
                      id="employee-search"
                      aria-label="Search employees"
                      className="w-full h-12 pl-12 pr-4 border border-border-secondary rounded-full text-sm placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
                    />
                  </div>

                  <div className="flex items-center gap-3">
                    <label htmlFor="role-filter" className="text-sm text-text-secondary">Filter by:</label>
                    <select
                      id="role-filter"
                      value={filterRole}
                      onChange={(e) => setFilterRole(e.target.value)}
                      aria-label="Filter by employee role"
                      className="px-4 py-2 border border-border-secondary rounded-lg text-sm focus:outline-none focus:border-border-accent-purple"
                    >
                      <option>All Roles</option>
                      {availableRoles.map(role => (
                        <option key={role} value={role}>{role}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Employee Cards */}
                {loading && employees.length === 0 ? (
                  <div className="space-y-4">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="bg-white border border-border-primary rounded-lg p-6 animate-pulse">
                        <div className="flex gap-4">
                          <LoadingSkeleton height="h-12" width="w-12" className="rounded-full flex-shrink-0" />
                          <div className="flex-1 space-y-2">
                            <LoadingSkeleton height="h-5" width="w-40" />
                            <LoadingSkeleton height="h-4" width="w-56" />
                            <LoadingSkeleton height="h-4" width="w-32" />
                          </div>
                          <div className="flex gap-6">
                            {[1, 2, 3].map((j) => (
                              <LoadingSkeleton key={j} height="h-10" width="w-14" />
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : employees.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-text-secondary">No employees found.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {filteredEmployees.map((employee) => (
                      <div key={employee.id} className="bg-white border border-border-accent-purple rounded-lg p-4xl shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-start gap-6">
                          {/* Employee Info */}
                          <div className="flex items-center gap-4 flex-1">
                            <div className="w-12 h-12 bg-bg-accent-purple-light rounded-full flex items-center justify-center flex-shrink-0">
                              <User className="h-6 w-6 text-text-accent-purple" />
                            </div>
                            <div>
                              <div className="flex items-center gap-3 mb-2 flex-wrap">
                                <h3 className="text-lg font-semibold text-text-primary">{employee.name}</h3>
                                <Badge variant={employee.role === 'Manager' ? 'role' : 'info'}>
                                  {employee.role}
                                </Badge>
                              </div>
                              <p className="text-sm text-text-secondary mb-2">{employee.email}</p>
                              <div className="flex flex-wrap items-center gap-4 text-sm">
                                <span className="flex items-center gap-1 text-purple-500">
                                  <Briefcase className="h-3 w-3" />
                                  {employee.department}
                                </span>
                                <span className="flex items-center gap-1 text-blue-500">
                                  <Calendar className="h-3 w-3" />
                                  Hired: {employee.hireDate}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Stats and Button */}
                          <div className="flex flex-wrap sm:justify-end justify-center w-full lg:w-auto items-center gap-6 lg:gap-8">
                            <div className="text-center">
                              <div className="flex items-center justify-center gap-2 mb-1">
                                <Clock className="h-5 w-5 text-blue-500" />
                                <p className="text-3xl font-bold text-blue-500">{employee.totalAbsences}</p>
                              </div>
                              <p className="text-xs text-text-secondary">Total</p>
                            </div>
                            <div className="text-center">
                              <div className="flex items-center justify-center gap-2 mb-1">
                                <CheckCircle className="h-5 w-5 text-green-500" />
                                <p className="text-3xl font-bold text-green-500">{employee.approved}</p>
                              </div>
                              <p className="text-xs text-text-secondary">Approved</p>
                            </div>
                            <div className="text-center">
                              <div className="flex items-center justify-center gap-2 mb-1">
                                <Clock className="h-5 w-5 text-orange-500" />
                                <p className="text-3xl font-bold text-orange-500">{employee.pending}</p>
                              </div>
                              <p className="text-xs text-text-secondary">Pending</p>
                            </div>
                            {employee.rejected > 0 && (
                              <div className="text-center">
                                <div className="flex items-center justify-center gap-2 mb-1">
                                  <XCircle className="h-5 w-5 text-red-500" />
                                  <p className="text-3xl font-bold text-red-500">{employee.rejected}</p>
                                </div>
                                <p className="text-xs text-text-secondary">Rejected</p>
                              </div>
                            )}
                            <Button
                              variant="outline-primary"
                              onClick={() => handleViewAbsences(employee.id)}
                              cn="sm:max-w-36 w-full"
                            >
                              View Absences
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>


      <React.Suspense fallback={null}>
        {showEditModal && (
          <EditAbsenceModal
            isOpen={showEditModal}
            onClose={() => {
              setShowEditModal(false);
              setSelectedAbsence(null);
            }}
            onSave={handleSaveAbsence}
            absence={selectedAbsence}
          />
        )}
        {showAddModal && (
          <AddAbsenceModal
            isOpen={showAddModal}
            onClose={() => setShowAddModal(false)}
            onSave={handleAddAbsence}
            userId={user?.userId}
            preloadedAllowances={userAllowances}
          />
        )}
        {showViewModal && (
          <ViewAbsenceModal
            isOpen={showViewModal}
            onClose={() => {
              setShowViewModal(false);
              setSelectedAbsence(null);
            }}
            absence={selectedAbsence}
            onApprove={handleApprove}
            onDecline={handleDecline}
            currentUser={user}
          />
        )}
      </React.Suspense>
    </div>
  );
};

export default AbsenceManagementPage;