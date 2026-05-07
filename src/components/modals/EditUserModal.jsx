import React, { useState, useEffect } from 'react';
import { X, Save, ChevronDown, Loader2 } from 'lucide-react';
import Button from '../ui/Button';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../firebase/client';
import { useAuth } from '../../hooks/useAuth';
import { toast } from 'react-toastify';

const EditUserModal = ({ isOpen, onClose, user, onSave }) => {
    const { user: authed } = useAuth();
    const [isLoading, setIsLoading] = useState(false);
    const [managerOptions, setManagerOptions] = useState([]);
    
    const [formData, setFormData] = useState({
        name: '',
        role: '',
        reportsTo: ''
    });

    useEffect(() => {
        if (user) {
            setFormData({
                name: user.displayName || `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.name || '',
                role: user.primaryRole || user.role || 'employee',
                reportsTo: user.reportsTo || ''
            });
        }
    }, [user, isOpen]);

    // Fetch manager options (re-using logic from AddUserModal)
    useEffect(() => {
        const loadManagers = async () => {
            if (!authed?.companyId || !isOpen) return;
            try {
                const companyPath = authed.companyId;
                const companyId = companyPath.includes('/') ? companyPath.split('/')[1] : companyPath;
                const roles = ['teamManager', 'adminManager', 'hrManager', 'seniorManager', 'siteManager', 'superUser'];
                const usersCol = collection(db, 'users');
                
                // fetch all potential managers for the company
                const q = query(usersCol, where('companyId', '==', `companies/${companyId}`));
                const snap = await getDocs(q);
                
                const opts = snap.docs
                    .map(d => ({ id: d.id, ...d.data() }))
                    .filter(u => roles.includes(u.primaryRole) && u.id !== user?.id) // Don't include self
                    .map(u => ({ 
                        id: u.id, 
                        name: u.displayName || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email, 
                        role: u.primaryRole 
                    }));
                
                setManagerOptions(opts);
            } catch (e) {
                console.error('[EditUserModal] Failed to load managers:', e);
            }
        };
        loadManagers();
    }, [authed?.companyId, isOpen, user?.id]);

    const handleChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleSubmit = async (e) => {
        if (e) e.preventDefault();
        
        if (!formData.name.trim()) {
            toast.error('Name is required');
            return;
        }

        setIsLoading(true);
        try {
            await onSave(formData);
            onClose();
        } catch (error) {
            console.error('[EditUserModal] Save failed:', error);
            toast.error(error.message || 'Failed to save changes');
        } finally {
            setIsLoading(false);
        }
    };

    const shouldShowReportsTo = (role) => {
        return !['siteManager', 'superUser'].includes(role);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div 
                className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]"
                onClick={onClose}
            ></div>

            {/* Modal */}
            <div className="relative w-full max-w-[500px] bg-white rounded-base shadow-[0_4px_20px_rgba(0,0,0,0.1)] p-6 overflow-hidden">
                <div className="flex flex-col gap-6">
                    {/* Header */}
                    <div className="flex justify-between items-start">
                        <div className="flex flex-col gap-1">
                            <h2 className="text-xl font-semibold text-text-primary">Edit User Details</h2>
                            <p className="text-sm text-text-secondary">
                                Update information for {user?.email}
                            </p>
                        </div>
                        <button 
                            onClick={onClose}
                            className="w-8 h-8 flex items-center justify-center bg-black/5 rounded-full hover:bg-black/10 transition-colors"
                        >
                            <X className="h-4 w-4 text-text-secondary" />
                        </button>
                    </div>

                    {/* Form */}
                    <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-2">
                            <label className="text-sm font-medium text-text-primary">
                                Full Name <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => handleChange('name', e.target.value)}
                                placeholder="Enter full name"
                                className="w-full h-11 px-4 border border-border-secondary rounded-lg text-sm focus:outline-none focus:border-border-accent-purple"
                            />
                        </div>

                        <div className="flex flex-col gap-2">
                            <label className="text-sm font-medium text-text-primary">
                                Role <span className="text-red-500">*</span>
                            </label>
                            <div className="relative">
                                <select
                                    value={formData.role}
                                    onChange={(e) => handleChange('role', e.target.value)}
                                    className="w-full h-11 px-4 pr-10 border border-border-secondary rounded-lg text-sm appearance-none focus:outline-none focus:border-border-accent-purple"
                                >
                                    <option value="seniorManager">Senior Manager</option>
                                    <option value="teamManager">Team Manager</option>
                                    <option value="adminManager">Admin Manager</option>
                                    <option value="hrManager">HR Manager</option>
                                    <option value="employee">Employee</option>
                                    <option value="adminAdvisor">Admin Advisor</option>
                                    <option value="hrAdvisor">HR Advisor</option>
                                    <option value="contractManager">Contract Manager</option>
                                </select>
                                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
                            </div>
                        </div>

                        {shouldShowReportsTo(formData.role) && (
                            <div className="flex flex-col gap-2">
                                <label className="text-sm font-medium text-text-primary">
                                    Line Manager <span className="text-red-500">*</span>
                                </label>
                                <div className="relative">
                                    <select
                                        value={formData.reportsTo}
                                        onChange={(e) => handleChange('reportsTo', e.target.value)}
                                        className="w-full h-11 px-4 pr-10 border border-border-secondary rounded-lg text-sm appearance-none focus:outline-none focus:border-border-accent-purple"
                                    >
                                        <option value="">Select Manager</option>
                                        {managerOptions.map(m => (
                                            <option key={m.id} value={m.id}>{m.name} ({m.role})</option>
                                        ))}
                                    </select>
                                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 mt-2">
                        <Button
                            onClick={onClose}
                            variant="outline-secondary"
                            cn="flex-1 h-11"
                            disabled={isLoading}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleSubmit}
                            variant="gradient"
                            cn="flex-1 h-11"
                            disabled={isLoading}
                            icon={isLoading ? Loader2 : Save}
                        >
                            {isLoading ? 'Saving...' : 'Save Changes'}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default EditUserModal;