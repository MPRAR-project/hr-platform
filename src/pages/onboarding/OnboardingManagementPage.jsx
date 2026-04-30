import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { User, Mail, Phone, MapPin, Search, Filter, CheckCircle, XCircle, Clock, AlertCircle, Loader2, Eye, Edit, Trash2, FileText } from 'lucide-react';
import Header from '../../components/layout/Header';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import ViewEmploymentModal from '../../components/modals/ViewEmploymentModal';
import AddOnboardingPolicyModal from '../../components/modals/AddOnboardingPolicyModal';
import { useAuth } from '../../hooks/useAuth';
import { useCache } from '../../contexts/CacheContext';
import {
  getOnboardingApplications,
  updateOnboardingStatus,
  assignOnboardingManager,
  getOnboardingStatistics,
  ONBOARDING_STATUS
} from '../../services/onboarding';
import {
  getOnboardingDocuments
} from '../../services/documents';
import { addCompanyOnboardingPolicy, getCompanyOnboardingPolicies } from '../../services/onboardingPolicyService';
import {
  notifyOnboardingStatusChange
} from '../../services/notifications';
import { toast } from 'react-toastify';
import { LoadingSkeleton } from '../../components/ui/LoadingSkeleton';

const OnboardingManagementPage = ({ isEmbedded = false }) => {
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [onboardingApplications, setOnboardingApplications] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [statistics, setStatistics] = useState(null);
  const [policyDocuments, setPolicyDocuments] = useState([]);
  const [isPolicyModalOpen, setIsPolicyModalOpen] = useState(false);
  const [isPolicySubmitting, setIsPolicySubmitting] = useState(false);
  const [isPoliciesLoading, setIsPoliciesLoading] = useState(false);
  const [policyError, setPolicyError] = useState(null);
  const { user } = useAuth();
  const { getItem, setItem } = useCache();

  const normalizedCompanyId = user?.companyId
    ? (user.companyId.includes('/') ? user.companyId : `companies/${user.companyId}`)
    : null;
  const rawCompanyId = normalizedCompanyId?.split('/')[1] ?? null;

  const loadOnboardingApplications = useCallback(async () => {
    if (!normalizedCompanyId || !rawCompanyId) {
      setError('Company information not available');
      return;
    }

    const cacheKey = `onboarding_${rawCompanyId}`;
    const cached = getItem?.(cacheKey);
    if (cached?.applications) {
      setOnboardingApplications(cached.applications);
      setIsLoading(false);
    }
    if (cached?.policies) {
      setPolicyDocuments(cached.policies);
      setIsPoliciesLoading(false);
    }

    try {
      if (!cached?.applications) setIsLoading(true);
      setError(null);

      const companyId = rawCompanyId;
      const result = await getOnboardingApplications({
        companyId: `companies/${companyId}`,
        limitCount: 100
      });

      const toMillis = (ts) => (ts?.toMillis ? ts.toMillis() : (ts?.seconds ? ts.seconds * 1000 : 0));
      const sortedApps = [...(result.applications || [])].sort((a, b) => {
        const aTime = toMillis(a.updatedAt) || toMillis(a.createdAt);
        const bTime = toMillis(b.updatedAt) || toMillis(b.createdAt);
        return bTime - aTime;
      });

      setOnboardingApplications(sortedApps);
      setItem?.(cacheKey, { applications: sortedApps, policies: cached?.policies ?? [] }, 7 * 60 * 1000);

      const stats = await getOnboardingStatistics(`companies/${companyId}`);
      setStatistics(stats);
    } catch (err) {
      console.error('Error loading onboarding applications:', err);
      setError(err.message || 'Failed to load onboarding applications');
    } finally {
      setIsLoading(false);
    }
  }, [normalizedCompanyId, rawCompanyId, getItem, setItem]);

  useEffect(() => {
    loadOnboardingApplications();
  }, [loadOnboardingApplications]);

  const loadPolicies = useCallback(async () => {
    if (!normalizedCompanyId || !rawCompanyId) return;
    const cacheKey = `onboarding_${rawCompanyId}`;
    const cached = getItem?.(cacheKey);
    if (Array.isArray(cached?.policies)) {
      setPolicyDocuments(cached.policies);
      setIsPoliciesLoading(false);
    }
    try {
      if (!Array.isArray(cached?.policies)) setIsPoliciesLoading(true);
      setPolicyError(null);
      const policies = await getCompanyOnboardingPolicies(normalizedCompanyId);
      setPolicyDocuments(policies);
      const current = getItem?.(cacheKey);
      setItem?.(cacheKey, { applications: current?.applications ?? [], policies }, 7 * 60 * 1000);
    } catch (err) {
      console.error('Error loading onboarding policy documents:', err);
      setPolicyError(err.message || 'Failed to load onboarding documents');
    } finally {
      setIsPoliciesLoading(false);
    }
  }, [normalizedCompanyId, rawCompanyId, getItem, setItem]);

  useEffect(() => {
    loadPolicies();
  }, [loadPolicies]);

  // Filter applications based on search and status
  const filteredApplications = useMemo(() => {
    let filtered = [...onboardingApplications];

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(app => {
        // Check both stepData and formData for compatibility
        const personalInfo = app.stepData?.personalInfo || app.formData?.personalInfo || {};
        const name = `${personalInfo.firstName || ''} ${personalInfo.lastName || ''}`.toLowerCase();
        const email = personalInfo.email?.toLowerCase() || '';
        return name.includes(query) || email.includes(query);
      });
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter(app => app.status === statusFilter);
    } else {
      filtered = filtered.filter(
        app =>
          app.status === ONBOARDING_STATUS.PENDING ||
          app.status === ONBOARDING_STATUS.IN_PROGRESS ||
          app.status === ONBOARDING_STATUS.COMPLETED
      );
    }

    return filtered;
  }, [onboardingApplications, searchQuery, statusFilter]);

  // Helper functions
  const getStatusBadgeVariant = (status) => {
    switch (status) {
      case ONBOARDING_STATUS.PENDING:
        return 'warning';
      case ONBOARDING_STATUS.IN_PROGRESS:
        return 'info';
      case ONBOARDING_STATUS.COMPLETED:
        return 'success';
      case ONBOARDING_STATUS.REJECTED:
        return 'danger';
      case ONBOARDING_STATUS.CANCELLED:
        return 'secondary';
      default:
        return 'secondary';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case ONBOARDING_STATUS.PENDING:
        return <Clock className="h-4 w-4" />;
      case ONBOARDING_STATUS.IN_PROGRESS:
        return <AlertCircle className="h-4 w-4" />;
      case ONBOARDING_STATUS.COMPLETED:
        return <CheckCircle className="h-4 w-4" />;
      case ONBOARDING_STATUS.REJECTED:
        return <XCircle className="h-4 w-4" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  const formatEmployeeName = (application) => {
    // Check both stepData and formData for compatibility
    const personalInfo = application.stepData?.personalInfo || application.formData?.personalInfo || {};
    const firstName = personalInfo.firstName || '';
    const lastName = personalInfo.lastName || '';
    return `${firstName} ${lastName}`.trim() || 'Unknown Employee';
  };

  const formatEmployeeEmail = (application) => {
    // Check both stepData and formData for compatibility
    const personalInfo = application.stepData?.personalInfo || application.formData?.personalInfo || {};
    return personalInfo.email || 'No email provided';
  };

  const formatEmployeePhone = (application) => {
    // Check both stepData and formData for compatibility
    const personalInfo = application.stepData?.personalInfo || application.formData?.personalInfo || {};
    return personalInfo.phone || 'No phone provided';
  };

  const formatEmployeeLocation = (application) => {
    // Check both stepData and formData for compatibility
    const personalInfo = application.stepData?.personalInfo || application.formData?.personalInfo || {};
    const city = personalInfo.city || '';
    const country = personalInfo.country || '';
    return `${city}${city && country ? ', ' : ''}${country}`.trim() || 'No location provided';
  };

  // Action handlers
  const handleViewDetails = (application) => {
    const employeeData = {
      id: application.id,
      name: formatEmployeeName(application),
      email: formatEmployeeEmail(application),
      phone: formatEmployeePhone(application),
      location: formatEmployeeLocation(application),
      application: application
    };
    setSelectedEmployee(employeeData);
    setShowDetailsModal(true);
  };

  const handleApproveOnboarding = async (applicationId) => {
    try {
      setIsLoading(true);
      setError(null);

      await updateOnboardingStatus(applicationId, ONBOARDING_STATUS.COMPLETED, user.uid, 'Approved by manager');

      // Notify employee
      await notifyOnboardingStatusChange(applicationId, ONBOARDING_STATUS.COMPLETED, applicationId, user.displayName || 'Manager');

      setSuccess('Onboarding application approved successfully!');

      // Reload applications
      const companyId = user.companyId.split('/')[1];
      const result = await getOnboardingApplications({
        companyId: `companies/${companyId}`,
        limitCount: 100
      });
      setOnboardingApplications(result.applications);
    } catch (err) {
      console.error('Error approving onboarding:', err);
      setError(err.message || 'Failed to approve onboarding');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRejectOnboarding = async (applicationId) => {
    try {
      setIsLoading(true);
      setError(null);

      await updateOnboardingStatus(applicationId, ONBOARDING_STATUS.REJECTED, user.uid, 'Rejected by manager');

      // Notify employee
      await notifyOnboardingStatusChange(applicationId, ONBOARDING_STATUS.REJECTED, applicationId, user.displayName || 'Manager');

      setSuccess('Onboarding application rejected.');

      // Reload applications
      const companyId = user.companyId.split('/')[1];
      const result = await getOnboardingApplications({
        companyId: `companies/${companyId}`,
        limitCount: 100
      });
      setOnboardingApplications(result.applications);
    } catch (err) {
      console.error('Error rejecting onboarding:', err);
      setError(err.message || 'Failed to reject onboarding');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePolicySubmit = async (payload) => {
    if (!normalizedCompanyId || !user?.uid) return;
    try {
      setIsPolicySubmitting(true);
      const created = await addCompanyOnboardingPolicy({
        companyId: normalizedCompanyId,
        ...payload,
        uploadedBy: user.uid,
        uploadedByEmail: user.email || null
      });
      toast.success('Onboarding document uploaded successfully.');
      setIsPolicyModalOpen(false);
      setPolicyDocuments((prev) => [created, ...prev]);
    } catch (err) {
      console.error('Failed to upload onboarding document:', err);
      toast.error(err.message || 'Failed to upload onboarding document');
    } finally {
      setIsPolicySubmitting(false);
    }
  };

  const handleSaveEmploymentDetails = async (data) => {
    try {
      setIsLoading(true);
      setError(null);

      // Update employment details in the onboarding application
      // This would typically update the employmentDetails field
      console.log('Save employment details:', data);

      setSuccess('Employment details saved successfully!');
      setShowDetailsModal(false);
    } catch (err) {
      console.error('Error saving employment details:', err);
      setError(err.message || 'Failed to save employment details');
    } finally {
      setIsLoading(false);
    }
  };

  const pretty = (role) =>
    role.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());

  return (
    <div className={`h-screen flex flex-col overflow-hidden ${isEmbedded ? 'h-full bg-transparent' : ''}`}>
      {!isEmbedded && (
        <Header
          title={`${pretty(user.role)} Dashboard`}
          subtitle="Grow your digital workplace and manage your team seamlessly"
        />
      )}

      <div className="flex-1 overflow-y-auto p-4 md:p-3xl scrollbar-custom">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Page Title */}
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-text-primary">Onboarding Management</h1>
            <p className="text-sm text-text-secondary mt-1">
              Manage employee onboarding applications and track progress
            </p>
          </div>

          {/* Error/Success Messages */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          )}

          {success && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
              <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
              <p className="text-green-700 text-sm">{success}</p>
            </div>
          )}

          {/* Statistics Cards */}
          {statistics && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="bg-white border border-border-primary rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-text-secondary">Total</p>
                    <p className="text-2xl font-bold text-text-primary">{statistics.total}</p>
                  </div>
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                    <User className="h-4 w-4 text-blue-600" />
                  </div>
                </div>
              </div>

              <div className="bg-white border border-border-primary rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-text-secondary">Pending</p>
                    <p className="text-2xl font-bold text-yellow-600">{statistics.pending}</p>
                  </div>
                  <div className="w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center">
                    <Clock className="h-4 w-4 text-yellow-600" />
                  </div>
                </div>
              </div>

              <div className="bg-white border border-border-primary rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-text-secondary">In Progress</p>
                    <p className="text-2xl font-bold text-blue-600">{statistics.inProgress}</p>
                  </div>
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                    <AlertCircle className="h-4 w-4 text-blue-600" />
                  </div>
                </div>
              </div>

              <div className="bg-white border border-border-primary rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-text-secondary">Completed</p>
                    <p className="text-2xl font-bold text-green-600">{statistics.completed}</p>
                  </div>
                  <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  </div>
                </div>
              </div>

              <div className="bg-white border border-border-primary rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-text-secondary">Rejected</p>
                    <p className="text-2xl font-bold text-red-600">{statistics.rejected}</p>
                  </div>
                  <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center">
                    <XCircle className="h-4 w-4 text-red-600" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Policies Upload Section */}
          <div className="bg-white border border-border-primary rounded-lg p-4 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-text-primary">Policies & Agreements</h2>
                <p className="text-sm text-text-secondary">
                  Upload company documents employees must acknowledge in onboarding.
                </p>
              </div>
              <Button variant="gradient" onClick={() => setIsPolicyModalOpen(true)}>
                Upload Document
              </Button>
            </div>

            {policyError && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded">
                {policyError}
              </div>
            )}

            {isPoliciesLoading ? (
              <div className="space-y-3">
                {[...Array(2)].map((_, idx) => (
                  <div key={idx} className="animate-pulse border border-border-primary rounded-lg p-4">
                    <div className="h-4 bg-gray-200 rounded w-1/3 mb-2"></div>
                    <div className="h-3 bg-gray-200 rounded w-2/3"></div>
                  </div>
                ))}
              </div>
            ) : policyDocuments.length === 0 ? (
              <div className="border border-dashed border-border-primary rounded-lg p-6 text-center text-sm text-text-secondary">
                No onboarding documents uploaded yet.
              </div>
            ) : (
              <div className="space-y-3">
                {policyDocuments.map((policy) => (
                  <div
                    key={policy.id}
                    className="border border-border-primary rounded-lg p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
                  >
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-semibold text-text-primary">{policy.title}</h3>
                        {policy.isRequired && <Badge variant="danger">Required</Badge>}
                        <Badge variant="info">
                          {(policy.category || 'policy').replace(/_/g, ' ')}
                        </Badge>
                      </div>
                      {policy.description && (
                        <p className="text-sm text-text-secondary mt-1">{policy.description}</p>
                      )}
                    </div>
                    <Button
                      variant="outline-secondary"
                      onClick={() => window.open(policy.downloadURL, '_blank', 'noopener')}
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      View Document
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Search and Filter Controls */}
          <div className="bg-white border border-border-primary rounded-lg p-4">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-text-secondary" />
                  <input
                    type="text"
                    placeholder="Search by name or email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-border-secondary rounded-lg text-sm focus:outline-none focus:border-border-accent-purple"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-4 py-2 border border-border-secondary rounded-lg text-sm focus:outline-none focus:border-border-accent-purple"
                >
                  <option value="all">All Status</option>
                  <option value={ONBOARDING_STATUS.PENDING}>Pending</option>
                  <option value={ONBOARDING_STATUS.IN_PROGRESS}>In Progress</option>
                  <option value={ONBOARDING_STATUS.COMPLETED}>Completed</option>
                  <option value={ONBOARDING_STATUS.REJECTED}>Rejected</option>
                </select>
              </div>
            </div>
          </div>

          {/* Loading State: skeleton-first */}
          {isLoading && !onboardingApplications.length && (
            <div className="space-y-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="bg-white border border-border-primary rounded-lg p-4 md:p-6 animate-pulse">
                  <div className="flex gap-4">
                    <LoadingSkeleton height="h-12" width="w-12" className="rounded-full flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                      <LoadingSkeleton height="h-5" width="w-48" />
                      <LoadingSkeleton height="h-4" width="w-64" />
                      <LoadingSkeleton height="h-4" width="w-32" className="mt-3" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Employee Cards */}
          {(!isLoading || onboardingApplications.length > 0) && (
            <div className="space-y-4">
              {filteredApplications.length === 0 ? (
                <div className="bg-white border border-border-primary rounded-lg p-8 text-center">
                  <User className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">No onboarding applications found</h3>
                  <p className="text-gray-600">
                    {searchQuery || statusFilter !== 'all'
                      ? 'Try adjusting your search or filter criteria.'
                      : 'No employees have submitted onboarding applications yet.'}
                  </p>
                </div>
              ) : (
                filteredApplications.map((application) => (
                  <div
                    key={application.id}
                    className="bg-white border border-border-primary rounded-lg p-4 md:p-6 hover:shadow-md transition-shadow"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      {/* Employee Info */}
                      <div className="flex items-start gap-4 flex-1 min-w-0">
                        <div className="w-12 h-12 bg-background-accent-purple-light rounded-full flex items-center justify-center flex-shrink-0">
                          <User className="h-6 w-6 text-text-accent-purple" />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="text-lg font-semibold text-text-primary truncate">
                              {formatEmployeeName(application)}
                            </h3>
                            <Badge variant={getStatusBadgeVariant(application.status)}>
                              {getStatusIcon(application.status)}
                              <span className="ml-1 capitalize">{application.status.replace('_', ' ')}</span>
                            </Badge>
                          </div>

                          <div className="flex flex-wrap items-center gap-3 text-sm text-text-secondary">
                            <span className="flex items-center gap-1">
                              <Mail className="h-3 w-3 flex-shrink-0" />
                              <span className="truncate">{formatEmployeeEmail(application)}</span>
                            </span>
                            <span className="flex items-center gap-1">
                              <Phone className="h-3 w-3 flex-shrink-0" />
                              {formatEmployeePhone(application)}
                            </span>
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3 flex-shrink-0" />
                              {formatEmployeeLocation(application)}
                            </span>
                          </div>

                          {/* Progress Indicator */}
                          <div className="mt-3">
                            <div className="flex items-center gap-2 text-xs text-text-secondary">
                              <span>Progress:</span>
                              <div className="flex-1 bg-gray-200 rounded-full h-2 max-w-32">
                                <div
                                  className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                                  style={{ width: `${Math.min(((application.currentStep || 0) / 6) * 100, 100)}%` }}
                                />
                              </div>
                              <span>{Math.min(application.currentStep || 0, 6)}/6 steps</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline-primary"
                          onClick={() => handleViewDetails(application)}
                          className="flex items-center gap-2"
                        >
                          <Eye className="h-4 w-4" />
                          View Details
                        </Button>

                        {application.status === ONBOARDING_STATUS.PENDING || application.status === ONBOARDING_STATUS.IN_PROGRESS ? (
                          <>
                            <Button
                              variant="outline-danger"
                              onClick={() => handleRejectOnboarding(application.id)}
                              disabled={isLoading}
                              className="flex items-center gap-2"
                            >
                              <XCircle className="h-4 w-4" />
                              Reject
                            </Button>
                            <Button
                              variant="solid-success"
                              onClick={() => handleApproveOnboarding(application.id)}
                              disabled={isLoading}
                              className="flex items-center gap-2"
                            >
                              <CheckCircle className="h-4 w-4" />
                              Approve
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Employment Details Modal */}
      <ViewEmploymentModal
        isOpen={showDetailsModal}
        onClose={() => setShowDetailsModal(false)}
        employee={selectedEmployee}
        onSave={handleSaveEmploymentDetails}
      />
      <AddOnboardingPolicyModal
        isOpen={isPolicyModalOpen}
        onClose={() => setIsPolicyModalOpen(false)}
        onSubmit={handlePolicySubmit}
        isLoading={isPolicySubmitting}
      />
    </div>
  );
};

export default OnboardingManagementPage;