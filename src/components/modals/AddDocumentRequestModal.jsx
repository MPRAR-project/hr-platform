import React, { useState, useEffect } from 'react';
import { X, User, FileText, Calendar, AlertCircle } from 'lucide-react';
import Button from '../ui/Button';
import { documentService } from '../../services/documentService';

const AddDocumentRequestModal = ({ isOpen, onClose, onSubmit, getCompanyUsers, companyId, preselectedEmployee = null }) => {
  const [formData, setFormData] = useState({
    userId: '',
    documentType: '',
    documentTitle: '',
    description: '',
    priority: 'medium',
    dueDate: ''
  });
  const [documentTypes, setDocumentTypes] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingTypes, setLoadingTypes] = useState(false);
  const [errors, setErrors] = useState({});

  // Load users and document types when modal opens
  useEffect(() => {
    if (isOpen) {
      if (getCompanyUsers && !preselectedEmployee) {
        loadUsers();
      }
      loadDocumentTypes();
    }
  }, [isOpen, getCompanyUsers, preselectedEmployee, companyId]);

  // Reset form when modal closes or preselected employee changes
  useEffect(() => {
    if (!isOpen) {
      setFormData({
        userId: preselectedEmployee?.id || '',
        documentType: '',
        documentTitle: '',
        description: '',
        priority: 'medium',
        dueDate: ''
      });
      setErrors({});
    }
  }, [isOpen, preselectedEmployee]);

  // Set preselected employee when modal opens
  useEffect(() => {
    if (isOpen && preselectedEmployee) {
      setFormData(prev => ({
        ...prev,
        userId: preselectedEmployee.id
      }));
    }
  }, [isOpen, preselectedEmployee]);

  const loadUsers = async () => {
    try {
      setLoadingUsers(true);
      const companyUsers = await getCompanyUsers();
      setUsers(companyUsers);
    } catch (error) {
      console.error('Error loading users:', error);
    } finally {
      setLoadingUsers(false);
    }
  };

  const loadDocumentTypes = async () => {
    try {
      setLoadingTypes(true);
      const types = await documentService.getDocumentTypes(companyId);
      setDocumentTypes(types);
    } catch (error) {
      console.error('Error loading document types:', error);
    } finally {
      setLoadingTypes(false);
    }
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));

    // Auto-generate document title when document type changes
    if (field === 'documentType' && value) {
      const selectedType = documentTypes.find(type => type.value === value);
      if (selectedType && !formData.documentTitle) {
        setFormData(prev => ({ ...prev, documentTitle: selectedType.label }));
      }
    }

    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };

  const validateForm = () => {
    const newErrors = {};

    if (!formData.userId) {
      newErrors.userId = preselectedEmployee ? 'Employee is required' : 'Please select an employee';
    }

    if (!formData.documentType) {
      newErrors.documentType = 'Please select a document type';
    }

    if (!formData.documentTitle.trim()) {
      newErrors.documentTitle = 'Document title is required';
    }

    if (!formData.dueDate) {
      newErrors.dueDate = 'Due date is required';
    } else {
      const selectedDate = new Date(formData.dueDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (selectedDate < today) {
        newErrors.dueDate = 'Due date cannot be in the past';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    try {
      setLoading(true);
      await onSubmit(formData);
    } catch (error) {
      console.error('Error submitting request:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Create Document Request</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Employee Selection - Show only if no preselected employee */}
          {!preselectedEmployee ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <User className="inline h-4 w-4 mr-1" />
                Employee *
              </label>
              {loadingUsers ? (
                <div className="flex items-center justify-center py-4">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-600"></div>
                </div>
              ) : (
                <select
                  value={formData.userId}
                  onChange={(e) => handleInputChange('userId', e.target.value)}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent ${errors.userId ? 'border-red-500' : 'border-gray-300'
                    }`}
                >
                  <option value="">Select an employee</option>
                  {users.map(user => (
                    <option key={user.id} value={user.id}>
                      {user.displayName || `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email}
                    </option>
                  ))}
                </select>
              )}
              {errors.userId && (
                <p className="mt-1 text-sm text-red-600 flex items-center">
                  <AlertCircle className="h-4 w-4 mr-1" />
                  {errors.userId}
                </p>
              )}
            </div>
          ) : (
            /* Show selected employee info when preselected */
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <User className="inline h-4 w-4 mr-1" />
                Employee
              </label>
              <div className="flex items-center p-3 bg-purple-50 border border-purple-200 rounded-lg">
                <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center mr-3">
                  <span className="text-sm font-semibold text-purple-600">
                    {(preselectedEmployee.name || preselectedEmployee.displayName || 'U').charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <p className="font-medium text-gray-900">
                    {preselectedEmployee.name || preselectedEmployee.displayName || 'Unknown User'}
                  </p>
                  <p className="text-sm text-gray-600">{preselectedEmployee.email}</p>
                </div>
              </div>
            </div>
          )}

          {/* Document Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <FileText className="inline h-4 w-4 mr-1" />
              Document Type *
            </label>
            <select
              value={formData.documentType}
              onChange={(e) => handleInputChange('documentType', e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent ${errors.documentType ? 'border-red-500' : 'border-gray-300'
                }`}
            >
              <option value="">Select document type</option>
              {documentTypes.map(type => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
            {errors.documentType && (
              <p className="mt-1 text-sm text-red-600 flex items-center">
                <AlertCircle className="h-4 w-4 mr-1" />
                {errors.documentType}
              </p>
            )}
          </div>

          {/* Document Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Document Title *
            </label>
            <input
              type="text"
              value={formData.documentTitle}
              onChange={(e) => handleInputChange('documentTitle', e.target.value)}
              placeholder="Enter document title"
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent ${errors.documentTitle ? 'border-red-500' : 'border-gray-300'
                }`}
            />
            {errors.documentTitle && (
              <p className="mt-1 text-sm text-red-600 flex items-center">
                <AlertCircle className="h-4 w-4 mr-1" />
                {errors.documentTitle}
              </p>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
              placeholder="Enter additional details or requirements..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>

          {/* Priority and Due Date */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Priority
              </label>
              <select
                value={formData.priority}
                onChange={(e) => handleInputChange('priority', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <Calendar className="inline h-4 w-4 mr-1" />
                Due Date *
              </label>
              <input
                type="date"
                value={formData.dueDate}
                onChange={(e) => handleInputChange('dueDate', e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent ${errors.dueDate ? 'border-red-500' : 'border-gray-300'
                  }`}
              />
              {errors.dueDate && (
                <p className="mt-1 text-sm text-red-600 flex items-center">
                  <AlertCircle className="h-4 w-4 mr-1" />
                  {errors.dueDate}
                </p>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="gradient"
              disabled={loading}
            >
              {loading ? 'Creating...' : 'Create Request'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddDocumentRequestModal;