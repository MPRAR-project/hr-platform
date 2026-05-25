import { AlertTriangle, ArrowLeft, Calendar, CheckCircle, Clock, Search, User, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, useDeferredValue } from 'react';
import { parseLocalDate } from '../../utils/weekStartUtils';

import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import Header from '../../components/layout/Header';
import ApprovalConfirmationModal from '../../components/modals/ApprovalConfirmationModal';
import DeleteConfirmationModal from '../../components/modals/DeleteConfirmationModal';
import EditTimesheetModal from '../../components/modals/EditTimesheetModal';
import ViewTimesheetModal from '../../components/modals/ViewTimesheetModal';
import StatCard from '../../components/shared/StatCard';
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '../../components/shared/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Loader from '../../components/ui/Loader';
import { useAuth } from '../../hooks/useAuth';
import { useEmployeeTimesheets } from '../../hooks/useEmployeeTimesheets';
import { usePerformanceMonitor, measureAsync } from '../../hooks/usePerformanceMonitor';
import { formatTimeDisplay } from '../../utils/numberFormatter';
import { canApproveTimesheets, canEditTargetTimesheet, getTimesheetEditPermissions, normalizeUserId } from '../../utils/timesheetPermissions';
import { getRoleName } from '../../utils/getRoleName';
import { getUserById } from '../../services/users';
import { approveTimesheet, declineTimesheet } from '../../services/timesheets';



