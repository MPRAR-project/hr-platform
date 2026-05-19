import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { FileText, Download, User as UserIcon, RefreshCw, Filter, Menu, Calendar } from 'lucide-react';
import Loader from '../../components/ui/Loader';
import Header from '../../components/layout/Header';
import { useUI } from '../../hooks/useUI';
import { canEditTimesheets } from '../../utils/timesheetPermissions';
import { fetchWeekDetails, getTimesheetsByWeek, getUserTimesheetsByWeek } from '../../services/timesheets';
import { getUserById } from '../../services/users';
import { getManagedEmployeeIdsForManager } from '../../services/teams';
import hrApiClient from '../../lib/hrApiClient';
import wsClient from '../../lib/wsClient';

const TimesheetArchivePage = ({ isEmbedded = false }) => {
    const { user } = useAuth();
    const { openSidebar } = useUI();
    const [loading, setLoading] = useState(false);
    const [archives, setArchives] = useState([]);
    const [realtimeLoading, setRealtimeLoading] = useState(true);
    const [managedEmployeeIds, setManagedEmployeeIds] = useState(new Set());
    const [userCache, setUserCache] = useState({});

    // Generate last 18 months for tabs
    const months = useMemo(() => {
        const ms = [];
        const today = new Date();
        for (let i = 0; i < 18; i++) {
            const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            // Calculate start and end dates for query
            const start = new Date(d.getFullYear(), d.getMonth(), 1);
            const end = new Date(d.getFullYear(), d.getMonth() + 1, 0); // Last day of month

            // Format as YYYY-MM-DD for string comparison if 'period' is string, 
            // but we'll use string comparison assuming 'period' is "YYYY-MM-DD"
            const startStr = start.toISOString().split('T')[0];
            const endStr = end.toISOString().split('T')[0];

            ms.push({ id: key, label, date: d, startStr, endStr });
        }
        return ms;
    }, []);

    const [selectedMonthId, setSelectedMonthId] = useState(months[0].id);
    const [sortOrder, setSortOrder] = useState('newest'); // 'newest' | 'oldest'

    const isManager = canEditTimesheets(user?.role);
    const isHRAdvisor = user?.role === 'hrAdvisor';
    const isTeamManager = user?.role === 'teamManager';

    // Roles that can view Site/Company Hierarchy
    const HIERARCHY_ROLES = [
        'siteManager',
        'adminManager',
        'hrManager',
        'seniorManager',
        'adminAdvisor',
        'hrAdvisor',
        'superAdmin',
    ];
    const canViewHierarchy = HIERARCHY_ROLES.includes(user?.role);

    // Function to filter out superUser timesheets for HR advisors
    const filterTimesheetsForHRAdvisor = async (timesheets) => {
        if (!isHRAdvisor) return timesheets;

        const filteredTimesheets = [];
        const userIdsToCheck = new Set();

        // First pass: collect userIds from timesheets that aren't already cached
        timesheets.forEach(doc => {
            const data = doc.data();
            if (data.userId && !userCache[data.userId]) {
                userIdsToCheck.add(data.userId);
            }
        });

        // Fetch user roles for uncached userIds
        const newUserRolesMap = new Map();
        for (const userId of userIdsToCheck) {
            try {
                const userData = await getUserById(userId);
                if (userData) {
                    const userName = userData.displayName ||
                        `${userData.firstName || ''} ${userData.lastName || ''}`.trim() ||
                        userData.email ||
                        '';
                    // Cache both the name and role
                    setUserCache(prev => ({
                        ...prev,
                        [userId]: {
                            name: userName || 'Missing Name',
                            role: userData.role
                        }
                    }));
                    newUserRolesMap.set(userId, userData.role);
                }
            } catch (error) {
                // Failed to fetch user role for ${userId}
                // Cache the failed result
                setUserCache(prev => ({
                    ...prev,
                    [userId]: {
                        name: '',
                        role: null
                    }
                }));
            }
        }

        // Second pass: filter out superUser timesheets
        timesheets.forEach(doc => {
            const data = doc.data();
            const cachedUserData = userCache[data.userId];
            const userRole = cachedUserData?.role || newUserRolesMap.get(data.userId);

            // HR advisors cannot see superUser timesheets
            if (userRole === 'superUser') {
                // HR Advisor: Filtering out superUser timesheet for user ${data.userId}
                return;
            }

            filteredTimesheets.push(doc);
        });

        return filteredTimesheets;
    };

    // Fetch managed employee IDs for team managers
    useEffect(() => {
        const fetchManagedEmployees = async () => {
            if (isTeamManager && user?.userId && user?.companyId) {
                try {
                    const employeeIds = await getManagedEmployeeIdsForManager(
                        user.userId,
                        user.companyId.replace('companies/', '')
                    );
                    setManagedEmployeeIds(new Set(employeeIds));
                    // Team Manager ${user.userId} manages ${employeeIds.size} employees
                } catch (error) {
                    // Error fetching managed employees
                    setManagedEmployeeIds(new Set());
                }
            } else {
                setManagedEmployeeIds(new Set());
            }
        };

        fetchManagedEmployees();
    }, [isTeamManager, user?.userId, user?.companyId]);

    // Real-time listener setup via REST + WebSocket
    useEffect(() => {
        const loadData = async () => {
            if (!user || !selectedMonthId) return;

            setRealtimeLoading(true);
            const selectedMonth = months.find(m => m.id === selectedMonthId);
            if (!selectedMonth) {
                setRealtimeLoading(false);
                return;
            }

            try {
                let sheets = [];
                if (!isManager) {
                    // Employee: Only their own
                    sheets = await getUserTimesheetsByWeek(user.uid, user.companyId, selectedMonth.startStr);
                } else {
                    // Manager: Use the batch endpoint with status filter
                    const { data } = await hrApiClient.get('/hr/timesheets', {
                        params: {
                            status: 'approved',
                            companyId: user.companyId?.replace('companies/', ''),
                            startDate: selectedMonth.startStr,
                            endDate: selectedMonth.endStr
                        }
                    });
                    sheets = data.timesheets || data || [];
                }

                // Normalization is already handled by the service, but let's ensure consistency
                const parsedSheets = sheets.map(s => ({
                    ...s,
                    name: s.employee?.displayName || s.employeeName || s.name || '',
                    weekStartDate: new Date(s.weekStart || s.period || s.start),
                    approvalDate: s.approvedAt ? new Date(s.approvedAt) : null
                }));

                setArchives(parsedSheets);
            } catch (err) {
                console.error('[TimesheetArchivePage] Load error:', err);
            } finally {
                setRealtimeLoading(false);
            }
        };

        loadData();

        // WebSocket listener for updates
        const handleWsUpdate = () => loadData();
        wsClient.on('timesheet:updated', handleWsUpdate);

        return () => {
            wsClient.off('timesheet:updated', handleWsUpdate);
        };
    }, [user, selectedMonthId, isManager]);

    // Intermediate state logic removed as we now load directly into archives

    const fetchArchivesForMonth = async (monthId) => {
        // Manual refresh now just re-triggers the effect
        setSelectedMonthId(monthId);
    };

    const sortedArchives = useMemo(() => {
        return [...archives].sort((a, b) => {
            const dateA = a.weekStartDate instanceof Date ? a.weekStartDate : new Date(a.weekStartDate || a.start);
            const dateB = b.weekStartDate instanceof Date ? b.weekStartDate : new Date(b.weekStartDate || b.start);
            return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
        });
    }, [archives, sortOrder]);

    // Group by Employee for Manager View
    const employeeGroups = useMemo(() => {
        if (!isManager) return null;
        const groups = {};
        for (const doc of sortedArchives) {
            if (!groups[doc.userId]) {
                groups[doc.userId] = {
                    userId: doc.userId,
                    name: doc.name,
                    count: 0,
                    items: []
                };
            }
            groups[doc.userId].items.push(doc);
            groups[doc.userId].count++;
        }
        
        // Ensure each user's items are correctly ordered by week start
        Object.values(groups).forEach(group => {
            group.items.sort((a, b) => {
                const dateA = a.weekStartDate instanceof Date ? a.weekStartDate : new Date(a.weekStartDate || a.start);
                const dateB = b.weekStartDate instanceof Date ? b.weekStartDate : new Date(b.weekStartDate || b.start);
                return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
            });
        });

        // Sort groups by their boundary week (most recent or earliest) to maintain overall date order
        return Object.values(groups).sort((a, b) => {
            const aBoundary = sortOrder === 'newest'
                ? a.items[0]
                : a.items[a.items.length - 1];
            const bBoundary = sortOrder === 'newest'
                ? b.items[0]
                : b.items[b.items.length - 1];

            const dateA = aBoundary.weekStartDate instanceof Date ? aBoundary.weekStartDate : new Date(aBoundary.weekStartDate || aBoundary.start);
            const dateB = bBoundary.weekStartDate instanceof Date ? bBoundary.weekStartDate : new Date(bBoundary.weekStartDate || bBoundary.start);

            return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
        });
    }, [sortedArchives, isManager, sortOrder]);

    // Component for Employee Folder
    const EmployeeFolder = ({ group }) => {
        const [isOpen, setIsOpen] = useState(false);

        return (
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden mb-3">
                <div
                    onClick={() => setIsOpen(!isOpen)}
                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                >
                    <div className="flex items-center space-x-3">
                        <div className="p-2 bg-purple-100 rounded-lg">
                            <UserIcon className="w-5 h-5 text-purple-600" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-gray-900">{group.name}</h3>
                            <p className="text-xs text-gray-500">{group.count} timesheet{group.count !== 1 ? 's' : ''}</p>
                        </div>
                    </div>
                    <div className={`transform transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                    </div>
                </div>

                {isOpen && (
                    <div className="p-4 bg-gray-50 border-t border-gray-100 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {group.items.map(doc => (
                            <TimesheetCard key={doc.id} doc={doc} />
                        ))}
                    </div>
                )}
            </div>
        );
    };

    const TimesheetCard = ({ doc: summaryDoc }) => {
        const [isGenerating, setIsGenerating] = useState(false);

        const handleDownload = async (e) => {
            e.stopPropagation();
            if (isGenerating) return;

            try {
                setIsGenerating(true);
                // 1. Fetch full document which triggers auto-absence populating
                // The key fix here is getting the full detail data regardless of what's in the summary
                const fullData = await fetchWeekDetails(summaryDoc.userId, summaryDoc.start || summaryDoc.period);

                if (!fullData) {
                    alert("Timesheet data details could not be loaded.");
                    return;
                }

                const pdfOptions = {
                    dailyRows: fullData.entries,
                    weekStart: fullData.weekStart || summaryDoc.start || summaryDoc.period,
                    weekEnd: fullData.weekEnd || summaryDoc.end,
                    employeeName: summaryDoc.name || fullData.name || 'Employee',
                    timesheetId: summaryDoc.id || fullData.id,
                    status: summaryDoc.status || fullData.status,
                    headerTotals: fullData.totals || summaryDoc.totals,
                    approvedByName: summaryDoc.approvedByName || fullData.approvedByName,
                    approvedAt: summaryDoc.approvedAt || fullData.approvedAt,
                    customer: summaryDoc.customer || fullData.customer || '',
                    location: summaryDoc.location || fullData.location || '',
                    projectDetails: summaryDoc.workDetails || fullData.workDetails || ''
                };

                const { generateTimesheetPDF } = await import('../../services/timesheetPdfExport');
                await generateTimesheetPDF(fullData, fullData, pdfOptions);

            } catch (error) {
                console.error("PDF Generation failed:", error);
                alert(`Failed to generate PDF: ${error.message}`);
            } finally {
                setIsGenerating(false);
            }
        };

        return (
            <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm hover:border-purple-300 transition-all group">
                <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-3">
                        <div className="p-2 bg-blue-50 rounded-full">
                            <FileText className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                            <h3 className="font-medium text-gray-900 group-hover:text-purple-700">
                                {(() => {
                                    try {
                                        const weekStartBase = summaryDoc.weekStartDate || summaryDoc.start || summaryDoc.period;
                                        const weekStart = weekStartBase instanceof Date ? weekStartBase : new Date(weekStartBase);
                                        if (isNaN(weekStart.getTime())) {
                                            return 'Invalid Date';
                                        }
                                        // Calculate week end (6 days after start)
                                        const weekEnd = new Date(weekStart);
                                        weekEnd.setDate(weekStart.getDate() + 6);

                                        // Format: "Week of March 9-15, 2026"
                                        const startMonth = weekStart.toLocaleDateString('en-US', { month: 'short' });
                                        const startDay = weekStart.getDate();
                                        const endMonth = weekEnd.toLocaleDateString('en-US', { month: 'short' });
                                        const endDay = weekEnd.getDate();
                                        const year = weekStart.getFullYear();

                                        if (startMonth === endMonth) {
                                            return `Week of ${startMonth} ${startDay}-${endDay}, ${year}`;
                                        } else {
                                            return `Week of ${startMonth} ${startDay} - ${endMonth} ${endDay}, ${year}`;
                                        }
                                    } catch (error) {
                                        console.error('Date formatting error:', error);
                                        return 'Week of ' + (summaryDoc.period || 'Unknown Date');
                                    }
                                })()}
                            </h3>
                            {!isManager && (
                                <p className="text-xs text-gray-500">
                                    {summaryDoc.name || 'Me'}
                                </p>
                            )}
                        </div>
                    </div>

                    <button
                        onClick={handleDownload}
                        disabled={isGenerating}
                        className="p-2 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-full transition-colors disabled:opacity-50"
                        title="Download PDF"
                    >
                        {isGenerating ? (
                            <Loader size="sm" />
                        ) : (
                            <Download className="w-5 h-5" />
                        )}
                    </button>
                </div>

                <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                    <span>ID: {summaryDoc.id.slice(0, 8)}...</span>
                    <div className="flex items-center space-x-2">
                        <span>Appr: {summaryDoc.approvalDate ? new Date(summaryDoc.approvalDate).toLocaleDateString() : '-'}</span>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className={`flex flex-col h-full ${isEmbedded ? 'bg-transparent' : 'bg-gray-50'}`}>
            <div className={`p-1 border-b border-gray-200 shadow-sm ${isEmbedded ? 'bg-transparent border-0 shadow-none' : 'bg-white'}`}>

                {!isEmbedded && (
                    <Header
                        title="Timesheet Browser"
                        subtitle="Browse employee folders and download approved timesheet archives."
                        icon={Calendar}
                    />
                )}

                {/* Controls */}
                <div className="flex flex-wrap items-center justify-between gap-4 mb-6 px-4">
                    <div className="flex items-center space-x-4 text-sm">
                        <span className="font-medium text-gray-700">Order:</span>
                        <div className="flex rounded-md bg-gray-100 p-1">
                            <button
                                onClick={() => setSortOrder('newest')}
                                className={`px-3 py-1 rounded text-xs font-medium transition-all ${sortOrder === 'newest' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Newest
                            </button>
                            <button
                                onClick={() => setSortOrder('oldest')}
                                className={`px-3 py-1 rounded text-xs font-medium transition-all ${sortOrder === 'oldest' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Oldest
                            </button>
                        </div>
                    </div>
                </div>

                {/* Month Tabs - Horizontal Scroll */}
                <div className="border-b border-gray-200 w-full overflow-x-auto scrollbar-hide">
                    <div className="flex space-x-2 p-2 min-w-max">
                        {months.map(month => (
                            <button
                                key={month.id}
                                onClick={() => setSelectedMonthId(month.id)}
                                className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${selectedMonthId === month.id
                                    ? 'bg-purple-600 text-white shadow-md'
                                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 hover:border-purple-200'
                                    }`}
                            >
                                {month.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="flex-1 p-6 overflow-y-auto">
                <div className="mb-6 flex justify-between items-end">
                    <div>
                        <div className="flex items-center space-x-2">
                            <h2 className="text-lg font-bold text-gray-800">
                                {months.find(m => m.id === selectedMonthId)?.label}
                            </h2>
                            <span className="text-xs text-gray-400 border border-gray-200 px-2 py-0.5 rounded-full">
                                {months.find(m => m.id === selectedMonthId)?.startStr} - {months.find(m => m.id === selectedMonthId)?.endStr}
                            </span>
                        </div>

                        <p className="text-sm text-gray-500">
                            Viewing approved timesheets for this specific month range.
                        </p>
                    </div>
                    <div className="text-sm text-gray-500 bg-white px-3 py-1 rounded-full border border-gray-200">
                        Total: <strong>{archives.length}</strong>
                    </div>
                </div>

                {loading || realtimeLoading ? (
                    <div className="flex flex-col justify-center items-center py-20">
                        <Loader size="lg" />
                        <p className="mt-4 text-gray-500 animate-pulse">
                            {realtimeLoading ? 'Setting up real-time updates...' : 'Refreshing archives...'}
                        </p>
                    </div>
                ) : (
                    <div>
                        {archives.length === 0 ? (
                            <div className="py-20 text-center flex flex-col items-center">
                                <div className="bg-gray-100 p-4 rounded-full mb-4">
                                    <FileText className="w-8 h-8 text-gray-400" />
                                </div>
                                <h3 className="text-lg font-medium text-gray-900">No timesheets found</h3>
                                <p className="text-gray-500 mt-1 max-w-sm">
                                    There are no approved timesheets for {months.find(m => m.id === selectedMonthId)?.label}.
                                </p>
                            </div>
                        ) : isManager ? (
                            // Manager View: Group By Employee
                            <div className="space-y-4">
                                {employeeGroups.map(group => (
                                    <EmployeeFolder key={group.userId} group={group} />
                                ))}
                            </div>
                        ) : (
                            // Employee View: Flat Grid
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                {sortedArchives.map(doc => (
                                    <TimesheetCard key={doc.id} doc={doc} />
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default TimesheetArchivePage;

