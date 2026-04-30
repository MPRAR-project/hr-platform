import { collection, query, where, getDocs, doc, getDoc } from "firebase/firestore";
import { ArrowLeft, UserPlus } from "lucide-react";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { toast } from 'react-toastify';
import Header from "../../components/layout/Header";
import AssignEmployeeModal from "../../components/modals/AssignEmployeeModal";
import Button from "../../components/ui/Button";
import Tabs from "../../components/ui/Tabs";
import { db } from "../../firebase/client";
import { useAuth } from "../../hooks/useAuth";
import { absenceService } from "../../services/absenceService";
import { allowanceService } from "../../services/allowanceService";
import { automaticAllowanceService } from "../../services/automaticAllowanceService";
import { getUserEmploymentDetails } from "../../services/users";
import { getClient } from "../../services/clients";
import { getCompanyPlugins } from "../../services/companyManagementService";
import { transformEmploymentDataForDisplay } from "../../utils/employmentUtils";
import AbsencesHistoryTab from "./components/AbsenceHistoryTab";
import AllowancesTab from "./components/AllowanceTab";
import ContractDocumentsTab from "./components/ContractDocumentTab";
import EmployeeHeader from "./components/EmployeeHeader";
import EmploymentDetailsTab from "./components/EmploymentDetailsTab";
import PersonalInformationTab from "./components/PersonalDetailsTab";
import TimesheetHistoryTab from "./components/TimesheetHistoryTab";

const normalizeUid = (selectedUserId) => {
    if (!selectedUserId || typeof selectedUserId !== 'string') return null;
    return selectedUserId.includes('/') ? selectedUserId.split('/')[1] : selectedUserId;
};

// Main Employee Details Page
const UserDetailsPage = () => {
    const { user } = useAuth();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const selectedUserId = location.state?.userId || location.state?.id || searchParams.get('userId') || user?.uid || null;
    const [activeTab, setActiveTab] = useState((user?.role || '') == "contractManager" ? 'Timesheet History' : 'Personal Information');
    const [assignModalOpen, setAssignModalOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [loadError, setLoadError] = useState(null);
    const [employee, setEmployee] = useState({
        name: '',
        avatar: null, // Changed to null for default User icon
        profileImage: null, // Add profile photo URL
        department: '',
        hireDate: '',
        employeeId: '',
        manager: '',
        role: ''
    });
    const [personalData, setPersonalData] = useState({ basic: {}, identification: {} });
    const [employmentData, setEmploymentData] = useState({ position: {}, terms: {}, compensation: {}, bank: {}, notes: '' });
    const [employmentLoading, setEmploymentLoading] = useState(false);
    const [employmentError, setEmploymentError] = useState(null);
    const [rawEmploymentDetails, setRawEmploymentDetails] = useState(null);
    const [contractDocuments, setContractDocuments] = useState([]);
    const [allowancesData, setAllowancesData] = useState([]);
    const [absencesData, setAbsencesData] = useState([]);
    const [hasAbsencePlugin, setHasAbsencePlugin] = useState(true);
    const [allowancesLoading, setAllowancesLoading] = useState(false);
    const [absencesLoading, setAbsencesLoading] = useState(false);
    const [contractDocsLoading, setContractDocsLoading] = useState(false);
    const [onboardingLoading, setOnboardingLoading] = useState(false);

    const loadedTabsRef = useRef({
        allowances: false,
        absences: false,
        contractDocs: false,
        onboarding: false,
        employment: false,
    });
    const allowancesYearRef = useRef(null);
    const loadTokenRef = useRef(0);
    const onboardingRef = useRef(null);
    const userSnapshotRef = useRef(null); // { uid, userData, isProfileOnly }

    // Define roles that can edit employee photos
    const PHOTO_EDIT_ROLES = [
        'siteManager',
        'seniorManager',
        'hrManager',
        'adminManager',
        'hrAdvisor',
        'adminAdvisor'
    ];

    // Check if current user can edit this employee's photo
    // Photo editing is currently disabled or specifically restricted
    const canEditPhoto = false;

    // Handle photo update
    const handlePhotoUpdate = (newPrifileImage) => {
        setEmployee(prev => ({
            ...prev,
            profileImage: newPrifileImage
        }));
    };

    // Function to refresh absences data
    const refreshAbsences = useCallback(async () => {
        if (!selectedUserId) return;

        try {
            const uid = normalizeUid(selectedUserId);

            if (!uid) return;

            const userAbsences = await absenceService.getEmployeeAbsencesById(uid, user);
            console.log('Refreshed absences for user:', uid, userAbsences);

            const transformedAbsences = userAbsences.map(absence => ({
                ...absence,
                leave: allowanceService.getLeaveTypeDisplayName(absence.leaveType),
                reason: absence.reason || 'No reason provided',
                date: absence.startDate && absence.endDate
                    ? `${absence.startDate} - ${absence.endDate}`
                    : absence.startDate || absence.submittedDate?.toDate?.()?.toISOString?.()?.split('T')[0] || 'Unknown',
                status: absence.status || 'Pending'
            }));

            setAbsencesData(transformedAbsences);
        } catch (error) {
            console.error('Failed to refresh absences', error);
        }
    }, [selectedUserId, user]);

    useEffect(() => {
        const loadCore = async () => {
            const loadToken = ++loadTokenRef.current;
            let didTimeout = false;
            const timeoutId = setTimeout(() => {
                didTimeout = true;
                setIsLoading(false);
            }, 3000);
            try {
                setIsLoading(true);
                setLoadError(null);
                console.log('UserDetailsPage - loading details for selectedUserId:', selectedUserId);

                // Normalize selected user id to bare uid
                const uid = normalizeUid(selectedUserId);
                console.log('UserDetailsPage - loading details for uid:', uid, 'from selectedUserId:', selectedUserId);

                if (!uid) {
                    setLoadError('No user selected');
                    setIsLoading(false);
                    clearTimeout(timeoutId);
                    return;
                }

                // Reset tab-loaded flags & data for new user
                loadedTabsRef.current = {
                    allowances: false,
                    absences: false,
                    contractDocs: false,
                    onboarding: false,
                    employment: false,
                };
                onboardingRef.current = null;
                userSnapshotRef.current = null;
                setAllowancesData([]);
                setAbsencesData([]);
                setContractDocuments([]);
                setEmploymentData({ position: {}, terms: {}, compensation: {}, bank: {}, notes: '' });
                setEmploymentError(null);
                setRawEmploymentDetails(null);
                setEmploymentLoading(false);
                setAllowancesLoading(false);
                setAbsencesLoading(false);
                setContractDocsLoading(false);
                setOnboardingLoading(false);
                allowancesYearRef.current = null;

                // ✅ DUAL-READ STRATEGY: Try users collection first, then fall back to profile
                const uref = doc(db, 'users', uid);
                const usnap = await getDoc(uref);

                let u = null;
                let isProfileOnly = false;

                if (usnap.exists()) {
                    // User exists in users collection
                    u = usnap.data();
                } else {
                    // ✅ FALLBACK: Try to find user in userCompanyProfiles
                    console.warn(`No user document found for ${uid}, checking userCompanyProfiles...`);

                    try {
                        const pref = doc(db, 'userCompanyProfiles', uid);

                        const profileSnap = await getDoc(pref);

                        if (profileSnap.exists()) {
                            const profileData = profileSnap.data();
                            console.log('Found user in userCompanyProfiles:', profileData);

                            // Construct a user object from profile data
                            u = {
                                uid: uid,
                                email: profileData.email || '',
                                displayName: profileData.displayName || '',
                                firstName: profileData.firstName || '',
                                lastName: profileData.lastName || '',
                                profileImage: profileData.profileImage || null,
                                primaryRole: profileData.primaryRole || 'employee',
                                companyId: profileData.companyId || '',
                                siteId: profileData.siteId || '',
                                managerUserId: profileData.reportsTo || profileData.managerUserId || '',
                                jobTitle: profileData.jobTitle || '',
                                department: profileData.department || '',
                            };
                            isProfileOnly = true;
                        } else {
                            setLoadError('User not found in users or profiles');
                            setIsLoading(false);
                            return;
                        }
                    } catch (profileError) {
                        console.error('Error fetching from userCompanyProfiles:', profileError);
                        setLoadError('User not found');
                        setIsLoading(false);
                        return;
                    }
                }

                if (!u) {
                    setLoadError('User not found');
                    setIsLoading(false);
                    clearTimeout(timeoutId);
                    return;
                }

                // Abort if another load started (fast navigation)
                if (loadToken !== loadTokenRef.current) {
                    clearTimeout(timeoutId);
                    return;
                }

                // Add debug flag
                if (isProfileOnly) {
                    console.log('⚠️ User data loaded from profile only - some features may be limited');
                }

                userSnapshotRef.current = { uid, userData: u, isProfileOnly };

                // ---- 🔹 FETCH MANAGER DETAILS ----
                let managerName = '';
                try {
                    if (u.managerUserId) {
                        const mref = doc(db, 'users', u.managerUserId);
                        const msnap = await getDoc(mref);
                        if (msnap.exists()) {
                            const m = msnap.data();
                            managerName = m.displayName || `${m.firstName || ''} ${m.lastName || ''}`.trim() || m.email || '';
                        }
                    }
                } catch (e) {
                    console.warn('Failed to fetch manager details:', e);
                }

                const display = u.displayName || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email;
                setEmployee({
                    name: display,
                    avatar: null,
                    profileImage: u.profileImage || null,
                    department: u.department || '',
                    hireDate: u.hireDate || '',
                    employeeId: u.employeeId || uid,
                    manager: managerName || u?.managerUserId,
                    role: u.primaryRole || '',
                    siteId: u.siteId || '',
                    companyId: u.companyId || '',
                    id: uid,
                    isProfileOnly: isProfileOnly
                });

                // Fast, non-blocking personal data: show users/profile fields immediately.
                setPersonalData({
                    basic: {
                        'Full Name': display || '',
                        'Email': u.email || '',
                        'Phone': u.phone || '',
                        'Date Of Birth': u.dateOfBirth || '',
                        'Gender': u.gender || '',
                        'Marital Status': u.maritalStatus || '',
                        'Nationality': u.nationality || '',
                        'Address': u.address?.raw || ''
                    },
                    identification: {
                        'National Insurance': u.nationalInsurance || '',
                        'Tax Code': u.taxCode || '',
                        'Passport Number': u.passportNumber || '',
                        'Issuing Country': u.issuingCountry || '',
                        'Passport Expiry Date': u.passportExpiry || '',
                        'Right To Work Status': u.rightToWork || '',
                        'Name': u.emergencyContactName || '',
                        'Relationship': u.emergencyRelationship || '',
                        'Phone': u.emergencyPhone || '',
                        'Email': u.emergencyEmail || '',
                        'Address': u.emergencyAddress || ''
                    }
                });

                // Stop blocking the UI here. Everything else loads on-demand per-tab.
                if (!didTimeout) setIsLoading(false);
                clearTimeout(timeoutId);

                // Background: absence plugin gating (doesn't block initial render)
                if (u.companyId) {
                    getCompanyPlugins(u.companyId)
                        .then((plugins) => {
                            if (loadToken !== loadTokenRef.current) return;
                            setHasAbsencePlugin(plugins.absence !== false);
                        })
                        .catch((e) => console.warn('Failed to fetch company plugins:', e));
                }
            } catch (e) {
                console.error('Failed to load user details', e);
                setLoadError('Failed to load user details');
                setIsLoading(false);
                clearTimeout(timeoutId);
            }
        };

        loadCore();
    }, [selectedUserId]);

    const ensureOnboardingLoaded = useCallback(async () => {
        const snap = userSnapshotRef.current;
        if (!snap?.uid) return null;
        if (loadedTabsRef.current.onboarding && onboardingRef.current) return onboardingRef.current;
        if (snap.isProfileOnly) return null;

        setOnboardingLoading(true);
        try {
            const { uid, userData } = snap;
            const appCol = collection(db, 'onboardingApplications');
            const queries = [
                query(appCol, where('userId', '==', uid)),
                query(appCol, where('userId', '==', `users/${uid}`)),
                ...(userData?.email ? [query(appCol, where('formData.personalInfo.email', '==', userData.email))] : []),
            ];
            const results = await Promise.allSettled(queries.map(q => getDocs(q)));
            const allDocs = [];
            for (const r of results) {
                if (r.status === 'fulfilled' && !r.value.empty) {
                    r.value.docs.forEach(d => allDocs.push({ id: d.id, ...d.data() }));
                }
            }
            if (allDocs.length > 0) {
                allDocs.sort((a, b) => {
                    const at = (a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0);
                    const bt = (b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0);
                    return bt - at;
                });
                onboardingRef.current = allDocs[0] || null;
            } else {
                onboardingRef.current = null;
            }

            loadedTabsRef.current.onboarding = true;
            return onboardingRef.current;
        } catch (e) {
            console.error('Failed to load onboarding applications', e);
            onboardingRef.current = null;
            loadedTabsRef.current.onboarding = true;
            return null;
        } finally {
            setOnboardingLoading(false);
        }
    }, []);

    const ensurePersonalEnriched = useCallback(async () => {
        const snap = userSnapshotRef.current;
        if (!snap?.uid) return;
        const onboarding = await ensureOnboardingLoaded();
        if (!onboarding) return;

        const u = snap.userData || {};
        const display = u.displayName || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || '';
        const pi = onboarding?.formData?.personalInfo || {};
        const idf = onboarding?.formData?.identification || {};

        setPersonalData(prev => ({
            basic: {
                ...prev.basic,
                'Full Name': prev.basic?.['Full Name'] || display || `${pi.firstName || ''} ${pi.lastName || ''}`.trim(),
                'Email': prev.basic?.['Email'] || u.email || pi.email || '',
                'Phone': prev.basic?.['Phone'] || u.phone || pi.phone || '',
                'Date Of Birth': prev.basic?.['Date Of Birth'] || u.dateOfBirth || pi.dateOfBirth || '',
                'Gender': prev.basic?.['Gender'] || u.gender || pi.gender || '',
                'Marital Status': prev.basic?.['Marital Status'] || u.maritalStatus || pi.maritalStatus || '',
                'Nationality': prev.basic?.['Nationality'] || u.nationality || pi.nationality || '',
                'Address': prev.basic?.['Address'] || u.address?.raw || [pi.addressLine1, pi.addressLine2, pi.city, pi.country].filter(Boolean).join(', ')
            },
            identification: {
                ...prev.identification,
                'National Insurance': prev.identification?.['National Insurance'] || u.nationalInsurance || idf.nationalInsurance || '',
                'Tax Code': prev.identification?.['Tax Code'] || u.taxCode || '',
                'Passport Number': prev.identification?.['Passport Number'] || u.passportNumber || idf.passportNumber || '',
                'Issuing Country': prev.identification?.['Issuing Country'] || u.issuingCountry || idf.issuingCountry || '',
                'Passport Expiry Date': prev.identification?.['Passport Expiry Date'] || u.passportExpiry || idf.passportExpiry || '',
                'Right To Work Status': prev.identification?.['Right To Work Status'] || u.rightToWork || idf.rightToWork || '',
                'Name': prev.identification?.['Name'] || u.emergencyContactName || idf.emergencyContactName || '',
                'Relationship': prev.identification?.['Relationship'] || u.emergencyRelationship || idf.emergencyRelationship || '',
                'Phone': prev.identification?.['Phone'] || u.emergencyPhone || idf.emergencyPhone || '',
                'Email': prev.identification?.['Email'] || u.emergencyEmail || idf.emergencyEmail || '',
                'Address': prev.identification?.['Address'] || u.emergencyAddress || idf.emergencyAddress || ''
            }
        }));
    }, [ensureOnboardingLoaded]);

    const ensureEmploymentLoaded = useCallback(async () => {
        const snap = userSnapshotRef.current;
        if (!snap?.uid) return;
        if (loadedTabsRef.current.employment) return;

        setEmploymentLoading(true);
        setEmploymentError(null);
        try {
            const uid = snap.uid;
            const u = snap.userData || {};
            let managerName = employee?.manager || '';

            let employmentDetails = null;
            try {
                employmentDetails = await getUserEmploymentDetails(uid);
            } catch (e) {
                console.warn('Failed to load employment details from users collection:', e);
            }

            const onboarding = await ensureOnboardingLoaded();
            if (!employmentDetails && onboarding) {
                const empDetails = onboarding?.employmentDetails || {};
                const hr = onboarding?.formData?.hrInfo || {};
                const bank = onboarding?.formData?.banking || {};
                employmentDetails = {
                    jobTitle: empDetails.jobTitle || hr.position || '',
                    department: empDetails.department || hr.department || '',
                    employmentType: empDetails.employmentType || hr.employmentType || '',
                    primaryWorkLocation: empDetails.primaryWorkLocation || hr.primaryWorkLocation || '',
                    officeAddress: empDetails.officeAddress || '',
                    workPattern: empDetails.workPattern || '',
                    startDate: empDetails.startDate || hr.startDate || '',
                    probationPeriod: empDetails.probationPeriod || '',
                    probationEndDate: empDetails.probationEndDate || hr.probationEndDate || '',
                    workingHours: hr.workingHours || '',
                    noticePeriod: hr.noticePeriod || '',
                    annualSalary: hr.annualSalary || '',
                    payFrequency: hr.payFrequency || '',
                    benefits: hr.benefits || '',
                    bankAccountName: bank.accountHolderName || '',
                    bankAccountNumber: bank.accountNumber || '',
                    bankName: bank.bankName || '',
                    sortCode: bank.sortCode || '',
                    branchName: bank.branchName || '',
                    iban: bank.iban || '',
                    adminNotes: hr.notes || ''
                };
            }

            if (onboarding && employmentDetails) {
                const bank = onboarding?.formData?.banking || {};
                employmentDetails.bankAccountName = bank.accountHolderName || employmentDetails.bankAccountName || '';
                employmentDetails.bankAccountNumber = bank.accountNumber || employmentDetails.bankAccountNumber || '';
                employmentDetails.bankName = bank.bankName || employmentDetails.bankName || '';
                employmentDetails.sortCode = bank.sortCode || employmentDetails.sortCode || '';
                employmentDetails.branchName = bank.branchName || employmentDetails.branchName || '';
                employmentDetails.iban = bank.iban || employmentDetails.iban || '';
            }

            setRawEmploymentDetails({
                ...(employmentDetails || {}),
                clientId: u.clientId || employmentDetails?.clientId || ''
            });

            let resolvedClientName = null;
            const cid = u.clientId || employmentDetails?.clientId;
            if (cid) {
                try {
                    const cObj = await getClient(cid);
                    if (cObj) resolvedClientName = cObj.name;
                } catch (e) {
                    console.warn('Failed to resolve client name', e);
                }
            }

            const transformedEmploymentData = transformEmploymentDataForDisplay(employmentDetails, u, managerName, resolvedClientName);
            setEmploymentData(transformedEmploymentData);
            loadedTabsRef.current.employment = true;
        } catch (e) {
            console.error('Error loading employment details:', e);
            setEmploymentError('Failed to load employment details');
            setEmploymentData({ position: {}, terms: {}, compensation: {}, bank: {}, notes: '' });
            loadedTabsRef.current.employment = true;
        } finally {
            setEmploymentLoading(false);
        }
    }, [ensureOnboardingLoaded, employee?.manager]);

    const ensureContractDocsLoaded = useCallback(async () => {
        const snap = userSnapshotRef.current;
        if (!snap?.uid) return;
        if (loadedTabsRef.current.contractDocs) return;

        setContractDocsLoading(true);
        try {
            const onboarding = await ensureOnboardingLoaded();
            if (onboarding?.id) {
                const dq = query(collection(db, 'documents'), where('onboardingApplicationId', '==', onboarding.id));
                const ds = await getDocs(dq);
                const drows = ds.docs.map(d => {
                    const x = d.data();
                    return {
                        name: x.fileName || (x.documentType || 'Document').replace(/_/g, ' ').replace(/\b\w/g, s => s.toUpperCase()),
                        uploaded: x.uploadedAt?.toDate ? x.uploadedAt.toDate().toISOString().slice(0, 10) : '',
                        size: x.fileSize ? `${(x.fileSize / 1024 / 1024).toFixed(2)} MB` : '',
                        status: (x.status || 'active').replace(/_/g, ' ').replace(/\b\w/g, s => s.toUpperCase()),
                        downloadURL: x.downloadURL
                    };
                });
                setContractDocuments(drows);
            } else {
                setContractDocuments([]);
            }
            loadedTabsRef.current.contractDocs = true;
        } catch (e) {
            console.warn('Failed to load onboarding documents', e);
            setContractDocuments([]);
            loadedTabsRef.current.contractDocs = true;
        } finally {
            setContractDocsLoading(false);
        }
    }, [ensureOnboardingLoaded]);

    const ensureAllowancesLoaded = useCallback(async (year = new Date().getFullYear(), force = false) => {
        const snap = userSnapshotRef.current;
        if (!snap?.uid) return;
        if (!force && loadedTabsRef.current.allowances && allowancesData.length > 0 && allowancesYearRef.current === year) return;

        setAllowancesLoading(true);
        try {
            const uid = snap.uid;
            const u = snap.userData || {};

            if (user?.companyId) {
                try {
                    await automaticAllowanceService.ensureEmployeeAllowances(uid, u);
                } catch (autoError) {
                    console.error('Error ensuring automatic allowances:', autoError);
                }
            }

            const userAllowances = await allowanceService.getEmployeeAllowances(uid, user, year);
            const processedAllowances = userAllowances.map(allowance => {
                const totalDays = Number(allowance.totalDays) || 0;
                const usedDays = Number(allowance.usedDays) || 0;
                const remainingDays = allowance.remainingDays !== undefined
                    ? Number(allowance.remainingDays)
                    : Math.max(0, totalDays - usedDays);

                return {
                    id: allowance.id,
                    leaveType: allowance.leaveType || 'Unknown',
                    totalDays: totalDays,
                    usedDays: usedDays,
                    remainingDays: remainingDays,
                    validFrom: allowance.validFrom || null,
                    validUntil: allowance.validUntil || null,
                    isActive: allowance.isActive !== false,
                    ...allowance
                };
            });
            setAllowancesData(processedAllowances);
            loadedTabsRef.current.allowances = true;
            allowancesYearRef.current = year;
        } catch (e) {
            console.error('Failed to load allowances', e);
            setAllowancesData([]);
            loadedTabsRef.current.allowances = true;
            allowancesYearRef.current = year;
        } finally {
            setAllowancesLoading(false);
        }
    }, [allowancesData.length, user]);

    const ensureAbsencesLoaded = useCallback(async () => {
        const snap = userSnapshotRef.current;
        if (!snap?.uid) return;
        if (loadedTabsRef.current.absences && absencesData.length > 0) return;

        setAbsencesLoading(true);
        try {
            const uid = snap.uid;
            const userAbsences = await absenceService.getEmployeeAbsencesById(uid, user);
            const transformedAbsences = userAbsences.map(absence => ({
                ...absence,
                leave: allowanceService.getLeaveTypeDisplayName(absence.leaveType),
                reason: absence.reason || 'No reason provided',
                date: absence.startDate && absence.endDate
                    ? `${absence.startDate} - ${absence.endDate}`
                    : absence.startDate || absence.submittedDate?.toDate?.()?.toISOString?.()?.split('T')[0] || 'Unknown',
                status: absence.status || 'Pending'
            }));
            setAbsencesData(transformedAbsences);
            loadedTabsRef.current.absences = true;
        } catch (e) {
            console.error('Failed to load absences', e);
            setAbsencesData([]);
            loadedTabsRef.current.absences = true;
        } finally {
            setAbsencesLoading(false);
        }
    }, [absencesData.length, user]);

    useEffect(() => {
        // Lazy-load heavy tab data only when needed (keeps initial load under ~3s).
        if (!employee?.id) return;

        if (activeTab === 'Personal Information') {
            ensurePersonalEnriched();
        }
        if (activeTab === 'Employment Details') {
            ensurePersonalEnriched();
            ensureEmploymentLoaded();
        }
        if (activeTab === 'Contract Documents') {
            ensureContractDocsLoaded();
        }
        if (activeTab === 'Allowances') {
            ensureAllowancesLoaded(allowancesYearRef.current || new Date().getFullYear());
        }
        if (activeTab === 'Absences History') {
            ensureAbsencesLoaded();
        }
    }, [
        activeTab,
        employee?.id,
        ensureAbsencesLoaded,
        ensureAllowancesLoaded,
        ensureContractDocsLoaded,
        ensureEmploymentLoaded,
        ensurePersonalEnriched
    ]);

    // Real-time subscription for allowances to ensure instant updates on save
    useEffect(() => {
        if (activeTab === 'Allowances' && employee?.id && user) {
            const year = allowancesYearRef.current || new Date().getFullYear();
            const unsubscribe = allowanceService.subscribeToEmployeeAllowances(
                employee.id,
                user,
                year,
                (updatedAllowances) => {
                    // Update state immediately from subscription
                    // Note: We merging with existing data to keep any extra properties if needed
                    setAllowancesData(prev => {
                        const merged = updatedAllowances.map(newAllowance => {
                            const existing = prev.find(p => p.id === newAllowance.id);
                            return {
                                ...(existing || {}),
                                ...newAllowance,
                                // Ensure derived fields are recalculated if base fields changed
                                remainingDays: (newAllowance.totalDays || 0) - (newAllowance.usedDays || 0)
                            };
                        });
                        return merged;
                    });
                }
            );
            return () => unsubscribe();
        }
    }, [activeTab, employee?.id, user]);

    const allTabOptions = [
        { label: 'Personal Information', allowedRoles: ['seniorManager','siteManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor', 'teamManager'] },
        { label: 'Employment Details', allowedRoles: ['seniorManager', 'siteManager', 'hrManager', 'hrAdvisor'] },
        { label: 'Contract Documents', allowedRoles: ['seniorManager', 'siteManager', 'hrManager', 'hrAdvisor'] },
        { label: 'Allowances', allowedRoles: ['seniorManager', 'siteManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor', 'teamManager'] },
        { label: 'Timesheet History', allowedRoles: ['seniorManager', 'siteManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor', 'teamManager'] },
        { label: 'Absences History', allowedRoles: ['seniorManager', 'siteManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor', 'teamManager'] }
    ];

    const tabOptions = allTabOptions.filter(tab => {
        const isAllowed = tab.allowedRoles.includes('all') || tab.allowedRoles.includes(user?.role);
        if (!isAllowed) return false;
        
        // Hide absence related tabs if plugin is disabled
        if (!hasAbsencePlugin && (tab.label === 'Allowances' || tab.label === 'Absences History')) {
            return false;
        }

        return true;
    });

    const handleBack = () => {
        window.history.back();
    };

    const handleOpenAssign = () => {
        setAssignModalOpen(true);
    };
    const handleSaveAssign = (data) => {
        console.log('Assigned Data:', data);
        setAssignModalOpen(false);
    }

    const canAssignManager = (role) => {
        if (role == "contractManager") return false;
        return true;
    }
    const pretty = (role = '') =>
        role.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim();


    return (
        <>
            <div className="h-screen flex flex-col overflow-hidden">
                <Header
                    title={`${pretty(user?.role || 'employee')} Dashboard`}
                    subtitle="Grow your digital workplace and manage your team seamlessly"
                />

                <div className="flex-1 mt-2 overflow-y-auto sm:p-4 md:p-3xl scrollbar-custom">
                    {isLoading && (
                        <div className="p-4 text-text-secondary">Loading user details...</div>
                    )}
                    {loadError && (
                        <div className="p-4 text-red-500">{loadError}</div>
                    )}
                    <div className="flex px-2 items-center justify-between mb-6">
                        <button
                            onClick={handleBack}
                            className="flex items-center gap-2 text-text-primary hover:text-text-accent-purple transition-colors"
                        >
                            <ArrowLeft className="h-5 w-5" />
                            <span className="sm:text-xl text-lg font-bold">Employee Details</span>
                        </button>
                        {
                            canAssignManager(user?.role) &&
                            <Button variant="gradient" icon={UserPlus} onClick={() => {
                                handleOpenAssign();
                            }}>Assign</Button>
                        }
                    </div>

                    <div className="p-4">
                        <EmployeeHeader
                            employee={employee}
                            onPhotoUpdate={handlePhotoUpdate}
                            canEditPhoto={canEditPhoto}
                        />
                    </div>

                    <div className="mt-6 px-4">
                        <Tabs
                            tabs={tabOptions}
                            onTabChange={(selectedTab) => setActiveTab(selectedTab)}
                        />
                    </div>

                    <div className="mt-6 sm:px-4">
                        {activeTab === 'Personal Information' && (
                            <PersonalInformationTab
                                data={personalData}
                                userId={selectedUserId}
                                onUpdate={() => {
                                    // Reload personal data after update
                                    const load = async () => {
                                        try {
                                            const uid = normalizeUid(selectedUserId);
                                            if (!uid) return;

                                            const uref = doc(db, 'users', uid);
                                            const usnap = await getDoc(uref);
                                            if (!usnap.exists()) return;
                                            const u = usnap.data();

                                            // Update photo URL if changed
                                            setEmployee(prev => ({
                                                ...prev,
                                                profileImage: u.profileImage || null
                                            }));

                                            // Reload onboarding data
                                            let onboarding = null;
                                            try {
                                                const appCol = collection(db, 'onboardingApplications');
                                                const queries = [
                                                    query(appCol, where('userId', '==', uid)),
                                                    query(appCol, where('userId', '==', `users/${uid}`)),
                                                    ...(u.email ? [query(appCol, where('formData.personalInfo.email', '==', u.email))] : [])
                                                ];
                                                const results = await Promise.allSettled(queries.map(q => getDocs(q)));
                                                const allDocs = [];
                                                for (const r of results) {
                                                    if (r.status === 'fulfilled' && !r.value.empty) {
                                                        r.value.docs.forEach(d => allDocs.push({ id: d.id, ...d.data() }));
                                                    }
                                                }
                                                if (allDocs.length > 0) {
                                                    allDocs.sort((a, b) => {
                                                        const at = (a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0);
                                                        const bt = (b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0);
                                                        return bt - at;
                                                    });
                                                    onboarding = allDocs[0] || null;
                                                }
                                            } catch (e) {
                                                console.error('Failed to reload onboarding applications', e);
                                            }

                                            const pi = onboarding?.formData?.personalInfo || {};
                                            const idf = onboarding?.formData?.identification || {};
                                            const display = u.displayName || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email;

                                            setPersonalData({
                                                basic: {
                                                    'Full Name': display || `${pi.firstName || ''} ${pi.lastName || ''}`.trim(),
                                                    'Email': u.email || pi.email || '',
                                                    'Phone': u.phone || pi.phone || '',
                                                    'Date Of Birth': u.dateOfBirth || pi.dateOfBirth || '',
                                                    'Gender': u.gender || pi.gender || '',
                                                    'Marital Status': u.maritalStatus || pi.maritalStatus || '',
                                                    'Nationality': u.nationality || pi.nationality || '',
                                                    'Address': u.address?.raw || [pi.addressLine1, pi.addressLine2, pi.city, pi.country].filter(Boolean).join(', ')
                                                },
                                                identification: {
                                                    'National Insurance': u.nationalInsurance || idf.nationalInsurance || '',
                                                    'Tax Code': u.taxCode || '',
                                                    'Passport Number': u.passportNumber || idf.passportNumber || '',
                                                    'Issuing Country': u.issuingCountry || idf.issuingCountry || '',
                                                    'Passport Expiry Date': u.passportExpiry || idf.passportExpiry || '',
                                                    'Right To Work Status': u.rightToWork || idf.rightToWork || '',
                                                    'Name': u.emergencyContactName || idf.emergencyContactName || '',
                                                    'Relationship': u.emergencyRelationship || idf.emergencyRelationship || '',
                                                    'Phone': u.emergencyPhone || idf.emergencyPhone || '',
                                                    'Email': u.emergencyEmail || idf.emergencyEmail || '',
                                                    'Address': u.emergencyAddress || idf.emergencyAddress || ''
                                                }
                                            });

                                            // Also update employee display name if changed
                                            const newDisplay = u.displayName || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email;
                                            setEmployee(prev => ({
                                                ...prev,
                                                name: newDisplay
                                            }));
                                        } catch (error) {
                                            console.error('Error reloading personal data:', error);
                                            toast.error('Failed to reload personal information');
                                        }
                                    };
                                    load();
                                }}
                            />
                        )}
                        {activeTab === 'Employment Details' && (
                            <EmploymentDetailsTab
                                data={employmentData}
                                loading={employmentLoading}
                                error={employmentError}
                                userId={employee?.id}
                                currentEmploymentData={rawEmploymentDetails}
                                onUpdate={() => {
                                    // Reload employment data after update
                                    const load = async () => {
                                        try {
                                            setEmploymentLoading(true);
                                            setEmploymentError(null);
                                            const uid = normalizeUid(selectedUserId);
                                            if (uid) {
                                                // Get user details for manager info
                                                const uref = doc(db, 'users', uid);
                                                const usnap = await getDoc(uref);
                                                const userDetails = usnap.exists() ? usnap.data() : null;

                                                let employmentDetails = await getUserEmploymentDetails(uid);

                                                // Get onboarding data
                                                let onboarding = null;
                                                try {
                                                    const appCol = collection(db, 'onboardingApplications');
                                                    const queries = [
                                                        query(appCol, where('userId', '==', uid)),
                                                        query(appCol, where('userId', '==', `users/${uid}`)),
                                                        ...(userDetails?.email ? [query(appCol, where('formData.personalInfo.email', '==', userDetails.email))] : [])
                                                    ];
                                                    const results = await Promise.allSettled(queries.map(q => getDocs(q)));
                                                    const allDocs = [];
                                                    for (const r of results) {
                                                        if (r.status === 'fulfilled' && !r.value.empty) {
                                                            r.value.docs.forEach(d => allDocs.push({ id: d.id, ...d.data() }));
                                                        }
                                                    }
                                                    if (allDocs.length > 0) {
                                                        allDocs.sort((a, b) => {
                                                            const at = (a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0);
                                                            const bt = (b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0);
                                                            return bt - at;
                                                        });
                                                        onboarding = allDocs[0] || null;
                                                    }
                                                } catch (e) {
                                                    console.error('Failed to load onboarding applications:', e);
                                                }

                                                // If no employment details, create from onboarding
                                                if (!employmentDetails && onboarding) {
                                                    const empDetails = onboarding?.employmentDetails || {};
                                                    const hr = onboarding?.formData?.hrInfo || {};
                                                    const bank = onboarding?.formData?.banking || {};

                                                    employmentDetails = {
                                                        jobTitle: empDetails.jobTitle || hr.position || '',
                                                        department: empDetails.department || hr.department || '',
                                                        employmentType: empDetails.employmentType || hr.employmentType || '',
                                                        primaryWorkLocation: empDetails.primaryWorkLocation || hr.primaryWorkLocation || '',
                                                        officeAddress: empDetails.officeAddress || '',
                                                        workPattern: empDetails.workPattern || '',
                                                        startDate: empDetails.startDate || hr.startDate || '',
                                                        probationPeriod: empDetails.probationPeriod || '',
                                                        probationEndDate: empDetails.probationEndDate || hr.probationEndDate || '',
                                                        workingHours: hr.workingHours || '',
                                                        noticePeriod: hr.noticePeriod || '',
                                                        annualSalary: hr.annualSalary || '',
                                                        payFrequency: hr.payFrequency || '',
                                                        benefits: hr.benefits || '',
                                                        bankAccountName: bank.accountHolderName || '',
                                                        bankAccountNumber: bank.accountNumber || '',
                                                        bankName: bank.bankName || '',
                                                        sortCode: bank.sortCode || '',
                                                        branchName: bank.branchName || '',
                                                        iban: bank.iban || '',
                                                        adminNotes: hr.notes || ''
                                                    };
                                                }

                                                if (onboarding && employmentDetails) {
                                                    const bank = onboarding?.formData?.banking || {};
                                                    employmentDetails.bankAccountName = bank.accountHolderName || employmentDetails.bankAccountName || '';
                                                    employmentDetails.bankAccountNumber = bank.accountNumber || employmentDetails.bankAccountNumber || '';
                                                    employmentDetails.bankName = bank.bankName || employmentDetails.bankName || '';
                                                    employmentDetails.sortCode = bank.sortCode || employmentDetails.sortCode || '';
                                                    employmentDetails.branchName = bank.branchName || employmentDetails.branchName || '';
                                                    employmentDetails.iban = bank.iban || employmentDetails.iban || '';
                                                }

                                                setRawEmploymentDetails(employmentDetails);

                                                let managerName = '';
                                                try {
                                                    if (userDetails?.managerUserId) {
                                                        const mref = doc(db, 'users', userDetails.managerUserId);
                                                        const msnap = await getDoc(mref);
                                                        if (msnap.exists()) {
                                                            const m = msnap.data();
                                                            managerName = m.displayName || `${m.firstName || ''} ${m.lastName || ''}`.trim() || m.email || '';
                                                        }
                                                    }
                                                } catch (e) {
                                                    console.warn('Failed to fetch manager details:', e);
                                                }

                                                const transformedEmploymentData = transformEmploymentDataForDisplay(employmentDetails, userDetails, managerName);
                                                setEmploymentData(transformedEmploymentData);
                                            }
                                        } catch (e) {
                                            console.error('Error reloading employment details:', e);
                                            setEmploymentError('Failed to reload employment details');
                                        } finally {
                                            setEmploymentLoading(false);
                                        }
                                    };
                                    load();
                                }}
                                onRetry={() => {
                                    // Trigger a reload of employment data
                                    const load = async () => {
                                        try {
                                            setEmploymentLoading(true);
                                            setEmploymentError(null);
                                            const uid = normalizeUid(selectedUserId);
                                            if (uid) {
                                                // Get user details for manager info
                                                const uref = doc(db, 'users', uid);
                                                const usnap = await getDoc(uref);
                                                const userDetails = usnap.exists() ? usnap.data() : null;

                                                let employmentDetails = await getUserEmploymentDetails(uid);

                                                // Get onboarding data for banking details
                                                let onboarding = null;
                                                try {
                                                    const appCol = collection(db, 'onboardingApplications');
                                                    const queries = [
                                                        query(appCol, where('userId', '==', uid)),
                                                        query(appCol, where('userId', '==', `users/${uid}`)),
                                                        ...(userDetails?.email ? [query(appCol, where('formData.personalInfo.email', '==', userDetails.email))] : [])
                                                    ];
                                                    const results = await Promise.allSettled(queries.map(q => getDocs(q)));
                                                    const allDocs = [];
                                                    for (const r of results) {
                                                        if (r.status === 'fulfilled' && !r.value.empty) {
                                                            r.value.docs.forEach(d => allDocs.push({ id: d.id, ...d.data() }));
                                                        }
                                                    }
                                                    if (allDocs.length > 0) {
                                                        allDocs.sort((a, b) => {
                                                            const at = (a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0);
                                                            const bt = (b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0);
                                                            return bt - at;
                                                        });
                                                        onboarding = allDocs[0] || null;
                                                    }
                                                } catch (e) {
                                                    console.error('Failed to load onboarding applications for retry:', e);
                                                }

                                                // If no employment details, create from onboarding
                                                if (!employmentDetails && onboarding) {
                                                    // First check the new employmentDetails structure
                                                    const empDetails = onboarding?.employmentDetails || {};
                                                    const hr = onboarding?.formData?.hrInfo || {};
                                                    const bank = onboarding?.formData?.banking || {};

                                                    // Use employmentDetails if available, otherwise fall back to hrInfo
                                                    employmentDetails = {
                                                        jobTitle: empDetails.jobTitle || hr.position || '',
                                                        department: empDetails.department || hr.department || '',
                                                        employmentType: empDetails.employmentType || hr.employmentType || '',
                                                        primaryWorkLocation: empDetails.primaryWorkLocation || hr.primaryWorkLocation || '',
                                                        officeAddress: empDetails.officeAddress || '',
                                                        workPattern: empDetails.workPattern || '',
                                                        startDate: empDetails.startDate || hr.startDate || '',
                                                        probationPeriod: empDetails.probationPeriod || '',
                                                        probationEndDate: empDetails.probationEndDate || hr.probationEndDate || '',
                                                        workingHours: hr.workingHours || '',
                                                        noticePeriod: hr.noticePeriod || '',
                                                        annualSalary: hr.annualSalary || '',
                                                        payFrequency: hr.payFrequency || '',
                                                        benefits: hr.benefits || '',
                                                        // Map basic banking fields from onboarding data structure
                                                        bankAccountName: bank.accountHolderName || '',
                                                        bankAccountNumber: bank.accountNumber || '',
                                                        bankName: bank.bankName || '',
                                                        sortCode: bank.sortCode || '',
                                                        branchName: bank.branchName || '',
                                                        iban: bank.iban || '',
                                                        adminNotes: hr.notes || ''
                                                    };
                                                }

                                                // Always override basic banking details with onboarding data if available
                                                if (onboarding && employmentDetails) {
                                                    const bank = onboarding?.formData?.banking || {};
                                                    employmentDetails.bankAccountName = bank.accountHolderName || employmentDetails.bankAccountName || '';
                                                    employmentDetails.bankAccountNumber = bank.accountNumber || employmentDetails.bankAccountNumber || '';
                                                    employmentDetails.bankName = bank.bankName || employmentDetails.bankName || '';
                                                    employmentDetails.sortCode = bank.sortCode || employmentDetails.sortCode || '';
                                                    employmentDetails.branchName = bank.branchName || employmentDetails.branchName || '';
                                                    employmentDetails.iban = bank.iban || employmentDetails.iban || '';
                                                }

                                                // Store raw employment details for editing
                                                setRawEmploymentDetails(employmentDetails);

                                                // Get manager name if available
                                                let managerName = '';
                                                try {
                                                    if (userDetails?.managerUserId) {
                                                        const mref = doc(db, 'users', userDetails.managerUserId);
                                                        const msnap = await getDoc(mref);
                                                        if (msnap.exists()) {
                                                            const m = msnap.data();
                                                            managerName = m.displayName || `${m.firstName || ''} ${m.lastName || ''}`.trim() || m.email || '';
                                                        }
                                                    }
                                                } catch (e) {
                                                    console.warn('Failed to fetch manager details:', e);
                                                }

                                                const transformedEmploymentData = transformEmploymentDataForDisplay(employmentDetails, userDetails, managerName);
                                                setEmploymentData(transformedEmploymentData);
                                            }
                                        } catch (e) {
                                            console.error('Error reloading employment details:', e);
                                            setEmploymentError('Failed to reload employment details');
                                        } finally {
                                            setEmploymentLoading(false);
                                        }
                                    };
                                    load();
                                }}
                            />
                        )}
                        {activeTab === 'Contract Documents' && (
                            <>
                                {contractDocsLoading && (
                                    <div className="p-4 text-text-secondary">Loading documents...</div>
                                )}
                                <ContractDocumentsTab
                                    documents={contractDocuments}
                                    userId={normalizeUid(selectedUserId)}
                                />
                            </>
                        )}
                        {activeTab === 'Allowances' && (
                            <>
                                {allowancesLoading && (
                                    <div className="p-4 text-text-secondary">Loading allowances...</div>
                                )}
                                <AllowancesTab
                                    allowances={allowancesData}
                                    year={new Date().getFullYear()}
                                    employee={employee}
                                    onAllowanceUpdate={async (year = null) => {
                                        // Reload allowance data when updated or year changed
                                        try {
                                            const targetYear = year || new Date().getFullYear();
                                            await ensureAllowancesLoaded(targetYear, true);
                                        } catch (e) {
                                            console.error('Failed to reload allowances', e);
                                            toast.error('Failed to reload allowances');
                                        }
                                    }}
                                />
                            </>
                        )}
                        {activeTab === 'Timesheet History' && <TimesheetHistoryTab timesheets={[]} userId={employee.id} />}
                        {activeTab === 'Absences History' && (
                            <>
                                {absencesLoading && (
                                    <div className="p-4 text-text-secondary">Loading absences...</div>
                                )}
                                <AbsencesHistoryTab
                                    absences={absencesData}
                                    currentUser={user}
                                    refreshAbsences={refreshAbsences}
                                />
                            </>
                        )}
                    </div>
                </div>
            </div>
            <AssignEmployeeModal
                isOpen={assignModalOpen}
                onClose={() => setAssignModalOpen(false)}
                onSave={handleSaveAssign}
                employee={employee}
            />
        </>

    );
};

export default UserDetailsPage;