import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import Button from '../../../components/ui/Button';

const ClientModal = ({ isOpen, onClose, onSubmit, client = null, isSubmitting = false }) => {
    const [formData, setFormData] = useState({
        name: '',
        contactPerson: '',
        email: '',
        notes: ''
    });

    const [errors, setErrors] = useState({
        name: '',
        contactPerson: '',
        email: ''
    });

    useEffect(() => {
        if (client) {
            setFormData({
                name: client.name || '',
                contactPerson: client.contactPerson || '',
                email: client.email || '',
                notes: client.notes || ''
            });
        } else {
            setFormData({
                name: '',
                contactPerson: '',
                email: '',
                notes: ''
            });
        }
        // Clear errors when modal opens/closes or client changes
        setErrors({ name: '', contactPerson: '', email: '' });
    }, [client, isOpen]);

    if (!isOpen) return null;

    // Email validation function
    const isValidEmail = (email) => {
        if (!email) return true; // Email is optional
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    };

    // Block numbers in name field
    const handleNameChange = (e) => {
        const value = e.target.value;
        // Remove any numbers from the input
        const nameWithoutNumbers = value.replace(/[0-9]/g, '');

        setFormData({ ...formData, name: nameWithoutNumbers });

        // Clear name error when user starts typing
        if (errors.name) {
            setErrors({ ...errors, name: '' });
        }
    };

    // Handle key down to block number keys for name
    const handleNameKeyDown = (e) => {
        // Block number keys (both top row and numpad)
        if (e.key >= '0' && e.key <= '9') {
            e.preventDefault();
            // Show error message immediately
            setErrors({ ...errors, name: 'Numbers are not allowed in client name' });
        }
    };

    // Block numbers in contact person field
    const handleContactPersonChange = (e) => {
        const value = e.target.value;
        // Remove any numbers from the input
        const contactWithoutNumbers = value.replace(/[0-9]/g, '');

        setFormData({ ...formData, contactPerson: contactWithoutNumbers });

        // Clear contact person error when user starts typing
        if (errors.contactPerson) {
            setErrors({ ...errors, contactPerson: '' });
        }
    };

    // Handle key down to block number keys for contact person
    const handleContactPersonKeyDown = (e) => {
        // Block number keys (both top row and numpad)
        if (e.key >= '0' && e.key <= '9') {
            e.preventDefault();
            // Show error message immediately
            setErrors({ ...errors, contactPerson: 'Numbers are not allowed in contact person' });
        }
    };

    const handleEmailChange = (e) => {
        const value = e.target.value;
        setFormData({ ...formData, email: value });
        // Clear email error when user starts typing
        if (errors.email) {
            setErrors({ ...errors, email: '' });
        }
    };

    const validateForm = () => {
        const newErrors = {
            name: '',
            contactPerson: '',
            email: ''
        };

        // Validate name (required)
        if (!formData.name.trim()) {
            newErrors.name = 'Client name is required';
        }

        // Validate contact person (optional but no numbers allowed)
        if (formData.contactPerson && /\d/.test(formData.contactPerson)) {
            newErrors.contactPerson = 'Contact person cannot contain numbers';
        }

        // Validate email format if provided
        if (formData.email && !isValidEmail(formData.email)) {
            newErrors.email = 'Please enter a valid email address';
        }

        setErrors(newErrors);

        // Return true if no errors
        return !newErrors.name && !newErrors.contactPerson && !newErrors.email;
    };

    const handleSubmit = (e) => {
        e.preventDefault();

        if (validateForm()) {
            onSubmit(formData);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
                <div className="flex justify-between items-center p-6 border-b">
                    <h2 className="text-xl font-semibold text-gray-800">
                        {client ? 'Edit Client' : 'Add New Client'}
                    </h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
                        <X size={24} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Client Name *
                        </label>
                        <input
                            type="text"
                            required
                            className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.name ? 'border-red-500' : 'border-gray-300'
                                }`}
                            value={formData.name}
                            onChange={handleNameChange}
                            onKeyDown={handleNameKeyDown}
                            placeholder="e.g. Acme Corp"
                        />
                        {errors.name && (
                            <p className="mt-1 text-sm text-red-600">{errors.name}</p>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Contact Person
                        </label>
                        <input
                            type="text"
                            className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.contactPerson ? 'border-red-500' : 'border-gray-300'
                                }`}
                            value={formData.contactPerson}
                            onChange={handleContactPersonChange}
                            onKeyDown={handleContactPersonKeyDown}
                            placeholder="e.g. John Doe"
                        />
                        {errors.contactPerson && (
                            <p className="mt-1 text-sm text-red-600">{errors.contactPerson}</p>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Email
                        </label>
                        <input
                            type="email"
                            className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.email ? 'border-red-500' : 'border-gray-300'
                                }`}
                            value={formData.email}
                            onChange={handleEmailChange}
                            placeholder="client@example.com"
                        />
                        {errors.email && (
                            <p className="mt-1 text-sm text-red-600">{errors.email}</p>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Notes
                        </label>
                        <textarea
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            rows="3"
                            value={formData.notes}
                            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                            placeholder="Additional details..."
                        />
                    </div>

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
                            {client ? 'Save Changes' : 'Add Client'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ClientModal;