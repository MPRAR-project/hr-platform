import { useState, useEffect } from 'react';
import { X, Upload, ArrowRight, ChevronDown } from 'lucide-react';
import Button from '../ui/Button';
import { documentService } from '../../services/documentService';

const AddDocumentModal = ({ isOpen, onClose, employee, onUpload, companyId, initialTitle = '', initialDescription = '', initialTag = 'General' }) => {
  const [documentTitle, setDocumentTitle] = useState(initialTitle);
  const [documentDescription, setDocumentDescription] = useState(initialDescription);
  const [documentTag, setDocumentTag] = useState(initialTag);
  const [documentTypes, setDocumentTypes] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [loadingTypes, setLoadingTypes] = useState(false);

  // Initialize state when modal opens or initial values change
  useEffect(() => {
    if (isOpen) {
      setDocumentTitle(initialTitle);
      setDocumentDescription(initialDescription);
      setDocumentTag(initialTag);
      setSelectedFile(null);
      loadDocumentTypes();
    }
  }, [isOpen, initialTitle, initialDescription, initialTag, companyId]);

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

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
      if (!documentTitle) {
        setDocumentTitle(file.name);
      }
    }
  };

  const handleUpload = async () => {
    if (!onUpload || !selectedFile) return;

    try {
      setIsUploading(true);

      // Call the upload handler and wait for it to complete
      const result = onUpload({
        documentTitle,
        documentDescription,
        documentTag,
        file: selectedFile
      });

      // If onUpload returns a promise, wait for it
      if (result && typeof result.then === 'function') {
        await result;
      }

      // Only reset form and close modal after successful upload
      setDocumentTitle('');
      setDocumentDescription('');
      setDocumentTag('General');
      setSelectedFile(null);
      onClose();
    } catch (error) {
      console.error('Error uploading document:', error);
      // Don't close the modal if there was an error
      // Let the onUpload function handle error display
    } finally {
      setIsUploading(false);
    }
  };

  if (!isOpen || !employee) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]" onClick={isUploading ? undefined : onClose}></div>

      <div className="relative w-full max-h-[90vh] max-w-[520px] bg-white rounded-[24px] shadow-[0_4px_20px_rgba(0,0,0,0.1)] p-6 overflow-y-auto scrollbar-custom">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex justify-between items-start">
            <h2 className="text-xl font-bold text-gray-900">
              Add Document for {employee.name}
            </h2>
            <button
              onClick={isUploading ? undefined : onClose}
              disabled={isUploading}
              className={`w-6 h-6 flex items-center justify-center bg-black/10 rounded-full transition-colors flex-shrink-0 ${isUploading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-black/20'
                }`}
            >
              <X className="h-4 w-4 text-gray-600" />
            </button>
          </div>

          {/* Document Title */}
          <div>
            <label className="text-sm font-medium text-gray-900 mb-3 block">
              Document Title
            </label>
            <input
              type="text"
              value={documentTitle}
              onChange={(e) => setDocumentTitle(e.target.value)}
              placeholder="e.g., Emergency Contact Form"
              className="w-full h-12 px-4 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:border-purple-500"
            />
          </div>

          {/* Document Description */}
          <div>
            <label className="text-sm font-medium text-gray-900 mb-3 block">
              Document Description
            </label>
            <textarea
              value={documentDescription}
              onChange={(e) => setDocumentDescription(e.target.value)}
              placeholder="Brief description of the document..."
              rows={3}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:border-purple-500 resize-none"
            />
          </div>

          {/* Document Tag */}
          <div>
            <label className="text-sm font-medium text-gray-900 mb-3 block">
              Document Tag
            </label>
            <div className="relative">
              <select
                value={documentTag}
                onChange={(e) => setDocumentTag(e.target.value)}
                className="w-full h-12 px-4 pr-10 border border-gray-300 rounded-lg text-sm appearance-none focus:outline-none focus:border-purple-500"
              >
                {documentTypes.map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
            </div>
          </div>

          {/* Upload Document */}
          <div>
            <label className="text-sm font-medium text-gray-900 mb-3 block">
              Upload Document
            </label>
            <div className="relative border-2 border-dashed border-purple-400 rounded-lg p-8 text-center hover:bg-purple-50 transition-colors cursor-pointer">
              <input
                type="file"
                onChange={handleFileSelect}
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <Upload className="h-8 w-8 text-purple-600 mx-auto mb-3" />
              <p className="text-sm text-purple-600 font-medium mb-1">
                Click to upload or drag and drop
              </p>
              <p className="text-sm text-gray-600">
                PDF, DOC, JPG up to 10MB
              </p>
              {selectedFile && (
                <p className="text-sm text-green-500 mt-2 font-medium">
                  Selected: {selectedFile.name}
                </p>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className=" grid grid-cols-3 gap-4">
            <Button
              onClick={onClose}
              variant='outline-secondary'
              className="col-span-1 h-12"
              disabled={isUploading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpload}
              variant='gradient'
              icon={Upload}
              disabled={!selectedFile || !documentTitle || isUploading}
              cn='col-span-2 h-12 flex justify-center'
            >
              {isUploading ? 'Uploading...' : 'Upload'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
export default AddDocumentModal;