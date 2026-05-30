import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Clock, CheckCircle, AlertTriangle, Users, MapPin, Navigation, X, ArrowRight, Calendar, FileText, Coffee, Loader2 } from 'lucide-react';
import { RefreshCw } from 'lucide-react';
import TimesheetConfirmModal from '../../components/modals/TimesheetConfirmModal';
import ApprovalConfirmationModal from '../../components/modals/ApprovalConfirmationModal';
import ShiftConfirmationModal from '../../components/modals/ShiftConfirmationModal';
import RestrictedAccessPage from '../auth/RestrictedAccessPage';
import StatCard from '../../components/shared/StatCard';
import SectionContainer from '../../components/shared/SectionContainer';
import Button from '../../components/ui/Button';
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '../../components/shared/Table';
import Header from '../../components/layout/Header';
import { useAuth } from '../../hooks/useAuth';
import Loader from '../../components/ui/Loader';
import { startClock, stopClock, startBreak, endBreak, getSessionsForDateRange, getMyActiveSession } from '../../services/timeClock';
import { formatTimeForDisplay } from '../../utils/timeFormatUtils';
import { getUserShift, updateUserShift, detectShiftChange, SHIFT_TYPES, formatShiftName } from '../../services/shiftService';
import { getUserSchedules } from '../../services/scheduleService';
import { checkAndAutoClockOutAll, shouldAutoClockOut, getAutoClockOutTime, performAutoClockOut } from '../../services/autoClockOut';
import { Sun, Moon } from 'lucide-react';
import { toast } from 'react-toastify';
import { useClockSessionContext } from '../../contexts/ClockSessionContext';
import { useTimesheetContext } from '../../contexts/TimesheetContext';
import hrApiClient from '../../lib/hrApiClient';
import { formatISODate } from '../../utils/weekStartUtils';
import { getUserTimesheetsByWeek } from '../../services/timesheets';
import { useLocationValidation } from '../../hooks/useLocationValidation';
import { getCompanyPlugins } from '../../services/companyManagementService';

// Optimized time display component
const TimeDisplay = React.memo(({ time, isActive }) => {
    const timeString = `${String(time.hours).padStart(2, '0')}:${String(time.minutes).padStart(2, '0')}:${String(time.seconds).padStart(2, '0')}`;

    return (
        <div className="text-4xl font-bold text-purple-600 mb-2">
            {isActive ? timeString : '00:00:00'}
        </div>
    );
});

TimeDisplay.displayName = 'TimeDisplay';

// Optimized status indicator component
const StatusIndicator = React.memo(({ status, isLoading, operationType }) => {
    if (isLoading) {
        const loadingText = {
            clockIn: 'Clocking In...',
            clockOut: 'Clocking Out...',
            startBreak: 'Starting Break...',
            endBreak: 'Ending Break...'
        }[operationType] || 'Processing...';

        return (
            <span className="inline-flex items-center gap-2 px-3 py-1 bg-blue-100 text-blue-700 rounded-full font-medium">
                <Loader2 className="h-4 w-4 animate-spin" />
                {loadingText}
            </span>
        );
    }

    if (status === 'break') {
        return (
            <span className="inline-flex items-center gap-2 px-3 py-1 bg-orange-100 text-orange-700 rounded-full font-medium">
                <Coffee className="h-4 w-4" />
                On Break
            </span>
        );
    }

    return null;
});

StatusIndicator.displayName = 'StatusIndicator';

