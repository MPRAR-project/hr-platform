import React, { useState, useEffect } from 'react';
import { X, ArrowRight, User, ChevronDown, Save } from 'lucide-react';
import Button from '../ui/Button';
import { toast } from 'react-toastify';
import { db } from '../../firebase/client';
import { collection, getDocs, query, where, doc, getDoc } from 'firebase/firestore';
import { useAuth } from '../../hooks/useAuth';

// Helper functions for role-based logic (same as AddUserModal)
const isManagerRole = (role) => {
    const managerRoles = ['teamManager', 'adminManager', 'hrManager'];
    return managerRoles.includes(role);
};

const shouldShowReportsTo = (role) => {
    return !isManagerRole(role);
};

// Get allowed manager roles for a specific user role
const getAllowedManagerRoles = (userRole) => {
    const roleMapping = {
        'employee': ['teamManager'],
        'hrAdvisor': ['hrManager'],
        'adminAdvisor': ['adminManager'],
        'contractManager': ['teamManager'] // Contract managers typically report to team managers
    };

    return roleMapping[userRole] || [];
};

// Filter managers based on user role
const getFilteredManagers = (allManagers, userRole) => {
    const allowedRoles = getAllowedManagerRoles(userRole);
    if (allowedRoles.length === 0) {
        return allManagers; // Fallback to all managers if no specific mapping
    }

    return allManagers.filter(manager => allowedRoles.includes(manager.role));
};

