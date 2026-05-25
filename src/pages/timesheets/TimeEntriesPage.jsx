import { Calendar, Download, Search } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import Header from '../../components/layout/Header';
import { ManualTimeEntryModal } from '../../components/timesheets/ManualTimeEntryModal';
import EditTimeEntryModal from '../../components/timesheets/EditTimeEntryModal';
import EditTimesheetModal from '../../components/modals/EditTimesheetModal';
import Button from '../../components/ui/Button';
import Loader from '../../components/ui/Loader';
import Tabs from '../../components/ui/Tabs';
import { useAuth } from '../../hooks/useAuth';
import { deleteTimeEntry } from '../../services/timesheets';
import { useCanManageTimeEntries } from '../../hooks/useCanManageTimeEntries';
import { useMultipleUserSessions } from '../../hooks/useMultipleUserSessions';
import { getManagedEmployeeIdsForManager } from '../../services/teams';
import { addManualTimeEntry, getUserWeekContext, ensureWeeklyTimesheet } from '../../services/timesheets';
import { getClients } from '../../services/clients';
import { getSites } from '../../services/sites';
import eventBus, { WEEK_START_UPDATED } from '../../services/EventBus';
import { DEFAULT_WEEK_START_DAY, formatISODate, getWeekRangeForDate, normalizeWeekStartDay, getOrderedWeekDays } from '../../utils/weekStartUtils';
import { detectAndConvertToLocal } from '../../utils/timeDisplayUtils';
import { resolveRoundingRules } from '../../services/roundingRules';
import { buildExistingIntervalsForDate, getTimeEntryOverlapConflict } from '../../utils/timeValidation';
import TimeEntryRow from './components/TimeEntryRow';

