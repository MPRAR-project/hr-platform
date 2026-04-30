import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useUI } from '../../hooks/useUI';
import { useCache } from '../../contexts/CacheContext';
import { getSites } from '../../services/sites';
import { getUsersByCompany } from '../../services/users';
import { fetchCompanyDetails } from '../../services/companyService';
import { getSchedules } from '../../services/scheduleService';
import { getTimesheetsByWeek } from '../../services/timesheets';
import { resolveWeekStartDay } from '../../services/weekStartConfig';
import { getWeekRangeForDate, formatISODate, shiftDateByWeeks } from '../../utils/weekStartUtils';
import { getWorkLocations } from '../../services/workLocations';
import { getVerificationStatus, formatDistance } from '../../services/locationService';
import { ChevronLeft, ChevronRight, Calendar, MapPin, Clock, CheckCircle, XCircle, AlertCircle, FileText, Filter, MousePointerClick, Menu, Map, UserCheck } from 'lucide-react';
import SessionLocationModal from '../../components/modals/SessionLocationModal';
import NotificationBell from '../../components/common/NotificationBell';

// Lazy load map component to avoid render-blocking CSS/JS
const LocationVerificationMap = React.lazy(() => import('../../components/maps/LocationVerificationMap'));


const ActivityOversightPage = () => {
    const { user } = useAuth();
    const { openSidebar } = useUI();
    const { getItem, setItem } = useCache();
    const [loading, setLoading] = useState(true);
    const [currentDate, setCurrentDate] = useState(new Date());
    const [sites, setSites] = useState([]);
    const [schedules, setSchedules] = useState([]);
    const [timesheets, setTimesheets] = useState([]);
    const [usersMap, setUsersMap] = useState({});
    const [workLocations, setWorkLocations] = useState([]);
    const [workLocationsMap, setWorkLocationsMap] = useState({});
    const [filterSiteId, setFilterSiteId] = useState('all');
    const [weekStart, setWeekStart] = useState(null);
    const [weekEnd, setWeekEnd] = useState(null);
    const [weekStartDay, setWeekStartDay] = useState('monday');
    const [companyName, setCompanyName] = useState('My Company');
    const [viewMode, setViewMode] = useState('list'); // 'list' or 'grouped'

    // Refs to avoid duplicate fetches
    const lastFetchRef = useRef(null);
    const fetchInProgressRef = useRef(false);

    useEffect(() => {
        const initWeekConfig = async () => {
            if (user?.companyId) {
                const ws = await resolveWeekStartDay(user.companyId);
                setWeekStartDay(ws);
            }
        };
        initWeekConfig();
    }, [user?.companyId]);

    useEffect(() => {
        if (!weekStartDay) return;
        const { start, end } = getWeekRangeForDate(currentDate, weekStartDay);
        setWeekStart(start);
        setWeekEnd(end);
    }, [currentDate, weekStartDay]);

    useEffect(() => {
        if (weekStart && weekEnd) {
            const cacheKey = `${user?.companyId}_${formatISODate(weekStart)}_${formatISODate(weekEnd)}`;
            if (lastFetchRef.current === cacheKey || fetchInProgressRef.current) return;
            fetchData(cacheKey);
        }
    }, [weekStart, weekEnd, user]);

    const fetchData = async (cacheKey) => {
        if (!user?.companyId || !weekStart || !cacheKey) return;
        lastFetchRef.current = cacheKey;
        fetchInProgressRef.current = true;
        
        // 1. Try cache first (instant)
        const cached = getItem(cacheKey);
        if (cached && cached.sites && cached.usersMap && cached.schedules && cached.timesheets) {
            setSites(cached.sites);
            setUsersMap(cached.usersMap);
            setWorkLocations(cached.workLocations || []);
            setWorkLocationsMap(cached.workLocationsMap || {});
            setSchedules(cached.schedules);
            setTimesheets(cached.timesheets);
            if (cached.companyName) setCompanyName(cached.companyName);
            setLoading(false);
            // Optional: background refresh to keep data fresh
            void (async () => {
                try {
                    await fetchFromNetwork(cacheKey);
                } catch {}
            })();
            return;
        }

        // 2. No cache: fetch from network (show loading)
        await fetchFromNetwork(cacheKey);
    };

    const fetchFromNetwork = async (cacheKey) => {
        const t0 = performance.now();
        setLoading(true);
        try {
            // 1. Fetch Sites, Users, and Work Locations
            const t1 = performance.now();
            const [sitesData, usersData, workLocationsData, companyData] = await Promise.all([
                getSites(user.companyId),
                getUsersByCompany(user.companyId),
                getWorkLocations(user.companyId),
                fetchCompanyDetails(user.companyId)
            ]);
            console.log('[ActivityOversight] Phase 1 (sites/users/locations) took', (performance.now() - t1).toFixed(0), 'ms');
            setSites(sitesData);
            setWorkLocations(workLocationsData);
            if (companyData && companyData.company && companyData.company.name) {
                setCompanyName(companyData.company.name);
            }

            // Create User Map for quick lookup
            const userMap = usersData.reduce((acc, u) => {
                acc[u.id] = u;
                return acc;
            }, {});
            setUsersMap(userMap);

            // Create Work Locations Map for quick lookup
            const workLocMap = workLocationsData.reduce((acc, loc) => {
                acc[loc.id] = loc;
                return acc;
            }, {});
            setWorkLocationsMap(workLocMap);

            // 2. Fetch Schedules and Timesheets in parallel
            const t2 = performance.now();
            const [allSchedules, weeklyTimesheets] = await Promise.all([
                getSchedules(user.companyId),
                getTimesheetsByWeek(user.companyId, formatISODate(weekStart))
            ]);
            console.log('[ActivityOversight] Phase 2 (schedules+timesheets) took', (performance.now() - t2).toFixed(0), 'ms');

            const weeklySchedules = allSchedules.filter(s => {
                const start = new Date(s.start);
                return start >= weekStart && start <= weekEnd;
            });
            setSchedules(weeklySchedules);
            setTimesheets(weeklyTimesheets);

            // Cache everything for instant next load
            setItem(cacheKey, {
                sites: sitesData,
                usersMap: userMap,
                workLocations: workLocationsData,
                workLocationsMap: workLocMap,
                schedules: weeklySchedules,
                timesheets: weeklyTimesheets,
                companyName: companyData?.company?.name || 'My Company'
            }, 5 * 60 * 1000); // 5 minutes TTL

            console.log('[ActivityOversight] Total fetch time', (performance.now() - t0).toFixed(0), 'ms');

            // Debug: Log unique site IDs from timesheets
            const timesheetSiteIds = new Set(weeklyTimesheets.map(t => t.siteId).filter(Boolean));
            console.log('[ActivityOversight] Unique site IDs in timesheets:', Array.from(timesheetSiteIds));


        } catch (error) {
            console.error("Error fetching oversight data:", error);
        } finally {
            setLoading(false);
            fetchInProgressRef.current = false;
        }
    };

    const handlePrevWeek = () => setCurrentDate(prev => shiftDateByWeeks(prev, -1, weekStartDay));
    const handleNextWeek = () => setCurrentDate(prev => shiftDateByWeeks(prev, 1, weekStartDay));

    // --- Data Aggregation (Robust) ---
    // [FIX] Update aggregation to handle overlapping timesheets ("Twin Weeks")
    // If a user has multiple timesheets for this site in the same "fetch week", we must merge them
    // so that the Oversight Page shows ALL activity, not just the first one found.
    const aggregatedData = sites.reduce((acc, site) => {
        // Filter items for this site
        const siteSchedules = schedules.filter(s => s.siteId === site.id);

        // Find ALL timesheets relevant to this site
        const siteTimesheets = timesheets.filter(t => {
            // 1. Check Root Site ID (Document Level)
            const tSiteId = t.siteId && t.siteId.includes('/') ? t.siteId.split('/').pop() : t.siteId;
            if (tSiteId === site.id) return true;

            // 2. Check Entries for execution at this site (Entry Level)
            if (t.entries && t.entries.length > 0) {
                return t.entries.some(e => {
                    const eSiteId = e.siteId && e.siteId.includes('/') ? e.siteId.split('/').pop() : e.siteId;
                    return eSiteId === site.id;
                });
            }
            return false;
        });

        // Get unique users from both
        const userIds = new Set([
            ...siteSchedules.map(s => s.employeeId),
            ...siteTimesheets.map(t => t.userId)
        ]);

        const usersData = Array.from(userIds).map(uid => {
            // Find user specific data
            const userSchedule = siteSchedules.filter(s => s.employeeId === uid);

            // [FIX] Multiple Timesheets Support
            // Instead of finding *one* timesheet, find *all* for this user at this site.
            const userDocs = siteTimesheets.filter(t => t.userId === uid);

            // Aggregation: Create a "Unified" Timesheet View Model
            let unifiedTimesheet = null;

            if (userDocs.length > 0) {
                // Determine Main Status (Approved takes precedence for display if mixed?)
                // Or "Pending" if any are pending. Prioritize "Attended Actions".
                const statuses = userDocs.map(d => d.status || 'draft');
                const hasPending = statuses.includes('pending');
                const hasRejected = statuses.includes('rejected');
                const hasApproved = statuses.includes('approved');

                const mainStatus = hasPending ? 'pending' : (hasRejected ? 'rejected' : (hasApproved ? 'approved' : 'draft'));

                // Merge Entries
                // Filter entries to ensuring they belong to THIS SITE and THIS WEEK (visual range)
                // Note: The loop outer filter already checked site relevance, but rigorous filtering here is safer.
                const allEntries = [];
                const seenEntryIds = new Set();
                let docTotalEff = 0;
                let docTotalGross = 0;

                const weekStartIso = weekStart ? weekStart.toISOString().split('T')[0] : '';
                const weekEndIso = weekEnd ? weekEnd.toISOString().split('T')[0] : '';

                // Sort docs by date to keep entries somewhat ordered (though we re-sort entries anyway)
                userDocs.sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));

                userDocs.forEach(doc => {
                    if (doc.entries) {
                        doc.entries.forEach(e => {
                            // Deduplicate
                            const key = e.id || e.sessionId || `${e.date}_${e.clockIn}`;
                            if (seenEntryIds.has(key)) return;
                            seenEntryIds.add(key);

                            // Date Filter (Visual Range)
                            if (weekStartIso && weekEndIso) {
                                if (e.date < weekStartIso || e.date > weekEndIso) return;
                            }

                            allEntries.push(e);
                        });
                    }

                    // Accumulate raw totals (fallback if no entries)
                    // Note: This might double count if we aren't careful, but since we rely on entries for display, it's okay.
                    // Actually, for "Total Hours" display, we should recalculate from entries if possible.
                    if (doc.totals) {
                        docTotalEff += (doc.totals.effectiveSec || 0);
                        docTotalGross += (doc.totals.grossSec || 0);
                    }
                });

                // Re-calculate totals from Unified Entries (More accurate for visual range)
                const unifiedEffective = allEntries.reduce((sum, e) => sum + (e.effectiveSec || 0), 0);
                const unifiedGross = allEntries.reduce((sum, e) => sum + (e.grossSec || 0), 0);
                const unifiedOvertime = allEntries.reduce((sum, e) => sum + (e.overtimeSec || 0), 0);

                unifiedTimesheet = {
                    id: userDocs[0].id, // Use first ID as stable key
                    userId: uid,
                    siteId: site.id,
                    status: mainStatus,
                    entries: allEntries,
                    totals: {
                        effectiveSec: unifiedEffective,
                        grossSec: unifiedGross,
                        overtimeSec: unifiedOvertime
                    },
                    // Keep references to source docs
                    sourceDocs: userDocs.map(d => d.id)
                };
            }

            return {
                userId: uid,
                schedule: userSchedule,
                timesheet: unifiedTimesheet,
                // Find timesheets for this user at OTHER sites (excluding the docs we just used)
                otherTimesheets: timesheets.filter(t => t.userId === uid && !userDocs.includes(t)),
                user: usersMap[uid] || { displayName: 'Unknown', primaryRole: 'N/A' }
            };
        });

        if (usersData.length > 0) {
            acc.push({
                site,
                users: usersData
            });
        } else if (filterSiteId === 'all' || filterSiteId === site.id) {
            acc.push({ site, users: [] });
        }
        return acc;
    }, []);

    const filteredData = filterSiteId === 'all'
        ? aggregatedData
        : aggregatedData.filter(d => d.site.id === filterSiteId);

    // Helper map for site names
    const siteNameMap = sites.reduce((acc, s) => ({ ...acc, [s.id]: s.name }), {});

    // Helper function to get site name with better fallback logic
    const getSiteName = (siteId) => {
        if (!siteId) return 'No Site';

        // Try direct lookup first
        if (siteNameMap[siteId]) return siteNameMap[siteId];

        // Try extracting ID from 'sites/xyz' format
        const extractedId = siteId.includes('/') ? siteId.split('/').pop() : siteId;
        if (siteNameMap[extractedId]) return siteNameMap[extractedId];

        // Try finding by matching the end of the ID
        const matchingSite = sites.find(s =>
            s.id === siteId ||
            s.id === extractedId ||
            siteId.endsWith(s.id) ||
            siteId.includes(s.id)
        );

        if (matchingSite) return matchingSite.name;

        // Site not found - likely deleted
        return `Deleted Site`;
    };


    return (
        <div className="p-4 sm:p-6 max-w-[1600px] mx-auto">
            {/* Header Section */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6 mb-6">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                    {/* Left: Title Section */}
                    <div className="flex items-center gap-3">
                        <button type="button" onClick={openSidebar} className="lg:hidden p-2 hover:bg-gray-100 rounded-md transition-colors">
                            <Menu className="h-6 w-6 text-gray-700" />
                        </button>
                        <div>
                            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Activity Oversight</h1>
                            <p className="text-xs sm:text-sm text-gray-500 mt-0.5">Weekly summary of schedules, attendance, and notes.</p>
                        </div>
                    </div>

                    {/* Right: Controls Section */}
                    <div className="flex flex-wrap items-center gap-3">
                        <NotificationBell />

                        {/* Week Navigation */}
                        <div className="flex items-center gap-2 bg-gray-50 p-1.5 rounded-lg border border-gray-200">
                            <button onClick={handlePrevWeek} className="p-2 hover:bg-white rounded-md transition-colors">
                                <ChevronLeft size={18} className="text-gray-600" />
                            </button>
                            <div className="flex items-center gap-1.5 px-2">
                                <Calendar size={16} className="text-gray-500" />
                                <span className="text-sm font-semibold text-gray-700 whitespace-nowrap">
                                    {weekStart && weekEnd ?
                                        `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                                        : 'Loading...'}
                                </span>
                            </div>
                            <button onClick={handleNextWeek} className="p-2 hover:bg-white rounded-md transition-colors">
                                <ChevronRight size={18} className="text-gray-600" />
                            </button>
                        </div>

                        {/* Site Filter */}
                        <div className="flex items-center gap-2 bg-gray-50 px-3 py-2 rounded-lg border border-gray-200">
                            <Filter size={16} className="text-gray-500" />
                            <select
                                className="bg-transparent border-none text-sm font-medium text-gray-700 focus:outline-none focus:ring-0 cursor-pointer"
                                value={filterSiteId}
                                onChange={(e) => setFilterSiteId(e.target.value)}
                                aria-label="Filter by Site"
                            >
                                <option value="all">All Sites</option>
                                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* View Toggle */}
                    <div className="flex w-fit bg-gray-100 p-1 rounded-lg border border-gray-200">
                        <button
                            onClick={() => setViewMode('list')}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${viewMode === 'list'
                                ? 'bg-white text-gray-800 shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                                }`}
                        >
                            List View
                        </button>
                        <button
                            onClick={() => setViewMode('grouped')}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${viewMode === 'grouped'
                                ? 'bg-white text-gray-800 shadow-sm'
                                : 'text-gray-500 hover:text-gray-700'
                                }`}
                        >
                            By Location
                        </button>
                    </div>
                </div>
            </div>

            {
                loading ? (
                    <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-600"></div></div>
                ) : (
                    <div className="space-y-8">
                        {filteredData.map(({ site, users }) => (
                            <div key={site.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                                <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex items-center gap-3">
                                    <div className="bg-purple-100 p-2 rounded-lg">
                                        <MapPin className="text-purple-600" size={20} />
                                    </div>
                                    <div>
                                        <h2 className="font-bold text-gray-800 text-lg">{companyName}</h2>
                                        {/* Client requested change from Site Name to Company Name */}
                                        {/* <h2 className="font-bold text-gray-800 text-lg">{site.name}</h2> */}
                                        <p className="text-xs text-gray-500">{
                                            typeof site.address === 'object' && site.address !== null
                                                ? (site.address.line1 || site.address.raw || site.address.text || 'Address format not supported')
                                                : (site.address || 'No address')
                                        }</p>
                                    </div>
                                    <div className="ml-auto">
                                        <span className="bg-white px-3 py-1 rounded-full text-xs font-medium border shadow-sm">
                                            {users.length} Active Users
                                        </span>
                                    </div>
                                </div>

                                <div className="overflow-x-auto">
                                    {users.length === 0 ? (
                                        <div className="p-8 text-center text-gray-400 italic">No activity or schedules for this week.</div>
                                    ) : (
                                        <>
                                            {viewMode === 'list' ? (
                                                <>
                                                    {/* Desktop Table View */}
                                                    <table className="hidden md:table w-full text-sm">
                                                        <thead className="bg-gray-50/50 text-gray-500 font-medium border-b">
                                                            <tr>
                                                                <th className="px-4 py-3 text-left" style={{ width: '15%' }}>Employee</th>
                                                                <th className="px-4 py-3 text-left" style={{ width: '18%' }}>Schedule</th>
                                                                <th className="px-4 py-3 text-left" style={{ width: '20%' }}>Activity</th>
                                                                <th className="px-4 py-3 text-left" style={{ width: '12%' }}>Location</th>
                                                                <th className="px-4 py-3 text-left" style={{ width: '15%' }}>GPS Status</th>
                                                                <th className="px-4 py-3 text-left" style={{ width: '20%' }}>Notes</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-gray-100">
                                                            {users.map((userData, idx) => (
                                                                <UserRow
                                                                    key={userData.userId || idx}
                                                                    data={userData}
                                                                    weekStart={weekStart}
                                                                    currentSiteId={site.id}
                                                                    siteNameMap={siteNameMap}
                                                                    getSiteName={getSiteName}
                                                                    workLocationsMap={workLocationsMap}
                                                                />
                                                            ))}
                                                        </tbody>
                                                    </table>

                                                    {/* Mobile Card View */}
                                                    <div className="md:hidden space-y-4 p-4">
                                                        {users.map((userData, idx) => (
                                                            <MobileUserCard
                                                                key={userData.userId || idx}
                                                                data={userData}
                                                                currentSiteId={site.id}
                                                                getSiteName={getSiteName}
                                                                workLocationsMap={workLocationsMap}
                                                            />
                                                        ))}
                                                    </div>
                                                </>
                                            ) : (
                                                // Grouped View
                                                <div className="space-y-6 p-4">
                                                    {(() => {
                                                        // Group users by Location
                                                        const groupedUsers = users.reduce((acc, userData) => {
                                                            // Determine primary location from schedule or timesheet
                                                            let locationId = 'unassigned';

                                                            // Priority 1: Scheduled Location containing the majority of shifts? 
                                                            // Simplification: First valid location found in schedule
                                                            const firstShift = userData.schedule?.find(s => s.locationId);
                                                            if (firstShift) locationId = firstShift.locationId;

                                                            // Priority 2: Timesheet entries location?
                                                            if (locationId === 'unassigned' && userData.timesheet?.entries) {
                                                                const firstEntry = userData.timesheet.entries.find(e => e.location?.assignedLocationId);
                                                                if (firstEntry) locationId = firstEntry.location.assignedLocationId;
                                                            }

                                                            if (!acc[locationId]) acc[locationId] = [];
                                                            acc[locationId].push(userData);
                                                            return acc;
                                                        }, {});

                                                        // Prepare groups for rendering
                                                        const locationGroups = Object.keys(groupedUsers).map(locId => ({
                                                            id: locId,
                                                            name: locId === 'unassigned' ? 'Unassigned / General' : (workLocationsMap[locId]?.name || 'Unknown Location'),
                                                            users: groupedUsers[locId]
                                                        })).sort((a, b) => {
                                                            if (a.id === 'unassigned') return 1; // Put unassigned last
                                                            if (b.id === 'unassigned') return -1;
                                                            return a.name.localeCompare(b.name);
                                                        });

                                                        return locationGroups.map(group => (
                                                            <div key={group.id} className="border border-gray-100 rounded-lg overflow-hidden">
                                                                <div className="bg-gray-50/80 px-4 py-2 border-b border-gray-100 flex items-center gap-2">
                                                                    <MapPin size={14} className="text-gray-500" />
                                                                    <h3 className="font-semibold text-gray-700 text-sm">{group.name}</h3>
                                                                    <span className="text-xs text-gray-400 ml-auto">{group.users.length} People</span>
                                                                </div>
                                                                <table className="w-full text-sm">
                                                                    {/* Hide header for inner tables to reduce clutter, or keep simplified */}
                                                                    <tbody className="divide-y divide-gray-100">
                                                                        {group.users.map((userData, idx) => (
                                                                            <UserRow
                                                                                key={userData.userId || idx}
                                                                                data={userData}
                                                                                weekStart={weekStart}
                                                                                currentSiteId={site.id}
                                                                                siteNameMap={siteNameMap}
                                                                                getSiteName={getSiteName}
                                                                                workLocationsMap={workLocationsMap}
                                                                            />
                                                                        ))}
                                                                    </tbody>
                                                                </table>

                                                                {/* Mobile View inside groups (optional, but good practice to hide table here too) */}
                                                                {/* For now, just keep table hidden on mobile if this view supports mobile switching */}
                                                            </div>
                                                        ));
                                                    })()}
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        ))}

                        {filteredData.length === 0 && (
                            <div className="text-center py-12 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                                <p className="text-gray-500">No sites found.</p>
                            </div>
                        )}
                    </div>
                )
            }
        </div >
    );
};


const UserRow = ({ data, weekStart, currentSiteId, siteNameMap, getSiteName, workLocationsMap }) => {
    const [selectedSession, setSelectedSession] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [showLocationMap, setShowLocationMap] = useState(false);
    const [selectedSessionForMap, setSelectedSessionForMap] = useState(null);

    const handleSessionClick = (entry, index) => {
        // Calculate duration string
        let duration = '';
        if (entry.effectiveSec) {
            const h = Math.floor(entry.effectiveSec / 3600);
            const m = Math.floor((entry.effectiveSec % 3600) / 60);
            duration = `${h}h ${m}m`;
        }

        setSelectedSession({
            date: entry.date,
            clockIn: entry.clockIn || (entry.rawStart ? new Date(entry.rawStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A'),
            clockOut: entry.clockOut || (entry.rawEnd ? new Date(entry.rawEnd).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null),
            location: entry.location,
            clockOutLocation: entry.clockOutLocation,
            deviceInfo: entry.deviceInfo,
            clockOutDeviceInfo: entry.clockOutDeviceInfo,
            notes: entry.notes,
            pupilCount: entry.pupilCount, // Pass pupil count
            duration: duration,
            source: entry.source,
            isManual: entry.isManual,
            sessionId: entry.sessionKey || `session_${index}`
        });
        setIsModalOpen(true);
    };

    const user = data.user || {};
    const userName = user.displayName || user.email || data.userId || 'Unknown';
    const userRole = user.primaryRole ? user.primaryRole.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()) : '';

    // Determine overlapping/home site logic
    // user.siteId is like 'sites/siteId'
    const userHomeSiteId = user.siteId ? (user.siteId.includes('/') ? user.siteId.split('/').pop() : user.siteId) : null;
    const isVisiting = userHomeSiteId && userHomeSiteId !== currentSiteId;

    // Parse Schedule
    const shifts = data.schedule || [];
    const totalScheduled = shifts.length;
    const accepted = shifts.filter(s => s.status === 'accepted').length;
    const declined = shifts.filter(s => s.status === 'declined').length;

    // Parse Timesheet
    const timesheet = data.timesheet;
    const hasTimesheet = !!timesheet;
    const otherTimesheets = data.otherTimesheets || [];

    // Calculate Total Hours
    const calculateTotalHours = (t) => {
        if (!t) return 0;
        if (t.totalDurationSec) return Math.round(t.totalDurationSec / 3600 * 10) / 10;
        if (t.days) {
            const totalSec = Object.values(t.days).reduce((sum, day) => sum + (day.effectiveSec || 0), 0);
            return Math.round(totalSec / 3600 * 10) / 10;
        }
        return 0; // fallback if simple totals logic used
    };

    // Better calculation safe for new array-based entries if totals not ready
    const safeCalc = (t) => {
        if (!t) return 0;
        if (t.totals && t.totals.effectiveSec) return Math.round(t.totals.effectiveSec / 3600 * 10) / 10;
        return calculateTotalHours(t);
    };

    const totalHours = safeCalc(timesheet);

    return (
        <tr className="hover:bg-gray-50 transition-colors">
            <td className="px-6 py-4 align-top">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 font-bold text-xs shrink-0">
                        {userName.substr(0, 2).toUpperCase()}
                    </div>
                    <div>
                        <div className="font-medium text-gray-900">{userName}</div>
                        <div className="text-xs text-gray-500">{userRole}</div>
                        {/* Client requested removal of Visiting badge */}
                        {/* {isVisiting && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800 mt-1">
                                Visiting
                            </span>
                        )} */}
                    </div>
                </div>
            </td>
            <td className="px-6 py-4 align-top">
                {totalScheduled === 0 ? (
                    <span className="text-gray-400 text-xs italic">No shifts scheduled</span>
                ) : (
                    <div className="space-y-1.5">
                        <div className="text-xs font-semibold text-gray-700 mb-2">
                            {totalScheduled} Shift{totalScheduled !== 1 && 's'}
                        </div>
                        {shifts.sort((a, b) => new Date(a.start) - new Date(b.start)).map(shift => {
                            const startTime = new Date(shift.start).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
                            const endTime = new Date(shift.end).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

                            return (
                                <div key={shift.id} className="bg-gray-50 rounded-md p-2 border border-gray-100">
                                    <div className="flex items-center gap-2 mb-1">
                                        <StatusIcon status={shift.status} />
                                        <span className="text-xs font-medium text-gray-700">
                                            {new Date(shift.start).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })}
                                        </span>
                                        <span className="text-[10px] px-1.5 py-0.5 rounded capitalize bg-white border border-gray-200 text-gray-600">
                                            {shift.status}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1 text-xs text-gray-600 ml-5">
                                        <Clock size={12} className="text-gray-400" />
                                        <span className="font-mono">{startTime} - {endTime}</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </td>
            <td className="px-6 py-4 align-top">
                {!hasTimesheet ? (
                    otherTimesheets.length > 0 ? (
                        <div className="space-y-2">
                            <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md w-fit border border-amber-100">
                                <Clock size={13} />
                                <span>Clocked elsewhere</span>
                            </div>
                            <div className="space-y-1">
                                {otherTimesheets.map(ot => {
                                    const sName = getSiteName(ot.siteId);
                                    return (
                                        <div key={ot.id} className="bg-gray-50 rounded border border-gray-100 overflow-hidden">
                                            <div className="px-2 py-1 text-xs font-semibold text-gray-700 bg-gray-100 border-b border-gray-200 truncate" title={sName}>
                                                {sName}
                                            </div>
                                            <div className="p-1 space-y-1">
                                                {ot.entries && ot.entries.length > 0 ? (
                                                    ot.entries.sort((a, b) => {
                                                        const aTime = new Date(a.rawStart || a.date);
                                                        const bTime = new Date(b.rawStart || b.date);
                                                        return aTime - bTime;
                                                    }).map((entry, idx) => {
                                                        const start = entry.clockIn || (entry.rawStart ? new Date(entry.rawStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A');
                                                        const end = entry.clockOut || (entry.rawEnd ? new Date(entry.rawEnd).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Active');
                                                        return (
                                                            <button
                                                                key={idx}
                                                                onClick={() => handleSessionClick(entry, idx)}
                                                                className="flex items-center justify-between w-full text-left hover:bg-purple-50 p-1 rounded transition-colors group"
                                                            >
                                                                <span className="text-gray-500 text-[10px] flex items-center gap-1">
                                                                    S{idx + 1}
                                                                    <MousePointerClick size={8} className="opacity-0 group-hover:opacity-100" />
                                                                </span>
                                                                <span className="font-mono text-xs text-gray-800">{start}-{end}</span>
                                                            </button>
                                                        );
                                                    })
                                                ) : (
                                                    <div className="px-2 py-1 flex justify-between items-center text-xs">
                                                        <span>Total</span>
                                                        <span className="font-mono font-medium">{safeCalc(ot)} hrs</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 text-gray-400 text-xs italic py-2">
                            <Clock size={14} />
                            <span>No activity recorded</span>
                        </div>
                    )
                ) : (
                    <div className="space-y-3">
                        {/* Header Stats */}
                        <div className="flex items-center justify-between pb-2 border-b border-gray-100">
                            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-100">
                                <CheckCircle size={13} />
                                <span>Active</span>
                            </div>
                            <div className="text-xs font-bold text-gray-800 bg-gray-50 px-2 py-1 rounded border border-gray-100">
                                {totalHours} <span className="text-gray-400 font-normal">hrs</span>
                            </div>
                        </div>

                        {/* Session Timeline */}
                        {timesheet.entries && timesheet.entries.length > 0 && (
                            <div className="space-y-3 max-h-[160px] overflow-y-auto pr-1">
                                {Object.entries(
                                    timesheet.entries.reduce((acc, entry) => {
                                        const date = entry.date || (entry.rawStart ? entry.rawStart.split('T')[0] : 'Unknown');
                                        if (!acc[date]) acc[date] = [];
                                        acc[date].push(entry);
                                        return acc;
                                    }, {})
                                ).sort((a, b) => new Date(a[0]) - new Date(b[0])).map(([date, entries]) => (
                                    <div key={date} className="space-y-1.5">
                                        <div className="text-[11px] font-bold text-gray-700 uppercase tracking-wide pb-1 border-b border-gray-200">
                                            {new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                                        </div>
                                        <div className="space-y-1 pl-1">
                                            {entries.sort((a, b) => {
                                                const aTime = new Date(a.rawStart || a.roundedStart || a.date);
                                                const bTime = new Date(b.rawStart || b.roundedStart || b.date);
                                                return aTime - bTime;
                                            }).map((e, idx) => {
                                                const formatTimeVal = (val) => {
                                                    if (!val) return null;
                                                    if (typeof val === 'string' && val.includes('T')) {
                                                        return new Date(val).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
                                                    }
                                                    return val;
                                                };
                                                const start = formatTimeVal(e.rawStart) || formatTimeVal(e.roundedStart) || e.clockIn || '?';
                                                const end = formatTimeVal(e.rawEnd) || formatTimeVal(e.roundedEnd) || e.clockOut || 'Active';

                                                return (
                                                    <div key={idx} className="flex items-center justify-between group">
                                                        <button
                                                            onClick={() => handleSessionClick(e, idx)}
                                                            className="text-xs flex items-baseline gap-2 w-full text-left hover:bg-purple-50 p-1 rounded transition-colors"
                                                        >
                                                            <span className="text-gray-400 min-w-[30px] group-hover:text-purple-500 font-medium transition-colors flex items-center gap-1">
                                                                S{idx + 1}
                                                                <MousePointerClick size={10} className="opacity-0 group-hover:opacity-100" />
                                                            </span>
                                                            <span className="font-mono text-gray-800 font-medium group-hover:text-purple-700">{start} - {end}</span>
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Session Location Modal */}
                <SessionLocationModal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    session={selectedSession}
                />
            </td>

            {/* Assigned Location Column */}
            <td className="px-4 py-4 align-top">
                {(() => {
                    // Get all timesheet entries
                    const allEntries = [];
                    if (hasTimesheet && timesheet.entries) {
                        allEntries.push(...timesheet.entries);
                    }
                    if (otherTimesheets && otherTimesheets.length > 0) {
                        otherTimesheets.forEach(ot => {
                            if (ot.entries) allEntries.push(...ot.entries);
                        });
                    }

                    // Get unique assigned locations
                    const assignedLocationIds = new Set(
                        allEntries
                            .map(e => e.location?.clockIn?.assignedLocationId || e.location?.assignedLocationId)
                            .filter(Boolean)
                    );

                    if (assignedLocationIds.size === 0) {
                        // Check if we have manual entries which might not have assigned locations yet
                        const hasManual = allEntries.some(e => e.isManual || e.source === 'manual');
                        console.log('[Location Column] allEntries:', allEntries.length, 'hasManual:', hasManual, 'entries:', allEntries.map(e => ({ isManual: e.isManual, source: e.source })));
                        if (hasManual) {
                            return (
                                <div className="flex items-center gap-1.5 text-gray-500">
                                    <UserCheck size={14} />
                                    <span className="text-xs italic">Manual Entry</span>
                                </div>
                            );
                        }
                        return <span className="text-gray-300 text-xs italic">No location</span>;
                    }

                    return (
                        <div className="space-y-1.5">
                            {Array.from(assignedLocationIds).map(locId => {
                                const location = workLocationsMap[locId];
                                return (
                                    <div key={locId} className="flex items-start gap-1.5">
                                        <MapPin size={14} className="text-purple-600 mt-0.5 shrink-0" />
                                        <span className="text-xs font-medium text-gray-700 leading-relaxed">
                                            {location?.name || 'Unknown'}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })()}
            </td>

            {/* GPS Status Column */}
            <td className="px-4 py-4 align-top">
                {(() => {
                    // Get all timesheet entries with GPS data
                    const allEntries = [];
                    if (hasTimesheet && timesheet.entries) {
                        allEntries.push(...timesheet.entries);
                    }
                    if (otherTimesheets && otherTimesheets.length > 0) {
                        otherTimesheets.forEach(ot => {
                            if (ot.entries) allEntries.push(...ot.entries);
                        });
                    }

                    const entriesWithGPS = allEntries.filter(e => {
                        // Check for GPS data in location object (from timeClock sessions)
                        const hasClockInGPS = e.location?.clockIn?.lat && e.location?.clockIn?.lng;
                        // Also check for direct location object (might be at entry level)
                        const hasDirectGPS = e.location?.lat && e.location?.lng;
                        return hasClockInGPS || hasDirectGPS;
                    });

                    if (entriesWithGPS.length === 0) {
                        // If no GPS, but we have manual entries, show specific status
                        const hasManual = allEntries.some(e => e.isManual || e.source === 'manual');
                        if (hasManual) {
                            return (
                                <div className="flex flex-col items-start gap-1">
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border bg-blue-50 text-blue-700 border-blue-200 text-[11px] font-medium">
                                        <UserCheck size={11} />
                                        <span>Manual</span>
                                    </span>
                                    <span className="text-[10px] text-gray-400 pl-1">View details</span>
                                </div>
                            );
                        }
                        return <span className="text-gray-300 text-xs italic">No GPS</span>;
                    }

                    return (
                        <div className="space-y-1.5">
                            {entriesWithGPS.map((entry, idx) => {
                                const assignedLocationId = entry.location?.clockIn?.assignedLocationId || entry.location?.assignedLocationId;
                                const assignedLocation = assignedLocationId ? workLocationsMap[assignedLocationId] : null;

                                // Handle both nested and direct GPS structures
                                const actualGPS = entry.location?.clockIn?.lat
                                    ? {
                                        lat: entry.location.clockIn.lat,
                                        lng: entry.location.clockIn.lng
                                    }
                                    : entry.location?.lat
                                        ? {
                                            lat: entry.location.lat,
                                            lng: entry.location.lng
                                        }
                                        : null;

                                if (!actualGPS) return null;

                                const verification = getVerificationStatus(actualGPS, assignedLocation);

                                const getBadgeStyle = (status) => {
                                    switch (status) {
                                        case 'verified': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
                                        case 'far': return 'bg-red-50 text-red-700 border-red-200';
                                        case 'near': return 'bg-amber-50 text-amber-700 border-amber-200';
                                        default: return 'bg-gray-50 text-gray-600 border-gray-200';
                                    }
                                };
                                const getStatusLabel = (status) => {
                                    switch (status) {
                                        case 'verified': return 'Within Radius';
                                        case 'far': return 'Far from Site';
                                        case 'near': return 'Near Site';
                                        default: return 'No Location';
                                    }
                                };

                                return (
                                    <div key={idx} className="flex flex-col items-start gap-1">
                                        <button
                                            onClick={() => {
                                                setSelectedSessionForMap({
                                                    ...entry,
                                                    siteLocation: assignedLocation
                                                });
                                                setShowLocationMap(true);
                                            }}
                                            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors hover:bg-white hover:shadow-sm ${getBadgeStyle(verification)}`}
                                        >
                                            {verification === 'verified' ? <CheckCircle size={11} /> : <AlertCircle size={11} />}
                                            <span>{getStatusLabel(verification)}</span>
                                        </button>

                                        {/* Show distance if not verified */}
                                        {verification !== 'verified' && assignedLocation && actualGPS && (
                                            <span className="text-[10px] text-gray-500 pl-1">
                                                {formatDistance(actualGPS, assignedLocation)} away
                                            </span>
                                        )}

                                        <button
                                            onClick={() => {
                                                setSelectedSessionForMap({
                                                    ...entry,
                                                    siteLocation: assignedLocation
                                                });
                                                setShowLocationMap(true);
                                            }}
                                            className="text-[10px] text-purple-600 font-medium hover:underline flex items-center gap-0.5 ml-1"
                                        >
                                            <Map size={10} />
                                            Map
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })()}

                {/* Location Verification Map Modal */}
                {showLocationMap && selectedSessionForMap && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                        <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
                            <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                                <h3 className="font-bold text-gray-800 flex items-center gap-2">
                                    <MapPin className="text-purple-600" size={18} />
                                    Verify Location
                                </h3>
                                <button onClick={() => setShowLocationMap(false)} className="p-1 hover:bg-gray-200 rounded-full transition-colors">
                                    <XCircle size={20} className="text-gray-500" />
                                </button>
                            </div>
                            <div className="flex-1 relative min-h-[400px]">
                                <Suspense fallback={<div className="h-full flex items-center justify-center bg-gray-50"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div></div>}>
                                    <LocationVerificationMap
                                        session={selectedSessionForMap}
                                        siteLocation={selectedSessionForMap.siteLocation}
                                    />
                                </Suspense>
                            </div>

                        </div>
                    </div>
                )}
            </td>

            {/* Notes / Pupils Column */}
            <td className="px-6 py-4 align-top">
                <div className="space-y-2">
                    {(() => {
                        // Aggregate all entries from main timesheet and other sites
                        const allEntries = [];
                        if (hasTimesheet && timesheet.entries) {
                            allEntries.push(...timesheet.entries);
                        }
                        if (otherTimesheets && otherTimesheets.length > 0) {
                            otherTimesheets.forEach(ot => {
                                if (ot.entries) {
                                    const sName = getSiteName(ot.siteId);
                                    allEntries.push(...ot.entries.map(e => ({ ...e, _siteName: sName })));
                                }
                            });
                        }

                        // Filter for entries that actually have data
                        const entriesWithData = allEntries.filter(e => e.pupilCount || e.notes);

                        if (entriesWithData.length === 0) {
                            return <span className="text-gray-300 text-xs italic">No notes or data</span>;
                        }

                        // Sort by date (and then by time if available)
                        return entriesWithData.sort((a, b) => {
                            const dateA = new Date(a.date);
                            const dateB = new Date(b.date);
                            if (dateA - dateB !== 0) return dateA - dateB;
                            // Secondary sort by start time if available
                            const tA = a.rawStart || a.roundedStart || '';
                            const tB = b.rawStart || b.roundedStart || '';
                            return tA.localeCompare(tB);
                        }).map((entry, idx) => (
                            <div key={idx} className="bg-gray-50 rounded border border-gray-100 p-2 space-y-1.5">
                                <div className="flex justify-between items-center text-[10px] text-gray-400 uppercase font-semibold">
                                    <span>
                                        {new Date(entry.date).toLocaleDateString('en-US', { weekday: 'short' })}
                                        {entry._siteName && <span className="text-gray-400 ml-1 font-normal opacity-75">({entry._siteName})</span>}
                                    </span>
                                </div>
                                {entry.pupilCount && (
                                    <div className="flex items-center gap-1.5 text-xs text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded w-fit">
                                        <span className="font-medium">Pupils:</span>
                                        <span className="font-bold">{entry.pupilCount}</span>
                                    </div>
                                )}
                                {entry.notes && (
                                    <div className="flex items-start gap-1.5 text-xs text-gray-600 italic">
                                        <FileText size={10} className="mt-0.5 shrink-0" />
                                        <span className="break-words line-clamp-3" title={entry.notes}>"{entry.notes}"</span>
                                    </div>
                                )}
                            </div>
                        ));
                    })()}
                </div>
            </td>
        </tr>
    );
};

