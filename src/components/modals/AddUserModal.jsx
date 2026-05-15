import React, { useEffect, useState } from 'react';
import { X, Plus, ArrowRight, ChevronDown, Loader2, AlertTriangle } from 'lucide-react';
import Button from '../ui/Button';
import { toast } from 'react-toastify';
import { addUsersBySiteManager, getUsersByCompany } from '../../services/users';
import { getWorkLocations } from '../../services/workLocations';
import { getTrainingCourses } from '../../services/trainingService';
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

const AddUserModal = ({ isOpen, onClose, onSubmit }) => {
    const { user: authed } = useAuth();
    const [users, setUsers] = useState([
        {
            id: 1,
            firstName: '',
            lastName: '',
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
        return managerRoles.includes(getCanonicalRole(role));
    };

    // Updated: Reports To visibility depends on role
    const shouldShowReportsTo = (role) => {
        const canonicalRole = getCanonicalRole(role);
        if (['siteManager', 'superUser', 'owner'].includes(canonicalRole)) return false;

        // Everyone else (including all other manager types) reports to someone
        return true;
    };

    // Check if form can be submitted (no validation errors and all required fields filled)
    const canSubmit = users.every(user => {
        // Check required fields
        if (!user.firstName?.trim() || !user.lastName?.trim() || !user.email?.trim()) {
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
        const normalizedRole = getCanonicalRole(userRole);
        // If user is a mid-level manager, they report to Senior Manager (or fallback to Site Manager)
        if (['teamManager', 'adminManager', 'hrManager', 'seniorManager'].includes(normalizedRole)) {
            return ['seniorManager', 'siteManager', 'superUser'];
        }

        const roleMapping = {
            'employee': ['teamManager', 'siteManager', 'seniorManager'],
            'hrAdvisor': ['hrManager', 'siteManager', 'seniorManager'],
            'adminAdvisor': ['adminManager', 'siteManager', 'seniorManager'],
            'contractManager': ['teamManager', 'siteManager', 'seniorManager']
        };

        return roleMapping[normalizedRole] || ['siteManager', 'superUser', 'seniorManager', 'owner', 'siteManager'];
    };

    // Filter managers based on user role
    const getFilteredManagers = (allManagers, userRole) => {
        const allowedRoles = getAllowedManagerRoles(userRole);
        const normalizedAllowed = allowedRoles.map(getCanonicalRole);

        if (allowedRoles.length > 0) {
            return allManagers.filter(manager => {
                const mRole = getCanonicalRole(manager.role);
                return normalizedAllowed.includes(mRole);
            });
        }
        return allManagers;
    };

    const handleAddMore = () => {
        setUsers([
            ...users,
            {
                id: users.length + 1,
                firstName: '',
                lastName: '',
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
                    if (validation.isValid) {
                        setEmailErrors(prev => ({ ...prev, [id]: '' }));
                        // Debounced check for existing user (optional, but let's do it on blur or just on submit to save reads)
                    } else {
                        setEmailErrors(prev => ({ ...prev, [id]: validation.message }));
                    }
                }

                // Clear reportsTo field when switching roles if relationships change
                if (field === 'role') {
                    const normalizedValue = getCanonicalRole(value);
                    const allowedRoles = getAllowedManagerRoles(normalizedValue);
                    const shouldShow = shouldShowReportsTo(normalizedValue);

                    if (!shouldShow) {
                        updatedUser.reportsTo = '';
                    } else {
                        const currentManager = managerOptions.find(m => m.id === user.reportsTo);
                        if (currentManager && !allowedRoles.includes(getCanonicalRole(currentManager.role))) {
                            updatedUser.reportsTo = '';
                        }
                    }
                    updatedUser.role = normalizedValue;
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
            const uid = authed?.userId || authed?.uid;
            const sites = await getWorkLocations();
            if (sites && sites.length > 0) {
                // Find a site where I am the manager, or just use the first one available
                const myUid = authed?.userId || authed?.uid;
                const managed = sites.find(s => s.managerUserId === myUid);
                const siteId = managed ? managed.id : sites[0].id;
                console.log('[AddUserModal] Resolved siteId from workLocations service:', siteId);
                setResolvedSiteId(siteId);
            }

            // 3. Also try matching by companyId + primaryRole as a last resort
            const companyPath = authed?.companyId || '';
            if (companyPath) {
                try {
                    const companyIdRaw = companyPath.replace('companies/', '');
                    const q2 = query(
                        sitesRef,
                        where('companyId', 'in', [companyIdRaw, `companies/${companyIdRaw}`]),
                        limit(1)
                    );
                    const snap2 = await getDocs(q2);
                    if (!snap2.empty) {
                        const siteId = snap2.docs[0].id;
                        console.log('[AddUserModal] Resolved siteId from company sites:', siteId);
                        setResolvedSiteId(siteId);
                    }
                } catch (e) {
                    console.error('[AddUserModal] Failed to resolve siteId by companyId:', e);
                }
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

                const courses = await getTrainingCourses();
                const count = courses.filter(d => 
                    d.status === 'active' && 
                    (d.category === 'Mandatory on Sign Up' || d.trainingType === 'Mandatory on Sign Up')
                ).length;

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
                const companyId = authed.companyId.replace('companies/', '');
                const roles = ['teamManager', 'adminManager', 'hrManager', 'seniorManager', 'siteManager', 'superUser', 'owner', 'site_manager'];
                
                const employees = await getUsersByCompany(companyId);
                const opts = employees
                    .filter(u => roles.includes(getCanonicalRole(u.primaryRole || u.role)))
                    .map(u => ({
                        id: u.id,
                        name: u.displayName || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email,
                        role: getCanonicalRole(u.primaryRole || u.role),
                        siteId: u.siteId
                    }));

                // Ensure the current user is in the options if they have a manager role
                const currentUserId = authed?.userId || authed?.uid;
                if (currentUserId && !opts.find(o => o.id === currentUserId)) {
                    const myRole = getCanonicalRole(authed?.primaryRole || authed?.role);
                    if (roles.includes(myRole)) {
                        opts.push({
                            id: currentUserId,
                            name: authed?.displayName || authed?.email || 'Me',
                            role: myRole,
                            siteId: authed?.siteId
                        });
                    }
                }

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
                if (!u.firstName?.trim() || !u.lastName?.trim()) {
                    toast.error('First and last name are required for all users');
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
            let baseSiteId = resolvedSiteId || '';

            // Validate required fields before sending invites
            if (!companyId) {
                toast.error('Company ID is missing. Please refresh the page and try again.');
                setIsSubmitting(false);
                return;
            }

            // 1. Check for duplicates within the form itself
            const emailsInForm = users.map(u => u.email.toLowerCase().trim());
            const duplicateInForm = emailsInForm.find((email, index) => emailsInForm.indexOf(email) !== index);
            if (duplicateInForm) {
                toast.error(`The email ${duplicateInForm} is entered multiple times in the form.`);
                setIsSubmitting(false);
                return;
            }

            // Duplicates will be handled by the backend during bulk creation (status 409).
            // This client-side check is removed for Zero-Firebase compliance and to avoid extra network calls.

            // If we passed all checks, proceed with submission
            // We will check siteId per user if baseSiteId is missing

            // New flow: send invites instead of creating users immediately
            for (const u of users) {
                let userSiteId = baseSiteId;

                // Fallback to manager's siteId if not resolved
                if (!userSiteId && u.reportsTo) {
                    const manager = managerOptions.find(m => m.id === u.reportsTo);
                    if (manager && manager.siteId) {
                        userSiteId = manager.siteId.includes('/') ? manager.siteId.split('/')[1] : manager.siteId;
                    }
                }

                // Ultimate fallback so the user can be invited even if no site is found
                if (!userSiteId) {
                    userSiteId = 'unassigned';
                }

                const firstName = (u.firstName || '').trim();
                const lastName = (u.lastName || '').trim();
                const payload = {
                    email: u.email.toLowerCase().trim(),
                    firstName,
                    lastName,
                    hrRole: u.role,
                    reportsTo: shouldShowReportsTo(u.role) && u.reportsTo?.trim() ? u.reportsTo.trim() : null,
                    skipInviteEmail: false
                };

                // 1. Perfect Sync: Add user to Central Platform Postgres
                // This ensures the user is created in Central and triggers the Central reset-password email flow.
                try {
                    const centralApiUrl = import.meta.env.VITE_CENTRAL_API_URL || 'http://localhost:5000';
                    const centralToken = localStorage.getItem('mprar_central_token');

                    if (!centralToken) {
                        throw new Error('Central authentication token not found. Cannot create user through Central platform.');
                    }

                    const response = await fetch(`${centralApiUrl}/companies/${companyId}/users`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${centralToken}`
                        },
                        body: JSON.stringify(payload)
                    });

                    if (!response.ok) {
                        const errData = await response.json().catch(() => ({}));
                        if (response.status !== 409) {
                            throw new Error(errData.error || `Central sync failed with status ${response.status}`);
                        }
                    } else {
                        console.log(`[AddUserModal] Successfully synced ${u.email} to Central Platform`);
                    }
                } catch (syncErr) {
                    console.error('[AddUserModal] Central sync failed:', syncErr);
                    throw new Error(`Unable to create ${u.email} through Central platform. ${syncErr.message}`);
                }
            }
            toast.success(`Users created successfully. Central platform will send password reset and welcome emails.`);
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
                            <div className="grid grid-cols-2 gap-4">
                                <div className="flex flex-col gap-2">
                                    <label className="text-md text-text-primary">
                                        First name <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={user.firstName}
                                        onChange={(e) => handleUserChange(user.id, 'firstName', e.target.value)}
                                        placeholder="e.g. John"
                                        className="w-full h-12 px-4 border border-border-secondary rounded-lg text-sm text-text-secondary placeholder:text-text-secondary focus:outline-none focus:border-purple-500"
                                    />
                                </div>
                                <div className="flex flex-col gap-2">
                                    <label className="text-md text-text-primary">
                                        Last name <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={user.lastName}
                                        onChange={(e) => handleUserChange(user.id, 'lastName', e.target.value)}
                                        placeholder="e.g. Thomas"
                                        className="w-full h-12 px-4 border border-border-secondary rounded-lg text-sm text-text-secondary placeholder:text-text-secondary focus:outline-none focus:border-purple-500"
                                    />
                                </div>
                            </div>

                            <div className="flex flex-col gap-2">
                                <label className="text-md text-text-primary">
                                    Email Address <span className="text-red-500">*</span>
                                </label>
                                <div className="relative w-full">
                                    <input
                                        type="email"
                                        value={user.email}
                                        onChange={(e) => handleUserChange(user.id, 'email', e.target.value)}
                                        placeholder="user@company.com"
                                        className={`w-full h-12 px-4 border rounded-lg text-sm text-text-secondary placeholder:text-text-secondary focus:outline-none focus:border-purple-500 ${emailErrors[user.id]
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