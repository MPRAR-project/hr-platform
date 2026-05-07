import React, { useEffect, useState } from 'react';
import { X, Plus, ArrowRight, ChevronDown, Loader2, AlertTriangle } from 'lucide-react';
import Button from '../ui/Button';
import { toast } from 'react-toastify';
import { db } from '../../firebase/client';
import { collection, getDocs, query, where, limit } from 'firebase/firestore';
import { addUsersBySiteManager } from '../../services/users';
import { sendUserInvite } from '../../services/invitations';
import { useAuth } from '../../hooks/useAuth';

// Email validation function
const validateEmail = (email) => {
    if (!email || typeof email !== 'string') {
        return { isValid: false, message: 'Email address is required' };
    }

    const trimmedEmail = email.trim();

    // Check for empty string after trimming
    if (!trimmedEmail) {
        return { isValid: false, message: 'Email address is required' };
    }

    // Check for spaces
    if (trimmedEmail.includes(' ')) {
        return { isValid: false, message: 'Email address cannot contain spaces' };
    }

    // Basic email format validation using regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
        return { isValid: false, message: 'Please enter a valid email address (e.g., user@domain.com)' };
    }

    // More detailed validation
    const [localPart, domain] = trimmedEmail.split('@');

    // Check local part (before @)
    if (!localPart || localPart.length === 0) {
        return { isValid: false, message: 'Email must have a username before the @ symbol' };
    }

    if (localPart.length > 64) {
        return { isValid: false, message: 'Email username is too long (maximum 64 characters)' };
    }

    // Check for invalid characters in local part
    const localPartRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
    if (!localPartRegex.test(localPart)) {
        return { isValid: false, message: 'Email username contains invalid characters' };
    }

    // Check domain part (after @)
    if (!domain || domain.length === 0) {
        return { isValid: false, message: 'Email must have a domain after the @ symbol' };
    }

    // Check if domain starts or ends with dot or hyphen
    if (domain.startsWith('.') || domain.startsWith('-') || domain.endsWith('.') || domain.endsWith('-')) {
        return { isValid: false, message: 'Email domain format is invalid' };
    }

    // Check for consecutive dots in domain
    if (domain.includes('..')) {
        return { isValid: false, message: 'Email domain cannot contain consecutive dots' };
    }

    // Split domain to check TLD
    const domainParts = domain.split('.');
    if (domainParts.length < 2) {
        return { isValid: false, message: 'Email domain must include a top-level domain (e.g., .com, .org)' };
    }

    // Check TLD (last part)
    const tld = domainParts[domainParts.length - 1];
    if (!tld || tld.length < 2) {
        return { isValid: false, message: 'Email domain must have a valid top-level domain (e.g., .com, .org)' };
    }

    // Check if any domain part is empty
    if (domainParts.some(part => !part || part.length === 0)) {
        return { isValid: false, message: 'Email domain format is invalid' };
    }

    // Check domain length
    if (domain.length > 253) {
        return { isValid: false, message: 'Email domain is too long' };
    }

    return { isValid: true, message: '' };
};


