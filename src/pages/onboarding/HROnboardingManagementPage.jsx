import React, { useState, useEffect, useMemo } from 'react';

import { Search, Filter, ChevronDown, Eye, Loader2 } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { getHROnboardingProfiles } from '../../services/hrOnboarding';
import { listInvites } from '../../services/invitations';
import hrApiClient from '../../lib/hrApiClient';
import HROnboardingDetailModal from '../../components/modals/HROnboardingDetailModal';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Header from '../../components/layout/Header';
import { useCache } from '../../contexts/CacheContext';
import { LoadingSkeleton } from '../../components/ui/LoadingSkeleton';

const HROnboardingManagementPage = () => {
    const { user } = useAuth();
    const [profiles, setProfiles] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [selectedProfile, setSelectedProfile] = useState(null);
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
    const [userDataMap, setUserDataMap] = useState({});

    // Cache & Pagination
    const { setItem, getItem } = useCache();
    // For HR Onboarding, we likely want to iterate through *all* profiles eventually, 
    // but for the initial view, proper pagination is key. 
    // However, the current UI is a single list. 
    // We will keep the current structure but optimize the *fetching* to be cache-first.

    // Load HR onboarding profiles and pending invites
    useEffect(() => {
        loadProfiles();
    }, [user?.companyId]);

    const loadProfiles = async () => {
        try {
            setError(null);

            if (!user?.companyId) {
                console.warn('Company ID not found');
                setIsLoading(false);
                return;
            }

            const cacheKey = `hr_onboarding_${user.companyId}`;

            // Try cache first
            const cachedData = getItem(cacheKey);
            if (Array.isArray(cachedData?.profiles)) {
                setProfiles(cachedData.profiles);
                setUserDataMap(cachedData.userDataMap || {});
                setIsLoading(false);
            } else {
                setIsLoading(true);
            }

            // 1. Fetch existing HR Profiles and Pending Invites in parallel
            const [profilesResult, invites] = await Promise.all([
                getHROnboardingProfiles({ limitCount: 100 }),
                listInvites()
            ]);

            // 2. Format Pending Invites
            const pendingInvites = invites
                .filter(inv => inv.status === 'pending' && inv.requiresHROnboarding)
                .map(inv => ({
                    id: `invite_${inv.id}`,
                    isInvite: true,
                    status: 'pending_signup',
                    completionPercent: 0,
                    userId: null,
                    createdAt: inv.createdAt,
                    userData: {
                        displayName: inv.displayName,
                        email: inv.email,
                        firstName: inv.firstName,
                        lastName: inv.lastName
                    }
                }));

            const apiProfiles = (profilesResult.applications || profilesResult.profiles || (Array.isArray(profilesResult) ? profilesResult : []))
                .map(p => {
                    const sections = p.sections || {
                        personalInfo: {
                            status: p.formData?.personalInfo?.status || (p.currentStep > 1 ? 'completed' : 'pending'),
                            fields: p.formData?.personalInfo?.fields || {}
                        },
                        employmentDetails: {
                            status: p.employmentDetails?.status || 'pending',
                            fields: p.employmentDetails?.fields || {}
                        },
                        contractDocuments: {
                            status: p.documentsStatus || (Array.isArray(p.documents) && p.documents.length > 0 ? 'completed' : 'pending'),
                            documents: Array.isArray(p.documents) ? p.documents : []
                        },
                        allowances: {
                            status: p.formData?.allowances?.status || 'pending',
                            allowances: p.formData?.allowances?.allowances || []
                        }
                    };

                    let completionPercent = p.completionPercent;
                    if (completionPercent === undefined) {
                        let totalWeight = 0;
                        let completedWeight = 0;
                        totalWeight += 25; if (sections.personalInfo?.status === 'completed') completedWeight += 25;
                        totalWeight += 25; if (sections.employmentDetails?.status === 'completed') completedWeight += 25;
                        totalWeight += 25; if (sections.contractDocuments?.status === 'completed') completedWeight += 25;
                        totalWeight += 25; if (sections.allowances?.status === 'completed') completedWeight += 25;
                        completionPercent = Math.round((completedWeight / totalWeight) * 100);
                    }

                    return {
                        ...p,
                        userId: p.employeeId || p.userId,
                        sections,
                        completionPercent
                    };
                });

            const allProfiles = [...pendingInvites, ...apiProfiles];
            setProfiles(allProfiles);

            // 3. Load user data for real profiles from the employee list (batch fetch)
            const { data: employeesData } = await hrApiClient.get('/hr/employees', {
                params: { limit: 1000 }
            });
            
            const employeeList = employeesData.employees || employeesData || [];
            const userMap = {};
            employeeList.forEach(emp => {
                userMap[emp.id] = emp;
            });

            setUserDataMap(userMap);

            // Store in cache
            setItem(cacheKey, {
                profiles: allProfiles,
                userDataMap: userMap
            }, 300000); // 5 minutes TTL

        } catch (err) {
            console.error('Error loading HR onboarding profiles:', err);
            setError(err.message || 'Failed to load HR onboarding profiles');
        } finally {
            setIsLoading(false);
        }
    };

    const filteredProfiles = useMemo(() => {
        let filtered = [...profiles];

        // Apply status filter
        if (statusFilter !== 'all') {
            filtered = filtered.filter(p => p.status === statusFilter);
        }

        // Apply search filter
        if (searchTerm) {
            const searchLower = searchTerm.toLowerCase();
            filtered = filtered.filter(profile => {
                const userData = profile.isInvite ? profile.userData : userDataMap[profile.userId];
                if (!userData) return false;

                const displayName = (userData.displayName || '').toLowerCase();
                const email = (userData.email || '').toLowerCase();
                const firstName = (userData.firstName || '').toLowerCase();
                const lastName = (userData.lastName || '').toLowerCase();

                return (
                    displayName.includes(searchLower) ||
                    email.includes(searchLower) ||
                    firstName.includes(searchLower) ||
                    lastName.includes(searchLower)
                );
            });
        }

        return filtered;
    }, [profiles, searchTerm, statusFilter, userDataMap]);

    const handleViewDetails = (profile) => {
        if (profile.isInvite) return; // Cannot view details for pending invites
        setSelectedProfile(profile);
        setIsDetailModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsDetailModalOpen(false);
        setSelectedProfile(null);
    };

    const getStatusBadge = (status) => {
        const statusConfig = {
            pending_signup: { variant: 'warning', label: 'Invite Pending' },
            pending: { variant: 'warning', label: 'Pending' },
            in_progress: { variant: 'info', label: 'In Progress' },
            completed: { variant: 'success', label: 'Completed' }
        };

        const config = statusConfig[status] || statusConfig.pending;
        return <Badge variant={config.variant}>{config.label}</Badge>;
    };

    const getProgressColor = (percent) => {
        if (percent === 100) return 'bg-green-500';
        if (percent >= 50) return 'bg-blue-500';
        if (percent > 0) return 'bg-yellow-500';
        return 'bg-gray-300';
    };

    if (error && !profiles.length) {
        return (
            <div className="h-screen flex flex-col overflow-hidden">
                <Header title="HR Onboarding Management" subtitle="Track and manage employee onboarding progress" />
                <div className="flex items-center justify-center flex-1 p-6">
                    <div className="text-center">
                        <p className="text-red-600 mb-4">{error}</p>
                        <Button onClick={loadProfiles}>Retry</Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-screen flex flex-col overflow-hidden">

            <Header
                title={"HR Onboarding Management"}
                subtitle={"Track and manage employee onboarding progress"}
            />
            <div className='p-6'>


                {/* Filters and Search */}
                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 mb-6">
                    <div className="flex flex-col md:flex-row gap-4">
                        {/* Search */}
                        <div className="flex-1 relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search by name or email..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                id="onboarding-search"
                                aria-label="Search profiles"
                                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                            />
                        </div>

                        {/* Status Filter */}
                        <div className="relative">
                            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                id="status-filter"
                                aria-label="Filter by status"
                                className="pl-10 w-full pr-10 py-2 border border-gray-300 rounded-lg appearance-none focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
                            >
                                <option value="all">All Status</option>
                                <option value="pending_signup">Invite Pending</option>
                                <option value="pending">Pending</option>
                                <option value="in_progress">In Progress</option>
                                <option value="completed">Completed</option>
                            </select>
                            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                        </div>
                    </div>
                </div>

                {/* Employee List */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                    {isLoading && !profiles.length ? (
                        <div className="p-6 space-y-4">
                            {[1, 2, 3, 4, 5].map((i) => (
                                <div key={i} className="flex items-center gap-4 py-3 border-b border-gray-100 animate-pulse">
                                    <LoadingSkeleton height="h-4" width="w-32" />
                                    <LoadingSkeleton height="h-4" width="w-24" />
                                    <LoadingSkeleton height="h-2" width="w-48" className="rounded-full" />
                                    <LoadingSkeleton height="h-8" width="w-24" className="rounded ml-auto" />
                                </div>
                            ))}
                        </div>
                    ) : filteredProfiles.length === 0 ? (
                        <div className="p-8 text-center text-gray-500">
                            {searchTerm || statusFilter !== 'all'
                                ? 'No employees found matching your filters'
                                : 'No employees in HR onboarding system'}
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-gray-50 border-b border-gray-200">
                                    <tr key="header-row">
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Employee
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Status
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Progress
                                        </th>
                                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Actions
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {filteredProfiles.map((profile) => {
                                        const userData = profile.isInvite ? profile.userData : (userDataMap[profile.userId] || {});
                                        const displayName = userData.displayName ||
                                            `${userData.firstName || ''} ${userData.lastName || ''}`.trim() ||
                                            userData.email ||
                                            '';

                                        // Skip unidentified users in the list
                                        if (!displayName || displayName === 'Unknown User') return null;

                                        const email = userData.email || '';

                                        return (
                                            <tr key={profile.id} className="hover:bg-gray-50 transition-colors">
                                                <td className="px-6 py-4">
                                                    <div>
                                                        <div className="text-sm font-medium text-gray-900">
                                                            {displayName}
                                                        </div>
                                                        <div className="text-sm text-gray-500">{email}</div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    {getStatusBadge(profile.status)}
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex-1 bg-gray-200 rounded-full h-2 max-w-[200px]">
                                                            <div
                                                                className={`h-2 rounded-full transition-all ${getProgressColor(profile.completionPercent)}`}
                                                                style={{ width: `${profile.completionPercent}%` }}
                                                            />
                                                        </div>
                                                        <span className="text-sm font-medium text-gray-700 min-w-[45px]">
                                                            {profile.completionPercent}%
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <Button
                                                        onClick={() => handleViewDetails(profile)}
                                                        variant="outline-primary"
                                                        size="sm"
                                                        icon={Eye}
                                                        disabled={profile.isInvite}
                                                        title={profile.isInvite ? "User must complete sign up first" : "View Details"}
                                                        aria-label={`View details for ${displayName}`}
                                                    >
                                                        View Details
                                                    </Button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            {/* Detail Modal */}
            {isDetailModalOpen && selectedProfile && (
                <HROnboardingDetailModal
                    isOpen={isDetailModalOpen}
                    onClose={handleCloseModal}
                    profile={selectedProfile}
                    userData={userDataMap[selectedProfile.userId]}
                />
            )}
        </div>
    );
};

export default HROnboardingManagementPage;
