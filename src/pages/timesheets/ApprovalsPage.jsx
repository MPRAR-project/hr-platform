import { Calendar, CheckCircle, Clock, Search, User, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import Header from '../../components/layout/Header';
import ApprovalConfirmationModal from '../../components/modals/ApprovalConfirmationModal';
import EditTimesheetModal from '../../components/modals/EditTimesheetModal';
import ViewAbsenceModal from '../../components/modals/ViewAbsenceModal';
import ViewTimesheetModal from '../../components/modals/ViewTimesheetModal';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Tabs from '../../components/ui/Tabs';
import { useAuth } from '../../hooks/useAuth';
import { allowanceService } from '../../services/allowanceService';
import { absenceService } from '../../services/absenceService';
import { approveTimesheet, declineTimesheet, subscribeToCompanyTimesheets } from '../../services/timesheets';
import { approverEmployeeRoleMatch } from '../../services/teams';
import { canApproveTimesheets, getTimesheetEditPermissions } from '../../utils/timesheetPermissions';

const ApprovalsPage = () => {
  const [activeTab, setActiveTab] = useState('Timesheets');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterState, setFilterState] = useState('All States');
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showAbsenceModal, setShowAbsenceModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showDeclineModal, setShowDeclineModal] = useState(false);
  const [timesheets, setTimesheets] = useState([]);
  const [absences, setAbsences] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const { user } = useAuth();

  // Whether the current user is allowed to approve/reject timesheets
  const isApprover = canApproveTimesheets(user?.role || user?.hrRole || user?.primaryRole);

  // ── Timesheets Subscription (REST + WebSocket) ─────────────────────────────
  useEffect(() => {
    if (!user) return;
    const companyId = user.companyId || '';
    if (!companyId) return;

    const unsub = subscribeToCompanyTimesheets(companyId, (data) => {
      const approverRole = user.role || user.primaryRole;
      
      const rows = (data || [])
        .filter(t => t.status === 'submitted') // Backend stores as 'submitted' awaiting manager approval
        .map(t => {
          const emp = t.employee || {};
          const displayName = emp.displayName || `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || t.userId || 'Employee';
          const primaryRole = emp.primaryRole || emp.hrRole || 'employee';

          if (!approverEmployeeRoleMatch(approverRole, primaryRole)) return null;

          // Use normalized totals (seconds → hours)
          const totals       = t.totals || {};
          const totalHours   = Number(t.totalHours || 0);
          const regularHrs   = totals.regularSec  ? +(totals.regularSec  / 3600).toFixed(1) : totalHours;
          const overtimeHrs  = totals.overtimeSec ? +(totals.overtimeSec / 3600).toFixed(1) : 0;

          return {
            id: t.id,
            name: displayName,
            role: primaryRole,
            period: t.period || t.start || t.weekStart,
            dates: t.period || t.start || t.weekStart,
            duration: `${(t.entries || t.timeEntries || []).length} days`,
            leaveType: '-',
            reason: t.adminNotes || '-',
            regular: `${regularHrs}h`,
            overtime: `${overtimeHrs}h`,
            total: `${totalHours}h`,
            status: 'Pending',
            submittedOn: t.submittedAt ? new Date(t.submittedAt).toISOString().slice(0, 10) : '',
            raw: t
          };
        })
        .filter(Boolean);

      setTimesheets(rows);
    });


    return () => unsub();
  }, [user]);

  // ── Absences Subscription (REST + WebSocket) ───────────────────────────────
  useEffect(() => {
    if (!user) return;

    const unsub = absenceService.subscribeToEmployeeAbsences(user, (data) => {
      if (data) {
        const rows = data.filter(a => a.status === 'Pending').map(a => ({
          id: a.id,
          userId: a.userId,
          name: a.employeeName || a.userId,
          role: a.employeeRole || 'Employee',
          period: `${a.startDate} to ${a.endDate}`,
          dates: `${a.startDate} to ${a.endDate}`,
          duration: a.duration,
          leaveType: a.leaveType,
          reason: a.reason || a.notes || '-',
          status: a.status,
          submittedOn: a.createdAt?.slice ? a.createdAt.slice(0, 10) : '',
          raw: a
        }));
        setAbsences(rows);
      }
    });

    return () => unsub();
  }, [user]);

  // Filtering logic
  const filteredTimesheets = timesheets.filter(t => {
    const matchesSearch = !searchQuery || 
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.role.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = filterState === 'All States' || 
      (filterState === 'Pending' && (t.status === 'Pending' || t.status === 'Approved by Team')) ||
      t.status === filterState;

    return matchesSearch && matchesStatus;
  });

  const filteredAbsences = absences.filter(a => {
    const matchesSearch = !searchQuery || 
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.leaveType.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = filterState === 'All States' || a.status === filterState;

    return matchesSearch && matchesStatus;
  });

  // Keep loadTimesheets as a no-op or manual refresh that clears cache?
  // Actually, we can remove it, but if other components call it? No, it was local.
  const loadTimesheets = useCallback(() => {
    // No-op for real-time, or maybe force-check integrity?
    console.log('Manual refresh requested - handled by real-time listener');
  }, []);


  const handleViewDetails = async (item) => {
    if (activeTab === 'Timesheets') {
      setSelectedItem(item);
      setShowDetailsModal(true);
    } else {
      // For absences, show modal immediately with existing data
      setSelectedItem(item);
      setShowAbsenceModal(true);

      // Only fetch fresh allowance data if user is a manager and absence has a leave type
      if (['siteManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor', 'teamManager'].includes(user?.role) && item.leaveType) {
        try {
          const allowanceSummary = await allowanceService.getAllowanceSummary(item.userId, item.leaveType);
          if (allowanceSummary) {
            // Update the selected item with fresh allowance data
            setSelectedItem(prev => ({
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
  };

  const canEditItem = useCallback((item) => {
    return getTimesheetEditPermissions(item?.raw || item, user);
  }, [user]);

  const handleEdit = (item) => {
    if (!canEditItem(item)) {
      console.warn('Current user is not permitted to edit this timesheet.');
      return;
    }
    setSelectedItem(item);
    setShowEditModal(true);
  };

  const handleApproveClick = (item) => {
    setSelectedItem(item);
    setShowApproveModal(true);
  };

  const handleDeclineClick = (item) => {
    setSelectedItem(item);
    setShowDeclineModal(true);
  };

  const handleApproveConfirm = async (id, notes) => {
    try {
      if (!selectedItem) return;
      const itemId = id || selectedItem.id;

      if (activeTab === 'Timesheets') {
        if (!isApprover) {
          toast.error('Only Senior Managers and Site Managers can approve timesheets.');
          return;
        }
        const approverName = user.displayName || user.name || `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Manager';
        await approveTimesheet(itemId, user?.uid || '', notes, approverName);
        toast.success(`✅ Timesheet for ${selectedItem.name} has been approved.`);
      } else {
        await absenceService.approveAbsence(itemId, user);
        toast.success(`✅ Leave request for ${selectedItem.name} has been approved.`);
      }

      setShowApproveModal(false);
      setSelectedItem(null);
    } catch (e) {
      console.error(e);
      toast.error(e.message || 'Failed to approve — please try again.');
    }
  };

  const handleDeclineConfirm = async (id, notes) => {
    try {
      if (!selectedItem) return;
      const itemId = id || selectedItem.id;

      if (activeTab === 'Timesheets') {
        if (!isApprover) {
          toast.error('Only Senior Managers and Site Managers can reject timesheets.');
          return;
        }
        await declineTimesheet(itemId, user?.uid || '', notes);
        toast.success(`Timesheet returned to ${selectedItem.name} for revision.`);
      } else {
        await absenceService.declineAbsence(itemId, notes, user);
        toast.success(`Leave request for ${selectedItem.name} has been declined.`);
      }

      setShowDeclineModal(false);
      setSelectedItem(null);
    } catch (e) {
      console.error(e);
      toast.error(e.message || 'Failed to decline — please try again.');
    }
  };

  const pretty = (role = '') =>
    role.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());

  const renderTimesheetCard = (timesheet) => (
    <div key={timesheet.id} className="bg-white border border-border-accent-purple rounded-lg p-6 space-y-4 hover:shadow-md transition-all">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div className="flex items-center gap-4 flex-1">
          <div className="w-12 h-12 bg-bg-accent-purple-light rounded-full flex items-center justify-center">
            <User className="h-6 w-6 text-text-accent-purple" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-text-primary">{timesheet.name}</h3>
            <p className="text-sm text-text-secondary">{timesheet.period}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Badge variant="info">{timesheet.role}</Badge>
          <Badge variant={timesheet.status === 'Approved' ? 'success' : 'warning'}>
            {timesheet.status}
          </Badge>
          <Button variant="outline-primary" onClick={() => handleViewDetails(timesheet)}>
            View Details
          </Button>
        </div>
      </div>

      {/* Time Details */}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="flex items-center gap-2 text-blue-500">
          <Clock className="h-4 w-4" />
          Regular: {timesheet.regular}
        </span>
        <span className="flex items-center gap-2 text-orange-500">
          <Clock className="h-4 w-4" />
          Overtime: {timesheet.overtime}
        </span>
        <span className="flex items-center gap-2 text-green-500">
          <Clock className="h-4 w-4" />
          Paid Hours: {timesheet.total}
        </span>
      </div>

      {/* Description */}
      <div>
        <p className="text-sm text-text-primary font-medium">{timesheet.reason}</p>
        <p className="text-xs text-text-secondary mt-1">Submitted on {timesheet.submittedOn}</p>
      </div>

      {/* Actions — only shown for users who can approve */}
      {timesheet.status === 'Pending' && isApprover && (
        <div className="flex gap-3 pt-2">
          <Button
            variant="outline-danger"
            icon={XCircle}
            onClick={() => handleDeclineClick(timesheet)}
            className="flex-1"
          >
            Decline
          </Button>
          <Button
            variant="solid-success"
            icon={CheckCircle}
            onClick={() => handleApproveClick(timesheet)}
            className="flex-1"
          >
            Approve
          </Button>
        </div>
      )}
      {timesheet.status === 'Pending' && !isApprover && (
        <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-xs text-amber-700">⚠️ Only Senior Managers and Site Managers can approve or reject timesheets.</p>
        </div>
      )}
    </div>
  );

  const renderLeaveCard = (leave) => (
    <div key={leave.id} className="bg-white border border-border-secondary rounded-lg p-6 space-y-4 hover:bg-bg-secondary transition-colors">
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div className="flex items-center gap-4 flex-1">
          <div className="w-12 h-12 bg-bg-accent-purple-light rounded-full flex items-center justify-center">
            <User className="h-6 w-6 text-text-accent-purple" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-text-primary">{leave.name}</h3>
            <p className="text-sm text-text-secondary">{leave.period}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Badge variant="info">{leave.role}</Badge>
          <Badge variant={leave.status === 'Approved' ? 'success' : 'warning'}>
            {leave.status}
          </Badge>
          <Button variant="outline-primary" onClick={() => handleViewDetails(leave)}>
            View Details
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="flex items-center gap-2 text-blue-500">
          <Calendar className="h-4 w-4" />
          {leave.dates}
        </span>
        <span className="flex items-center gap-2 text-green-500">
          <Clock className="h-4 w-4" />
          {leave.duration}
        </span>
        <span className="px-3 py-1 bg-orange-50 text-orange-600 rounded-full text-xs font-medium">
          {leave.leaveType}
        </span>
      </div>

      <div>
        <p className="text-sm text-text-primary font-medium">{leave.reason}</p>
        <p className="text-xs text-text-secondary mt-1">Submitted on {leave.submittedOn}</p>
      </div>

      {leave.status === 'Pending' && (
        <div className="flex gap-3 pt-2">
          <Button
            variant="outline-danger"
            icon={XCircle}
            onClick={() => handleDeclineClick(leave)}
            className="flex-1"
          >
            Decline
          </Button>
          <Button
            variant="solid-success"
            icon={CheckCircle}
            onClick={() => handleApproveClick(leave)}
            className="flex-1"
          >
            Approve
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Header
        title={`${pretty(user?.role || 'employee')} Dashboard`}
        subtitle="Grow your digital workplace and manage your team seamlessly"
      />

      <div className="flex-1 overflow-y-auto p-4 md:p-3xl scrollbar-custom">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Search and Filter */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
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
              <select
                value={filterState}
                onChange={(e) => setFilterState(e.target.value)}
                className="px-4 py-2 border border-border-secondary rounded-lg text-sm focus:outline-none focus:border-border-accent-purple"
              >
                <option>All States</option>
                <option>Pending</option>
                <option>Approved</option>
                <option>Declined</option>
              </select>
            </div>
          </div>

          {/* Tabs */}
          <Tabs
            tabs={[{ label: 'Timesheets' }, { label: 'Leaves' }]}
            onTabChange={(tab) => setActiveTab(tab)}
          />

          {/* Content */}
          <div className="space-y-4">
            {activeTab === 'Timesheets' && filteredTimesheets.map(renderTimesheetCard)}
            {activeTab === 'Leaves' && filteredAbsences.map(renderLeaveCard)}
            
            {activeTab === 'Timesheets' && filteredTimesheets.length === 0 && (
              <div className="text-center py-12 bg-white rounded-lg border border-dashed border-border-secondary">
                <p className="text-text-secondary">No timesheets found matching your filters.</p>
              </div>
            )}
            {activeTab === 'Leaves' && filteredAbsences.length === 0 && (
              <div className="text-center py-12 bg-white rounded-lg border border-dashed border-border-secondary">
                <p className="text-text-secondary">No leave requests found matching your filters.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* View & Edit Modals */}
      <ViewTimesheetModal
        isOpen={showDetailsModal}
        onClose={() => setShowDetailsModal(false)}
        timesheet={selectedItem}
        onEdit={handleEdit}
        onApprove={handleApproveConfirm}
        isOwnTimesheet={false}
        canEdit={activeTab === 'Timesheets' && canEditItem(selectedItem)}
      />
      <ViewAbsenceModal
        isOpen={showAbsenceModal}
        onClose={() => setShowAbsenceModal(false)}
        absence={selectedItem}
        onApprove={handleApproveConfirm}
        onDecline={handleDeclineConfirm}
        currentUser={user}
      />
      <EditTimesheetModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        onSave={(data) => console.log('Save timesheet:', data)}
        timesheet={selectedItem}
      />

      {/* Approve Modal */}
      <ApprovalConfirmationModal
        isOpen={showApproveModal}
        onClose={() => {
          setShowApproveModal(false);
          setSelectedItem(null);
        }}
        onConfirm={handleApproveConfirm}
        title={activeTab === 'Timesheets' ? 'Approve Timesheet' : 'Approve Leave Request'}
        description={
          activeTab === 'Timesheets'
            ? `Are you sure you want to approve ${selectedItem?.name}'s timesheet? This will finalize their hours and process them for payroll.`
            : `Are you sure you want to approve ${selectedItem?.name}'s leave request? This will grant them time off and adjust their availability.`
        }
        confirmButtonText={activeTab === 'Timesheets' ? 'Approve Timesheet' : 'Approve Leave'}
        cancelButtonText="Cancel"
      >
        {selectedItem && (
          <div className="space-y-4">
            {/* Item Details */}
            <div className="flex items-start justify-between p-3 border border-border-secondary rounded-lg">
              <div className="flex items-start gap-3 flex-1">
                <div className="w-10 h-10 bg-bg-accent-purple-light rounded-full flex items-center justify-center flex-shrink-0">
                  <User className="h-5 w-5 text-text-accent-purple" />
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <span className="text-md font-semibold text-text-primary">
                    {selectedItem.name}
                  </span>
                  <span className="text-xs text-text-secondary">
                    {selectedItem.period}
                  </span>
                  <span className="text-xs text-text-secondary">
                    Submitted: {selectedItem.submittedOn}
                  </span>
                </div>
              </div>
              <Badge variant="info">{selectedItem.role}</Badge>
            </div>

            {/* Details Breakdown */}
            {activeTab === 'Timesheets' ? (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-green-800">Regular Hours:</span>
                  <span className="text-sm font-semibold text-green-800">{selectedItem.regular}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-green-800">Overtime Hours:</span>
                  <span className="text-sm font-semibold text-green-800">{selectedItem.overtime}</span>
                </div>
                <div className="border-t border-green-300 pt-2 flex justify-between items-center">
                  <span className="text-sm font-bold text-green-900">Paid Hours:</span>
                  <span className="text-lg font-bold text-green-900">{selectedItem.total}</span>
                </div>
              </div>
            ) : (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-green-800">Leave Type:</span>
                  <span className="text-sm font-semibold text-green-800">{selectedItem.leaveType}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-green-800">Dates:</span>
                  <span className="text-sm font-semibold text-green-800">{selectedItem.dates}</span>
                </div>
                <div className="border-t border-green-300 pt-2 flex justify-between items-center">
                  <span className="text-sm font-bold text-green-900">Duration:</span>
                  <span className="text-lg font-bold text-green-900">{selectedItem.duration}</span>
                </div>
              </div>
            )}

            {/* Reason */}
            {selectedItem.reason && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <p className="text-xs font-semibold text-gray-700 mb-1">Reason:</p>
                <p className="text-sm text-gray-600">{selectedItem.reason}</p>
              </div>
            )}
          </div>
        )}
      </ApprovalConfirmationModal>

      {/* Decline Modal */}
      <ApprovalConfirmationModal
        isOpen={showDeclineModal}
        onClose={() => {
          setShowDeclineModal(false);
          setSelectedItem(null);
        }}
        onConfirm={handleDeclineConfirm}
        title={activeTab === 'Timesheets' ? 'Decline Timesheet' : 'Decline Leave Request'}
        description={
          activeTab === 'Timesheets'
            ? `Are you sure you want to decline ${selectedItem?.name}'s timesheet? This will notify the employee that their submission was rejected.`
            : `Are you sure you want to decline ${selectedItem?.name}'s leave request? This will notify the employee that their time off was not approved.`
        }
        confirmButtonText={activeTab === 'Timesheets' ? 'Decline Timesheet' : 'Decline Leave'}
        cancelButtonText="Cancel"
        type="decline"
        requireReason={false}
        item={selectedItem}
      />
    </div>
  );
};

export default ApprovalsPage;