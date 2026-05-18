import React, { useState, useEffect } from 'react';
import { X, Save, ChevronDown, Loader2 } from 'lucide-react';
import Button from '../ui/Button';
import { getUsersByCompany } from '../../services/users';
import { useAuth } from '../../hooks/useAuth';
import { toast } from 'react-toastify';

const normalizeRoleKeyValue = (value) =>
  String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const getCanonicalRole = (value) => {
  const normalized = normalizeRoleKeyValue(value);
  switch (normalized) {
    case 'sitemanager': return 'siteManager';
    case 'teammanager': return 'teamManager';
    case 'seniormanager': return 'seniorManager';
    case 'adminmanager': return 'adminManager';
    case 'hrmanager': return 'hrManager';
    case 'adminadvisor': return 'adminAdvisor';
    case 'hradvisor': return 'hrAdvisor';
    case 'contractmanager': return 'contractManager';
    case 'superuser': return 'superUser';
    case 'owner': return 'owner';
    default: return 'employee';
  }
};

const getRoleLabel = (role) => {
  switch (getCanonicalRole(role)) {
    case 'siteManager': return 'Site Manager';
    case 'teamManager': return 'Team Manager';
    case 'seniorManager': return 'Senior Manager';
    case 'adminManager': return 'Admin Manager';
    case 'hrManager': return 'HR Manager';
    case 'adminAdvisor': return 'Admin Advisor';
    case 'hrAdvisor': return 'HR Advisor';
    case 'contractManager': return 'Contract Manager';
    case 'superUser': return 'Super User';
    case 'owner': return 'Owner';
    case 'employee':
    default: return 'Employee';
  }
};

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
                role: getCanonicalRole(user.primaryRole || user.role),
                reportsTo: user.reportsTo || user.managerUserId || ''
            });
        }
    }, [user, isOpen]);

    // Fetch manager options (re-using logic from AddUserModal)
    useEffect(() => {
        const loadManagers = async () => {
            if (!authed?.companyId || !isOpen) return;
            try {
                const companyId = authed.companyId.replace('companies/', '');
                const roles = ['teamManager', 'adminManager', 'hrManager', 'seniorManager', 'siteManager', 'superUser', 'owner', 'site_manager'];
                
                const employees = await getUsersByCompany(companyId);
                const opts = employees
                    .filter(u => {
                        const r = getCanonicalRole(u.primaryRole || u.role);
                        return roles.includes(r) && u.id !== user?.id;
                    })
                    .map(u => ({ 
                        id: u.id, 
                        name: u.displayName || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email, 
                        role: getCanonicalRole(u.primaryRole || u.role)
                    }));
                
                // Ensure the current user is in the options if they have a manager role
                const currentUserId = authed?.userId || authed?.uid;
                if (currentUserId && !opts.find(o => o.id === currentUserId) && currentUserId !== user?.id) {
                    const myRole = getCanonicalRole(authed?.primaryRole || authed?.role);
                    if (roles.includes(myRole)) {
                        opts.push({
                            id: currentUserId,
                            name: authed?.displayName || authed?.email || 'Me',
                            role: myRole
                        });
                    }
                }
                
                setManagerOptions(opts);
            } catch (e) {
                console.error('[EditUserModal] Failed to load managers:', e);
            }
        };
        loadManagers();
    }, [authed?.companyId, isOpen, user?.id]);

    const getAllowedManagerRoles = (userRole) => {
        const normalizedRole = getCanonicalRole(userRole);
        const roleMapping = {
            'employee': ['teamManager', 'siteManager'],
            'hrAdvisor': ['hrManager', 'siteManager'],
            'adminAdvisor': ['adminManager', 'siteManager'],
            'contractManager': ['teamManager', 'siteManager']
        };

        return roleMapping[normalizedRole] || [];
    };

    const getFilteredManagers = (allManagers, userRole) => {
        const allowedRoles = getAllowedManagerRoles(userRole);
        const normalizedAllowed = allowedRoles.map(getCanonicalRole);

        if (allowedRoles.length > 0) {
            return allManagers.filter(manager => {
                const mRole = getCanonicalRole(manager.role);
                return normalizedAllowed.includes(mRole);
            });
        }
        return [];
    };

    const handleChange = (field, value) => {
        setFormData(prev => {
            const updated = { ...prev, [field]: value };
            if (field === 'role') {
                const canonicalVal = getCanonicalRole(value);
                if (!shouldShowReportsTo(canonicalVal)) {
                    updated.reportsTo = '';
                } else {
                    const currentManager = managerOptions.find(m => m.id === prev.reportsTo);
                    const allowedRoles = getAllowedManagerRoles(canonicalVal);
                    if (currentManager && !allowedRoles.includes(getCanonicalRole(currentManager.role))) {
                        updated.reportsTo = '';
                    }
                }
            }
            return updated;
        });
    };

    const handleSubmit = async (e) => {
        if (e) e.preventDefault();
        
        if (!formData.name.trim()) {
            toast.error('Name is required');
            return;
        }

        if (shouldShowReportsTo(formData.role) && !formData.reportsTo) {
            toast.error('Line Manager is required');
            return;
        }

        setIsLoading(true);
        try {
            const dataToSave = { 
                ...formData, 
                role: getCanonicalRole(formData.role),
                reportsTo: shouldShowReportsTo(formData.role) ? formData.reportsTo : null
            };
            await onSave(dataToSave);
            onClose();
        } catch (error) {
            console.error('[EditUserModal] Save failed:', error);
            toast.error(error.message || 'Failed to save changes');
        } finally {
            setIsLoading(false);
        }
    };

    const shouldShowReportsTo = (role) => {
        const r = getCanonicalRole(role);
        return ['employee', 'adminAdvisor', 'hrAdvisor', 'contractManager'].includes(r);
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
                                        {getFilteredManagers(managerOptions, formData.role).map(m => (
                                            <option key={m.id} value={m.id}>{m.name} ({getRoleLabel(m.role)})</option>
                                        ))}
                                    </select>
                                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
                                </div>
                                {getFilteredManagers(managerOptions, formData.role).length === 0 && (
                                    <p className="text-xs text-orange-600">
                                        No {getAllowedManagerRoles(formData.role).map(r => getRoleLabel(r)).join(' or ')} found for this role
                                    </p>
                                )}
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