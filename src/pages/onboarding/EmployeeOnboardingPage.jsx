import React, { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ArrowRight, CheckCircle, Upload, FileText, AlertCircle, Loader2, X, RotateCcw } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import Badge from '../../components/ui/Badge';
import { useAuth } from '../../hooks/useAuth';
import {
    createOnboardingApplication,
    submitOnboardingStep,
    completeOnboardingApplication,
    getUserOnboardingApplication,
    ONBOARDING_STEPS,
    ONBOARDING_STATUS
} from '../../services/onboarding';
import {
    uploadDocument,
    getUserDocuments,
    getDocument,
    deleteDocument,
    DOCUMENT_TYPES,
    DOCUMENT_CATEGORIES
} from '../../services/documents';
import { getCompanyOnboardingPolicies } from '../../services/onboardingPolicyService';



const EmployeeOnboarding = () => {
    const { user, refreshUserData } = useAuth();
    const navigate = useNavigate();
    const normalizedCompanyId = user?.companyId
        ? (user.companyId.includes('/') ? user.companyId : `companies/${user.companyId}`)
        : null;
    const [currentStep, setCurrentStep] = useState(1);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [onboardingApplication, setOnboardingApplication] = useState(null);
    const [uploadProgress, setUploadProgress] = useState({});
    const [badgePhotoFile, setBadgePhotoFile] = useState(null);
    const [badgePhotoLoading, setBadgePhotoLoading] = useState(false);
    const [policyDocuments, setPolicyDocuments] = useState([]);
    const [isPoliciesLoading, setIsPoliciesLoading] = useState(false);
    const [policyLoadError, setPolicyLoadError] = useState(null);
    const [formData, setFormData] = useState({
        // Step 1: Personal Information
        firstName: '',
        lastName: '',
        preferredName: '',
        dateOfBirth: '',
        gender: '',
        maritalStatus: '',
        nationality: '',
        email: '',
        phone: '',
        addressLine1: '',
        addressLine2: '',
        city: '',
        country: '',

        // Step 2: Identification & Compliance
        nationalInsurance: '',
        passportNumber: '',
        issuingCountry: '',
        passportExpiry: '',
        rightToWork: '',
        visaDetails: '',
        emergencyContactName: '',
        emergencyRelationship: '',
        emergencyPhone: '',
        emergencyEmail: '',
        emergencyAddress: '',

        // Step 3: Banking & Payroll - Basic banking info only
        accountHolderName: '',
        bankName: '',
        branchName: '',
        accountNumber: '',
        sortCode: '',
        iban: '',

        // Step 4: HR Information
        nextOfKinName: '',
        nextOfKinRelationship: '',
        nextOfKinPhone: '',
        nextOfKinEmail: '',
        nextOfKinAddress: '',
        beneficiaryPercentage: '',
        healthDeclaration1: false,
        healthDeclaration2: false,
        healthDeclaration3: false,
        medicalDetails: '',
        currentMedications: '',
        dietaryRequirements: '',
        dietaryNotes: '',
        healthConsent: false,
        emergencyContactConsent: false,

        // Step 5: Policies & Agreements
        employmentContractAgreed: false,
        healthSafetyAgreed: false,
        signatureName: '',
        signatureDate: '',
        finalConfirmation: false,
        policyAcknowledgements: {},

        // Step 6: Optional Information
        tshirtSize: '',
        hoodieSize: '',
        laptopSize: '',
        equipmentNotes: '',
        vehicleMake: '',
        vehicleModel: '',
        vehicleColor: '',
        licensePlate: '',
        parkingRequirements: '',
        badgePhoto: null,
        keySkills: '',
        certifications: '',
        languages: '',
        workingStyle: '',
        communicationPreference: '',
        interests: ''
    });

    const totalSteps = 6;
    const progressPercentage = ((currentStep - 1) / totalSteps) * 100;

    // Initialize onboarding application
    useEffect(() => {
        const initializeOnboarding = async () => {
            if (!user?.uid || !user?.companyId || !user?.siteId) {
                setError('User information not available. Please login again.');
                return;
            }

            try {
                setIsLoading(true);
                setError(null);

                // Check if user already has an onboarding application
                const existingApplication = await getUserOnboardingApplication(user.uid);

                if (existingApplication) {
                    setOnboardingApplication(existingApplication);
                    setCurrentStep(existingApplication.currentStep);

                    // Load existing form data
                    if (existingApplication.formData) {
                        const loadedData = {
                            ...existingApplication.formData.personalInfo,
                            ...existingApplication.formData.identification,
                            ...existingApplication.formData.banking,
                            ...existingApplication.formData.hrInfo,
                            ...existingApplication.formData.policies,
                            ...existingApplication.formData.optionalInfo
                        };
                        setFormData(prev => ({ ...prev, ...loadedData }));

                        // Load badge photo if it exists
                        if (loadedData.badgePhoto) {
                            try {
                                const badgeDoc = await getDocument(loadedData.badgePhoto);
                                if (badgeDoc) {
                                    setBadgePhotoFile({
                                        name: badgeDoc.fileName || 'Badge Photo',
                                        url: badgeDoc.downloadURL || null,
                                        documentId: loadedData.badgePhoto
                                    });
                                }
                            } catch (err) {
                                console.error('Failed to load badge photo:', err);
                                // Set a placeholder if we can't load the document
                                setBadgePhotoFile({
                                    name: 'Badge Photo',
                                    url: null,
                                    documentId: loadedData.badgePhoto
                                });
                            }
                        }
                    }

                    // Check if already completed
                    if (existingApplication.status === ONBOARDING_STATUS.COMPLETED) {
                        setCurrentStep(totalSteps + 1);
                        setSuccess('Your onboarding has already been completed!');
                    }
                } else {
                    // Create new onboarding application
                    const newApplication = await createOnboardingApplication({
                        userId: user.uid,
                        companyId: user.companyId,
                        siteId: user.siteId
                    });
                    setOnboardingApplication(newApplication);
                }
            } catch (err) {
                console.error('Error initializing onboarding:', err);
                setError(err.message || 'Failed to initialize onboarding');
            } finally {
                setIsLoading(false);
            }
        };

        initializeOnboarding();
    }, [user]);

    useEffect(() => {
        if (!normalizedCompanyId) return;
        let isMounted = true;
        const loadPolicies = async () => {
            try {
                setIsPoliciesLoading(true);
                setPolicyLoadError(null);
                const policies = await getCompanyOnboardingPolicies(normalizedCompanyId);
                if (isMounted) {
                    setPolicyDocuments(policies);
                }
            } catch (err) {
                console.error('Failed to load onboarding policies:', err);
                if (isMounted) {
                    setPolicyLoadError(err.message || 'Failed to load company policies');
                }
            } finally {
                if (isMounted) {
                    setIsPoliciesLoading(false);
                }
            }
        };
        loadPolicies();
        return () => {
            isMounted = false;
        };
    }, [normalizedCompanyId]);

    // Auto-save form data when it changes
    useEffect(() => {
        if (onboardingApplication && currentStep <= totalSteps) {
            const autoSave = async () => {
                try {
                    const stepData = getStepData(currentStep);
                    if (Object.keys(stepData).length > 0) {
                        await submitOnboardingStep(onboardingApplication.id, currentStep, stepData);
                    }
                } catch (err) {
                    console.error('Auto-save failed:', err);
                    // Don't show error for auto-save failures
                }
            };

            const timeoutId = setTimeout(autoSave, 2000); // Auto-save after 2 seconds of inactivity
            return () => clearTimeout(timeoutId);
        }
    }, [formData, currentStep, onboardingApplication]);

    // Helper function to get step data
    const getStepData = (step) => {
        const stepFields = {
            [ONBOARDING_STEPS.PERSONAL_INFO]: [
                'firstName', 'lastName', 'preferredName', 'dateOfBirth', 'gender',
                'maritalStatus', 'nationality', 'email', 'phone', 'addressLine1',
                'addressLine2', 'city', 'country'
            ],
            [ONBOARDING_STEPS.IDENTIFICATION]: [
                'nationalInsurance', 'passportNumber', 'issuingCountry', 'passportExpiry',
                'rightToWork', 'visaDetails', 'emergencyContactName', 'emergencyRelationship',
                'emergencyPhone', 'emergencyEmail', 'emergencyAddress'
            ],
            [ONBOARDING_STEPS.BANKING]: [
                'accountHolderName', 'bankName', 'branchName', 'accountNumber', 'sortCode', 'iban'
            ],
            [ONBOARDING_STEPS.HR_INFO]: [
                'nextOfKinName', 'nextOfKinRelationship', 'nextOfKinPhone', 'nextOfKinEmail',
                'nextOfKinAddress', 'beneficiaryPercentage', 'healthDeclaration1', 'healthDeclaration2',
                'healthDeclaration3', 'medicalDetails', 'currentMedications', 'dietaryRequirements',
                'dietaryNotes', 'healthConsent', 'emergencyContactConsent'
            ],
            [ONBOARDING_STEPS.POLICIES]: [
                'employmentContractAgreed', 'healthSafetyAgreed', 'signatureName', 'signatureDate',
                'finalConfirmation'
            ],
            [ONBOARDING_STEPS.OPTIONAL_INFO]: [
                'tshirtSize', 'hoodieSize', 'laptopSize', 'equipmentNotes', 'vehicleMake',
                'vehicleModel', 'vehicleColor', 'licensePlate', 'parkingRequirements', 'badgePhoto',
                'keySkills', 'certifications', 'languages', 'workingStyle', 'communicationPreference', 'interests'
            ]
        };

        const fields = stepFields[step] || [];
        const stepData = {};
        fields.forEach(field => {
            if (formData[field] !== undefined && formData[field] !== '') {
                stepData[field] = formData[field];
            }
        });
        return stepData;
    };

    const handleInputChange = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        setError(null); // Clear any previous errors
    };

    const getLegacyPolicyFlags = useCallback(
        (acknowledgements = {}) => {
            const categoryCheck = (category) => {
                const relevant = policyDocuments.filter(
                    (policy) => (policy.category || '').toLowerCase() === category
                );
                if (relevant.length === 0) {
                    // No documents in this category means legacy flag can be true
                    return true;
                }
                return relevant.every((policy) => {
                    if (!policy.isRequired) {
                        return true;
                    }
                    return Boolean(acknowledgements[policy.id]);
                });
            };

            return {
                employment: categoryCheck('employment'),
                safety: categoryCheck('safety')
            };
        },
        [policyDocuments]
    );

    useEffect(() => {
        setFormData((prev) => {
            const acknowledgements = prev.policyAcknowledgements || {};
            const legacyFlags = getLegacyPolicyFlags(acknowledgements);
            if (
                prev.employmentContractAgreed === legacyFlags.employment &&
                prev.healthSafetyAgreed === legacyFlags.safety
            ) {
                return prev;
            }
            return {
                ...prev,
                employmentContractAgreed: legacyFlags.employment,
                healthSafetyAgreed: legacyFlags.safety
            };
        });
    }, [policyDocuments, getLegacyPolicyFlags]);

    const handlePolicyAcknowledgementToggle = (policyId) => {
        setFormData((prev) => {
            const acknowledgements = {
                ...(prev.policyAcknowledgements || {}),
                [policyId]: !prev.policyAcknowledgements?.[policyId]
            };
            const legacyFlags = getLegacyPolicyFlags(acknowledgements);
            return {
                ...prev,
                policyAcknowledgements: acknowledgements,
                employmentContractAgreed: legacyFlags.employment,
                healthSafetyAgreed: legacyFlags.safety
            };
        });
    };

    const handleNext = async () => {
        if (currentStep < totalSteps) {
            try {
                setIsLoading(true);
                setError(null);

                // Save current step data
                const stepData = getStepData(currentStep);
                if (onboardingApplication && Object.keys(stepData).length > 0) {
                    await submitOnboardingStep(onboardingApplication.id, currentStep, stepData);
                }

                window.scrollTo(0, 0, { behavior: 'smooth' });
                setCurrentStep(currentStep + 1);
            } catch (err) {
                console.error('Error saving step:', err);
                setError(err.message || 'Failed to save step data');
            } finally {
                setIsLoading(false);
            }
        }
    };

    const handleBack = () => {
        if (currentStep > 1) {
            window.scrollTo(0, 0, { behavior: 'smooth' });
            setCurrentStep(currentStep - 1);
        }
    };

    const handleComplete = async () => {
        try {
            setIsLoading(true);
            setError(null);

            // Save final step data
            const stepData = getStepData(currentStep);
            if (onboardingApplication && Object.keys(stepData).length > 0) {
                await submitOnboardingStep(onboardingApplication.id, currentStep, stepData);
            }

            // Complete the onboarding application
            await completeOnboardingApplication(onboardingApplication.id, user.uid, {
                // Add any employment details if needed
            });

            // Small delay to allow database update to propagate
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Refresh user data in AuthContext to reflect onboarding completion
            if (refreshUserData) {
                await refreshUserData();
            }

            setCurrentStep(totalSteps + 1);
            setSuccess('Onboarding completed successfully!');
        } catch (err) {
            console.error('Error completing onboarding:', err);
            setError(err.message || 'Failed to complete onboarding');
        } finally {
            setIsLoading(false);
        }
    };

    // File upload handler
    const handleFileUpload = async (file, documentType, category, description = '') => {
        if (!onboardingApplication) {
            setError('Onboarding application not initialized');
            return;
        }

        const isBadgePhoto = description === 'Badge photo';

        try {
            // Use badge photo specific loading for badge photos, general loading for others
            if (isBadgePhoto) {
                setBadgePhotoLoading(true);
            } else {
                setIsLoading(true);
            }
            setError(null);

            const result = await uploadDocument({
                file,
                userId: user.uid,
                documentType,
                category,
                description,
                onboardingApplicationId: onboardingApplication.id,
                onProgress: (progress) => {
                    setUploadProgress(prev => ({
                        ...prev,
                        [file.name]: progress
                    }));
                }
            });

            // If this is a badge photo, store it in state
            if (isBadgePhoto) {
                setBadgePhotoFile({
                    name: file.name,
                    url: URL.createObjectURL(file),
                    documentId: result.id
                });
                handleInputChange('badgePhoto', result.id);
            }

            setSuccess(`Document "${file.name}" uploaded successfully!`);
            return result;
        } catch (err) {
            console.error('Error uploading document:', err);
            setError(err.message || 'Failed to upload document');
            throw err;
        } finally {
            // Clear the appropriate loading state
            if (isBadgePhoto) {
                setBadgePhotoLoading(false);
            } else {
                setIsLoading(false);
            }
            setUploadProgress(prev => {
                const newProgress = { ...prev };
                delete newProgress[file.name];
                return newProgress;
            });
        }
    };

    // Badge photo remove handler
    const handleRemoveBadgePhoto = async () => {
        if (!badgePhotoFile?.documentId) {
            setBadgePhotoFile(null);
            handleInputChange('badgePhoto', null);
            setSuccess('Badge photo removed successfully!');
            return;
        }

        try {
            setBadgePhotoLoading(true);
            setError(null);

            // Delete the document from storage
            await deleteDocument(badgePhotoFile.documentId, user.uid);

            // Clear the state
            setBadgePhotoFile(null);
            handleInputChange('badgePhoto', null);
            setSuccess('Badge photo removed successfully!');
        } catch (err) {
            console.error('Error removing badge photo:', err);
            setError(err.message || 'Failed to remove badge photo');
        } finally {
            setBadgePhotoLoading(false);
        }
    };

    // Step 1: Personal Information
    const renderPersonalInfo = () => (
        <div className="space-y-6">
            <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-1">Personal Information</h3>
                <p className="text-base text-gray-600">Basic personal details and contact information</p>
            </div>

            <div>
                <h4 className="text-base font-semibold text-gray-900 mb-4">Full Name</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <input
                        type="text"
                        placeholder="First Name"
                        value={formData.firstName}
                        onChange={(e) => handleInputChange('firstName', e.target.value)}
                        className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500"
                    />
                    <input
                        type="text"
                        placeholder="Last Name"
                        value={formData.lastName}
                        onChange={(e) => handleInputChange('lastName', e.target.value)}
                        className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500"
                    />
                </div>
            </div>

            <div>
                <h4 className="text-base font-semibold text-gray-900 mb-4">Personal Details</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <input
                        type="text"
                        placeholder="Preferred Name"
                        value={formData.preferredName}
                        onChange={(e) => handleInputChange('preferredName', e.target.value)}
                        className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500"
                    />
                    <input
                        type="date"
                        placeholder="Date of Birth"
                        value={formData.dateOfBirth}
                        onChange={(e) => handleInputChange('dateOfBirth', e.target.value)}
                        className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500"
                    />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                    <div className="relative">
                        <select
                            value={formData.gender}
                            onChange={(e) => handleInputChange('gender', e.target.value)}
                            className="w-full h-12 px-4 pr-10 border border-gray-300 rounded-lg text-base appearance-none focus:outline-none focus:border-purple-500"
                        >
                            <option value="">Gender</option>
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                            <option value="Other">Other</option>
                            <option value="Prefer not to say">Prefer not to say</option>
                        </select>
                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
                    </div>
                    <div className="relative">
                        <select
                            value={formData.maritalStatus}
                            onChange={(e) => handleInputChange('maritalStatus', e.target.value)}
                            className="w-full h-12 px-4 pr-10 border border-gray-300 rounded-lg text-base appearance-none focus:outline-none focus:border-purple-500"
                        >
                            <option value="">Marital status</option>
                            <option value="Single">Single</option>
                            <option value="Married">Married</option>
                            <option value="Other">Other</option>
                            <option value="Prefer not to say">Prefer not to say</option>
                        </select>
                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
                    </div>
                    <input
                        type="text"
                        placeholder="Nationality"
                        value={formData.nationality}
                        onChange={(e) => handleInputChange('nationality', e.target.value)}
                        className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500"
                    />
                </div>
            </div>

            <div>
                <h4 className="text-base font-semibold text-gray-900 mb-4">Contact Information</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <input
                        type="email"
                        placeholder="Email"
                        value={formData.email}
                        onChange={(e) => handleInputChange('email', e.target.value)}
                        className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500"
                    />
                    <input
                        type="tel"
                        placeholder="Phone Number"
                        value={formData.phone}
                        onChange={(e) => handleInputChange('phone', e.target.value)}
                        className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500"
                    />
                </div>
            </div>

            <div>
                <h4 className="text-base font-semibold text-gray-900 mb-4">Current Address</h4>
                <div className="space-y-4">
                    <input
                        type="text"
                        placeholder="Address Line 1"
                        value={formData.addressLine1}
                        onChange={(e) => handleInputChange('addressLine1', e.target.value)}
                        className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500"
                    />
                    <input
                        type="text"
                        placeholder="Address Line 2"
                        value={formData.addressLine2}
                        onChange={(e) => handleInputChange('addressLine2', e.target.value)}
                        className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500"
                    />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <input
                            type="text"
                            placeholder="City"
                            value={formData.city}
                            onChange={(e) => handleInputChange('city', e.target.value)}
                            className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500"
                        />
                        <input
                            type="text"
                            placeholder="Country"
                            value={formData.country}
                            onChange={(e) => handleInputChange('country', e.target.value)}
                            className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500"
                        />
                    </div>
                </div>
            </div>

            <p className="text-base text-center text-purple-600">
                By creating an account, you agree to our Terms of Service and Privacy Policy.
            </p>
        </div>
    );

    // Step 2: Identification & Compliance
    const renderIdentification = () => (
        <div className="space-y-6">
            <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-1">Identification & Compliance</h3>
                <p className="text-base text-gray-600">Required identification and emergency contacts</p>
            </div>

            <div>
                <h4 className="text-base font-semibold text-gray-900 mb-4">National Insurance & Tax</h4>
                <input
                    type="text"
                    placeholder="National Insurance Number"
                    value={formData.nationalInsurance}
                    onChange={(e) => handleInputChange('nationalInsurance', e.target.value)}
                    className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500"
                />
            </div>

            <div>
                <h4 className="text-base font-semibold text-gray-900 mb-4">Passport Information</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <input
                        type="text"
                        placeholder="Passport Number"
                        value={formData.passportNumber}
                        onChange={(e) => handleInputChange('passportNumber', e.target.value)}
                        className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500"
                    />
                    <div className="relative">
                        <select
                            value={formData.issuingCountry}
                            onChange={(e) => handleInputChange('issuingCountry', e.target.value)}
                            className="w-full h-12 px-4 pr-10 border border-gray-300 rounded-lg text-base appearance-none focus:outline-none focus:border-purple-500"
                        >
                            <option value="">Issuing Country</option>
                            <option>United Kingdom</option>
                            <option>United States</option>
                            <option>India</option>
                            <option>Other</option>
                        </select>
                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
                    </div>
                </div>
                <input
                    type="date"
                    placeholder="Passport Expiry Date"
                    value={formData.passportExpiry}
                    onChange={(e) => handleInputChange('passportExpiry', e.target.value)}
                    className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500 mt-4"
                />
            </div>

            <div>
                <h4 className="text-base font-semibold text-gray-900 mb-4">Right to Work</h4>
                <input
                    type="text"
                    placeholder="Right to Work Status"
                    value={formData.rightToWork}
                    onChange={(e) => handleInputChange('rightToWork', e.target.value)}
                    className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500 mb-4"
                />
                <input
                    type="text"
                    placeholder="Visa Details (if Applicable)"
                    value={formData.visaDetails}
                    onChange={(e) => handleInputChange('visaDetails', e.target.value)}
                    className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500"
                />
            </div>

            <div>
                <h4 className="text-base font-semibold text-gray-900 mb-4">Emergency Contact</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <input
                        type="text"
                        placeholder="Contact Name"
                        value={formData.emergencyContactName}
                        onChange={(e) => handleInputChange('emergencyContactName', e.target.value)}
                        className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500"
                    />
                    <div className="relative">
                        <select
                            value={formData.emergencyRelationship}
                            onChange={(e) => handleInputChange('emergencyRelationship', e.target.value)}
                            className="w-full h-12 px-4 pr-10 border border-gray-300 rounded-lg text-base appearance-none focus:outline-none focus:border-purple-500"
                        >
                            <option value="">Relationship</option>
                            <option>Spouse</option>
                            <option>Parent</option>
                            <option>Sibling</option>
                            <option>Friend</option>
                        </select>
                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    <input
                        type="tel"
                        placeholder="Phone Number"
                        value={formData.emergencyPhone}
                        onChange={(e) => handleInputChange('emergencyPhone', e.target.value)}
                        className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500"
                    />
                    <input
                        type="email"
                        placeholder="Email Address"
                        value={formData.emergencyEmail}
                        onChange={(e) => handleInputChange('emergencyEmail', e.target.value)}
                        className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500"
                    />
                </div>
                <input
                    type="text"
                    placeholder="Address"
                    value={formData.emergencyAddress}
                    onChange={(e) => handleInputChange('emergencyAddress', e.target.value)}
                    className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500 mt-4"
                />
            </div>
        </div>
    );

    // Step 3: Banking & Payroll - Basic banking information only
    const renderBanking = () => (
        <div className="space-y-6">
            <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-1">Banking & Payroll</h3>
                <p className="text-base text-gray-600">Basic bank account information for salary payments</p>
            </div>

            <div>
                <h4 className="text-base font-semibold text-gray-900 mb-4">Bank Account Information</h4>
                <input
                    type="text"
                    placeholder="Account Holder Name"
                    value={formData.accountHolderName}
                    onChange={(e) => handleInputChange('accountHolderName', e.target.value)}
                    className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500 mb-4"
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <input
                        type="text"
                        placeholder="Bank Name"
                        value={formData.bankName}
                        onChange={(e) => handleInputChange('bankName', e.target.value)}
                        className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500"
                    />
                    <input
                        type="text"
                        placeholder="Branch Name"
                        value={formData.branchName}
                        onChange={(e) => handleInputChange('branchName', e.target.value)}
                        className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500"
                    />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    <input
                        type="text"
                        placeholder="Account Number"
                        value={formData.accountNumber}
                        onChange={(e) => handleInputChange('accountNumber', e.target.value)}
                        className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500"
                    />
                    <input
                        type="text"
                        placeholder="Sort Code"
                        value={formData.sortCode}
                        onChange={(e) => handleInputChange('sortCode', e.target.value)}
                        className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500"
                    />
                </div>
                <input
                    type="text"
                    placeholder="IBAN (if applicable)"
                    value={formData.iban}
                    onChange={(e) => handleInputChange('iban', e.target.value)}
                    className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500 mt-4"
                />
            </div>

            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <h4 className="text-base font-semibold text-purple-900 mb-2">Additional Information</h4>
                <p className="text-base text-purple-700">
                    Payroll preferences, tax information, and account type details will be collected separately by our HR team during your employment setup.
                </p>
            </div>
        </div>
    );

    // Step 4: HR Information
    const renderHRInfo = () => (
        <div className="space-y-6">
            <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-1">HR Information</h3>
                <p className="text-base text-gray-600">Next of kin and medical disclosures</p>
            </div>

            <div>
                <h4 className="text-base font-semibold text-gray-900 mb-2">Next of Kin / Beneficiaries</h4>
                <p className="text-sm text-purple-600 mb-4">
                    This information is used for life insurance and pension beneficiaries. You can update this at any time.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <input
                        type="text"
                        placeholder="Next of Kin Name"
                        value={formData.nextOfKinName}
                        onChange={(e) => handleInputChange('nextOfKinName', e.target.value)}
                        className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500"
                    />
                    <div className="relative">
                        <select
                            value={formData.nextOfKinRelationship}
                            onChange={(e) => handleInputChange('nextOfKinRelationship', e.target.value)}
                            className="w-full h-12 px-4 pr-10 border border-gray-300 rounded-lg text-base appearance-none focus:outline-none focus:border-purple-500"
                        >
                            <option value="">Relationship</option>
                            <option>Spouse</option>
                            <option>Parent</option>
                            <option>Child</option>
                            <option>Sibling</option>
                        </select>
                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    <input
                        type="tel"
                        placeholder="Phone Number"
                        value={formData.nextOfKinPhone}
                        onChange={(e) => handleInputChange('nextOfKinPhone', e.target.value)}
                        className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500"
                    />
                    <input
                        type="email"
                        placeholder="Email Address"
                        value={formData.nextOfKinEmail}
                        onChange={(e) => handleInputChange('nextOfKinEmail', e.target.value)}
                        className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500"
                    />
                </div>
                <input
                    type="text"
                    placeholder="Address"
                    value={formData.nextOfKinAddress}
                    onChange={(e) => handleInputChange('nextOfKinAddress', e.target.value)}
                    className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500 mt-4"
                />
                <div className="relative mt-4">
                    <select
                        value={formData.beneficiaryPercentage}
                        onChange={(e) => handleInputChange('beneficiaryPercentage', e.target.value)}
                        className="w-full h-12 px-4 pr-10 border border-gray-300 rounded-lg text-base appearance-none focus:outline-none focus:border-purple-500"
                    >
                        <option value="">Beneficiary Percentage</option>
                        <option>25%</option>
                        <option>50%</option>
                        <option>75%</option>
                        <option>100%</option>
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
                </div>
            </div>

            <div>
                <h4 className="text-base font-semibold text-gray-900 mb-2">Health & Medical Information</h4>
                <p className="text-sm text-purple-600 mb-4">
                    This information is confidential and used only for workplace health and safety. You are not required to disclose any information you're not comfortable sharing.
                </p>
                <div className="space-y-3">
                    <label className="flex items-start gap-3 cursor-pointer">
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${formData.healthDeclaration1 ? 'border-purple-500 bg-purple-500' : 'border-gray-300'
                            }`}
                            onClick={() => handleInputChange('healthDeclaration1', !formData.healthDeclaration1)}>
                            {formData.healthDeclaration1 && (
                                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                            )}
                        </div>
                        <span className="text-base text-gray-700">I confirm I am fit to carry out the duties of my role</span>
                    </label>

                    <label className="flex items-start gap-3 cursor-pointer">
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${formData.healthDeclaration2 ? 'border-purple-500 bg-purple-500' : 'border-gray-300'
                            }`}
                            onClick={() => handleInputChange('healthDeclaration2', !formData.healthDeclaration2)}>
                            {formData.healthDeclaration2 && (
                                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                            )}
                        </div>
                        <span className="text-base text-gray-700">I have a disability or long-term health condition that may require workplace adjustments</span>
                    </label>

                    <label className="flex items-start gap-3 cursor-pointer">
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${formData.healthDeclaration3 ? 'border-purple-500 bg-purple-500' : 'border-gray-300'
                            }`}
                            onClick={() => handleInputChange('healthDeclaration3', !formData.healthDeclaration3)}>
                            {formData.healthDeclaration3 && (
                                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                            )}
                        </div>
                        <span className="text-base text-gray-700">I have allergies that may affect my work environment</span>
                    </label>
                </div>

                <textarea
                    placeholder="Medical details (Optional)"
                    value={formData.medicalDetails}
                    onChange={(e) => handleInputChange('medicalDetails', e.target.value)}
                    rows={3}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500 resize-none mt-4"
                />

                <textarea
                    placeholder="Current Medications (Optional)"
                    value={formData.currentMedications}
                    onChange={(e) => handleInputChange('currentMedications', e.target.value)}
                    rows={3}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500 resize-none mt-4"
                />
            </div>

            <div>
                <h4 className="text-base font-semibold text-gray-900 mb-4">Dietary Requirements</h4>
                <div className="relative mb-4">
                    <select
                        value={formData.dietaryRequirements}
                        onChange={(e) => handleInputChange('dietaryRequirements', e.target.value)}
                        className="w-full h-12 px-4 pr-10 border border-gray-300 rounded-lg text-base appearance-none focus:outline-none focus:border-purple-500"
                    >
                        <option value="">Dietary Requirements/Restrictions</option>
                        <option>None</option>
                        <option>Vegetarian</option>
                        <option>Vegan</option>
                        <option>Gluten-Free</option>
                        <option>Halal</option>
                        <option>Kosher</option>
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
                </div>

                <textarea
                    placeholder="Additional Dietary Notes..."
                    value={formData.dietaryNotes}
                    onChange={(e) => handleInputChange('dietaryNotes', e.target.value)}
                    rows={3}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500 resize-none"
                />
            </div>

            <div>
                <h4 className="text-base font-semibold text-gray-900 mb-4">Privacy & Consent</h4>
                <div className="space-y-3">
                    <label className="flex items-start gap-3 cursor-pointer">
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${formData.healthConsent ? 'border-purple-500 bg-purple-500' : 'border-gray-300'
                            }`}
                            onClick={() => handleInputChange('healthConsent', !formData.healthConsent)}>
                            {formData.healthConsent && (
                                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                            )}
                        </div>
                        <span className="text-base text-gray-700">I consent to the processing of my health data for occupational health and safety purposes</span>
                    </label>

                    <label className="flex items-start gap-3 cursor-pointer">
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${formData.emergencyContactConsent ? 'border-purple-500 bg-purple-500' : 'border-gray-300'
                            }`}
                            onClick={() => handleInputChange('emergencyContactConsent', !formData.emergencyContactConsent)}>
                            {formData.emergencyContactConsent && (
                                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                            )}
                        </div>
                        <span className="text-base text-gray-700">I consent to my emergency contacts being contacted in case of workplace emergency</span>
                    </label>
                </div>
            </div>
        </div>
    );

    const policyBadgeVariant = (category) => {
        switch ((category || '').toLowerCase()) {
            case 'employment':
                return 'legal';
            case 'safety':
                return 'safety';
            case 'policy':
                return 'info';
            default:
                return 'secondary';
        }
    };

    const policyCategoryLabel = (category) => {
        switch ((category || '').toLowerCase()) {
            case 'employment':
                return 'Employment';
            case 'safety':
                return 'Safety';
            case 'policy':
                return 'Policy';
            default:
                return 'Other';
        }
    };

    // Step 5: Policies & Agreements
    const renderPolicies = () => (
        <div className="space-y-6">
            <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-1">Policies & Agreements</h3>
                <p className="text-base text-gray-600">Review and acknowledge company documents</p>
            </div>

            {policyLoadError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded">
                    {policyLoadError}
                </div>
            )}

            {isPoliciesLoading ? (
                <div className="space-y-4">
                    {[...Array(2)].map((_, idx) => (
                        <div key={idx} className="border-2 border-gray-200 rounded-lg p-5 animate-pulse">
                            <div className="h-4 bg-gray-200 rounded w-1/3 mb-2"></div>
                            <div className="h-3 bg-gray-200 rounded w-3/4"></div>
                        </div>
                    ))}
                </div>
            ) : policyDocuments.length === 0 ? (
                <div className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center text-base text-gray-600">
                    Your company has not uploaded policies yet. Please contact your manager if you believe this is incorrect.
                </div>
            ) : (
                policyDocuments.map((policy) => {
                    const acknowledged = Boolean(formData.policyAcknowledgements?.[policy.id]);
                    return (
                        <div key={policy.id} className="border-2 border-gray-200 rounded-lg p-5 space-y-4">
                            <div className="flex sm:flex-row flex-col gap-2 items-start sm:justify-between">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                                        <h4 className="text-base font-semibold text-gray-900">{policy.title}</h4>
                                        {policy.isRequired && <span className="text-red-500">*</span>}
                                        <Badge variant={policyBadgeVariant(policy.category)}>
                                            {policyCategoryLabel(policy.category)}
                                        </Badge>
                                    </div>
                                    {policy.description ? (
                                        <p className="text-base text-gray-600">{policy.description}</p>
                                    ) : (
                                        <p className="text-base text-gray-600">Please review this document before acknowledging.</p>
                                    )}
                                </div>
                                <div className="flex items-center gap-3 sm:ml-4">
                                    <button
                                        type="button"
                                        className="px-4 py-2 border-2 border-purple-500 text-purple-600 rounded-lg text-base font-medium hover:bg-purple-50"
                                        onClick={() => window.open(policy.downloadURL, '_blank', 'noopener')}
                                    >
                                        View Document
                                    </button>
                                </div>
                            </div>
                            <label className="flex items-start gap-3 cursor-pointer">
                                <div
                                    className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${acknowledged ? 'border-purple-500 bg-purple-500' : 'border-gray-300'
                                        }`}
                                    onClick={() => handlePolicyAcknowledgementToggle(policy.id)}
                                >
                                    {acknowledged && (
                                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                        </svg>
                                    )}
                                </div>
                                <span className="text-base text-gray-700">
                                    I have read and agree to the {policy.title}.
                                </span>
                            </label>
                        </div>
                    );
                })
            )}

            <div>
                <h4 className="text-base font-semibold text-gray-900 mb-4">Digital Acknowledgment</h4>
                <input
                    type="text"
                    placeholder="Full name (Signature)"
                    value={formData.signatureName}
                    onChange={(e) => handleInputChange('signatureName', e.target.value)}
                    className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500 mb-4"
                />
                <input
                    type="text"
                    placeholder="06-09-2025"
                    value={formData.signatureDate}
                    onChange={(e) => handleInputChange('signatureDate', e.target.value)}
                    className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500"
                />
            </div>

            <label className="flex items-start gap-3 cursor-pointer p-4 bg-gray-50 rounded-lg">
                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${formData.finalConfirmation ? 'border-purple-500 bg-purple-500' : 'border-gray-300'
                    }`}
                    onClick={() => handleInputChange('finalConfirmation', !formData.finalConfirmation)}>
                    {formData.finalConfirmation && (
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                    )}
                </div>
                <span className="text-base text-gray-700">
                    I confirm that I have read, understood, and agree to be bound by all the required policies and agreements listed above. I understand that these form part of my employment terms and conditions.
                </span>
            </label>
        </div>
    );

    // Step 6: Optional Information
    const renderOptionalInfo = () => (
        <div className="space-y-6">
            <div className="text-center">
                <div className="inline-block text-4xl mb-3">⭐</div>
                <h3 className="text-xl font-semibold text-gray-900 mb-1">Optional Information</h3>
                <p className="text-base text-gray-600">Additional details and preferences</p>
            </div>

            <div className="text-center bg-purple-50 border border-purple-200 rounded-lg p-4">
                <p className="text-base font-medium text-purple-900 mb-1">Almost Done! Final Details</p>
                <p className="text-base text-purple-700">These optional details help us prepare for your arrival and ensure you have everything you need.</p>
            </div>

            <div className="border-2 border-gray-200 rounded-lg p-5">
                <h4 className="text-base font-semibold text-gray-900 mb-2">Uniform & Equipment Sizing</h4>
                <p className="text-base text-gray-600 mb-4">Help us prepare your workspace and any required uniforms</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div className="relative">
                        <select
                            value={formData.tshirtSize}
                            onChange={(e) => handleInputChange('tshirtSize', e.target.value)}
                            className="w-full h-12 px-4 pr-10 border border-gray-300 rounded-lg text-base appearance-none focus:outline-none focus:border-purple-500"
                        >
                            <option value="">T-shirt Size</option>
                            <option>XS</option>
                            <option>S</option>
                            <option>M</option>
                            <option>L</option>
                            <option>XL</option>
                            <option>XXL</option>
                        </select>
                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
                    </div>
                    <div className="relative">
                        <select
                            value={formData.hoodieSize}
                            onChange={(e) => handleInputChange('hoodieSize', e.target.value)}
                            className="w-full h-12 px-4 pr-10 border border-gray-300 rounded-lg text-base appearance-none focus:outline-none focus:border-purple-500"
                        >
                            <option value="">Hoodie/sweater Size</option>
                            <option>XS</option>
                            <option>S</option>
                            <option>M</option>
                            <option>L</option>
                            <option>XL</option>
                            <option>XXL</option>
                        </select>
                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
                    </div>
                    <div className="relative">
                        <select
                            value={formData.laptopSize}
                            onChange={(e) => handleInputChange('laptopSize', e.target.value)}
                            className="w-full h-12 px-4 pr-10 border border-gray-300 rounded-lg text-base appearance-none focus:outline-none focus:border-purple-500"
                        >
                            <option value="">Preferred Laptop Size</option>
                            <option>13 inch</option>
                            <option>15 inch</option>
                            <option>17 inch</option>
                        </select>
                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
                    </div>
                </div>
                <textarea
                    placeholder="Equipment Notes"
                    value={formData.equipmentNotes}
                    onChange={(e) => handleInputChange('equipmentNotes', e.target.value)}
                    rows={2}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500 resize-none"
                />
            </div>

            <div className="border-2 border-gray-200 rounded-lg p-5">
                <h4 className="text-base font-semibold text-gray-900 mb-2">Vehicle & Parking Information</h4>
                <p className="text-base text-gray-600 mb-4">For parking permits and security purposes</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <input
                        type="text"
                        placeholder="Vehicle Make"
                        value={formData.vehicleMake}
                        onChange={(e) => handleInputChange('vehicleMake', e.target.value)}
                        className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500"
                    />
                    <input
                        type="text"
                        placeholder="Vehicle Model"
                        value={formData.vehicleModel}
                        onChange={(e) => handleInputChange('vehicleModel', e.target.value)}
                        className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500"
                    />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <input
                        type="text"
                        placeholder="Vehicle Color"
                        value={formData.vehicleColor}
                        onChange={(e) => handleInputChange('vehicleColor', e.target.value)}
                        className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500"
                    />
                    <input
                        type="text"
                        placeholder="License Plate"
                        value={formData.licensePlate}
                        onChange={(e) => handleInputChange('licensePlate', e.target.value)}
                        className="w-full h-12 px-4 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500"
                    />
                </div>
                <textarea
                    placeholder="Parking Requirements"
                    value={formData.parkingRequirements}
                    onChange={(e) => handleInputChange('parkingRequirements', e.target.value)}
                    rows={2}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500 resize-none"
                />
            </div>

            <div className="border-2 border-gray-200 rounded-lg p-5">
                <h4 className="text-base font-semibold text-gray-900 mb-2">ID Badge Photo</h4>
                <p className="text-base text-gray-600 mb-4">Upload a professional headshot for your employee ID badge</p>

                {!badgePhotoFile ? (
                    <div
                        className={`border-2 border-dashed border-purple-400 rounded-lg p-8 text-center transition-colors ${badgePhotoLoading
                            ? 'bg-purple-50 cursor-not-allowed'
                            : 'hover:bg-purple-50 cursor-pointer'
                            }`}
                        onClick={() => {
                            if (!badgePhotoLoading) {
                                const el = document.getElementById('badgePhotoInput');
                                if (el) el.click();
                            }
                        }}
                    >
                        {badgePhotoLoading ? (
                            <>
                                <Loader2 className="h-8 w-8 text-purple-600 mx-auto mb-3 animate-spin" />
                                <p className="text-base text-purple-600 font-medium mb-1">
                                    Uploading photo...
                                </p>
                                <p className="text-sm text-gray-600">
                                    Please wait while your photo is being uploaded
                                </p>
                            </>
                        ) : (
                            <>
                                <Upload className="h-8 w-8 text-purple-600 mx-auto mb-3" />
                                <p className="text-base text-purple-600 font-medium mb-1">
                                    Upload a clear, professional headshot (JPG, PNG, max 5MB)
                                </p>
                                <p className="text-sm text-gray-600">
                                    Photo guidelines: Professional attire, neutral background, clear face visibility
                                </p>
                            </>
                        )}
                    </div>
                ) : (
                    <div className="border-2 border-solid border-green-300 rounded-lg p-4 bg-green-50">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                                <CheckCircle className="h-5 w-5 text-green-600" />
                                <span className="text-sm font-medium text-green-800">Photo uploaded successfully</span>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        const el = document.getElementById('badgePhotoInput');
                                        if (el) el.click();
                                    }}
                                    disabled={badgePhotoLoading}
                                    className="flex items-center gap-1 px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Replace photo"
                                >
                                    {badgePhotoLoading ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                        <RotateCcw className="h-3 w-3" />
                                    )}
                                    Replace
                                </button>
                                <button
                                    type="button"
                                    onClick={handleRemoveBadgePhoto}
                                    disabled={badgePhotoLoading}
                                    className="flex items-center gap-1 px-3 py-1 text-xs bg-red-100 text-red-700 rounded-md hover:bg-red-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Remove photo"
                                >
                                    {badgePhotoLoading ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                        <X className="h-3 w-3" />
                                    )}
                                    Remove
                                </button>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0 flex items-center justify-center">
                                {badgePhotoFile.url ? (
                                    <img
                                        src={badgePhotoFile.url}
                                        alt="Badge photo preview"
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <FileText className="h-6 w-6 text-gray-400" />
                                )}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">{badgePhotoFile.name}</p>
                                <p className="text-xs text-gray-600">
                                    {badgePhotoFile.url ? 'Ready for ID badge creation' : 'Photo uploaded (preview not available)'}
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                <input
                    id="badgePhotoInput"
                    type="file"
                    accept=".jpg,.jpeg,.png"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;

                        // Validate file size (5MB limit)
                        if (file.size > 5 * 1024 * 1024) {
                            setError('File size must be less than 5MB');
                            e.target.value = '';
                            return;
                        }

                        try {
                            // If replacing an existing photo, delete the old one first
                            if (badgePhotoFile?.documentId) {
                                try {
                                    await deleteDocument(badgePhotoFile.documentId, user.uid);
                                } catch (deleteErr) {
                                    console.warn('Failed to delete old badge photo:', deleteErr);
                                    // Continue with upload even if delete fails
                                }
                            }

                            await handleFileUpload(file, DOCUMENT_TYPES.EMPLOYMENT, DOCUMENT_CATEGORIES.OTHER, 'Badge photo');
                        } catch (err) {
                            console.error('Badge photo upload failed:', err);
                        }
                        e.target.value = '';
                    }}
                />
            </div>

            <div className="border-2 border-gray-200 rounded-lg p-5">
                <h4 className="text-base font-semibold text-gray-900 mb-2">Skills & Certifications</h4>
                <p className="text-base text-gray-600 mb-4">Help us understand your expertise and plan development opportunities</p>
                <textarea
                    placeholder="Key Skills"
                    value={formData.keySkills}
                    onChange={(e) => handleInputChange('keySkills', e.target.value)}
                    rows={2}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500 resize-none mb-4"
                />
                <textarea
                    placeholder="Professional Certificates"
                    value={formData.certifications}
                    onChange={(e) => handleInputChange('certifications', e.target.value)}
                    rows={2}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500 resize-none mb-4"
                />
                <textarea
                    placeholder="Languages Spoken"
                    value={formData.languages}
                    onChange={(e) => handleInputChange('languages', e.target.value)}
                    rows={2}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500 resize-none"
                />
            </div>

            <div className="border-2 border-gray-200 rounded-lg p-5">
                <h4 className="text-base font-semibold text-gray-900 mb-2">Workplace Preferences</h4>
                <p className="text-base text-gray-600 mb-4">Help us create a comfortable work environment for you</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div className="relative">
                        <select
                            value={formData.workingStyle}
                            onChange={(e) => handleInputChange('workingStyle', e.target.value)}
                            className="w-full h-12 px-4 pr-10 border border-gray-300 rounded-lg text-base appearance-none focus:outline-none focus:border-purple-500"
                        >
                            <option value="">Preferred Working Style</option>
                            <option>Collaborative</option>
                            <option>Independent</option>
                            <option>Flexible/Mixed</option>
                        </select>
                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
                    </div>
                    <div className="relative">
                        <select
                            value={formData.communicationPreference}
                            onChange={(e) => handleInputChange('communicationPreference', e.target.value)}
                            className="w-full h-12 px-4 pr-10 border border-gray-300 rounded-lg text-base appearance-none focus:outline-none focus:border-purple-500"
                        >
                            <option value="">Communication Preference</option>
                            <option>Email</option>
                            <option>Slack/Chat</option>
                            <option>Video Calls</option>
                            <option>In-Person</option>
                        </select>
                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 pointer-events-none" />
                    </div>
                </div>
                <textarea
                    placeholder="Interests & Hobbies"
                    value={formData.interests}
                    onChange={(e) => handleInputChange('interests', e.target.value)}
                    rows={2}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base focus:outline-none focus:border-purple-500 resize-none"
                />
                {/* Badge Photo Upload removed in favor of the styled ID Badge Photo uploader above */}
            </div>
        </div>
    );

    // Auto-redirect after onboarding completion
    useEffect(() => {
        if (currentStep === totalSteps + 1) {
            const timer = setTimeout(() => {
                navigate('/');
            }, 3000);

            return () => clearTimeout(timer);
        }
    }, [currentStep, totalSteps, navigate]);

    // Completion Screen
    const renderCompletion = () => (
        <div className="min-h-[60vh] flex items-center justify-center">
            <div className="text-center max-w-md mx-auto">
                <div className="w-24 h-24 rounded-full bg-purple-100 flex items-center justify-center mx-auto mb-6">
                    <CheckCircle className="h-12 w-12 text-purple-600" />
                </div>
                <h2 className="text-3xl font-bold text-gray-900 mb-3">Onboarding Complete!</h2>
                <p className="text-gray-600 mb-4">
                    Thank you for completing your onboarding. Your information has been submitted for review.
                </p>
                <p className="text-sm text-gray-500 mb-8">
                    You will be redirected to the dashboard in a few seconds...
                </p>
                <div className="block text-6xl animate-bounce">🎉</div>
                <Link to={"/"} className="mt-8 inline-block px-8 py-3.5 bg-gradient-to-r from-[#AF54DD] to-[#7617A7] text-white rounded-lg font-semibold text-base hover:opacity-90 transition-opacity">
                    Go to Dashboard Now
                    <ArrowRight className="h-4 w-4 inline-block ml-2" />
                </Link>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-white relative flex flex-col justify-around   py-10 overflow-hidden  gap-10">
            <div
                className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-60 pointer-events-none"
                style={{ backgroundImage: "url('/Authbg.png')" }}
            ></div>
            <div className="max-w-3xl z-10 w-full mx-auto p-4">
                {currentStep <= totalSteps && (
                    <div>
                        {/* Header */}
                        <div className="text-center mb-8">
                            <h1 className="text-3xl font-bold text-gray-900 mb-2">Employee Onboarding</h1>
                            <p className="text-gray-600">Complete your onboarding process step by step</p>
                        </div>

                        {/* Progress Bar */}
                        <div className="mb-12">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-base font-medium text-gray-700">{currentStep} of {totalSteps}</span>
                                <span className="text-base font-medium text-gray-700">{Math.round(progressPercentage)}% complete</span>
                            </div>
                            <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-[#AF54DD] to-[#7617A7] transition-all duration-500"
                                    style={{ width: `${progressPercentage}%` }}
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* Error/Success Messages */}
                {error && (
                    <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
                        <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
                        <p className="text-red-700 text-sm">{error}</p>
                    </div>
                )}

                {success && (
                    <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
                        <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                        <p className="text-green-700 text-sm">{success}</p>
                    </div>
                )}

                {/* Form Content */}
                <div className="bg-white rounded-[24px] shadow-lg p-6 md:p-8">
                    {isLoading && (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
                            <span className="ml-2 text-gray-600">Loading...</span>
                        </div>
                    )}

                    {!isLoading && currentStep === 1 && renderPersonalInfo()}
                    {!isLoading && currentStep === 2 && renderIdentification()}
                    {!isLoading && currentStep === 3 && renderBanking()}
                    {!isLoading && currentStep === 4 && renderHRInfo()}
                    {!isLoading && currentStep === 5 && renderPolicies()}
                    {!isLoading && currentStep === 6 && renderOptionalInfo()}
                    {!isLoading && currentStep === totalSteps + 1 && renderCompletion()}

                    {/* Navigation Buttons */}
                    {!isLoading && currentStep <= totalSteps && (
                        <div className="flex flex-3 gap-4 mt-8">
                            {currentStep > 1 && (
                                <button
                                    onClick={handleBack}
                                    disabled={isLoading}
                                    className="md:flex-initial px-8 py-3.5 rounded-lg text-base font-medium text-gray-700 hover:bg-gray-100 transition-colors border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Back
                                </button>
                            )}
                            {currentStep < totalSteps && (
                                <button
                                    onClick={handleNext}
                                    disabled={isLoading}
                                    className="flex-1 h-12 bg-gradient-to-r from-[#AF54DD] to-[#7617A7] text-white rounded-lg font-semibold text-base flex items-center justify-center gap-2.5 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isLoading ? (
                                        <>
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            <span>Saving...</span>
                                        </>
                                    ) : (
                                        <>
                                            <span>Next</span>
                                            <ArrowRight className="h-4 w-4" />
                                        </>
                                    )}
                                </button>
                            )}
                            {currentStep === totalSteps && (
                                <button
                                    onClick={handleComplete}
                                    disabled={isLoading}
                                    className="flex-1 h-12 bg-gradient-to-r from-[#AF54DD] to-[#7617A7] text-white rounded-lg font-semibold text-base flex items-center justify-center gap-2.5 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {isLoading ? (
                                        <>
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            <span>Completing...</span>
                                        </>
                                    ) : (
                                        <>
                                            <span>Complete</span>
                                            <CheckCircle className="h-4 w-4" />
                                        </>
                                    )}
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* Sign In Link */}
                {currentStep === 1 && (
                    <p className="text-center text-md text-gray-600 mt-6">
                        Already have an account?{' '}
                        <Link to="/login" className="text-purple-600 font-medium hover:underline">
                            Sign in
                        </Link>
                    </p>
                )}
            </div>
        </div>
    );
};

export default EmployeeOnboarding;