const EmployeeDashboard = () => {
    const [currentView, setCurrentView] = useState('dashboard');
    const [showTimesheetModal, setShowTimesheetModal] = useState(false);
    const [showClockOutModal, setShowClockOutModal] = useState(false);
    const [showShiftModal, setShowShiftModal] = useState(false);
    const [shiftModalData, setShiftModalData] = useState(null);
    const [pendingClockIn, setPendingClockIn] = useState(false);
    const { user } = useAuth();

    // ── Local-date helpers ────────────────────────────────────────────────────
    const getLocalDateStr = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    // ── Read persisted clock state from localStorage synchronously ─────────────
    // Called once as a lazy initializer so the FIRST render has the right values.
    // This eliminates the 00:00:00 flash that would otherwise appear while the
    // useEffect restore runs asynchronously after mount.
    const readSavedClockState = () => {
        try {
            const uid = user?.uid;
            if (!uid) return null;
            const raw = localStorage.getItem(`mprar_clock_${uid}`);
            if (!raw) return null;
            const saved = JSON.parse(raw);
            if (!saved) return null;
            const today = new Date();
            const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            if (saved.date !== todayStr) return null; // stale — different day
            return saved;
        } catch {
            return null;
        }
    };

    const _saved = readSavedClockState();

    // Lazy initializers read from localStorage so first render has correct values
    const [clockStatus, setClockStatus] = useState(() => _saved?.clockStatus || 'out');
    const [currentTime, setCurrentTime] = useState(new Date());
    const [clockInTime, setClockInTime] = useState(() =>
        _saved?.clockInTime ? new Date(_saved.clockInTime) : (_saved?.rawClockInTime ? new Date(_saved.rawClockInTime) : null)
    );
    const [clockOutTime, setClockOutTime] = useState(() =>
        _saved?.clockOutTime ? new Date(_saved.clockOutTime) : (_saved?.rawClockOutTime ? new Date(_saved.rawClockOutTime) : null)
    );
    const [rawClockInTime, setRawClockInTime] = useState(() =>
        _saved?.rawClockInTime ? new Date(_saved.rawClockInTime) : null
    );
    const [rawClockOutTime, setRawClockOutTime] = useState(() =>
        _saved?.rawClockOutTime ? new Date(_saved.rawClockOutTime) : null
    );
    const [breakStartTime, setBreakStartTime] = useState(() =>
        _saved?.breakStartTime ? new Date(_saved.breakStartTime) : null
    );
    const [totalBreakTime, setTotalBreakTime] = useState(() => _saved?.totalBreakTime || 0);
    // Captures total elapsed seconds at clock-out to keep timer continuous on re-clock-in
    // (context may lag by a few seconds and show stale "open" session, causing timer to reset)
    const [sessionOffsetSec, setSessionOffsetSec] = useState(() => _saved?.sessionOffsetSec || 0);
    const [sessionOffsetDate, setSessionOffsetDate] = useState(() => _saved?.sessionOffsetDate || null);
    const [isRefreshing, setIsRefreshing] = useState(false);


    const [weeklyHours, setWeeklyHours] = useState({ scheduled: 0 });
    const [isLoadingWeeklyHours, setIsLoadingWeeklyHours] = useState(false);
    const [siteName, setSiteName] = useState('Main Office');
    const [currentShift, setCurrentShift] = useState(SHIFT_TYPES.DAY);
    const [isLoadingShift, setIsLoadingShift] = useState(true);
    const [isUpdatingShift, setIsUpdatingShift] = useState(false);

    // Use real-time contexts instead of fetching
    const { sessionDocs, recentEntries, isLoading: isLoadingSessions, getOpenSession, getTodaySessions, refresh } = useClockSessionContext();
    const { timesheetDocs, currentWeekData, isLoading: isLoadingTimesheets } = useTimesheetContext();

    // Role-based permissions
    const hasApprovalPermissions = ['teamManager', 'seniorManager', 'adminManager', 'hrManager', 'siteManager'].includes(user?.role);
    const hasOnboardingPermissions = ['siteManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor'].includes(user?.role);

    // Location validation hook
    const {
        isLocationValid,
        isCheckingLocation,
        locationError,
        locationMessage,
        checkLocation
    } = useLocationValidation(30000); // Check every 30 seconds

    // Force location check on dashboard mount
    useEffect(() => {
        if (user?.uid) {
            // Small delay to ensure hook is fully initialized
            const timeoutId = setTimeout(() => {
                checkLocation();
            }, 500);
            return () => clearTimeout(timeoutId);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.uid]);

    // Process recent entries from real-time data
    const timeEntries = React.useMemo(() => {
        if (!recentEntries) return [];
        return recentEntries;
    }, [recentEntries]);

    const isLoadingRecent = isLoadingSessions || isLoadingTimesheets;



    // New state for optimistic UI updates
    const [isClockOperationInProgress, setIsClockOperationInProgress] = useState(false);
    const [operationType, setOperationType] = useState(null); // 'clockIn', 'clockOut', 'startBreak', 'endBreak'
    const [optimisticState, setOptimisticState] = useState(null); // Stores optimistic state during operations
    const [operationStartTime, setOperationStartTime] = useState(null);
    const [retryCount, setRetryCount] = useState(0);
    const [errorMessage, setErrorMessage] = useState(null);
    const [lastOperationTime, setLastOperationTime] = useState(0);

    // Feature Flags & Data
    const [hasSchedulingPlugin, setHasSchedulingPlugin] = useState(false);
    const [pupilCount, setPupilCount] = useState('');

    // Refs for cleanup
    const timerRef = useRef(null);
    const loadEntriesTimeoutRef = useRef(null);
    const reconcileTimeoutRef = useRef(null);
    const autoClockOutCheckRef = useRef(null);
    const clockInRetryTimeoutRef = useRef(null);
    const clockOutRetryTimeoutRef = useRef(null);
    const activeClockOperationRef = useRef(null); // Track active operation to prevent duplicates

    const lastDayRef = useRef(new Date().toLocaleDateString('en-CA'));


    // ── Persist clock state to localStorage on every meaningful change ────────
    useEffect(() => {
        if (!user?.uid) return;
        try {
            localStorage.setItem(`mprar_clock_${user.uid}`, JSON.stringify({
                date: getLocalDateStr(),
                clockStatus,
                clockInTime: clockInTime instanceof Date ? clockInTime.toISOString() : clockInTime,
                rawClockInTime: rawClockInTime instanceof Date ? rawClockInTime.toISOString() : rawClockInTime,
                clockOutTime: clockOutTime instanceof Date ? clockOutTime.toISOString() : clockOutTime,
                rawClockOutTime: rawClockOutTime instanceof Date ? rawClockOutTime.toISOString() : rawClockOutTime,
                totalBreakTime,
                // Persist breakStartTime so we can resume break timer after refresh
                breakStartTime: breakStartTime instanceof Date ? breakStartTime.toISOString() : breakStartTime,
                sessionOffsetSec,
                sessionOffsetDate,
            }));
        } catch { /* ignore storage errors */ }
    }, [user?.uid, clockStatus, clockInTime, rawClockInTime, clockOutTime, rawClockOutTime, totalBreakTime, breakStartTime, sessionOffsetSec, sessionOffsetDate]);

    // ── Midnight auto-reset: clear clock display when the day rolls over ──────
    useEffect(() => {
        const today = getLocalDateStr();
        if (today !== lastDayRef.current) {
            lastDayRef.current = today;
            // New day — reset all clock display state
            setClockStatus('out');
            setClockInTime(null);
            setRawClockInTime(null);
            setClockOutTime(null);
            setRawClockOutTime(null);
            setTotalBreakTime(0);
            setSessionOffsetSec(0);
            setSessionOffsetDate(null);
            try { localStorage.removeItem(`mprar_clock_${user?.uid}`); } catch { /* ignore */ }
        }
    }, [currentTime]); // currentTime ticks every second – cheap date-string comparison

    // Load user's shift preference
    useEffect(() => {
        const loadShift = async () => {
            if (!user?.uid) {
                setIsLoadingShift(false);
                return;
            }
            try {
                setIsLoadingShift(true);
                const shift = await getUserShift(user.uid);
                setCurrentShift(shift);
            } catch (error) {
                console.error('Error loading shift:', error);
            } finally {
                setIsLoadingShift(false);
            }
        };
        loadShift();
    }, [user?.uid]);

    // Check plugins
    useEffect(() => {
        const checkPlugins = async () => {
            if (user?.companyId) {
                try {
                    const plugins = await getCompanyPlugins(user.companyId);
                    setHasSchedulingPlugin(Boolean(plugins.scheduling));
                } catch (err) {
                    console.error('Failed to load plugins', err);
                }
            }
        };
        checkPlugins();
    }, [user?.companyId]);

    // Recent entries are now provided by real-time context - no need to fetch

    // Load weekly hours based on company work schedule and actual timesheet data
    // Now uses REST API
    const loadWeeklyHours = useCallback(async () => {
        try {
            setIsLoadingWeeklyHours(true);
            const uid = user?.uid || '';
            const companyId = user?.companyId;

            if (!uid || !companyId) return;

            // Get company work schedule via REST
            const { data: dashboardData } = await hrApiClient.get('/hr/dashboard');
            const workSchedule = dashboardData.workSchedule || {};

            // Calculate total scheduled hours for the week
            const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
            let totalScheduledMinutes = 0;

            daysOfWeek.forEach(day => {
                const daySchedule = workSchedule[day];
                if (daySchedule && daySchedule.enabled) {
                    if (typeof daySchedule.durationMin === 'number') {
                        totalScheduledMinutes += Math.max(0, daySchedule.durationMin);
                    } else if (daySchedule.start && daySchedule.end) {
                        const [startH, startM] = (daySchedule.start || '09:00').split(':').map(Number);
                        const [endH, endM] = (daySchedule.end || '17:00').split(':').map(Number);
                        const startMinutes = startH * 60 + startM;
                        const endMinutes = endH * 60 + endM;
                        const duration = Math.max(0, endMinutes - startMinutes);
                        totalScheduledMinutes += duration;
                    }
                }
            });

            setWeeklyHours({
                scheduled: (totalScheduledMinutes / 60) * 3600
            });
        } catch (e) {
            console.error('Failed to load weekly hours', e);
            setWeeklyHours({ scheduled: 0 });
        } finally {
            setIsLoadingWeeklyHours(false);
        }
    }, [user?.uid, user?.companyId]);

    // [NEW] Self-Healing Trigger: Ensure Timesheet Exists for Current and Next Week
    // This addresses the "Event-Driven" flaw by ensuring weeks exist based on State (User Viewing Dashboard)
    // rather than Action (User Clocking In).
    useEffect(() => {
        const verifyTimesheetIntegrity = async () => {
            if (!user?.uid || !user?.companyId) return;

            try {
                const { getUserWeekContext, getWeekRange, formatISODate } = await import('../../services/timesheets');

                // Get context to know current week start day
                const { weekStartDay } = await getUserWeekContext(user.uid);

                // Check Current Week
                const now = new Date();
                const weekRange = getWeekRange(now, (weekStartDay || 'monday'));
                const weekStartStr = formatISODate(weekRange.start);

                // Trigger Self-Healing Fetch
                // This checks/creates the current week timesheet if missing
                await getUserTimesheetsByWeek(user.uid, user.companyId, weekStartStr);

                // Check Next Week (if we are near the end of the week, or just safekeeping)
                // For now, Current Week is the critical one.

            } catch (err) {
                console.warn('[EmployeeDashboard] Integrity check failed:', err);
            }
        };

        verifyTimesheetIntegrity();
    }, [user?.uid, user?.companyId]);

    const isAutoClockingOutRef = useRef(false);

    // Check for auto clock-out periodically and on mount
    useEffect(() => {
        const checkAutoClockOut = async () => {
            if (!user?.uid || isAutoClockingOutRef.current) return;

            try {
                // Check for open session for current user via REST
                const { data: sessionData } = await hrApiClient.get('/hr/time-entries/my-session').catch(() => ({ data: null }));

                if (sessionData && !sessionData.clockOut) {
                    const companyId = user.companyId;
                    const siteId = user.siteId;
                    const now = new Date();
                    const userShift = await getUserShift(user.uid);
                    let anyTriggered = false;

                    const startedAt = sessionData.clockIn ? new Date(sessionData.clockIn) : null;

                        if (startedAt) {
                            // CRITICAL: Use skipRounding: true for the trigger check
                            const autoClockOutTime = await getAutoClockOutTime(userShift, companyId, startedAt, { siteId, skipRounding: true });

                            if (now >= autoClockOutTime) {
                                // Double-check lock
                                if (!isAutoClockingOutRef.current) {
                                    isAutoClockingOutRef.current = true;
                                }

                                console.log(`[AutoClockOut] ⏰ TRIGGERED for session ${sessionData.id} at ${autoClockOutTime.toLocaleTimeString()}`);

                                try {
                                    await performAutoClockOut(
                                        user.uid,
                                        sessionData.id,
                                        sessionData,
                                        startedAt,
                                        (sessionData.breakMinutes || 0) * 60,
                                        autoClockOutTime
                                    );
                                    anyTriggered = true;
                                } catch (err) {
                                    console.error(`[AutoClockOut] Failed to clock out session ${sessionData.id}:`, err);
                                }
                            }
                        }

                    if (anyTriggered) {
                        toast.info('You were automatically clocked out due to shift end time', {
                            position: "top-right",
                            autoClose: 5000,
                        });

                        // Update local UI state
                        setClockStatus('out');
                        setClockInTime(null);
                        setClockOutTime(null);
                        setTotalBreakTime(0);

                        // Reset lock and refresh context after a delay
                        setTimeout(() => {
                            if (refresh) refresh();
                            isAutoClockingOutRef.current = false;
                        }, 3000);
                    } else {
                        isAutoClockingOutRef.current = false;
                    }
                } else {
                    isAutoClockingOutRef.current = false;
                }
            } catch (error) {
                console.error('[AutoClockOut] Error:', error);
                isAutoClockingOutRef.current = false;
            }
        };

        const intervalId = setInterval(checkAutoClockOut, 30000);
        checkAutoClockOut();

        return () => {
            clearInterval(intervalId);
        };
    }, [user?.uid, refresh]);

    // Refs that mirror state so the restore callback can read them without being in deps
    const clockStatusRef = useRef(clockStatus);
    const breakStartTimeRef = useRef(breakStartTime);
    const totalBreakTimeRef = useRef(totalBreakTime);
    useEffect(() => { clockStatusRef.current = clockStatus; }, [clockStatus]);
    useEffect(() => { breakStartTimeRef.current = breakStartTime; }, [breakStartTime]);
    useEffect(() => { totalBreakTimeRef.current = totalBreakTime; }, [totalBreakTime]);

    // Restore ongoing clock session on mount (if user navigated away and returned)
    // Now uses real-time context data
    // Also syncs when sessionDocs change (e.g., after timesheet edit updates sessions)
    useEffect(() => {
        const restoreSessionState = async () => {
            try {
                // IMPORTANT: Wait for context to finish loading before restoring state
                // This prevents race condition where we set 'out' before sessions are loaded
                // CRITICAL: Skip restoration if a clock operation (in/out/break) is in progress
                // to prevent reverting optimistic state back to stale server values
                if (isLoadingSessions || isClockOperationInProgress) {
                    return;
                }

                if (!user?.uid) return;

                // Read current status via ref to avoid dep cycle
                const currentClockStatus = clockStatusRef.current;

                // Get open session from context first
                let openSession = getOpenSession();

                // If the real-time session context does not yet include an open session,
                // fall back to the backend active session endpoint.
                if (!openSession) {
                    openSession = await getMyActiveSession(user.uid);
                }

                if (openSession) {
                    const rawStartedAt = openSession.startedAt ? new Date(openSession.startedAt) : new Date();

                    // CRITICAL: The backend does not track ongoing breaks (breakStartTime).
                    // If the user is currently on break, do NOT overwrite their status back to 'in'.
                    if (currentClockStatus === 'break') {
                        // Just sync the clock-in time, keep break status as-is
                        setClockInTime(rawStartedAt);
                        setRawClockInTime(rawStartedAt);
                        // Sync server-side break accumulation but keep local breakStartTime
                        if (openSession.breakSec) {
                            setTotalBreakTime(prev => Math.max(prev, openSession.breakSec));
                        }
                        return;
                    }

                    // CRITICAL FIX: Status is 'in' after ending a break.
                    // The server's openSession.breakSec may still be 0 (async write in-flight).
                    // Never let the server's stale 0 overwrite our locally-computed break total.
                    // Use Math.max so we always keep the higher of server vs local.
                    if (currentClockStatus === 'in') {
                        // Update times from server but keep 'in' status
                        setClockInTime(rawStartedAt);
                        setRawClockInTime(rawStartedAt);
                        setClockOutTime(null);
                        setRawClockOutTime(null);
                        // Key fix: don't let a stale server breakSec=0 erase the optimistic total
                        setTotalBreakTime(prev => Math.max(prev, openSession.breakSec || 0));
                        return;
                    }

                    setClockInTime(rawStartedAt);
                    setRawClockInTime(rawStartedAt);
                    setClockOutTime(null);
                    setRawClockOutTime(null);
                    // Use Math.max here too in case restore fires right after endBreak
                    setTotalBreakTime(prev => Math.max(prev, openSession.breakSec || 0));
                    setClockStatus('in');
                    setBreakStartTime(null);
                    return; // If there's an open session, don't check for completed sessions
                }

                // No open session on server.
                // If the local UI still thinks we're clocked in or on break (optimistic state)
                // — don't override until the operation completes or we confirm the server state.
                if (currentClockStatus === 'in' || currentClockStatus === 'break') {
                    // Trust optimistic state — server may be lagging (WS not arrived yet)
                    return;
                }

                // Both server and local agree: clocked out. Show most recent completed session.
                const todaySessions = getTodaySessions();

                // Sort by startedAt descending (most recent first)
                const sortedTodaySessions = todaySessions
                    .filter(s => s.status === 'closed')
                    .sort((a, b) => {
                        const aTime = a.startedAt ? new Date(a.startedAt) : new Date(0);
                        const bTime = b.startedAt ? new Date(b.startedAt) : new Date(0);
                        return bTime - aTime;
                    });

                // If there are completed sessions today, show the most recent one for reference
                // But set status to 'out' so user can clock in again (multiple sessions per day allowed)
                if (sortedTodaySessions.length > 0) {
                    const lastSession = sortedTodaySessions[0];
                    const resolvedClockInTime = lastSession.startedAt ? new Date(lastSession.startedAt) : null;
                    const resolvedClockOutTime = lastSession.endedAt ? new Date(lastSession.endedAt) : null;
                    setClockInTime(resolvedClockInTime);
                    setRawClockInTime(resolvedClockInTime);
                    setClockOutTime(resolvedClockOutTime);
                    setRawClockOutTime(resolvedClockOutTime);
                    setTotalBreakTime(lastSession.breakSec || 0);
                    setBreakStartTime(null);
                    setClockStatus('out'); // Set to 'out' to allow clocking in again
                } else {
                    // No sessions today AND not clocked in. Only reset if we were genuinely 'out'.
                    if (currentClockStatus === 'out') {
                        setClockInTime(null);
                        setRawClockInTime(null);
                        setClockOutTime(null);
                        setRawClockOutTime(null);
                        setTotalBreakTime(0);
                        setBreakStartTime(null);
                    }
                }
            } catch (e) {
                console.error('Failed to restore session state', e);
            }
        };
        restoreSessionState();
    // IMPORTANT: clockStatus is intentionally NOT in deps — we read it via ref.
    // Adding it would cause infinite loops as restore writes to state which changes clockStatus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.uid, isLoadingSessions, getOpenSession, getTodaySessions, isClockOperationInProgress, sessionDocs]);

    // Error handling functions
    const showErrorMessage = useCallback((message, duration = 5000) => {
        setErrorMessage(message);
        setTimeout(() => setErrorMessage(null), duration);
    }, []);

    const getErrorMessage = useCallback((error, operationType) => {
        const baseMessages = {
            clockIn: 'Failed to clock in',
            clockOut: 'Failed to clock out',
            startBreak: 'Failed to start break',
            endBreak: 'Failed to end break'
        };

        const baseMessage = baseMessages[operationType] || 'Operation failed';

        if (error.message?.includes('Clock already running') || error.message?.includes('Already clocked in')) {
            return 'You are already clocked in. Please clock out first.';
        }
        if (error.message?.includes('No open clock session') || error.message?.includes('No active clock session')) {
            return 'No active clock session found. Please clock in first.';
        }
        // Removed: Multiple sessions per day are now allowed, so this error should not occur
        // if (error.message?.includes('already completed your work session') || error.message?.includes('Only one clock in/out session is allowed per day')) {
        //     return 'Work session completed for today. You can clock in again tomorrow.';
        // }
        if (error.message?.includes('cannot clock in again until tomorrow')) {
            return 'Already clocked out for today. You cannot clock in again until tomorrow.';
        }
        if (error.message?.includes('network') || error.code === 'unavailable') {
            return `${baseMessage} due to network issues. Please check your connection and try again.`;
        }

        return error.message || `${baseMessage}. Please try again.`;
    }, []);

    const retryOperation = useCallback(async (operationFn, maxRetries = 3) => {
        let lastError;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                setRetryCount(attempt);
                if (attempt > 0) {
                    // Exponential backoff: 1s, 2s, 4s
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt - 1) * 1000));
                }

                await operationFn();
                setRetryCount(0);
                return; // Success
            } catch (error) {
                lastError = error;
                if (attempt < maxRetries) {
                    // continue retrying
                }
            }
        }

        // All retries failed
        setRetryCount(0);
        throw lastError;
    }, []);

    const reconcileState = useCallback(async () => {
        try {
            const userId = user?.uid || user?.id;
            if (!userId) return;

            const currentStatus = clockStatusRef.current;

            const session = await getMyActiveSession(userId);

            if (session && session.status === 'open') {
                const startedAt = session.startedAt instanceof Date ? session.startedAt : new Date(session.startedAt);
                
                // Server says we're clocked in, update local state
                if (currentStatus === 'out') {
                    setClockInTime(startedAt);
                    setRawClockInTime(startedAt);
                    setClockOutTime(null);
                    setRawClockOutTime(null);
                    setClockStatus('in');
                }
            } else {
                // Server says we're clocked out
                // IMPORTANT: Only update the status flag — do NOT clear the clock-in/out times.
                // Those times are still needed to display the frozen elapsed timer correctly.
                // The restoreSessionState effect will overwrite them with proper server values.
                if (currentStatus !== 'out') {
                    setClockStatus('out');
                    setBreakStartTime(null);
                }
            }
        } catch (error) {
            console.error('Failed to reconcile state:', error);
        }
    }, [user?.uid, user?.id, clockStatus]);

    useEffect(() => {
        if (!user?.uid) return;
        reconcileState();
    }, [user?.uid, reconcileState]);

    // Initial load of weekly hours (recent entries come from context)
    useEffect(() => {
        if (user?.uid) {
            loadWeeklyHours();
        }
    }, [user?.uid, loadWeeklyHours]);

    // Calculate current session break time
    // We no longer track global day breaks via totalBreakTime state to avoid interference.
    // However, we keep the state for the ACTIVE session.
    const calculateCurrentSessionBreakTime = useCallback(() => {
        const openSession = getOpenSession?.();
        return openSession?.breakSec || 0;
    }, [getOpenSession, sessionDocs]);

    // Initialize totalBreakTime for the ACTIVE session
    // Syncs from Firestore when sessionDocs update, but NEVER lets a lower server
    // value erase a locally-computed optimistic break total (e.g. right after endBreak).
    useEffect(() => {
        if (clockStatus === 'in' || clockStatus === 'break') {
            const currentBreakTime = calculateCurrentSessionBreakTime();
            // Use Math.max so the optimistic local value is never wiped by a stale server 0
            setTotalBreakTime(prev => Math.max(prev, currentBreakTime));
        } else if (clockStatus === 'out' && !isClockOperationInProgress) {
            // Only clear totalBreakTime if we are NOT currently clocking out
            setTotalBreakTime(0);
        }
    }, [calculateCurrentSessionBreakTime, isClockOperationInProgress, sessionDocs]); // Added sessionDocs to sync when Firestore updates

    // Load site name
    const loadSiteName = async () => {
        try {
            const siteId = user?.siteId;
            if (!siteId) return;

            const { data: dashboardData } = await hrApiClient.get('/hr/dashboard');
            const site = (dashboardData.sites || []).find(s => s.id === siteId);

            if (site) {
                setSiteName(site.name || site.siteName || 'Main Office');
            }
        } catch (e) {
            console.error('Failed to load site name', e);
            setSiteName('Main Office'); // Fallback
        }
    };

    // Real-time updates are now handled by Firestore listeners in contexts
    // No need for EventBus subscriptions

    // Optimistic updates no longer needed - real-time context handles updates automatically

    useEffect(() => {
        // Recent entries come from real-time context - no need to fetch
        loadWeeklyHours(); // Load weekly hours data
        loadSiteName(); // Load site name
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.uid]);

    // Update current time every second with cleanup
    useEffect(() => {
        timerRef.current = setInterval(() => {
            setCurrentTime(new Date());
        }, 1000);

        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            // Cleanup any pending retry timeouts
            if (clockInRetryTimeoutRef.current) {
                clearTimeout(clockInRetryTimeoutRef.current);
                clockInRetryTimeoutRef.current = null;
            }
            if (clockOutRetryTimeoutRef.current) {
                clearTimeout(clockOutRetryTimeoutRef.current);
                clockOutRetryTimeoutRef.current = null;
            }
            // Clear active operation
            activeClockOperationRef.current = null;
        };
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            // Clear all timeouts and intervals
            if (timerRef.current) clearInterval(timerRef.current);
            if (loadEntriesTimeoutRef.current) clearTimeout(loadEntriesTimeoutRef.current);
            if (reconcileTimeoutRef.current) clearTimeout(reconcileTimeoutRef.current);
        };
    }, []);



    // Calculate elapsed time (Paid Hours) - includes today's completed sessions + current open session
    const calculateElapsedTime = () => {
        const todaySessions = getTodaySessions?.() || [];
        const openSession = getOpenSession?.();
        let totalEffectiveSec = 0;

        // 1. Sum effective duration from all CLOSED sessions today
        todaySessions
            .filter((s) => ['closed', 'ended', 'ended-by-manager', 'ended-by-system'].includes(s.status))
            .forEach((s) => {
                // ✅ CHANGED: Use raw effective time for display to avoid time jumps
                let duration = s.rawDurationEffectiveSec !== undefined && s.rawDurationEffectiveSec !== null
                    ? s.rawDurationEffectiveSec
                    : s.durationEffectiveSec;

                // Fallback: If duration is missing but we have timestamps (happens during DB update), calculate it
                if (duration === undefined || duration === null) {
                    const sStart = s.startedAt?.toDate ? s.startedAt.toDate() : (s.startedAt ? new Date(s.startedAt) : null);
                    const sEnd = s.endedAt?.toDate ? s.endedAt.toDate() : (s.endedAt ? new Date(s.endedAt) : null);
                    if (sStart && sEnd) {
                        duration = Math.max(0, Math.floor((sEnd - sStart) / 1000));
                        // Subtract breaks if available
                        const bSec = s.breakSec || 0;
                        duration = Math.max(0, duration - bSec);
                    }
                }

                totalEffectiveSec += duration || 0;
            });

        // Apply sessionOffsetSec as a floor for today only.
        // This handles the context lag when the user re-clocks in immediately after clocking out:
        // the previous session may still appear as "open" in context (step 1 = 0), so we
        // use the value we captured at clock-out time as a guaranteed minimum.
        const todayStr = new Date().toISOString().split('T')[0];
        if (sessionOffsetDate === todayStr && sessionOffsetSec > 0) {
            totalEffectiveSec = Math.max(totalEffectiveSec, sessionOffsetSec);
        }

        // 2. Add current active session's live effective time
        const effectiveClockStatus = optimisticState?.clockStatus || clockStatus;
        if (openSession || effectiveClockStatus === 'in' || effectiveClockStatus === 'break' || (effectiveClockStatus === 'out' && (clockInTime || rawClockInTime) && (clockOutTime || rawClockOutTime))) {
            // Live tracker should count from the actual clock-in start.
            // (Using rounded clock-in can backdate/shift the timer and break "counts up" behavior.)
            const effectiveStartTime =
                optimisticState?.rawClockInTime || rawClockInTime || optimisticState?.clockInTime || clockInTime;

            if (effectiveStartTime) {
                // Check if this session is already counted in Step 1 to prevent double counting
                const sessionStartTime = new Date(effectiveStartTime).getTime();
                const isAlreadyCounted = todaySessions.some(s => {
                    if (!['closed', 'ended', 'ended-by-manager'].includes(s.status)) return false;
                    const sStart = s.startedAt?.toDate ? s.startedAt.toDate() : new Date(s.startedAt);
                    return Math.abs(new Date(sStart).getTime() - sessionStartTime) < 5000; // 5 second tolerance
                });

                if (!isAlreadyCounted) {
                    // If we're still clocked in (or on break), the "end" is now so the timer counts up.
                    // If we're clocked out, use the recorded clock-out time.
                    const endTime = effectiveClockStatus === 'out'
                        ? (optimisticState?.rawClockOutTime || rawClockOutTime || optimisticState?.clockOutTime || clockOutTime)
                        : new Date();

                    // Calculate elapsed time for THIS session using rounded clock-in/out inputs.
                    let currentSessionGrossSec = Math.max(0, Math.floor((new Date(endTime) - new Date(effectiveStartTime)) / 1000));

                    // Calculate breaks for THIS session only
                    let currentSessionBreakSec = 0;

                    if (effectiveClockStatus === 'out') {
                        // When clocked out, use the local totalBreakTime which was set during clock out
                        currentSessionBreakSec = totalBreakTime || 0;
                    } else if (effectiveClockStatus === 'break') {
                        // Ongoing break: Use live break time from Firestore + current break duration
                        const liveBreakSec = openSession?.breakSec || 0;
                        const effectiveBreakStartTime = optimisticState?.breakStartTime || breakStartTime || new Date();
                        const currentBreakInterval = Math.max(0, Math.floor((new Date() - effectiveBreakStartTime) / 1000));
                        currentSessionBreakSec = liveBreakSec + currentBreakInterval;
                    } else {
                        // Clocked in (not on break): use whichever is larger — the server's
                        // breakSec or the local totalBreakTime.
                        // CRITICAL: after endBreak(), the server may not have updated breakSec yet
                        // (async DB write). Using only openSession.breakSec here would deduct 0
                        // seconds of break, making the timer jump forward by the full break duration.
                        // Taking Math.max() ensures the locally-computed break is always respected
                        // immediately, and the server value takes over once it catches up.
                        const serverBreakSec = openSession?.breakSec || 0;
                        currentSessionBreakSec = Math.max(serverBreakSec, totalBreakTime || 0);
                    }

                    // Effective = Gross - Breaks
                    totalEffectiveSec += Math.max(0, currentSessionGrossSec - currentSessionBreakSec);
                }
            }
        }

        const hours = Math.floor(totalEffectiveSec / 3600);
        const minutes = Math.floor((totalEffectiveSec % 3600) / 60);
        const seconds = totalEffectiveSec % 60;

        return { hours, minutes, seconds };
    };

    // Calculate gross time (including breaks) - includes today's completed sessions + current open session
    const calculateGrossTime = () => {
        const todaySessions = getTodaySessions?.() || [];
        const openSession = getOpenSession?.();
        let totalGrossSec = 0;

        // 1. Sum gross duration from all CLOSED sessions today
        todaySessions
            .filter((s) => ['closed', 'ended', 'ended-by-manager', 'ended-by-system'].includes(s.status))
            .forEach((s) => {
                // ✅ CHANGED: User requested actual time here instead of rounded time
                let duration = s.rawDurationGrossSec !== undefined && s.rawDurationGrossSec !== null ? s.rawDurationGrossSec : s.durationGrossSec;

                // Fallback: If duration is missing but we have timestamps (happens during DB update), calculate it
                if (duration === undefined || duration === null) {
                    const sStart = s.startedAt?.toDate ? s.startedAt.toDate() : (s.startedAt ? new Date(s.startedAt) : null);
                    const sEnd = s.endedAt?.toDate ? s.endedAt.toDate() : (s.endedAt ? new Date(s.endedAt) : null);
                    if (sStart && sEnd) {
                        duration = Math.max(0, Math.floor((sEnd - sStart) / 1000));
                    }
                }

                totalGrossSec += duration || 0;
            });

        // 2. Add current active session's live gross time
        const effectiveClockStatus = optimisticState?.clockStatus || clockStatus;
        if (openSession || effectiveClockStatus === 'in' || effectiveClockStatus === 'break' || (effectiveClockStatus === 'out' && (clockInTime || rawClockInTime) && (clockOutTime || rawClockOutTime))) {
            // [FIX] Use RAW clock-in time for live display
            const effectiveStartTime = optimisticState?.rawClockInTime || rawClockInTime || optimisticState?.clockInTime || clockInTime;

            if (effectiveStartTime) {
                // Check if this session is already counted in Step 1 to prevent double counting
                const sessionStartTime = new Date(effectiveStartTime).getTime();
                const isAlreadyCounted = todaySessions.some(s => {
                    if (!['closed', 'ended', 'ended-by-manager'].includes(s.status)) return false;
                    const sStart = s.startedAt?.toDate ? s.startedAt.toDate() : new Date(s.startedAt);
                    return Math.abs(new Date(sStart).getTime() - sessionStartTime) < 5000; // 5 second tolerance
                });

                if (!isAlreadyCounted) {
                    const endTime = (effectiveClockStatus === 'out' ? (optimisticState?.rawClockOutTime || rawClockOutTime || optimisticState?.clockOutTime || clockOutTime) : null) || optimisticState?.rawClockOutTime || rawClockOutTime || new Date();
                    totalGrossSec += Math.max(0, Math.floor((new Date(endTime) - new Date(effectiveStartTime)) / 1000));
                }
            }
        }

        const hours = Math.floor(totalGrossSec / 3600);
        const minutes = Math.floor((totalGrossSec % 3600) / 60);
        const seconds = totalGrossSec % 60;

        return { hours, minutes, seconds };
    };

    const formatTime = (time) => {
        return `${String(time.hours).padStart(2, '0')}h ${String(time.minutes).padStart(2, '0')}m`;
    };

    const formatHours = (hoursValue) => {
        if (!hoursValue || hoursValue <= 0) return '0h';

        // Convert to total minutes (with small epsilon for float safety)
        const totalMinutes = Math.floor(hoursValue * 60 + 0.001);
        const h = Math.floor(totalMinutes / 60);
        const m = totalMinutes % 60;

        if (h === 0) return `${m}m`;
        if (m === 0) return `${h}h`;
        // ✅ Pad minutes with zero to match Timesheet List format (e.g. 3h 02m)
        return `${h}h ${String(m).padStart(2, '0')}m`;
    };

    const formatCurrentDate = (date) => {
        return date.toLocaleDateString('en-US', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });
    };

    // Format time for display (HH:MM AM/PM)
    const formatTimeDisplay = (date) => {
        if (!date) return null;
        try {
            const time = date instanceof Date ? date : (date.toDate ? date.toDate() : new Date(date));
            return time.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
        } catch (err) {
            return null;
        }
    };

    // Get today's clock in and clock out times
    const getTodayClockTimes = () => {
        const today = new Date();
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

        // Check if clockInTime is today
        let todayClockIn = null;
        let todayClockOut = null;

        if (clockInTime) {
            const clockInDate = clockInTime instanceof Date ? clockInTime : (clockInTime.toDate ? clockInTime.toDate() : new Date(clockInTime));
            if (clockInDate >= todayStart && clockInDate <= todayEnd) {
                todayClockIn = clockInTime;
            }
        }

        if (clockOutTime) {
            const clockOutDate = clockOutTime instanceof Date ? clockOutTime : (clockOutTime.toDate ? clockOutTime.toDate() : new Date(clockOutTime));
            if (clockOutDate >= todayStart && clockOutDate <= todayEnd) {
                todayClockOut = clockOutTime;
            }
        }

        return {
            clockIn: todayClockIn,
            clockOut: todayClockOut
        };
    };

    const handleClockIn = async (e) => {
        try {
            // Defensive: Prevent default browser behavior (reload/submit)
            if (e && e.preventDefault) e.preventDefault();
            if (e && e.stopPropagation) e.stopPropagation();

            // Prevent duplicate operations
            if (activeClockOperationRef.current === 'clockIn' || isClockOperationInProgress) {
                toast.warn('Clock-in already in progress. Please wait...', { autoClose: 2000 });
                return;
            }

            // Check location first (force fresh GPS fix on action)
            const freshCheck = await checkLocation({ forceFresh: true });
            if (!freshCheck?.isValid) {
                toast.error(freshCheck?.error || locationError || 'You must be within an allowed location to clock in.');
                return;
            }

            // Check for shift change before clocking in
            try {
                const userId = user?.uid;
                if (!userId) {
                    showErrorMessage('User not found. Please refresh the page.');
                    return;
                }

                // Get current shift and check for changes
                const currentShift = await getUserShift(userId);
                const clockInTime = new Date(); // Define clockInTime here for the modal

                // Check for shift change
                const shiftDetection = detectShiftChange(clockInTime, currentShift);

                if (shiftDetection.hasChange && shiftDetection.suggestedShift !== currentShift) {
                    // Show modal if shift change detected
                    setShiftModalData({
                        currentShift,
                        suggestedShift: shiftDetection.suggestedShift,
                        reason: shiftDetection.reason,
                        clockInTime
                    });
                    setShowShiftModal(true);
                    setPendingClockIn(true);
                    return;
                }

                // No shift change needed, proceed with clock in
                await proceedWithClockIn();
            } catch (error) {
                console.error('Error checking shift:', error);
                // If shift check fails, proceed with clock in anyway
                await proceedWithClockIn();
            }
        } catch (error) {
            console.error("Clock In Error:", error);
            if (e && e.preventDefault) e.preventDefault();
            // Optional: toast.error(error.message);
        }
    };

    const handleShiftConfirm = async (confirmedShift) => {
        try {
            const userId = user?.uid;
            if (userId && confirmedShift !== shiftModalData.currentShift) {
                await updateUserShift(userId, confirmedShift);
                setCurrentShift(confirmedShift); // Update local state
            }
        } catch (error) {
            console.error('Error updating shift:', error);
            // Continue with clock in even if shift update fails
        } finally {
            setShowShiftModal(false);
            setShiftModalData(null);

            // Proceed with clock in after shift confirmation
            if (pendingClockIn) {
                setPendingClockIn(false);
                await proceedWithClockIn();
            }
        }
    };

    const handleShiftChange = async (newShift) => {
        if (!user?.uid) {
            toast.error('User not found');
            return;
        }
        if (newShift === currentShift) return;

        // Prevent shift change while clocked in
        if (clockStatus === 'in' || clockStatus === 'break') {
            toast.error('Please clock out before changing your shift');
            return;
        }

        try {
            setIsUpdatingShift(true);
            await updateUserShift(user.uid, newShift);
            setCurrentShift(newShift);
            toast.success(`Shift updated to ${formatShiftName(newShift)}`);
        } catch (error) {
            console.error('Error updating shift:', error);
            toast.error('Failed to update shift preference');
        } finally {
            setIsUpdatingShift(false);
        }
    };

    const proceedWithClockIn = async () => {
        if (activeClockOperationRef.current === 'clockIn') return;
        activeClockOperationRef.current = 'clockIn';
        startOperation('clockIn');

        const currentTime = new Date();
        const userId = user?.uid || 'unknown';
        const companyId = (user?.companyId || '').split('/')[1] || '';
        const siteId = (user?.siteId || '').split('/')[1] || '';

        // Snapshot previous display state so we can restore it on error
        const prevClockInTime = clockInTime;
        const prevRawClockInTime = rawClockInTime;
        const prevClockOutTime = clockOutTime;
        const prevRawClockOutTime = rawClockOutTime;

        // Apply rounding to the clock-in time for immediate display
        const { resolveRoundingRules } = await import('../../services/roundingRules');
        const { roundSessionRange } = await import('../../utils/timeRounding');
        const roundingRules = await resolveRoundingRules(companyId, siteId);
        const { roundedStart } = roundSessionRange(currentTime, currentTime, roundingRules);

        setClockInTime(roundedStart); // Display time (rounded)
        setRawClockInTime(currentTime); // Raw time for calculations
        setClockOutTime(null);
        setRawClockOutTime(null);
        setClockStatus('in');
        setTotalBreakTime(0); // Reset break counter for this new session
        setBreakStartTime(null);

        // OPTIMIZATION: Make clock in instant, fetch data in background
        try {
            // Start clock in immediately without waiting for background data
            startClock({
                userId,
                companyId,
                siteId,
                assignedLocationId: null,
                assignedLocationName: null
            }).then(async () => {
                // Clock-in confirmed by server — show success toast
                toast.success('Clocked in successfully ⏰', { autoClose: 3000 });

                // Fetch location data in background after successful clock in
                try {
                    const today = new Date();
                    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
                    const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999).toISOString();

                    const schedules = await getUserSchedules(user.id, todayStart, todayEnd);
                    const todayShift = schedules.find(s => s.status === 'accepted');

                    if (todayShift) {
                        // Logic for assigned location if needed
                    }
                } catch (error) {
                    console.warn('Background location fetch failed:', error);
                }
            }).catch((error) => {
                // Revert UI on error — restore previous session display
                setClockStatus('out');
                setClockInTime(prevClockInTime);
                setRawClockInTime(prevRawClockInTime);
                setClockOutTime(prevClockOutTime);
                setRawClockOutTime(prevRawClockOutTime);

                // Show error
                const errorMsg = getErrorMessage(error, 'clockIn');
                toast.error(errorMsg, { autoClose: 5000 });
            }).finally(() => {
                // Always clear the operation state
                activeClockOperationRef.current = null;
                endOperation();
            });

        } catch (error) {
            // Handle synchronous errors — restore previous display state
            setClockStatus('out');
            setClockInTime(prevClockInTime);
            setRawClockInTime(prevRawClockInTime);
            setClockOutTime(prevClockOutTime);
            setRawClockOutTime(prevRawClockOutTime);
            activeClockOperationRef.current = null;
            endOperation();
            const errorMsg = getErrorMessage(error, 'clockIn');
            toast.error(errorMsg, { autoClose: 5000 });
        }
    };

    const handleClockOutClick = () => {
        setShowClockOutModal(true);
    };

    const handleClockOut = async (e, notes) => {
        // Prevent duplicate operations
        if (activeClockOperationRef.current === 'clockOut' || isClockOperationInProgress) {
            toast.warn('Clock-out already in progress. Please wait...', { autoClose: 2000 });
            return;
        }

        activeClockOperationRef.current = 'clockOut';
        startOperation('clockOut');

        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();

        const currentTime = new Date();
        let extraBreak = 0;
        if (breakStartTime) extraBreak = Math.floor((currentTime - breakStartTime) / 1000);
        const finalBreakTime = totalBreakTime + extraBreak;

        // Snapshot total elapsed seconds BEFORE resetting state so the next clock-in
        // can continue the timer from the right value even if context lags.
        if (rawClockInTime) {
            const grossSec = Math.max(0, Math.floor((currentTime - new Date(rawClockInTime)) / 1000));
            const currentSessionEffSec = Math.max(0, grossSec - finalBreakTime);
            const closedSec = (getTodaySessions?.() || [])
                .filter(s => ['closed', 'ended', 'ended-by-manager', 'ended-by-system'].includes(s.status))
                .reduce((sum, s) => sum + (s.rawDurationEffectiveSec ?? s.durationEffectiveSec ?? 0), 0);
            setSessionOffsetSec(closedSec + currentSessionEffSec);
            setSessionOffsetDate(currentTime.toISOString().split('T')[0]);
        }

        const userId = user?.uid || 'unknown';
        const companyId = (user?.companyId || '').split('/')[1] || '';
        const siteId = (user?.siteId || '').split('/')[1] || '';
        const pupilCountValue = pupilCount;

        // Apply rounding to the clock-out time for immediate display
        const { resolveRoundingRules } = await import('../../services/roundingRules');
        const { roundSessionRange } = await import('../../utils/timeRounding');
        const roundingRules = await resolveRoundingRules(companyId, siteId);
        const { roundedEnd } = roundSessionRange(rawClockInTime || currentTime, currentTime, roundingRules);

        setClockOutTime(roundedEnd); // Display time (rounded)
        setRawClockOutTime(currentTime); // Raw time for calculations
        setClockStatus('out');
        // Keep rawClockInTime and clockInTime so the timer and totals remain fixed at current values
        // They will be cleared/overwritten on next clock in or full page refresh
        setTotalBreakTime(finalBreakTime);
        setBreakStartTime(null);
        setShowClockOutModal(false);
        setPupilCount('');

        // OPTIMIZATION: Make clock out instant, handle heavy processing in background
        // Pass endedAt: currentTime so duration uses user's actual clock-out moment (not serverTimestamp which can add minutes due to network latency)
        try {
            // Start clock out immediately
            stopClock({
                userId,
                breakSec: finalBreakTime,
                endedAt: currentTime, // Use client time for accurate duration (avoids extra minutes from server processing delay)
                pupilCount: pupilCountValue || null,
                notes: notes || null
            }).then(() => {
                // Clock out succeeded, operation complete
                activeClockOperationRef.current = null;
                endOperation();
            }).catch((error) => {
                // Revert UI on error
                setClockStatus('in');
                setClockOutTime(null);

                // Check if this is an auto clock-out scenario and provide better error message
                if (error.message && error.message.includes('No active clock session found')) {
                    // Check if user was recently auto clocked out by looking at today's sessions
                    const todaySessions = getTodaySessions();
                    const recentClosedSession = todaySessions
                        .filter(s => s.status === 'closed' && s.autoClockOut)
                        .sort((a, b) => {
                            const aTime = a.endedAt?.toDate ? a.endedAt.toDate() : new Date(0);
                            const bTime = b.endedAt?.toDate ? b.endedAt.toDate() : new Date(0);
                            return bTime - aTime;
                        })[0];

                    if (recentClosedSession) {
                        const clockOutTime = recentClosedSession.roundedEndedAt?.toDate ?
                            recentClosedSession.roundedEndedAt.toDate() :
                            recentClosedSession.endedAt?.toDate ?
                                recentClosedSession.endedAt.toDate() : null;

                        const formattedTime = clockOutTime ?
                            clockOutTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) :
                            'earlier';

                        toast.warning(`You were automatically clocked out at ${formattedTime}. No need to clock out again.`, {
                            autoClose: 8000
                        });

                        // Update UI to show the correct clock-out state
                        setClockStatus('out');
                        setClockOutTime(clockOutTime);
                        setRawClockOutTime(clockOutTime);
                    } else {
                        toast.error('Clock out failed. Please try again manually.', { autoClose: 5000 });
                    }
                } else {
                    toast.error('Clock out failed. Please try again manually.', { autoClose: 5000 });
                }

                // Clear operation state
                activeClockOperationRef.current = null;
                endOperation();

                if (clockOutRetryTimeoutRef.current) {
                    clearTimeout(clockOutRetryTimeoutRef.current);
                    clockOutRetryTimeoutRef.current = null;
                }
            });
        } catch (error) {
            // Handle synchronous errors
            setClockStatus('in');
            setClockOutTime(null);
            activeClockOperationRef.current = null;
            endOperation();

            // Check if this is an auto clock-out scenario and provide better error message
            if (error.message && error.message.includes('No active clock session found')) {
                const todaySessions = getTodaySessions();
                const recentClosedSession = todaySessions
                    .filter(s => s.status === 'closed' && s.autoClockOut)
                    .sort((a, b) => {
                        const aTime = a.endedAt?.toDate ? a.endedAt.toDate() : new Date(0);
                        const bTime = b.endedAt?.toDate ? b.endedAt.toDate() : new Date(0);
                        return bTime - aTime;
                    })[0];

                if (recentClosedSession) {
                    const clockOutTime = recentClosedSession.roundedEndedAt?.toDate ?
                        recentClosedSession.roundedEndedAt.toDate() :
                        recentClosedSession.endedAt?.toDate ?
                            recentClosedSession.endedAt.toDate() : null;

                    const formattedTime = clockOutTime ?
                        clockOutTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) :
                        'earlier';

                    toast.warning(`You were automatically clocked out at ${formattedTime}. No need to clock out again.`, {
                        autoClose: 8000
                    });

                    // Update UI to show the correct clock-out state
                    setClockStatus('out');
                    setClockOutTime(clockOutTime);
                    setRawClockOutTime(clockOutTime);
                } else {
                    toast.error('Clock out failed. Please try again manually.', { autoClose: 5000 });
                }
            } else {
                toast.error('Clock out failed. Please try again manually.', { autoClose: 5000 });
            }
        }
    };

    const handleStartBreak = async (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();

        await executeOperation('startBreak', async () => {
            startOperation('startBreak');

            const currentTime = new Date();
            const openSession = getOpenSession?.();
            const sessionId = openSession?.sessionId || null;

            const breakResult = await startBreak({ userId: user.uid, sessionId });
            const breakStartedAt = breakResult.breakStartTime ? new Date(breakResult.breakStartTime) : currentTime;

            setOptimisticClockState({
                clockStatus: 'break',
                breakStartTime: breakStartedAt
            });
            setBreakStartTime(breakStartedAt);
            setClockStatus('break');

            endOperation();
        });
    };

    const handleEndBreak = async (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();

        await executeOperation('endBreak', async () => {
            startOperation('endBreak');

            const previousBreakStartTime = breakStartTime;
            const previousTotalBreakTime = totalBreakTime;
            const currentTime = new Date();
            const optimisticBreakDurationSec = previousBreakStartTime
                ? Math.max(0, Math.floor((currentTime - previousBreakStartTime) / 1000))
                : 0;
            const optimisticTotalBreakTime = previousTotalBreakTime + optimisticBreakDurationSec;

            setOptimisticClockState({
                clockStatus: 'in',
                breakStartTime: null,
                totalBreakTime: optimisticTotalBreakTime
            });
            setTotalBreakTime(optimisticTotalBreakTime);
            setBreakStartTime(null);
            setClockStatus('in');

            try {
                const result = await endBreak({
                    userId: user.uid,
                    sessionId: getOpenSession?.()?.sessionId || null,
                    breakStartTime: previousBreakStartTime ? previousBreakStartTime.toISOString() : null,
                });

                if (Number.isFinite(result?.totalBreakSec)) {
                    setTotalBreakTime(result.totalBreakSec);
                }
            } catch (error) {
                revertOptimisticState();
                setTotalBreakTime(previousTotalBreakTime);
                setBreakStartTime(previousBreakStartTime || null);
                setClockStatus('break');
                console.error('Failed to end break:', error);
                showErrorMessage(error.message || 'Failed to end break. Please try again.', 3000);
            } finally {
                endOperation();
            }
        });
    };

    const handleSubmitTimesheet = () => {
        setShowTimesheetModal(false);
        toast.success('Timesheet submitted for this week');
    };

    const handleRefreshLocation = () => {
    }

    const handleGetDirection = () => {
    }

    const pretty = (role = '') =>
        role.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());

    // Helper functions for optimistic state management
    const startOperation = useCallback((type) => {
        setIsClockOperationInProgress(true);
        setOperationType(type);
        setOperationStartTime(new Date());
    }, []);

    const endOperation = useCallback(() => {
        setIsClockOperationInProgress(false);
        setOperationType(null);
        setOptimisticState(null);
        setOperationStartTime(null);
    }, []);

    const revertOptimisticState = useCallback(() => {
        setOptimisticState(null);
    }, []);

    const setOptimisticClockState = useCallback((newState) => {
        setOptimisticState(prevOptimistic => ({
            ...prevOptimistic,
            ...newState
        }));
    }, []);

    // Enhanced status display function
    const getStatusDisplay = useCallback(() => {
        if (isClockOperationInProgress) {
            switch (operationType) {
                case 'clockIn': return 'Clocking In...';
                case 'clockOut': return 'Clocking Out...';
                case 'startBreak': return 'Starting Break...';
                case 'endBreak': return 'Ending Break...';
                default: return 'Processing...';
            }
        }

        const effectiveStatus = optimisticState?.clockStatus || clockStatus;
        switch (effectiveStatus) {
            case 'out': return 'Clocked Out';
            case 'break': return 'On Break';
            case 'in': return 'Clocked In';
            case 'completed': return 'Work Session Completed';
            default: return 'Unknown';
        }
    }, [isClockOperationInProgress, operationType, optimisticState?.clockStatus, clockStatus]);

    // Get status styling based on current state
    const getStatusStyling = useCallback(() => {
        if (isClockOperationInProgress) {
            return 'text-blue-600 animate-pulse';
        }

        const effectiveStatus = optimisticState?.clockStatus || clockStatus;
        switch (effectiveStatus) {
            case 'out': return 'text-gray-600';
            case 'break': return 'text-orange-600';
            case 'in': return 'text-green-600';
            case 'completed': return 'text-purple-600';
            default: return 'text-gray-600';
        }
    }, [isClockOperationInProgress, optimisticState?.clockStatus, clockStatus]);

    // Error handling functions
    const handleRefreshClockData = useCallback(async () => {
        if (isRefreshing) return;

        setIsRefreshing(true);

        try {
            if (!user?.uid) return;

            // Check for open session
            const session = await getMyActiveSession(user.uid || user.id);

            if (session && session.status === 'open') {
                // Server says we are clocked IN
                const startedAt = session.startedAt instanceof Date ? session.startedAt : new Date(session.startedAt);

                // Always update clock-in time from server (most authoritative source)
                setClockInTime(startedAt);
                setRawClockInTime(startedAt);
                setClockOutTime(null);
                setRawClockOutTime(null);
                // Use Math.max — manual refresh may race with an async endBreak DB write;
                // if the server breakSec is still 0, keep the local optimistic total
                setTotalBreakTime(prev => Math.max(prev, session.breakSec || 0));

                // Determine if user was on break
                // Backend doesn't track breakStartTime; if local state says 'break' keep it
                const currentStatus = clockStatusRef.current;
                if (currentStatus === 'break') {
                    // Keep break status, don't overwrite breakStartTime
                } else {
                    setClockStatus('in');
                    setBreakStartTime(null);
                }

                toast.success('Clock status refreshed — you are clocked in', { autoClose: 2000 });
            } else {
                // Server says NO open session — clocked out or never clocked in today
                const currentStatus = clockStatusRef.current;

                if (currentStatus === 'in' || currentStatus === 'break') {
                    // Server and local disagree — server wins; set to clocked out
                    // But keep the clock-in/out TIMES from context so elapsed doesn't jump to 0.
                    // The restoreSessionState will sync the proper completed session shortly.
                    setClockStatus('out');
                    setBreakStartTime(null);
                    toast.info('You have been clocked out', { autoClose: 3000 });
                }
                // If already 'out' locally and server agrees — just refresh context
                // Trigger context refresh to pull latest completed sessions
                if (refresh) refresh();
            }

            // Refresh weekly hours
            await loadWeeklyHours();

        } catch (error) {
            console.error('[EmployeeDashboard] Refresh failed:', error);
            toast.error('Failed to refresh clock status');
        } finally {
            setIsRefreshing(false);
        }
    }, [isRefreshing, user?.uid, user?.id, clockStatus, loadWeeklyHours, refresh]);


    // Debouncing and conflict prevention
    const canPerformOperation = useCallback((operationType) => {
        const now = Date.now();
        const timeSinceLastOperation = now - lastOperationTime;
        const minInterval = 2000; // Minimum 2 seconds between operations (increased to prevent loops)

        // Check if operation is already in progress
        if (isClockOperationInProgress || activeClockOperationRef.current) {
            showErrorMessage('Please wait for the current operation to complete.', 3000);
            return false;
        }

        if (timeSinceLastOperation < minInterval) {
            const remainingTime = Math.ceil((minInterval - timeSinceLastOperation) / 1000);
            showErrorMessage(`Please wait ${remainingTime} second(s) before trying again.`, 3000);
            return false;
        }

        return true;
    }, [isClockOperationInProgress, lastOperationTime, showErrorMessage]);

    const executeOperation = useCallback(async (operationType, operationFn) => {
        if (!canPerformOperation(operationType)) {
            return;
        }

        setLastOperationTime(Date.now());
        await operationFn();
    }, [canPerformOperation]);

    // Performance optimization: batch state updates
    const batchStateUpdate = useCallback((updates) => {
        // Use React's automatic batching for better performance
        Object.entries(updates).forEach(([setter, value]) => {
            setter(value);
        });
    }, []);

    // Optimized error message with auto-dismiss
    useEffect(() => {
        if (errorMessage) {
            const timer = setTimeout(() => setErrorMessage(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [errorMessage]);

    if (currentView === 'restricted') {
        return <RestrictedAccessPage
            onBack={() => setCurrentView('dashboard')}
            onRefresh={handleRefreshLocation}
            onGetDirection={handleGetDirection}
        />;
    }

    // Memoized time calculations for performance (includes today's completed sessions from DB)
    const elapsedTime = useMemo(() => calculateElapsedTime(), [
        clockInTime,
        clockOutTime,
        rawClockInTime,
        rawClockOutTime,
        clockStatus,
        breakStartTime,
        totalBreakTime,
        optimisticState,
        currentTime,
        getTodaySessions,
        getOpenSession,
        sessionOffsetSec,
        sessionOffsetDate
    ]);

    const grossTime = useMemo(() => calculateGrossTime(), [
        clockInTime,
        clockOutTime,
        rawClockInTime,
        rawClockOutTime,
        clockStatus,
        optimisticState,
        currentTime,
        getTodaySessions,
        getOpenSession
    ]);

    // Calculate sum of effective seconds from historical timesheet documents in current week (excluding today)
    const workedBeforeToday = useMemo(() => {
        if (!currentWeekData || !currentWeekData.entries) return 0;

        const todayStr = formatISODate(new Date());
        let total = 0;

        currentWeekData.entries.forEach(ts => {
            // CRITICAL FIX: To support both daily and weekly timesheets correctly without double-counting,
            // we must iterate through entries and filter by date. Relying on ts.totals is unsafe if 
            // the document covers multiple days (like a weekly timesheet anchored on Monday).
            if (ts.entries && Array.isArray(ts.entries) && ts.entries.length > 0) {
                ts.entries.forEach(e => {
                    // Only count entries for days that are NOT today
                    if (e.date !== todayStr) {
                        // IMPORTANT: Prefer rounded effective time so dashboard "This Week" matches timesheet paid hours.
                        const sec = e.effectiveSec !== undefined && e.effectiveSec !== null
                            ? e.effectiveSec
                            : (e.rawEffectiveSec || 0);
                        total += sec;
                    }
                });
            } else if (ts.period !== todayStr) {
                // Fallback for legacy documents or manual entries that don't have an entries array
                if (ts.totals) {
                    // IMPORTANT: Prefer rounded effective totals.
                    const sec = ts.totals.effectiveSec !== undefined && ts.totals.effectiveSec !== null
                        ? ts.totals.effectiveSec
                        : (ts.totals.rawEffectiveSec || 0);
                    total += sec;
                }
            }
        });
        return total;
    }, [currentWeekData]);

    // Calculate live weekly total combining historical data and live today's time
    const liveWeeklyWorkedSeconds = useMemo(() => {
        const todayLiveSec = (elapsedTime.hours * 3600) + (elapsedTime.minutes * 60) + elapsedTime.seconds;
        return workedBeforeToday + todayLiveSec;
    }, [workedBeforeToday, elapsedTime]);

    const liveWeeklyPercentage = useMemo(() => {
        if (!weeklyHours.scheduled || weeklyHours.scheduled <= 0) return 0;
        return Math.min(100, Math.round((liveWeeklyWorkedSeconds / weeklyHours.scheduled) * 100));
    }, [liveWeeklyWorkedSeconds, weeklyHours.scheduled]);

    return (
        <div className="h-screen flex flex-col overflow-hidden bg-gray-50">
            <Header
                title={`${pretty(user?.role || 'employee')} Dashboard`}
                subtitle="Ensure compliance and manage onboarding from one place."
            />

            <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-custom">
                {/* Error Message Display */}
                {errorMessage && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                        <div className="flex items-center">
                            <AlertTriangle className="h-5 w-5 text-red-600 mr-3" />
                            <div className="flex-1">
                                <p className="text-sm font-medium text-red-800">{errorMessage}</p>
                                {retryCount > 0 && (
                                    <p className="text-xs text-red-600 mt-1">
                                        Retrying... (Attempt {retryCount + 1})
                                    </p>
                                )}
                            </div>
                            <button
                                onClick={() => setErrorMessage(null)}
                                className="text-red-600 hover:text-red-800"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                )}

                {/* Stats Cards */}
                {/* Demo Button */}
                {/* <div className="text-center">
                    <button
                        onClick={() => setCurrentView('restricted')}
                        className="text-md my-2 text-purple-600 hover:text-purple-700 underline"
                    >
                        View Restricted Access Page (Demo)
                    </button>
                </div> */}
                <div className="flex flex-wrap gap-4">
                    <StatCard
                        title="Clock Status"
                        value={getStatusDisplay()}
                        subtitle={siteName}
                        icon={<Clock className={`h-6 w-6 ${isClockOperationInProgress ? 'animate-spin' : ''} text-blue-600`} />}
                        iconBgColor="bg-blue-50"
                    />

                    <div className='sm:hidden block w-full'>

                        <SectionContainer
                            title="Time Clock"
                            action={
                                <div className="flex items-center gap-3">
                                    {/* Refresh Button */}
                                    <button
                                        type="button"
                                        onClick={handleRefreshClockData}
                                        disabled={isRefreshing || isClockOperationInProgress}
                                        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-purple-600 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        title="Refresh clock status"
                                    >
                                        <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                                        {isRefreshing ? 'Refreshing...' : 'Refresh'}
                                    </button>

                                    {/* Location Info */}
                                    <div className="flex items-center gap-2 text-gray-600">
                                        <MapPin className="h-4 w-4" />
                                        <span className="text-sm font-medium">{siteName}</span>
                                    </div>
                                </div>
                            }
                        >
                            <div className="p-6">
                                <div className="flex sm:flex-row flex-col gap-4 items-start justify-between">
                                    <div>
                                        <TimeDisplay
                                            time={elapsedTime}
                                            isActive={true}
                                        />
                                        <p className="text-sm text-gray-600 mb-4">{formatCurrentDate(currentTime)}</p>

                                        {/* Shift Selector */}
                                        {/*
                                        <div className="mb-4 p-3 bg-purple-50 rounded-lg border border-purple-200">
                                            <p className="text-xs text-purple-700 font-medium mb-2">Current Shift</p>
                                            {isLoadingShift ? (
                                                <div className="flex items-center gap-2">
                                                    <Loader2 className="h-4 w-4 animate-spin text-purple-600" />
                                                    <span className="text-sm text-purple-600">Loading...</span>
                                                </div>
                                            ) : (
                                                <>
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={() => handleShiftChange(SHIFT_TYPES.DAY)}
                                                            disabled={isUpdatingShift || clockStatus === 'in' || clockStatus === 'break'}
                                                            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border-2 transition-all text-sm ${currentShift === SHIFT_TYPES.DAY
                                                                ? 'border-purple-600 bg-white text-purple-700 font-medium'
                                                                : 'border-gray-300 bg-white text-gray-700 hover:border-purple-400'
                                                                } ${(isUpdatingShift || clockStatus === 'in' || clockStatus === 'break') ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                                                        >
                                                            <Sun className="h-4 w-4" />
                                                            <span>Day</span>
                                                        </button>
                                                        <button
                                                            onClick={() => handleShiftChange(SHIFT_TYPES.NIGHT)}
                                                            disabled={isUpdatingShift || clockStatus === 'in' || clockStatus === 'break'}
                                                            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border-2 transition-all text-sm ${currentShift === SHIFT_TYPES.NIGHT
                                                                ? 'border-purple-600 bg-white text-purple-700 font-medium'
                                                                : 'border-gray-300 bg-white text-gray-700 hover:border-purple-400'
                                                                } ${(isUpdatingShift || clockStatus === 'in' || clockStatus === 'break') ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                                                        >
                                                            <Moon className="h-4 w-4" />
                                                            <span>Night</span>
                                                        </button>
                                                    </div>
                                                    {(clockStatus === 'in' || clockStatus === 'break') && (
                                                        <p className="text-xs text-orange-600 mt-2 flex items-center gap-1">
                                                            <AlertTriangle className="h-3 w-3" />
                                                            <span>Clock out to change your shift</span>
                                                        </p>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                        */}


                                        {/* Today's Clock In/Out Times */}
                                        {(() => {
                                            const todayTimes = getTodayClockTimes();
                                            // Show clock in if we have it for today, or if currently clocked in
                                            const effectiveClockIn = todayTimes.clockIn || ((clockStatus === 'in' || clockStatus === 'break') && clockInTime ? clockInTime : null);
                                            const clockInDisplay = formatTimeDisplay(effectiveClockIn);
                                            // Show clock out if we have it for today, or if session is completed
                                            const effectiveClockOut = todayTimes.clockOut || (clockStatus === 'out' && clockOutTime ? clockOutTime : null);
                                            const clockOutDisplay = formatTimeDisplay(effectiveClockOut);

                                            if (clockInDisplay || clockOutDisplay) {
                                                return (
                                                    <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                                                        <div className="space-y-2 text-sm">
                                                            {clockInDisplay && (
                                                                <div className="flex items-center justify-between">
                                                                    <span className="text-gray-600 font-medium">Clock In:</span>
                                                                    <span className="text-gray-900 font-semibold">{clockInDisplay}</span>
                                                                </div>
                                                            )}
                                                            {clockOutDisplay && (
                                                                <div className="flex items-center justify-between">
                                                                    <span className="text-gray-600 font-medium">Clock Out:</span>
                                                                    <span className="text-gray-900 font-semibold">{clockOutDisplay}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            }
                                            return null;
                                        })()}

                                        <div className="space-y-1">
                                            <p className="text-sm text-gray-700">
                                                <span className="font-medium">Total Hours Today</span>
                                            </p>
                                            <p className="text-sm">
                                                <span className="font-medium text-gray-900">Paid Hours:</span>{' '}
                                                <span className={clockStatus !== 'out' || clockOutTime ? 'text-purple-600 font-semibold' : 'text-gray-900'}>
                                                    {formatTime(elapsedTime)}
                                                </span>
                                            </p>
                                            <p className="text-sm">
                                                <span className="font-medium text-gray-900">Gross:</span>{' '}
                                                <span className={clockStatus !== 'out' || clockOutTime ? 'text-purple-600 font-semibold' : 'text-gray-900'}>
                                                    {formatTime(grossTime)}
                                                </span>
                                            </p>
                                            {((optimisticState?.clockStatus || clockStatus) === 'break' || (isClockOperationInProgress && (operationType === 'startBreak' || operationType === 'endBreak'))) && (
                                                <p className="text-sm mt-2">
                                                    <StatusIndicator
                                                        status={optimisticState?.clockStatus || clockStatus}
                                                        isLoading={isClockOperationInProgress && (operationType === 'startBreak' || operationType === 'endBreak')}
                                                        operationType={operationType}
                                                    />
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex flex-col gap-3">
                                        {(optimisticState?.clockStatus || clockStatus) === 'out' && (
                                            <>
                                                <Button
                                                    type="button"
                                                    variant='gradient'
                                                    icon={isClockOperationInProgress && operationType === 'clockIn' ? Loader2 : ArrowRight}
                                                    onClick={(e) => { e.preventDefault(); handleClockIn(e); }}
                                                    disabled={isClockOperationInProgress || !isLocationValid || isCheckingLocation || isLoadingSessions}
                                                    cn="h-14 px-8"
                                                >
                                                    {isLoadingSessions ? 'Loading...' : (isClockOperationInProgress && operationType === 'clockIn' ? 'Clocking In...' : 'Clock In')}
                                                </Button>
                                                {!isLocationValid && locationError && (
                                                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                                                        <div className="flex items-start gap-2">
                                                            <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                                                            <div className="flex-1 min-w-0">
                                                                <p className="text-xs font-medium text-red-800">Location Restricted</p>
                                                                <p className="text-xs text-red-600 mt-0.5">{locationError}</p>
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => { e.preventDefault(); checkLocation(); }}
                                                                    className="mt-1.5 text-xs text-red-700 hover:text-red-900 underline font-medium"
                                                                >
                                                                    Refresh Location
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </>

                                        )}


                                        {(optimisticState?.clockStatus || clockStatus) === 'in' && (
                                            <>
                                                <Button
                                                    type="button"
                                                    variant='outline-primary'
                                                    icon={isClockOperationInProgress && operationType === 'startBreak' ? Loader2 : Coffee}
                                                    onClick={(e) => { e.preventDefault(); handleStartBreak(e); }}
                                                    disabled={isClockOperationInProgress || isLoadingSessions}
                                                    cn="h-12 px-6"
                                                >
                                                    {isClockOperationInProgress && operationType === 'startBreak' ? 'Starting Break...' : 'Take Break'}
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant='danger'
                                                    icon={isClockOperationInProgress && operationType === 'clockOut' ? Loader2 : ArrowRight}
                                                    onClick={(e) => { e.preventDefault(); handleClockOutClick(); }}
                                                    disabled={isClockOperationInProgress}
                                                    cn="h-14 px-8"
                                                >
                                                    {isClockOperationInProgress && operationType === 'clockOut' ? 'Clocking Out...' : 'Clock Out'}
                                                </Button>
                                            </>
                                        )}

                                        {(optimisticState?.clockStatus || clockStatus) === 'break' && (
                                            <>
                                                <Button
                                                    type="button"
                                                    variant='solid-success'
                                                    icon={isClockOperationInProgress && operationType === 'endBreak' ? Loader2 : CheckCircle}
                                                    onClick={(e) => { e.preventDefault(); handleEndBreak(e); }}
                                                    disabled={isClockOperationInProgress || isLoadingSessions}
                                                    cn="h-12 px-6"
                                                >
                                                    {isClockOperationInProgress && operationType === 'endBreak' ? 'Ending Break...' : 'End Break'}
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant='danger'
                                                    icon={isClockOperationInProgress && operationType === 'clockOut' ? Loader2 : ArrowRight}
                                                    onClick={(e) => { e.preventDefault(); handleClockOutClick(); }}
                                                    disabled={isClockOperationInProgress}
                                                    cn="h-14 px-8"
                                                >
                                                    {isClockOperationInProgress && operationType === 'clockOut' ? 'Clocking Out...' : 'Clock Out'}
                                                </Button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </SectionContainer>
                    </div>

                    <StatCard
                        title="This Week"
                        value={isLoadingWeeklyHours ? "Loading..." : formatHours(liveWeeklyWorkedSeconds / 3600)}
                        subtitle={weeklyHours.scheduled > 0 ? `of ${formatHours(weeklyHours.scheduled / 3600)} scheduled` : "Hours worked"}
                        trend={liveWeeklyPercentage > 0 ? `${liveWeeklyPercentage}%` : null}
                        icon={<CheckCircle className="h-6 w-6 text-purple-600" />}
                        iconBgColor="bg-purple-50"
                    />
                    {/* Pending Approvals - Show ONLY to managers */}
                    {hasApprovalPermissions && (
                        <StatCard
                            title="Pending Approvals"
                            value="0"
                            subtitle="Feature coming soon"
                            icon={<AlertTriangle className="h-6 w-6 text-orange-600" />}
                            iconBgColor="bg-orange-50"
                        />
                    )}

                    {/* Onboarding Tasks - Show ONLY to HR/Admin roles */}
                    {hasOnboardingPermissions && (
                        <StatCard
                            title="Onboarding Tasks"
                            value="0"
                            subtitle="Feature coming soon"
                            icon={<Users className="h-6 w-6 text-blue-600" />}
                            iconBgColor="bg-blue-50"
                        />
                    )}
                </div>

                {/* Time Clock Section */}
                <div className="w-full sm:block hidden">

                    <SectionContainer
                        title="Time Clock"
                        action={
                            <div className="flex items-center gap-2">
                                {/* Refresh Button */}
                                <button
                                    type="button"
                                    onClick={handleRefreshClockData}
                                    disabled={isRefreshing || isClockOperationInProgress}
                                    className="p-1.5 text-purple-600 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors disabled:opacity-50"
                                    title="Refresh clock status"
                                >
                                    <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                                </button>

                                {/* Location */}
                                <div className="flex items-center gap-2 text-gray-600">
                                    <MapPin className="h-4 w-4" />
                                    <span className="text-sm font-medium">{siteName}</span>
                                </div>
                            </div>
                        }
                    >
                        <div className="p-6">
                            <div className="flex sm:flex-row flex-col gap-4 items-start justify-between">
                                <div>
                                    <TimeDisplay
                                        time={elapsedTime}
                                        isActive={true}
                                    />
                                    <p className="text-sm text-gray-600 mb-4">{formatCurrentDate(currentTime)}</p>

                                    {/* Shift Selector */}
                                    {/*
                                    <div className="mb-4 p-3 bg-purple-50 rounded-lg border border-purple-200">
                                        <p className="text-xs text-purple-700 font-medium mb-2">Current Shift</p>
                                        {isLoadingShift ? (
                                            <div className="flex items-center gap-2">
                                                <Loader2 className="h-4 w-4 animate-spin text-purple-600" />
                                                <span className="text-sm text-purple-600">Loading...</span>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="flex gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleShiftChange(SHIFT_TYPES.DAY)}
                                                        disabled={isUpdatingShift || clockStatus === 'in' || clockStatus === 'break'}
                                                        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border-2 transition-all text-sm ${currentShift === SHIFT_TYPES.DAY
                                                            ? 'border-purple-600 bg-white text-purple-700 font-medium'
                                                            : 'border-gray-300 bg-white text-gray-700 hover:border-purple-400'
                                                            } ${(isUpdatingShift || clockStatus === 'in' || clockStatus === 'break') ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                                                    >
                                                        <Sun className="h-4 w-4" />
                                                        <span>Day</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleShiftChange(SHIFT_TYPES.NIGHT)}
                                                        disabled={isUpdatingShift || clockStatus === 'in' || clockStatus === 'break'}
                                                        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border-2 transition-all text-sm ${currentShift === SHIFT_TYPES.NIGHT
                                                            ? 'border-purple-600 bg-white text-purple-700 font-medium'
                                                            : 'border-gray-300 bg-white text-gray-700 hover:border-purple-400'
                                                            } ${(isUpdatingShift || clockStatus === 'in' || clockStatus === 'break') ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                                                    >
                                                        <Moon className="h-4 w-4" />
                                                        <span>Night</span>
                                                    </button>
                                                </div>
                                                {(clockStatus === 'in' || clockStatus === 'break') && (
                                                    <p className="text-xs text-orange-600 mt-2 flex items-center gap-1">
                                                        <AlertTriangle className="h-3 w-3" />
                                                        <span>Clock out to change your shift</span>
                                                    </p>
                                                )}
                                            </>
                                        )}
                                    </div>
                                    */}

                                    {/* Location Status */}
                                    {isCheckingLocation && (
                                        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                                            <div className="flex items-center gap-2 text-blue-700">
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                <span className="text-sm">Checking location...</span>
                                            </div>
                                        </div>
                                    )}

                                    {/* {!isLocationValid && locationError && (
                                        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                                            <div className="flex items-start gap-2">
                                                <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium text-red-800">Location Restricted</p>
                                                    <p className="text-xs text-red-600 mt-1">{locationError}</p>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => { e.preventDefault(); checkLocation(); }}
                                                        className="mt-2 text-xs text-red-700 hover:text-red-900 underline"
                                                    >
                                                        Refresh Location
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )} */}

                                    {isLocationValid && locationMessage && !isCheckingLocation && (
                                        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                                            <div className="flex items-center gap-2 text-green-700">
                                                <MapPin className="h-4 w-4" />
                                                <span className="text-sm">{locationMessage}</span>
                                            </div>
                                        </div>
                                    )}

                                    {/* Today's Clock In/Out Times */}
                                    {(() => {
                                        const todayTimes = getTodayClockTimes();
                                        const clockInDisplay = formatTimeDisplay(todayTimes.clockIn || (clockStatus === 'in' ? clockInTime : null));
                                        const clockOutDisplay = formatTimeDisplay(todayTimes.clockOut || (clockStatus === 'out' && clockOutTime ? clockOutTime : null));

                                        if (clockInDisplay || clockOutDisplay) {
                                            return (
                                                <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
                                                    <div className="space-y-2 text-sm">
                                                        {clockInDisplay && (
                                                            <div className="flex items-center justify-between">
                                                                <span className="text-gray-600 font-medium">Clock In:</span>
                                                                <span className="text-gray-900 font-semibold">{clockInDisplay}</span>
                                                            </div>
                                                        )}
                                                        {clockOutDisplay && (
                                                            <div className="flex items-center justify-between">
                                                                <span className="text-gray-600 font-medium">Clock Out:</span>
                                                                <span className="text-gray-900 font-semibold">{clockOutDisplay}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        }
                                        return null;
                                    })()}

                                    <div className="space-y-1">
                                        <p className="text-sm text-gray-700">
                                            <span className="font-medium">Total Hours Today</span>
                                        </p>
                                        <p className="text-sm">
                                            <span className="font-medium text-gray-900">Paid Hours:</span>{' '}
                                            <span className={clockStatus !== 'out' || clockOutTime ? 'text-purple-600 font-semibold' : 'text-gray-900'}>
                                                {formatTime(elapsedTime)}
                                            </span>
                                        </p>
                                        <p className="text-sm">
                                            <span className="font-medium text-gray-900">Gross:</span>{' '}
                                            <span className={clockStatus !== 'out' || clockOutTime ? 'text-purple-600 font-semibold' : 'text-gray-900'}>
                                                {formatTime(grossTime)}
                                            </span>
                                        </p>
                                        {((optimisticState?.clockStatus || clockStatus) === 'break' || (isClockOperationInProgress && (operationType === 'startBreak' || operationType === 'endBreak'))) && (
                                            <p className="text-sm mt-2">
                                                <StatusIndicator
                                                    status={optimisticState?.clockStatus || clockStatus}
                                                    isLoading={isClockOperationInProgress && (operationType === 'startBreak' || operationType === 'endBreak')}
                                                    operationType={operationType}
                                                />
                                            </p>
                                        )}
                                    </div>
                                </div>

                                <div className="flex flex-col gap-3">
                                    {(optimisticState?.clockStatus || clockStatus) === 'out' && (
                                        <>
                                            <Button
                                                type="button"
                                                variant='gradient'
                                                icon={isClockOperationInProgress && operationType === 'clockIn' ? Loader2 : ArrowRight}
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    e.nativeEvent.stopImmediatePropagation();
                                                    handleClockIn(e);
                                                }}
                                                disabled={isClockOperationInProgress || !isLocationValid || isCheckingLocation}
                                                cn="h-14 px-8"
                                            >
                                                {isClockOperationInProgress && operationType === 'clockIn' ? 'Clocking In...' : 'Clock In'}
                                            </Button>
                                            {!isLocationValid && locationError && (
                                                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                                                    <div className="flex items-start gap-2">
                                                        <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-xs font-medium text-red-800">Location Restricted</p>
                                                            <p className="text-xs text-red-600 mt-0.5">{locationError}</p>
                                                            <button
                                                                type="button"
                                                                onClick={(e) => { e.preventDefault(); checkLocation(); }}
                                                                className="mt-1.5 text-xs text-red-700 hover:text-red-900 underline font-medium"
                                                            >
                                                                Refresh Location
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </>

                                    )}


                                    {(optimisticState?.clockStatus || clockStatus) === 'in' && (
                                        <>
                                            <Button
                                                type="button"
                                                variant='outline-primary'
                                                icon={isClockOperationInProgress && operationType === 'startBreak' ? Loader2 : Coffee}
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    e.nativeEvent.stopImmediatePropagation();
                                                    handleStartBreak(e);
                                                }}
                                                disabled={isClockOperationInProgress}
                                                cn="h-12 px-6"
                                            >
                                                {isClockOperationInProgress && operationType === 'startBreak' ? 'Starting Break...' : 'Take Break'}
                                            </Button>
                                            <Button
                                                type="button"
                                                variant='danger'
                                                icon={isClockOperationInProgress && operationType === 'clockOut' ? Loader2 : ArrowRight}
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    e.nativeEvent.stopImmediatePropagation();
                                                    handleClockOutClick();
                                                }}
                                                disabled={isClockOperationInProgress}
                                                cn="h-14 px-8"
                                            >
                                                {isClockOperationInProgress && operationType === 'clockOut' ? 'Clocking Out...' : 'Clock Out'}
                                            </Button>
                                        </>
                                    )}

                                    {(optimisticState?.clockStatus || clockStatus) === 'break' && (
                                        <>
                                            <Button
                                                type="button"
                                                variant='solid-success'
                                                icon={isClockOperationInProgress && operationType === 'endBreak' ? Loader2 : CheckCircle}
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    e.nativeEvent.stopImmediatePropagation();
                                                    handleEndBreak(e);
                                                }}
                                                disabled={isClockOperationInProgress}
                                                cn="h-12 px-6"
                                            >
                                                {isClockOperationInProgress && operationType === 'endBreak' ? 'Ending Break...' : 'End Break'}
                                            </Button>
                                            <Button
                                                type="button"
                                                variant='danger'
                                                icon={isClockOperationInProgress && operationType === 'clockOut' ? Loader2 : ArrowRight}
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    e.nativeEvent.stopImmediatePropagation();
                                                    handleClockOutClick();
                                                }}
                                                disabled={isClockOperationInProgress}
                                                cn="h-14 px-8"
                                            >
                                                {isClockOperationInProgress && operationType === 'clockOut' ? 'Clocking Out...' : 'Clock Out'}
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    </SectionContainer>
                </div>


                {/* Recent Time Entries */}
                <div className="hidden">
                    <SectionContainer
                        title={
                            <div className="flex items-center gap-2">
                                Recent Time Entries
                                {isLoadingRecent && (
                                    <div className="flex items-center gap-1 text-blue-600">
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                        <span className="text-xs">Loading...</span>
                                    </div>
                                )}
                            </div>
                        }

                    >
                        {isLoadingRecent ? (
                            <div className="flex items-center justify-center h-40">
                                <Loader variant="pulse" size="md" text="Fetching employee data..." />
                            </div>
                        ) : timeEntries.length === 0 ? (
                            <div className="text-center py-8 text-gray-500">No time entries found</div>
                        ) : (
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableHeaderCell>Type</TableHeaderCell>
                                        {timeEntries.map((entry, idx) => (
                                            <TableHeaderCell key={idx}>
                                                <div className="text-center">
                                                    <div className="font-semibold text-gray-900">{entry.day.substring(0, 3)}</div>
                                                    <div className="text-xs text-gray-500">{entry.date}</div>
                                                </div>
                                            </TableHeaderCell>
                                        ))}
                                    </TableHeader>
                                    <TableBody>
                                        {/* Clock In Row */}
                                        <TableRow>
                                            <TableCell>
                                                <span className="font-semibold text-gray-900">Clock In</span>
                                            </TableCell>
                                            {timeEntries.map((entry, idx) => {
                                                const pairs = entry.clockInOutPairs || [];
                                                const clockInTimes = pairs.map(p => p.clockIn).filter(t => t && t !== '-');

                                                return (
                                                    <TableCell key={idx}>
                                                        {clockInTimes.length > 0 ? (
                                                            <div className="space-y-1">
                                                                {clockInTimes.map((time, timeIdx) => (
                                                                    <div key={timeIdx} className="text-sm text-gray-700">
                                                                        {time}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <span className="text-gray-400">—</span>
                                                        )}
                                                    </TableCell>
                                                );
                                            })}
                                        </TableRow>

                                        {/* Clock Out Row */}
                                        <TableRow>
                                            <TableCell>
                                                <span className="font-semibold text-gray-900">Clock Out</span>
                                            </TableCell>
                                            {timeEntries.map((entry, idx) => {
                                                const pairs = entry.clockInOutPairs || [];
                                                const clockOutTimes = pairs.map(p => p.clockOut).filter(t => t && t !== '-');

                                                return (
                                                    <TableCell key={idx}>
                                                        {clockOutTimes.length > 0 ? (
                                                            <div className="space-y-1">
                                                                {clockOutTimes.map((time, timeIdx) => (
                                                                    <div key={timeIdx} className="text-sm text-gray-700">
                                                                        {time}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <span className="text-gray-400">—</span>
                                                        )}
                                                    </TableCell>
                                                );
                                            })}
                                        </TableRow>

                                        {/* Total Hours Row */}
                                        <TableRow className="bg-gray-50">
                                            <TableCell>
                                                <span className="font-semibold text-gray-900">Total Hours</span>
                                            </TableCell>
                                            {timeEntries.map((entry, idx) => (
                                                <TableCell key={idx}>
                                                    <span className="font-medium text-gray-900">{entry.totalHours}</span>
                                                </TableCell>
                                            ))}
                                        </TableRow>

                                        {/* Break Hours Row */}
                                        <TableRow>
                                            <TableCell>
                                                <span className="font-semibold text-gray-900">Break Hours</span>
                                            </TableCell>
                                            {timeEntries.map((entry, idx) => (
                                                <TableCell key={idx}>
                                                    <span className="text-orange-600 font-medium">{entry.breakHours}</span>
                                                </TableCell>
                                            ))}
                                        </TableRow>

                                        {/* Overtime Row */}
                                        <TableRow>
                                            <TableCell>
                                                <span className="font-semibold text-gray-900">Overtime</span>
                                            </TableCell>
                                            {timeEntries.map((entry, idx) => (
                                                <TableCell key={idx}>
                                                    <span className="font-medium text-orange-600">{entry.overtime}</span>
                                                </TableCell>
                                            ))}
                                        </TableRow>
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                        <p className="text-xs py-4 text-gray-600 text-center md:hidden">
                            ← Scroll horizontally to view all columns →
                        </p>
                    </SectionContainer>
                </div>
            </div>

            {/* Timesheet Confirmation Modal */}
            <TimesheetConfirmModal
                isOpen={showTimesheetModal}
                onClose={() => setShowTimesheetModal(false)}
                onSubmit={handleSubmitTimesheet}
            />

            {/* Shift Confirmation Modal */}
            <ShiftConfirmationModal
                isOpen={showShiftModal}
                onClose={() => {
                    setShowShiftModal(false);
                    setShiftModalData(null);
                    setPendingClockIn(false);
                }}
                onConfirm={handleShiftConfirm}
                currentShift={shiftModalData?.currentShift || SHIFT_TYPES.DAY}
                suggestedShift={shiftModalData?.suggestedShift || SHIFT_TYPES.DAY}
                reason={shiftModalData?.reason}
                clockInTime={shiftModalData?.clockInTime}
            />

            {/* Clock Out Confirmation Modal */}
            <ApprovalConfirmationModal
                isOpen={showClockOutModal}
                onClose={() => setShowClockOutModal(false)}
                onConfirm={handleClockOut}
                title="Clock Out Confirmation"
                description="Are you sure you want to clock out? Your time will be recorded and you'll need to clock in again to resume."
                confirmButtonText="Yes, Clock Out"
                cancelButtonText="Cancel"
            >
                <div className="space-y-4">
                    {/* Time Summary */}
                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 space-y-2">
                        <h4 className="text-sm font-semibold text-purple-900 mb-3">Today's Time Summary</h4>
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-purple-800">Effective Hours:</span>
                            <span className="text-lg font-bold text-purple-900">{formatTime(elapsedTime)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-purple-800">Gross Hours:</span>
                            <span className="text-sm font-semibold text-purple-900">{formatTime(grossTime)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-purple-800">Break Time:</span>
                            <span className="text-sm font-semibold text-purple-900">
                                {(() => {
                                    // CRITICAL: Use live breakSec from Firestore, not stale state
                                    const liveBreakSec = getOpenSession?.()?.breakSec || 0;
                                    const ongoingBreak = breakStartTime && !clockOutTime
                                        ? Math.floor((new Date() - breakStartTime) / 1000)
                                        : 0;
                                    const totalBreak = liveBreakSec + ongoingBreak;
                                    return formatTime({
                                        hours: Math.floor(totalBreak / 3600),
                                        minutes: Math.floor((totalBreak % 3600) / 60),
                                        seconds: 0
                                    });
                                })()}
                            </span>
                        </div>
                    </div>

                    {/* Location Info */}
                    <div className="flex items-center gap-2 text-gray-600 bg-gray-50 p-3 rounded-lg">
                        <MapPin className="h-4 w-4" />
                        <span className="text-sm">Location: <span className="font-medium">{siteName}</span></span>
                    </div>

                    {/* Pupil Count Input */}
                    {hasSchedulingPlugin && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700 block">
                                How many pupils attended?
                            </label>
                            <input
                                type="number"
                                min="0"
                                placeholder="Enter count (optional)..."
                                value={pupilCount}
                                onChange={(e) => setPupilCount(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition-all"
                            />
                        </div>
                    )}
                </div>
            </ApprovalConfirmationModal>
        </div>
    );
};

export default EmployeeDashboard;