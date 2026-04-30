import React, { useMemo, useState, useEffect } from 'react';
import { X, CheckCircle, XCircle, Upload, Download, FileText, Eye } from 'lucide-react';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import AddDocumentModal from './AddDocumentModal';
import { certificateService } from '../../services/certificateService';
import { trainingService } from '../../services/trainingService';
import { db } from '../../firebase/client';
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';

const ViewTrainingModal = ({ isOpen, onClose, training, assignment, onApprove, onDecline, onApproveExtension, onDeclineExtension, employee, user, allAssignments = null }) => {
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [certificates, setCertificates] = useState([]);
  const [loadingCertificates, setLoadingCertificates] = useState(false);
  const [assignedEmployees, setAssignedEmployees] = useState([]);
  const [loadingAssignedEmployees, setLoadingAssignedEmployees] = useState(false);

  // Load certificates when modal opens and assignment is available
  useEffect(() => {
    if (isOpen && assignment?.id && user) {
      loadCertificates();
    }
  }, [isOpen, assignment?.id, user]);

  const trainingAssignments = useMemo(() => {
    if (!training?.id || !Array.isArray(allAssignments)) return [];
    return allAssignments.filter(a => a?.trainingId === training.id);
  }, [allAssignments, training?.id]);

  // Load assigned employee list when viewing a training (no specific assignment)
  useEffect(() => {
    const loadAssignedEmployees = async () => {
      if (!isOpen || assignment?.id) return;
      if (!user?.companyId) return;
      if (!training?.id) return;
      if (!Array.isArray(allAssignments)) return;

      try {
        setLoadingAssignedEmployees(true);

        const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;

        const userIds = [...new Set(trainingAssignments.map(a => a.userId))].filter(Boolean);
        if (userIds.length === 0) {
          setAssignedEmployees([]);
          return;
        }

        const chunks = [];
        for (let i = 0; i < userIds.length; i += 10) {
          chunks.push(userIds.slice(i, i + 10));
        }

        const snaps = await Promise.all(
          chunks.map(chunk => getDocs(
            query(
              collection(db, 'users'),
              where('companyId', '==', `companies/${companyId}`),
              where(documentId(), 'in', chunk)
            )
          ))
        );

        const usersById = {};
        snaps.forEach(snap => {
          snap.forEach(docSnap => {
            usersById[docSnap.id] = docSnap.data();
          });
        });

        const merged = trainingAssignments.map(a => {
          const u = usersById[a.userId];
          const name = u?.displayName || `${u?.firstName || ''} ${u?.lastName || ''}`.trim() || u?.email || a.userId;
          const email = u?.email || '';
          return {
            assignmentId: a.id,
            userId: a.userId,
            name,
            email,
            status: a.status,
            assignedDate: a.assignedDate,
            dueDate: a.dueDate,
            completedDate: a.completedDate
          };
        });

        setAssignedEmployees(merged);
      } catch (error) {
        console.error('Error loading assigned employees:', error);
        setAssignedEmployees([]);
      } finally {
        setLoadingAssignedEmployees(false);
      }
    };

    loadAssignedEmployees();
  }, [isOpen, assignment?.id, user?.companyId, training?.id, allAssignments, trainingAssignments]);

  const loadCertificates = async () => {
    if (!assignment?.id || !user) return;

    try {
      setLoadingCertificates(true);
      const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
      const result = await certificateService.getCertificatesForAssignment(
        assignment.id,
        user.uid,
        user.role,
        companyId
      );

      if (result.success) {
        setCertificates(result.data);
      }
    } catch (error) {
      console.error('Error loading certificates:', error);
      setCertificates([]);
    } finally {
      setLoadingCertificates(false);
    }
  };

  const handleUploadCertificate = async (docData) => {
    try {
      const { file, documentDescription, documentTitle } = docData;

      if (!assignment?.id || !user) {
        throw new Error('Missing assignment or user information');
      }

      const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;

      await certificateService.submitCertificate(
        assignment.id,
        file,
        user.uid,
        companyId,
        documentDescription || '',
        documentTitle,
        user.role
      );

      // Reload certificates after successful upload
      loadCertificates();

      // If we provided an update callback/prop, call it to refresh parent
      // But looking at props, we might need to close or refresh. 
      // The modal usually stays open.

    } catch (error) {
      console.error("Failed to submit certificate:", error);
    }
  };

  const handleViewCertificate = (certificate) => {
    if (certificate.fileUrl) {
      window.open(certificate.fileUrl, '_blank');
    }
  };
  const handleDownloadCertificate = async (certificate) => {
    if (!certificate.fileUrl) return;

    try {
      const response = await fetch(certificate.fileUrl);
      const blob = await response.blob();

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = "certificate";
      document.body.appendChild(link);
      link.click();

      link.remove();
    } catch (error) {
      console.error("Download failed:", error);
    }
  };

  const getStatusVariant = (status) => {
    switch (status) {
      case 'approved': return 'success';
      case 'pending_approval': return 'warning';
      case 'declined': return 'danger';
      default: return 'secondary';
    }
  };

  const getStatusDisplay = (status) => {
    switch (status) {
      case 'pending_approval': return 'Pending Approval';
      case 'approved': return 'Approved';
      case 'declined': return 'Declined';
      default: return status;
    }
  };

  const getAssignmentStatusVariant = (status) => {
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

  const getAssignmentStatusDisplay = (status) => {
    switch (status) {
      case 'pending_approval': return 'Pending Approval';
      case 'in_progress': return 'In Progress';
      case 'assigned': return 'Assigned';
      case 'completed': return 'Completed';
      case 'declined': return 'Declined';
      case 'expired': return 'Expired';
      case 'overdue': return 'Overdue';
      default: return status?.charAt(0).toUpperCase() + status?.slice(1) || 'Unknown';
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatDuration = (minutes) => {
    if (!minutes || minutes === 0) return 'Not specified';

    if (minutes < 60) {
      return `${minutes} minutes`;
    } else if (minutes === 60) {
      return '1 hour';
    } else if (minutes < 1440) { // Less than 24 hours
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      if (remainingMinutes === 0) {
        return `${hours} hour${hours > 1 ? 's' : ''}`;
      } else {
        return `${hours} hour${hours > 1 ? 's' : ''} ${remainingMinutes} minutes`;
      }
    } else { // 24 hours or more
      const days = Math.floor(minutes / 1440);
      const remainingHours = Math.floor((minutes % 1440) / 60);
      if (remainingHours === 0) {
        return `${days} day${days > 1 ? 's' : ''}`;
      } else {
        return `${days} day${days > 1 ? 's' : ''} ${remainingHours} hour${remainingHours > 1 ? 's' : ''}`;
      }
    }
  };

  if (!isOpen || !training) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]" onClick={onClose}></div>

        <div className="relative w-full max-w-[860px] bg-white rounded-[24px] shadow-[0_4px_20px_rgba(0,0,0,0.1)] p-6 max-h-[90vh] overflow-y-auto scrollbar-custom">
          <div className="space-y-6">
            {/* Header */}
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-xl md:text-2xl font-bold text-text-primary">{training?.name || 'Training Details'}</h2>
                <p className="text-sm text-text-secondary mt-1">{training?.description || ''}</p>
              </div>
              <button onClick={onClose} className="w-6 h-6 flex items-center justify-center bg-black/10 rounded-full hover:bg-black/20 transition-colors flex-shrink-0">
                <X className="h-4 w-4 text-text-secondary" />
              </button>
            </div>

            {/* Assignment Information (if assignment exists) */}
            {assignment && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-text-primary mb-4">Assignment Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-blue-700 mb-1">Assigned Date</p>
                    <p className="text-md font-semibold text-blue-900">{formatDate(assignment.assignedDate)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-blue-700 mb-1">Due Date</p>
                    <p className="text-md font-semibold text-blue-900">{formatDate(assignment.dueDate)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-blue-700 mb-1">Completed Date</p>
                    <p className="text-md font-semibold text-blue-900">{assignment.completedDate ? formatDate(assignment.completedDate) : 'Not completed'}</p>
                  </div>
                  {assignment.expiryDate && (
                    <div>
                      <p className="text-sm text-blue-700 mb-1">Expiry Date</p>
                      <p className="text-md font-semibold text-blue-900">{formatDate(assignment.expiryDate)}</p>
                    </div>
                  )}
                </div>

                {/* Extension Information */}
                {assignment.extensionStatus && (
                  <div className="mt-4 pt-4 border-t border-blue-300">
                    <h4 className="text-md font-semibold text-blue-900 mb-2">Extension Request</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-blue-700 mb-1">Extension Status</p>
                        <Badge variant={assignment.extensionStatus === 'approved' ? 'success' : assignment.extensionStatus === 'declined' ? 'danger' : 'warning'} className="text-sm">
                          {assignment.extensionStatus?.charAt(0).toUpperCase() + assignment.extensionStatus?.slice(1)}
                        </Badge>
                      </div>
                      {assignment.requestedDueDate && (
                        <div>
                          <p className="text-sm text-blue-700 mb-1">Requested Due Date</p>
                          <p className="text-md font-semibold text-blue-900">{formatDate(assignment.requestedDueDate)}</p>
                        </div>
                      )}
                      {assignment.extensionReason && (
                        <div className="md:col-span-2">
                          <p className="text-sm text-blue-700 mb-1">Extension Reason</p>
                          <p className="text-sm text-blue-800 bg-blue-100 rounded p-2">{assignment.extensionReason}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <div>
                  <p className="text-sm text-blue-700 mb-1">Assignment Status</p>
                  <Badge variant={getAssignmentStatusVariant(assignment.status)} className="text-sm">
                    {getAssignmentStatusDisplay(assignment.status)}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-blue-700 mb-1">Duration</p>
                  <p className="text-md font-semibold text-blue-900">{formatDuration(training?.estimatedDuration || 60)}</p>
                </div>
              </div>
            )}

            {/* Assigned Employees (Course View) */}
            {!assignment && Array.isArray(allAssignments) && (
              <div className="border-t border-gray-200 pt-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-text-primary">Assigned Employees</h3>
                  <p className="text-sm text-text-secondary">{trainingAssignments.length} assignments</p>
                </div>

                {loadingAssignedEmployees ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
                  </div>
                ) : assignedEmployees.length === 0 ? (
                  <div className="text-center py-8 bg-gray-50 rounded-lg">
                    <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <h4 className="text-md font-medium text-gray-900 mb-2">No employees assigned</h4>
                    <p className="text-sm text-gray-600">This training course currently has no employee assignments.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {assignedEmployees.map((row) => (
                      <div key={row.assignmentId} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium text-text-primary truncate">{row.name}</p>
                            {row.email ? (
                              <p className="text-sm text-text-secondary truncate">{row.email}</p>
                            ) : null}
                            <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm text-text-secondary">
                              <span>Assigned: {formatDate(row.assignedDate)}</span>
                              <span>Due: {formatDate(row.dueDate)}</span>
                              <span>Completed: {row.completedDate ? formatDate(row.completedDate) : 'Not completed'}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={getAssignmentStatusVariant(row.status)} className="text-sm">
                              {getAssignmentStatusDisplay(row.status)}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Training Information and Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Training Information */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-text-primary">Training Information</h3>

                <div>
                  <p className="text-sm text-text-secondary mb-1">Category</p>
                  <p className="text-md font-semibold text-text-primary">{training?.category || training?.trainingType || 'General'}</p>
                </div>

                <div>
                  <p className="text-sm text-text-secondary mb-1">Type</p>
                  <p className="text-md font-semibold text-text-primary">{training?.type || 'Mandatory'}</p>
                </div>

                <div>
                  <p className="text-sm text-text-secondary mb-1">Priority</p>
                  <p className="text-md font-semibold text-text-primary capitalize">{training?.priority || 'Medium'}</p>
                </div>

                <div>
                  <p className="text-sm text-text-secondary mb-1">Instructor</p>
                  <p className="text-md font-semibold text-text-primary">{training?.instructor || 'Training Department'}</p>
                </div>

                <div>
                  <p className="text-sm text-text-secondary mb-1">Location</p>
                  <p className="text-md font-semibold text-text-primary">{training?.location || 'Online/Self-paced'}</p>
                </div>
              </div>

              {/* Training Details */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-text-primary">Training Details</h3>

                <div>
                  <p className="text-sm text-text-secondary mb-1">Created Date</p>
                  <p className="text-md font-semibold text-text-primary">{formatDate(training?.createdAt)}</p>
                </div>

                <div>
                  <p className="text-sm text-text-secondary mb-1">Last Updated</p>
                  <p className="text-md font-semibold text-text-primary">{formatDate(training?.updatedAt)}</p>
                </div>

                <div>
                  <p className="text-sm text-text-secondary mb-1">Training Status</p>
                  <p className="text-md font-semibold text-text-primary capitalize">{training?.status || 'Active'}</p>
                </div>

                <div>
                  <p className="text-sm text-text-secondary mb-1">Estimated Duration</p>
                  <p className="text-md font-semibold text-text-primary">{formatDuration(training?.estimatedDuration || 60)}</p>
                </div>

                <div>
                  <p className="text-sm text-text-secondary mb-1">Validity Period</p>
                  <p className="text-md font-semibold text-text-primary">{training?.validityPeriod || 365} days</p>
                </div>

                {assignment && (
                  <div>
                    <p className="text-sm text-text-secondary mb-1">Upload Type</p>
                    <p className="text-md font-semibold text-text-primary">
                      {assignment.certificateId ? 'Employee Upload' : 'No Upload'}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Learning Objectives */}
            <div>
              <h3 className="text-lg font-semibold text-text-primary mb-3">Learning Objectives</h3>
              {training?.learningObjectives && training.learningObjectives.length > 0 ? (
                <ul className="list-disc list-inside space-y-2 text-sm text-text-secondary bg-green-50 border border-green-200 rounded-lg p-4">
                  {training.learningObjectives.map((objective, index) => (
                    <li key={index} className="text-green-800">{objective}</li>
                  ))}
                </ul>
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <ul className="list-disc list-inside space-y-2 text-sm text-green-800">
                    <li>Understand the key concepts and principles of {training?.name || 'this training'}</li>
                    <li>Apply learned knowledge in practical work situations</li>
                    <li>Meet compliance and safety requirements</li>
                    <li>Demonstrate competency through assessment</li>
                  </ul>
                </div>
              )}
            </div>

            {/* Requirements */}
            <div>
              <h3 className="text-lg font-semibold text-text-primary mb-3">Requirements</h3>
              {training?.requirements && training.requirements.length > 0 ? (
                <ul className="list-disc list-inside space-y-2 text-sm text-text-secondary bg-orange-50 border border-orange-200 rounded-lg p-4">
                  {training.requirements.map((requirement, index) => (
                    <li key={index} className="text-orange-800">{requirement}</li>
                  ))}
                </ul>
              ) : (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <ul className="list-disc list-inside space-y-2 text-sm text-orange-800">
                    <li>Complete all training modules and materials</li>
                    <li>Pass any required assessments with minimum score</li>
                    <li>Submit certificate of completion</li>
                    <li>Attend any mandatory sessions or workshops</li>
                  </ul>
                </div>
              )}
            </div>

            {/* Materials */}
            {training?.materials && training.materials.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-text-primary mb-3">Training Materials</h3>
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                  <ul className="list-disc list-inside space-y-2 text-sm text-purple-800">
                    {training.materials.map((material, index) => (
                      <li key={index}>{material}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Certificate Section */}
            {assignment && (
              <div className="border-t border-gray-200 pt-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-text-primary">Training Certificates</h3>
                  {user?.role === 'employee' && assignment.userId === user.uid && (
                    <Button
                      onClick={() => setShowUploadModal(true)}
                      variant='outline-primary'
                      icon={Upload}
                      iconFirst={true}
                      cn="h-10"
                    >
                      Upload Certificate
                    </Button>
                  )}
                </div>

                {/* Certificate Status Summary */}
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600 mb-1">Certificate Status</p>
                      <Badge variant={getAssignmentStatusVariant(assignment.status)} className="text-sm">
                        {getAssignmentStatusDisplay(assignment.status)}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-gray-600 mb-1">Certificates Uploaded</p>
                      <p className="font-semibold text-gray-900">{certificates.length}</p>
                    </div>
                    <div>
                      <p className="text-gray-600 mb-1">Upload Method</p>
                      <p className="font-semibold text-gray-900">
                        {assignment.certificateId ? 'Employee Upload' : 'No Upload Yet'}
                      </p>
                    </div>
                  </div>
                </div>

                {loadingCertificates ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
                  </div>
                ) : certificates.length === 0 ? (
                  <div className="text-center py-8 bg-gray-50 rounded-lg">
                    <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <h4 className="text-md font-medium text-gray-900 mb-2">No certificates uploaded</h4>
                    <p className="text-sm text-gray-600">
                      {assignment.userId === user?.uid
                        ? "You haven't uploaded any certificates for this training yet."
                        : "No certificates have been uploaded for this training yet."
                      }
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {certificates.map((certificate) => (
                      <div key={certificate.id} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-start gap-3 flex-1">
                            <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center flex-shrink-0">
                              <FileText className="h-5 w-5 text-purple-500" />
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-2">
                                <h4 className="font-medium text-text-primary">{certificate.fileName}</h4>
                                <Badge variant={getStatusVariant(certificate.status)}>
                                  {getStatusDisplay(certificate.status)}
                                </Badge>
                              </div>
                              <div className="text-sm text-text-secondary space-y-1">
                                <p>Uploaded: {formatDate(certificate.uploadedAt)}</p>
                                <p>Size: {Math.round(certificate.fileSize / 1024)} KB</p>
                                {certificate.notes && (
                                  <p>Notes: {certificate.notes}</p>
                                )}
                                {certificate.status === 'declined' && certificate.declineReason && (
                                  <p className="text-red-600">Decline Reason: {certificate.declineReason}</p>
                                )}
                                {certificate.status === 'approved' && certificate.approvalNotes && (
                                  <p className="text-green-600">Approval Notes: {certificate.approvalNotes}</p>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="outline-secondary"
                              icon={Eye}
                              onClick={() => handleViewCertificate(certificate)}
                              cn="h-8 px-3"
                            >
                              View
                            </Button>
                            <Button
                              variant="outline-secondary"
                              icon={Download}
                              onClick={() => handleDownloadCertificate(certificate)}
                              cn="h-8 px-3"
                            >
                              Download
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Assignment Actions */}
            {assignment && user?.role !== 'employee' && assignment.status === 'pending_approval' && onApprove && onDecline && (
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <Button
                  onClick={() => onDecline(assignment)}
                  variant="outline-danger"
                  icon={XCircle}
                >
                  Decline Certificate
                </Button>
                <Button
                  onClick={() => onApprove(assignment)}
                  variant="solid-success"
                  icon={CheckCircle}
                >
                  Approve Certificate
                </Button>
              </div>
            )}

            {/* Extension Approval Actions */}
            {assignment && user?.role !== 'employee' && assignment.extensionStatus === 'pending' && onApproveExtension && onDeclineExtension && assignment.userId !== user?.uid && (
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <Button
                  onClick={() => onDeclineExtension(assignment)}
                  variant="outline-danger"
                  icon={XCircle}
                >
                  Decline Extension
                </Button>
                <Button
                  onClick={() => onApproveExtension(assignment)}
                  variant="solid-success"
                  icon={CheckCircle}
                >
                  Approve Extension
                </Button>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Upload Certificate Modal */}
      <AddDocumentModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        employee={employee || { name: 'Employee' }}
        onUpload={handleUploadCertificate}
        initialTitle={training?.name || ''}
        initialTag="Training"
      />
    </>
  );
};

export default ViewTrainingModal;