import React, { useMemo, useState, useEffect } from 'react';
import { X, CheckCircle, XCircle, Upload, Download, FileText, Eye } from 'lucide-react';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import AddDocumentModal from './AddDocumentModal';
import { certificateService } from '../../services/certificateService';
import { trainingService } from '../../services/trainingService';
import apiClient from '../../api/apiClient';

const ViewTrainingModal = ({ isOpen, onClose, training, assignment, onApprove, onDecline, onApproveExtension, onDeclineExtension, employee, user, allAssignments = null }) => {
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [certificates, setCertificates] = useState([]);
  const [loadingCertificates, setLoadingCertificates] = useState(false);
  const [assignedEmployees, setAssignedEmployees] = useState([]);
  const [loadingAssignedEmployees, setLoadingAssignedEmployees] = useState(false);

  useEffect(() => {
    if (isOpen && assignment?.id && user) {
      loadCertificates();
    }
  }, [isOpen, assignment?.id, user]);

  const trainingAssignments = useMemo(() => {
    if (!training?.id || !Array.isArray(allAssignments)) return [];
    return allAssignments.filter(a => a?.trainingId === training.id);
  }, [allAssignments, training?.id]);

  useEffect(() => {
    const loadAssignedEmployees = async () => {
      if (!isOpen || assignment?.id) return;
      if (!user?.companyId) return;
      if (!training?.id) return;

      try {
        setLoadingAssignedEmployees(true);
        const cleanCompanyId = user.companyId.replace('companies/', '');
        
        // Genuinely fetch from our new API
        const assignmentsRes = await trainingService.getAssignments(cleanCompanyId, { courseId: training.id });
        
        // Fetch user names for these assignments
        const userIds = [...new Set(assignmentsRes.map(a => a.userId))];
        const usersRes = await apiClient.get(`/hr/${cleanCompanyId}/employees`); // Simplified list
        const usersById = usersRes.data.reduce((acc, u) => {
            acc[u.userId || u.id] = u;
            return acc;
        }, {});

        const merged = assignmentsRes.map(a => {
          const u = usersById[a.userId];
          const name = u?.displayName || `${u?.firstName || ''} ${u?.lastName || ''}`.trim() || u?.email || a.userId;
          return {
            assignmentId: a.id,
            userId: a.userId,
            name,
            email: u?.email || '',
            status: a.status,
            assignedDate: a.assignedAt,
            dueDate: a.dueDate,
            completedDate: a.completedAt
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
  }, [isOpen, assignment?.id, user?.companyId, training?.id]);

  const loadCertificates = async () => {
    if (!assignment?.id || !user) return;
    try {
      setLoadingCertificates(true);
      const cleanCompanyId = user.companyId.replace('companies/', '');
      // Generic document fetch for this user/category
      const docs = await apiClient.get(`/hr/documents`, {
          params: { userId: user.uid || user.id, category: 'Training' }
      });
      setCertificates(docs.data);
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
      const cleanCompanyId = user.companyId.replace('companies/', '');

      // Genuine upload via Central Backend
      const formData = new FormData();
      formData.append('file', file);
      formData.append('path', `certificates/${user.uid}/${file.name}`);

      const uploadRes = await apiClient.post(`/hr/storage/upload`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
      });

      await apiClient.post(`/hr/documents`, {
          userId: user.uid || user.id,
          name: documentTitle || file.name,
          fileUrl: uploadRes.data.url,
          category: 'Training',
          description: documentDescription || '',
          status: 'pending_approval'
      });

      loadCertificates();
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
      link.download = certificate.name || "certificate";
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

  const formatDate = (date) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  };

  if (!isOpen || !training) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]" onClick={onClose}></div>
        <div className="relative w-full max-w-[860px] bg-white rounded-[24px] shadow-xl p-6 max-h-[90vh] overflow-y-auto scrollbar-custom">
          <div className="space-y-6">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-xl md:text-2xl font-bold text-gray-800">{training?.title || training?.name || 'Training Details'}</h2>
                <p className="text-sm text-gray-500 mt-1">{training?.description || ''}</p>
              </div>
              <button onClick={onClose} className="w-6 h-6 flex items-center justify-center bg-black/10 rounded-full hover:bg-black/20 transition-colors">
                <X className="h-4 w-4 text-gray-600" />
              </button>
            </div>

            {assignment && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-blue-900 mb-4">Assignment Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-blue-700 mb-1">Assigned Date</p>
                    <p className="text-md font-semibold text-blue-900">{formatDate(assignment.assignedAt)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-blue-700 mb-1">Due Date</p>
                    <p className="text-md font-semibold text-blue-900">{formatDate(assignment.dueDate)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-blue-700 mb-1">Status</p>
                    <Badge variant={assignment.status === 'completed' ? 'success' : 'warning'}>{assignment.status}</Badge>
                  </div>
                </div>
              </div>
            )}

            <div className="border-t border-gray-200 pt-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-800">Certificates</h3>
                    {user?.role === 'employee' && (
                        <Button onClick={() => setShowUploadModal(true)} variant='outline-primary' icon={Upload} iconFirst={true}>
                            Upload Certificate
                        </Button>
                    )}
                </div>

                {loadingCertificates ? (
                    <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div></div>
                ) : certificates.length === 0 ? (
                    <div className="text-center py-8 bg-gray-50 rounded-lg text-gray-500">No certificates uploaded yet.</div>
                ) : (
                    <div className="space-y-4">
                        {certificates.map((cert) => (
                            <div key={cert.id} className="border border-gray-200 rounded-lg p-4 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <FileText className="text-purple-500" />
                                    <div>
                                        <p className="font-medium">{cert.name}</p>
                                        <p className="text-xs text-gray-500">Uploaded: {formatDate(cert.createdAt)}</p>
                                    </div>
                                    <Badge variant={getStatusVariant(cert.status)}>{getStatusDisplay(cert.status)}</Badge>
                                </div>
                                <div className="flex gap-2">
                                    <Button variant="outline-secondary" icon={Eye} onClick={() => handleViewCertificate(cert)}>View</Button>
                                    <Button variant="outline-secondary" icon={Download} onClick={() => handleDownloadCertificate(cert)}>Download</Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
          </div>
        </div>
      </div>

      <AddDocumentModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        employee={employee || { name: 'Employee' }}
        onUpload={handleUploadCertificate}
        initialTitle={training?.title || training?.name || ''}
        initialTag="Training"
      />
    </>
  );
};

export default ViewTrainingModal;