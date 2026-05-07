import React, { useState, useEffect } from 'react';
import { Calendar, ChevronDown, ArrowRight, Trash2 } from 'lucide-react';
import Header from '../../components/layout/Header';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import SectionContainer from '../../components/shared/SectionContainer';
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '../../components/shared/Table';
import { useAuth } from '../../hooks/useAuth';
import { absenceService } from '../../services/absenceService';
import { allowanceService } from '../../services/allowanceService';
import { automaticAllowanceService } from '../../services/automaticAllowanceService';
import { EMPLOYEE_LEAVE_TYPES, DEFAULT_LEAVE_TYPE, LEAVE_TYPES } from '../../constants/leaveTypes';
import { toast, Slide } from 'react-toastify';


const MyAbsencesPage = () => {
  const [formData, setFormData] = useState({
    startingDate: '',
    endingDate: '',
    leaveType: DEFAULT_LEAVE_TYPE,
    reason: ''
  });
  const { user } = useAuth();
  const [absencesHistory, setAbsencesHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [allowanceInfo, setAllowanceInfo] = useState(null);
  const [autoApprovalPreview, setAutoApprovalPreview] = useState(null);
  const allowanceUnsubRef = React.useRef(null);

  // Load user's absences on component mount
  const absenceUnsubRef = React.useRef(null);

  useEffect(() => {
    if (user) {
      automaticAllowanceService.ensureEmployeeAllowances(user.userId, user)
        .catch(() => null);

      if (absenceUnsubRef.current) {
        absenceUnsubRef.current();
      }

      setLoading(true);
      absenceUnsubRef.current = absenceService.subscribeToUserAbsences(user.userId, (absences, err) => {
        if (err) {
          console.error('Error in absences subscription:', err);
          setError(err.message);
        } else {
          setAbsencesHistory(absences.map(absence => ({
            ...absence,
            date: formatDateRange(absence.startDate, absence.endDate)
          })));
        }
        setLoading(false);
      });
    }

    return () => {
      if (absenceUnsubRef.current) {
        absenceUnsubRef.current();
      }
    };
  }, [user]);

  // Subscription for allowance summary
  useEffect(() => {
    if (!user || !formData.leaveType) return;

    if (allowanceUnsubRef.current) {
      allowanceUnsubRef.current();
    }

    allowanceUnsubRef.current = allowanceService.subscribeToEmployeeAllowances(
      user.userId,
      user,
      new Date().getFullYear(),
      (allowances) => {
        const normTarget = allowanceService.normalizeLeaveType(formData.leaveType);
        const match = allowances.find(a => allowanceService.normalizeLeaveType(a.leaveType) === normTarget);
        setAllowanceInfo(match || null);
      }
    );

    return () => {
      if (allowanceUnsubRef.current) {
        allowanceUnsubRef.current();
      }
    };
  }, [user, formData.leaveType]);

  const loadAbsences = () => {
    // This is now handled by the subscription, but kept as a no-op if called elsewhere
  };

  // Check auto-approval when form data changes
  useEffect(() => {
    checkAutoApprovalPreview();
  }, [formData.leaveType, formData.startingDate, formData.endingDate, user, allowanceInfo]);

  const checkAutoApprovalPreview = async () => {
    if (!user || !formData.leaveType || !formData.startingDate || !formData.endingDate) {
      setAutoApprovalPreview(null);
      return;
    }

    try {
      // Calculate duration
      const startDate = new Date(formData.startingDate);
      const endDate = new Date(formData.endingDate);
      const durationMs = endDate.getTime() - startDate.getTime();
      const durationDays = Math.ceil(durationMs / (1000 * 60 * 60 * 24)) + 1;

      if (durationDays <= 0) {
        setAutoApprovalPreview(null);
        return;
      }

      // Business rule: only Sick Leave can be auto-approved.
      // Keep allowance information for display, but force manual approval for other types.
      const allowanceCheckRaw = await allowanceService.checkAutoApproval(user.userId, formData.leaveType, durationDays);
      const isSickLeave = formData.leaveType === 'sick_leave';
      const allowanceCheck = isSickLeave
        ? allowanceCheckRaw
        : { ...allowanceCheckRaw, canAutoApprove: false, reason: 'Manual approval required' };

      setAutoApprovalPreview({
        ...allowanceCheck,
        durationDays,
        currentAllowance: allowanceInfo
      });

    } catch (error) {
      console.error('Error checking auto-approval preview:', error);
      setAutoApprovalPreview(null);
    }
  };

  const formatDateRange = (startDate, endDate) => {
    if (!startDate || !endDate) return 'N/A';

    const start = new Date(startDate);
    const end = new Date(endDate);

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



  const handleDelete = async (absenceId) => {
    if (!window.confirm('Are you sure you want to delete this absence request?')) return;

    try {
      await absenceService.deleteAbsence(absenceId, user);
      toast.success('Absence request deleted');
      loadAbsences();
    } catch (err) {
      console.error('Error deleting absence:', err);
      toast.error(err.message || 'Failed to delete absence');
    }
  };

  const handleSubmit = async () => {
    if (!formData.startingDate || !formData.endingDate || !formData.reason.trim()) {
      setError('Please fill in all required fields');
      return;
    }

    if (new Date(formData.startingDate) > new Date(formData.endingDate)) {
      setError('End date must be after start date');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await absenceService.createAbsence(formData, user.userId);

      // Reset form
      setFormData({
        startingDate: '',
        endingDate: '',
        leaveType: DEFAULT_LEAVE_TYPE,
        reason: ''
      });

      // Show success toast with custom style for holiday requests
      toast.success('Absence request submitted successfully!', {
        position: "top-center",
        transition: Slide,
        theme: "colored",
        autoClose: 3000
      });

      // Reload absences to show the new one
      loadAbsences();

    } catch (err) {
      console.error('Error submitting absence:', err);
      setError(err.message);
    } finally {
      setSubmitting(false);
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

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Header
        title={`${pretty(user.role)} Dashboard`}
        subtitle="Ensure compliance and manage onboarding from one place."
      />

      <div className="flex-1 overflow-y-auto p-3xl space-y-3xl scrollbar-custom">
        {/* Absences Form Section */}
        <SectionContainer
          title="Absences"
          subtitle="Select your leave dates and provide details"
        >
          <div className="p-4xl space-y-3xl">
            {/* Date Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3xl">
              <div>
                <label htmlFor="starting-date" className="block text-md font-medium text-text-primary mb-md">
                  Start Date
                </label>
                <div className="relative">
                  <input
                    id="starting-date"
                    type="date"
                    value={formData.startingDate}
                    onChange={(e) => setFormData({ ...formData, startingDate: e.target.value })}
                    className="w-full h-12 px-base border border-border-secondary rounded-lg text-md focus:outline-none focus:border-border-accent-purple"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="ending-date" className="block text-md font-medium text-text-primary mb-md">
                  End Date
                </label>
                <div className="relative">
                  <input
                    id="ending-date"
                    type="date"
                    value={formData.endingDate}
                    onChange={(e) => setFormData({ ...formData, endingDate: e.target.value })}
                    className="w-full h-12 px-base border border-border-secondary rounded-lg text-md focus:outline-none focus:border-border-accent-purple"
                  />
                </div>
              </div>
            </div>
            {/* Leave Type */}
            <div>
              <label htmlFor="leave-type-select" className="block text-md font-medium text-text-primary mb-md">
                Leave Type
              </label>
              <div className="relative">
                <select
                  id="leave-type-select"
                  value={formData.leaveType}
                  onChange={(e) => setFormData({ ...formData, leaveType: e.target.value })}
                  className="w-full h-12 px-base pr-10 border border-border-secondary rounded-lg text-md appearance-none focus:outline-none focus:border-border-accent-purple"
                >
                  {LEAVE_TYPES.map(type => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-base top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
              </div>
            </div>

            {/* Reason */}
            <div>
              <label className="block text-md font-medium text-text-primary mb-md">
                Reason
              </label>
              <textarea
                placeholder="Brief describe your Absences..."
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                rows={4}
                className="w-full px-base py-md border border-border-secondary rounded-lg text-md focus:outline-none focus:border-border-accent-purple resize-none"
              />
            </div>

            {/* Auto-Approval Preview */}
            {autoApprovalPreview && (
              <div className={`p-4 rounded-lg border ${autoApprovalPreview.canAutoApprove
                ? 'bg-green-50 border-green-200'
                : 'bg-orange-50 border-orange-200'
                }`}>
                <div className="flex items-start gap-3">
                  <div className={`w-2 h-2 rounded-full mt-2 ${autoApprovalPreview.canAutoApprove ? 'bg-green-500' : 'bg-orange-500'
                    }`}></div>
                  <div className="flex-1">
                    <h4 className={`font-semibold text-sm ${autoApprovalPreview.canAutoApprove ? 'text-green-800' : 'text-orange-800'
                      }`}>
                      {autoApprovalPreview.canAutoApprove ? 'Auto-Approval Available' : 'Manual Approval Required'}
                    </h4>
                    <p className={`text-xs mt-1 ${autoApprovalPreview.canAutoApprove ? 'text-green-700' : 'text-orange-700'
                      }`}>
                      {autoApprovalPreview.reason}
                    </p>

                    {autoApprovalPreview.currentAllowance && (
                      <div className="mt-2 text-xs">
                        <div className={`${autoApprovalPreview.canAutoApprove ? 'text-green-600' : 'text-orange-600'
                          }`}>
                          <strong>Your {formData.leaveType} Allowance:</strong>
                        </div>
                        <div className="mt-1 grid grid-cols-3 gap-2 text-xs">
                          <span>Total: {autoApprovalPreview.currentAllowance.totalDays} days</span>
                          <span>Used: {autoApprovalPreview.currentAllowance.usedDays} days</span>
                          <span>Remaining: {autoApprovalPreview.currentAllowance.remainingDays} days</span>
                        </div>
                        <div className="mt-1 text-xs">
                          <span>Requesting: {autoApprovalPreview.durationDays} days</span>
                          {autoApprovalPreview.wouldRemain !== undefined && (
                            <span className="ml-2">
                              → Would leave: <strong className={
                                autoApprovalPreview.wouldRemain >= 0 ? 'text-green-600' : 'text-red-600'
                              }>{autoApprovalPreview.wouldRemain} days</strong>
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-600 text-sm">
                {error}
              </div>
            )}

            {/* Submit Button */}
            <div className="flex justify-end">
              <Button
                variant="gradient"
                icon={ArrowRight}
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? 'Submitting...' : 'Submit Request'}
              </Button>
            </div>
          </div>
        </SectionContainer>

        {/* Absences History Section */}
        <SectionContainer title="Absences History">
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500 mx-auto mb-4"></div>
              <p className="text-text-secondary">Loading your absences...</p>
            </div>
          ) : absencesHistory.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-text-secondary">No absence requests found.</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableHeaderCell>Leave</TableHeaderCell>
                  <TableHeaderCell>Reason</TableHeaderCell>
                  <TableHeaderCell>Date</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </TableHeader>

                <TableBody>
                  {absencesHistory.map((absence) => (
                    <TableRow key={absence.id}>
                      <TableCell>
                        <span className="font-semibold text-text-primary">
                          {absence.displayName || allowanceService.getLeaveTypeDisplayName(absence.leaveType)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-text-secondary">{absence.reason || "N/A"}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-text-secondary">{absence.date}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusVariant(absence.status)}>
                          {absence.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {absenceService.canDeleteAbsence(absence, user) && (
                          <button
                            onClick={() => handleDelete(absence.id)}
                            className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            title="Delete Request"
                          >
                            <Trash2 size={18} />
                          </button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-xs py-4 text-text-secondary text-center md:hidden">
                ← Scroll horizontally to view all columns →
              </p>
            </>
          )}
        </SectionContainer>
      </div>
    </div>
  );
};

export default MyAbsencesPage;