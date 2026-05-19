import React, { useEffect, useState, useDeferredValue, useMemo } from 'react';

import { Search, User, Clock, CheckCircle, XCircle, Briefcase, Calendar, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import Header from '../../components/layout/Header';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Tabs from '../../components/ui/Tabs';
import { TimesheetTab } from '../profile/components/TimesheetTab';
import { useAuth } from '../../hooks/useAuth';
import { useNavigate, useLocation } from 'react-router-dom';
import { getManagedEmployeeIdsForManager } from '../../services/teams';
import { formatWeeklyCount } from '../../utils/numberFormatter';
import { WeeklyTimesheetCounter } from '../../services/weeklyTimesheetCounter';
import { getRoleName } from '../../utils/getRoleName';
import Loader from '../../components/ui/Loader';
import { DEFAULT_WEEK_START_DAY, describeWeek, formatISODate, shiftDateByWeeks } from '../../utils/weekStartUtils';
import TimesheetArchivePage from './TimesheetArchivePage';
import { usePaginatedUsers } from '../../hooks/usePaginatedUsers';
import { getUserById } from '../../services/users';

const normalizeRoleKey = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

const COMPANY_WIDE_ACCESS_ROLE_KEYS = new Set([
  'siteManager',
  'adminAdvisor',
  'adminManager',
  'hrAdvisor',
  'hrManager',
  'superuser',
  'seniorManager',
  'hrAdvisor',
  'hrManager',
  'owner'
].map(normalizeRoleKey));

const TimesheetManagementPage = ({ userRole = 'employee' }) => {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const currentUserId = user?.uid || user?.userId || null;

  const effectiveRoleKey = useMemo(
    () => normalizeRoleKey(user?.primaryRole || user?.role || userRole),
    [user?.primaryRole, user?.role, userRole]
  );

  const availableTabs = useMemo(() => {
    if (effectiveRoleKey === 'sitemanager') {
      return [{ label: 'All Timesheets' }];
    } else if (effectiveRoleKey === 'employee') {
      return [{ label: 'My Timesheet' }];
    } else {
      return [{ label: 'My Timesheet' }, { label: 'All Timesheets' }];
    }
  }, [effectiveRoleKey]);
  const [activeTab, setActiveTab] = useState(location.state?.activeTab || availableTabs[0].label);

  // Keep activeTab valid when the available tabs change (e.g. role resolves after auth loads)
  useEffect(() => {
    if (!availableTabs.some(t => t.label === activeTab)) {
      setActiveTab(availableTabs[0].label);
    }
  }, [availableTabs, activeTab]);
  const [mainTab, setMainTab] = useState('timesheet'); // 'timesheet' or 'browser'
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery); // ✅ Debounced search
  const [filterRole, setFilterRole] = useState('All Roles');

  const [employees, setEmployees] = useState([]);
  const [employeeRoster, setEmployeeRoster] = useState([]); // ✅ Cached roster
  const [isLoadingEmployees, setIsLoadingEmployees] = useState(false);
  const [userCache, setUserCache] = useState({}); // Cache for user data to avoid repeated fetches

  const SITE_OWNER_ROLE_KEYS = new Set(['superuser', 'siteowner', 'sitemanager', 'siteManager', 'owner']);

  const isSiteOwnerOrManager = (rawRole) => {
    const key = normalizeRoleKey(rawRole);
    return SITE_OWNER_ROLE_KEYS.has(key);
  };

  // Function to filter out Site Owner / Site Manager employees for HR advisors
  const filterEmployeesForHRAdvisor = async (employeesList) => {
    if (user?.role !== 'hrAdvisor') return employeesList;

    const filteredEmployees = [];
    const userIdsToCheck = new Set();

    // Work on a local copy so filtering uses the latest data immediately
    const effectiveUserCache = { ...userCache };

    // First pass: collect userIds that aren't already cached
    employeesList.forEach(emp => {
      // If we already know from primaryRole that this is a Site Owner / Site Manager,
      // don't bother fetching anything else – HR Advisor must not see them.
      if (emp.primaryRole && isSiteOwnerOrManager(emp.primaryRole)) {
        return;
      }

      if (emp.id && !effectiveUserCache[emp.id]) {
        userIdsToCheck.add(emp.id);
      }
    });

    // Fetch user data for uncached userIds in parallel
    const uncachedIds = Array.from(userIdsToCheck);
    if (uncachedIds.length > 0) {
      const usersData = await Promise.all(
        uncachedIds.map(async (userId) => {
          try {
            const userData = await getUserById(userId);
            return { userId, userData };
          } catch (error) {
            console.warn(`Failed to fetch user data for ${userId}:`, error);
            return { userId, userData: null };
          }
        })
      );

      usersData.forEach(({ userId, userData }) => {
        if (userData) {
          const userName =
            userData.displayName ||
            `${userData.firstName || ''} ${userData.lastName || ''}`.trim() ||
            userData.email ||
            '';

          effectiveUserCache[userId] = {
            name: userName,
            role: userData.role,
            primaryRole: userData.primaryRole
          };
        }
      });
    }

    // Persist the merged cache (non-blocking for filtering)
    if (Object.keys(userCache).length !== Object.keys(effectiveUserCache).length) {
      setUserCache(effectiveUserCache);
    }

    // Second pass: filter out superUser employees and unidentified users
    employeesList.forEach(emp => {
      const cachedUserData = effectiveUserCache[emp.id];
      const userRole = cachedUserData?.role;
      const userPrimaryRole = cachedUserData?.primaryRole;
      const userName = cachedUserData?.name;

      // HR advisors cannot see Site Owner / Site Manager employees
      if (
        isSiteOwnerOrManager(emp.primaryRole) ||
        isSiteOwnerOrManager(userPrimaryRole) ||
        isSiteOwnerOrManager(userRole)
      ) {
        return;
      }

      // Filter out unidentified users as requested
      if (!userName || userName === 'Unknown User') return;

      filteredEmployees.push(emp);
    });

    return filteredEmployees;
  };

  // Week Navigation State
  const [currentDate, setCurrentDate] = useState(new Date());
  const [weekStartDay, setWeekStartDay] = useState(DEFAULT_WEEK_START_DAY);

  // Load configured week start day
  useEffect(() => {
    const fetchWeekConfig = async () => {
      if (user?.companyId) {
        try {
          const { resolveWeekStartDay } = await import('../../services/weekStartConfig');
          const day = await resolveWeekStartDay(user.companyId);
          setWeekStartDay(day);
        } catch (e) {
          console.warn('Failed to resolve week start day', e);
        }
      }
    };
    fetchWeekConfig();
  }, [user?.companyId]);

  // Derived Week Info
  const weekInfo = React.useMemo(() => {
    return describeWeek(currentDate, weekStartDay);
  }, [currentDate, weekStartDay]);

  const handlePrevWeek = () => setCurrentDate(prev => shiftDateByWeeks(prev, -1, weekStartDay));
  const handleNextWeek = () => setCurrentDate(prev => shiftDateByWeeks(prev, 1, weekStartDay));
  const handleToday = () => setCurrentDate(new Date());

  // unique roles filter logic
  const availableRoles = React.useMemo(() => {
    const rolesFromData = Array.from(new Set(employees.map(emp => emp.role).filter(Boolean)));

    // If we have data, show only the roles that exist in the data (as requested)
    if (rolesFromData.length > 0) {
      return rolesFromData.sort();
    }

    // If no data is available yet, show static standard roles
    return [
      'Employee',
      'Team Manager',
      'HR Manager',
      'Admin Manager',
      'HR Advisor',
      'Admin Advisor',
      'Senior Manager'
    ].sort();
  }, [employees]);

  const [managedIds, setManagedIds] = useState(new Set());

  // Fetch managed employee IDs for filtering (Team Managers etc)
  useEffect(() => {
    const fetchManagedIds = async () => {
      const roleKey = normalizeRoleKey(user?.primaryRole || user?.role);
      if (user?.uid && user?.companyId && roleKey && !COMPANY_WIDE_ACCESS_ROLE_KEYS.has(roleKey)) {
        try {
          const ids = await getManagedEmployeeIdsForManager(user.uid, user.companyId);
          setManagedIds(new Set(ids));
        } catch (e) {
          console.error("Failed to fetch managed IDs", e);
        }
      }
    };
    fetchManagedIds();
  }, [user?.uid, user?.companyId, user?.primaryRole, user?.role]);

  // Filter employees based on search query, role filter, and manager permissions
  const filteredEmployees = React.useMemo(() => {
    let filtered = [...employees];

    // Security: Filter by managed members if not a company-wide role
    const roleKey = normalizeRoleKey(user?.primaryRole || user?.role);
    if (roleKey && !COMPANY_WIDE_ACCESS_ROLE_KEYS.has(roleKey)) {
      filtered = filtered.filter(emp => managedIds.has(emp.id) || emp.id === user.uid);
    }

    // Apply search filter (using deferred value to prevent lag on large lists)
    if (deferredSearchQuery.trim()) {
      const query = deferredSearchQuery.toLowerCase().trim();
      filtered = filtered.filter(emp => {
        const name = (emp.name || '').toLowerCase();
        const email = (emp.email || '').toLowerCase();
        // Check if employee has phone field (if available in data)
        const phone = (emp.phone || emp.phoneNumber || '').toLowerCase();
        return name.includes(query) || email.includes(query) || phone.includes(query);
      });
    }

    // Apply role filter
    if (filterRole !== 'All Roles') {
      filtered = filtered.filter(emp => emp.role === filterRole);
    }

    return filtered;
  }, [employees, deferredSearchQuery, filterRole, managedIds, user?.uid, user?.primaryRole, user?.role]); // ✅ Using deferred query

  // In "All Timesheets", don't show the currently logged-in user (requested behavior)
  // COMMENTED OUT: Filter disabled - now showing all users including current user
  const visibleEmployees = useMemo(() => {
    // if (activeTab !== 'All Timesheets') return filteredEmployees;
    // if (!currentUserId) return filteredEmployees;
    // return filteredEmployees.filter(emp => emp?.id !== currentUserId);
    return filteredEmployees;
  }, [activeTab, filteredEmployees, currentUserId]);






  // --- Pagination Hook ---
  // Using the same hook as UserListPage to efficiently load users
  const {
    users: paginatedUsers,
    loadMore,
    hasMore,
    loading: isPaginatedLoading,
    reload: reloadPaginated
  } = usePaginatedUsers(user?.companyId, 20);

  // Sync paginated users to local 'employees' state with Timesheet Counts
  useEffect(() => {
    const enrichUsersWithStats = async () => {
      if (paginatedUsers.length === 0) {
        setEmployees([]);
        return;
      }

      setIsLoadingEmployees(true);
      try {
        // 2. Batch Fetch Timesheets for ONLY these users (No Week Filter - as requested)
        const userIds = paginatedUsers.map(u => u.id || u.uid).filter(Boolean);
        const userTimesheetsMap = await WeeklyTimesheetCounter.getTimesheetsForUsersBatch(userIds); // Fetch all history (12mo)

        // 3. Merge Stats
        const { resolveWeekStartDay } = await import('../../services/weekStartConfig');

        // PRE-RESOLVE Week Start Configs in batch to avoid sequential awaits
        const companySitePairs = Array.from(new Set(paginatedUsers.map(u => `${u.companyId}|${u.siteId || ''}`)));
        const weekStartConfigs = new Map();

        await Promise.all(companySitePairs.map(async (pair) => {
          const [cid, sid] = pair.split('|');
          const day = await resolveWeekStartDay(cid, sid);
          weekStartConfigs.set(pair, day || DEFAULT_WEEK_START_DAY);
        }));

        const enriched = await Promise.all(paginatedUsers.map(async (u) => {
          // Handle potential ID mismatch (uid vs id)
          const uid = u.id || u.uid;
          const userTimesheets = userTimesheetsMap.get(uid) || [];

          const employeeWeekStart = weekStartConfigs.get(`${u.companyId}|${u.siteId || ''}`) || DEFAULT_WEEK_START_DAY;
          const weeklyCounts = await WeeklyTimesheetCounter.calculateWeeklyCounts(userTimesheets, employeeWeekStart);

          // Normalize for Table
          const name = u.displayName || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email;
          const hireDate = u.createdAt?.toDate ? u.createdAt.toDate().toLocaleDateString() : (u.hireDate || '—');

          return {
            ...u,
            id: uid, // ensure ID is set for keys
            name,
            hireDate,
            role: getRoleName(u.primaryRole),
            department: u.teamId || '—',
            // Add stats
            totalTimesheets: weeklyCounts.total,
            approved: weeklyCounts.approved,
            pending: weeklyCounts.pending,
            rejected: weeklyCounts.rejected,
            draft: weeklyCounts.draft,
          };
        }));

        // Apply HR advisor filtering to remove superUser (site owner) employees
        const filteredEnriched = await filterEmployeesForHRAdvisor(enriched);

        // Exclude siteManager role users as they do not have timesheets
        const finalEmployees = filteredEnriched.filter(emp =>
          normalizeRoleKey(emp.primaryRole) !== 'sitemanager' &&
          normalizeRoleKey(emp.role) !== 'sitemanager'
        );

        setEmployees(finalEmployees);
      } catch (e) {
        console.error('Failed to enrich users with timesheet stats', e);
      } finally {
        setIsLoadingEmployees(false);
      }
    };

    enrichUsersWithStats();
  }, [paginatedUsers]); // Re-run when users change (Week navigation removed per request)

  // Trigger initial load when activeTab becomes 'All Timesheets'
  useEffect(() => {
    if (activeTab === 'All Timesheets' && user?.companyId && paginatedUsers.length === 0 && !isPaginatedLoading) {
      loadMore();
    }
  }, [activeTab, user?.companyId, loadMore, paginatedUsers.length, isPaginatedLoading]);


  const handleViewTimesheets = (employeeId) => {
    navigate(`/timesheets/${employeeId}`);
  };

  const pretty = (role) =>
    role.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());

  return (
    <div className="h-screen flex flex-col overflow-hidden">

      <Header
        title={`${pretty(user?.role || userRole)} Dashboard`}
        subtitle="Ensure compliance and manage onboarding from one place."
      />

      <main className="flex-1 overflow-y-auto p-3xl space-y-3xl scrollbar-custom">
        <div className="max-w-7xl mx-auto">
          {/* Main Tab Navigation */}
          <div className="flex items-center space-x-4 mb-6 border-b border-gray-200">
            <button
              onClick={() => setMainTab('timesheet')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${mainTab === 'timesheet'
                ? 'border-purple-600 text-purple-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              Timesheet
            </button>
            <button
              onClick={() => setMainTab('browser')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${mainTab === 'browser'
                ? 'border-purple-600 text-purple-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              Timesheet Browser
            </button>
          </div>

          {mainTab === 'timesheet' && (
            <>
              {isLoading || !user ? (
                <div className="flex items-center justify-center h-40">
                  <Loader variant="spinner" size="lg" text="Loading page..." />
                </div>
              ) : (
                <>
                  {/* Page Title */}
                  <div className="mb-4xl">
                    <h1 className="text-2xl md:text-3xl font-bold text-text-primary">Timesheet Management</h1>
                    <p className="text-sm text-text-secondary mt-1">Manage your timesheets and team submissions</p>
                  </div>

                  {/* Tabs - Only show if user has more than one tab */}
                  {availableTabs.length > 1 && (
                    <Tabs
                      tabs={availableTabs}
                      activeTab={activeTab}
                      onTabChange={(tab) => setActiveTab(tab)}
                    />
                  )}

                  {/* Tab Content */}
                  <div className="mt-4xl">
                    {/* My Timesheet Tab - Uses existing TimesheetTab component */}
                    {activeTab === 'My Timesheet' && (
                      <TimesheetTab />
                    )}

                    {/* All Timesheets Tab - Shows employee cards */}
                    {activeTab === 'All Timesheets' && (
                      <div className="space-y-4xl">
                        {/* Week Navigation & Stats Header */}
                        {/* <div className="bg-white border border-border-secondary rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm">
                          <div className="flex items-center gap-4">
                            <div className="p-2 bg-bg-accent-purple-light rounded-lg">
                              <Calendar className="w-5 h-5 text-text-accent-purple" />
                            </div>
                            <div>
                              <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider">Current Period</h3>
                              <p className="text-lg font-bold text-text-primary">
                                {weekInfo.startLabel} - {weekInfo.endLabel}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center bg-bg-secondary rounded-lg p-1">
                            <button
                              onClick={handlePrevWeek}
                              className="p-3 hover:bg-white hover:shadow-sm rounded-md transition-all text-text-secondary hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-purple-500"
                              title="Previous Week"
                              aria-label="Previous Week"
                            >
                              <ChevronLeft className="w-5 h-5" />
                            </button>
                            <button
                              onClick={handleToday}
                              className="px-6 py-2 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-white hover:shadow-sm rounded-md transition-all focus:outline-none focus:ring-2 focus:ring-purple-500"
                              aria-label="View current week"
                            >
                              Today
                            </button>
                            <button
                              onClick={handleNextWeek}
                              className="p-3 hover:bg-white hover:shadow-sm rounded-md transition-all text-text-secondary hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-purple-500"
                              title="Next Week"
                              aria-label="Next Week"
                            >
                              <ChevronRight className="w-5 h-5" />
                            </button>
                          </div>
                        </div> */}

                        {/* Search and Filter */}
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                          <div className="relative w-full sm:w-96">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-text-secondary" />
                            <input
                              type="text"
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              placeholder="search by name or phone or email..."
                              id="timesheet-search"
                              aria-label="Search timesheets by name, phone or email"
                              className="w-full h-12 pl-12 pr-4 border border-border-secondary rounded-full text-sm placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
                            />
                          </div>

                          <div className="flex items-center gap-3">
                            <label htmlFor="timesheet-role-filter" className="text-sm text-text-secondary">Filter by:</label>
                            <select
                              id="timesheet-role-filter"
                              value={filterRole}
                              onChange={(e) => setFilterRole(e.target.value)}
                              aria-label="Filter by employee role"
                              className="px-4 py-2 border border-border-secondary rounded-lg text-sm focus:outline-none focus:border-border-accent-purple"
                            >
                              <option>All Roles</option>
                              {availableRoles.map(role => (
                                <option key={role} value={role}>{role}</option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {/* Employee Cards */}
                        {isLoadingEmployees || isPaginatedLoading ? (
                          <div className="flex items-center justify-center h-40">
                            <Loader variant="pulse" size="md" text="Fetching employee data..." />
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {visibleEmployees.length > 0 ? (visibleEmployees.map((employee) => (
                              <div key={employee.id} className="bg-white border border-border-accent-purple rounded-lg p-4xl shadow-sm hover:shadow-md transition-shadow">
                                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-start gap-6">
                                  {/* Employee Info */}
                                  <div className="flex items-center gap-4 flex-1">
                                    <div className="w-12 h-12 bg-bg-accent-purple-light rounded-full flex items-center justify-center flex-shrink-0">
                                      <User className="h-6 w-6 text-text-accent-purple" />
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                                        <h3 className="text-lg font-semibold text-text-primary">{employee.name}</h3>
                                        <Badge variant={employee.role === 'Team Manager' ? 'role' : 'info'}>
                                          {employee.role}
                                        </Badge>
                                      </div>
                                      <p className="text-sm text-text-secondary mb-2">{employee.email}</p>
                                      <div className="flex flex-wrap items-center gap-4 text-sm">
                                        {/* <span className="flex items-center gap-1 text-purple-500">
                                      <Briefcase className="h-3 w-3" />
                                      {employee.department}
                                    </span> */}
                                        <span className="flex items-center gap-1 text-blue-500">
                                          <Calendar className="h-3 w-3" />
                                          Hired: {employee.hireDate}
                                        </span>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Stats and Button */}
                                  <div className="flex flex-wrap sm:justify-end justify-center w-full lg:w-auto items-center gap-6 lg:gap-8">
                                    <div className="text-center">
                                      <div className="flex items-center justify-center gap-2 mb-1">
                                        <Clock className="h-5 w-5 text-blue-500" />
                                        <p className="text-3xl font-bold text-blue-500">{formatWeeklyCount(employee.totalTimesheets)}</p>
                                      </div>
                                      <p className="text-xs font-medium text-gray-600">Total</p>
                                    </div>
                                    <div className="text-center">
                                      <div className="flex items-center justify-center gap-2 mb-1">
                                        <CheckCircle className="h-5 w-5 text-green-500" />
                                        <p className="text-3xl font-bold text-green-500">{formatWeeklyCount(employee.approved)}</p>
                                      </div>
                                      <p className="text-xs font-medium text-gray-600">Approved</p>
                                    </div>
                                    <div className="text-center">
                                      <div className="flex items-center justify-center gap-2 mb-1">
                                        <AlertTriangle className="h-5 w-5 text-orange-500" />
                                        <p className="text-3xl font-bold text-orange-500">{formatWeeklyCount(employee.pending)}</p>
                                      </div>
                                      <p className="text-xs font-medium text-gray-600">Pending</p>
                                    </div>
                                    <div className="text-center">
                                      <div className="flex items-center justify-center gap-2 mb-1">
                                        <Clock className="h-5 w-5 text-gray-500" />
                                        <p className="text-3xl font-bold text-gray-500">{formatWeeklyCount(employee.draft)}</p>
                                      </div>
                                      <p className="text-xs font-medium text-gray-600">Draft</p>
                                    </div>
                                    <Button
                                      variant="outline-primary"
                                      onClick={() => handleViewTimesheets(employee.id)}
                                      cn="sm:max-w-40 w-full"
                                    >
                                      View Timesheets
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            ))) : (
                              <div className="bg-white border border-border-primary rounded-lg p-8 text-center">
                                <User className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                                  {searchQuery || filterRole !== 'All Roles'
                                    ? 'No employees match your search criteria'
                                    : 'No timesheets applications found'}
                                </h3>
                                <p className="text-gray-600">
                                  {searchQuery || filterRole !== 'All Roles'
                                    ? 'Try adjusting your search or filter options.'
                                    : 'No employees have submitted any timesheet yet.'}
                                </p>
                              </div>
                            )}

                            {/* Load More Button */}
                            {hasMore && !searchQuery && filterRole === 'All Roles' && (
                              <div className="flex justify-center pt-8">
                                <Button
                                  variant="outline-primary"
                                  onClick={loadMore}
                                  disabled={isPaginatedLoading}
                                  cn="px-8"
                                >
                                  {isPaginatedLoading ? 'Loading...' : 'Load More Employees'}
                                </Button>
                              </div>
                            )}

                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {mainTab === 'browser' && (
            <TimesheetArchivePage isEmbedded={true} />
          )}
        </div>
      </main>
    </div>
  );
};

export default TimesheetManagementPage;