const TimeEntriesPage = () => {
    const { user } = useAuth();
    const currentUserId = user?.userId || user?.uid || null;
    const [weekStartDay, setWeekStartDay] = useState(DEFAULT_WEEK_START_DAY);
    const [isWeekStartLoading, setIsWeekStartLoading] = useState(true);
    const [deletingEntryId, setDeletingEntryId] = useState(null);
    const [roundingRulesByUser, setRoundingRulesByUser] = useState({});


    // Always fetch week start from server when page loads so Settings changes apply without refresh (bypass cache)
    useEffect(() => {
        const loadWeekStartDay = async () => {
            if (!currentUserId) {
                if (user?.weekStartDay) {
                    setWeekStartDay(normalizeWeekStartDay(user.weekStartDay));
                }
                setIsWeekStartLoading(false);
                return;
            }
            try {
                // Get company data to fetch week start day from company settings
                const { getCompany } = await import('../../services/companyManagementService');
                const companyData = await getCompany(user.companyId);
                const companyWeekStartDay = companyData?.weekStartDay || DEFAULT_WEEK_START_DAY;


                const normalized = normalizeWeekStartDay(companyWeekStartDay);
                setWeekStartDay(normalized);
            } catch (error) {
                console.warn('[TimeEntriesPage] Failed to load week start day, using default:', error);
                if (user?.weekStartDay) {
                    setWeekStartDay(normalizeWeekStartDay(user.weekStartDay));
                } else {
                    setWeekStartDay(DEFAULT_WEEK_START_DAY);
                }
            } finally {
                setIsWeekStartLoading(false);
            }
        };
        loadWeekStartDay();
    }, [currentUserId, user?.weekStartDay, user?.companyId]);

    // Update week view without full refresh when Settings saves a new Week Starting day (same tab)
    useEffect(() => {
        const unsub = eventBus.on(WEEK_START_UPDATED, (payload, _eventType) => {
            const newDay = payload?.weekStartDay ? normalizeWeekStartDay(payload.weekStartDay) : null;
            if (!newDay) return;
            setWeekStartDay(newDay);
            const { start } = getWeekRangeForDate(new Date(), newDay);
            setSelectedWeekStart(start);
            setRefreshTrigger((t) => t + 1);
        }, 'TimeEntriesPage');
        return () => unsub();
    }, []);

    // When tab becomes visible, sync week start if it was updated in another tab (e.g. Settings)
    useEffect(() => {
        const onVisibilityChange = () => {
            if (document.visibilityState !== 'visible') return;
            try {
                if (!localStorage.getItem('mprar_weekStart_updated')) return;
            } catch (_) {
                return;
            }
            (async () => {
                try {
                    localStorage.removeItem('mprar_weekStart_updated');
                    if (!currentUserId) return;
                    const { weekStartDay: fresh } = await getUserWeekContext(currentUserId, { forceRefresh: true });
                    const normalized = normalizeWeekStartDay(fresh || DEFAULT_WEEK_START_DAY);
                    setWeekStartDay(normalized);
                    const { start } = getWeekRangeForDate(new Date(), normalized);
                    setSelectedWeekStart(start);
                    setRefreshTrigger((t) => t + 1);
                } catch (_) { }
            })();
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    }, [currentUserId]);

    // [NEW] Import Reconciler for Self-Healing
    useEffect(() => {
        // Dynamic import to avoid heavy load if not needed immediately
        import('../../services/timesheets').then(mod => {
            window.reconcileTimesheetForWeek = mod.reconcileTimesheetForWeek;
        });
    }, []);

    // Calculate current week's start day based on company setting
    const getCurrentWeekStart = useCallback(() => {
        const today = new Date();
        const { start } = getWeekRangeForDate(today, weekStartDay);
        // getCurrentWeekStart calculation:
        return start;
    }, [weekStartDay]);

    // Initialize as null to wait for weekStartDay to load
    const [selectedWeekStart, setSelectedWeekStart] = useState(null);
    const [accessibleUserIds, setAccessibleUserIds] = useState([]);
    const [users, setUsers] = useState({}); // userId -> user data
    const [isLoadingUsers, setIsLoadingUsers] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [refreshTrigger, setRefreshTrigger] = useState(0); // Used to force timesheet refetch
    const [isLoadingTimesheets, setIsLoadingTimesheets] = useState(false); // Loading state for timesheet entries

    // Client & Site Filter
    const [clients, setClients] = useState([]);
    const [selectedClientId, setSelectedClientId] = useState('');
    const [sites, setSites] = useState([]);
    const [selectedSiteId, setSelectedSiteId] = useState('');

    useEffect(() => {
        const loadFilters = async () => {
            if (user?.companyId) {
                try {
                    // Pass companyId directly. 
                    // getClients handles path stripping internally. 
                    // getSites performs exact match, so we must pass the same format used in SitesPage (usually full path).
                    const [clientsData, sitesData] = await Promise.all([
                        getClients(user.companyId),
                        getSites(user.companyId)
                    ]);
                    setClients(clientsData);
                    setSites(sitesData);
                } catch (e) {
                    console.error('Failed to load filters', e);
                }
            }
        };
        loadFilters();
    }, [user?.companyId]);

    // Manual entry state
    const canManageTimeEntries = useCanManageTimeEntries();
    const [showManualEntryModal, setShowManualEntryModal] = useState(false);
    const [selectedDate, setSelectedDate] = useState(null);
    const [selectedUserId, setSelectedUserId] = useState(null);
    const [manualEntryForm, setManualEntryForm] = useState({ clockIn: '', clockOut: '', notes: '' });
    const [manualEntryErrors, setManualEntryErrors] = useState({});
    const [isAddingManualEntry, setIsAddingManualEntry] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    // Track if we're closing an existing open session (so we clock-out instead of creating a manual entry)
    const [closingSessionId, setClosingSessionId] = useState(null);

    // Edit entry state
    const [editingEntry, setEditingEntry] = useState(null);
    const [showEditModal, setShowEditModal] = useState(false);

    // Determine available tabs based on user role
    const availableTabs = useMemo(() => {
        const tabs = [];

        // siteManager only sees "All User Entries"
        if (user?.role === 'siteManager') {
            tabs.push({ label: 'All User Entries' });
        } else {
            // All other users can see "My Entries"
            tabs.push({ label: 'My Entries' });

            // Only users with team/company access can see "All User Entries"
            if (['adminManager', 'adminAdvisor', 'hrManager', 'hrAdvisor', 'teamManager', 'seniorManager'].includes(user?.role)) {
                tabs.push({ label: 'All User Entries' });
            }
        }

        return tabs;
    }, [user?.role]);

    // Set initial active tab based on available tabs
    // siteManager defaults to "All User Entries", others default to "My Entries"
    const [activeTab, setActiveTab] = useState(() => {
        if (user?.role === 'siteManager') {
            return 'All User Entries';
        }
        return availableTabs[0]?.label || 'My Entries';
    });

    // Update active tab if available tabs change
    useEffect(() => {
        if (availableTabs.length > 0 && !availableTabs.find(tab => tab.label === activeTab)) {
            setActiveTab(availableTabs[0].label);
        }
    }, [availableTabs, activeTab]);

    // Filter users based on active tab
    const filteredUserIds = useMemo(() => {
        if (!user) return [];

        let baseUserIds = [];

        if (activeTab === 'My Entries') {
            // Show only current user
            baseUserIds = currentUserId ? [currentUserId] : [];
        } else if (activeTab === 'All User Entries') {
            // Show all accessible users, but exclude siteManager users
            baseUserIds = accessibleUserIds.filter(userId => {
                // Requested: current logged-in user should NOT appear in "All"
                if (currentUserId && userId === currentUserId) return false;
                const userData = users[userId] || {};
                const normalizeRole = (role) => String(role || '').toLowerCase().replace(/[\s_-]+/g, '');
                // Exclude siteManager users from "All User Entries"
                return normalizeRole(userData.primaryRole) !== 'sitemanager' && normalizeRole(userData.role) !== 'sitemanager';
            });

            // Apply Client Filter
            if (selectedClientId) {
                baseUserIds = baseUserIds.filter(userId => {
                    const userData = users[userId] || {};
                    return userData.clientId === selectedClientId;
                });
            }

            // Apply Site Filter
            if (selectedSiteId) {
                baseUserIds = baseUserIds.filter(userId => {
                    const userData = users[userId] || {};
                    // Handle stored siteId format (sites/ID vs ID)
                    const userSiteId = userData.siteId?.replace('sites/', '');
                    return userSiteId === selectedSiteId;
                });

            }
        }

        // Apply search filter
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase().trim();
            return baseUserIds.filter(userId => {
                const userData = users[userId] || {};
                const displayName = userData.displayName
                    || `${userData.firstName || ''} ${userData.lastName || ''}`.trim()
                    || userData.email
                    || '';
                return displayName.toLowerCase().includes(query) ||
                    (userData.email || '').toLowerCase().includes(query);
            });
        }

        return baseUserIds;
    }, [activeTab, accessibleUserIds, users, searchQuery, user, selectedClientId, selectedSiteId, currentUserId]);

    // Determine which users need sessions loaded
    // For "My Entries" tab, we still need to load sessions for the current user
    // For "All User Entries", load sessions for all accessible users (excluding siteManager)
    const usersToLoadSessions = useMemo(() => {
        if (activeTab === 'My Entries') {
            // Always load sessions for current user
            return [currentUserId].filter(Boolean);
        } else {
            // Load sessions for all accessible users, but exclude siteManager users
            return accessibleUserIds.filter(userId => {
                // Keep in sync with grid: don't load current user sessions in "All"
                if (currentUserId && userId === currentUserId) return false;
                const userData = users[userId] || {};
                const normalizeRole = (role) => String(role || '').toLowerCase().replace(/[\s_-]+/g, '');
                // Exclude siteManager users from session loading
                return normalizeRole(userData.primaryRole) !== 'sitemanager' && normalizeRole(userData.role) !== 'sitemanager';
            });
        }
    }, [activeTab, accessibleUserIds, users, currentUserId]);

    // Get real-time sessions for users that need to be displayed
    const { sessionsByUser, isLoading: isLoadingSessions } = useMultipleUserSessions(usersToLoadSessions, user?.companyId);

    // Load rounding rules for each visible user (site override > company rules)
    useEffect(() => {
        let cancelled = false;

        const loadRoundingRules = async () => {
            if (!user) return;
            if (!filteredUserIds || filteredUserIds.length === 0) return;

            try {
                const entries = await Promise.all(
                    filteredUserIds.map(async (uid) => {
                        const u = users?.[uid] || {};
                        const companyId = u.companyId || user.companyId;
                        const siteId = u.siteId || user.siteId;
                        const rules = await resolveRoundingRules(companyId, siteId);
                        return [uid, rules];
                    })
                );

                if (cancelled) return;

                setRoundingRulesByUser((prev) => {
                    const next = { ...prev };
                    for (const [uid, rules] of entries) {
                        next[uid] = rules;
                    }
                    return next;
                });
            } catch (err) {
                console.warn('[TimeEntriesPage] Failed to load rounding rules:', err);
            }
        };

        loadRoundingRules();
        return () => { cancelled = true; };
    }, [filteredUserIds, users, user]);

    // Store timesheet entries for users (to prioritize saved values over session data)
    const [timesheetEntriesByUser, setTimesheetEntriesByUser] = useState({}); // userId -> { dateStr -> entry }
    // Store timesheet status for users (to restrict modifications)
    const [timesheetStatusByUser, setTimesheetStatusByUser] = useState({}); // userId -> status

    // Determine which users the current user can view
    useEffect(() => {
        const determineAccessibleUsers = async () => {
            if (!user) return;

            setIsLoadingUsers(true);
            try {
                const companyId = user.companyId;
                let userIds = [];
                let usersData = {};

                const { getUsersByCompany } = await import('../../services/users');

                // Employee: Only themselves
                if (user.role === 'employee') {
                    userIds = [user.userId];
                }
                // Admin/HR/Site: Everyone in company
                else if (['adminManager', 'adminAdvisor', 'hrManager', 'hrAdvisor', 'siteManager', 'seniorManager'].includes(user.role)) {
                    const companyUsers = await getUsersByCompany(companyId);
                    userIds = companyUsers.map(u => u.id);
                    
                    companyUsers.forEach(u => {
                        usersData[u.id] = u;
                    });
                    setUsers(usersData);
                }
                // Team Manager: Themselves + their team
                else if (user.role === 'teamManager') {
                    const [managedIds, companyUsers] = await Promise.all([
                        getManagedEmployeeIdsForManager(user.userId, companyId),
                        getUsersByCompany(companyId)
                    ]);

                    userIds = [user.userId, ...Array.from(managedIds)];
                    
                    companyUsers.forEach(u => {
                        if (userIds.includes(u.id)) {
                            usersData[u.id] = u;
                        }
                    });
                    setUsers(usersData);
                }
                else {
                    userIds = [user.userId];
                }

                setAccessibleUserIds(userIds);

            } catch (error) {
                console.error('[TimeEntriesPage] Error determining accessible users:', error);
                toast.error('Failed to load user data');
            } finally {
                setIsLoadingUsers(false);
            }
        };

        determineAccessibleUsers();
    }, [user]);

    // Ensure current user is always in users object
    useEffect(() => {
        if (user && !users[user.userId]) {
            setUsers(prev => ({
                ...prev,
                [user.userId]: {
                    id: user.userId,
                    displayName: user.displayName,
                    email: user.email,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    role: user?.role,
                    primaryRole: user?.primaryRole
                }
            }));
        }
    }, [user, users]);

    // Get week dates based on company's week start day setting
    const weekDates = useMemo(() => {
        // Return empty array if weekStartDay is not yet loaded
        if (!weekStartDay || isWeekStartLoading) {
            return [];
        }

        // Use selectedWeekStart for navigation, fallback to today if not set
        const baseDate = selectedWeekStart || new Date();
        const normalizedWeekStart = normalizeWeekStartDay(weekStartDay);

        // Use getWeekRangeForDate to properly calculate the week based on company setting
        const { start } = getWeekRangeForDate(baseDate, normalizedWeekStart);

        console.log('[TimeEntriesPage] weekDates calculation:', {
            baseDate: baseDate.toISOString(),
            isUsingSelectedWeek: !!selectedWeekStart,
            normalizedWeekStart,
            calculatedWeekStart: start.toISOString(),
            startDayName: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][start.getDay()]
        });

        // Generate 7 days starting from the week start
        const dates = [];
        for (let i = 0; i < 7; i++) {
            const date = new Date(start);
            date.setDate(start.getDate() + i);
            dates.push(date);
        }


        return dates;
    }, [weekStartDay, isWeekStartLoading, selectedWeekStart]); // Add selectedWeekStart dependency

    // Fetch timesheet entries for users in the selected week (after weekDates is defined)
    useEffect(() => {
        const fetchTimesheetEntries = async () => {

            // Exit early if we don't have the required data OR if config is still loading
            if (isWeekStartLoading) {
                return;
            }

            if (filteredUserIds.length === 0 || !weekDates || !weekDates.length) {
                setTimesheetEntriesByUser({});
                return;
            }

            try {
                setIsLoadingTimesheets(true);
                const weekStartStr = formatISODate(weekDates[0]);
                const weekEndStr = formatISODate(weekDates[6]);


                const weekDateStrings = weekDates.map(date => formatISODate(date));
                const entriesByUser = {};

                // PERFORMANCE FIX: Batch Fetch Timesheets
                // Instead of N+1 requests, we fetch ALL company timesheets for this week in 1 request.
                const { fetchCompanyTimesheetsForWeek } = await import('../../services/timesheets');
                const companyIdRaw = user?.companyId ? user.companyId.split('/').pop() : '';

                try {
                    const batchTimesheets = await fetchCompanyTimesheetsForWeek(companyIdRaw, weekStartStr);

                    // Store timesheet status for each user
                    const statusMap = {};

                    // Map batch results to users
                    batchTimesheets.forEach(ts => {
                        if (!filteredUserIds.includes(ts.userId)) return;

                        // Store the timesheet status
                        statusMap[ts.userId] = ts.status || 'draft';

                        const userId = ts.userId;
                        if (!entriesByUser[userId]) {
                            entriesByUser[userId] = {};
                        }
                        const entriesByDate = entriesByUser[userId];

                        if (ts?.entries && Array.isArray(ts.entries)) {
                            for (const entry of ts.entries) {
                                const entryDate = entry.date;
                                if (entryDate && weekDateStrings.includes(entryDate)) {
                                    if (!entriesByDate[entryDate]) {
                                        entriesByDate[entryDate] = [];
                                    }

                                    // [DEDUPLICATION FIX] Check if this entry already exists for this date (from another document)
                                    const entryUniqueId = entry.id || entry.sessionKey || entry.sessionId;
                                    const exists = entryUniqueId && entriesByDate[entryDate].some(e => (e.id || e.sessionKey || e.sessionId) === entryUniqueId);

                                    if (!exists) {
                                        entriesByDate[entryDate].push({
                                            ...entry,
                                            timesheetId: ts.id // Explicitly record where this came from for easier debugging
                                        });
                                    }
                                }
                            }
                        }
                    });

                    // Update timesheet status state
                    setTimesheetStatusByUser(statusMap);
                } catch (batchError) {
                    console.error('[TimeEntriesPage] Batch fetch failed', batchError);
                    toast.error('Failed to load team timesheets');
                }

                setTimesheetEntriesByUser(entriesByUser);
                setIsLoadingTimesheets(false);

            } catch (error) {
                console.error('[TimeEntriesPage] ✗ Error fetching timesheet entries:', error);
                setTimesheetEntriesByUser({});
                setIsLoadingTimesheets(false);
            }
        };

        fetchTimesheetEntries();
    }, [filteredUserIds, weekDates, weekStartDay, refreshTrigger]);

    // Process sessions into day-by-day format for each user
    const timeEntriesGrid = useMemo(() => {
        // Return empty grid if weekDates is not yet initialized
        if (!weekDates || weekDates.length === 0) {
            return {};
        }

        const grid = {};

        // Get week date strings for matching (normalize to YYYY-MM-DD format)
        const weekDateStrings = weekDates.map(date => {
            const dateStr = formatISODate(date);
            return dateStr;
        });

        // Week time range: Saturday 00:00:00 to Friday 23:59:59.999
        const weekStartTime = weekDates[0].getTime();
        const fridayEnd = new Date(weekDates[6]);
        fridayEnd.setHours(23, 59, 59, 999);
        const weekEndTime = fridayEnd.getTime();


        filteredUserIds.forEach(userId => {
            const userSessions = sessionsByUser[userId] || [];
            const userTimesheetEntries = timesheetEntriesByUser[userId] || {}; // Get saved timesheet entries
            const userEntries = {};

            // Initialize all days with empty entries
            weekDates.forEach(date => {
                const dateStr = formatISODate(date);
                // CRITICAL FIX: Handle multiple saved timesheet entries
                const savedEntries = userTimesheetEntries[dateStr] || [];
                // Find a primary entry if needed for legacy logic, but we will store all
                const primarySavedEntry = savedEntries.length > 0 ? savedEntries[0] : null;

                let savedClockIn = null;
                let savedClockOut = null;

                // Extract saved clockIn/clockOut from timesheet entry (stored as "HH:MM" strings)
                if (primarySavedEntry) {
                    // Helper to convert time string (HH:MM) to Date for formatting
                    const timeStringToDate = (timeStr, dateStr) => {
                        if (!timeStr || typeof timeStr !== 'string') return null;
                        try {
                            const [hours, minutes] = timeStr.split(':').map(Number);
                            if (isNaN(hours) || isNaN(minutes)) return null;
                            const date = new Date(dateStr);
                            date.setHours(hours, minutes, 0, 0);
                            return date;
                        } catch {
                            return null;
                        }
                    };

                    // TIME ENTRIES PAGE: Prefer RAW times (actual input) over rounded times
                    // For manual entries, show what user actually entered
                    let clockInToUse = primarySavedEntry.rawClockIn || primarySavedEntry.clockIn;
                    let clockOutToUse = primarySavedEntry.rawClockOut || primarySavedEntry.clockOut;

                    // [SMART DISPLAY FIX] - Use shared utility
                    clockInToUse = detectAndConvertToLocal(clockInToUse, primarySavedEntry.rawStart || primarySavedEntry.startedAt);
                    clockOutToUse = detectAndConvertToLocal(clockOutToUse, primarySavedEntry.rawEnd || primarySavedEntry.endedAt);

                    if (clockInToUse && typeof clockInToUse === 'string') {
                        savedClockIn = timeStringToDate(clockInToUse, dateStr);
                    }
                    if (clockOutToUse && typeof clockOutToUse === 'string') {
                        savedClockOut = timeStringToDate(clockOutToUse, dateStr);
                    }
                }

                userEntries[dateStr] = {
                    date: dateStr,
                    sessions: [],
                    clockIn: savedClockIn, // Legacy support
                    clockOut: savedClockOut, // Legacy support
                    savedEntries: savedEntries // Store all saved entries
                };
            });

            // Continue processing sessions even if no sessions (to populate from saved entries)

            // Process sessions for this week
            userSessions.forEach(session => {
                // Get startedAt - handle both Timestamp and Date objects
                let startedAt = null;
                if (session.startedAt) {
                    if (session.startedAt.toDate) {
                        startedAt = session.startedAt.toDate();
                    } else if (session.startedAt instanceof Date) {
                        startedAt = session.startedAt;
                    } else if (typeof session.startedAt === 'string') {
                        startedAt = new Date(session.startedAt);
                    }
                }

                if (!startedAt || isNaN(startedAt.getTime())) {
                    console.warn(`[TimeEntriesPage] Session ${session.id} has invalid startedAt:`, session.startedAt);
                    return;
                }

                // Normalize to local date (ignore time for date matching)
                const sessionDateStr = formatISODate(startedAt);

                // Check if this date is in our week (primary check)
                if (!weekDateStrings.includes(sessionDateStr)) {
                    // Date not in week - skip
                    return;
                }

                // Additional time range check (sessions should be within week boundaries)
                const startTime = startedAt.getTime();
                if (startTime < weekStartTime || startTime > weekEndTime) {
                    // Session time is outside week range, but date matches - still include it
                    // (this can happen with timezone issues, but date is what matters)
                }

                // Add session to the matching day
                userEntries[sessionDateStr].sessions.push(session);

                // TIME ENTRIES PAGE: Show ACTUAL/RAW times (not rounded)
                // Use startedAt and endedAt directly for accurate time tracking
                let clockIn = startedAt; // Use actual start time, not rounded

                let clockOut = null;
                if (session.endedAt) {
                    if (session.endedAt.toDate) {
                        clockOut = session.endedAt.toDate();
                    } else if (session.endedAt instanceof Date) {
                        clockOut = session.endedAt;
                    } else if (typeof session.endedAt === 'string') {
                        clockOut = new Date(session.endedAt);
                    }
                    // Use actual end time, not rounded
                }

                // CRITICAL FIX: Only use session data if there's no saved timesheet entry value
                // Prioritize saved timesheet entry values (edited values) over session data (old values)
                const currentEntry = userEntries[sessionDateStr];
                const primaryEntry = currentEntry.savedEntries?.[0];
                const hasSavedClockIn = primaryEntry && primaryEntry.clockIn;
                const hasSavedClockOut = primaryEntry && primaryEntry.clockOut;

                // Only update clockIn from sessions if no saved timesheet entry value exists
                if (!hasSavedClockIn) {
                    if (!currentEntry.clockIn || clockIn < currentEntry.clockIn) {
                        currentEntry.clockIn = clockIn;
                    }
                }

                // Only update clockOut from sessions if no saved timesheet entry value exists
                if (clockOut && !hasSavedClockOut) {
                    if (!currentEntry.clockOut || clockOut > currentEntry.clockOut) {
                        currentEntry.clockOut = clockOut;
                    }
                }

            });

            grid[userId] = userEntries;
        });


        return grid;
    }, [filteredUserIds, sessionsByUser, weekDates, timesheetEntriesByUser]);

    // Live overlap warning + submit disabling for ManualTimeEntryModal
    useEffect(() => {
        if (!showManualEntryModal) return;
        // While saving, the just-created entry may appear in state and would
        // temporarily self-conflict. Suppress overlap warnings during submit.
        if (isAddingManualEntry) {
            setManualEntryErrors(prev => ({ ...prev, overlap: undefined }));
            return;
        }
        if (!selectedUserId || !selectedDate || !manualEntryForm.clockIn?.trim()) {
            setManualEntryErrors(prev => ({ ...prev, overlap: undefined }));
            return;
        }

        const now = new Date();
        const isToday = selectedDate === formatISODate(new Date());
        const isRetroactiveClockIn = isToday && manualEntryForm.clockIn?.trim() && !manualEntryForm.clockOut?.trim();

        const dayEntry = timeEntriesGrid?.[selectedUserId]?.[selectedDate];
        const existingIntervals = buildExistingIntervalsForDate({
            dateStr: selectedDate,
            savedEntries: dayEntry?.savedEntries || [],
            sessions: dayEntry?.sessions || []
        });

        const conflict = getTimeEntryOverlapConflict({
            candidateStart: manualEntryForm.clockIn,
            candidateEnd: isRetroactiveClockIn ? null : (manualEntryForm.clockOut?.trim() ? manualEntryForm.clockOut : null),
            existingIntervals,
            nowMin: now.getHours() * 60 + now.getMinutes()
        });

        setManualEntryErrors(prev => {
            const next = { ...prev };
            if (conflict.hasConflict) next.overlap = conflict.message || 'Time entry conflicts with an existing entry';
            else next.overlap = undefined;
            return next;
        });
    }, [
        showManualEntryModal,
        isAddingManualEntry,
        selectedUserId,
        selectedDate,
        manualEntryForm.clockIn,
        manualEntryForm.clockOut,
        timeEntriesGrid
    ]);

    // [NEW] Self-Healing: Detect users with sessions but NO timesheet, and trigger reconciliation
    useEffect(() => {
        if (!weekDates || weekDates.length === 0 || isLoadingTimesheets || isLoadingSessions) return;

        const checkAndHeal = async () => {
            // 1. Identify active week details
            const weekStartStr = formatISODate(weekDates[0]);
            const weekEndStr = formatISODate(weekDates[6]);
            // Always align with the company-configured weekStartDay
            const effectiveWeekStartDay = weekStartDay || DEFAULT_WEEK_START_DAY;

            // 2. Scan visible users
            for (const userId of filteredUserIds) {
                const userSessions = sessionsByUser[userId] || [];
                const hasSessionsInWeek = userSessions.some(s => {
                    const d = s.startedAt?.toDate ? s.startedAt.toDate() : new Date(s.startedAt);
                    const dStr = formatISODate(d);
                    return dStr >= weekStartStr && dStr <= weekEndStr;
                });

                // If no sessions, we don't care (unless we want to create empty timesheets? No, only "Weeks with entries")
                if (!hasSessionsInWeek) continue;

                // 3. Check if Timesheet exists (by checking entries or some indicator)
                // NOTE: timesheetEntriesByUser only has *entries*, not the doc metadata.
                // However, if the timesheet doc didn't exist, we wouldn't have loaded anything.
                // Wait, we need to know if the *Timesheet Document* exists.
                // `timesheetEntriesByUser[userId]` being missing/empty suggests no doc OR empty doc.
                // If sessions exist, entries SHOULD exist in the doc if it was synced.
                // If `timesheetEntriesByUser[userId]` is empty, we likely have an inconsistency (Orphaned Sessions).

                const hasTimesheetEntries = timesheetEntriesByUser[userId] && Object.keys(timesheetEntriesByUser[userId]).length > 0;

                if (!hasTimesheetEntries) {
                    // ORPHAN SESSION DETECTED (Sessions exist, but Timesheet doesn't reflect them).
                    try {
                        const { reconcileTimesheetForWeek, getUserWeekContext } = await import('../../services/timesheets');
                        const context = await getUserWeekContext(userId);
                        const userCompanyId = context.companyIdPath || user?.companyId || '';

                        if (userCompanyId) {
                            await reconcileTimesheetForWeek(userId, userCompanyId, weekStartStr, effectiveWeekStartDay, weekEndStr);
                            // We could trigger a refresh here: setRefreshTrigger(p => p+1); 
                            // But let's avoid infinite loops. The reconciler is idempotent.
                        }
                    } catch (err) {
                    }
                }
            }
        };

        // Debounce slightly to allow loads to settle
        const timer = setTimeout(checkAndHeal, 2000);
        return () => clearTimeout(timer);

    }, [weekDates, filteredUserIds, sessionsByUser, timesheetEntriesByUser, isLoadingTimesheets, isLoadingSessions, weekStartDay]);

    // Check if user can modify time entries based on timesheet status
    const canModifyTimeEntries = useCallback((userId) => {
        // Only apply status restrictions to user's own timesheet
        if (userId === currentUserId) {
            const status = timesheetStatusByUser[userId] || 'draft';
            const normalizedStatus = String(status).toLowerCase();
            // Allow modifications only for Draft and Rejected status for own timesheet
            return normalizedStatus === 'draft' || normalizedStatus === 'rejected';
        }

        // For other users' timesheets, always allow modifications
        return true;
    }, [timesheetStatusByUser, currentUserId]);

    // Format time for display
    const formatTime = useCallback((date) => {
        if (!date) return '—';
        try {
            // Handle Firestore Timestamps
            const dateObj = date.toDate ? date.toDate() : (date instanceof Date ? date : new Date(date));
            if (isNaN(dateObj.getTime())) return '—';

            return dateObj.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
        } catch {
            return '—';
        }
    }, []);

    // Get user display name
    const getUserDisplayName = useCallback((userId) => {
        const userData = users[userId] || {};
        return userData.displayName
            || `${userData.firstName || ''} ${userData.lastName || ''}`.trim()
            || userData.email
            || (userId && userId.slice(0, 8));
    }, [users]);

    // Handle save from Edit/Manual Entry modals to update UI immediately (Stale UI Fix)
    const handleEntrySaved = useCallback((result, overrideUserId = null) => {
        // Always trigger background refresh eventually
        setRefreshTrigger(prev => prev + 1);

        if (!result) return;

        console.log('[TimeEntriesPage] Received save result:', result);

        // 2. IMMEDIATE OPTIMISTIC UPDATE (Fix Stale UI)
        // If we have the updated timesheet object back, merge it into local state
        if (result.updatedTimesheet) {
            const updatedTs = result.updatedTimesheet;
            // Prefer the explicit overrideUserId (passed from call site) over updatedTs.userId
            // because updatedTs.userId can be undefined for newly-created timesheets
            const targetUserId = overrideUserId || updatedTs.userId;

            if (!targetUserId) {
                console.warn('[TimeEntriesPage] handleEntrySaved: no targetUserId, cannot perform optimistic update');
                return;
            }

            setTimesheetEntriesByUser(prev => {
                const userEntries = prev[targetUserId] || {};
                const newDateMap = { ...userEntries };

                if (Array.isArray(updatedTs.entries)) {
                    // Group updated entries by date to maintain Array structure
                    const groupedUpdates = {};
                    updatedTs.entries.forEach(entry => {
                        if (entry.date) {
                            if (!groupedUpdates[entry.date]) {
                                groupedUpdates[entry.date] = [];
                            }
                            groupedUpdates[entry.date].push(entry);
                        }
                    });

                    // Update the state map with the new arrays
                    Object.keys(groupedUpdates).forEach(date => {
                        newDateMap[date] = groupedUpdates[date];
                    });
                }

                return {
                    ...prev,
                    [targetUserId]: newDateMap
                };
            });
        }
    }, []);


    // Validate and add manual time entry
    const validateAndAddManualEntry = async () => {
        const errors = {};
        const now = new Date();
        const currentTimeStr = now.toTimeString().slice(0, 5); // HH:MM format

        // ── CLOSE EXISTING SESSION PATH ──────────────────────────────────────────
        // When closing an open session, only validate + execute clock-out; skip all
        // manual-entry validation (date range, overlap, retroactive-clock-in checks).
        if (closingSessionId) {
            if (!manualEntryForm.clockOut?.trim()) {
                setManualEntryErrors({ clockOut: 'Clock out time is required' });
                return;
            }
            const isTodayClose = selectedDate === formatISODate(new Date());
            if (isTodayClose && manualEntryForm.clockOut > currentTimeStr) {
                setManualEntryErrors({ clockOut: 'Cannot select future time for today' });
                return;
            }
            if (manualEntryForm.clockIn && manualEntryForm.clockOut <= manualEntryForm.clockIn) {
                setManualEntryErrors({ clockOut: 'Clock out time must be after clock in time' });
                return;
            }

            setIsAddingManualEntry(true);
            setManualEntryErrors({});
            try {
                const { stopClock } = await import('../../services/timeClock');
                const [hours, minutes] = manualEntryForm.clockOut.split(':').map(Number);
                const endedAtDate = new Date(selectedDate);
                endedAtDate.setHours(hours, minutes, 0, 0);

                await stopClock({
                    userId: selectedUserId,
                    sessionId: closingSessionId,
                    endedAt: endedAtDate,
                    notes: manualEntryForm.notes || null,
                });

                toast.success('Clocked out successfully');
                setShowManualEntryModal(false);
                setManualEntryForm({ clockIn: '', clockOut: '', notes: '' });
                setClosingSessionId(null);
                setRefreshTrigger(prev => prev + 1);
            } catch (err) {
                toast.error(err.message || 'Clock out failed. Please try again.');
            } finally {
                setIsAddingManualEntry(false);
            }
            return;
        }
        // ── END CLOSE EXISTING SESSION PATH ─────────────────────────────────────

        // Validate date is selected and within current week
        if (!selectedDate) {
            errors.date = 'Date is required';
        } else {
            const weekDateStrings = weekDates.map(d => formatISODate(d));
            if (!weekDateStrings.includes(selectedDate)) {
                errors.date = 'Date must be within the current week';
            }
        }

        const isToday = selectedDate === formatISODate(new Date());
        const isRetroactiveClockIn = isToday && manualEntryForm.clockIn?.trim() && !manualEntryForm.clockOut?.trim();

        if (!manualEntryForm.clockIn?.trim()) {
            errors.clockIn = 'Clock in time is required';
        } else if (isToday) {
            // For today, check if clock-in time is in the future
            if (manualEntryForm.clockIn > currentTimeStr) {
                errors.clockIn = 'Cannot select future time for today';
            }
        }

        if (!manualEntryForm.clockOut?.trim() && !isRetroactiveClockIn) {
            errors.clockOut = 'Clock out time is required';
        } else if (isToday && manualEntryForm.clockOut?.trim()) {
            // For today, check if clock-out time is in the future
            if (manualEntryForm.clockOut > currentTimeStr) {
                errors.clockOut = 'Cannot select future time for today';
            }
        }

        if (manualEntryForm.clockIn && manualEntryForm.clockOut) {
            const [inHours, inMinutes] = manualEntryForm.clockIn.split(':').map(Number);
            const [outHours, outMinutes] = manualEntryForm.clockOut.split(':').map(Number);

            const inTime = inHours * 60 + inMinutes;
            const outTime = outHours * 60 + outMinutes;

            if (outTime < inTime) {
                errors.clockOut = 'Clock out time must be after clock in time';
            } else if (outTime === inTime) {
                errors.clockOut = 'Clock in and out time cannot be the same for manual entries';
            }
        }

        // Additional validation for overlapping entries when user has open tracking
        if (isToday && isRetroactiveClockIn) {
            // Check if user already has an open session
            const userSessions = sessionsByUser[selectedUserId] || [];
            const hasOpenSession = userSessions.some(session => session.status === 'open');

            if (hasOpenSession) {
                errors.clockIn = 'User already has an active clock-in session';
            }
        }

        // Overlap validation (prevents duplicates/overlaps with existing saved entries or sessions)
        if (!errors.date && selectedUserId && selectedDate && manualEntryForm.clockIn?.trim()) {
            const dayEntry = timeEntriesGrid?.[selectedUserId]?.[selectedDate];
            const existingIntervals = buildExistingIntervalsForDate({
                dateStr: selectedDate,
                savedEntries: dayEntry?.savedEntries || [],
                sessions: dayEntry?.sessions || []
            });

            const conflict = getTimeEntryOverlapConflict({
                candidateStart: manualEntryForm.clockIn,
                candidateEnd: isRetroactiveClockIn ? null : (manualEntryForm.clockOut?.trim() ? manualEntryForm.clockOut : null),
                existingIntervals,
                nowMin: now.getHours() * 60 + now.getMinutes()
            });

            if (conflict.hasConflict) {
                errors.overlap = conflict.message || 'Time entry conflicts with an existing entry';
            }
        }

        if (Object.keys(errors).length > 0) {
            setManualEntryErrors(errors);
            return;
        }

        setIsAddingManualEntry(true);
        // Clear any overlap warning once we start saving
        setManualEntryErrors(prev => ({ ...prev, overlap: undefined }));
        try {
            const isToday = selectedDate === formatISODate(new Date());
            const isRetroactiveClockIn = isToday && manualEntryForm.clockIn?.trim() && !manualEntryForm.clockOut?.trim();

            if (isRetroactiveClockIn) {
                // RETROACTIVE CLOCK-IN FLOW: Start a single open session from the requested time.
                // This avoids "Double Entry" in the grid and ensures the counter starts from the correct time.
                const { startClock } = await import('../../services/timeClock');

                const [hours, minutes] = manualEntryForm.clockIn.split(':').map(Number);
                const startedAtDate = new Date();
                startedAtDate.setHours(hours, minutes, 0, 0);

                // GET TARGET USER CONTEXT (Critical for Admin/Manager actions)
                // Use the profile of the user we are clocking in, not the person clicking the button
                const targetUser = users[selectedUserId] || {};
                const targetCompanyId = targetUser.companyId || user.companyId;
                const targetSiteId = targetUser.siteId || user.siteId;

                // Debug context resolution

                if (!targetCompanyId || !targetSiteId) {
                    toast.error('Could not determine site or company for this user. Please ensure their profile is complete.');
                    setIsAddingManualEntry(false);
                    return;
                }

                await startClock({
                    userId: selectedUserId,
                    companyId: targetCompanyId,
                    siteId: targetSiteId,
                    startedAt: startedAtDate,
                    notes: manualEntryForm.notes
                });

                // User requested: "timesheet should be automatically created when they make entries"
                // For retroactive clock-ins, ensure the weekly timesheet exists
                await ensureWeeklyTimesheet(selectedUserId, selectedDate, targetCompanyId);

                toast.success('Successfully started clock retroactively from ' + manualEntryForm.clockIn);
                setShowManualEntryModal(false);
                setManualEntryForm({ clockIn: '', clockOut: '', notes: '' });
                setManualEntryErrors({});
                setRefreshTrigger(prev => prev + 1);
                return;
            }

            // REGULAR MANUAL ENTRY FLOW (Both In & Out provided)
            const result = await addManualTimeEntry(
                selectedUserId,
                selectedDate,
                manualEntryForm.clockIn,
                manualEntryForm.clockOut,
                weekStartDay,
                null,
                { notes: manualEntryForm.notes } // Pass description
            );


            // Show appropriate toast message based on result
            if (result.isDuplicate) {
                toast.info('Entry already exists for this time');
            } else {
                toast.success('Time entry added successfully');
            }
            setShowManualEntryModal(false);
            setManualEntryForm({ clockIn: '', clockOut: '', notes: '' }); // Reset form with notes
            setManualEntryErrors({});

            console.log('[TimeEntriesPage] 📝 Manual entry added:', {
                userId: selectedUserId,
                date: selectedDate,
                clockIn: manualEntryForm.clockIn,
                clockOut: manualEntryForm.clockOut
            });

            // Optimistic Update + force a refresh so the grid actually redraws
            if (result && result.updatedTimesheet) {
                handleEntrySaved(result, selectedUserId);
                // Also nudge refreshTrigger a tick later to re-fetch from Firestore
                // (optimistic update keeps UI snappy; refresh ensures data is accurate)
                setTimeout(() => setRefreshTrigger(prev => prev + 1), 800);
            } else if (result && result.isDuplicate) {
                // Handle duplicate case - still need to refresh UI to show existing entry
                setTimeout(() => setRefreshTrigger(prev => prev + 1), 500);
            } else {
                // Fallback if no result returned (should not happen with new service logic)
                setTimeout(() => setRefreshTrigger(prev => prev + 1), 1000);
            }
        } catch (error) {
            console.error('[TimeEntriesPage] Error adding manual entry:', error);
            toast.error(error.message || 'Failed to add time entry');
        } finally {
            setIsAddingManualEntry(false);
        }
    };

    // Submit timesheet for approval
    const handleSubmitWeek = async (userId) => {
        if (!userId) return;

        setIsSubmitting(true);
        try {
            const { submitTimesheetForApproval } = await import('../../services/timesheets');
            const weekStartStr = formatISODate(weekDates[0]);
            const weekEndStr = formatISODate(weekDates[6]);

            await submitTimesheetForApproval(userId, weekStartStr, weekEndStr);
            toast.success('Timesheet submitted for approval successfully!');
            setRefreshTrigger(prev => prev + 1); // Refresh to show updated status
        } catch (error) {
            console.error('Error submitting timesheet:', error);
            toast.error(error.message || 'Failed to submit timesheet for approval');
        } finally {
            setIsSubmitting(false);
        }
    };

    // Export to CSV
    const handleExportCSV = useCallback(() => {
        const canExport = [
            'seniorManager',
            'adminManager',
            'adminAdvisor',
            'hrManager',
            'hrAdvisor',
            'teamManager',
            'siteManager'
        ].includes(user?.role);

        if (!canExport) {
            toast.error('You do not have permission to export data');
            return;
        }

        try {
            // Build CSV header
            const headers = ['Name', 'Email'];
            weekDates.forEach(date => {
                const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
                const dateStr = formatISODate(date);
                headers.push(`${dayName} ${dateStr} - Clock In`);
                headers.push(`${dayName} ${dateStr} - Clock Out`);
            });

            const rows = [headers.map(h => `"${h}"`).join(',')];

            const getDateFromTimeString = (timeStr, dateStr) => {
                if (!timeStr || typeof timeStr !== 'string') return null;
                try {
                    const [h, m] = timeStr.split(':').map(Number);
                    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
                    const d = new Date(dateStr);
                    d.setHours(h, m, 0, 0);
                    return d;
                } catch {
                    return null;
                }
            };

            const formatSavedTimeForExport = (saved, dateStr, kind) => {
                // Prefer raw (actual) times for export to match grid
                const iso = kind === 'in'
                    ? (saved.rawStart || saved.roundedStart || null)
                    : (saved.rawEnd || saved.roundedEnd || null);

                if (iso && typeof iso === 'string' && iso.includes('T')) {
                    const d = new Date(iso);
                    if (!Number.isNaN(d.getTime())) return formatTime(d);
                }

                // Fall back to stored string times
                const str = kind === 'in'
                    ? (saved.clockIn || saved.rawClockIn || null)
                    : (saved.clockOut || saved.rawClockOut || null);

                if (typeof str === 'string' && str.includes(':')) {
                    // Time Entries export uses actual (unrounded) time to match grid
                    const isoSource = iso || (kind === 'in' ? saved.startedAt : saved.endedAt) || null;
                    const localStr = detectAndConvertToLocal(str, isoSource);
                    const d = getDateFromTimeString(localStr, dateStr);
                    return d ? formatTime(d) : localStr;
                }

                return null;
            };

            filteredUserIds.forEach(userId => {
                const userData = users[userId] || {};
                const name =
                    userData.displayName ||
                    `${userData.firstName || ''} ${userData.lastName || ''}`.trim() ||
                    'Unknown';
                const email = userData.email || '';
                const userEntries = timeEntriesGrid[userId] || {};

                const dayEntries = [];

                weekDates.forEach(date => {
                    const dateStr = formatISODate(date);
                    const entry = userEntries[dateStr];

                    // Unified logic for CSV export (matching Grid Display)
                    const sessions = entry?.sessions || [];
                    const savedEntries = entry?.savedEntries || [];
                    let dailyClockIns = [];
                    let dailyClockOuts = [];

                    // 1. Process Timer Sessions (use actual times for export to match grid)
                    sessions.forEach(session => {
                        let startedAt = session.startedAt;
                        if (startedAt?.toDate) startedAt = startedAt.toDate();
                        else if (typeof startedAt === 'string') startedAt = new Date(startedAt);

                        if (startedAt) dailyClockIns.push(formatTime(startedAt));

                        if (session.status === 'open') {
                            dailyClockOuts.push('Open');
                        } else {
                            let endedAt = session.endedAt;
                            if (endedAt?.toDate) endedAt = endedAt.toDate();
                            else if (typeof endedAt === 'string') endedAt = new Date(endedAt);

                            if (endedAt) dailyClockOuts.push(formatTime(endedAt));
                        }
                    });

                    // 2. Process Manual Entries
                    savedEntries.forEach(saved => {
                        // Skip if it's a session summary to avoid duplicates
                        if (saved.sessionIds && saved.sessionIds.length > 0) return;

                        const inVal = formatSavedTimeForExport(saved, dateStr, 'in');
                        if (inVal) dailyClockIns.push(inVal);

                        const outVal = formatSavedTimeForExport(saved, dateStr, 'out');
                        if (outVal) dailyClockOuts.push(outVal);
                    });

                    // Join with newline
                    const clockInStr = dailyClockIns.length > 0 ? dailyClockIns.join('\r\n') : '—';
                    const clockOutStr = dailyClockOuts.length > 0 ? dailyClockOuts.join('\r\n') : '—';

                    dayEntries.push(clockInStr);
                    dayEntries.push(clockOutStr);
                });

                rows.push(
                    [name, email, ...dayEntries]
                        .map(e => `"${(e || '').toString().replace(/"/g, '""')}"`) // Escape quotes
                        .join(',')
                );
            });

            // Add UTF-8 BOM so Excel reads it correctly
            const BOM = '\ufeff';
            const csvContent = BOM + rows.join('\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute(
                'download',
                `time-entries-${formatISODate(selectedWeekStart)}.csv`
            );
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            toast.success('CSV exported successfully');
        } catch (error) {
            console.error('[TimeEntriesPage] Error exporting CSV:', error);
            toast.error('Failed to export CSV');
        }
    }, [
        user?.role,
        filteredUserIds,
        users,
        weekDates,
        timeEntriesGrid,
        formatTime,
        selectedWeekStart,
        roundingRulesByUser
    ]);

    // Navigate weeks - use getWeekRangeForDate to respect weekStartDay
    const handlePreviousWeek = useCallback(() => {
        const prevWeek = new Date(selectedWeekStart);
        prevWeek.setDate(prevWeek.getDate() - 7);
        // Recalculate week start to ensure proper boundaries
        const { start } = getWeekRangeForDate(prevWeek, weekStartDay);
        setSelectedWeekStart(start);
    }, [selectedWeekStart, weekStartDay]);

    const handleNextWeek = useCallback(() => {
        const nextWeek = new Date(selectedWeekStart);
        nextWeek.setDate(nextWeek.getDate() + 7);
        // Recalculate week start to ensure proper boundaries
        const { start } = getWeekRangeForDate(nextWeek, weekStartDay);
        setSelectedWeekStart(start);
    }, [selectedWeekStart, weekStartDay]);

    const handleToday = useCallback(() => {
        const currentWeekStart = getCurrentWeekStart();

        // Navigating to today's week:
        setSelectedWeekStart(currentWeekStart);
    }, [getCurrentWeekStart, weekStartDay]);

    // Auto-navigate to current week when component first mounts or weekStartDay changes
    useEffect(() => {
        if (user && weekStartDay) {
            const currentWeekStart = getCurrentWeekStart();
            // Always set to current week on initial load or when weekStartDay changes
            setSelectedWeekStart(currentWeekStart);
            // Auto-navigating to current week:
        }
    }, [user?.uid, weekStartDay, getCurrentWeekStart]); // Run when user, weekStartDay, or getCurrentWeekStart changes

    // Also update when isWeekStartLoading changes to false (initial load complete)
    useEffect(() => {
        // Week start loading state check
        if (!isWeekStartLoading && weekStartDay && !selectedWeekStart) {
            // Use today's date to calculate current week, not selectedWeekStart (which might be null)
            const today = new Date();
            const currentWeekStart = getCurrentWeekStart();
            // Setting selectedWeekStart to:
            setSelectedWeekStart(currentWeekStart);
        }
    }, [isWeekStartLoading, weekStartDay, selectedWeekStart, getCurrentWeekStart]);

    // Optimized loading state - show content earlier, improve perceived performance
    const isLoading = isWeekStartLoading || (!selectedWeekStart && weekStartDay);

    // Callback for when an entry is updated (edit/delete)
    const handleUpdateSuccess = useCallback(() => {
        // Entry updated/saved, forcing refresh...
        setRefreshTrigger(prev => prev + 1);
    }, []);

    const handleDeleteEntry = useCallback(async (entry, dateStr, userId) => {
        // Confirm deletion
        if (!window.confirm('Are you sure you want to delete this time entry? This action cannot be undone.')) {
            return;
        }

        setDeletingEntryId(entry.id || entry.sessionId);

        try {
            console.log('[TimeEntriesPage] Deleting time entry:', {
                entryId: entry.id,
                sessionId: entry.sessionId,
                userId,
                date: dateStr,
                entryObject: entry,
                weekStartDay
            });

            // Call delete service
            const result = await deleteTimeEntry(userId, dateStr, entry, weekStartDay);


            if (result && result.success) {
                toast.success(`Time entry deleted successfully. Removed ${result.deletedCount || 0} entries and ${result.deletedSessionsCount || 0} sessions.`);

                // Apply optimistic update immediately if we have updated timesheet data
                if (result.updatedTimesheet) {
                    const updatedTs = result.updatedTimesheet;
                    const targetUserId = updatedTs.userId;

                    setTimesheetEntriesByUser(prev => {
                        const userEntries = prev[targetUserId] || {};
                        const newDateMap = { ...userEntries };

                        if (Array.isArray(updatedTs.entries)) {
                            // Group updated entries by date to maintain Array structure
                            const groupedUpdates = {};
                            updatedTs.entries.forEach(entry => {
                                if (entry.date) {
                                    if (!groupedUpdates[entry.date]) {
                                        groupedUpdates[entry.date] = [];
                                    }
                                    groupedUpdates[entry.date].push(entry);
                                }
                            });

                            // Update the state map with the new arrays
                            Object.keys(groupedUpdates).forEach(date => {
                                newDateMap[date] = groupedUpdates[date];
                            });
                        }

                        return {
                            ...prev,
                            [targetUserId]: newDateMap
                        };
                    });
                }

                // Force background refresh as well
                setRefreshTrigger(prev => prev + 1);

            } else {
                throw new Error('Delete operation returned failure');
            }

        } catch (error) {
            console.error('[TimeEntriesPage] Error deleting time entry:', error);
            toast.error(`Failed to delete time entry: ${error.message || 'Unknown error'}`);
        } finally {
            setDeletingEntryId(null);
        }
    }, [weekStartDay]);

    return (
        <div className="h-screen flex flex-col overflow-hidden">
            <Header
                title="Time Entries"
                subtitle="View clock in/out times for all users"
            />

            <div className="flex-1 overflow-y-auto p-4 md:p-6 scrollbar-custom">
                <div className="max-w-full mx-auto space-y-6">
                    {/* Top Controls Section */}
                    <div className="flex flex-col gap-6 ">
                        {/* Tabs */}
                        {availableTabs.length > 1 && (
                            <div className="w-full border-b border-border-secondary">
                                <Tabs
                                    tabs={availableTabs}
                                    onTabChange={(tab) => setActiveTab(tab)}
                                />
                            </div>
                        )}

                        {/* Filters & Actions Card */}
                        <div className="bg-white p-4 rounded-xl border border-border-secondary shadow-sm flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">

                            {/* Left Side: Search & Filters */}
                            <div className="flex flex-col sm:flex-row items-center gap-3 w-full lg:w-auto">
                                {/* Search */}
                                <div className="relative w-full sm:w-72">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary" />
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="Search employees..."
                                        className="w-full h-10 pl-10 pr-4 bg-bg-secondary/50 border border-border-secondary rounded-lg text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple focus:ring-1 focus:ring-border-accent-purple/20 transition-all"
                                    />
                                </div>

                                {/* Site Filter */}
                                {activeTab === 'All User Entries' && (
                                    <div className="relative w-full sm:w-48">
                                        <select
                                            value={selectedSiteId}
                                            onChange={(e) => setSelectedSiteId(e.target.value)}
                                            className="w-full h-10 pl-3 pr-8 bg-bg-secondary/50 border border-border-secondary rounded-lg text-sm text-text-primary focus:outline-none focus:border-border-accent-purple appearance-none cursor-pointer"
                                        >
                                            <option value="">All Sites</option>
                                            {sites.map(s => (
                                                <option key={s.id} value={s.id}>{s.name}</option>
                                            ))}
                                        </select>
                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-text-secondary">
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                                        </div>
                                    </div>
                                )}

                                {/* Client Filter */}
                                {activeTab === 'All User Entries' && (
                                    <div className="relative w-full sm:w-48">
                                        <select
                                            value={selectedClientId}
                                            onChange={(e) => setSelectedClientId(e.target.value)}
                                            className="w-full h-10 pl-3 pr-8 bg-bg-secondary/50 border border-border-secondary rounded-lg text-sm text-text-primary focus:outline-none focus:border-border-accent-purple appearance-none cursor-pointer"
                                        >
                                            <option value="">All Clients</option>
                                            {clients.map(c => (
                                                <option key={c.id} value={c.id}>{c.name}</option>
                                            ))}
                                        </select>
                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-text-secondary">
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Right Side: Week Nav & Export */}
                            <div className="flex items-center gap-3 w-full lg:w-auto justify-between lg:justify-end">
                                <div className="flex items-center bg-bg-secondary rounded-lg p-1">
                                    <button
                                        onClick={handlePreviousWeek}
                                        className="p-1.5 hover:bg-white rounded-md text-text-secondary hover:text-text-primary hover:shadow-sm transition-all"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg>
                                    </button>
                                    <button
                                        onClick={handleToday}
                                        className="px-3 py-1 text-xs font-medium text-text-secondary hover:text-text-primary"
                                    >
                                        Today
                                    </button>
                                    <button
                                        onClick={handleNextWeek}
                                        className="p-1.5 hover:bg-white rounded-md text-text-secondary hover:text-text-primary hover:shadow-sm transition-all"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                                    </button>
                                </div>

                                {activeTab === 'All User Entries' && ['adminManager', 'adminAdvisor', 'hrManager', 'hrAdvisor', 'teamManager', 'siteManager', 'seniorManager'].includes(user?.role) && (
                                    <Button
                                        variant="outline-primary"
                                        onClick={handleExportCSV}
                                        className="h-9 text-sm px-3"
                                        icon={Download}
                                    >
                                        Export
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Week Title Row */}
                    {weekDates && weekDates.length > 0 && (
                        <div className="flex items-center justify-between px-1 mb-4">
                            <h2 className="text-xl font-bold text-text-primary">
                                {weekDates[0].toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} – {weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </h2>
                        </div>
                    )}

                    {/* Main Content Area */}
                    <div className="bg-white border border-border-primary rounded-xl overflow-hidden shadow-sm">
                        {/* Optimized Loading State - show skeleton while data loads */}
                        {(isLoading || isLoadingUsers || isLoadingSessions || isLoadingTimesheets) ? (
                            <div className="flex flex-col items-center justify-center py-20">
                                <Loader variant="spinner" size="lg" />
                                <p className="mt-4 text-text-secondary font-medium">Loading time entries...</p>
                            </div>
                        ) : filteredUserIds.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
                                <div className="w-16 h-16 bg-bg-secondary rounded-full flex items-center justify-center mb-4">
                                    <Search className="w-8 h-8 text-text-tertiary" />
                                </div>
                                <h3 className="text-lg font-semibold text-text-primary">No matching users found</h3>
                                <p className="text-text-secondary mt-1 max-w-sm">
                                    {searchQuery ? `We couldn't find any users matching "${searchQuery}"` : 'There are no users to display for the selected filters.'}
                                </p>
                                {searchQuery && (
                                    <button
                                        onClick={() => setSearchQuery('')}
                                        className="mt-4 text-sm font-medium text-brand-primary hover:underline hover:text-brand-primary/80"
                                    >
                                        Clear search
                                    </button>
                                )}
                            </div>
                        ) : (
                            /* Grid Table */
                            <div className="overflow-x-auto">
                                <table className="w-full border-collapse min-w-[1200px]">
                                    <thead>
                                        <tr>
                                            <th className="sticky left-0 z-20 bg-bg-secondary/50 backdrop-blur-sm border-b border-r border-border-secondary p-4 text-left font-semibold text-text-secondary text-xs uppercase tracking-wider w-[220px]">
                                                Employee
                                            </th>
                                            {weekDates.map((date, idx) => {
                                                const isToday = new Date().toDateString() === date.toDateString();
                                                return (
                                                    <th key={idx} colSpan={2} className={`border-b border-r border-border-secondary p-3 text-center min-w-[180px] ${isToday ? 'bg-brand-primary/5' : 'bg-white'}`}>
                                                        <div className="flex flex-col items-center">
                                                            <span className={`text-xs font-bold uppercase tracking-wider mb-1 ${isToday ? 'text-brand-primary' : 'text-text-secondary'}`}>
                                                                {date.toLocaleDateString('en-US', { weekday: 'short' })}
                                                            </span>
                                                            <span className={`text-sm font-bold ${isToday ? 'text-brand-primary' : 'text-text-primary'}`}>
                                                                {date.getDate()}
                                                            </span>
                                                        </div>
                                                    </th>
                                                );
                                            })}
                                        </tr>
                                        <tr className="bg-bg-secondary/10">
                                            <th className="sticky left-0 z-20 bg-white border-b border-r border-border-secondary"></th>
                                            {weekDates.map((date, idx) => {
                                                const isToday = new Date().toDateString() === date.toDateString();
                                                const bgClass = isToday ? 'bg-brand-primary/5' : 'bg-white';

                                                return (
                                                    <Fragment key={idx}>
                                                        <th className={`border-b border-r border-border-secondary py-2 px-1 text-center text-[10px] font-semibold text-text-tertiary uppercase tracking-wider w-[90px] ${bgClass}`}>
                                                            Clock In
                                                        </th>
                                                        <th className={`border-b border-r border-border-secondary py-2 px-1 text-center text-[10px] font-semibold text-text-tertiary uppercase tracking-wider w-[90px] ${bgClass}`}>
                                                            Clock Out
                                                        </th>
                                                    </Fragment>
                                                );
                                            })}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border-secondary">
                                        {filteredUserIds.map((userId, index) => (
                                            <TimeEntryRow
                                                key={userId}
                                                userId={userId}
                                                user={users[userId]}
                                                userEntries={timeEntriesGrid[userId]}
                                                weekDates={weekDates}
                                                roundingRules={roundingRulesByUser?.[userId] || null}
                                                showActualTime
                                                canManageTimeEntries={canManageTimeEntries}
                                                canModifyTimeEntries={canModifyTimeEntries(userId)}
                                                currentUser={user}
                                                deletingEntryId={deletingEntryId}
                                                onSubmitWeek={handleSubmitWeek}
                                                timesheetStatus={timesheetStatusByUser[userId]}
                                                isSubmitting={isSubmitting}
                                                onEditEntry={(entry, dateStr, uId) => {
                                                    setSelectedDate(dateStr);
                                                    setSelectedUserId(uId);
                                                    setEditingEntry(entry);
                                                    setShowEditModal(true);
                                                }}
                                                onDeleteEntry={handleDeleteEntry}
                                                onAddEntry={(dateStr, uId) => {
                                                    setSelectedDate(dateStr);
                                                    setSelectedUserId(uId);
                                                    setManualEntryErrors({});

                                                    // If there's an open session for this user+date, pre-fill clock-in
                                                    // and switch to "close existing session" mode
                                                    const dayEntry = timeEntriesGrid?.[uId]?.[dateStr];
                                                    const openSession = (dayEntry?.sessions || []).find(s => s.status === 'open');

                                                    if (openSession) {
                                                        const startedAt = openSession.startedAt
                                                            ? (typeof openSession.startedAt === 'string'
                                                                ? new Date(openSession.startedAt)
                                                                : openSession.startedAt)
                                                            : null;
                                                        const clockInStr = startedAt
                                                            ? `${String(startedAt.getHours()).padStart(2, '0')}:${String(startedAt.getMinutes()).padStart(2, '0')}`
                                                            : '';
                                                        setClosingSessionId(openSession.id || openSession.sessionId);
                                                        setManualEntryForm({ clockIn: clockInStr, clockOut: '', notes: '' });
                                                    } else {
                                                        setClosingSessionId(null);
                                                        setManualEntryForm({ clockIn: '', clockOut: '', notes: '' });
                                                    }

                                                    setShowManualEntryModal(true);
                                                }}
                                                formatTime={formatTime}
                                                getUserDisplayName={getUserDisplayName}
                                            />
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <ManualTimeEntryModal
                isOpen={showManualEntryModal}
                onClose={() => {
                    setShowManualEntryModal(false);
                    setClosingSessionId(null);
                }}
                userName={selectedUserId ? getUserDisplayName(selectedUserId) : ''}
                clockInTime={manualEntryForm.clockIn}
                clockOutTime={manualEntryForm.clockOut}
                notes={manualEntryForm.notes || ''}
                entryDate={selectedDate}
                errors={manualEntryErrors}
                clockInReadOnly={!!closingSessionId}
                isClosingSession={!!closingSessionId}
                onClockInChange={(value) => {
                    if (closingSessionId) return; // locked
                    setManualEntryForm({ ...manualEntryForm, clockIn: value });
                    setManualEntryErrors({ ...manualEntryErrors, clockIn: undefined, overlap: undefined });
                }}
                onClockOutChange={(value) => {
                    setManualEntryForm({ ...manualEntryForm, clockOut: value });
                    setManualEntryErrors({ ...manualEntryErrors, clockOut: undefined, overlap: undefined });
                }}
                onEntryDateChange={(value) => {
                    if (closingSessionId) return; // date is locked when closing a session
                    setSelectedDate(value);
                    setManualEntryErrors({ ...manualEntryErrors, date: undefined, overlap: undefined });
                }}
                onNotesChange={(value) => {
                    setManualEntryForm({ ...manualEntryForm, notes: value });
                }}
                weekDates={weekDates.map(d => formatISODate(d))}
                isLoading={isAddingManualEntry}
                onSubmit={validateAndAddManualEntry}
            />
            {/* Modal for editing SINGLE entry */}
            <EditTimeEntryModal
                isOpen={!!editingEntry && !editingEntry.isTimesheetEdit}
                onClose={() => setEditingEntry(null)}
                entry={editingEntry}
                userId={editingEntry?.userId || selectedUserId}
                dateStr={editingEntry?.date || (() => {
                    // Better date calculation for open sessions
                    if (editingEntry?.startedAt) {
                        let startDate;
                        if (editingEntry.startedAt.toDate) {
                            startDate = editingEntry.startedAt.toDate();
                        } else if (editingEntry.startedAt.seconds) {
                            startDate = new Date(editingEntry.startedAt.seconds * 1000);
                        } else if (typeof editingEntry.startedAt === 'string') {
                            startDate = new Date(editingEntry.startedAt);
                        } else {
                            startDate = new Date(editingEntry.startedAt);
                        }
                        return formatISODate(startDate);
                    }
                    return selectedDate || ''; // Fallback to selectedDate
                })()}
                userName={editingEntry?.userName || (users[editingEntry?.userId || selectedUserId]?.displayName) || ''}
                existingIntervals={(() => {
                    const uId = editingEntry?.userId || selectedUserId;
                    const dStr = editingEntry?.date || selectedDate;
                    if (!uId || !dStr) return [];
                    const dayEntry = timeEntriesGrid?.[uId]?.[dStr];
                    return buildExistingIntervalsForDate({
                        dateStr: dStr,
                        savedEntries: dayEntry?.savedEntries || [],
                        sessions: dayEntry?.sessions || []
                    });
                })()}
                onUpdate={handleUpdateSuccess}
            />
            <EditTimesheetModal
                isOpen={!!editingEntry && editingEntry.isTimesheetEdit}
                onClose={() => {
                    setShowEditModal(false);
                    setEditingEntry(null);
                }}
                timesheet={editingEntry}
                onSave={handleUpdateSuccess}
            />
        </div >
    );
};

export default TimeEntriesPage;