const EditUserModal = ({
    isOpen,
    onClose,
    onSave,
    user = null
}) => {
    const { user: authed } = useAuth();
    const [formData, setFormData] = useState({
        name: '',
        role: 'employee',
        reportsTo: ''
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [managerOptions, setManagerOptions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [fullUserData, setFullUserData] = useState(null);

    // Load managers from Firebase
    useEffect(() => {
        const loadManagers = async () => {
            try {
                if (!authed?.companyId) return;
                const companyPath = authed.companyId;
                const companyId = companyPath.includes('/') ? companyPath.split('/')[1] : companyPath;
                const roles = ['teamManager', 'adminManager', 'hrManager'];
                const usersCol = collection(db, 'users');
                // fetch all managers for the company
                const q = query(usersCol, where('companyId', '==', `companies/${companyId}`));
                const snap = await getDocs(q);
                const opts = snap.docs
                    .map(d => ({ id: d.id, ...d.data() }))
                    .filter(u => roles.includes(u.primaryRole))
                    .map(u => ({ id: u.id, name: u.displayName || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email, role: u.primaryRole }));
                setManagerOptions(opts);
            } catch (e) {
                console.error('Failed to load managers', e);
            }
        };
        if (isOpen) {
            loadManagers();
        }
    }, [authed?.companyId, isOpen]);

    // Load user data when modal opens
    useEffect(() => {
        const loadUserData = async () => {
            if (!isOpen || !user?.id) return;

            try {
                setLoading(true);
                // Fetch full user data from Firebase
                const userDoc = await getDoc(doc(db, 'users', user.id));
                if (userDoc.exists()) {
                    const userData = userDoc.data();
                    setFullUserData(userData);

                    // Set form data with fetched user data
                    setFormData({
                        name: userData.displayName || `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || userData.email || user.name || '',
                        role: userData.primaryRole || user.role || 'employee',
                        reportsTo: userData.reportsTo || user.reportsTo || ''
                    });
                } else {
                    // Fallback to passed user data
                    setFormData({
                        name: user.name || '',
                        role: user.role || 'employee',
                        reportsTo: user.reportsTo || ''
                    });
                }
            } catch (e) {
                console.error('Failed to load user data:', e);
                // Fallback to passed user data
                setFormData({
                    name: user.name || '',
                    role: user.role || 'employee',
                    reportsTo: user.reportsTo || ''
                });
            } finally {
                setLoading(false);
            }
        };

        loadUserData();
    }, [isOpen, user]);

    // Handle form field changes with role-based logic
    const handleFormChange = (field, value) => {
        setFormData(prev => {
            const updated = { ...prev, [field]: value };

            // Clear reportsTo field when switching to manager role or when role changes
            if (field === 'role') {
                if (isManagerRole(value)) {
                    // Manager roles don't need reportsTo
                    updated.reportsTo = '';
                } else {
                    // Check if current reportsTo is still valid for the new role
                    const currentManager = managerOptions.find(m => m.id === prev.reportsTo);
                    const allowedRoles = getAllowedManagerRoles(value);

                    if (currentManager && !allowedRoles.includes(currentManager.role)) {
                        // Current manager is not valid for the new role, clear it
                        updated.reportsTo = '';
                    }
                }
            }

            return updated;
        });
    };

    const handleSave = async () => {
        if (isSubmitting) return;

        // Validation
        if (!formData.name?.trim()) {
            toast.error('Name is required');
            return;
        }

        // Validate reportsTo field only for non-manager roles
        if (shouldShowReportsTo(formData.role) && !formData.reportsTo?.trim()) {
            toast.error('Reports To is required for non-manager roles');
            return;
        }

        try {
            setIsSubmitting(true);
            await Promise.resolve(onSave?.({ ...formData, userId: user?.id }));
            toast.success('User updated successfully');
            onClose();
        } catch (e) {
            const message = e?.message || 'Failed to update user';
            toast.error(message);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen || !user) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]"
                onClick={onClose}
            ></div>

            {/* Modal */}
            <div className="relative w-full max-w-[492px] bg-white rounded-[24px] shadow-[0_4px_20px_rgba(0,0,0,0.1)] p-4 max-h-[90vh] overflow-y-auto scrollbar-custom">
                <div className="flex flex-col gap-6 p-2">
                    {/* Header */}
                    <div className="flex justify-between items-start gap-5">
                        <div className="flex flex-col gap-1">
                            <h2 className="text-xl font-semibold text-text-primary">Edit User</h2>
                            <p className="text-[13px] leading-5 text-text-secondary">
                                Edit the user for this team member
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            className="w-6 h-6 flex items-center justify-center bg-black/10 rounded-full hover:bg-black/20 transition-colors flex-shrink-0"
                        >
                            <X className="h-4 w-4 text-text-secondary" />
                        </button>
                    </div>

                    {/* Existing User Info */}
                    <div>
                        <label className="text-md font-semibold text-text-primary mb-3 block">
                            Current User Details
                        </label>
                        <div className="flex items-center justify-between p-3 border border-border-secondary rounded-lg bg-bg-secondary">
                            <div className="flex flex-col gap-1">
                                <span className="text-md font-semibold text-text-primary capitalize">
                                    {fullUserData?.displayName || `${fullUserData?.firstName || ''} ${fullUserData?.lastName || ''}`.trim() || fullUserData?.email || user?.name || 'Loading...'}
                                </span>
                                <span className="text-sm text-text-secondary">
                                    {fullUserData?.email || user?.email || 'Loading...'}
                                </span>
                                {fullUserData?.reportsTo && (
                                    // <span className="text-xs text-text-secondary">
                                    //     Reports to: {managerOptions.find(m => m.id === fullUserData.reportsTo)?.name || fullUserData.reportsTo}
                                    // </span>
                                    <span className="text-xs text-text-secondary">
                                        Line Manager: {managerOptions.find(m => m.id === fullUserData.reportsTo)?.name || fullUserData.reportsTo}
                                    </span>
                                )}
                            </div>
                            <div className="px-3 py-1.5 bg-purple-100 rounded-full">
                                <span className="text-[13px] font-medium text-purple-600 capitalize">
                                    {fullUserData?.primaryRole || user?.role || 'Loading...'}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* New Name Input */}
                    <div>
                        <label className="text-md font-semibold text-text-primary mb-3 block">
                            New Name
                        </label>
                        <div className="relative">
                            <div className="absolute left-4 top-1/2 -translate-y-1/2">
                                <User className="h-4 w-4 text-text-secondary" />
                            </div>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={(e) => handleFormChange('name', e.target.value)}
                                placeholder="Thomas"
                                disabled={loading}
                                className="w-full h-12 pl-10 pr-4 border border-border-secondary rounded-lg text-md text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple disabled:bg-gray-50 disabled:text-gray-500"
                            />
                        </div>
                    </div>

                    {/* New Role Dropdown */}
                    <div>
                        <label className="text-md font-semibold text-text-primary mb-3 block">
                            New Role
                        </label>
                        <div className="relative">
                            <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none">
                                <User className="h-4 w-4 text-text-secondary" />
                            </div>
                            <select
                                value={formData.role}
                                onChange={(e) => handleFormChange('role', e.target.value)}
                                disabled={loading}
                                className="w-full h-12 pl-10 pr-10 border border-border-secondary rounded-lg text-md text-text-primary appearance-none focus:outline-none focus:border-border-accent-purple disabled:bg-gray-50 disabled:text-gray-500"
                            >
                                <option value="teamManager">Team Manager</option>
                                <option value="adminManager">Admin Manager</option>
                                <option value="hrManager">HR Manager</option>
                                <option value="employee">Employee</option>
                                <option value="adminAdvisor">Admin Advisor</option>
                                <option value="hrAdvisor">HR Advisor</option>
                                <option value="contractManager">Contract Manager</option>
                            </select>
                            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
                        </div>
                    </div>

                    {/* Reports To (conditional based on role) */}
                    {shouldShowReportsTo(formData.role) && (
                        <div>
                            {/* <label className="text-md font-semibold text-text-primary mb-3 block">
                                Reports To <span className="text-red-500">*</span>
                                <span className="text-xs text-text-secondary ml-1">
                                    ({getAllowedManagerRoles(formData.role).map(role =>
                                        role.replace('Manager', ' Manager').replace(/([A-Z])/g, ' $1').trim()
                                    ).join(' or ')})
                                </span>
                            </label> */}
                            <label className="text-md font-semibold text-text-primary mb-3 block">
                                Line Manager <span className="text-red-500">*</span>
                                <span className="text-xs text-text-secondary ml-1">
                                    ({getAllowedManagerRoles(formData.role).map(role =>
                                        role.replace('Manager', ' Manager').replace(/([A-Z])/g, ' $1').trim()
                                    ).join(' or ')})
                                </span>
                            </label>
                            <div className="relative">
                                <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none">
                                    <User className="h-4 w-4 text-text-secondary" />
                                </div>
                                <select
                                    value={formData.reportsTo || ''}
                                    onChange={(e) => handleFormChange('reportsTo', e.target.value)}
                                    disabled={loading}
                                    className="w-full h-12 pl-10 pr-10 border border-border-secondary rounded-lg text-md text-text-primary appearance-none focus:outline-none focus:border-border-accent-purple disabled:bg-gray-50 disabled:text-gray-500"
                                >
                                    <option value="">Select Manager</option>
                                    {getFilteredManagers(managerOptions, formData.role).map(m => (
                                        <option key={m.id} value={m.id}>{m.name} ({m.role})</option>
                                    ))}
                                </select>
                                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
                            </div>
                            {getFilteredManagers(managerOptions, formData.role).length === 0 && (
                                <p className="text-xs text-orange-600 mt-1">
                                    No {getAllowedManagerRoles(formData.role).join(' or ')} found for this role
                                </p>
                            )}
                        </div>
                    )}



                    {/* Info Message */}
                    <div className="p-4 bg-purple-50 border border-border-accent-purple rounded-lg">
                        <p className="text-[13px] leading-5 text-text-accent-purple">
                            Role changes take effect immediately and don't affect billing.
                        </p>
                    </div>

                    {/* Action Buttons */}
                    <div className="grid grid-cols-3 gap-4">
                        <Button
                            onClick={onClose}
                            variant='outline-secondary'
                            cn='col-span-1 h-12'
                            disabled={isSubmitting || loading}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleSave}
                            variant='gradient'
                            cn={`col-span-2 h-12 ${(isSubmitting || loading) ? 'opacity-80 cursor-not-allowed' : ''}`}
                            icon={Save}
                            iconFirst={true}
                            disabled={isSubmitting || loading}
                        >
                            <span>{isSubmitting ? 'Saving...' : loading ? 'Loading...' : 'Save Changes'}</span>
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
export default EditUserModal;
