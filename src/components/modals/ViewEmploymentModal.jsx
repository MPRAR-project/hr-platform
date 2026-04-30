import React, { useEffect, useState } from 'react';
import { X, ArrowRight, Upload, User, Mail, Phone, MapPin, ChevronDown, FileText, Search, Edit2, Save } from 'lucide-react';
import AddDocumentModal from './AddDocumentModal';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import EditDocumentModal from './EditDocumentModal';
import { getOnboardingDocuments, uploadDocument, updateDocument, deleteDocument as deleteDocSvc, DOCUMENT_TYPES, DOCUMENT_CATEGORIES } from '../../services/documents';
import { updateUserEmploymentDetails } from '../../services/users';
import { validateEmploymentData } from '../../utils/employmentUtils';
import { useAuth } from '../../hooks/useAuth';




const ViewEmploymentModal = ({ isOpen, onClose, employee, onSave }) => {
  const { user } = useAuth();
  const [showDocumentSelector, setShowDocumentSelector] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingDocument, setEditingDocument] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [validationErrors, setValidationErrors] = useState([]);
  const [formData, setFormData] = useState({
    jobTitle: '',
    employmentType: 'Full-Time',
    startDate: '',
    primaryWorkLocation: '',
    officeAddress: '',
    workPattern: 'Office-Based',
    probationPeriod: '3 Months',
    documents: []
  });

  const [uploadedDocuments, setUploadedDocuments] = useState([]);

  // Load existing documents for this onboarding application
  useEffect(() => {
    const loadDocs = async () => {
      try {
        const applicationId = employee?.application?.id;
        if (!applicationId || !isOpen) return;
        const docs = await getOnboardingDocuments(applicationId);
        setUploadedDocuments(docs.map(d => ({
          id: d.id,
          name: d.fileName || d.name || d.documentType,
          description: d.description || '',
          category: d.category || '',
          type: d.documentType || 'Upload',
          downloadURL: d.downloadURL,
          _raw: d,
        })));
      } catch (e) {
        // swallow errors in modal
        console.error('Failed to load onboarding docs', e);
      }
    };
    loadDocs();
  }, [isOpen, employee?.application?.id]);

  const handleSelectDocuments = (selectedDocs) => {
    const newDocs = selectedDocs.filter(
      newDoc => !uploadedDocuments.some(existing => existing.id === newDoc.id)
    );
    setUploadedDocuments([...uploadedDocuments, ...newDocs]);
  };

  const handleUploadDocument = async (docData) => {
    try {
      const applicationId = employee?.application?.id;
      const userId = employee?.application?.userId;
      if (!applicationId || !userId) return;
      const result = await uploadDocument({
        file: docData.file,
        userId,
        documentType: DOCUMENT_TYPES.EMPLOYMENT,
        category: docData.documentTag || 'employment',
        description: docData.documentDescription || docData.documentTitle || '',
        onboardingApplicationId: applicationId,
      });
      setUploadedDocuments(prev => ([
        ...prev,
        {
          id: result.id,
          name: result.fileName,
          description: result.description || '',
          category: result.category || '',
          type: result.documentType,
          downloadURL: result.downloadURL,
          _raw: result,
        }
      ]));
    } catch (e) {
      console.error('Upload failed', e);
    }
  };

  const handleEditDocument = (doc) => {
    setEditingDocument(doc);
    setShowEditModal(true);
  };

  const handleSaveDocumentEdit = async (updatedDoc) => {
    try {
      await updateDocument(updatedDoc.id, {
        description: updatedDoc.description,
        category: updatedDoc.category,
        documentType: updatedDoc.type,
      });
      setUploadedDocuments(prev => prev.map(doc => (
        doc.id === updatedDoc.id ? { ...doc, description: updatedDoc.description, category: updatedDoc.category, type: updatedDoc.type } : doc
      )));
    } catch (e) {
      console.error('Update doc failed', e);
    }
  };

  const handleRemoveDocument = async (docId) => {
    try {
      const userId = employee?.application?.userId;
      if (!userId) return;
      await deleteDocSvc(docId, userId);
      setUploadedDocuments(prev => prev.filter(doc => doc.id !== docId));
    } catch (e) {
      console.error('Delete doc failed', e);
    }
  };

  const handleSave = async () => {
    try {
      setIsLoading(true);
      setError(null);
      setSuccess(null);
      setValidationErrors([]);

      // Validate employment data
      const validation = validateEmploymentData(formData);
      if (!validation.isValid) {
        setValidationErrors(validation.errors);
        setError('Please fix the validation errors before saving.');
        return;
      }

      // Get user ID from employee data
      const userId = employee?.application?.userId || employee?.id;
      if (!userId) {
        setError('Unable to identify user for saving employment details.');
        return;
      }

      // Get current user ID for tracking who made the update
      const updatedBy = user?.uid || user?.id || 'system';

      // Save employment details to users collection
      await updateUserEmploymentDetails(userId, formData, updatedBy);

      // Call original onSave callback if provided
      if (onSave) {
        onSave({ ...formData, documents: uploadedDocuments });
      }

      setSuccess('Employment details saved successfully!');

      // Close modal after a brief delay to show success message
      setTimeout(() => {
        onClose();
      }, 1500);

    } catch (err) {
      console.error('Error saving employment details:', err);
      setError(err.message || 'Failed to save employment details. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen || !employee) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]" onClick={onClose}></div>

        <div className="relative w-full max-w-[960px] bg-white rounded-[24px] shadow-[0_4px_20px_rgba(0,0,0,0.1)] p-6 max-h-[90vh] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
          <div className="space-y-6">
            {/* Header */}
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-xl md:text-2xl font-bold text-gray-900">Employment Details</h2>
                <p className="text-sm text-gray-600 mt-1">Job position and work-related information</p>
              </div>
              <button onClick={onClose} className="w-6 h-6 flex items-center justify-center bg-black/10 rounded-full hover:bg-black/20 transition-colors flex-shrink-0">
                <X className="h-4 w-4 text-gray-600" />
              </button>
            </div>

            {/* Error Messages */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-red-800 text-sm font-medium">{error}</p>
                {validationErrors.length > 0 && (
                  <ul className="mt-2 text-red-700 text-sm list-disc list-inside">
                    {validationErrors.map((err, index) => (
                      <li key={index}>{err}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Success Message */}
            {success && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-green-800 text-sm font-medium">{success}</p>
              </div>
            )}

            {/* Employee Info Card */}
            <div className="bg-purple-50 border-2 border-purple-300 rounded-lg p-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center flex-shrink-0">
                  <User className="h-6 w-6 text-purple-600" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900 mb-2">{employee.name}</h3>
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="flex items-center gap-1 text-blue-500">
                      <Mail className="h-3 w-3" />
                      {employee.email}
                    </span>
                    <span className="flex items-center gap-1 text-orange-500">
                      <Phone className="h-3 w-3" />
                      {employee.phone}
                    </span>
                    <span className="flex items-center gap-1 text-green-500">
                      <MapPin className="h-3 w-3" />
                      {employee.location}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Position Details */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Position Details</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input
                  type="text"
                  value={formData.jobTitle}
                  onChange={(e) => setFormData({ ...formData, jobTitle: e.target.value })}
                  placeholder="Job Title"
                  className="w-full h-12 px-4 border border-gray-300 rounded-lg text-sm placeholder:text-gray-500 focus:outline-none focus:border-purple-500"
                />

                <div className="relative">
                  <select
                    value={formData.employmentType}
                    onChange={(e) => setFormData({ ...formData, employmentType: e.target.value })}
                    className="w-full h-12 px-4 pr-10 border border-gray-300 rounded-lg text-sm appearance-none focus:outline-none focus:border-purple-500"
                  >
                    <option>Full-Time</option>
                    <option>Part-Time</option>
                    <option>Contract</option>
                    <option>Internship</option>
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
                </div>

                <input
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                  placeholder="Start Date"
                  className="w-full h-12 px-4 border border-gray-300 rounded-lg text-sm placeholder:text-gray-500 focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>

            {/* Work Location */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Work Location</h3>
              <div className="space-y-4">
                <input
                  type="text"
                  value={formData.primaryWorkLocation}
                  onChange={(e) => setFormData({ ...formData, primaryWorkLocation: e.target.value })}
                  placeholder="Primary Work Location"
                  className="w-full h-12 px-4 border border-gray-300 rounded-lg text-sm placeholder:text-gray-500 focus:outline-none focus:border-purple-500"
                />

                <input
                  type="text"
                  value={formData.officeAddress}
                  onChange={(e) => setFormData({ ...formData, officeAddress: e.target.value })}
                  placeholder="Office Address (if applicable)"
                  className="w-full h-12 px-4 border border-gray-300 rounded-lg text-sm placeholder:text-gray-500 focus:outline-none focus:border-purple-500"
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="relative">
                    <select
                      value={formData.workPattern}
                      onChange={(e) => setFormData({ ...formData, workPattern: e.target.value })}
                      className="w-full h-12 px-4 pr-10 border border-gray-300 rounded-lg text-sm appearance-none focus:outline-none focus:border-purple-500"
                    >
                      <option>Office-Based</option>
                      <option>Remote</option>
                      <option>Hybrid</option>
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
                  </div>

                  <div className="relative">
                    <select
                      value={formData.probationPeriod}
                      onChange={(e) => setFormData({ ...formData, probationPeriod: e.target.value })}
                      className="w-full h-12 px-4 pr-10 border border-gray-300 rounded-lg text-sm appearance-none focus:outline-none focus:border-purple-500"
                    >
                      <option>1 Month</option>
                      <option>3 Months</option>
                      <option>6 Months</option>
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
                  </div>
                </div>
              </div>
            </div>



            {/* Contract Details */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Contract Details</h3>

              <div className="grid grid-cols-1 gap-4 mb-4">
                <button
                  onClick={() => setShowUploadModal(true)}
                  className="border-2 border-dashed border-purple-400 rounded-lg p-6 text-center hover:bg-purple-50 transition-colors"
                >
                  <Upload className="h-7 w-7 text-purple-600 mx-auto mb-2" />
                  <p className="text-sm text-purple-600 font-medium mb-1">
                    Upload New
                  </p>
                  <p className="text-xs text-gray-600">
                    Add custom document
                  </p>
                </button>
              </div>

              {/* Uploaded Documents List */}
              {uploadedDocuments.length > 0 && (
                <div className="space-y-3">
                  {uploadedDocuments.map((doc) => (
                    <div key={doc.id} className="flex sm:flex-row flex-col gap-4 items-start justify-between p-4 border border-purple-300 rounded-lg bg-purple-50">
                      <div className="flex-1">
                        <h4 className="font-semibold text-gray-900 mb-1">{doc.name}</h4>
                        {doc.description && (
                          <p className="text-sm text-gray-600 mb-2">{doc.description}</p>
                        )}
                        <div className="flex gap-2">
                          {doc.category && (
                            <Badge variant="success" className="text-xs">{doc.category}</Badge>
                          )}
                          {doc.type && (
                            <Badge variant="info" className="text-xs">{doc.type}</Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex  items-center gap-2 sm:ml-4">
                        <button
                          onClick={() => handleEditDocument(doc)}
                          className="px-3 py-1.5 border border-purple-200 text-purple-600 rounded-lg text-sm hover:bg-purple-100 transition-colors flex items-center gap-1"
                        >
                          <Edit2 className="h-3 w-3" />
                          Edit
                        </button>
                        <button
                          onClick={() => handleRemoveDocument(doc.id)}
                          className="px-3 py-1.5 border border-red-200 text-red-500 rounded-lg text-sm hover:bg-red-50 transition-colors"
                        >
                          Remove
                        </button>
                        <a
                          href={doc.downloadURL}
                          target="_blank"
                          rel="noreferrer"
                          className="px-3 py-1.5 border border-blue-200 text-blue-600 rounded-lg text-sm hover:bg-blue-50 transition-colors"
                        >
                          View
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-3 gap-4">
              <Button
                onClick={onClose}
                cn='h-12 col-span-1'
                variant='outline-secondary'
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                variant='primary'
                icon={Save}
                iconFirst={true}
                cn='h-12 col-span-2'
                disabled={isLoading}
              >
                <span>{isLoading ? 'Saving...' : 'Save'}</span>

              </Button>
            </div>
          </div>
        </div>
      </div>



      {/* Upload Document Modal */}
      <AddDocumentModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        employee={employee}
        onUpload={handleUploadDocument}
      />

      {/* Edit Document Modal */}
      <EditDocumentModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        document={editingDocument}
        onSave={handleSaveDocumentEdit}
      />
    </>
  );
};

export default ViewEmploymentModal;