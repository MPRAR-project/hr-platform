import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import Button from '../../../components/ui/Button';

const SiteModal = ({ isOpen, onClose, onSubmit, site = null, isSubmitting = false }) => {
    const [formData, setFormData] = useState({
        name: '',
        address: '',
        managerId: '' // Optional site manager ID
    });

    useEffect(() => {
        if (site) {
            setFormData({
                name: site.name || '',
                address: site.address || '',
                managerId: site.managerId || ''
            });
        } else {
            setFormData({
                name: '',
                address: '',
                managerId: ''
            });
        }
    }, [site, isOpen]);

    if (!isOpen) return null;

    const handleSubmit = (e) => {
        e.preventDefault();
        onSubmit(formData);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
                <div className="flex justify-between items-center p-6 border-b">
                    <h2 className="text-xl font-semibold text-gray-800">
                        {site ? 'Edit Site' : 'Add New Site'}
                    </h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
                        <X size={24} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Site Name *
                        </label>
                        <input
                            type="text"
                            required
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder="e.g. Headquarters"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Address
                        </label>
                        <input
                            type="text"
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={formData.address}
                            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                            placeholder="e.g. 123 Main St"
                        />
                    </div>

                    {/* Future: Add Manager Selector Dropdown */}

                    <div className="flex justify-end gap-3 mt-6">
                        <Button
                            variant="secondary"
                            onClick={onClose}
                            type="button"
                            disabled={isSubmitting}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="primary"
                            type="submit"
                            isLoading={isSubmitting}
                        >
                            {site ? 'Save Changes' : 'Add Site'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default SiteModal;
