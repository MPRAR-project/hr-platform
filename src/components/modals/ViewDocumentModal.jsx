import React from 'react';
import { X, FileText, User, Calendar, Clock, CheckCircle, XCircle, AlertCircle, Download, Eye } from 'lucide-react';
import Button from '../ui/Button';
import Badge from '../ui/Badge';

const ViewDocumentModal = ({ isOpen, onClose, item }) => {
  if (!isOpen || !item) return null;

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

  const getStatusIcon = (status) => {
    switch (status) {
      case 'approved': return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'uploaded': return <Clock className="h-5 w-5 text-yellow-500" />;
      case 'pending': return <AlertCircle className="h-5 w-5 text-blue-500" />;
      case 'declined': return <XCircle className="h-5 w-5 text-red-500" />;
      default: return <FileText className="h-5 w-5 text-gray-500" />;
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';

    let date;
    try {
      // Firestore Timestamp object (has .toDate() method)
      if (typeof timestamp.toDate === 'function') {
        date = timestamp.toDate();
      }
      // Firestore Timestamp-like object with _seconds (serialized form)
      else if (typeof timestamp._seconds === 'number') {
        date = new Date(timestamp._seconds * 1000);
      }
      // Number (Unix ms timestamp)
      else if (typeof timestamp === 'number') {
        date = new Date(timestamp);
      }
      // String or other
      else {
        date = new Date(timestamp);
      }
    } catch {
      return 'N/A';
    }

    // Guard against Invalid Date
    if (!date || isNaN(date.getTime())) return 'N/A';

    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'urgent': return 'text-red-600 bg-red-50';
      case 'high': return 'text-orange-600 bg-orange-50';
      case 'medium': return 'text-yellow-600 bg-yellow-50';
      case 'low': return 'text-green-600 bg-green-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  const handleDownload = async () => {
    if (item.fileUrl) {
      try {
        // Create a temporary link element to trigger download
        const response = await fetch(item.fileUrl);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = item.fileName || 'document';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      } catch (error) {
        console.error('Download failed:', error);
        // Fallback to opening in new tab if download fails
        window.open(item.fileUrl, '_blank');
      }
    }
  };

  const handlePreview = () => {
    if (item.fileUrl) {
      // For PDFs and images, open in new tab for preview
      if (item.fileType?.includes('pdf') || item.fileType?.includes('image')) {
        window.open(item.fileUrl, '_blank');
      } else {
        // For other file types, download
        handleDownload();
      }
    }
  };

  const isDocument = item.fileName; // Has fileName means it's a document, not just a request
  const isRequest = !item.fileName; // No fileName means it's just a request

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            {getStatusIcon(item.status)}
            <h2 className="text-xl font-semibold text-gray-900">
              {isDocument ? 'Document Details' : 'Document Request Details'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Status and Title */}
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                {item.documentTitle}
              </h3>
              <Badge variant={getStatusVariant(item.status)}>
                {getStatusDisplay(item.status)}
              </Badge>
            </div>
            {item.priority && (
              <div className={`px-3 py-1 rounded-full text-sm font-medium ${getPriorityColor(item.priority)}`}>
                {item.priority.charAt(0).toUpperCase() + item.priority.slice(1)} Priority
              </div>
            )}
          </div>

          {/* Employee Information */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center">
              <User className="h-4 w-4 mr-1" />
              Employee Information
            </h4>
            <div className="space-y-1">
              <p className="text-sm text-gray-900">{item.user?.name || 'Unknown User'}</p>
              <p className="text-sm text-gray-600">{item.user?.email || 'No email'}</p>
            </div>
          </div>

          {/* Document Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">Document Type</h4>
              <p className="text-sm text-gray-900">{item.documentType}</p>
            </div>
            {item.dueDate && (
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center">
                  <Calendar className="h-4 w-4 mr-1" />
                  Due Date
                </h4>
                <p className="text-sm text-gray-900">{formatDate(item.dueDate)}</p>
              </div>
            )}
          </div>

          {/* Description */}
          {item.description && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">Description</h4>
              <p className="text-sm text-gray-900 bg-gray-50 rounded-lg p-3">
                {item.description}
              </p>
            </div>
          )}

          {/* File Information (for uploaded documents) */}
          {isDocument && (
            <div className="bg-blue-50 rounded-lg p-4">
              <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center">
                <FileText className="h-4 w-4 mr-1" />
                File Information
              </h4>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">File Name:</span>
                  <span className="text-sm text-gray-900 font-medium">{item.fileName}</span>
                </div>
                {item.fileSize && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">File Size:</span>
                    <span className="text-sm text-gray-900">
                      {(item.fileSize / (1024 * 1024)).toFixed(2)} MB
                    </span>
                  </div>
                )}
                {item.fileType && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600">File Type:</span>
                    <span className="text-sm text-gray-900">{item.fileType}</span>
                  </div>
                )}
              </div>

              {/* File Actions */}
              {item.fileUrl && (
                <div className="flex space-x-2 mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handlePreview}
                    icon={Eye}
                  >
                    Preview
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownload}
                    icon={Download}
                  >
                    Download
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          {item.notes && (
            <div>
              <h4 className="text-sm font-medium text-gray-700 mb-2">Notes</h4>
              <p className="text-sm text-gray-900 bg-gray-50 rounded-lg p-3">
                {item.notes}
              </p>
            </div>
          )}

          {/* Approval/Decline Information */}
          {item.status === 'approved' && (
            <div className="bg-green-50 rounded-lg p-4">
              <h4 className="text-sm font-medium text-green-800 mb-2 flex items-center">
                <CheckCircle className="h-4 w-4 mr-1" />
                Approval Information
              </h4>
              <div className="space-y-1">
                <p className="text-sm text-green-700">
                  Approved on {formatDate(item.approvedAt)}
                </p>
                {item.approvalNotes && (
                  <p className="text-sm text-green-700 mt-2">
                    <strong>Notes:</strong> {item.approvalNotes}
                  </p>
                )}
              </div>
            </div>
          )}

          {item.status === 'declined' && (
            <div className="bg-red-50 rounded-lg p-4">
              <h4 className="text-sm font-medium text-red-800 mb-2 flex items-center">
                <XCircle className="h-4 w-4 mr-1" />
                Decline Information
              </h4>
              <div className="space-y-1">
                <p className="text-sm text-red-700">
                  Declined on {formatDate(item.declinedAt)}
                </p>
                {item.declineReason && (
                  <p className="text-sm text-red-700 mt-2">
                    <strong>Reason:</strong> {item.declineReason}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Timeline */}
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-3">Timeline</h4>
            <div className="space-y-3">
              {/* Created */}
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0 w-2 h-2 bg-blue-500 rounded-full mt-2"></div>
                <div>
                  <p className="text-sm text-gray-900 font-medium">Request Created</p>
                  <p className="text-sm text-gray-600">{formatDate(item.createdAt)}</p>
                </div>
              </div>

              {/* Uploaded */}
              {item.uploadedAt && (
                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0 w-2 h-2 bg-yellow-500 rounded-full mt-2"></div>
                  <div>
                    <p className="text-sm text-gray-900 font-medium">Document Uploaded</p>
                    <p className="text-sm text-gray-600">{formatDate(item.uploadedAt)}</p>
                  </div>
                </div>
              )}

              {/* Approved/Declined */}
              {item.approvedAt && (
                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0 w-2 h-2 bg-green-500 rounded-full mt-2"></div>
                  <div>
                    <p className="text-sm text-gray-900 font-medium">Document Approved</p>
                    <p className="text-sm text-gray-600">{formatDate(item.approvedAt)}</p>
                  </div>
                </div>
              )}

              {item.declinedAt && (
                <div className="flex items-start space-x-3">
                  <div className="flex-shrink-0 w-2 h-2 bg-red-500 rounded-full mt-2"></div>
                  <div>
                    <p className="text-sm text-gray-900 font-medium">Document Declined</p>
                    <p className="text-sm text-gray-600">{formatDate(item.declinedAt)}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end p-6 border-t border-gray-200">
          <Button
            variant="outline"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ViewDocumentModal;