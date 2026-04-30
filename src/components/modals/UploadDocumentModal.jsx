import React, { useState, useRef, useEffect } from 'react';
import { X, Upload, AlertCircle, CheckCircle } from 'lucide-react';
import Button from '../ui/Button';

const UploadDocumentModal = ({ isOpen, onClose, onSubmit, request }) => {
  const [selectedFile, setSelectedFile] = useState(null);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [errors, setErrors] = useState({});
  const fileInputRef = useRef(null);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSelectedFile(null);
      setNotes('');
      setErrors({});
      setDragActive(false);
    }
  }, [isOpen]);

  const allowedFileTypes = [
    'image/jpeg', 'image/png', 'image/jpg',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];

  const maxFileSize = 25 * 1024 * 1024; // 25MB

  const validateFile = (file) => {
    const newErrors = {};

    if (!file) {
      newErrors.file = 'Please select a file';
      setErrors(newErrors);
      return false;
    }

    if (!allowedFileTypes.includes(file.type)) {
      newErrors.file = 'Invalid file type. Only PDF, DOC, DOCX, JPEG, and PNG files are allowed.';
      setErrors(newErrors);
      return false;
    }

    if (file.size > maxFileSize) {
      newErrors.file = 'File size too large. Maximum size is 25MB.';
      setErrors(newErrors);
      return false;
    }

    setErrors({});
    return true;
  };

  const handleFileSelect = (file) => {
    if (validateFile(file)) {
      setSelectedFile(file);
    }
  };

  const handleFileInputChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      handleFileSelect(file);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateFile(selectedFile)) {
      return;
    }

    try {
      setLoading(true);
      await onSubmit(selectedFile, notes);
    } catch (error) {
      console.error('Error uploading document:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileIcon = (fileType) => {
    if (fileType?.includes('pdf')) {
      return '📄';
    } else if (fileType?.includes('image')) {
      return '🖼️';
    } else if (fileType?.includes('word') || fileType?.includes('document')) {
      return '📝';
    }
    return '📎';
  };

  if (!isOpen || !request) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Upload Document</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Request Information */}
          <div className="bg-blue-50 rounded-lg p-4">
            <h3 className="text-sm font-medium text-blue-800 mb-2">Document Request</h3>
            <div className="space-y-1">
              <p className="text-sm text-blue-700">
                <strong>Document:</strong> {request.documentTitle}
              </p>
              <p className="text-sm text-blue-700">
                <strong>Type:</strong> {request.documentType}
              </p>
              {request.dueDate && (
                <p className="text-sm text-blue-700">
                  <strong>Due Date:</strong> {new Date(request.dueDate.toDate ? request.dueDate.toDate() : request.dueDate).toLocaleDateString()}
                </p>
              )}
              {request.description && (
                <p className="text-sm text-blue-700">
                  <strong>Description:</strong> {request.description}
                </p>
              )}
            </div>
          </div>

          {/* File Upload Area */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Document File *
            </label>
            
            {/* Drag and Drop Area */}
            <div
              className={`relative border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                dragActive
                  ? 'border-purple-500 bg-purple-50'
                  : errors.file
                  ? 'border-red-300 bg-red-50'
                  : 'border-gray-300 hover:border-gray-400'
              }`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileInputChange}
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              
              {selectedFile ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-center">
                    <CheckCircle className="h-8 w-8 text-green-500" />
                  </div>
                  <div className="text-sm text-gray-900">
                    <span className="text-lg mr-2">{getFileIcon(selectedFile.type)}</span>
                    {selectedFile.name}
                  </div>
                  <div className="text-xs text-gray-500">
                    {formatFileSize(selectedFile.size)}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedFile(null)}
                    className="text-sm text-red-600 hover:text-red-800"
                  >
                    Remove file
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="mx-auto h-8 w-8 text-gray-400" />
                  <div className="text-sm text-gray-600">
                    <span className="font-medium text-purple-600 hover:text-purple-500 cursor-pointer">
                      Click to upload
                    </span>
                    {' '}or drag and drop
                  </div>
                  <div className="text-xs text-gray-500">
                    PDF, DOC, DOCX, JPG, PNG up to 25MB
                  </div>
                </div>
              )}
            </div>

            {errors.file && (
              <p className="mt-2 text-sm text-red-600 flex items-center">
                <AlertCircle className="h-4 w-4 mr-1" />
                {errors.file}
              </p>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Additional Notes (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any additional notes about this document..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>

          {/* File Requirements */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">File Requirements</h4>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• Accepted formats: PDF, DOC, DOCX, JPG, PNG</li>
              <li>• Maximum file size: 25MB</li>
              <li>• Ensure document is clear and readable</li>
              <li>• All required information should be visible</li>
            </ul>
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
              disabled={loading || !selectedFile}
              icon={Upload}
            >
              {loading ? 'Uploading...' : 'Upload Document'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default UploadDocumentModal;