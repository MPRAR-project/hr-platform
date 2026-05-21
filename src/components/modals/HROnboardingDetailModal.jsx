import React, { useState, useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Upload, Download, Trash2, Save, Loader2, Plus, RefreshCw } from 'lucide-react';
import { safeParseDate } from '../../utils/safeDateParse';
import { useAuth } from '../../hooks/useAuth';
import { updateHROnboardingSection, calculateCompletionPercent } from '../../services/hrOnboarding';
import { uploadDocument, deleteDocument, DOCUMENT_TYPES, DOCUMENT_CATEGORIES } from '../../services/documents';
import { allowanceService } from '../../services/allowanceService';
import { uploadContract } from '../../services/contractService';
import Button from '../ui/Button';
import { toast } from 'react-toastify';

const HROnboardingDetailModal = ({ isOpen, onClose, profile, userData }) => {
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState('personalInfo');
    const [isLoading, setIsLoading] = useState(false);
    const [uploadingDocIndex, setUploadingDocIndex] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    const [localProfile, setLocalProfile] = useState(profile);

    // Employment Details form state
    const [employmentData, setEmploymentData] = useState({
        // Position Details
        jobTitle: '',
        department: '',
        employmentType: '',
        startDate: '',
        probationPeriod: '',
        // Work Location
        primaryWorkLocation: '',
        workPattern: '',
        officeAddress: '',

        // Compensation
        annualSalary: '',
        payFrequency: '',
        hourlyRate: '',
        chargeRate: '',
        benefits: '',
        // Additional Notes
        adminNotes: ''
    });

    // Allowances form state
    const [allowancesData, setAllowancesData] = useState([]);

    useEffect(() => {
        if (profile) {
            setLocalProfile(profile);

            // Fetch employment details using robust logic from UserDetailsPage
            const fetchRobustEmploymentDetails = async () => {
                try {
                    console.log('[HR Onboarding] Fetching robust employment details for:', profile.userId);

                    const { getUserEmploymentDetails } = await import('../../services/users');
                    const { getUserOnboardingApplication } = await import('../../services/onboarding.js');

                    const uid = profile.userId;

                    // 1. Get user details from REST (primary source for existing employees)
                    let userEmploymentDetails = null;
                    try {
                        userEmploymentDetails = await getUserEmploymentDetails(uid);
                    } catch (e) {
                        console.warn('Failed to load employment details from REST:', e);
                    }

                    // 2. Get onboarding application data (fallback source)
                    let onboarding = null;
                    try {
                        onboarding = await getUserOnboardingApplication(uid);
                    } catch (e) {
                        console.error('Failed to load onboarding application:', e);
                    }

                    // 3. Construct the detailed employment object
                    let finalEmploymentDetails = userEmploymentDetails;

                    // If no user details found, or if we want to fill gaps from onboarding
                    if (!finalEmploymentDetails && onboarding) {
                        const empDetails = onboarding?.employmentDetails || {};
                        const hr = onboarding?.formData?.hrInfo || {};

                        finalEmploymentDetails = {
                            jobTitle: empDetails.jobTitle || hr.position || '',
                            department: empDetails.department || hr.department || '',
                            employmentType: empDetails.employmentType || hr.employmentType || '',
                            primaryWorkLocation: empDetails.primaryWorkLocation || hr.primaryWorkLocation || '',
                            officeAddress: empDetails.officeAddress || '',
                            workPattern: empDetails.workPattern || '',
                            startDate: empDetails.startDate || hr.startDate || '',
                            probationPeriod: empDetails.probationPeriod || '',
                            probationEndDate: empDetails.probationEndDate || hr.probationEndDate || '',
                            annualSalary: hr.annualSalary || '',
                            payFrequency: hr.payFrequency || '',
                            benefits: hr.benefits || '',
                            adminNotes: hr.notes || ''
                        };
                    } else if (finalEmploymentDetails && onboarding) {
                        // Merge missing fields from onboarding if user details incomplete
                        const empDetails = onboarding?.employmentDetails || {};
                        const hr = onboarding?.formData?.hrInfo || {};

                        if (!finalEmploymentDetails.startDate) finalEmploymentDetails.startDate = empDetails.startDate || hr.startDate || '';
                        if (!finalEmploymentDetails.employmentType) finalEmploymentDetails.employmentType = empDetails.employmentType || hr.employmentType || '';
                        if (!finalEmploymentDetails.jobTitle) finalEmploymentDetails.jobTitle = empDetails.jobTitle || hr.position || '';
                    }

                    // Helper to safely parse date
                    const getSafeDate = (val) => {
                        if (!val) return '';

                        // Use safe date parsing utility
                        const parsedDate = safeParseDate(val);
                        if (parsedDate && !isNaN(parsedDate.getTime())) {
                            return parsedDate.toISOString().split('T')[0];
                        }

                        return '';
                    };

                    // Helper to normalize dropdown values
                    const normalizeValue = (val, type) => {
                        if (!val) return '';
                        const normalized = val.toString().trim().toLowerCase();

                        // Log normalization attempts for debugging
                        // console.log(`[HR Onboarding] Normalizing ${type}: "${val}" -> "${normalized}"`);

                        if (type === 'employmentType') {
                            if (normalized.includes('full') && normalized.includes('time')) return 'Full-Time';
                            if (normalized.includes('part') && normalized.includes('time')) return 'Part-Time';
                            if (normalized.includes('contract')) return 'Contract';
                            if (normalized.includes('intern')) return 'Intern';
                            if (normalized.includes('temp')) return 'Temporary';
                        }

                        if (type === 'workPattern') {
                            if (normalized.includes('office')) return 'Office-Based';
                            if (normalized.includes('remote')) return 'Remote';
                            if (normalized.includes('hybrid')) return 'Hybrid';
                            if (normalized.includes('flexible')) return 'Flexible';
                        }

                        if (type === 'probationPeriod') {
                            // Handle simple numeric strings "3", "6" -> "3 Months"
                            if (normalized === '1' || (normalized.includes('1') && normalized.includes('month'))) return '1 Month';
                            if (normalized === '2' || (normalized.includes('2') && normalized.includes('month'))) return '2 Months';
                            if (normalized === '3' || (normalized.includes('3') && normalized.includes('month'))) return '3 Months';
                            if (normalized.includes('6') && normalized.includes('month')) return '6 Months'; // "6" check might be risky if "16"? Stick to exact match or "X months"
                            if (normalized === '6') return '6 Months';
                            if (normalized === '12' || (normalized.includes('12') && normalized.includes('month'))) return '12 Months';
                        }

                        if (type === 'payFrequency') {
                            if (normalized === 'monthly') return 'Monthly';
                            if (normalized === 'weekly') return 'Weekly';
                            if (normalized === 'bi-weekly' || normalized === 'biweekly') return 'Bi-Weekly';
                            if (normalized === 'annually' || normalized === 'annual') return 'Annually';
                        }

                        return val; // Return original if no match
                    };

                    // 4. Update state (merging with existing profile drafts)
                    // HR Profile Draft > User/Onboarding Data > Default

                    const draftFields = profile.sections?.employmentDetails?.fields || {};

                    // Pre-calculate and log these values
                    const fetchedStartDate = getSafeDate(finalEmploymentDetails?.startDate) || getSafeDate(userData?.startDate);
                    const rawEmploymentType = finalEmploymentDetails?.employmentType || userData?.employmentType || userData?.employmentDetails?.employmentType;
                    const fetchedEmploymentType = normalizeValue(rawEmploymentType, 'employmentType');

                    console.log('[HR Onboarding] Data population debug:', {
                        rawStartDate: finalEmploymentDetails?.startDate,
                        parsedStartDate: fetchedStartDate,
                        rawEmploymentType: rawEmploymentType,
                        normalizedEmploymentType: fetchedEmploymentType,
                        finalEmploymentDetails
                    });

                    setEmploymentData({
                        // Position Details
                        jobTitle: draftFields.jobTitle?.value || finalEmploymentDetails?.jobTitle || userData?.jobTitle || '',
                        department: draftFields.department?.value || finalEmploymentDetails?.department || userData?.department || '',
                        employmentType: normalizeValue(draftFields.employmentType?.value || fetchedEmploymentType, 'employmentType') || '',
                        startDate: getSafeDate(draftFields.startDate?.value || finalEmploymentDetails?.startDate || userData?.startDate) || '',
                        probationPeriod: normalizeValue(draftFields.probationPeriod?.value || finalEmploymentDetails?.probationPeriod, 'probationPeriod') || '',
                        // Work Location
                        primaryWorkLocation: draftFields.primaryWorkLocation?.value || finalEmploymentDetails?.primaryWorkLocation || userData?.primaryWorkLocation || '',
                        workPattern: normalizeValue(draftFields.workPattern?.value || finalEmploymentDetails?.workPattern, 'workPattern') || '',
                        officeAddress: draftFields.officeAddress?.value || finalEmploymentDetails?.officeAddress || '',

                        // Compensation
                        annualSalary: draftFields.annualSalary?.value || finalEmploymentDetails?.annualSalary || '',
                        payFrequency: normalizeValue(draftFields.payFrequency?.value || finalEmploymentDetails?.payFrequency, 'payFrequency') || '',
                        hourlyRate: draftFields.hourlyRate?.value || finalEmploymentDetails?.hourlyRate || '',
                        chargeRate: draftFields.chargeRate?.value || finalEmploymentDetails?.chargeRate || '',
                        benefits: draftFields.benefits?.value || finalEmploymentDetails?.benefits || '',
                        // Additional Notes
                        adminNotes: draftFields.adminNotes?.value || finalEmploymentDetails?.adminNotes || ''
                    });

                    // 5. Also sync personal info if available (keeping existing logic)
                    if (onboarding) {
                        const personalInfoData = onboarding.formData?.personalInfo || {};
                        const identificationData = onboarding.formData?.identification || {};
                        const completePersonalData = { ...personalInfoData, ...identificationData };

                        if (Object.keys(completePersonalData).length > 0) {
                            const { syncPersonalInfoToHRProfile } = await import('../../services/hrOnboarding');
                            // Only sync if profile is valid
                            if (profile.userId) {
                                await syncPersonalInfoToHRProfile(profile.userId, completePersonalData);
                            }
                        }
                    }

                } catch (error) {
                    console.error('[HR Onboarding] Error fetching detailed employment data:', error);
                }
            };

            fetchRobustEmploymentDetails();

            // Initialize allowances data
            if (profile.sections?.allowances?.allowances) {
                setAllowancesData(profile.sections.allowances.allowances);
            }
        }
    }, [profile]);

    const tabs = [
        { id: 'personalInfo', label: 'Personal Info', icon: CheckCircle },
        { id: 'employmentDetails', label: 'Employment', icon: CheckCircle },
        { id: 'contractDocuments', label: 'Documents', icon: Upload },
        { id: 'allowances', label: 'Allowances', icon: CheckCircle }
    ];

    const getTabStatus = (tabId) => {
        const section = localProfile.sections?.[tabId];
        if (!section) return 'pending';
        return section.status || 'pending';
    };

    const getStatusIcon = (status) => {
        if (status === 'completed') {
            return <CheckCircle className="h-4 w-4 text-green-500" />;
        }
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
    };

    // Personal Info Tab
    const renderPersonalInfoTab = () => {
        const fields = localProfile.sections?.personalInfo?.fields || {};

        // Define all personal info fields to display
        const personalInfoFields = [
            { key: 'firstName', label: 'First Name', required: true },
            { key: 'lastName', label: 'Last Name', required: true },
            { key: 'email', label: 'Email', required: true },
            { key: 'phone', label: 'Phone', required: true },
            { key: 'dateOfBirth', label: 'Date Of Birth', required: true },
            { key: 'gender', label: 'Gender', required: false },
            { key: 'maritalStatus', label: 'Marital Status', required: false },
            { key: 'nationality', label: 'Nationality', required: false },
            { key: 'addressLine1', label: 'Address Line 1', required: true },
            { key: 'city', label: 'City', required: true },
            { key: 'country', label: 'Country', required: true },
            { key: 'nationalInsurance', label: 'National Insurance', required: false },
            { key: 'passportNumber', label: 'Passport Number', required: false },
            { key: 'issuingCountry', label: 'Issuing Country', required: false },
            { key: 'passportExpiryDate', label: 'Passport Expiry Date', required: false },
            { key: 'rightToWorkStatus', label: 'Right To Work Status', required: false }
        ];

        return (
            <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <p className="text-sm text-blue-800">
                        <strong>Note:</strong> Personal information is filled by the employee. You can view the status here.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {personalInfoFields.map(({ key, label, required }) => {
                        const fieldData = fields[key] || {};
                        const isCompleted = fieldData.completed || Boolean(fieldData.value);
                        const value = fieldData.value || userData?.[key] || 'Not provided';

                        return (
                            <div key={key} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                                {isCompleted ? (
                                    <CheckCircle className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                                ) : (
                                    <AlertCircle className="h-5 w-5 text-yellow-500 mt-0.5 flex-shrink-0" />
                                )}
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-gray-700">
                                        {label}
                                        {required && <span className="text-red-500 ml-1">*</span>}
                                    </div>
                                    <div className="text-sm text-gray-600 break-words">{value}</div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    // Employment Details Tab
    const renderEmploymentDetailsTab = () => {
        const handleSaveEmployment = async () => {
            try {
                setIsSaving(true);

                // Create fields object
                const fields = {};
                Object.keys(employmentData).forEach(key => {
                    fields[key] = {
                        completed: Boolean(employmentData[key]),
                        value: employmentData[key],
                        required: true
                    };
                });

                // Check if all required fields are filled
                const allCompleted = Object.values(employmentData).every(v => Boolean(v));

                await updateHROnboardingSection({
                    profileId: localProfile.userId || localProfile.employeeId,
                    section: 'employmentDetails',
                    data: {
                        fields,
                        status: allCompleted ? 'completed' : 'pending'
                    },
                    updatedBy: user.uid
                });

                toast.success('Employment details saved successfully');

                // Refresh profile
                const updatedProfile = { ...localProfile };
                updatedProfile.sections.employmentDetails.fields = fields;
                updatedProfile.sections.employmentDetails.status = allCompleted ? 'completed' : 'pending';
                updatedProfile.completionPercent = calculateCompletionPercent(updatedProfile);
                setLocalProfile(updatedProfile);
            } catch (error) {
                console.error('Error saving employment details:', error);
                toast.error('Failed to save employment details');
            } finally {
                setIsSaving(false);
            }
        };

        return (
            <div className="space-y-6">
                {/* Position Details Section */}
                <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                    <h4 className="text-md font-semibold text-gray-900 mb-4">Position Details</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Job Title *
                            </label>
                            <input
                                type="text"
                                value={employmentData.jobTitle}
                                onChange={(e) => setEmploymentData({ ...employmentData, jobTitle: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                placeholder="e.g. Software Engineer"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Department
                            </label>
                            <input
                                type="text"
                                value={employmentData.department}
                                onChange={(e) => setEmploymentData({ ...employmentData, department: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                placeholder="e.g. Engineering"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Employment Type *
                            </label>
                            <select
                                value={employmentData.employmentType}
                                onChange={(e) => setEmploymentData({ ...employmentData, employmentType: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                            >
                                <option value="">Select Type</option>
                                <option value="Full-Time">Full-Time</option>
                                <option value="Part-Time">Part-Time</option>
                                <option value="Contract">Contract</option>
                                <option value="Temporary">Temporary</option>
                                <option value="Intern">Intern</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Start Date *
                            </label>
                            <input
                                type="date"
                                value={employmentData.startDate}
                                onChange={(e) => setEmploymentData({ ...employmentData, startDate: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Probation Period
                            </label>
                            <select
                                value={employmentData.probationPeriod}
                                onChange={(e) => setEmploymentData({ ...employmentData, probationPeriod: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                            >
                                <option value="">Select Period</option>
                                <option value="1 Month">1 Month</option>
                                <option value="2 Months">2 Months</option>
                                <option value="3 Months">3 Months</option>
                                <option value="6 Months">6 Months</option>
                                <option value="12 Months">12 Months</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Work Location Section */}
                <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                    <h4 className="text-md font-semibold text-gray-900 mb-4">Work Location</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Primary Location
                            </label>
                            <input
                                type="text"
                                value={employmentData.primaryWorkLocation}
                                onChange={(e) => setEmploymentData({ ...employmentData, primaryWorkLocation: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                placeholder="e.g. Main Office - Building A"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Work Pattern
                            </label>
                            <select
                                value={employmentData.workPattern}
                                onChange={(e) => setEmploymentData({ ...employmentData, workPattern: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                            >
                                <option value="">Select Pattern</option>
                                <option value="Office-Based">Office-Based</option>
                                <option value="Remote">Remote</option>
                                <option value="Hybrid">Hybrid</option>
                                <option value="Flexible">Flexible</option>
                            </select>
                        </div>

                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Office Address
                            </label>
                            <textarea
                                value={employmentData.officeAddress}
                                onChange={(e) => setEmploymentData({ ...employmentData, officeAddress: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                rows={3}
                                placeholder="Enter full office address"
                            />
                        </div>
                    </div>
                </div>



                {/* Compensation Section */}
                <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                    <h4 className="text-md font-semibold text-gray-900 mb-4">Compensation & Rates</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Annual Salary
                            </label>
                            <input
                                type="text"
                                value={employmentData.annualSalary}
                                onChange={(e) => setEmploymentData({ ...employmentData, annualSalary: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                placeholder="e.g. 45000"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Pay Frequency
                            </label>
                            <select
                                value={employmentData.payFrequency}
                                onChange={(e) => setEmploymentData({ ...employmentData, payFrequency: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                            >
                                <option value="">Select Frequency</option>
                                <option value="Monthly">Monthly</option>
                                <option value="Weekly">Weekly</option>
                                <option value="Bi-Weekly">Bi-Weekly</option>
                                <option value="Annually">Annually</option>
                            </select>
                        </div>

                        {/* Hidden as per user request
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Hourly Pay Rate (£)
                            </label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">£</span>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={employmentData.hourlyRate}
                                    onChange={(e) => setEmploymentData({ ...employmentData, hourlyRate: e.target.value })}
                                    className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    placeholder="0.00"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Charge Rate (£)
                            </label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">£</span>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={employmentData.chargeRate}
                                    onChange={(e) => setEmploymentData({ ...employmentData, chargeRate: e.target.value })}
                                    className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    placeholder="0.00"
                                />
                            </div>
                        </div>
                        */}

                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Benefits
                            </label>
                            <textarea
                                value={employmentData.benefits}
                                onChange={(e) => setEmploymentData({ ...employmentData, benefits: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                rows={3}
                                placeholder="List employee benefits..."
                            />
                        </div>
                    </div>
                </div>

                {/* Additional Notes Section */}
                <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                    <h4 className="text-md font-semibold text-gray-900 mb-4">Additional Notes</h4>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Admin Notes
                        </label>
                        <textarea
                            value={employmentData.adminNotes}
                            onChange={(e) => setEmploymentData({ ...employmentData, adminNotes: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                            rows={4}
                            placeholder="Enter any additional notes..."
                        />
                    </div>
                </div>

                <div className="flex justify-end pt-4">
                    <Button
                        onClick={handleSaveEmployment}
                        disabled={isSaving}
                        icon={isSaving ? Loader2 : Save}
                    >
                        {isSaving ? 'Saving...' : 'Save Employment Details'}
                    </Button>
                </div>
            </div>
        );
    };

    // Contract Documents Tab
    const renderContractDocumentsTab = () => {
        const documents = localProfile.sections?.contractDocuments?.documents || [];

        const handleUploadDocument = async (docIndex, file) => {
            try {
                setUploadingDocIndex(docIndex);

                const documentName = documents[docIndex].name;

                // Upload as a contract so employee can sign it
                const contractData = await uploadContract(
                    localProfile.userId,
                    file,
                    {
                        title: documentName,
                        type: documentName, // e.g., "Employment Contract", "Job Description", "NDA"
                        uploadedBy: user.uid,
                        uploadedByName: userData?.displayName || user.displayName || 'HR Manager'
                    }
                );

                // Also keep a reference in documents collection for HR tracking
                const result = await uploadDocument({
                    file,
                    userId: localProfile.userId,
                    documentType: DOCUMENT_TYPES.EMPLOYMENT,
                    category: DOCUMENT_CATEGORIES.CONTRACT,
                    description: documentName,
                    onboardingApplicationId: null
                });

                // Update the document in the profile
                const updatedDocuments = [...documents];
                updatedDocuments[docIndex] = {
                    ...updatedDocuments[docIndex],
                    uploaded: true,
                    uploadedBy: user.uid,
                    uploadedAt: new Date().toISOString(),
                    documentId: result.id,
                    contractId: contractData.id, // Store contract ID for reference
                    downloadURL: result.downloadURL
                };

                // Check if all required documents are uploaded
                const requiredDocs = updatedDocuments.filter(d => d.required);
                const allUploaded = requiredDocs.every(d => d.uploaded);

                await updateHROnboardingSection({
                    profileId: localProfile.userId || localProfile.employeeId,
                    section: 'contractDocuments',
                    data: {
                        documents: updatedDocuments,
                        status: allUploaded ? 'completed' : 'pending'
                    },
                    updatedBy: user.uid
                });

                toast.success(`${documentName} uploaded successfully and ready for employee signature`);

                // Update local state
                const updatedProfile = { ...localProfile };
                updatedProfile.sections.contractDocuments.documents = updatedDocuments;
                updatedProfile.sections.contractDocuments.status = allUploaded ? 'completed' : 'pending';
                updatedProfile.completionPercent = calculateCompletionPercent(updatedProfile);
                setLocalProfile(updatedProfile);
            } catch (error) {
                console.error('Error uploading document:', error);
                toast.error('Failed to upload document');
            } finally {
                setUploadingDocIndex(null);
            }
        };

        const handleDeleteDocument = async (docIndex) => {
            try {
                setIsLoading(true);

                // Update the document in the profile
                const updatedDocuments = [...documents];
                updatedDocuments[docIndex] = {
                    ...updatedDocuments[docIndex],
                    uploaded: false,
                    uploadedBy: null,
                    uploadedAt: null,
                    documentId: null,
                    contractId: null,
                    downloadURL: null
                };

                // Check if all required documents are uploaded
                const requiredDocs = updatedDocuments.filter(d => d.required);
                const allUploaded = requiredDocs.every(d => d.uploaded);

                await updateHROnboardingSection({
                    profileId: localProfile.userId || localProfile.employeeId,
                    section: 'contractDocuments',
                    data: {
                        documents: updatedDocuments,
                        status: allUploaded ? 'completed' : 'pending'
                    },
                    updatedBy: user.uid
                });

                toast.success('Document removed successfully');

                // Update local state
                const updatedProfile = { ...localProfile };
                updatedProfile.sections.contractDocuments.documents = updatedDocuments;
                updatedProfile.sections.contractDocuments.status = allUploaded ? 'completed' : 'pending';
                updatedProfile.completionPercent = calculateCompletionPercent(updatedProfile);
                setLocalProfile(updatedProfile);
            } catch (error) {
                console.error('Error deleting document:', error);
                toast.error('Failed to delete document');
            } finally {
                setIsLoading(false);
            }
        };

        return (
            <div className="space-y-4">
                {documents.map((doc, index) => (
                    <div key={doc.id} className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                {doc.uploaded ? (
                                    <CheckCircle className="h-5 w-5 text-green-500" />
                                ) : (
                                    <AlertCircle className="h-5 w-5 text-yellow-500" />
                                )}
                                <span className="font-medium text-gray-900">
                                    {doc.name}
                                    {doc.required && <span className="text-red-500 ml-1">*</span>}
                                </span>
                            </div>
                        </div>

                        {doc.uploaded ? (
                            <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                                <CheckCircle className="h-5 w-5 text-green-600" />
                                <div className="flex-1">
                                    <p className="text-sm font-medium text-green-900">Document uploaded successfully</p>
                                    <p className="text-xs text-green-700">Click below to view or download</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <a
                                        href={doc.downloadURL}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 text-sm font-medium"
                                    >
                                        <Download className="h-4 w-4" />
                                        View
                                    </a>
                                    <button
                                        onClick={() => handleDeleteDocument(index)}
                                        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2 text-sm font-medium"
                                        disabled={isLoading}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                        Remove
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="relative">
                                <input
                                    type="file"
                                    id={`file-upload-${index}`}
                                    onChange={(e) => {
                                        if (e.target.files[0]) {
                                            handleUploadDocument(index, e.target.files[0]);
                                        }
                                    }}
                                    className="hidden"
                                    accept=".pdf,.doc,.docx"
                                    disabled={uploadingDocIndex !== null}
                                />
                                <label
                                    htmlFor={`file-upload-${index}`}
                                    className={`flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-lg cursor-pointer transition-all ${uploadingDocIndex === index
                                        ? 'border-gray-300 bg-gray-50 cursor-not-allowed'
                                        : uploadingDocIndex !== null
                                            ? 'border-gray-200 bg-gray-50 cursor-not-allowed opacity-50'
                                            : 'border-purple-300 bg-purple-50 hover:bg-purple-100 hover:border-purple-400'
                                        }`}
                                >
                                    {uploadingDocIndex === index ? (
                                        <>
                                            <Loader2 className="h-10 w-10 text-purple-500 animate-spin mb-3" />
                                            <p className="text-sm font-medium text-gray-700">Uploading...</p>
                                            <p className="text-xs text-gray-500 mt-1">Please wait</p>
                                        </>
                                    ) : (
                                        <>
                                            <Upload className="h-10 w-10 text-purple-500 mb-3" />
                                            <p className="text-sm font-medium text-gray-700">Click to upload or drag and drop</p>
                                            <p className="text-xs text-gray-500 mt-1">PDF, DOC, or DOCX (Max 10MB)</p>
                                        </>
                                    )}
                                </label>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        );
    };

    // Allowances Tab
    const renderAllowancesTab = () => {
        const handleSaveAllowances = async () => {
            try {
                setIsSaving(true);

                // Check if all required allowances are set
                const requiredAllowances = allowancesData.filter(a => a.required);
                const allSet = requiredAllowances.every(a => a.set && a.amount);

                // Create actual allowance records using allowanceService
                const currentYear = new Date().getFullYear();
                const allowancesToCreate = allowancesData
                    .filter(a => a.set && a.amount)
                    .map(a => ({
                        type: a.type, // e.g., 'annual_leave', 'sick_leave'
                        leaveType: a.name, // e.g., 'Annual Leave', 'Sick Leave'
                        totalDays: parseInt(a.amount),
                        usedDays: 0,
                        remainingDays: parseInt(a.amount),
                        year: currentYear,
                        startDate: new Date(currentYear, 0, 1), // Jan 1st
                        endDate: new Date(currentYear, 11, 31), // Dec 31st
                        isAutomatic: false,
                        notes: `Created during HR onboarding`
                    }));

                if (allowancesToCreate.length > 0) {
                    // Create allowances using the service
                    await allowanceService.createAllowances(
                        localProfile.userId,
                        allowancesToCreate,
                        user
                    );
                }

                // Update HR onboarding profile
                await updateHROnboardingSection({
                    profileId: localProfile.userId || localProfile.employeeId,
                    section: 'allowances',
                    data: {
                        allowances: allowancesData,
                        status: allSet ? 'completed' : 'pending',
                        createdInSystem: allowancesToCreate.length > 0
                    },
                    updatedBy: user.uid
                });

                toast.success(`Allowances saved successfully${allowancesToCreate.length > 0 ? ' and created in system' : ''}`);

                // Update local state
                const updatedProfile = { ...localProfile };
                updatedProfile.sections.allowances.allowances = allowancesData;
                updatedProfile.sections.allowances.status = allSet ? 'completed' : 'pending';
                updatedProfile.completionPercent = calculateCompletionPercent(updatedProfile);
                setLocalProfile(updatedProfile);
            } catch (error) {
                console.error('Error saving allowances:', error);
                toast.error('Failed to save allowances');
            } finally {
                setIsSaving(false);
            }
        };

        const handleAllowanceChange = (index, field, value) => {
            const updated = [...allowancesData];
            updated[index] = {
                ...updated[index],
                [field]: value,
                set: field === 'amount' ? Boolean(value) : updated[index].set
            };
            setAllowancesData(updated);
        };

        const handleAddAllowance = () => {
            const newAllowance = {
                type: '', // Will be set by dropdown
                name: '', // Will be set by dropdown
                amount: '',
                unit: 'days',
                set: false,
                required: false,
                isCustom: true
            };
            setAllowancesData([...allowancesData, newAllowance]);
        };

        const handleRemoveAllowance = (index) => {
            const updated = allowancesData.filter((_, i) => i !== index);
            setAllowancesData(updated);
        };

        const handleAllowanceTypeChange = (index, selectedType) => {
            // Map of allowance types with their display names
            const allowanceTypes = {
                'annual_leave': 'Annual Leave',
                'sick_leave': 'Sick Leave',
                'maternity_leave': 'Maternity Leave',
                'paternity_leave': 'Paternity Leave',
                'authorised_absence_unpaid': 'Authorised Absence (Unpaid)',
                'authorised_absence_paid': 'Authorised Absence (Paid)'
            };

            const updated = [...allowancesData];
            updated[index] = {
                ...updated[index],
                type: selectedType,
                name: allowanceTypes[selectedType] || selectedType
            };
            setAllowancesData(updated);
        };

        return (
            <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                    <p className="text-sm text-blue-800">
                        <strong>Note:</strong> Annual Leave and Sick Leave are default allowances. You can add additional allowance types as needed.
                    </p>
                </div>

                {allowancesData.map((allowance, index) => (
                    <div key={`${allowance.type}-${index}`} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2 flex-1">
                                {allowance.set ? (
                                    <CheckCircle className="h-5 w-5 text-green-500" />
                                ) : (
                                    <AlertCircle className="h-5 w-5 text-yellow-500" />
                                )}
                                {allowance.isCustom ? (
                                    <select
                                        value={allowance.type}
                                        onChange={(e) => handleAllowanceTypeChange(index, e.target.value)}
                                        className="font-medium text-gray-900 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 flex-1"
                                    >
                                        <option value="">Select allowance type...</option>
                                        <option value="annual_leave">Annual Leave</option>
                                        <option value="sick_leave">Sick Leave</option>
                                        <option value="maternity_leave">Maternity Leave</option>
                                        <option value="paternity_leave">Paternity Leave</option>
                                        <option value="authorised_absence_unpaid">Authorised Absence (Unpaid)</option>
                                        <option value="authorised_absence_paid">Authorised Absence (Paid)</option>
                                    </select>
                                ) : (
                                    <span className="font-medium text-gray-900">
                                        {allowance.name}
                                        {allowance.required && <span className="text-red-500 ml-1">*</span>}
                                    </span>
                                )}
                            </div>
                            {allowance.isCustom && (
                                <button
                                    onClick={() => handleRemoveAllowance(index)}
                                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                    title="Remove allowance"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            )}
                        </div>

                        <div className="flex items-center gap-4">
                            <div className="flex-1">
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Amount
                                </label>
                                <input
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={allowance.amount || ''}
                                    onChange={(e) => handleAllowanceChange(index, 'amount', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    placeholder="Enter amount"
                                />
                            </div>
                            <div className="w-24">
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Unit
                                </label>
                                <input
                                    type="text"
                                    value={allowance.unit}
                                    disabled
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
                                />
                            </div>
                        </div>
                    </div>
                ))}

                <button
                    onClick={handleAddAllowance}
                    className="w-full px-4 py-3 border-2 border-dashed border-purple-300 rounded-lg text-purple-600 hover:bg-purple-50 hover:border-purple-400 transition-colors flex items-center justify-center gap-2 font-medium"
                >
                    <Plus className="h-5 w-5" />
                    Add Another Allowance Type
                </button>

                <div className="flex justify-end pt-4">
                    <Button
                        onClick={handleSaveAllowances}
                        disabled={isSaving}
                        icon={isSaving ? Loader2 : Save}
                    >
                        {isSaving ? 'Saving...' : 'Save Allowances'}
                    </Button>
                </div>
            </div>
        );
    };

    const renderTabContent = () => {
        switch (activeTab) {
            case 'personalInfo':
                return renderPersonalInfoTab();
            case 'employmentDetails':
                return renderEmploymentDetailsTab();
            case 'contractDocuments':
                return renderContractDocumentsTab();
            case 'allowances':
                return renderAllowancesTab();
            default:
                return null;
        }
    };

    const displayName = userData?.displayName || userData?.email || 'Unknown User';

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <div className="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-lg shadow-xl flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-200">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">{displayName} - HR Onboarding</h2>
                        <div className="flex items-center gap-4 mt-2">
                            <div className="text-sm text-gray-600">
                                Progress: <span className="font-semibold">{localProfile.completionPercent}%</span>
                            </div>
                            <div className="flex-1 bg-gray-200 rounded-full h-2 max-w-xs">
                                <div
                                    className="bg-purple-600 h-2 rounded-full transition-all"
                                    style={{ width: `${localProfile.completionPercent}%` }}
                                />
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <X className="h-5 w-5 text-gray-500" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-gray-200 px-6">
                    {tabs.map((tab) => {
                        const status = getTabStatus(tab.id);
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${activeTab === tab.id
                                    ? 'border-purple-600 text-purple-600'
                                    : 'border-transparent text-gray-600 hover:text-gray-900'
                                    }`}
                            >
                                {getStatusIcon(status)}
                                <span className="text-sm font-medium">{tab.label}</span>
                            </button>
                        );
                    })}
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {renderTabContent()}
                </div>
            </div>
        </div>
    );
};

export default HROnboardingDetailModal;
