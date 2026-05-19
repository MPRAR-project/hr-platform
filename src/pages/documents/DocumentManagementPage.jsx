import React, { useState, useEffect, useRef, useMemo } from 'react';

import { Search, FileText, AlertCircle, CheckCircle, XCircle, Clock, Plus, Upload, User, Briefcase, Calendar, AlertTriangle, ChevronDown } from 'lucide-react';
import Header from '../../components/layout/Header';
import Tabs from '../../components/ui/Tabs';
import StatCard from '../../components/shared/StatCard';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import AddDocumentRequestModal from '../../components/modals/AddDocumentRequestModal';
import ViewDocumentModal from '../../components/modals/ViewDocumentModal';
import UploadDocumentModal from '../../components/modals/UploadDocumentModal';
import ApprovalConfirmationModal from '../../components/modals/ApprovalConfirmationModal';
import DeleteConfirmationModal from '../../components/modals/DeleteConfirmationModal';
import ManageDocumentTypesModal from '../../components/modals/ManageDocumentTypesModal';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { documentService } from '../../services/documentService';
import { getManagedEmployeeIdsForManager } from '../../services/teams';
import hrApiClient from '../../lib/hrApiClient';
import { toast } from 'react-toastify';
import { useCache } from '../../contexts/CacheContext';
import { usePaginatedUsers } from '../../hooks/usePaginatedUsers';
import { StatsLoadingState } from '../../components/ui/DashboardLoadingState';
import { getRoleJobTitle } from '../../utils/dataParser';

const DocumentManagementPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [statistics, setStatistics] = useState({});
  const [error, setError] = useState(null);

  // NOTE: availableTabs must be before activeTab useState – keep hooks unconditional
  const availableTabs = useMemo(() => {
    if (!user) return [{ label: 'My Documents' }];
    if (user.role === 'employee') return [{ label: 'My Documents' }];
    if (user.role === 'siteManager') return [{ label: 'Employee Documents' }];
    return [{ label: 'My Documents' }, { label: 'Employee Documents' }];
  }, [user?.role]);
  const [activeTab, setActiveTab] = useState(location.state?.activeTab || availableTabs[0].label);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterDocumentType, setFilterDocumentType] = useState('all');
  const [filterDepartment, setFilterDepartment] = useState('All Departments');
  const [employeeTrainingData, setEmployeeTrainingData] = useState([]);
  const [loadingEmployeeData, setLoadingEmployeeData] = useState(false);

  // Early-return guard MUST come after all hooks
  // (placed here as a flag; actual return is below after all hooks)


  // Modal states
  const [showAddRequestModal, setShowAddRequestModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showDeclineModal, setShowDeclineModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showManageTypesModal, setShowManageTypesModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);

  // User capabilities based on role
  const MANAGER_ROLES = ['siteManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor', 'teamManager'];
  const userCapabilities = {
    canCreateRequest: MANAGER_ROLES.includes(user?.role),
    canApproveDocument: MANAGER_ROLES.includes(user?.role),
    canViewAllDocuments: MANAGER_ROLES.includes(user?.role)
  };

  // Cache Context
  const { setItem, getItem } = useCache();
  const {
    users: paginatedUsers,
    loadMore: loadMoreUsers,
    hasMore: hasMoreUsers,
    loading: loadingUsers,
    reload: reloadUsers
  } = usePaginatedUsers(user?.companyId?.split('/')[1] || user?.companyId, 100);

  const companyId = user?.companyId ? (user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId) : null;
  const loadInProgressRef = useRef(false);
  const lastLoadedRef = useRef(null);

  // Team management for Team Managers
  const [managedEmployeeIds, setManagedEmployeeIds] = useState(new Set());
  useEffect(() => {
    if (user?.role === 'teamManager' && companyId) {
      getManagedEmployeeIdsForManager(user.uid, companyId).then(setManagedEmployeeIds);
    }
  }, [user?.role, user?.uid, companyId]);

  // ---------------------------------------------------------------------------
  // Top-level derived state (hooks must never be inside nested functions)
  // ---------------------------------------------------------------------------

  // Combined list of the current user's own requests + uploaded documents
  const allUserItems = useMemo(() => {
    const uid = user?.uid;
    if (!uid) return [];
    const userRequests = requests.filter(r => r.userId === uid);
    const userDocuments = documents.filter(d => d.userId === uid);

    // Create a map to track the latest status for each document request
    const itemMap = new Map();

    // First add all requests
    userRequests.forEach(request => {
      itemMap.set(request.id, {
        ...request,
        isRequest: true,
        documentTitle: request.documentTitle || request.documentType,
        fileName: request.documentType,
        id: request.id
      });
    });

    // Then add documents, overriding their corresponding requests.
    // For standalone docs (no requestId) we deduplicate by title, keeping
    // only the most recently uploaded document when two share the same title.
    userDocuments.forEach(document => {
      // Use requestId if it exists to override the original request
      if (document.requestId) {
        itemMap.set(document.requestId, {
          ...document,
          isRequest: false,
          documentTitle: document.documentTitle || document.documentType,
          fileName: document.fileName || document.documentType,
          id: document.id
        });
      } else {
        const title = (document.documentTitle || document.documentType || '').toLowerCase().trim();
        // Use a title-based key so same-title docs overwrite each other (dedup)
        const mapKey = title ? `__title__${title}` : document.id;

        if (title) {
          const prev = itemMap.get(mapKey);
          if (prev) {
            // Keep the more recently uploaded document
            const toDate = (ts) => ts?.toDate ? ts.toDate() : new Date(ts || 0);
            const prevDate = toDate(prev.uploadedAt || prev.createdAt);
            const currDate = toDate(document.uploadedAt || document.createdAt);
            if (currDate <= prevDate) return; // existing entry is newer — skip
          }
        }

        itemMap.set(mapKey, {
          ...document,
          isRequest: false,
          documentTitle: document.documentTitle || document.documentType,
          fileName: document.fileName || document.documentType,
          id: document.id
        });
      }
    });

    // Remove any remaining requests that have documents with the same title
    const documentTitles = new Set();
    userDocuments.forEach(document => {
      const title = (document.documentTitle || document.documentType || '').toLowerCase().trim();
      if (title) documentTitles.add(title);
    });

    // Filter out requests that have corresponding documents by title
    const filteredItems = Array.from(itemMap.values()).filter(item => {
      if (item.isRequest) {
        const title = (item.documentTitle || item.documentType || '').toLowerCase().trim();
        return !documentTitles.has(title);
      }
      return true;
    });

    return filteredItems;
  }, [requests, documents, user?.uid]);

  // Filtered list for "My Documents" tab
  const filteredMyItems = useMemo(() => {
    return allUserItems.filter(item => {
      if (filterStatus !== 'all' && item.status !== filterStatus) return false;
      if (searchQuery && !item.documentTitle?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });
  }, [allUserItems, filterStatus, searchQuery]);

  // Filtered list for "Employee Documents" tab
  const filteredEmployeeData = useMemo(() => {
    return (employeeTrainingData || []).filter(employee => {
      const name = (employee?.userInfo?.displayName || 
                    (employee?.userInfo?.firstName ? `${employee?.userInfo?.firstName} ${employee?.userInfo?.lastName || ''}`.trim() : '')).toLowerCase();
      if (!name || name.includes('unknown user') || name === '') return false;

      const role = (employee?.userInfo?.primaryRole || '').toLowerCase();
      // Exclude senior roles (Site Manager, Senior Manager)
      if (role === 'sitemanager' || role === 'seniormanager') return false;
      // Exclude the currently logged-in user from the employee list
      if (employee.userId === user?.uid) return false;

      // For Team Managers: only show managed employees
      if (user?.role === 'teamManager' && !managedEmployeeIds.has(employee.userId)) return false;

      if (filterDepartment !== 'All Departments') {
        const dept = (employee.userInfo?.department || '').toLowerCase();
        const role = (employee.userInfo?.primaryRole || '').toLowerCase();
        const jobTitle = (getRoleJobTitle(employee.userInfo?.primaryRole) || '').toLowerCase();
        const filter = filterDepartment.toLowerCase();
        
        // Match if filter is in department name OR role name OR job title
        const isMatch = dept.includes(filter) || 
                       role.includes(filter) ||
                       jobTitle.includes(filter) ||
                       (filter === 'hr' && (dept.includes('human resource') || role.includes('human resource')));
                       
        if (!isMatch) return false;
      }
      if (searchQuery) {
        const nameMatch = (employee.userInfo?.displayName || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
                         `${employee.userInfo?.firstName || ''} ${employee.userInfo?.lastName || ''}`.toLowerCase().includes(searchQuery.toLowerCase());
        const emailMatch = (employee.userInfo?.email || '').toLowerCase().includes(searchQuery.toLowerCase());
        if (!nameMatch && !emailMatch) return false;
      }
      return true;
    });
  }, [employeeTrainingData, filterDepartment, searchQuery, user?.uid, managedEmployeeIds]);

  // Set up real-time listeners for documents and requests
  useEffect(() => {
    if (!user || !companyId || !user.role) return;

    console.log('[DocumentManagement] Setting up real-time subscriptions');

    const unsubscribeDocs = documentService.subscribeDocuments(companyId, user.role, user.uid, (result) => {
      if (result.success) {
        setDocuments(result.data);
      }
    });

    const unsubscribeRequests = documentService.subscribeRequests(companyId, user.role, user.uid, (result) => {
      if (result.success) {
        setRequests(result.data);
      }
    });

    return () => {
      console.log('[DocumentManagement] Cleaning up subscriptions');
      unsubscribeDocs();
      unsubscribeRequests();
    };
  }, [companyId, user?.role, user?.uid]);

  // Re-process employee logic when raw data changes
  useEffect(() => {
    if (userCapabilities.canViewAllDocuments && (documents.length > 0 || requests.length > 0)) {
      setLoadingEmployeeData(true);
      processEmployeeDocumentData(documents, requests)
        .then(data => setEmployeeTrainingData(data))
        .finally(() => setLoadingEmployeeData(false));
    }
  }, [documents, requests, paginatedUsers]);

  // Load initial data and stats
  useEffect(() => {
    if (!user?.uid || !companyId) return;
    loadDocumentData();
    try {
      loadMoreUsers(true);
    } catch (e) {
      console.error('Error pre-loading users list:', e);
    }
  }, [user?.uid, companyId]);

  // Guard: render spinner if user not yet loaded (must be after all hooks)
  if (!user) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  const loadDocumentData = async (opts = {}) => {
    const cid = companyId || (user?.companyId ? (user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId) : null);
    if (!user || !cid) return;

    try {
      setLoading(true);
      setError(null);

      // We only fetch statistics here as documents/requests are handled by subscriptions
      const statsResult = await documentService.getDocumentStatistics(cid, user.role, user.uid);

      if (statsResult.success) {
        setStatistics(statsResult.data);
      }

    } catch (error) {
      console.error('Error loading document data:', error);
      setError(error.message);
      toast.error('Failed to load document data');
    } finally {
      setLoading(false);
    }
  };

  // Event handlers for document management
  const handleCreateRequest = async (requestData) => {
    try {
      const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
      const result = await documentService.createDocumentRequest(
        requestData,
        user.uid,
        companyId,
        user.role
      );

      if (result.success) {
        toast.success('Document request created successfully');
        setShowAddRequestModal(false);
        loadDocumentData({ forceRefresh: true }); // Reload data (bypass cache for real-time UX)
      }
    } catch (error) {
      console.error('Error creating document request:', error);
      toast.error(error.message);
    }
  };

  const handleUploadDocument = async (requestId, file, notes) => {
    try {
      const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
      const result = await documentService.submitDocument(
        requestId,
        file,
        user.uid,
        companyId,
        notes,
        user.role
      );

      if (result.success) {
        toast.success('Document uploaded successfully');
        setShowUploadModal(false);
        setSelectedItem(null);
        loadDocumentData({ forceRefresh: true }); // Reload data (bypass cache for real-time UX)
      }
    } catch (error) {
      console.error('Error uploading document:', error);
      toast.error(error.message);
    }
  };

  const handleApproveDocument = async (documentId, notes) => {
    try {
      const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
      const result = await documentService.approveDocument(
        documentId,
        user.uid,
        user.role,
        companyId,
        notes
      );

      if (result.success) {
        toast.success('Document approved successfully');
        setShowApproveModal(false);
        setSelectedItem(null);
        loadDocumentData({ forceRefresh: true }); // Reload data (bypass cache for real-time UX)
      }
    } catch (error) {
      console.error('Error approving document:', error);
      toast.error(error.message);
    }
  };

  const handleDeclineDocument = async (documentId, reason) => {
    try {
      const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
      const result = await documentService.declineDocument(
        documentId,
        user.uid,
        user.role,
        companyId,
        reason
      );

      if (result.success) {
        toast.success('Document declined');
        setShowDeclineModal(false);
        setSelectedItem(null);
        loadDocumentData({ forceRefresh: true }); // Reload data (bypass cache for real-time UX)
      }
    } catch (error) {
      console.error('Error declining document:', error);
      toast.error(error.message);
    }
  };

  const handleDeleteDocument = async (documentId) => {
    try {
      const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
      const result = await documentService.deleteDocument(
        documentId,
        user.uid,
        user.role,
        companyId
      );

      if (result.success) {
        toast.success('Document deleted successfully');
        setShowDeleteModal(false);
        setSelectedItem(null);
        loadDocumentData({ forceRefresh: true }); // Reload data (bypass cache for real-time UX)
      }
    } catch (error) {
      console.error('Error deleting document:', error);
      toast.error(error.message);
    }
  };

  // Process employee document data based on user role
  const processEmployeeDocumentData = async (documentsData, requestsData) => {
    // Build employee map from paginatedUsers first (base list of all company employees)
    const employeeMap = new Map();

    paginatedUsers.forEach((u) => {
      employeeMap.set(u.id, {
        userId: u.id,
        userInfo: u,
        documents: [],
        requests: [],
        stats: { total: 0, approved: 0, pendingUpload: 0, pendingApproval: 0, declined: 0 }
      });
    });

    // Deduplicate documents: If multiple documents exist for the same request ID, keep the latest one
    const latestDocsMap = new Map();
    (documentsData || []).forEach(doc => {
      const key = doc.requestId || doc.id;
      const existing = latestDocsMap.get(key);
      const currentUpdate = new Date(doc.updatedAt || doc.uploadedAt || doc.createdAt || 0);
      const existingUpdate = existing ? new Date(existing.updatedAt || existing.uploadedAt || existing.createdAt || 0) : null;

      if (!existing || currentUpdate > existingUpdate) {
        latestDocsMap.set(key, doc);
      }
    });

    const deduplicatedDocs = Array.from(latestDocsMap.values());

    deduplicatedDocs.forEach(document => {
      const userId = document.employeeId || document.userId;
      if (!userId) return;

      // Create a placeholder entry if the user isn't in paginatedUsers yet
      if (!employeeMap.has(userId)) {
        const embeddedUser = document.employee || document.user || {};
        const name = embeddedUser.displayName || 
                     (embeddedUser.firstName ? `${embeddedUser.firstName} ${embeddedUser.lastName || ''}`.trim() : '') || 
                     'Unknown User';
        employeeMap.set(userId, {
          userId,
          userInfo: {
            id: userId,
            displayName: name,
            email: embeddedUser.email || '',
            primaryRole: embeddedUser.role || embeddedUser.primaryRole || 'Employee',
            department: embeddedUser.department || 'Development',
            ...embeddedUser
          },
          documents: [],
          requests: [],
          stats: { total: 0, approved: 0, pendingUpload: 0, pendingApproval: 0, declined: 0 }
        });
      }

      const employee = employeeMap.get(userId);
      employee.documents.push(document);
      employee.stats.total++;

      const status = (document.status || '').toLowerCase().replace(/[\s_-]+/g, '');
      if (status === 'approved' || status === 'completed') {
        employee.stats.approved++;
      } else if (status === 'uploaded' || status === 'pendingapproval' || status === 'pending_approval' || status === 'awaitingreview') {
        employee.stats.pendingApproval++;
      } else if (status === 'declined' || status === 'rejected') {
        employee.stats.declined++;
      }
    });

    // Add requests to users, but deduplicate by title if a document exists for that title.
    // Also create placeholder entries for request owners not yet in the map.
    (requestsData || []).forEach(request => {
      const userId = request.employeeId || request.userId;
      if (!userId) return;

      // Create placeholder if the request owner isn't in paginatedUsers either
      if (!employeeMap.has(userId)) {
        const embeddedUser = request.employee || request.user || {};
        const name = embeddedUser.displayName || 
                     (embeddedUser.firstName ? `${embeddedUser.firstName} ${embeddedUser.lastName || ''}`.trim() : '') || 
                     'Unknown User';
        employeeMap.set(userId, {
          userId,
          userInfo: {
            id: userId,
            displayName: name,
            email: embeddedUser.email || '',
            primaryRole: embeddedUser.role || embeddedUser.primaryRole || 'Employee',
            department: embeddedUser.department || 'Development',
            ...embeddedUser
          },
          documents: [],
          requests: [],
          stats: { total: 0, approved: 0, pendingUpload: 0, pendingApproval: 0, declined: 0 }
        });
      }

      const employee = employeeMap.get(userId);

      // Deduplicate: skip request if a document already covers it (by requestId or title)
      const hasDocById = employee.documents.some(doc => doc.requestId === request.id);
      const requestTitle = (request.documentTitle || request.documentType || '').toLowerCase().trim();
      const hasDocByTitle = employee.documents.some(doc =>
        (doc.documentTitle || doc.documentType || '').toLowerCase().trim() === requestTitle
      );

      if (!hasDocById && !hasDocByTitle) {
        employee.requests.push(request);
        const reqStatus = (request.status || '').toLowerCase().replace(/[\s_-]+/g, '');
        if (reqStatus === 'pending' || reqStatus === 'awaitingupload') {
          employee.stats.total++;
          employee.stats.pendingUpload++;
        }
      }
    });

    return Array.from(employeeMap.values());
  };

  // Get employee document data for Employee Documents tab (uses cached state)
  const getEmployeeTrainingData = () => {
    return employeeTrainingData || [];
  };

  // Get company users for request creation
  const getCompanyUsers = async () => {
    try {
      const { data } = await hrApiClient.get('/hr/employees', {
        params: { limit: 1000, status: 'active' }
      });
      
      const mergedUsers = data.employees || data || [];

      if (user.role === 'teamManager') {
        // Team managers can only see their managed employees
        const managedIds = await getManagedEmployeeIdsForManager(user.uid, companyId);

        if (managedIds.size === 0) {
          return [];
        }

        // Filter to only managed employees (exclude current user)
        return mergedUsers.filter(u => {
          if (!managedIds.has(u.id)) return false;
          if (u.id === user.uid) return false;
          return true;
        });
      } else {
        // For elevated roles
        // Exclude current user from the list
        return mergedUsers.filter(u => u.id !== user.uid);
      }
    } catch (error) {
      console.error('Error getting company users:', error);
      return [];
    }
  };

  // Helper functions
  const getStatusVariant = (status) => {
    switch (status) {
      case 'approved': return 'success';
      case 'uploaded': return 'warning';
      case 'pending': return 'info';
      case 'declined': return 'danger';
      default: return 'secondary';
    }
  };

  const getStatusDisplay = (status) => {
    switch (status) {
      case 'pending': return 'Pending Upload';
      case 'uploaded': return 'Pending Approval';
      case 'approved': return 'Approved';
      case 'declined': return 'Declined';
      default: return status;
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';

    let date;

    // Handle different timestamp formats
    if (timestamp.toDate) {
      // Firebase Timestamp object
      date = timestamp.toDate();
    } else if (timestamp.seconds) {
      // Firebase Timestamp object in serialized format
      date = new Date(timestamp.seconds * 1000);
    } else if (typeof timestamp === 'string') {
      // ISO string or date string
      date = new Date(timestamp);
    } else if (typeof timestamp === 'number') {
      // Unix timestamp (milliseconds or seconds)
      date = new Date(timestamp < 10000000000 ? timestamp * 1000 : timestamp);
    } else {
      // Fallback
      date = new Date(timestamp);
    }

    // Check if date is valid
    if (isNaN(date.getTime())) {
      return 'Invalid Date';
    }

    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  };

  const pretty = (role) =>
    role.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());





  // Render My Documents Content (for employees)
  // allUserItems and filteredMyItems are computed at the top level (Rules of Hooks)
  const renderMyDocuments = () => {

    if (loading) {
      return (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, index) => (
              <div key={index} className="animate-pulse bg-white border border-border-primary rounded-base p-4">
                <div className="h-4 bg-gray-200 rounded mb-2"></div>
                <div className="h-8 bg-gray-200 rounded mb-2"></div>
                <div className="h-3 bg-gray-200 rounded"></div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-3xl">

        {/* Document Management Section */}
        <div className="bg-white border border-border-primary rounded-base p-4xl space-y-4xl">
          <div>
            <h2 className="text-2xl font-bold text-text-primary mb-1">My Documents</h2>
            <p className="text-text-secondary">Manage your document requests and uploads.</p>
          </div>

          {/* Search and Filter */}
          <div className="flex flex-col sm:flex-row gap-3xl">
            <div className="relative flex-1">
              <Search className="absolute left-base top-1/2 -translate-y-1/2 h-5 w-5 text-text-secondary" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search my documents..."
                id="my-docs-search"
                aria-label="Search my documents"
                className="w-full h-12 pl-12 pr-base border border-border-secondary rounded-lg text-md focus:outline-none focus:border-border-accent-purple"
              />
            </div>
            <div className="flex items-center gap-md">
              <label htmlFor="my-docs-filter" className="text-text-secondary whitespace-nowrap">Filtered by:</label>
              <div className="relative">
                <select
                  id="my-docs-filter"
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="h-12 px-base pr-10 border border-border-secondary rounded-lg text-md appearance-none focus:outline-none focus:border-border-accent-purple"
                >
                  <option value="all">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="uploaded">Uploaded</option>
                  <option value="approved">Approved</option>
                  <option value="declined">Declined</option>
                </select>
                <ChevronDown className="absolute right-base top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Documents List */}
          <div className="space-y-3xl">
            {allUserItems.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">No documents</h3>
                <p className="text-gray-600">You don't have any document requests at the moment.</p>
              </div>
            ) : (
              filteredMyItems.map((item) => (
                <div key={item.id} className="border border-border-primary rounded-base p-4xl">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
                    <div className="flex items-start gap-3 flex-1">
                      <div className="w-12 h-12 bg-bg-accent-purple-light rounded-lg flex items-center justify-center flex-shrink-0">
                        <FileText className="h-6 w-6 text-text-accent-purple" />
                      </div>
                      <div className="flex-1">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-2">
                          <h3 className="text-lg font-semibold text-text-primary">{item.documentTitle}</h3>
                          <Badge variant={getStatusVariant(item.status)}>
                            {getStatusDisplay(item.status)}
                          </Badge>
                        </div>
                        <p className="text-text-secondary mb-2">{item.fileName || item.documentType}</p>
                        <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-sm text-text-secondary">
                          <span>Created: {formatDate(item.createdAt)}</span>
                          {item.uploadedAt && (
                            <>
                              <span className="hidden sm:inline">•</span>
                              <span>Uploaded: {formatDate(item.uploadedAt)}</span>
                            </>
                          )}
                          {item.approvedAt && (
                            <>
                              <span className="hidden sm:inline">•</span>
                              <span>Approved: {formatDate(item.approvedAt)}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-md sm:ml-4">
                      {/* Upload Document button for pending requests */}
                      {item.status === 'pending' && (
                        <Button
                          variant="gradient"
                          onClick={() => {
                            setSelectedItem(item);
                            setShowUploadModal(true);
                          }}
                        >
                          Upload Document
                        </Button>
                      )}

                      {/* Reupload button for declined documents */}
                      {item.status === 'declined' && (
                        <Button
                          variant="outline-primary"
                          onClick={() => {
                            setSelectedItem(item);
                            setShowUploadModal(true);
                          }}
                        >
                          Reupload Document
                        </Button>
                      )}

                      {/* View Details button - always available */}
                      <Button
                        variant="outline-secondary"
                        onClick={() => {
                          setSelectedItem(item);
                          setShowViewModal(true);
                        }}
                      >
                        View Details
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  };

  // Render Employee Documents Content (by employee view)
  const renderEmployeeDocuments = () => {
    const employeeData = getEmployeeTrainingData();

    if (loading || loadingEmployeeData) {
      return (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, index) => (
              <div key={index} className="animate-pulse bg-white border border-border-primary rounded-base p-4">
                <div className="h-4 bg-gray-200 rounded mb-2"></div>
                <div className="h-8 bg-gray-200 rounded mb-2"></div>
                <div className="h-3 bg-gray-200 rounded"></div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    // filteredEmployeeData is computed at the top level of the component (Rules of Hooks)
    return (
      <div className="space-y-6">

        {/* Search and Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <input
              type="text"
              placeholder="Search employees..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              id="employee-docs-search"
              aria-label="Search employees"
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>
          <div className="flex gap-2">
            <label htmlFor="dept-filter" className="sr-only">Filter by Department</label>
            <select
              id="dept-filter"
              value={filterDepartment}
              onChange={(e) => setFilterDepartment(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              <option value="All Departments">All Departments</option>
              <option value="Development">Development</option>
              <option value="HR">HR</option>
              <option value="Finance">Finance</option>
              <option value="Marketing">Marketing</option>
            </select>
            {userCapabilities.canCreateRequest && (
              <div className="flex gap-2">
                <Button
                  variant="outline-primary"
                  onClick={() => setShowManageTypesModal(true)}
                  icon={FileText}
                >
                  Manage Types
                </Button>
                <Button
                  variant="gradient"
                  onClick={() => setShowAddRequestModal(true)}
                  icon={Plus}
                >
                  Add Request
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Employee List */}
        <div className="space-y-4">
          {filteredEmployeeData.map((employee) => (
            <div key={employee.userId} className="bg-white border border-border-accent-purple rounded-lg p-4xl shadow-sm hover:shadow-md transition-shadow">
              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-start gap-6">
                {/* Employee Info */}
                <div className="flex items-center gap-4 flex-1">
                  <div className="w-12 h-12 bg-bg-accent-purple-light rounded-full flex items-center justify-center flex-shrink-0">
                    <User className="h-6 w-6 text-text-accent-purple" />
                  </div>
                  <div>
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <h3 className="text-lg font-semibold text-text-primary">
                        {employee.userInfo.displayName ||
                          `${employee.userInfo.firstName || ''} ${employee.userInfo.lastName || ''}`.trim() ||
                          ''}
                      </h3>
                      {/* Skip unidentified users in the list */}
                      {(() => {
                        const name = employee.userInfo.displayName ||
                          `${employee.userInfo.firstName || ''} ${employee.userInfo.lastName || ''}`.trim();
                        if (!name || name === 'Unknown User') return null;
                      })()}
                      <Badge variant={['Manager', 'Admin Manager', 'HR Manager', 'Contract Manager', 'Site Manager', 'Senior Manager'].includes(getRoleJobTitle(employee.userInfo.primaryRole)) ? 'role' : 'info'}>
                        {getRoleJobTitle(employee.userInfo.primaryRole)}
                      </Badge>
                    </div>
                    <p className="text-sm text-text-secondary mb-2">{employee.userInfo.email}</p>
                    <div className="flex flex-wrap items-center gap-4 text-sm">
                      <span className="flex items-center gap-1 text-purple-500">
                        <Briefcase className="h-3 w-3" />
                        {employee.userInfo.department || 'Development'}
                      </span>
                      <span className="flex items-center gap-1 text-blue-500">
                        <Calendar className="h-3 w-3" />
                        Hired: {employee.userInfo.hireDate || '2022-03-15'}
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
                    <p className="text-xs text-text-secondary">Total<br />Documents</p>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <CheckCircle className="h-5 w-5 text-green-500" />
                      <p className="text-3xl font-bold text-green-500">{employee.stats.approved}</p>
                    </div>
                    <p className="text-xs text-text-secondary">Approved<br />Review</p>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <AlertTriangle className="h-5 w-5 text-orange-500" />
                      <p className="text-3xl font-bold text-orange-500">{employee.stats.pendingApproval}</p>
                    </div>
                    <p className="text-xs text-text-secondary">Pending<br />Review</p>
                  </div>
                  <Button
                    variant="outline-primary"
                    onClick={() => {
                      // Preload data for instant page loading
                      const employeeRequests = requests.filter(r => r.userId === employee.userId);
                      const employeeDocuments = documents.filter(d => d.userId === employee.userId);

                      navigate(`/documents/${employee.userId}`, {
                        state: {
                          preloadedEmployee: employee.userInfo,
                          preloadedRequests: employeeRequests,
                          preloadedDocuments: employeeDocuments
                        }
                      });
                    }}
                    cn="sm:max-w-36 w-full"
                  >
                    View Documents
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {employeeData.length === 0 && (
          <div className="text-center py-12">
            <FileText className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">No employees</h3>
            <p className="mt-1 text-sm text-gray-500">
              No employees found matching your criteria.
            </p>
          </div>
        )}
      </div>
    );
  };



  // Skeleton-first: always show layout so page feels instant; content shows skeleton until data loads
  if (error) {
    return (
      <div className="h-screen flex flex-col overflow-hidden">
        <Header
          title={`${pretty(user.role)} Dashboard`}
          subtitle="Manage employee documents and requests from one place."
        />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">Error Loading Data</h3>
            <p className="text-gray-600 mb-4">{error}</p>
            <Button onClick={() => loadDocumentData()}>Try Again</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Header
        title={`${pretty(user.role)} Dashboard`}
        subtitle="Manage employee documents and requests from one place."
      />

      <div className="flex-1 overflow-y-auto p-4 md:p-3xl scrollbar-custom">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Page Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Document Management</h1>
              <p className="text-sm text-gray-600 mt-1">Manage employee document requests and approvals</p>
            </div>
          </div>

          {/* Statistics Cards — skeleton when loading for instant perceived load */}
          {loading ? (
            <StatsLoadingState className="gap-4" />
          ) : (() => {
            const myRequests = requests.filter(r => r.userId === user.uid);
            const myDocuments = documents.filter(d => d.userId === user.uid);

            const myStats = {
              // [FIX] Use allUserItems which properly handles request-to-document lifecycle
              totalDocuments: allUserItems.length,
              pendingRequests: allUserItems.filter(item => (item.status || '').toLowerCase() === 'pending').length,
              pendingApproval: allUserItems.filter(item => (item.status || '').toLowerCase() === 'uploaded').length,
              approvedDocuments: allUserItems.filter(item => (item.status || '').toLowerCase() === 'approved').length,
            };

            // Calculate aggregate stats for visible employees
            const employeeData = getEmployeeTrainingData();
            const filteredEmployees = employeeData.filter(employee => {
              const role = (employee?.userInfo?.primaryRole || '').toLowerCase();
              if (role === 'sitemanager' || role === 'seniormanager' || employee.userId === user.uid) return false;
              if (searchQuery) {
                const name = (employee.userInfo.displayName || `${employee.userInfo.firstName || ''} ${employee.userInfo.lastName || ''}`).toLowerCase();
                if (!name.includes(searchQuery.toLowerCase())) return false;
              }
              return true;
            });

            const employeeStats = filteredEmployees.reduce((acc, emp) => {
              acc.totalDocuments += emp.stats.total;
              acc.pendingRequests += emp.stats.pendingUpload;
              acc.pendingApproval += emp.stats.pendingApproval;
              acc.approvedDocuments += emp.stats.approved;
              return acc;
            }, { totalDocuments: 0, pendingRequests: 0, pendingApproval: 0, approvedDocuments: 0 });

            const statsToShow = (activeTab === 'My Documents') ? myStats : employeeStats;

            return (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                  title="Total Documents"
                  value={statsToShow.totalDocuments?.toString() || '0'}
                  subtitle={activeTab === 'My Documents' ? "My documents" : "All documents"}
                  icon={<FileText className="h-6 w-6 text-blue-500" />}
                  iconBgColor="bg-blue-50"
                  id="total-documents-stat"
                />
                <StatCard
                  title="Pending Upload"
                  value={statsToShow.pendingRequests?.toString() || '0'}
                  subtitle="Awaiting documents"
                  icon={<Clock className="h-6 w-6 text-yellow-500" />}
                  iconBgColor="bg-yellow-50"
                  id="pending-upload-stat"
                />
                <StatCard
                  title="Pending Approval"
                  value={statsToShow.pendingApproval?.toString() || '0'}
                  subtitle="Awaiting review"
                  icon={<AlertCircle className="h-6 w-6 text-orange-500" />}
                  iconBgColor="bg-orange-50"
                  id="pending-approval-stat"
                />
                <StatCard
                  title="Approved"
                  value={statsToShow.approvedDocuments?.toString() || '0'}
                  subtitle="Completed"
                  icon={<CheckCircle className="h-6 w-6 text-green-500" />}
                  iconBgColor="bg-green-50"
                  id="approved-stat"
                />
              </div>
            );
          })()}

          {/* Tabs */}
          {availableTabs.length > 1 && (
            <Tabs
              tabs={availableTabs}
              activeTab={activeTab}
              onTabChange={setActiveTab}
            />
          )}

          {/* Tab Content */}
          {activeTab === 'My Documents' && renderMyDocuments()}
          {activeTab === 'Employee Documents' && renderEmployeeDocuments()}
        </div>
      </div>

      {/* Modals */}
      <AddDocumentRequestModal
        isOpen={showAddRequestModal}
        onClose={() => setShowAddRequestModal(false)}
        onSubmit={handleCreateRequest}
        getCompanyUsers={getCompanyUsers}
        companyId={companyId}
        preselectedEmployee={null}
      />

      <ViewDocumentModal
        isOpen={showViewModal}
        onClose={() => {
          setShowViewModal(false);
          setSelectedItem(null);
        }}
        item={selectedItem}
      />

      <UploadDocumentModal
        isOpen={showUploadModal}
        onClose={() => {
          setShowUploadModal(false);
          setSelectedItem(null);
        }}
        onSubmit={(file, notes) => handleUploadDocument(selectedItem?.requestId || selectedItem?.id, file, notes)}
        request={selectedItem}
      />

      <ApprovalConfirmationModal
        isOpen={showApproveModal}
        onClose={() => {
          setShowApproveModal(false);
          setSelectedItem(null);
        }}
        onConfirm={handleApproveDocument}
        item={selectedItem}
        title="Approve Document"
        description="Are you sure you want to approve this document?"
        confirmButtonText="Approve"
        type="approve"
      />

      <ApprovalConfirmationModal
        isOpen={showDeclineModal}
        onClose={() => {
          setShowDeclineModal(false);
          setSelectedItem(null);
        }}
        onConfirm={handleDeclineDocument}
        item={selectedItem}
        title="Decline Document"
        description="Please provide a reason for declining this document."
        confirmButtonText="Decline"
        type="decline"
        requireReason={true}
      />

      <DeleteConfirmationModal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setSelectedItem(null);
        }}
        onConfirm={() => handleDeleteDocument(selectedItem?.id)}
        item={selectedItem}
        title="Delete Document"
        description="Are you sure you want to delete this document? This action cannot be undone."
        confirmButtonText="Delete"
      />

      <ManageDocumentTypesModal
        isOpen={showManageTypesModal}
        onClose={() => setShowManageTypesModal(false)}
        companyId={companyId}
        onTypesUpdated={() => {
          // Optional: refresh any data that depends on document types
        }}
      />
    </div>
  );
};

export default DocumentManagementPage;