import React, { useEffect, useState } from 'react';
import { User, Briefcase, Users, Calendar } from 'lucide-react';
import Header from '../../components/layout/Header';
import Badge from '../../components/ui/Badge';
import Tabs from '../../components/ui/Tabs';
import ProfilePictureUpload from './components/ProfilePictureUpload';
import { PersonalTab } from './components/PersonalTab';
import { ContractTab } from './components/ContractTab';
import { AllowancesTab } from './components/AllowanceTab';
import { OnboardingTab } from './components/OnboardingTab';
import { DocumentsTab } from './components/DocumentTab';
import { TrainingTab } from './components/TrainingTab';
import { TimesheetTab } from './components/TimesheetTab';
import { AbsencesTab } from './components/AbsenceTab';
import { useAuth } from '../../hooks/useAuth';
import { getCompanyPlugins } from '../../services/companyManagementService';
import { getUserById } from '../../services/users';
import { getHROnboardingProfile } from '../../services/hrOnboarding';
import hrApiClient from '../../lib/hrApiClient';
import wsClient from '../../lib/wsClient';

// Cache for profile data
const profileCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

const ProfilePage = () => {
    const [activeTab, setActiveTab] = useState('Personal');
    const { user } = useAuth();
    const [isLoading, setIsLoading] = useState(false);
    const [userDocData, setUserDocData] = useState(null);
    const [onboardingData, setOnboardingData] = useState(null);
    const [isLoadingOnboarding, setIsLoadingOnboarding] = useState(false);
    const [userPrifileImage, setUserPrifileImage] = useState(null);
    const [hasAbsencePlugin, setHasAbsencePlugin] = useState(true);
    const [selectedLeaveType, setSelectedLeaveType] = useState('all');

    // Derive personalData from userDocData and onboardingData
    const personalData = React.useMemo(() => {
        const udata = userDocData || {};
        const onboarding = onboardingData;
        const pi = onboarding?.stepData?.personalInfo || {};
        const idf = onboarding?.stepData?.identification || {};

        const display = udata.displayName || `${udata.firstName || ''} ${udata.lastName || ''}`.trim() || pi.preferredName || `${pi.firstName || ''} ${pi.lastName || ''}`.trim() || user?.email || '';

        return {
            basic: {
                'Full Name': display,
                'Email': udata.email || pi.email || user?.email || '',
                'Phone': udata.phone || pi.phone || '',
                'Date Of Birth': udata.dateOfBirth || pi.dateOfBirth || '',
                'Gender': udata.gender || pi.gender || '',
                'Marital Status': udata.maritalStatus || pi.maritalStatus || '',
                'Nationality': udata.nationality || pi.nationality || '',
                'Address': udata.address?.raw || [pi.addressLine1, pi.addressLine2, pi.city, pi.country].filter(Boolean).join(', ') || '—'
            },
            identification: {
                'National Insurance': udata.nationalInsurance || idf.nationalInsurance || '',
                'Tax Code': udata.taxCode || '',
                'Passport Number': udata.passportNumber || idf.passportNumber || '',
                'Issuing Country': udata.issuingCountry || idf.issuingCountry || '',
                'Passport Expiry Date': udata.passportExpiry || idf.passportExpiry || '',
                'Right To Work Status': udata.rightToWork || idf.rightToWork || '',
                'Name': udata.emergencyContactName || idf.emergencyContactName || '',
                'Relationship': udata.emergencyRelationship || idf.emergencyRelationship || '',
                'Phone': udata.emergencyPhone || idf.emergencyPhone || '',
                'Email': udata.emergencyEmail || idf.emergencyEmail || '',
                'Address': udata.emergencyAddress || idf.emergencyAddress || ''
            }
        };
    }, [userDocData, onboardingData, user?.email]);

    // Tab configuration based on user role
    const allTabOptions = [
        { label: 'Personal', allowedRoles: ['all'] },
        { label: 'Contracts', allowedRoles: ['all'] },
        { label: 'Allowances', allowedRoles: ['all'] },
        { label: 'Onboarding', allowedRoles: ['all'] },
        { label: 'Documents', allowedRoles: ['all'] },
        { label: 'Training', allowedRoles: ['all'] },
        { label: 'Timesheets', allowedRoles: ['all'] },
        { label: 'Absences', allowedRoles: ['all'] }
    ];

    const userRole = user?.role || 'employee';
    const tabOptions = allTabOptions.filter(tab => {
        const isAllowed = tab.allowedRoles.includes('all') || tab.allowedRoles.includes(userRole);
        if (!isAllowed) return false;

        // Hide absence related tabs if plugin is disabled
        if (!hasAbsencePlugin && (tab.label === 'Allowances' || tab.label === 'Absences')) {
            return false;
        }

        return true;
    });

    // Optimized function to fetch onboarding data
    const fetchOnboardingData = async (userId) => {
        const cacheKey = `onboarding_${userId}`;
        const cachedData = profileCache.get(cacheKey);

        if (cachedData && (Date.now() - cachedData.timestamp) < CACHE_DURATION) {
            return cachedData.data;
        }

        try {
            const onboarding = await getHROnboardingProfile(userId);

            // Cache the result
            profileCache.set(cacheKey, {
                data: onboarding,
                timestamp: Date.now()
            });

            return onboarding;
        } catch (error) {
            console.error('Error fetching onboarding data:', error);
            return null;
        }
    };

    // Real-time listeners for automatic updates
    useEffect(() => {
        if (!user?.uid) return;

        console.log('[ProfilePage] Setting up real-time listeners for user:', user.userId);
        setIsLoading(true);

        // 1. Initial fetch for user document
        const fetchUser = async () => {
            try {
                const { data } = await hrApiClient.get('/hr/employees/me');
                setUserDocData(data);
                setUserPrifileImage(data.profilePictureUrl || data.profileImage || null);
                setIsLoading(false);
            } catch (error) {
                console.error('[ProfilePage] Error fetching user data:', error);
                setIsLoading(false);
            }
        };

        fetchUser();

        // 1.1 Check for absence plugin
        if (user?.companyId) {
            getCompanyPlugins(user.companyId).then(plugins => {
                setHasAbsencePlugin(plugins.absence !== false);
            }).catch(e => {
                console.warn('[ProfilePage] Failed to fetch company plugins:', e);
            });
        }

        // 2. Initial fetch for onboarding applications
        const fetchOnboarding = async () => {
            const data = await fetchOnboardingData(user.userId);
            setOnboardingData(data);
        };

        fetchOnboarding();

        // 3. Setup WebSocket listener for real-time updates
        const handleUpdate = () => {
            fetchUser();
            fetchOnboarding();
        };

        wsClient.on('user:updated', handleUpdate);
        wsClient.on('onboarding:updated', handleUpdate);

        // Cleanup function
        return () => {
            wsClient.off('user:updated', handleUpdate);
            wsClient.off('onboarding:updated', handleUpdate);
        };
    }, [user?.uid]);

    // Handle photo update
    const handlePhotoUpdate = (newPrifileImage) => {
        setUserPrifileImage(newPrifileImage);
    };

    // Reload onboarding data after update
    const reloadOnboardingData = async () => {
        try {
            if (!user?.uid) return;
            setIsLoadingOnboarding(true);

            // Clear cache and fetch fresh data
            profileCache.delete(`onboarding_${user.userId}`);
            const onboarding = await fetchOnboardingData(user.userId, user.email);

            const onboardingDataResult = onboarding ? {
                ...onboarding,
                userId: user.userId
            } : null;

            setOnboardingData(onboardingDataResult);
        } catch (error) {
            console.error('Error reloading onboarding data:', error);
        } finally {
            setIsLoadingOnboarding(false);
        }
    };

    // Reload personal data after update
    // Accepts optional updatedData for optimistic UI updates
    const reloadPersonalData = async (updatedData = null) => {
        try {
            if (!user?.uid) return;

            // Optimistic update: if updatedData provided, use it to update udata state
            if (updatedData) {
                // We could derive the udata from updatedData if needed, 
                // but usually the listener will fire immediately since we just saved.
                // For a faster response, we can fetch once
            }

            setIsLoading(true);

            // Clear cache and reload
            profileCache.delete(`profile_${user.userId}`);

            // Reload user document
            const { data } = await hrApiClient.get('/hr/employees/me');
            setUserDocData(data);
            setUserPrifileImage(data.profilePictureUrl || data.profileImage || null);
        } catch (error) {
            console.error('Error reloading personal data:', error);
        } finally {
            setIsLoading(false);
        }
    };

    // Render active tab content
    const renderTabContent = () => {
        switch (activeTab) {
            case 'Personal':
                return <PersonalTab data={personalData} isLoading={isLoading} onUpdate={reloadPersonalData} onboardingData={onboardingData} isLoadingOnboarding={isLoadingOnboarding} onUpdateOnboarding={reloadOnboardingData} />;
            case 'Contracts':
                return <ContractTab userId={user?.uid} allowUpload={false} />;
            case 'Allowances':
                return <AllowancesTab selectedLeaveType={selectedLeaveType} onLeaveTypeChange={setSelectedLeaveType} />;
            case 'Onboarding':
                return <OnboardingTab onboardingData={onboardingData} isLoading={isLoadingOnboarding} onUpdate={reloadOnboardingData} />;
            case 'Documents':
                return <DocumentsTab />;
            case 'Training':
                return <TrainingTab />;
            case 'Timesheets':
                return <TimesheetTab />;
            case 'Absences':
                return <AbsencesTab />;
            default:
                return <PersonalTab data={personalData} isLoading={isLoading} onUpdate={reloadPersonalData} onboardingData={onboardingData} isLoadingOnboarding={isLoadingOnboarding} onUpdateOnboarding={reloadOnboardingData} />;
        }
    };

    const pretty = (role = '') =>
        role.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());


    return (
        <div>
            <Header
                title={`${pretty(user?.role || 'employee')} Dashboard`}
                subtitle="Ensure compliance and manage onboarding from one place."
            />

            <div className="flex-1 overflow-y-auto sm:p-3xl space-y-3xl scrollbar-custom">
                {/* User Info Card */}
                <div className="bg-bg-accent-purple-light mx-2 border-2 border-border-accent-purple rounded-base py-4 sm:p-4xl">
                    <div className="flex sm:flex-row flex-col gap-4 items-center justify-between">
                        <div className="flex items-center gap-4xl">
                            {/* Profile Picture with Upload */}
                            <ProfilePictureUpload
                                userId={user?.uid}
                                currentPrifileImage={userPrifileImage}
                                userName={personalData.basic?.['Full Name'] || user.displayName || user.email}
                                onPhotoUpdate={handlePhotoUpdate}
                            />

                            {/* User Details */}
                            <div>
                                <h2 className="text-2xl font-bold text-text-primary mb-md">
                                    {personalData.basic?.['Full Name'] || user.displayName || user.email}
                                </h2>
                                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3xl text-sm">
                                    <span className="flex items-center gap-xs text-orange-600">
                                        <Briefcase className="h-4 w-4" />
                                        {user.department || '—'}
                                    </span>
                                    <span className="flex items-center gap-xs text-blue-600">
                                        <Users className="h-4 w-4" />
                                        Hired: {user.hiredDate || '—'}
                                    </span>
                                    <span className="flex items-center gap-xs text-green-600">
                                        <Calendar className="h-4 w-4" />
                                        Employee ID: {user.employeeId || user.userId}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Role Badge */}
                        <Badge variant="success">{pretty(user?.role || 'employee')}</Badge>
                    </div>
                </div>

                {/* Tabs */}
                <div className="mt-3xl px-base">
                    <Tabs
                        tabs={tabOptions}
                        onTabChange={(selectedTab) => setActiveTab(selectedTab)}
                    />
                </div>

                {/* Tab Content */}
                <div className="mt-4xl">
                    {renderTabContent()}
                </div>
            </div>
        </div>
    );
}

export default ProfilePage;