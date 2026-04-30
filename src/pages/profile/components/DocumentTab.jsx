import { useState, useEffect, useCallback, useMemo } from "react";
import { ChevronDown, FileText, Search, CheckCircle, Clock } from "lucide-react";
import Badge from "../../../components/ui/Badge";
import Button from "../../../components/ui/Button";
import ViewDocumentModal from "../../../components/modals/ViewDocumentModal";
import UploadDocumentModal from "../../../components/modals/UploadDocumentModal";
import { useAuth } from "../../../hooks/useAuth";
import { useCache } from "../../../contexts/CacheContext";
import { documentService } from "../../../services/documentService";
import { toast } from 'react-toastify';

const DOCS_CACHE_TTL = 7 * 60 * 1000;

export const DocumentsTab = () => {
  const { user } = useAuth();
  const { getItem, setItem } = useCache();
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  // Debounced search to improve performance
  const debouncedSearch = useMemo(() => {
    const timeoutId = setTimeout(() => {
      // Search logic handled by filteredRequests/filteredDocuments
    }, 300);

    return () => clearTimeout(timeoutId);
  }, []);

  // Optimized filtering with useMemo
  const filteredRequests = useMemo(() => {
    if (!searchQuery) return requests;

    const query = searchQuery.toLowerCase();
    return requests.filter(req =>
      req.title?.toLowerCase().includes(query) ||
      req.description?.toLowerCase().includes(query) ||
      req.status?.toLowerCase().includes(query)
    );
  }, [requests, searchQuery]);

  const filteredDocuments = useMemo(() => {
    if (!searchQuery) return documents;

    const query = searchQuery.toLowerCase();
    return documents.filter(doc =>
      doc.title?.toLowerCase().includes(query) ||
      doc.description?.toLowerCase().includes(query) ||
      doc.status?.toLowerCase().includes(query)
    );
  }, [documents, searchQuery]);

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);

  useEffect(() => {
    if (user) {
      loadUserDocuments();
    }
  }, [user, filterStatus]);

  const loadUserDocuments = useCallback(async () => {
    if (!user || !user.companyId) return;

    const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
    const cacheKey = `docs_${companyId}_${user.role}_${user.userId}`;

    // Show cached data immediately if available
    const cached = getItem?.(cacheKey);
    if (cached?.requests && cached?.documents) {
      setRequests(cached.requests.filter(r => r.userId === user.userId));
      setDocuments(cached.documents.filter(d => d.userId === user.userId));
      setLoading(false);

      // Background refresh only if cache is old
      const cacheAge = Date.now() - (cached.timestamp || 0);
      if (cacheAge < DOCS_CACHE_TTL) {
        return; // Cache is fresh, no need to refresh
      }
    } else {
      setLoading(true);
    }

    try {
      // Optimized API call with performance tracking
      const startTime = performance.now();

      const [requestsResult, documentsResult] = await Promise.all([
        documentService.getDocumentRequests(companyId, user.role, user.userId, { status: filterStatus }),
        documentService.getDocuments(companyId, user.role, user.userId, { status: filterStatus })
      ]);

      const loadTime = performance.now() - startTime;
      console.log(`📄 Documents loaded in ${loadTime.toFixed(2)}ms`);

      const allRequests = requestsResult.success ? requestsResult.data : [];
      const allDocuments = documentsResult.success ? documentsResult.data : [];

      // Optimized filtering
      const userRequests = allRequests.filter(r => r.userId === user.userId);
      const userDocuments = allDocuments.filter(d => d.userId === user.userId);

      setRequests(userRequests);
      setDocuments(userDocuments);

      // Cache only successful results
      if (filterStatus === 'all') {
        setItem?.(cacheKey, {
          requests: allRequests,
          documents: allDocuments,
          statistics: {},
          timestamp: Date.now()
        }, DOCS_CACHE_TTL);
      }

    } catch (error) {
      console.error('Error loading documents:', error);
      toast.error('Failed to load documents');
      setRequests([]);
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }, [user, filterStatus, getItem, setItem]);

  const handleViewDocument = (item) => {
    setSelectedItem(item);
    setShowViewModal(true);
  };

  const handleUploadDocument = async (requestId, file, notes) => {
    try {
      const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
      const result = await documentService.submitDocument(
        requestId,
        file,
        user.userId,
        companyId,
        notes,
        user.role
      );

      if (result.success) {
        toast.success('Document uploaded successfully');
        setShowUploadModal(false);
        setSelectedItem(null);
        loadUserDocuments(); // Reload data
      }
    } catch (error) {
      console.error('Error uploading document:', error);
      toast.error(error.message);
    }
  };

  // Get combined and filtered items (requests + documents, avoiding duplicates)
  const getFilteredItems = () => {
    // Create a set of titles from documents to deduplicate by title as fallback
    const documentTitles = new Set();
    documents.forEach(doc => {
      const title = (doc.documentTitle || doc.documentType || '').toLowerCase().trim();
      if (title) documentTitles.add(title);
    });

    // Filter out requests that have corresponding documents (by ID or Title)
    const requestsWithoutDocuments = requests.filter(request => {
      // Priority 1: Deduplicate by requestId link
      const hasDocById = documents.some(doc => doc.requestId === request.id);
      if (hasDocById) return false;

      // Priority 2: Deduplicate by exact Title/Type match (fallback for broken links)
      const requestTitle = (request.documentTitle || request.documentType || '').toLowerCase().trim();
      return !documentTitles.has(requestTitle);
    });

    const allItems = [...requestsWithoutDocuments, ...documents];
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

  // Get user statistics
  const getUserStats = () => {
    // Create a set of titles from documents to deduplicate by title as fallback
    const documentTitles = new Set();
    documents.forEach(doc => {
      const title = (doc.documentTitle || doc.documentType || '').toLowerCase().trim();
      if (title) documentTitles.add(title);
    });

    // Filter out requests that have corresponding documents (by ID or Title)
    const requestsWithoutDocuments = requests.filter(request => {
      // Priority 1: Deduplicate by requestId link
      const hasDocById = documents.some(doc => doc.requestId === request.id);
      if (hasDocById) return false;

      // Priority 2: Deduplicate by exact Title/Type match (fallback for broken links)
      const requestTitle = (request.documentTitle || request.documentType || '').toLowerCase().trim();
      return !documentTitles.has(requestTitle);
    });

    return {
      total: requestsWithoutDocuments.length + documents.length,
      approved: documents.filter(d => d.status === 'approved').length,
      pending: requestsWithoutDocuments.filter(r => r.status === 'pending').length +
        documents.filter(d => d.status === 'uploaded').length
    };
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
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  };

  const filteredItems = getFilteredItems();
  const stats = getUserStats();

  return (
    <>
      <div className="bg-white border border-border-primary rounded-base p-4xl space-y-4xl">
        <div>
          <h2 className="text-2xl font-bold text-text-primary mb-1">My Documents</h2>
          <p className="text-text-secondary">View and manage your document requests and uploads.</p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4xl">
          <div className="bg-white border border-border-primary rounded-base p-4xl">
            <div className="flex items-center justify-center gap-3">
              <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center">
                <FileText className="h-5 w-5 text-blue-600" />
              </div>
              <div className="text-center">
                <p className="text-text-secondary text-sm">Total Documents</p>
                <p className="text-4xl font-bold text-text-primary">{stats.total}</p>
              </div>
            </div>
          </div>

          <div className="bg-white border border-border-primary rounded-base p-4xl">
            <div className="flex items-center justify-center gap-3">
              <div className="w-10 h-10 bg-green-50 rounded-full flex items-center justify-center">
                <CheckCircle className="h-5 w-5 text-green-600" />
              </div>
              <div className="text-center">
                <p className="text-text-secondary text-sm">Approved Documents</p>
                <p className="text-4xl font-bold text-text-primary">{stats.approved}</p>
              </div>
            </div>
          </div>

          <div className="bg-white border border-border-primary rounded-base p-4xl">
            <div className="flex items-center justify-center gap-3">
              <div className="w-10 h-10 bg-orange-50 rounded-full flex items-center justify-center">
                <Clock className="h-5 w-5 text-orange-600" />
              </div>
              <div className="text-center">
                <p className="text-text-secondary text-sm">Pending Documents</p>
                <p className="text-4xl font-bold text-text-primary">{stats.pending}</p>
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
              placeholder="Search my documents..."
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

        {/* Documents List */}
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
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No documents</h3>
              <p className="text-gray-600">You don't have any document requests at the moment.</p>
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
                      onClick={() => handleViewDocument(item)}
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

      {/* Upload Document Modal */}
      <UploadDocumentModal
        isOpen={showUploadModal}
        onClose={() => {
          setShowUploadModal(false);
          setSelectedItem(null);
        }}
        onSubmit={(file, notes) => handleUploadDocument(selectedItem?.id, file, notes)}
        request={selectedItem}
      />

      {/* View Document Modal */}
      <ViewDocumentModal
        isOpen={showViewModal}
        onClose={() => {
          setShowViewModal(false);
          setSelectedItem(null);
        }}
        item={selectedItem}
      />
    </>
  );
};