const MobileUserCard = ({ data, currentSiteId, getSiteName, workLocationsMap }) => {
    const [selectedSession, setSelectedSession] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);

    const handleSessionClick = (entry, index) => {
        let duration = '';
        if (entry.effectiveSec) {
            const h = Math.floor(entry.effectiveSec / 3600);
            const m = Math.floor((entry.effectiveSec % 3600) / 60);
            duration = `${h}h ${m}m`;
        }
        setSelectedSession({
            date: entry.date,
            clockIn: entry.clockIn || (entry.rawStart ? new Date(entry.rawStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A'),
            clockOut: entry.clockOut || (entry.rawEnd ? new Date(entry.rawEnd).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null),
            location: entry.location,
            clockOutLocation: entry.clockOutLocation,
            deviceInfo: entry.deviceInfo,
            clockOutDeviceInfo: entry.clockOutDeviceInfo,
            notes: entry.notes,
            pupilCount: entry.pupilCount,
            duration: duration,
            source: entry.source,
            isManual: entry.isManual,
            sessionId: entry.sessionKey || `session_${index}`
        });
        setIsModalOpen(true);
    };

    const user = data.user || {};
    const userName = user.displayName || user.email || data.userId || 'Unknown';
    const userRole = user.primaryRole ? user.primaryRole.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()) : '';

    const shifts = data.schedule || [];
    const totalScheduled = shifts.length;

    const timesheet = data.timesheet;
    const hasTimesheet = !!timesheet;
    const otherTimesheets = data.otherTimesheets || [];

    const calculateTotalHours = (t) => {
        if (!t) return 0;
        if (t.totals && t.totals.effectiveSec) return Math.round(t.totals.effectiveSec / 3600 * 10) / 10;
        if (t.totalDurationSec) return Math.round(t.totalDurationSec / 3600 * 10) / 10;
        if (t.days) {
            const totalSec = Object.values(t.days).reduce((sum, day) => sum + (day.effectiveSec || 0), 0);
            return Math.round(totalSec / 3600 * 10) / 10;
        }
        return 0;
    };
    const totalHours = calculateTotalHours(timesheet);

    return (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
            <div className="flex items-center justify-between mb-4 border-b border-gray-100 pb-3">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 font-bold text-sm shrink-0">
                        {userName.substr(0, 2).toUpperCase()}
                    </div>
                    <div>
                        <div className="font-semibold text-gray-900">{userName}</div>
                        <div className="text-xs text-gray-500">{userRole}</div>
                    </div>
                </div>
                {hasTimesheet && (
                    <div className="flex flex-col items-end">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-md mb-1">
                            <CheckCircle size={13} />
                            <span>Active</span>
                        </div>
                        <div className="text-xs font-bold text-gray-800">
                            {totalHours} <span className="text-gray-400 font-normal">hrs</span>
                        </div>
                    </div>
                )}
            </div>

            <div className="space-y-4">
                <div>
                    <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Schedule</h4>
                    {totalScheduled === 0 ? (
                        <span className="text-gray-400 text-xs italic">No shifts scheduled</span>
                    ) : (
                        <div className="flex flex-col gap-2">
                            {shifts.sort((a, b) => new Date(a.start) - new Date(b.start)).map(shift => {
                                const startTime = new Date(shift.start).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
                                const endTime = new Date(shift.end).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
                                return (
                                    <div key={shift.id} className="bg-gray-50 rounded px-3 py-2 border border-gray-100 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <StatusIcon status={shift.status} />
                                            <span className="text-xs font-medium text-gray-700">
                                                {new Date(shift.start).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })}
                                            </span>
                                        </div>
                                        <span className="text-xs font-mono text-gray-600 font-medium">{startTime} - {endTime}</span>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>

                <div>
                    <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Activity</h4>
                    {!hasTimesheet ? (
                        otherTimesheets.length > 0 ? (
                            <div className="space-y-2">
                                <div className="text-xs font-medium text-amber-700 bg-amber-50 px-2.5 py-1 rounded w-fit border border-amber-100">
                                    Clocked at other sites
                                </div>
                                {otherTimesheets.map(ot => (
                                    <div key={ot.id} className="text-xs text-gray-600 bg-gray-50 p-2.5 rounded border border-gray-100">
                                        <div className="font-semibold mb-1 text-gray-800">{getSiteName(ot.siteId)}</div>
                                        <div className="font-mono text-gray-500">{calculateTotalHours(ot)} hrs</div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-gray-400 text-xs italic flex items-center gap-2 bg-gray-50 p-2 rounded border border-dashed border-gray-200 justify-center">
                                <Clock size={14} /> No activity recorded
                            </div>
                        )
                    ) : (
                        <div className="space-y-2">
                            {timesheet.entries && timesheet.entries.length > 0 && (
                                <div className="space-y-2">
                                    {timesheet.entries.sort((a, b) => new Date(a.rawStart) - new Date(b.rawStart)).map((entry, idx) => {
                                        const start = entry.clockIn || (entry.rawStart ? new Date(entry.rawStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : '?');
                                        const end = entry.clockOut || (entry.rawEnd ? new Date(entry.rawEnd).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : 'Active');
                                        return (
                                            <button
                                                key={idx}
                                                onClick={() => handleSessionClick(entry, idx)}
                                                className="w-full bg-white hover:bg-purple-50 border border-gray-200 hover:border-purple-200 rounded-lg px-3 py-2 text-left transition-all shadow-sm flex items-center justify-between group"
                                            >
                                                <span className="text-xs text-purple-600 font-bold flex items-center gap-1">
                                                    S{idx + 1}
                                                    <MousePointerClick size={10} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                                                </span>
                                                <span className="text-xs font-mono text-gray-800 font-medium">{start} - {end}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-2 gap-4 pt-3 border-t border-gray-100 mt-2">
                    <div>
                        <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Location</h4>
                        {(() => {
                            const allEntries = [];
                            if (hasTimesheet && timesheet.entries) allEntries.push(...timesheet.entries);
                            if (otherTimesheets) otherTimesheets.forEach(ot => ot.entries && allEntries.push(...ot.entries));

                            const assignedLocationIds = new Set(
                                allEntries.map(e => e.location?.clockIn?.assignedLocationId || e.location?.assignedLocationId).filter(Boolean)
                            );

                            if (assignedLocationIds.size === 0) return <span className="text-gray-300 text-xs italic">No location</span>;

                            return (
                                <div className="space-y-1.5">
                                    {Array.from(assignedLocationIds).map(locId => (
                                        <div key={locId} className="flex items-start gap-1.5">
                                            <MapPin size={14} className="text-purple-600 shrink-0 mt-0.5" />
                                            <span className="text-xs font-medium text-gray-700 leading-tight">{workLocationsMap[locId]?.name || 'Unknown'}</span>
                                        </div>
                                    ))}
                                </div>
                            )
                        })()}
                    </div>
                    <div>
                        <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">GPS Status</h4>
                        {(() => {
                            const allEntries = [];
                            if (hasTimesheet && timesheet.entries) allEntries.push(...timesheet.entries);
                            if (otherTimesheets) otherTimesheets.forEach(ot => ot.entries && allEntries.push(...ot.entries));

                            const entriesWithGPS = allEntries.filter(e =>
                                (e.location?.clockIn?.lat && e.location?.clockIn?.lng) || (e.location?.lat && e.location?.lng)
                            );

                            if (entriesWithGPS.length === 0) return <span className="text-gray-300 text-xs italic">No GPS data</span>;

                            // Just show a summary badge for mobile to save space
                            const allValid = entriesWithGPS.every(e => {
                                const locId = e.location?.clockIn?.assignedLocationId || e.location?.assignedLocationId;
                                const assigned = locId ? workLocationsMap[locId] : null;
                                const gps = e.location?.clockIn || e.location;
                                if (!assigned || !gps) return false;
                                const status = getVerificationStatus(gps, assigned);
                                return status === 'verified';
                            });

                            if (allValid) {
                                return (
                                    <span className="inline-flex items-center px-2 py-1 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">
                                        <CheckCircle size={10} className="mr-1.5" /> Verified
                                    </span>
                                );
                            }
                            return (
                                <span className="inline-flex items-center px-2 py-1 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-100">
                                    <MapPin size={10} className="mr-1.5" /> Check Map
                                </span>
                            );
                        })()}
                    </div>
                </div>
            </div>

            <SessionLocationModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                session={selectedSession}
            />
        </div>
    );
}


const StatusIcon = ({ status }) => {
    switch (status) {
        case 'accepted': return <CheckCircle size={12} className="text-green-500" />;
        case 'declined': return <XCircle size={12} className="text-red-500" />;
        default: return <AlertCircle size={12} className="text-yellow-500" />;
    }
}

export default ActivityOversightPage;
