import React, { useState } from 'react';
import { Search, User, Briefcase, Calendar, FileText, CheckCircle, XCircle, ArrowLeft, Upload, AlertTriangle } from 'lucide-react';
import Header from '../../components/layout/Header';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import AddDocumentModal from '../../components/modals/AddDocumentModal';
import ViewDocumentModal from '../../components/modals/ViewDocumentModal';
import ApprovalConfirmationModal from '../../components/modals/ApprovalConfirmationModal';
import DeleteConfirmationModal from '../../components/modals/DeleteConfirmationModal';
import StatCard from '../../components/shared/StatCard';
import { useAuth } from '../../hooks/useAuth';

const EmployeeDocumentsPage = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('All Status');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showDeclineModal, setShowDeclineModal] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState(null);
  const { user } = useAuth();

  const employee = {
    id: 1,
    name: 'Sarah Johnson',
    email: 'Sarah@Company.Com',
    role: 'Employee',
    department: 'Development',
    hireDate: '2022-03-15',
    totalDocuments: 8,
    approvedReviews: 6,
    pendingReviews: 2
  };

  const documents = [
    { id: 1, name: 'Employment Contract.pdf', type: 'Contract', size: '2.4 MB', uploadDate: '2024-01-15', status: 'Pending', uploadedBy: 'Employee' },
    { id: 2, name: 'Emergency_Contacts.pdf', type: 'Contract', size: '2.4 MB', uploadDate: '2024-01-15', status: 'Pending', uploadedBy: 'Employee' },
    { id: 3, name: 'Bank_Details.pdf', type: 'Contract', size: '2.4 MB', uploadDate: '2024-01-15', status: 'Approved', uploadedBy: 'Admin' },
    { id: 4, name: 'ID_Verification.jpg', type: 'Contract', size: '2.4 MB', uploadDate: '2024-01-15', status: 'Approved', uploadedBy: 'Admin' }
  ];

  const handleBack = () => {
    window.history.back();
  };

  const handleViewDocument = (doc) => {
    setSelectedDocument(doc);
    setShowDetailsModal(true);
  };

  const handleApproveClick = (doc) => {
    setSelectedDocument(doc);
    setShowApproveModal(true);
  };

  const handleDeclineClick = (doc) => {
    setSelectedDocument(doc);
    setShowDeclineModal(true);
  };

  const handleApproveConfirm = () => {
    console.log('Approve document:', selectedDocument.id);
    // Add your approval logic here
  };

  const handleDeclineConfirm = () => {
    console.log('Decline document:', selectedDocument.id);
    // Add your decline logic here
  };

  const handleDownload = (docId) => {
    console.log('Download document:', docId);
  };

  const handleUploadDocument = (documentData) => {
    console.log('Upload document:', documentData);
  };

  const pretty = (role) =>
    role.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Header
        title={`${pretty(user.role)} Dashboard`}
        subtitle="Grow your digital workplace and manage your team seamlessly"
      />

      <div className="flex-1 overflow-y-auto p-4 md:p-3xl scrollbar-custom">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Back Button */}
          <button
            onClick={handleBack}
            className="flex items-center gap-2 text-text-primary hover:text-text-accent-purple transition-colors mb-4"
          >
            <ArrowLeft className="h-5 w-5" />
            <span className="font-semibold">Back to Employees</span>
          </button>

          {/* Employee Info Card */}
          <div className="bg-white rounded-lg p-6 shadow-md">
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-bg-accent-purple-light rounded-full flex items-center justify-center">
                  <User className="h-6 w-6 text-text-accent-purple" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-text-primary">{employee.name}</h2>

                  <p className="text-sm text-text-secondary mb-2">{employee.email}</p>
                  <div className="flex flex-wrap items-center gap-4 text-sm">
                    <span className="flex items-center gap-1 text-purple-500">
                      <Briefcase className="h-3 w-3" />
                      {employee.department}
                    </span>
                    <span className="flex items-center gap-1 text-blue-500">
                      <Calendar className="h-3 w-3" />
                      Hired: {employee.hireDate}
                    </span>
                    <span className='flex items-center gap-1 text-green-500'>
                      <User className="h-3 w-3" />
                      ID: {employee.id}
                    </span>
                  </div>
                </div>
              </div>
              <div className='flex item-start'>

                <Badge variant={employee.role === 'Manager' ? 'role' : 'info'}>
                  {employee.role}
                </Badge>
              </div>

            </div>
          </div>

          {/* Stats Cards */}
          <div className="flex flex-wrap gap-xl">
            <StatCard
              title="Total Documents"
              value={employee.totalDocuments.toString()}
              subtitle=""
              icon={<FileText className="h-6 w-6 text-blue-500" />}
              iconBgColor="bg-blue-50"
            />
            <StatCard
              title="Approved reviews"
              value={employee.approvedReviews.toString()}
              subtitle=""
              icon={<CheckCircle className="h-6 w-6 text-green-500" />}
              iconBgColor="bg-green-50"
            />
            <StatCard
              title="Pending Reviews"
              value={employee.pendingReviews.toString()}
              subtitle=""
              icon={<AlertTriangle className="h-6 w-6 text-orange-500" />}
              iconBgColor="bg-orange-50"
            />
          </div>

          {/* Search and Filter for Documents */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className='flex flex-wrap gap-4'>

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
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="px-4 py-2 border border-border-secondary rounded-lg text-sm focus:outline-none focus:border-border-accent-purple"
                >
                  <option>All Status</option>
                  <option>Pending</option>
                  <option>Approved</option>
                  <option>Declined</option>
                </select>
              </div>
            </div>

            <Button
              variant="gradient"
              icon={Upload}
              onClick={() => setShowAddModal(true)}
            >
              Upload Document
            </Button>
          </div>

          {/* Documents List */}
          <div className="space-y-4">
            {documents.map((doc) => (
              <div key={doc.id} className="bg-white border border-border-accent-purple hover:shadow-md transition-all rounded-lg p-6 space-y-4">
                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
                  <div className="flex items-center gap-4 flex-1">
                    <div className="w-12 h-12 bg-purple-50 rounded-lg flex items-center justify-center">
                      <FileText className="h-6 w-6 text-purple-500" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1 flex-wrap">
                        <h4 className="font-semibold text-text-primary text-lg">{doc.name}</h4>
                        <Badge variant={doc.status === 'Approved' ? 'success' : 'warning'}>
                          {doc.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-text-secondary">
                        {doc.type} • {doc.size} • Uploaded {doc.uploadDate}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      onClick={() => handleViewDocument(doc)}
                      className="px-4 py-2 border border-border-primary rounded-lg text-sm font-medium hover:bg-bg-secondary transition-colors"
                    >
                      View
                    </button>
                    <Button
                      variant="outline-primary"
                      onClick={() => handleDownload(doc.id)}
                    >
                      Download
                    </Button>
                  </div>
                </div>

                {/* Upload Badge and Actions */}
                <div className="flex flex-wrap gap-6 justify-between items-center">
                  <Badge variant="role" className="text-sm">
                    {doc.uploadedBy} Upload
                  </Badge>

                  {doc.status === 'Pending' && (
                    <div className="flex gap-3">
                      <Button
                        variant="outline-danger"
                        icon={XCircle}
                        onClick={() => handleDeclineClick(doc)}
                      >
                        Decline
                      </Button>
                      <Button
                        variant="solid-success"
                        icon={CheckCircle}
                        onClick={() => handleApproveClick(doc)}
                      >
                        Approve
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* View & Upload Modals */}
      <AddDocumentModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        employee={employee}
        onUpload={handleUploadDocument}
        companyId={user?.companyId?.includes('/') ? user.companyId.split('/')[1] : user?.companyId}
      />
      <ViewDocumentModal
        isOpen={showDetailsModal}
        onClose={() => setShowDetailsModal(false)}
        employee={employee}
        document={selectedDocument}
        onApprove={handleApproveConfirm}
        onDecline={handleDeclineConfirm}
      />

      {/* Approve Modal */}
      <ApprovalConfirmationModal
        isOpen={showApproveModal}
        onClose={() => {
          setShowApproveModal(false);
          setSelectedDocument(null);
        }}
        onConfirm={handleApproveConfirm}
        title="Approve Document"
        description={`Are you sure you want to approve "${selectedDocument?.name}"? This document will be marked as verified and accepted.`}
        confirmButtonText="Approve Document"
        cancelButtonText="Cancel"
      >
        {selectedDocument && (
          <div className="space-y-4">
            {/* Document Details */}
            <div className="flex items-start justify-between p-3 border border-border-secondary rounded-lg">
              <div className="flex items-start gap-3 flex-1">
                <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center flex-shrink-0">
                  <FileText className="h-5 w-5 text-purple-500" />
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <span className="text-md font-semibold text-text-primary">
                    {selectedDocument.name}
                  </span>
                  <span className="text-xs text-text-secondary">
                    {selectedDocument.type} • {selectedDocument.size}
                  </span>
                  <span className="text-xs text-text-secondary">
                    Uploaded: {selectedDocument.uploadDate}
                  </span>
                </div>
              </div>
              <Badge variant="warning">{selectedDocument.status}</Badge>
            </div>

            {/* Employee Info */}
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-green-800">Employee:</span>
                <span className="text-sm font-semibold text-green-800">{employee.name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-green-800">Department:</span>
                <span className="text-sm font-semibold text-green-800">{employee.department}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-green-800">Uploaded By:</span>
                <span className="text-sm font-semibold text-green-800">{selectedDocument.uploadedBy}</span>
              </div>
            </div>
          </div>
        )}
      </ApprovalConfirmationModal>

      {/* Decline Modal */}
      <DeleteConfirmationModal
        isOpen={showDeclineModal}
        onClose={() => {
          setShowDeclineModal(false);
          setSelectedDocument(null);
        }}
        onConfirm={handleDeclineConfirm}
        title="Decline Document"
        description={`Are you sure you want to decline "${selectedDocument?.name}"?`}
        warningMessage="Declining this document will notify the employee that their submission was rejected. They may need to upload a corrected or different document."
        confirmButtonText="Decline Document"
        cancelButtonText="Cancel"
        itemDetails={
          selectedDocument
            ? {
              name: selectedDocument.name,
              subtitle: `${selectedDocument.type} • ${selectedDocument.size}`,
              email: `Uploaded: ${selectedDocument.uploadDate}`,
              badge: selectedDocument.uploadedBy
            }
            : null
        }
        variant="danger"
      />
    </div>
  );
};

export default EmployeeDocumentsPage;