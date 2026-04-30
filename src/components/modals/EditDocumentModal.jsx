import { ArrowRight, ChevronDown, Save, X } from "lucide-react";
import { useState, useEffect } from "react";
import Button from "../ui/Button";
import { documentService } from "../../services/documentService";

const EditDocumentModal = ({ isOpen, onClose, document, onSave, companyId }) => {
  const [documentTitle, setDocumentTitle] = useState(document?.documentTitle || document?.name || '');
  const [documentDescription, setDocumentDescription] = useState(document?.description || '');
  const [documentType, setDocumentType] = useState(document?.documentType || document?.category || 'General');
  const [documentTypes, setDocumentTypes] = useState([]);
  const [loadingTypes, setLoadingTypes] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setDocumentTitle(document?.documentTitle || document?.name || '');
      setDocumentDescription(document?.description || '');
      setDocumentType(document?.documentType || document?.category || 'General');
      loadDocumentTypes();
    }
  }, [isOpen, document, companyId]);

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

  const handleSave = () => {
    if (onSave) {
      onSave({
        ...document,
        documentTitle,
        description: documentDescription,
        documentType
      });
      onClose();
    }
  };

  if (!isOpen || !document) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]" onClick={onClose}></div>

      <div className="relative w-full max-w-[540px] bg-white rounded-[24px] shadow-[0_4px_20px_rgba(0,0,0,0.1)] p-6 max-h-[90vh] overflow-y-auto scrollbar-custom">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex justify-between items-start">
            <h2 className="text-xl font-bold text-gray-900">
              Edit Document Details
            </h2>
            <button onClick={onClose} className="w-6 h-6 flex items-center justify-center bg-black/10 rounded-full hover:bg-black/20 transition-colors flex-shrink-0">
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
              placeholder="Document title"
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
              Document Type
            </label>
            <div className="relative">
              <select
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value)}
                className="w-full h-12 px-4 pr-10 border border-gray-300 rounded-lg text-sm appearance-none focus:outline-none focus:border-purple-500"
              >
                {documentTypes.map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-3 gap-4">
            <Button
              onClick={onClose}
              variant='outline-secondary'
              cn='col-span-1 h-12'
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!documentTitle}
              variant='gradient'
              cn="col-span-2 h-12 flex justify-center"
              icon={Save}
              iconFirst={true}
            >
              <span>Save Changes</span>

            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
export default EditDocumentModal;  