const EmployeeTimesheetsPage = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { user } = useAuth();
  const { trackOperation } = usePerformanceMonitor('EmployeeTimesheetsPage');
  const normalizedEmployeeId = useMemo(() => normalizeUserId(id), [id]);
  const canEditEmployeeTimesheets = useMemo(
    () => canEditTargetTimesheet(user?.role, user?.uid, normalizedEmployeeId),
    [user?.role, user?.uid, normalizedEmployeeId]
  );
  // Whether the current user can approve or reject this timesheet
  const isApprover = useMemo(
    () => canApproveTimesheets(user?.role || user?.hrRole || user?.primaryRole),
    [user?.role, user?.hrRole, user?.primaryRole]
  );


  // Use real-time Firestore listeners (no async fetching)
  const {
    data: employeeTimesheets,
    loading: timesheetsLoading,
    error: timesheetsError,
    lastUpdate
  } = useEmployeeTimesheets(id, {
    maxWeeks: 26 // Reduced from 52 to improve initial load time
  });

  // State management
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('All Status');
  const [showViewModal, setShowViewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showDeclineModal, setShowDeclineModal] = useState(false);
  const [selectedTimesheet, setSelectedTimesheet] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [isLoadingEmployee, setIsLoadingEmployee] = useState(true);
  const [employeeError, setEmployeeError] = useState(null);

  const handleRefresh = useCallback(() => {
    window.location.reload();
  }, []);

  // Debounced search effect
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300); // 300ms debounce

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Transform optimized timesheet data for display
  const timesheets = useMemo(() => {
    if (!employeeTimesheets || !employee) return [];

    return employeeTimesheets.map(w => {
      const effSec = w.totals?.effectiveSec || 0;
      const otSec = w.totals?.overtimeSec || 0;
      const regularSec = Math.max(0, effSec - otSec);

      const fmtHm = formatTimeDisplay;

      const startDate = parseLocalDate(w.start);
      const endDate = parseLocalDate(w.end);

      return {
        id: w.weekKey,
        name: employee.name,
        period: `${startDate.getFullYear()}, ${startDate.toLocaleDateString('en-US', { month: 'long' })} ${startDate.getDate()}-${endDate.getDate()}`,
        weekStart: w.start,
        weekEnd: w.end,
        userId: employee.id,
        regular: fmtHm(regularSec),
        overtime: fmtHm(otSec),
        total: fmtHm(effSec),
        reason: w.adminNotes || 'Regular work week',
        status: w.status,
        submittedOn: w.submitted || '—',
        approvedBy: w.approvedBy || null,
        approvedByName: w.approvedByName || null,
        approvedAt: w.approvedAt || null,
        docIds: w.docIds || [],
        totals: w.totals,
        raw: w
      };
    });
  }, [employeeTimesheets, employee]);

  // Derived filtered list for search + status filter
  const filteredTimesheets = useMemo(() => {
    const q = (debouncedSearchQuery || '').toLowerCase().trim();
    const statusFilter = (filterStatus || 'All Status').toLowerCase();
    return (timesheets || []).filter(ts => {
      const matchesQuery = !q
        || (ts.period || '').toLowerCase().includes(q)
        || (ts.submittedOn || '').toLowerCase?.()?.includes?.(q)
        || (ts.total || '').toLowerCase?.()?.includes?.(q)
        || (ts.overtime || '').toLowerCase?.()?.includes?.(q)
        || (ts.regular || '').toLowerCase?.()?.includes?.(q);
      const normalizedStatus = String(ts.status || '').toLowerCase();
      const matchesStatus = statusFilter === 'all status'
        || normalizedStatus === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [timesheets, debouncedSearchQuery, filterStatus]);

  const sortedTimesheets = useMemo(() => {
    return [...filteredTimesheets].sort((a, b) => {
      // Get week start dates for week-based sorting
      const weekStartA = a.raw?.start || a.weekStart;
      const weekStartB = b.raw?.start || b.weekStart;
      
      const dateA = weekStartA instanceof Date ? weekStartA : new Date(weekStartA || 0);
      const dateB = weekStartB instanceof Date ? weekStartB : new Date(weekStartB || 0);
      
      // Sort by week start date (newest weeks first - bigger weeks first)
      return dateB.getTime() - dateA.getTime();
    });
  }, [filteredTimesheets]);

  // Calculate employee stats from timesheets
  const employeeStats = useMemo(() => {
    if (!timesheets.length) {
      return { totalTimesheets: 0, approved: 0, pending: 0, rejected: 0, draft: 0 };
    }

    const normalizeStatus = (rawStatus) => {
      const status = String(rawStatus || 'draft').toLowerCase();
      if (status === 'approved') return 'approved';
      if (status === 'rejected') return 'rejected';
      if (status === 'pending' || status === 'approved-by-team' || status === 'submitted') return 'pending';
      return 'draft';
    };

    const stats = timesheets.reduce((acc, ts) => {
      acc.totalTimesheets++;
      const status = normalizeStatus(ts.status);
      if (status === 'approved') acc.approved++;
      else if (status === 'pending') acc.pending++;
      else if (status === 'rejected') acc.rejected++;
      else acc.draft++;
      return acc;
    }, { totalTimesheets: 0, approved: 0, pending: 0, rejected: 0, draft: 0 });

    return stats;
  }, [timesheets]);

  // Fetch employee data with caching and performance optimization
  useEffect(() => {
    const loadEmployeeData = async () => {
      if (!id) return;

      const startTime = Date.now();
      setIsLoadingEmployee(true);
      setEmployeeError(null);

      try {
        await measureAsync('loadEmployeeData', async () => {
          // Check cache first
          const cacheKey = `employee_${id}`;
          const cachedData = sessionStorage.getItem(cacheKey);

          if (cachedData) {
            const { data, timestamp } = JSON.parse(cachedData);
            const cacheAge = Date.now() - timestamp;

            // Use cache if less than 5 minutes old
            if (cacheAge < 300000) {
              setEmployee(data);
              return;
            }
          }

          // Fetch fresh data
          const userData = await getUserById(id);
          if (!userData) {
            throw new Error('Employee not found');
          }

          const employeeData = {
            id: id,
            name: userData.displayName || `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || userData.email,
            email: userData.email,
            role: getRoleName(userData.primaryRole || userData.hrRole),
            department: userData.teamId || '—',
            hireDate: userData.createdAt ? new Date(userData.createdAt).toLocaleDateString() : '—',
            employeeId: userData.employeeId || '—'
          };

          // Cache the data
          sessionStorage.setItem(cacheKey, JSON.stringify({
            data: employeeData,
            timestamp: Date.now()
          }));

          setEmployee(employeeData);
        });

        trackOperation('loadEmployeeData', startTime);
      } catch (error) {
        console.error('Failed to load employee data:', error);
        setEmployeeError(error);
      } finally {
        setIsLoadingEmployee(false);
      }
    };

    loadEmployeeData();
  }, [id]);

  const handleBack = () => {
    navigate('/timesheets', { state: { activeTab: 'All Timesheets' } });
  };

  const handleViewDetails = (timesheet) => {
    setSelectedTimesheet(timesheet);
    setShowViewModal(true);
  };

  const handleEdit = (timesheet) => {
    if (!getTimesheetEditPermissions(timesheet, user)) {
      console.warn('Current user is not permitted to edit this timesheet.');
      return;
    }
    setSelectedTimesheet(timesheet);
    setShowViewModal(false);
    setShowEditModal(true);
  };

  const handleApproveClick = (timesheet) => {
    setSelectedTimesheet(timesheet);
    setShowApproveModal(true);
  };

  const handleDeclineClick = (timesheet) => {
    setSelectedTimesheet(timesheet);
    setShowDeclineModal(true);
  };

  const handleApproveConfirm = async () => {
    if (!selectedTimesheet?.id) return;
    if (!isApprover) {
      toast.error('Only Senior Managers and Site Managers can approve timesheets.');
      setShowApproveModal(false);
      return;
    }

    const startTime = Date.now();
    try {
      await measureAsync('approveTimesheet', async () => {
        const approverName = user.firstName && user.lastName
          ? `${user.firstName} ${user.lastName}`
          : user.displayName || user.name || 'Manager';
        await approveTimesheet(selectedTimesheet.id, user.userId || user.uid, approverName);
      });
      toast.success(`✅ Timesheet approved successfully.`);
      trackOperation('approveTimesheet', startTime);
    } catch (e) {
      console.error('Approve failed:', e);
      toast.error(e?.message || 'Failed to approve timesheet — please try again.');
    } finally {
      setShowApproveModal(false);
      setSelectedTimesheet(null);
    }
  };

  const handleDeclineConfirm = async () => {
    if (!selectedTimesheet?.id) return;
    if (!isApprover) {
      toast.error('Only Senior Managers and Site Managers can reject timesheets.');
      setShowDeclineModal(false);
      return;
    }

    const startTime = Date.now();
    try {
      await measureAsync('declineTimesheet', async () => {
        await declineTimesheet(selectedTimesheet.id, 'Returned by manager', user.userId || user.uid);
      });
      toast.success('Timesheet returned to employee for revision.');
      trackOperation('declineTimesheet', startTime);
    } catch (e) {
      console.error('Decline failed:', e);
      toast.error(e?.message || 'Failed to return timesheet — please try again.');
    } finally {
      setShowDeclineModal(false);
      setSelectedTimesheet(null);
    }
  };

  const handleSaveEdit = (updatedData) => {
    const startTime = Date.now();
    console.log('Saving timesheet:', updatedData);

    // Real-time listeners will automatically update UI - no manual refresh needed

    trackOperation('saveEdit', startTime);
  };

  const getStatusVariant = (status) => {
    switch (status.toLowerCase()) {
      case 'pending':
        return 'warning';
      case 'approved':
        return 'success';
      case 'rejected':
        return 'danger';
      case 'draft':
        return 'info';
      default:
        return 'warning';
    }
  };



  const pretty = (role = '') =>
    role.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());

  return (
    <div className="h-screen flex flex-col overflow-hidden">

      <Header
        title={`${pretty(user?.role || 'employee')} Dashboard`}
        subtitle="Ensure compliance and manage onboarding from one place."
      />

      <main className="flex-1 overflow-y-auto p-4 md:p-3xl scrollbar-custom">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Loading State */}
          {isLoadingEmployee ? (
            <div className="flex items-center justify-center h-40">
              <Loader variant="spinner" size="lg" text="Loading page..." />
            </div>
          ) : employeeError ? (
            <div className="text-center py-8">
              <p className="text-red-500">Error: {employeeError.message}</p>
              <Button onClick={() => window.location.reload()} className="mt-4">
                Retry
              </Button>
            </div>
          ) : !employee ? (
            <div className="text-center py-8">
              <p className="text-text-secondary">Employee not found</p>
            </div>
          ) : (
            <>
              {/* Back Button and Header */}
              <div className="flex sm:flex-row flex-col sm:items-center justify-between mb-4">
                <div>
                  <button
                    onClick={handleBack}
                    aria-label="Back to Timesheet Management"
                    className="flex items-center gap-2 text-text-primary hover:text-text-accent-purple transition-colors"
                  >
                    <ArrowLeft className="h-5 w-5" />
                    <span className="text-xl text-start font-bold">Employee Timesheet Management</span>
                  </button>
                  <p className="text-sm text-text-secondary mt-1">Manage employee timesheet submissions</p>
                </div>

                <div className="flex sm:flex-row flex-col  sm:items-center gap-3">
                  {lastUpdate && (
                    <span className="text-xs text-text-secondary">
                      Last updated: {lastUpdate.toLocaleTimeString()}
                    </span>
                  )}
                  {/* Real-time updates - no manual refresh needed */}
                </div>
              </div>

              {/* Error State for Timesheets */}
              {timesheetsError && (
                <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg mb-6">
                  <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-red-800">Failed to load timesheet data</p>
                    <p className="text-xs text-red-600">{timesheetsError.message}</p>
                  </div>
                  <Button
                    variant="outline-danger"
                    onClick={handleRefresh}
                    className="ml-auto"
                  >
                    Retry
                  </Button>
                </div>
              )}

              {/* Employee Info Card */}
              <div className="bg-white shadow-md rounded-base p-4 md:p-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <img
                      src="https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah"
                      alt={employee.name}
                      width="48"
                      height="48"
                      className="w-12 h-12 rounded-full"
                    />
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <h2 className="text-lg font-bold text-text-primary">{employee.name}</h2>
                      </div>
                      <div className="flex flex-wrap items-center gap-4 text-sm">
                        {/* <span className="flex items-center gap-1 text-orange-500">
                          <Briefcase className="h-3 w-3" />
                          {employee.department}
                        </span> */}
                        <span className="flex items-center gap-1 text-blue-700">
                          <Calendar className="h-3 w-3" aria-hidden="true" />
                          Hired: {employee.hireDate}
                        </span>
                        <span className="flex items-center gap-1 text-green-700">
                          <User className="h-3 w-3" aria-hidden="true" />
                          ID: {employee.id.slice(0, 8)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <Badge variant="info">{employee.role}</Badge>
                </div>
              </div>

              {/* Stats Cards */}
              {/* <BackfillControl /> */}
              <div className="flex flex-wrap gap-xl">
                <StatCard
                  title="Total Timesheets"
                  value={employeeStats.totalTimesheets.toString()}
                  subtitle=""
                  icon={<Clock className="h-6 w-6 text-blue-500" />}
                  iconBgColor="bg-blue-50"
                />
                <StatCard
                  title="Approved"
                  value={employeeStats.approved.toString()}
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
                  title="Draft"
                  value={employeeStats.draft.toString()}
                  subtitle=""
                  icon={<Clock className="h-6 w-6 text-gray-500" />}
                  iconBgColor="bg-gray-50"
                />
                <StatCard
                  title="Rejected"
                  value={employeeStats.rejected.toString()}
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
                      id="timesheet-detail-search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="search by week or period..."
                      aria-label="Search timesheets by week or period"
                      className="w-full h-12 pl-12 pr-4 border border-border-secondary rounded-full text-sm placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
                    />
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-sm text-text-secondary">Filtered by:</span>
                    <select
                      id="timesheet-status-filter"
                      value={filterStatus}
                      onChange={(e) => setFilterStatus(e.target.value)}
                      className="px-4 py-2 border border-border-secondary rounded-lg text-sm focus:outline-none focus:border-border-accent-purple"
                    >
                      <option>All Status</option>
                      <option>Pending</option>
                      <option>Approved</option>
                      <option>Rejected</option>
                      <option>Draft</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Timesheets Table */}
              <div className="bg-white border border-border-primary rounded-base">
                {timesheetsLoading ? (
                  <div className="flex items-center justify-center h-40 p-6">
                    <Loader variant="pulse" size="md" text="Fetching employee data..." />
                  </div>
                ) : filteredTimesheets.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-text-secondary">
                      {timesheets.length === 0 ? 'No timesheet data available' : 'No timesheets match your search criteria'}
                    </p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableHeaderCell>Period</TableHeaderCell>
                      <TableHeaderCell>Regular Hours</TableHeaderCell>
                      <TableHeaderCell>Overtime</TableHeaderCell>
                      <TableHeaderCell>Paid Hours</TableHeaderCell>
                      <TableHeaderCell>Status</TableHeaderCell>
                      <TableHeaderCell>Actions</TableHeaderCell>
                    </TableHeader>
                    <TableBody>
                      {sortedTimesheets.map((timesheet) => (
                        <TableRow key={timesheet.id}>
                          <TableCell>
                            <div>
                              <span className="font-semibold text-text-primary block">{timesheet.period}</span>
                              <span className="text-xs text-text-secondary">Submitted: {timesheet.submittedOn}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="text-blue-600 font-semibold">{timesheet.regular}</span>
                          </TableCell>
                          <TableCell>
                            <span className="text-orange-600 font-semibold">{timesheet.overtime}</span>
                          </TableCell>
                          <TableCell>
                            <span className="text-green-600 font-bold">{timesheet.total}</span>
                          </TableCell>
                          <TableCell>
                            <Badge variant={getStatusVariant(timesheet.status)}>
                              {timesheet.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2 flex-wrap">
                              <Button
                                variant="outline-primary"
                                onClick={() => handleViewDetails(timesheet)}
                                cn="text-xs"
                              >
                                View
                              </Button>
                              {(timesheet.status || '').toLowerCase() === 'pending' && canEditEmployeeTimesheets && (
                                <>
                                  <Button
                                    variant="outline-danger"
                                    onClick={() => handleDeclineClick(timesheet)}
                                    cn="text-xs"
                                  >
                                    Decline
                                  </Button>
                                  <Button
                                    variant="solid-success"
                                    onClick={() => handleApproveClick(timesheet)}
                                    cn="text-xs"
                                  >
                                    Approve
                                  </Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                <p className="text-xs py-4 text-text-secondary text-center md:hidden">
                  ← Scroll horizontally to view all columns →
                </p>
              </div>
            </>
          )}
        </div>
      </main>

      {/* Modals */}
      {employee && (
        <>
          <ViewTimesheetModal
            isOpen={showViewModal}
            onClose={() => {
              setShowViewModal(false);
              setSelectedTimesheet(null);
            }}
            timesheet={selectedTimesheet}
            onEdit={handleEdit}
            onApprove={handleApproveConfirm}
            onDecline={handleDeclineConfirm}
            isOwnTimesheet={false}
            fallbackUserId={employee?.id}
            canEdit={getTimesheetEditPermissions(selectedTimesheet, user)}
          />

          <EditTimesheetModal
            isOpen={showEditModal}
            onClose={() => {
              setShowEditModal(false);
              setSelectedTimesheet(null);
            }}
            onSave={handleSaveEdit}
            timesheet={selectedTimesheet}
          />

          {/* Approve Modal */}
          <ApprovalConfirmationModal
            isOpen={showApproveModal}
            onClose={() => {
              setShowApproveModal(false);
              setSelectedTimesheet(null);
            }}
            onConfirm={handleApproveConfirm}
            title="Approve Timesheet"
            description={`Are you sure you want to approve ${employee?.name || ''}'s timesheet for ${selectedTimesheet?.period || ''}? This will finalize their hours and process them for payroll.`}
            confirmButtonText="Approve Timesheet"
            cancelButtonText="Cancel"
          >
            {selectedTimesheet && (
              <div className="space-y-4">
                <div className="flex items-start justify-between p-3 border border-border-secondary rounded-lg">
                  <div className="flex items-start gap-3 flex-1">
                    <div className="w-10 h-10 bg-bg-accent-purple-light rounded-full flex items-center justify-center flex-shrink-0">
                      <User className="h-5 w-5 text-text-accent-purple" />
                    </div>
                    <div className="flex flex-col gap-1 flex-1">
                      <span className="text-md font-semibold text-text-primary">
                        {selectedTimesheet.period}
                      </span>
                      <span className="text-xs text-text-secondary">
                        Employee: {employee?.name || ''}
                      </span>
                      <span className="text-xs text-text-secondary">
                        Submitted: {selectedTimesheet.submittedOn}
                      </span>
                    </div>
                  </div>
                  <Badge variant="warning">{selectedTimesheet.status}</Badge>
                </div>

                <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-green-800">Regular Hours:</span>
                    <span className="text-sm font-semibold text-green-800">{selectedTimesheet.regular}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-green-800">Overtime Hours:</span>
                    <span className="text-sm font-semibold text-green-800">{selectedTimesheet.overtime}</span>
                  </div>
                  <div className="border-t border-green-300 pt-2 flex justify-between items-center">
                    <span className="text-sm font-bold text-green-900">Paid Hours:</span>
                    <span className="text-lg font-bold text-green-900">{selectedTimesheet.total}</span>
                  </div>
                </div>

                {selectedTimesheet.reason && (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <p className="text-xs font-semibold text-gray-700 mb-1">Notes:</p>
                    <p className="text-sm text-gray-600">{selectedTimesheet.reason}</p>
                  </div>
                )}
              </div>
            )}
          </ApprovalConfirmationModal>

          {/* Decline Modal */}
          <DeleteConfirmationModal
            isOpen={showDeclineModal}
            onClose={() => {
              setShowDeclineModal(false);
              setSelectedTimesheet(null);
            }}
            onConfirm={handleDeclineConfirm}
            title="Decline Timesheet"
            description={`Are you sure you want to decline ${employee?.name || ''}'s timesheet for ${selectedTimesheet?.period || ''}?`}
            warningMessage="Declining this timesheet will notify the employee that their submission was rejected. They will need to resubmit their hours with corrections."
            confirmButtonText="Decline Timesheet"
            cancelButtonText="Cancel"
            itemDetails={
              selectedTimesheet
                ? {
                  name: selectedTimesheet.period,
                  subtitle: selectedTimesheet.reason,
                  email: `Submitted: ${selectedTimesheet.submittedOn}`,
                  badge: `${selectedTimesheet.total} Total Hours`
                }
                : null
            }
            variant="danger"
          />
        </>
      )}
    </div>
  );
};

export default EmployeeTimesheetsPage;