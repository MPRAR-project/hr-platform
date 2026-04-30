import { useState, useEffect } from "react";
import { ChevronDown, FileText, Search, CheckCircle, Clock, AlertTriangle } from "lucide-react";
import Badge from "../../../components/ui/Badge";
import Button from "../../../components/ui/Button";
import AddDocumentModal from "../../../components/modals/AddDocumentModal";
import RequestExtensionModal from "../../../components/modals/RequestExtensionModal";
import { useAuth } from "../../../hooks/useAuth";
import { useCache } from "../../../contexts/CacheContext";
import { trainingService } from "../../../services/trainingService";
import { certificateService } from "../../../services/certificateService";
import { extensionService } from "../../../services/extensionService";
import { toast } from 'react-toastify';

const TRAINING_CACHE_TTL = 7 * 60 * 1000;

export const TrainingTab = () => {
  const { user } = useAuth();
  const { getItem, setItem } = useCache();
  const [loading, setLoading] = useState(true);
  const [assignments, setAssignments] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('All States');

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showExtensionModal, setShowExtensionModal] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState(null);

  useEffect(() => {
    if (user) {
      loadUserTrainingAssignments();
    }
  }, [user]);

  const loadUserTrainingAssignments = async () => {
    if (!user || !user.companyId) return;

    const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
    const cacheKey = `training_${companyId}_${user.userId}`;
    const cached = getItem?.(cacheKey);
    if (cached?.assignments) {
      const userAssignments = cached.assignments.filter(a => a.userId === user.userId);
      setAssignments(userAssignments);
      setLoading(false);
    } else {
      setLoading(true);
    }

    try {
      const assignmentsResult = await trainingService.getTrainingAssignments(companyId, null, user.role, user.userId);

      if (assignmentsResult.success) {
        const allAssignments = assignmentsResult.data;
        const userAssignments = allAssignments.filter(a => a.userId === user.userId);
        setAssignments(userAssignments);
        const existing = getItem?.(cacheKey) || {};
        setItem?.(cacheKey, { ...existing, assignments: allAssignments }, TRAINING_CACHE_TTL);
      }
    } catch (error) {
      console.error('Error loading user training assignments:', error);
      toast.error('Failed to load training assignments');
    } finally {
      setLoading(false);
    }
  };

  const handleUploadCertificate = (assignment) => {
    setSelectedAssignment(assignment);
    setShowUploadModal(true);
  };

  const handleCertificateUpload = async (uploadData) => {
    try {
      const { file, documentDescription } = uploadData;
      const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
      
      const result = await certificateService.submitCertificate(
        selectedAssignment.id,
        file,
        user.userId,
        companyId,
        documentDescription || ''
      );

      if (result.success) {
        toast.success('Certificate uploaded successfully');
        setShowUploadModal(false);
        setSelectedAssignment(null);
        loadUserTrainingAssignments(); // Reload data
      }
    } catch (error) {
      console.error('Error uploading certificate:', error);
      toast.error(error.message);
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
        user.userId,
        companyId
      );

      if (result.success) {
        toast.success('Extension request submitted successfully');
        setShowExtensionModal(false);
        setSelectedAssignment(null);
        loadUserTrainingAssignments(); // Reload data
      }
    } catch (error) {
      console.error('Error submitting extension request:', error);
      toast.error(error.message);
    }
  };

  // Get processed user training assignments
  const getUserTrainingData = () => {
    const now = new Date();

    return assignments.map(assignment => {
      const dueDate = assignment.dueDate?.toDate ? assignment.dueDate.toDate() : new Date(assignment.dueDate);
      const expiryDate = assignment.expiryDate?.toDate ? assignment.expiryDate.toDate() : new Date(assignment.expiryDate);
      const daysUntilDue = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
      const daysUntilExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
      
      // Determine if training is critical (overdue or expiring soon)
      const isCritical = (assignment.status === 'assigned' && daysUntilDue <= 0) || 
                        (assignment.status === 'completed' && daysUntilExpiry <= 0) ||
                        assignment.status === 'expired' || assignment.status === 'overdue';
      
      const isUrgent = (assignment.status === 'assigned' && daysUntilDue <= 7 && daysUntilDue > 0) ||
                      (assignment.status === 'completed' && daysUntilExpiry <= 30 && daysUntilExpiry > 0);

      return {
        id: assignment.id,
        title: assignment.training?.name || 'Unknown Training',
        description: assignment.training?.description || '',
        assigned: formatDate(assignment.assignedDate),
        due: formatDate(assignment.dueDate),
        completed: formatDate(assignment.completedDate),
        expiry: formatDate(assignment.expiryDate),
        status: assignment.status,
        statusVariant: getStatusVariant(assignment.status),
        message: getStatusMessage(assignment),
        hasExpired: isCritical,
        isUrgent: isUrgent,
        daysUntilDue: daysUntilDue,
        daysUntilExpiry: daysUntilExpiry,
        training: assignment.training,
        assignmentId: assignment.id,
        extensionStatus: assignment.extensionStatus,
        certificateId: assignment.certificateId
      };
    });
  };

  // Helper functions
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

  // Get filtered training data
  const getFilteredTrainingData = () => {
    const userTrainingData = getUserTrainingData();
    
    let filtered = userTrainingData;

    if (searchQuery) {
      filtered = filtered.filter(training =>
        training.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        training.description.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    if (filterStatus !== 'All States') {
      filtered = filtered.filter(training => {
        const statusMap = {
          'Pending': ['assigned', 'in_progress'],
          'Completed': ['completed'],
          'Expired': ['expired', 'overdue', 'declined']
        };
        return statusMap[filterStatus]?.includes(training.status);
      });
    }

    return filtered;
  };

  // Calculate user training statistics
  const getUserStats = () => {
    const userTrainingData = getUserTrainingData();
    const now = new Date();

    const stats = {
      totalRecords: userTrainingData.length,
      completed: userTrainingData.filter(a => a.status === 'completed').length,
      pending: userTrainingData.filter(a => ['assigned', 'in_progress', 'pending_approval'].includes(a.status)).length,
      expiredMissing: userTrainingData.filter(a => ['expired', 'overdue', 'declined'].includes(a.status)).length
    };

    return stats;
  };

  const filteredTrainingData = getFilteredTrainingData();
  const stats = getUserStats();

  // Mock employee data for modal
  const mockEmployee = {
    name: user?.displayName || user?.email || 'Current User'
  };

  return (
    <>
      <div className="bg-white border border-border-primary rounded-base p-4xl space-y-4xl">
        <div>
          <h2 className="text-2xl font-bold text-text-primary mb-1">My Training</h2>
          <p className="text-text-secondary">View and manage your training assignments and certificates.</p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4xl">
          <div className="bg-white border border-border-primary rounded-base p-4xl">
            <div className="flex items-center justify-center gap-3">
              <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center">
                <FileText className="h-5 w-5 text-blue-600" />
              </div>
              <div className="text-center">
                <p className="text-text-secondary text-sm">Total Records</p>
                <p className="text-4xl font-bold text-text-primary">{stats.totalRecords}</p>
              </div>
            </div>
          </div>

          <div className="bg-white border border-border-primary rounded-base p-4xl">
            <div className="flex items-center justify-center gap-3">
              <div className="w-10 h-10 bg-green-50 rounded-full flex items-center justify-center">
                <CheckCircle className="h-5 w-5 text-green-600" />
              </div>
              <div className="text-center">
                <p className="text-text-secondary text-sm">Completed</p>
                <p className="text-4xl font-bold text-text-primary">{stats.completed}</p>
              </div>
            </div>
          </div>

          <div className="bg-white border border-border-primary rounded-base p-4xl">
            <div className="flex items-center justify-center gap-3">
              <div className="w-10 h-10 bg-yellow-50 rounded-full flex items-center justify-center">
                <Clock className="h-5 w-5 text-yellow-600" />
              </div>
              <div className="text-center">
                <p className="text-text-secondary text-sm">Pending</p>
                <p className="text-4xl font-bold text-text-primary">{stats.pending}</p>
              </div>
            </div>
          </div>

          <div className="bg-white border border-border-primary rounded-base p-4xl">
            <div className="flex items-center justify-center gap-3">
              <div className="w-10 h-10 bg-red-50 rounded-full flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <div className="text-center">
                <p className="text-text-secondary text-sm">Expired / Missing</p>
                <p className="text-4xl font-bold text-text-primary">{stats.expiredMissing}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Search and Filter */}
        <div className="flex flex-col sm:flex-row gap-3xl">
          <div className="relative flex-1">
            <Search className="absolute left-base top-1/2 -translate-y-1/2 h-5 w-5 text-text-secondary" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search my training..."
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
                <option>Pending</option>
                <option>Completed</option>
                <option>Expired</option>
              </select>
              <ChevronDown className="absolute right-base top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Training List */}
        <div className="space-y-3xl">
          {loading ? (
            <div className="space-y-3xl">
              {[...Array(3)].map((_, index) => (
                <div key={index} className="animate-pulse border border-border-primary rounded-base p-4xl">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1">
                      <div className="w-12 h-12 bg-gray-200 rounded-lg"></div>
                      <div className="flex-1">
                        <div className="h-4 bg-gray-200 rounded mb-2 w-48"></div>
                        <div className="h-3 bg-gray-200 rounded mb-2 w-64"></div>
                        <div className="flex gap-4">
                          <div className="h-3 bg-gray-200 rounded w-20"></div>
                          <div className="h-3 bg-gray-200 rounded w-24"></div>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <div className="h-8 bg-gray-200 rounded w-20"></div>
                      <div className="h-8 bg-gray-200 rounded w-24"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : filteredTrainingData.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No training assignments</h3>
              <p className="text-gray-600">You don't have any training assignments at the moment.</p>
            </div>
          ) : (
            filteredTrainingData.map((training) => (
              <div key={training.id} className="border border-border-primary rounded-base p-4xl">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
                  <div className="flex items-start gap-3 flex-1">
                    <div className="w-12 h-12 bg-bg-accent-purple-light rounded-lg flex items-center justify-center flex-shrink-0">
                      <FileText className="h-6 w-6 text-text-accent-purple" />
                    </div>
                    <div className="flex-1">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-2">
                        <h3 className="text-lg font-semibold text-text-primary">{training.title}</h3>
                        <Badge variant={training.statusVariant}>{training.status.replace('_', ' ')}</Badge>
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
                        onClick={() => handleUploadCertificate(training)}
                      >
                        {training.status === 'pending_approval' ? 'Reupload Certificate' : 'Upload Certificate'}
                      </Button>
                    )}
                    {training.status === 'assigned' && 
                     (training.daysUntilDue >= 0 || training.extensionStatus === 'approved') && (
                      <Button
                        variant="gradient"
                        onClick={() => handleUploadCertificate(training)}
                      >
                        Upload Certificate
                      </Button>
                    )}
                    
                    {/* Show Request Extension button if not already pending and training is due soon or overdue */}
                    {(() => {
                      // Don't show if extension is already pending
                      if (training.extensionStatus === 'pending') return null;
                      
                      // Show for overdue trainings (assigned status with negative days until due)
                      if (training.status === 'assigned' && training.daysUntilDue <= 0) {
                        return (
                          <Button
                            variant="outline-primary"
                            onClick={() => handleExtensionClick(training)}
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
                            onClick={() => handleExtensionClick(training)}
                          >
                            Request Extension
                          </Button>
                        );
                      }
                      
                      return null;
                    })()}
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

      {/* Upload Certificate Modal */}
      <AddDocumentModal
        isOpen={showUploadModal}
        onClose={() => {
          setShowUploadModal(false);
          setSelectedAssignment(null);
        }}
        employee={mockEmployee}
        onUpload={handleCertificateUpload}
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
    </>
  );
};