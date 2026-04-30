import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { Search, FileText, ArrowLeft, CheckCircle, AlertTriangle, XCircle, Upload, Plus, ChevronDown } from 'lucide-react';
import Header from '../../components/layout/Header';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import StatCard from '../../components/shared/StatCard';
import ViewDocumentModal from '../../components/modals/ViewDocumentModal';
import EditDocumentModal from '../../components/modals/EditDocumentModal';
import AddDocumentRequestModal from '../../components/modals/AddDocumentRequestModal';
import UploadDocumentModal from '../../components/modals/UploadDocumentModal';
import ApprovalConfirmationModal from '../../components/modals/ApprovalConfirmationModal';
import DeleteConfirmationModal from '../../components/modals/DeleteConfirmationModal';
import { useAuth } from '../../hooks/useAuth';
import { useCache } from '../../contexts/CacheContext';
import { documentService } from '../../services/documentService';
import { getUserById } from '../../services/users';
import { toast } from 'react-toastify';
import { getRoleJobTitle } from '../../utils/dataParser';
import { StatsLoadingState } from '../../components/ui/DashboardLoadingState';

const EmployeeDocumentManagementPage = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { id: employeeId } = useParams();
    const { user } = useAuth();
    const { getItem, setItem, clearItem } = useCache();

    const preloadedEmployee = location?.state?.preloadedEmployee || null;
    const preloadedRequests = location?.state?.preloadedRequests || null;
    const preloadedDocuments = location?.state?.preloadedDocuments || null;

    const hasPreloaded = useMemo(() => {
        return Array.isArray(preloadedRequests) && Array.isArray(preloadedDocuments);
    }, [preloadedRequests, preloadedDocuments]);

    // State management
    const [loading, setLoading] = useState(!hasPreloaded);
    const [refreshing, setRefreshing] = useState(false);
    const [employee, setEmployee] = useState(null);
    const [requests, setRequests] = useState([]);
    const [documents, setDocuments] = useState([]);
    const [error, setError] = useState(null);

    // UI state
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState('all');
    const [showViewModal, setShowViewModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [showAddRequestModal, setShowAddRequestModal] = useState(false);
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [showApproveModal, setShowApproveModal] = useState(false);
    const [showDeclineModal, setShowDeclineModal] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [selectedItem, setSelectedItem] = useState(null);

    // User capabilities based on role
    const userCapabilities = {
        canCreateRequest: ['siteManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor', 'teamManager'].includes(user?.role),
        canApproveDocument: ['siteManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor', 'teamManager'].includes(user?.role)
    };

    const isViewingOwnDocuments = () => {
        return employeeId === user?.uid;
    };

    // Hydrate instantly from route state
    useEffect(() => {
        if (!user || !employeeId) return;

        if (hasPreloaded) {
            setLoading(false);
        }

        // Fetch employee data if not preloaded
        if (!employee) {
            loadEmployeeDocumentData();
        }
    }, [user, employeeId]);

    // REAL-TIME SUBSCRIPTIONS: Join documents and requests from Firestore live
    useEffect(() => {
        if (!user || !user.companyId || !employeeId) return;

        const companyIdRaw = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;

        console.log('[EmployeeDocumentManagement] Setting up real-time subscriptions for:', employeeId);

        // Subscribe to documents
        const unsubscribeDocs = documentService.subscribeUserDocuments(companyIdRaw, employeeId, (result) => {
            if (result.success) {
                console.log('[EmployeeDocumentManagement] Docs updated:', result.data.length);
                setDocuments(result.data);
            }
        });

        // Subscribe to requests
        const unsubscribeRequests = documentService.subscribeUserRequests(companyIdRaw, employeeId, (result) => {
            if (result.success) {
                console.log('[EmployeeDocumentManagement] Requests updated:', result.data.length);
                setRequests(result.data);
            }
        });

        return () => {
            console.log('[EmployeeDocumentManagement] Cleaning up subscriptions');
            unsubscribeDocs();
            unsubscribeRequests();
        };
    }, [user?.companyId, employeeId]);

    const buildEmployeeFromUserDoc = (userDoc) => {
        if (!userDoc) return null;
        const name = userDoc.displayName || `${userDoc.firstName || ''} ${userDoc.lastName || ''}`.trim() || '';
        return {
            id: employeeId,
            name,
            email: userDoc.email || 'unknown@company.com',
            role: userDoc.primaryRole || 'Employee',
            department: userDoc.department || 'Development',
            hireDate: userDoc.hireDate || '2022-03-15',
            employeeId: userDoc.employeeId || `EMP${new Date().getFullYear()}${employeeId.slice(-4)}`,
            jobTitle: userDoc.jobTitle || getRoleJobTitle(userDoc.primaryRole),
            manager: userDoc.reportsTo || 'Not Assigned',
            phone: userDoc.phone || 'Not Provided',
            address: userDoc.address || 'Not Provided'
        };
    };

    const loadEmployeeDocumentData = async ({ background = false } = {}) => {
        if (!user || !user.companyId || !employeeId) return;

        const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
        const cacheKey = `documents_${companyId}_${employeeId}`;

        try {
            if (background) {
                setRefreshing(true);
            } else {
                setLoading(true);
            }
            setError(null);

            // Try to get from cache first for non-background loads
            if (!background) {
                const cached = getItem?.(cacheKey);
                if (cached?.employee && cached?.requests && cached?.documents) {
                    setEmployee(cached.employee);
                    setRequests(cached.requests);
                    setDocuments(cached.documents);
                    setLoading(false);
                }
            }

            // Fetch fresh data from Firestore
            const userData = await getUserById(employeeId);

            // Set employee data
            let employeeData = null;
            if (userData) {
                employeeData = {
                    id: employeeId,
                    name: userData.displayName || `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || '',
                    email: userData.email || 'unknown@company.com',
                    role: userData.primaryRole || 'Employee',
                    department: userData.department || 'Development',
                    hireDate: userData.hireDate || '2022-03-15',
                    employeeId: userData.employeeId || `EMP${new Date().getFullYear()}${employeeId.slice(-4)}`,
                    jobTitle: userData.jobTitle || getRoleJobTitle(userData.primaryRole),
                    manager: userData.reportsTo || 'Not Assigned',
                    phone: userData.phone || 'Not Provided',
                    address: userData.address || 'Not Provided'
                };
                setEmployee(employeeData);
            } else {
                throw new Error('Employee not found');
            }

            // Note: documents and requests are now handled by real-time subscriptions

            // Update cache with fresh data
            if (employeeData) {
                setItem?.(cacheKey, {
                    employee: employeeData
                }, 7 * 60 * 1000); // 7 minutes cache
            }

        } catch (error) {
            console.error('Error loading employee document data:', error);
            setError(error.message);
            toast.error('Failed to load employee document data');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const handleBack = () => {
        navigate('/documents', { state: { activeTab: 'Employee Documents' } });
    };

    const handleCreateRequest = async (requestData) => {
        try {
            const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;

            // Set the userId to the current employee
            const requestWithEmployee = {
                ...requestData,
                userId: employeeId
            };

            const result = await documentService.createDocumentRequest(
                requestWithEmployee,
                user.uid,
                companyId,
                user.role
            );

            if (result.success) {
                toast.success('Document request created successfully');
                setShowAddRequestModal(false);

                // Clear cache and reload data
                const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
                const cacheKey = `documents_${companyId}_${employeeId}`;
                clearItem?.(cacheKey);

                await loadEmployeeDocumentData();
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

                // Clear cache and reload data
                const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
                const cacheKey = `documents_${companyId}_${employeeId}`;
                clearItem?.(cacheKey);

                await loadEmployeeDocumentData();
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

                // Clear cache and reload data
                const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
                const cacheKey = `documents_${companyId}_${employeeId}`;
                clearItem?.(cacheKey);

                await loadEmployeeDocumentData();
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

                // Clear cache and reload data
                const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
                const cacheKey = `documents_${companyId}_${employeeId}`;
                clearItem?.(cacheKey);

                await loadEmployeeDocumentData();
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

                // Clear cache and reload data
                const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
                const cacheKey = `documents_${companyId}_${employeeId}`;
                clearItem?.(cacheKey);

                await loadEmployeeDocumentData();
            }
        } catch (error) {
            console.error('Error deleting document:', error);
            toast.error(error.message);
        }
    };

    const handleSaveDocument = async (updatedDoc) => {
        try {
            if (!updatedDoc?.id) return;

            const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
            const result = await documentService.updateDocument(
                updatedDoc.id,
                {
                    documentTitle: updatedDoc.documentTitle,
                    description: updatedDoc.description,
                    documentType: updatedDoc.documentType
                },
                user.uid,
                user.role,
                companyId
            );

            if (result.success) {
                toast.success('Document updated successfully');
                setShowEditModal(false);
                setSelectedItem(null);

                // Clear cache and reload data
                const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
                const cacheKey = `documents_${companyId}_${employeeId}`;
                clearItem?.(cacheKey);

                await loadEmployeeDocumentData();
            }
        } catch (error) {
            console.error('Error updating document:', error);
            toast.error(error.message);
        }
    };

    // Mock function for getting company users (for the modal)
    const getCompanyUsers = async () => {
        // Return just this employee since we're creating a request for them
        return employee ? [employee] : [];
    };

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
        try {
            if (typeof timestamp.toDate === 'function') {
                date = timestamp.toDate();
            } else if (typeof timestamp._seconds === 'number') {
                date = new Date(timestamp._seconds * 1000);
            } else if (typeof timestamp === 'number') {
                date = new Date(timestamp);
            } else {
                date = new Date(timestamp);
            }
        } catch {
            return 'N/A';
        }

        if (!date || isNaN(date.getTime())) return 'N/A';

        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
    };

    const pretty = (role) =>
        role.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());

    // Get employee statistics
    const getEmployeeStats = () => {
        // Deduplicate documents: If multiple documents exist for the same request ID, keep the latest one
        const latestDocsMap = new Map();
        documents.forEach(doc => {
            const key = doc.requestId || doc.id;
            const existing = latestDocsMap.get(key);
            const currentUpdate = new Date(doc.updatedAt || doc.uploadedAt || doc.createdAt || 0);
            const existingUpdate = existing ? new Date(existing.updatedAt || existing.uploadedAt || existing.createdAt || 0) : null;

            if (!existing || currentUpdate > existingUpdate) {
                latestDocsMap.set(key, doc);
            }
        });
        const deduplicatedDocs = Array.from(latestDocsMap.values());

        // Create a set of titles from documents to deduplicate by title as fallback
        const documentTitles = new Set();
        deduplicatedDocs.forEach(doc => {
            const title = (doc.documentTitle || doc.documentType || '').toLowerCase().trim();
            if (title) documentTitles.add(title);
        });

        // Filter out requests that have corresponding documents (by ID or Title)
        const requestsWithoutDocuments = requests.filter(request => {
            // Priority 1: Deduplicate by requestId link
            const hasDocById = deduplicatedDocs.some(doc => doc.requestId === request.id);
            if (hasDocById) return false;

            // Priority 2: Deduplicate by exact Title/Type match (fallback for broken links)
            const requestTitle = (request.documentTitle || request.documentType || '').toLowerCase().trim();
            return !documentTitles.has(requestTitle);
        });

        const stats = {
            total: requestsWithoutDocuments.length + deduplicatedDocs.length,
            pending: requestsWithoutDocuments.filter(r => {
                const s = (r.status || '').toLowerCase().replace(/[\s_-]+/g, '');
                return s === 'pending' || s === 'awaitingupload';
            }).length,
            uploaded: deduplicatedDocs.filter(d => {
                const s = (d.status || '').toLowerCase().replace(/[\s_-]+/g, '');
                return s === 'uploaded' || s === 'pendingapproval' || s === 'pending_approval' || s === 'awaitingreview';
            }).length,
            approved: deduplicatedDocs.filter(d => {
                const s = (d.status || '').toLowerCase().replace(/[\s_-]+/g, '');
                return s === 'approved' || s === 'completed';
            }).length,
            declined: deduplicatedDocs.filter(d => {
                const s = (d.status || '').toLowerCase().replace(/[\s_-]+/g, '');
                return s === 'declined' || s === 'rejected';
            }).length
        };
        return stats;
    };

    // Filter functions
    const getFilteredItems = () => {
        // Deduplicate documents: If multiple documents exist for the same request ID, keep the latest one
        const latestDocsMap = new Map();
        documents.forEach(doc => {
            const key = doc.requestId || doc.id;
            const existing = latestDocsMap.get(key);
            const currentUpdate = new Date(doc.updatedAt || doc.uploadedAt || doc.createdAt || 0);
            const existingUpdate = existing ? new Date(existing.updatedAt || existing.uploadedAt || existing.createdAt || 0) : null;

            if (!existing || currentUpdate > existingUpdate) {
                latestDocsMap.set(key, doc);
            }
        });
        const deduplicatedDocs = Array.from(latestDocsMap.values());

        // Create a set of titles from documents to deduplicate by title as fallback
        const documentTitles = new Set();
        deduplicatedDocs.forEach(doc => {
            const title = (doc.documentTitle || doc.documentType || '').toLowerCase().trim();
            if (title) documentTitles.add(title);
        });

        // Filter out requests that have corresponding documents (by ID or Title)
        const requestsWithoutDocuments = requests.filter(request => {
            // Priority 1: Deduplicate by requestId link
            const hasDocById = deduplicatedDocs.some(doc => doc.requestId === request.id);
            if (hasDocById) return false;

            // Priority 2: Deduplicate by exact Title/Type match (fallback for broken links)
            const requestTitle = (request.documentTitle || request.documentType || '').toLowerCase().trim();
            return !documentTitles.has(requestTitle);
        });

        const allItems = [...requestsWithoutDocuments, ...deduplicatedDocs];
        let filtered = allItems;

        if (searchQuery) {
            filtered = filtered.filter(item =>
                item.documentTitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
                item.documentType.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (item.fileName && item.fileName.toLowerCase().includes(searchQuery.toLowerCase()))
            );
        }

        if (filterStatus !== 'all') {
            filtered = filtered.filter(item => item.status === filterStatus);
        }

        return filtered.sort((a, b) => {
            const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
            const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
            return dateB - dateA;
        });
    };

    // Early return for loading or no user
    if (!user) {
        return (
            <div className="h-screen flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
            </div>
        );
    }

    // Skeleton-first: show layout immediately; content area shows skeleton until data loads
    if (error) {
        return (
            <div className="h-screen flex flex-col overflow-hidden">
                <Header
                    title={`${pretty(user.role)} Dashboard`}
                    subtitle="Manage employee documents and requests."
                />
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-center">
                        <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 mb-2">Error Loading Data</h3>
                        <p className="text-gray-600 mb-4">{error}</p>
                        <Button onClick={() => loadEmployeeDocumentData()}>Try Again</Button>
                    </div>
                </div>
            </div>
        );
    }

    const employeeStats = getEmployeeStats();
    const filteredItems = getFilteredItems();

    return (
        <div className="h-screen flex flex-col overflow-hidden">
            <Header
                title={`${pretty(user.role)} Dashboard`}
                subtitle="Manage employee documents and requests."
            />

            <div className="flex-1 overflow-y-auto p-4 md:p-3xl scrollbar-custom">
                <div className="max-w-7xl mx-auto space-y-6">
                    {/* Back Button */}
                    <div className="flex items-center justify-between mb-4">
                        <button
                            onClick={handleBack}
                            className="flex items-center gap-2 text-text-primary hover:text-text-accent-purple transition-colors"
                        >
                            <ArrowLeft className="h-5 w-5" />
                            <span className="text-xl font-bold">Employee Document Management</span>
                        </button>
                        {refreshing && (
                            <div className="flex items-center gap-2 text-sm text-text-secondary">
                                <div className="animate-spin rounded-full h-4 w-4 border-b border-purple-600"></div>
                                Updating...
                            </div>
                        )}
                    </div>
                    <p className="text-sm text-text-secondary -mt-2">Manage employee documents and requests</p>

                    {/* Employee Information — skeleton when loading */}
                    {loading ? (
                        <div className="bg-white rounded-lg border border-gray-200 p-6 animate-pulse">
                            <div className="flex items-center space-x-4">
                                <div className="w-16 h-16 bg-gray-200 rounded-full" />
                                <div className="flex-1">
                                    <div className="h-6 bg-gray-200 rounded w-48 mb-2" />
                                    <div className="h-4 bg-gray-200 rounded w-32 mb-1" />
                                    <div className="h-4 bg-gray-200 rounded w-40" />
                                </div>
                            </div>
                        </div>
                    ) : employee && (
                        <div className="bg-white rounded-lg border border-gray-200 p-6">
                            <div className="flex items-start justify-between">
                                <div className="flex items-center space-x-4">
                                    <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center">
                                        <span className="text-xl font-semibold text-purple-600">
                                            {employee.name.charAt(0).toUpperCase()}
                                        </span>
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-semibold text-gray-900">{employee.name}</h2>
                                        <p className="text-gray-600">{employee.jobTitle}</p>
                                        <p className="text-sm text-gray-500">{employee.email}</p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-sm text-gray-500">Employee ID</p>
                                    <p className="font-medium text-gray-900">{employee.employeeId}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Statistics Cards — skeleton when loading */}
                    {loading ? (
                        <StatsLoadingState className="gap-4" />
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            <StatCard
                                title="Total Items"
                                value={employeeStats.total.toString()}
                                subtitle="All documents"
                                icon={<FileText className="h-6 w-6 text-blue-500" />}
                                iconBgColor="bg-blue-50"
                            />
                            <StatCard
                                title="Pending Upload"
                                value={employeeStats.pending.toString()}
                                subtitle="Awaiting documents"
                                icon={<AlertTriangle className="h-6 w-6 text-yellow-500" />}
                                iconBgColor="bg-yellow-50"
                            />
                            <StatCard
                                title="Pending Approval"
                                value={employeeStats.uploaded.toString()}
                                subtitle="Awaiting review"
                                icon={<Upload className="h-6 w-6 text-orange-500" />}
                                iconBgColor="bg-orange-50"
                            />
                            <StatCard
                                title="Approved"
                                value={employeeStats.approved.toString()}
                                subtitle="Completed"
                                icon={<CheckCircle className="h-6 w-6 text-green-500" />}
                                iconBgColor="bg-green-50"
                            />
                        </div>
                    )}

                    {/* Document Management Section — skeleton when loading */}
                    <div className="bg-white border border-border-primary rounded-base p-4xl space-y-4xl">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                            <div>
                                <h2 className="text-2xl font-bold text-text-primary mb-1">Document Management</h2>
                                <p className="text-text-secondary">Manage documents and requests for {loading ? '...' : employee?.name}.</p>
                            </div>
                            {userCapabilities.canCreateRequest && (
                                <Button
                                    variant="gradient"
                                    onClick={() => setShowAddRequestModal(true)}
                                    icon={Plus}
                                >
                                    Add Request
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
                                    placeholder="Search documents..."
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

                        {/* Documents List — skeleton when loading */}
                        <div className="space-y-3xl">
                            {loading ? (
                                <div className="space-y-4">
                                    {[1, 2, 3].map((i) => (
                                        <div key={i} className="animate-pulse flex items-center gap-4 p-4 border border-gray-200 rounded-lg">
                                            <div className="w-10 h-10 bg-gray-200 rounded" />
                                            <div className="flex-1">
                                                <div className="h-4 bg-gray-200 rounded w-48 mb-2" />
                                                <div className="h-3 bg-gray-200 rounded w-32" />
                                            </div>
                                            <div className="h-8 bg-gray-200 rounded w-24" />
                                        </div>
                                    ))}
                                </div>
                            ) : filteredItems.length === 0 ? (
                                <div className="text-center py-12">
                                    <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                                    <h3 className="text-lg font-medium text-gray-900 mb-2">No documents</h3>
                                    <p className="text-gray-600">
                                        {userCapabilities.canCreateRequest
                                            ? "Get started by creating a new document request."
                                            : "No documents found for this employee."
                                        }
                                    </p>
                                </div>
                            ) : (
                                filteredItems.map((item) => (
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
                                                {item.status === 'pending' && (isViewingOwnDocuments() || userCapabilities.canCreateRequest) && (
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
                                                {item.status === 'declined' && (isViewingOwnDocuments() || userCapabilities.canCreateRequest) && (
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

                                                {/* Approval buttons for managers */}
                                                {item.status === 'uploaded' && userCapabilities.canApproveDocument && !isViewingOwnDocuments() && (
                                                    <>
                                                        <Button
                                                            variant="solid-success"
                                                            onClick={() => {
                                                                setSelectedItem(item);
                                                                setShowApproveModal(true);
                                                            }}
                                                        >
                                                            Approve
                                                        </Button>
                                                        <Button
                                                            variant="outline-danger"
                                                            onClick={() => {
                                                                setSelectedItem(item);
                                                                setShowDeclineModal(true);
                                                            }}
                                                        >
                                                            Decline
                                                        </Button>
                                                    </>
                                                )}

                                                {/* Edit button - for managers or document owner */}
                                                {(userCapabilities.canApproveDocument || item.userId === user.uid) && (
                                                    <Button
                                                        variant="outline-secondary"
                                                        onClick={() => {
                                                            setSelectedItem(item);
                                                            setShowEditModal(true);
                                                        }}
                                                    >
                                                        Edit
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
            </div>

            {/* Modals */}
            <AddDocumentRequestModal
                isOpen={showAddRequestModal}
                onClose={() => setShowAddRequestModal(false)}
                onSubmit={handleCreateRequest}
                getCompanyUsers={getCompanyUsers}
                companyId={user?.companyId?.includes('/') ? user.companyId.split('/')[1] : user?.companyId}
                preselectedEmployee={employee}
            />

            <ViewDocumentModal
                isOpen={showViewModal}
                onClose={() => {
                    setShowViewModal(false);
                    setSelectedItem(null);
                }}
                item={selectedItem}
            />

            <EditDocumentModal
                isOpen={showEditModal}
                onClose={() => {
                    setShowEditModal(false);
                    setSelectedItem(null);
                }}
                document={selectedItem}
                onSave={handleSaveDocument}
                companyId={user?.companyId?.includes('/') ? user.companyId.split('/')[1] : user?.companyId}
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
                description="Are you sure you want to decline this document?"
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
        </div>
    );
};

export default EmployeeDocumentManagementPage;