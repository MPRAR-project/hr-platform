import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, FileText, AlertCircle, Loader2 } from 'lucide-react';
import Button from '../ui/Button';
import { documentService } from '../../services/documentService';
import { toast } from 'react-toastify';

const ManageDocumentTypesModal = ({ isOpen, onClose, companyId, onTypesUpdated }) => {
    const [documentTypes, setDocumentTypes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [newTypeLabel, setNewTypeLabel] = useState('');
    const [newTypeDescription, setNewTypeDescription] = useState('');
    const [showAddForm, setShowAddForm] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (isOpen && companyId) {
            loadDocumentTypes();
        }
    }, [isOpen, companyId]);

    const loadDocumentTypes = async () => {
        try {
            setLoading(true);
            const types = await documentService.getDocumentTypes(companyId);
            setDocumentTypes(types);
        } catch (err) {
            console.error('Error loading document types:', err);
            toast.error('Failed to load document types');
        } finally {
            setLoading(false);
        }
    };

    const handleAddType = async (e) => {
        e.preventDefault();
        if (!newTypeLabel.trim()) {
            setError('Document type label is required');
            return;
        }

        try {
            setSubmitting(true);
            setError(null);
            const result = await documentService.addDocumentType(companyId, {
                label: newTypeLabel,
                description: newTypeDescription
            });

            if (result.success) {
                toast.success('Document type added successfully');
                setNewTypeLabel('');
                setNewTypeDescription('');
                setShowAddForm(false);
                await loadDocumentTypes();
                if (onTypesUpdated) onTypesUpdated();
            }
        } catch (err) {
            console.error('Error adding document type:', err);
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleDeleteType = async (typeId, isDefault) => {
        if (isDefault) {
            toast.warning('Default document types cannot be deleted');
            return;
        }

        if (!window.confirm('Are you sure you want to delete this document type? Existing documents of this type will not be affected, but this type will no longer be available for new requests.')) {
            return;
        }

        try {
            setSubmitting(true);
            const result = await documentService.deleteDocumentType(companyId, typeId);
            if (result.success) {
                toast.success('Document type deleted');
                await loadDocumentTypes();
                if (onTypesUpdated) onTypesUpdated();
            }
        } catch (err) {
            console.error('Error deleting document type:', err);
            toast.error(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[60]">
            <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-200">
                    <div className="flex items-center gap-2">
                        <FileText className="h-6 w-6 text-purple-600" />
                        <h2 className="text-xl font-semibold text-gray-900">Manage Document Types</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                        <X className="h-6 w-6" />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1 space-y-6">
                    {/* Add New Type Form (Shown when toggled) */}
                    {showAddForm && (
                        <div className="bg-gray-50 rounded-lg p-6 border border-purple-100 animate-in fade-in slide-in-from-top-4 duration-300">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-md font-medium text-gray-900 flex items-center gap-2">
                                    <Plus className="h-4 w-4 text-purple-600" />
                                    Add New Document Type
                                </h3>
                                <button
                                    onClick={() => {
                                        setShowAddForm(false);
                                        setError(null);
                                    }}
                                    className="p-1 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-200"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                            <form onSubmit={handleAddType} className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Label *
                                    </label>
                                    <input
                                        type="text"
                                        value={newTypeLabel}
                                        onChange={(e) => setNewTypeLabel(e.target.value)}
                                        placeholder="e.g., Health & Safety Certificate"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                        autoFocus
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Description (Optional)
                                    </label>
                                    <textarea
                                        value={newTypeDescription}
                                        onChange={(e) => setNewTypeDescription(e.target.value)}
                                        placeholder="Briefly describe what this document is for..."
                                        rows={2}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                    />
                                </div>
                                {error && (
                                    <p className="text-sm text-red-600 flex items-center">
                                        <AlertCircle className="h-4 w-4 mr-1" />
                                        {error}
                                    </p>
                                )}
                                <div className="flex justify-end gap-2">
                                    <Button
                                        onClick={() => setShowAddForm(false)}
                                        variant="outline-secondary"
                                        disabled={submitting}
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        type="submit"
                                        variant="gradient"
                                        icon={submitting ? Loader2 : Plus}
                                    >
                                        {submitting ? 'Adding...' : 'Add Type'}
                                    </Button>
                                </div>
                            </form>
                        </div>
                    )}

                    {/* List of Types */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Current Document Types</h3>
                            {!loading && <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{documentTypes.length} types</span>}
                        </div>
                        {loading ? (
                            <div className="flex flex-col items-center justify-center py-12">
                                <Loader2 className="h-8 w-8 text-purple-600 animate-spin mb-2" />
                                <p className="text-gray-500 text-sm">Loading document types...</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {documentTypes.map((type) => {
                                    const isDefault = !type.id;
                                    return (
                                        <div
                                            key={type.value}
                                            className={`flex flex-col justify-between p-4 rounded-xl border transition-all ${isDefault ? 'bg-white border-gray-100 shadow-sm' : 'bg-purple-50/50 border-purple-100 shadow-sm'
                                                }`}
                                        >
                                            <div className="mb-2">
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="flex gap-2">
                                                        <span className="font-semibold text-gray-900 leading-tight">{type.label}</span>
                                                        {isDefault && (
                                                            <span className="w-fit mt-1 text-[9px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded uppercase font-bold tracking-wider">
                                                                Default
                                                            </span>
                                                        )}
                                                    </div>
                                                    {!isDefault && (
                                                        <button
                                                            onClick={() => handleDeleteType(type.id, isDefault)}
                                                            disabled={submitting}
                                                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"
                                                            title="Delete custom type"
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </button>
                                                    )}
                                                </div>
                                                {type.description && (
                                                    <p className="text-xs text-gray-500 mt-2 line-clamp-2">{type.description}</p>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}

                                {/* Themed Add Type Button Card */}
                                {!showAddForm && (
                                    <button
                                        onClick={() => setShowAddForm(true)}
                                        className="flex justify-center items-center gap-1 p-4 border-2 border-dashed border-gray-200 rounded-xl hover:border-purple-400 hover:bg-purple-50 transition-all group"
                                    >
                                        <div className="mb-0 group-hover:scale-110 transition-transform">
                                            <Plus className="h-4 w-4 text-purple-600" />
                                        </div>
                                        <span className="text-sm flex items-center font-bold text-gray-900 h-6">Add Type</span>
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-gray-200 bg-gray-50 rounded-b-lg">
                    <div className="flex justify-end">
                        <Button variant="outline" onClick={onClose}>
                            Close
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ManageDocumentTypesModal;
