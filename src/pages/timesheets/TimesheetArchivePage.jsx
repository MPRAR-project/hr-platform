
import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { db } from '../../firebase/client';
import { collection, query, where, orderBy, limit, doc, Timestamp, onSnapshot } from 'firebase/firestore';
import { FileText, Download, User as UserIcon, RefreshCw, Filter, Menu, Calendar } from 'lucide-react';
import Loader from '../../components/ui/Loader';
import Header from '../../components/layout/Header';
import { useUI } from '../../hooks/useUI';
import { canEditTimesheets } from '../../utils/timesheetPermissions';
import { fetchWeekDetails } from '../../services/timesheets';
import { getUserById } from '../../services/users';
import { getManagedEmployeeIdsForManager } from '../../services/teams';

const TimesheetArchivePage = ({ isEmbedded = false }) => {
    const { user } = useAuth();
    const { openSidebar } = useUI();
    const [loading, setLoading] = useState(false);
    const [archives, setArchives] = useState([]);
    const [realtimeLoading, setRealtimeLoading] = useState(true);
    const [managedEmployeeIds, setManagedEmployeeIds] = useState(new Set());

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
                    setManagedEmployeeIds(employeeIds);
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

    // Real-time listener setup using proper Firestore snapshot pattern
    useEffect(() => {
        let unsubscribes = [];

        const setupListeners = async () => {
            if (!user || !selectedMonthId) return;

            // Clear previous data when month changes
            setDocMap({});
            setRealtimeLoading(true);
            const selectedMonth = months.find(m => m.id === selectedMonthId);
            if (!selectedMonth) {
                setRealtimeLoading(false);
                return;
            }

            console.log(`TimesheetArchivePage: Setting up real-time listeners for ${selectedMonthId} (${selectedMonth.startStr} to ${selectedMonth.endStr})`);

            const timesheetsCol = collection(db, 'timesheets');
            const queries = [];

            if (!isManager) {
                // Employee: Only their own
                queries.push(query(timesheetsCol, where('userId', '==', user.uid)));
            } else if (isTeamManager) {
                // Team Manager: Only their team members
                if (managedEmployeeIds.size > 0) {
                    queries.push(query(timesheetsCol, where('userId', 'in', Array.from(managedEmployeeIds))));
                }
                // Also include their own timesheets
                queries.push(query(timesheetsCol, where('userId', '==', user.uid)));
            } else {
                // Other Managers (Site, Admin, HR, etc.) - Original logic
                // 1. Approved By Me
                queries.push(query(timesheetsCol, where('approvedBy', '==', user.uid)));

                // 2. Managed By Me
                queries.push(query(timesheetsCol, where('managerUserId', '==', user.uid)));

                // 3. My Own Timesheets
                queries.push(query(timesheetsCol, where('userId', '==', user.uid)));

                // 4. Hierarchy (Site/Company)
                if (canViewHierarchy) {
                    if (user.siteId) {
                        const sitePath = typeof user.siteId === 'string' ? user.siteId : (user.siteId.path || user.siteId.id);
                        const siteIdRaw = sitePath.split('/').pop();
                        const possibleSiteIds = [sitePath, siteIdRaw].filter(Boolean);

                        queries.push(query(timesheetsCol, where('siteId', 'in', possibleSiteIds)));
                        queries.push(query(timesheetsCol, where('siteIdPath', 'in', possibleSiteIds)));
                    }

                    if (user.companyId) {
                        const compPath = user.companyId;
                        const compIdRaw = compPath.split('/').pop();
                        const possibleCompIds = [compPath, compIdRaw].filter(Boolean);

                        queries.push(query(timesheetsCol, where('companyId', 'in', possibleCompIds)));
                    }

                    if (!user.siteId && !user.companyId) {
                        queries.push(query(timesheetsCol, limit(500)));
                    }
                }
            }

            // Attach Listeners
            queries.forEach(q => {
                const unsub = onSnapshot(q, (snap) => {
                    // Update a map of docs by ID for efficient merging
                    setDocMap(prev => {
                        const next = { ...prev };
                        snap.docChanges().forEach(change => {
                            const docData = change.doc.data();
                            
                            // Client-side filtering for approved status and date range
                            if (docData.status !== 'approved') return;
                            
                            const docPeriod = docData.period || (docData.start && typeof docData.start === 'string' ? docData.start : null);
                            if (!docPeriod) return;
                            
                            if (docPeriod < selectedMonth.startStr || docPeriod > selectedMonth.endStr) return;

                            if (change.type === 'removed') {
                                delete next[change.doc.id];
                            } else {
                                next[change.doc.id] = change.doc;
                            }
                        });
                        return next;
                    });
                });
                unsubscribes.push(unsub);
            });

            setRealtimeLoading(false);
        };

        setupListeners();

        return () => {
            unsubscribes.forEach(u => u());
        };
    }, [user, selectedMonthId, isManager, isTeamManager, managedEmployeeIds, canViewHierarchy]);

    // Intermediate state for raw docs and map (like ApprovalsPage pattern)
    const [docMap, setDocMap] = useState({});
    const [rawTimesheetDocs, setRawTimesheetDocs] = useState([]); // Derived from map

    // Update rawDocs when map changes
    useEffect(() => {
        const docs = Object.values(docMap);
        setRawTimesheetDocs(docs);
    }, [docMap]);

    // Process and update archives when raw docs change
    useEffect(() => {
        if (rawTimesheetDocs.length > 0) {
            processAndSetArchives(rawTimesheetDocs);
        } else {
            setArchives([]);
        }
    }, [rawTimesheetDocs]);

    // Process archives data (extracted for reuse)
    const processAndSetArchives = async (allDocs) => {
        // Apply HR advisor filter
        const filteredDocs = await filterTimesheetsForHRAdvisor(allDocs);

        // Deduplicate by ID (should already be unique due to docMap, but keeping for safety)
        const seen = new Set();
        const uniqueDocs = [];
        for (const d of filteredDocs) {
            if (!seen.has(d.id)) {
                seen.add(d.id);
                uniqueDocs.push(d);
            }
        }

        console.log("TimesheetArchivePage: Processing", uniqueDocs.length, "unique docs");

        // Parse Docs and fetch missing user information
        const parsedDocs = await Promise.all(uniqueDocs.map(async (d) => {
            const data = d.data();
            let userName = data.name || data.employeeName || data.displayName;

            // If user name is missing, fetch it from the users collection (with caching)
            if (!userName && data.userId) {
                // Check cache first
                const cachedUserData = userCache[data.userId];
                if (cachedUserData) {
                    userName = cachedUserData.name;
                } else {
                    try {
                        const userData = await getUserById(data.userId);
                        if (userData) {
                            userName = userData.displayName ||
                                `${userData.firstName || ''} ${userData.lastName || ''}`.trim() ||
                                userData.email ||
                                '';

                            // Cache the user name and role
                            setUserCache(prev => ({
                                ...prev,
                                [data.userId]: {
                                    name: userName || 'Missing Name',
                                    role: userData.role
                                }
                            }));
                        }
                    } catch (error) {
                        console.warn(`Failed to fetch user data for ${data.userId}:`, error);
                        userName = '';
                        // Cache the failed result
                        setUserCache(prev => ({
                            ...prev,
                            [data.userId]: {
                                name: '',
                                role: null
                            }
                        }));
                    }
                }
            }

            // Canonical week start date for all sorting (always a real Date)
            let weekStart;
            if (data.weekStartDate?.toDate) {
                weekStart = data.weekStartDate.toDate();
            } else if (typeof data.weekStartDate === 'string') {
                weekStart = new Date(data.weekStartDate);
            } else if (data.start?.toDate) {
                weekStart = data.start.toDate();
            } else if (typeof data.start === 'string') {
                weekStart = new Date(data.start);
            } else if (typeof data.period === 'string') {
                weekStart = new Date(data.period);
            } else {
                weekStart = new Date();
            }

            return {
                id: d.id,
                ...data,
                name: userName || '',
                start: weekStart,
                weekStartDate: weekStart,
                approvalDate: data.approvedAt?.toDate?.() || new Date()
            };
        }));

        // Filter out any entries where the user name is missing
        const filteredArchives = parsedDocs.filter(doc => doc.name && doc.name !== 'Unknown User' && doc.name !== 'Missing Name');

        setArchives(filteredArchives);
    };

    // Cache for user information to avoid repeated fetches (persistent across sessions)
    const [userCache, setUserCache] = useState(() => {
        try {
            const cached = localStorage.getItem('mprar_timesheet_user_cache');
            return cached ? JSON.parse(cached) : {};
        } catch (e) {
            return {};
        }
    });

    // Update localStorage when user cache changes
    useEffect(() => {
        try {
            localStorage.setItem('mprar_timesheet_user_cache', JSON.stringify(userCache));
        } catch (e) {
            console.warn('Failed to save user cache to localStorage:', e);
        }
    }, [userCache]);

    // Legacy fetch method (kept for manual refresh if needed)
    const fetchArchivesForMonth = async (monthId) => {
        if (!user) return;

        setLoading(true);
        setArchives([]); // Clear previous

        const selectedMonth = months.find(m => m.id === monthId);
        if (!selectedMonth) {
            setLoading(false);
            return;
        }

        console.log(`TimesheetArchivePage: Manual refresh for ${monthId} (${selectedMonth.startStr} to ${selectedMonth.endStr})`);

        try {
            const tsRef = collection(db, 'timesheets');
            let allDocs = [];

            // Helper to run query
            const runQuery = async (constraints, label) => {
                try {
                    const q = query(tsRef, ...constraints);
                    const snap = await getDocs(q);
                    console.log(`TimesheetArchivePage: Query [${label}] found ${snap.size} docs (pre-filter)`);

                    // Client-side Filtering
                    const filteredDocs = snap.docs.filter(doc => {
                        const data = doc.data();

                        // 1. Status Filter (Must be approved)
                        if (data.status !== 'approved') return false;

                        // 2. Date Filter
                        const docPeriod = data.period || (data.start && typeof data.start === 'string' ? data.start : null);
                        if (!docPeriod) return false;

                        return docPeriod >= selectedMonth.startStr && docPeriod <= selectedMonth.endStr;
                    });

                    console.log(`TimesheetArchivePage: Query [${label}] matches ${filteredDocs.length} approved docs in range`);
                    return filteredDocs;
                } catch (e) {
                    console.warn(`TimesheetArchivePage: Query [${label}] failed`, e);
                    if (e.code === 'failed-precondition') {
                        console.error(`Missing Index for [${label}]. URL:`, e.details);
                    }
                    return [];
                }
            };

            if (!isManager) {
                // Employee: Only their own
                const c = [where('userId', '==', user.uid)];
                allDocs = await runQuery(c, "Employee Own");
                allDocs = await filterTimesheetsForHRAdvisor(allDocs);
            } else if (isTeamManager) {
                // Team Manager: Only their team members
                const queries = [];
                
                if (managedEmployeeIds.size > 0) {
                    queries.push(runQuery([where('userId', 'in', Array.from(managedEmployeeIds))], "Team Members"));
                }
                // Also include their own timesheets
                queries.push(runQuery([where('userId', '==', user.uid)], "Own Timesheets"));
                
                const results = await Promise.all(queries);
                allDocs = results.flat();
            } else {
                // Other Managers (Site, Admin, HR, etc.) - Original logic
                const queries = [];

                // 1. Approved By Me
                queries.push(runQuery([where('approvedBy', '==', user.uid)], "Approved By Me"));

                // 2. Managed By Me
                queries.push(runQuery([where('managerUserId', '==', user.uid)], "Managed By Me"));

                // 3. My Own Timesheets
                queries.push(runQuery([where('userId', '==', user.uid)], "My Own Timesheets"));

                // 4. Hierarchy (Site/Company)
                if (canViewHierarchy) {
                    if (user.siteId) {
                        const sitePath = typeof user.siteId === 'string' ? user.siteId : (user.siteId.path || user.siteId.id);
                        const siteIdRaw = sitePath.split('/').pop();
                        const possibleSiteIds = [sitePath, siteIdRaw].filter(Boolean);

                        queries.push(runQuery([where('siteId', 'in', possibleSiteIds)], "Site Hierarchy (String)"));
                        queries.push(runQuery([where('siteIdPath', 'in', possibleSiteIds)], "Site Hierarchy (Path)"));
                    }

                    if (user.companyId) {
                        const compPath = user.companyId;
                        const compIdRaw = compPath.split('/').pop();
                        const possibleCompIds = [compPath, compIdRaw].filter(Boolean);

                        queries.push(runQuery([where('companyId', 'in', possibleCompIds)], "Company Hierarchy"));
                    }

                    if (!user.siteId && !user.companyId) {
                        queries.push(runQuery([limit(500)], "Unrestricted"));
                    }
                }

                const results = await Promise.all(queries);
                allDocs = results.flat();
            }

            await processAndSetArchives(allDocs);

        } catch (error) {
            console.error("Error fetching archives:", error);
        } finally {
            setLoading(false);
        }
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

