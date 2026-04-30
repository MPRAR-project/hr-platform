import React, { useRef, useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { Search, User, Briefcase, Calendar, ArrowLeft, Clock, CheckCircle, AlertTriangle, XCircle, Plus } from 'lucide-react';
import Header from '../../components/layout/Header';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import StatCard from '../../components/shared/StatCard';
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '../../components/shared/Table';
import ViewAbsenceModal from '../../components/modals/ViewAbsenceModal';
import EditAbsenceModal from '../../components/modals/EditAbsenceModal';
import AddAbsenceModal from '../../components/modals/AddAbsenceModal';
import { useAuth } from '../../hooks/useAuth';
import { absenceService } from '../../services/absenceService';
import { allowanceService } from '../../services/allowanceService';
import { getUserById } from '../../services/users';
import { toast, Slide } from 'react-toastify';
import Loader from '../../components/ui/Loader';
import { useCache } from '../../contexts/CacheContext';
import { safeParseDate } from '../../utils/safeDateParse';
import { LEAVE_TYPES } from '../../constants/leaveTypes';

const EmployeeAbsencesPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: employeeId } = useParams();
  const { user } = useAuth();
  const { getItem, setItem } = useCache();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('All Status');
  const [showViewModal, setShowViewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedAbsence, setSelectedAbsence] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [absences, setAbsences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const unsubscribeRef = useRef(null);

  // Load employee base info + start real-time listener for absences
  useEffect(() => {
    let cancelled = false;

    const startRealtime = async () => {
      if (!employeeId || !user) return;

      // Cleanup previous listener
      if (typeof unsubscribeRef.current === 'function') {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }

      const cacheKey = `employee_absences_${employeeId}`;

      // Fast paint from cache
      try {
        const cached = getItem?.(cacheKey);
        if (cached?.employee) setEmployee(cached.employee);
        if (Array.isArray(cached?.absences)) setAbsences(cached.absences);
        if (cached?.employee && Array.isArray(cached?.absences)) {
          setLoading(false);
        } else {
          setLoading(true);
        }
      } catch (_) {
        setLoading(true);
      }

      setError(null);

      // Fetch employee details (once) in background
      try {
        const employeeData = await getUserById(employeeId);
        if (!cancelled && employeeData) {
          setEmployee(prev => ({
            ...(prev || {}),
            id: employeeData.id,
            name: employeeData.displayName,
            email: employeeData.email,
            role: employeeData.primaryRole,
            department: employeeData.department || 'N/A',
            hireDate: employeeData.hireDate || '2022-01-01',
            employeeId: employeeData.employeeId || `EMP-${employeeId.slice(-6)}`
          }));
        }
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Failed to load employee');
      }

      // Subscribe to employee absences (real-time)
      const unsubscribe = await absenceService.subscribeToEmployeeAbsencesById(
        employeeId,
        user,
        (liveAbsences) => {
          if (cancelled) return;

          // Sort client-side (no orderBy to avoid index issues)
          const sorted = [...(liveAbsences || [])].sort((a, b) => {
            const aT = a?.createdAt?.toMillis?.() || a?.createdAt?.seconds * 1000 || 0;
            const bT = b?.createdAt?.toMillis?.() || b?.createdAt?.seconds * 1000 || 0;
            return bT - aT;
          });

          // Compute stats from the same payload (no extra query)
          const stats = sorted.reduce((acc, a) => {
            acc.total += 1;
            const s = String(a?.status || '').toLowerCase();
            if (s === 'approved') acc.approved += 1;
            else if (s === 'pending') acc.pending += 1;
            else if (s === 'rejected') acc.rejected += 1;
            return acc;
          }, { total: 0, approved: 0, pending: 0, rejected: 0 });

          setEmployee(prev => ({
            ...(prev || {}),
            totalAbsences: stats.total,
            approved: stats.approved,
            pending: stats.pending,
            rejected: stats.rejected
          }));

          const displayName = employee?.name || employee?.displayName || 'Employee';
          const formatted = sorted.map(absence => ({
            ...absence,
            name: displayName,
            date: formatDateRange(absence.startDate, absence.endDate),
            dates: `${absence.startDate} to ${absence.endDate}`,
            submittedDate: absence.createdAt?.toDate?.()?.toISOString?.()?.split('T')[0] || absence.createdAt,
            uploadedBy: 'Employee'
          }));

          setAbsences(formatted);
          setLoading(false);

          // Cache latest snapshot for instant revisit
          setItem?.(cacheKey, {
            employee: {
              ...(employee || {}),
              ...(prevEmployeeSafe() || {}),
              totalAbsences: stats.total,
              approved: stats.approved,
              pending: stats.pending,
              rejected: stats.rejected
            },
            absences: formatted,
            timestamp: Date.now()
          }, 5 * 60 * 1000);
        },
        (err) => {
          if (cancelled) return;
          setError(err?.message || 'Failed to subscribe to absences');
          setLoading(false);
        }
      );

      if (!cancelled) {
        unsubscribeRef.current = unsubscribe;
      } else if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };

    // helper to avoid referencing stale state inside setItem payload
    const prevEmployeeSafe = () => null;

    startRealtime();

    return () => {
      cancelled = true;
      if (typeof unsubscribeRef.current === 'function') {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [employeeId, user?.uid]);

  const loadEmployeeData = async (silent = false) => {
    if (!employeeId || !user) {
      return;
    }

    const cacheKey = `employee_absences_${employeeId}`;

    // Fast path: render cached data immediately (best perceived performance)
    if (!silent) {
      try {
        const cached = getItem?.(cacheKey);
        if (cached?.employee && Array.isArray(cached?.absences)) {
          setEmployee(cached.employee);
          setAbsences(cached.absences);

          // If cache is fresh (<5 min), skip blocking loader entirely.
          if (cached.timestamp && (Date.now() - cached.timestamp) < 5 * 60 * 1000) {
            setLoading(false);
            return;
          }
        }
      } catch (_) {
        // Ignore cache errors and continue with network fetch
      }
    }

    if (!silent) {
      setLoading(true);
    }
    setError(null);

    try {
      // Get employee details + absences in parallel (avoid sequential waits)
      const [employeeData, employeeAbsences] = await Promise.all([
        getUserById(employeeId),
        absenceService.getEmployeeAbsencesById(employeeId, user, { enrichWithAllowances: false })
      ]);
      if (!employeeData) {
        throw new Error('Employee not found');
      }

      // Compute stats from the same absences payload (removes extra Firestore query)
      const stats = (employeeAbsences || []).reduce((acc, a) => {
        acc.total += 1;
        const s = String(a?.status || '').toLowerCase();
        if (s === 'approved') acc.approved += 1;
        else if (s === 'pending') acc.pending += 1;
        else if (s === 'rejected') acc.rejected += 1;
        return acc;
      }, { total: 0, approved: 0, pending: 0, rejected: 0 });

      setEmployee({
        id: employeeData.id,
        name: employeeData.displayName,
        email: employeeData.email,
        role: employeeData.primaryRole,
        department: employeeData.department || 'N/A',
        hireDate: employeeData.hireDate || '2022-01-01',
        employeeId: employeeData.employeeId || `EMP-${employeeId.slice(-6)}`,
        totalAbsences: stats.total,
        approved: stats.approved,
        pending: stats.pending,
        rejected: stats.rejected
      });

      const nextEmployee = {
        id: employeeData.id,
        name: employeeData.displayName,
        email: employeeData.email,
        role: employeeData.primaryRole,
        department: employeeData.department || 'N/A',
        hireDate: employeeData.hireDate || '2022-01-01',
        employeeId: employeeData.employeeId || `EMP-${employeeId.slice(-6)}`,
        totalAbsences: stats.total,
        approved: stats.approved,
        pending: stats.pending,
        rejected: stats.rejected
      };

      // Handle case where employee has no absences (empty array is fine)
      const nextAbsences = employeeAbsences ? employeeAbsences.map(absence => ({
        ...absence,
        name: employeeData.displayName,
        date: formatDateRange(absence.startDate, absence.endDate),
        dates: `${absence.startDate} to ${absence.endDate}`,
        submittedDate: absence.createdAt?.toDate?.()?.toISOString?.()?.split('T')[0] || absence.createdAt,
        uploadedBy: 'Employee'
      })) : [];

      setEmployee(nextEmployee);
      setAbsences(nextAbsences);

      // Cache for fast revisit (5 min TTL)
      setItem?.(cacheKey, { employee: nextEmployee, absences: nextAbsences, timestamp: Date.now() }, 5 * 60 * 1000);

    } catch (err) {
      console.error('Error loading employee data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Add auto-open logic
  useEffect(() => {
    const autoOpenId = location.state?.autoOpenAbsenceId;
    if (autoOpenId && absences.length > 0) {
      const absenceToOpen = absences.find(a => a.id === autoOpenId);
      if (absenceToOpen) {
        handleViewDetails(absenceToOpen);
        // Clear the state so it doesn't re-open on every re-render
        navigate(location.pathname, { replace: true, state: { ...location.state, autoOpenAbsenceId: null } });
      }
    }
  }, [absences, location.state?.autoOpenAbsenceId, location.pathname, navigate]);

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

  const handleBack = () => {
    navigate('/absences', { state: { activeTab: 'Employee Absences' } });
  };

  const handleViewDetails = async (absence) => {
    // Show modal immediately with existing data
    setSelectedAbsence(absence);
    setShowViewModal(true);

    // Only fetch fresh allowance data if user is a manager and absence has a leave type
    if (['siteManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor', 'teamManager'].includes(user?.role) && absence.leaveType) {
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
  };

  const handleEditAbsence = (absence) => {
    setSelectedAbsence(absence);
    setShowEditModal(true);
  };

  const handleApprove = async (absenceId) => {
    // Optimistically update the absence status
    setAbsences(prev => prev.map(absence =>
      absence.id === absenceId
        ? { ...absence, status: 'Approved' }
        : absence
    ));

    try {
      await absenceService.approveAbsence(absenceId, user);
      setShowViewModal(false);
      toast.success('Absence request approved successfully!');

      // Invalidate company-wide cache and refresh employee data
      if (user?.companyId) {
        setItem?.(`absences_${user.companyId}`, null);
      }
      await loadEmployeeData(true);
    } catch (err) {
      console.error('Error approving absence:', err);
      setError(err.message);
      toast.error('Failed to approve absence request. Please try again.');
      // Revert optimistic update on error - real-time listener will handle this
    }
  };

  const handleDecline = async (absenceId, reason) => {
    // Optimistically update the absence status
    setAbsences(prev => prev.map(absence =>
      absence.id === absenceId
        ? { ...absence, status: 'Rejected', declineReason: reason }
        : absence
    ));

    try {
      await absenceService.declineAbsence(absenceId, reason, user);
      setShowViewModal(false);
      toast.success('Absence request declined successfully!');

      // Invalidate company-wide cache and refresh employee data
      if (user?.companyId) {
        setItem?.(`absences_${user.companyId}`, null);
      }
      await loadEmployeeData(true);
    } catch (err) {
      console.error('Error declining absence:', err);
      setError(err.message);
      toast.error('Failed to decline absence request. Please try again.');
      // Revert optimistic update on error - real-time listener will handle this
    }
  };

  const handleCancel = async (absenceId, cancellationReason) => {
    // Optimistically update the absence status
    setAbsences(prev => prev.map(absence =>
      absence.id === absenceId
        ? {
          ...absence,
          status: 'Cancelled',
          cancellationReason,
          cancelledBy: user.uid,
          cancelledByName: user.displayName,
          cancelledAt: new Date().toISOString()
        }
        : absence
    ));

    try {
      await absenceService.cancelAbsence(absenceId, {
        status: 'Cancelled',
        cancellationReason,
        cancelledBy: user.uid,
        cancelledByName: user.displayName,
        cancelledAt: new Date().toISOString()
      }, user);

      setShowViewModal(false);
      toast.success('Absence cancelled successfully!');
      // Reload data to update stats
      await loadEmployeeData();
    } catch (err) {
      console.error('Error cancelling absence:', err);
      setError(err.message);
      toast.error(err.message || 'Failed to cancel absence. Please try again.');
      // Revert optimistic update on error
      await loadEmployeeData();
    }
  };

  const handleAddAbsence = async (newAbsence) => {
    try {
      await absenceService.createAbsence(newAbsence, employeeId);
      toast.success('Absence request created successfully!', {
        position: "top-center",
        transition: Slide,
        theme: "colored",
        autoClose: 3000
      });
      // Refresh list and stats so the new absence appears without page reload
      await loadEmployeeData(true);
    } catch (err) {
      console.error('Error adding absence:', err);
      setError(err.message);
      toast.error('Failed to create absence request. Please try again.');
    }
  };
  const getLeaveTypeDisplayName = (leaveTypeValue) => {
    const leaveType = LEAVE_TYPES.find(type => type.value === leaveTypeValue);
    return leaveType ? leaveType.label : leaveTypeValue;
  };
  const handleSaveAbsence = async (updatedData) => {
    // Optimistically update the absence
    setAbsences(prev => prev.map(absence =>
      absence.id === selectedAbsence.id
        ? {
          ...absence,
          ...updatedData,
          startDate: updatedData.startingDate || absence.startDate,
          endDate: updatedData.endingDate || absence.endDate,
          date: formatDateRange(updatedData.startingDate || absence.startDate, updatedData.endingDate || absence.endDate)
        }
        : absence
    ));

    try {
      await absenceService.updateAbsence(selectedAbsence.id, updatedData, user);
      toast.success('Absence request updated successfully!', {
        position: "top-center",
        transition: Slide,
        theme: "colored",
        autoClose: 3000
      });
      // Real-time listener will update with confirmed data
    } catch (err) {
      console.error('Error saving absence:', err);
      setError(err.message);
      toast.error('Failed to update absence request. Please try again.');
      // Real-time listener will revert to correct state
    }
  };

  const getStatusVariant = (status) => {
    switch (status?.toLowerCase()) {
      case 'pending':
        return 'warning';
      case 'approved':
        return 'success';
      case 'rejected':
        return 'danger';
      case 'cancelled':
        return 'danger';
      default:
        return 'warning';
    }
  };

  const pretty = (role) =>
    role.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());

  // Filter absences based on search query and status filter
  const filteredAbsences = absences.filter(absence => {
    // Search filter - check leave type and reason
    const matchesSearch = searchQuery === '' ||
      absence.leaveType?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      absence.reason?.toLowerCase().includes(searchQuery.toLowerCase());

    // Status filter
    const matchesStatus = filterStatus === 'All Status' ||
      absence.status?.toLowerCase() === filterStatus.toLowerCase();

    return matchesSearch && matchesStatus;
  });

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
            <span className="text-xl font-bold">Employee Absence Management</span>
          </button>
          <p className="text-sm text-text-secondary -mt-2">Manage employee absence requests</p>

          {/* Loading State */}
          {loading && !employee && absences.length === 0 && (
            <div className="bg-white shadow-md rounded-base p-8 flex items-center justify-center">
              <Loader variant="spinner" size="lg" text="Loading page..." />
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-base p-4 mb-6">
              <p className="text-red-600">Error: {error}</p>
              <button
                onClick={loadEmployeeData}
                className="mt-2 text-red-700 underline hover:no-underline"
              >
                Try again
              </button>
            </div>
          )}

          {/* Employee Info Card */}
          {employee && (
            <div className="bg-white shadow-md rounded-base p-4 md:p-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <img
                    src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${employee.name}`}
                    alt={employee.name}
                    className="w-12 h-12 rounded-full"
                  />
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <h2 className="text-lg font-bold text-text-primary">{employee.name}</h2>
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-sm">
                      <span className="flex items-center gap-1 text-orange-500">
                        <Briefcase className="h-3 w-3" />
                        {employee.department}
                      </span>
                      <span className="flex items-center gap-1 text-blue-500">
                        <Calendar className="h-3 w-3" />
                        Hired: {employee.hireDate}
                      </span>
                      <span className="flex items-center gap-1 text-green-500">
                        <User className="h-3 w-3" />
                        ID: {employee.employeeId}
                      </span>
                    </div>
                  </div>
                </div>
                <Badge variant="info">{employee.role}</Badge>
              </div>
            </div>
          )}

          {/* Stats Cards */}
          {employee && (
            <div className="flex flex-wrap gap-xl">
              <StatCard
                title="Total Absences"
                value={employee.totalAbsences?.toString() || '0'}
                subtitle=""
                icon={<Clock className="h-6 w-6 text-blue-500" />}
                iconBgColor="bg-blue-50"
              />
              <StatCard
                title="Approved"
                value={employee.approved?.toString() || '0'}
                subtitle=""
                icon={<CheckCircle className="h-6 w-6 text-green-500" />}
                iconBgColor="bg-green-50"
              />
              <StatCard
                title="Pending"
                value={employee.pending?.toString() || '0'}
                subtitle=""
                icon={<AlertTriangle className="h-6 w-6 text-orange-500" />}
                iconBgColor="bg-orange-50"
              />
              <StatCard
                title="Rejected"
                value={employee.rejected?.toString() || '0'}
                subtitle=""
                icon={<XCircle className="h-6 w-6 text-red-500" />}
                iconBgColor="bg-red-50"
              />
            </div>
          )}

          {/* Search and Filter */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className='flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full sm:w-auto'>
              <div className="relative w-full sm:w-96">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-text-secondary" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="search by leave type or reason..."
                  className="w-full h-12 pl-12 pr-4 border border-border-secondary rounded-full text-sm placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
                />
              </div>

              <div className="flex items-center gap-3">
                <label htmlFor="filter-status-select" className="text-sm text-text-secondary">Filtered by:</label>
                <select
                  id="filter-status-select"
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="px-4 py-2 border border-border-secondary rounded-lg text-sm focus:outline-none focus:border-border-accent-purple"
                >
                  <option>All Status</option>
                  <option>Pending</option>
                  <option>Approved</option>
                  <option>Rejected</option>
                  <option>Cancelled</option>
                </select>
              </div>
            </div>

            <Button
              variant="gradient"
              icon={Plus}
              onClick={() => setShowAddModal(true)}
            >
              Add Absence
            </Button>
          </div>

          {/* Absences Table */}
          <div className="bg-white border border-border-primary rounded-base">
            <Table>
              <TableHeader>
                <TableHeaderCell>Leave Type</TableHeaderCell>
                <TableHeaderCell>Reason</TableHeaderCell>
                <TableHeaderCell>Date</TableHeaderCell>
                <TableHeaderCell>Duration</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableHeader>
              <TableBody>
                {filteredAbsences.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      <div className="text-text-secondary">
                        {absences.length === 0
                          ? "No absence requests found for this employee."
                          : "No absences match your search criteria."
                        }
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredAbsences.map((absence) => (
                    <TableRow key={absence.id}>
                      <TableCell>
                        <span className="font-semibold text-text-primary">
                          {allowanceService.getLeaveTypeDisplayName(absence.leaveType)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-text-secondary">
                          {absence.reason ? absence.reason.charAt(0).toUpperCase() + absence.reason.slice(1) : 'N/A'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-text-secondary">{absence.date}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-text-secondary">{absence.duration}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusVariant(absence.status)}>
                          {absence.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline-primary"
                            onClick={() => handleViewDetails(absence)}
                            cn="text-xs"
                          >
                            View
                          </Button>
                          {absence.status === 'Pending' && (
                            <Button
                              variant="outline-primary"
                              onClick={() => handleEditAbsence(absence)}
                              cn="text-xs"
                            >
                              Edit
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            <p className="text-xs py-4 text-text-secondary text-center md:hidden">
              ← Scroll horizontally to view all columns →
            </p>
          </div>
        </div>
      </div>

      {/* Modals */}
      <ViewAbsenceModal
        isOpen={showViewModal}
        onClose={() => {
          setShowViewModal(false);
          setSelectedAbsence(null);
        }}
        absence={selectedAbsence}
        onApprove={handleApprove}
        onDecline={handleDecline}
        onCancel={handleCancel}
        currentUser={user}
      />

      <AddAbsenceModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSave={handleAddAbsence}
        userId={employeeId}
      />

      <EditAbsenceModal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setSelectedAbsence(null);
        }}
        absence={selectedAbsence}
        onSave={handleSaveAbsence}
      />
    </div>
  );
};

export default EmployeeAbsencesPage;