const AddUserModal = ({ isOpen, onClose, onSubmit }) => {
    const { user: authed } = useAuth();
    const [users, setUsers] = useState([
        {
            id: 1,
            fullName: '',
            email: '',
            role: 'employee',
            reportsTo: '',
            enableOnboarding: false,
            isTrainingMandatory: false
        }
    ]);

    const [emailErrors, setEmailErrors] = useState({});
    const [managerOptions, setManagerOptions] = useState([]);
    // Resolved siteId – populated from auth profile or fetched from Firestore for site managers
    // whose profile is missing the siteId field (e.g. older/migrated accounts).
    const [resolvedSiteId, setResolvedSiteId] = useState(null);

    // Computed property to check if Senior Manager role exists in the company
    const hasSeniorManager = managerOptions.some(m => m.role === 'seniorManager');

    // Helper functions for role-based logic (moved inside to access hasSeniorManager)
    const isManagerRole = (role) => {
        const managerRoles = ['teamManager', 'adminManager', 'hrManager', 'seniorManager'];
        return managerRoles.includes(role);
    };

    // Updated: Reports To visibility depends on role
    const shouldShowReportsTo = (role) => {
        // Site Managers and Super Users are at the top and don't report to others here
        if (['siteManager', 'superUser'].includes(role)) return false;

        // Everyone else (including all other manager types) reports to someone
        return true;
    };

    // Check if form can be submitted (no validation errors and all required fields filled)
    const canSubmit = users.every(user => {
        // Check required fields
        if (!user.fullName?.trim() || !user.email?.trim()) {
            return false;
        }

        // Check email validation
        const emailValidation = validateEmail(user.email);
        if (!emailValidation.isValid) {
            return false;
        }

        // Check reportsTo field only for non-manager roles
        if (shouldShowReportsTo(user.role) && !user.reportsTo?.trim()) {
            return false;
        }

        return true;
    });

    // Updated: Get allowed manager roles based on user role and hierarchy
    const getAllowedManagerRoles = (userRole) => {
        // If user is a mid-level manager, they report to Senior Manager (or fallback to Site Manager)
        if (['teamManager', 'adminManager', 'hrManager', 'seniorManager'].includes(userRole)) {
            return ['seniorManager', 'siteManager', 'superUser'];
        }

        const roleMapping = {
            'employee': ['teamManager', 'siteManager', 'superUser'],
            'hrAdvisor': ['hrManager', 'siteManager', 'superUser'],
            'adminAdvisor': ['adminManager', 'siteManager', 'superUser'],
            'contractManager': ['teamManager', 'siteManager', 'superUser']
        };

        return roleMapping[userRole] || ['siteManager', 'superUser'];
    };

    // Filter managers based on user role
    const getFilteredManagers = (allManagers, userRole) => {
        const allowedRoles = getAllowedManagerRoles(userRole);
        // If we expect specific roles (like seniorManager), strictly filter
        if (allowedRoles.length > 0) {
            return allManagers.filter(manager => allowedRoles.includes(manager.role));
        }
        return allManagers;
    };

    const handleAddMore = () => {
        setUsers([
            ...users,
            {
                id: users.length + 1,
                fullName: '',
                email: '',
                password: '',
                role: 'employee',
                reportsTo: '',
                enableOnboarding: false,
                isTrainingMandatory: false
            }
        ]);
    };

    const handleUserChange = (id, field, value) => {
        setUsers(users.map(user => {
            if (user.id === id) {
                const updatedUser = { ...user, [field]: value };

                // Validate email in real-time when email field changes
                if (field === 'email') {
                    const validation = validateEmail(value);
                    setEmailErrors(prev => ({
                        ...prev,
                        [id]: validation.isValid ? '' : validation.message
                    }));
                }

                // Clear reportsTo field when switching roles if relationships change
                if (field === 'role') {
                    // Check if new role requires a specific manager type
                    const allowedRoles = getAllowedManagerRoles(value);
                    const shouldShow = shouldShowReportsTo(value);

                    if (!shouldShow) {
                        // If field shouldn't show, clear it
                        updatedUser.reportsTo = '';
                    } else {
                        // Check if current reportsTo is still valid for new role
                        const currentManager = managerOptions.find(m => m.id === user.reportsTo);
                        if (currentManager && !allowedRoles.includes(currentManager.role)) {
                            updatedUser.reportsTo = '';
                        }
                        // Note: If newly showing, reportsTo keeps its old value (likely '') or stays if valid
                    }
                }

                return updatedUser;
            }
            return user;
        }));
    };

    // Reset form to initial state
    const resetForm = () => {
        setUsers([
            {
                id: 1,
                fullName: '',
                email: '',
                role: 'employee',
                reportsTo: '',
                enableOnboarding: false,
                isTrainingMandatory: false
            }
        ]);
        setEmailErrors({});
    };

    // Wrapper for onClose to reset state
    const handleClose = () => {
        resetForm();
        onClose();
    };

    const [isSubmitting, setIsSubmitting] = useState(false);

    const [mandatoryTrainingsCount, setMandatoryTrainingsCount] = useState(0);

    // Resolve siteId from auth profile, or fetch from Firestore for site managers
    // whose profile does not carry the siteId field.
    useEffect(() => {
        const resolveSiteId = async () => {
            // 1. Try the value already in the auth profile
            const sitePath = authed?.siteId || '';
            const fromProfile = sitePath.includes('/') ? sitePath.split('/')[1] : sitePath;
            if (fromProfile) {
                setResolvedSiteId(fromProfile);
                return;
            }

            // 2. Fallback: query sites collection for a site this user manages
            try {
                const uid = authed?.userId || authed?.uid;
                if (!uid) return;
                const sitesRef = collection(db, 'sites');
                const q = query(sitesRef, where('managerUserId', '==', uid), limit(1));
                const snap = await getDocs(q);
                if (!snap.empty) {
                    const siteId = snap.docs[0].id;
                    console.log('[AddUserModal] Resolved siteId from sites collection:', siteId);
                    setResolvedSiteId(siteId);
                    return;
                }

                // 3. Also try matching by companyId + primaryRole as a last resort
                const companyPath = authed?.companyId || '';
                if (companyPath) {
                    const q2 = query(
                        sitesRef,
                        where('companyId', '==', companyPath),
                        limit(1)
                    );
                    const snap2 = await getDocs(q2);
                    if (!snap2.empty) {
                        const siteId = snap2.docs[0].id;
                        console.log('[AddUserModal] Resolved siteId from company sites:', siteId);
                        setResolvedSiteId(siteId);
                    }
                }
            } catch (e) {
                console.error('[AddUserModal] Failed to resolve siteId from Firestore:', e);
            }
        };
        resolveSiteId();
    }, [authed?.siteId, authed?.userId, authed?.uid, authed?.companyId]);

    // Fetch mandatory trainings count
    useEffect(() => {
        const checkMandatoryTrainings = async () => {
            if (!authed?.companyId) return;
            try {
                const companyPath = authed.companyId;
                const companyId = companyPath.includes('/') ? companyPath.split('/')[1] : companyPath;

                const trainingsRef = collection(db, 'trainings');
                // Check for both legacy "category" and new "trainingType"
                // Ideally we'd use an OR query, but firestore limits unique field checks. 
                // We'll fetch active trainings for company and filter in JS for robustness (usually small number of trainings)
                // Or try simple queries.

                const q = query(
                    trainingsRef,
                    where('companyId', '==', companyId),
                    where('status', '==', 'active')
                );

                const snap = await getDocs(q);
                const count = snap.docs.filter(d => {
                    const data = d.data();
                    return data.category === 'Mandatory on Sign Up' || data.trainingType === 'Mandatory on Sign Up';
                }).length;

                setMandatoryTrainingsCount(count);

            } catch (e) {
                console.error('Failed to check mandatory trainings', e);
            }
        };
        checkMandatoryTrainings();
    }, [authed?.companyId]);

    // Load manager options
    useEffect(() => {
        const loadManagers = async () => {
            try {
                if (!authed?.companyId) return;
                const companyPath = authed.companyId;
                const companyId = companyPath.includes('/') ? companyPath.split('/')[1] : companyPath;
                const companyIdRaw = companyPath.replace('companies/', '');
                const roles = ['teamManager', 'adminManager', 'hrManager', 'seniorManager', 'siteManager', 'superUser'];
                const usersCol = collection(db, 'users');
                // fetch all potential managers for the company - handle both formats
                const q = query(usersCol, where('companyId', 'in', [companyIdRaw, `companies/${companyIdRaw}`]));
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
        loadManagers();
    }, [authed?.companyId]);

    const handleSubmit = async () => {
        if (isSubmitting) return;
        try {
            // Comprehensive validation
            for (const u of users) {
                if (!u.fullName?.trim()) {
                    toast.error('Full name is required for all users');
                    return;
                }

                // Validate email using the comprehensive validation function
                const emailValidation = validateEmail(u.email);
                if (!emailValidation.isValid) {
                    toast.error(emailValidation.message);
                    return;
                }

                // Validate reportsTo field only for non-manager roles
                if (shouldShowReportsTo(u.role) && !u.reportsTo?.trim()) {
                    toast.error('Reports To is required for non-manager roles');
                    return;
                }
            }
            setIsSubmitting(true);
            const companyPath = authed?.companyId || '';
            const companyId = companyPath.includes('/') ? companyPath.split('/')[1] : companyPath;

            // Use the resolved siteId (from profile or fetched from Firestore)
            const siteId = resolvedSiteId || '';

            // Validate required fields before sending invites
            if (!companyId) {
                toast.error('Company ID is missing. Please refresh the page and try again.');
                setIsSubmitting(false);
                return;
            }

            if (!siteId) {
                toast.error('Site ID could not be determined. Please contact your administrator to ensure your account is assigned to a site.');
                setIsSubmitting(false);
                return;
            }
            // New flow: send invites instead of creating users immediately
            for (const u of users) {
                const inviteData = {
                    email: u.email,
                    displayName: u.fullName,
                    primaryRole: u.role,
                    companyId,
                    siteId,
                    inviteBaseUrl: window.location.origin + '/invite'
                };

                // Only include reportsTo for non-manager roles and ensure it's not empty
                if (shouldShowReportsTo(u.role) && u.reportsTo?.trim()) {
                    inviteData.reportsTo = u.reportsTo.trim();
                }

                // Include onboarding mandatory settings - Unified Checkbox
                // When enabled, it triggers both User Self-Onboarding and HR Onboarding Profile creation
                inviteData.isOnboardingMandatory = u.enableOnboarding || false;
                inviteData.requiresHROnboarding = u.enableOnboarding || false;

                inviteData.isTrainingMandatory = u.isTrainingMandatory || false;

                await sendUserInvite(inviteData);
            }
            toast.success(`Invitation emails sent to ${users.length} user(s)`);
            resetForm();
            onClose();
        } catch (e) {
            const message = e?.message || 'Failed to submit users';
            toast.error(message);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]"
                onClick={handleClose}
            ></div>

            {/* Modal */}
            <div className="relative w-full max-h-[90vh] max-w-[520px] bg-white rounded-base shadow-[0_4px_20px_rgba(0,0,0,0.1)] p-4  overflow-y-auto modal-scroll ">
                <div className="flex flex-col gap-6 p-2">
                    {/* Header */}
                    <div className="flex justify-between items-start gap-5">
                        <div className="flex flex-col gap-1">
                            <h2 className="text-xl font-semibold text-text-primary">User Details</h2>
                            <p className="text-[13px] text-text-secondary">
                                Enter the details for {users.length} new user{users.length > 1 ? 's' : ''}.
                            </p>
                        </div>
                        <button
                            onClick={handleClose}
                            className="w-6 h-6 flex items-center justify-center bg-black/10 rounded-full hover:bg-black/20 transition-colors flex-shrink-0"
                        >
                            <X className="h-4 w-4 text-text-secondary" />
                        </button>
                    </div>

                    {/* Users List */}
                    {users.map((user, index) => (
                        <div
                            key={user.id}
                            className="flex flex-col gap-6 rounded-base"
                        >
                            <h3 className="text-xl font-semibold text-text-primary">User {index + 1}</h3>

                            {/* Full Name and Email Row */}
                            <div className="grid grid-cols-1 gap-4">
                                <div className="flex flex-col gap-2">
                                    <label className="text-md text-text-primary">
                                        Full name <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={user.fullName}
                                        onChange={(e) => handleUserChange(user.id, 'fullName', e.target.value)}
                                        placeholder="John Thomas"
                                        className="w-full h-12 px-4 border border-border-secondary rounded-lg text-sm text-text-secondary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
                                    />
                                </div>

                                <div className="flex flex-col gap-2">
                                    <label className="text-md text-text-primary">
                                        Email <span className="text-red-500">*</span>
                                    </label>
                                    <div className="relative w-full">
                                        <input
                                            type="email"
                                            value={user.email}
                                            onChange={(e) => handleUserChange(user.id, 'email', e.target.value)}
                                            placeholder="John@gmail.com"
                                            className={`w-full h-12 px-4 border rounded-lg text-sm text-text-secondary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple ${emailErrors[user.id]
                                                ? 'border-red-300 bg-red-50 focus:border-red-500'
                                                : 'border-border-secondary'
                                                }`}
                                        />
                                        {emailErrors[user.id] && (
                                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                                <AlertTriangle className="h-4 w-4 text-red-500" />
                                            </div>
                                        )}
                                    </div>
                                    {emailErrors[user.id] && (
                                        <p className="text-xs text-red-600 flex items-center gap-1 mt-1">
                                            <AlertTriangle className="h-3 w-3" />
                                            {emailErrors[user.id]}
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Role and Reports To Row */}
                            <div className={`grid gap-4 ${shouldShowReportsTo(user.role) ? 'grid-cols-2' : 'grid-cols-1'}`}>
                                <div className="flex flex-col gap-2">

                                    <div className="flex flex-col gap-2">
                                        <label className="text-md text-text-primary">
                                            Role <span className="text-red-500">*</span>
                                        </label>
                                        <div className="relative">
                                            <select
                                                value={user.role}
                                                onChange={(e) => handleUserChange(user.id, 'role', e.target.value)}
                                                className="w-full h-12 px-4 pr-10 border border-border-secondary rounded-lg text-sm text-text-secondary appearance-none focus:outline-none focus:border-border-accent-purple"
                                                aria-label="Select User Role"
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
                                            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
                                        </div>
                                    </div>
                                </div>

                                {/* Reports To */}
                                {shouldShowReportsTo(user.role) && (
                                    <div className="flex flex-col gap-2">
                                        <label className="text-md text-text-primary">
                                            {/* Reports To <span className="text-red-500">*</span> */}
                                            Line Manager <span className="text-red-500">*</span>
                                            <span className="text-xs text-text-secondary ml-1">
                                                ({getAllowedManagerRoles(user.role).map(role =>
                                                    role.replace('Manager', ' Manager').replace(/([A-Z])/g, ' $1').trim()
                                                ).join(' or ')})
                                            </span>
                                        </label>
                                        <div className="relative">
                                            <select
                                                value={user.reportsTo}
                                                onChange={(e) => handleUserChange(user.id, 'reportsTo', e.target.value)}
                                                className="w-full h-12 px-4 pr-10 border border-border-secondary rounded-lg text-sm text-text-secondary appearance-none focus:outline-none focus:border-border-accent-purple"
                                                aria-label="Select Line Manager"
                                            >
                                                <option value="">Select Manager</option>
                                                {getFilteredManagers(managerOptions, user.role).map(m => (
                                                    <option key={m.id} value={m.id}>{m.name} ({m.role})</option>
                                                ))}
                                            </select>
                                            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
                                        </div>
                                        {getFilteredManagers(managerOptions, user.role).length === 0 && (
                                            <p className="text-xs text-orange-600">
                                                No {getAllowedManagerRoles(user.role).join(' or ')} found for this role
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Unified Onboarding Checkbox */}
                            {/* <div className="flex flex-col gap-2">
                                <label className="flex items-center gap-3 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={user.enableOnboarding}
                                        onChange={(e) => handleUserChange(user.id, 'enableOnboarding', e.target.checked)}
                                        className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-2 focus:ring-purple-200"
                                    />
                                    <span className="text-sm text-gray-800 font-medium">
                                        Enable Onboarding
                                    </span>
                                </label>
                                <p className="text-xs text-gray-500 ml-7">
                                    When enabled, the user must complete self-onboarding AND an HR profile will be created for them.
                                </p>
                            </div> */}

                            {/* New Mandatory Training Checkbox - Only show if company has mandatory trainings */}
                            {mandatoryTrainingsCount > 0 && (
                                <div className="flex flex-col gap-2 mt-2">
                                    <label className="flex items-center gap-3 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={user.isTrainingMandatory}
                                            onChange={(e) => handleUserChange(user.id, 'isTrainingMandatory', e.target.checked)}
                                            className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-2 focus:ring-purple-200"
                                        />
                                        <span className="text-sm text-text-primary font-medium">
                                            Assign Mandatory Training ({mandatoryTrainingsCount} found)
                                        </span>
                                    </label>
                                    <p className="text-xs text-secondary ml-7">
                                        Users must complete {mandatoryTrainingsCount} mandatory training(s) before accessing the dashboard.
                                    </p>
                                </div>
                            )}
                        </div>
                    ))}

                    {/* Add More Button */}
                    <Button
                        onClick={handleAddMore}
                        variant='outline-primary'
                        cn='w-full h-12 flex justify-center items-center mt-2 mb-6'
                        icon={Plus}
                        iconFirst={true}
                        disabled={isSubmitting}
                    >

                        <span className="text-sm">Add More</span>
                    </Button>

                    {/* Action Buttons */}
                    <div className="grid grid-cols-3 gap-4">
                        <Button
                            onClick={handleClose}
                            variant='outline-secondary'
                            cn="flex-1 h-12"
                            disabled={isSubmitting}
                        >
                            Back
                        </Button>
                        <Button
                            variant='gradient'
                            cn={`col-span-2 h-12 flex justify-center ${(isSubmitting || !canSubmit) ? 'opacity-80 cursor-not-allowed' : ''}`}
                            icon={ArrowRight}
                            onClick={handleSubmit}
                            disabled={isSubmitting || !canSubmit}
                        >
                            {isSubmitting ? (
                                <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Submitting...</span>
                            ) : (
                                'Submit Request'
                            )}

                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};
export default AddUserModal;