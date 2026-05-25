import { fetchCompanyDetails } from '../../services/companyService';
import { getSessionsForDateRange } from '../../services/timeClock';
import { roundSessionRange, getDefaultRoundingRules, applyRoundingToDate, applyRoundingToTimeString } from '../../utils/timeRounding';
import { AlertCircle, AlertTriangle, CheckCircle, ChevronDown, ChevronUp, Download, Edit2, FileText, Plus, Trash2, X, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { useClockSessionContext } from '../../contexts/ClockSessionContext';
import { useTimesheetContext } from '../../contexts/TimesheetContext';
import { useAuth } from '../../hooks/useAuth';
import { useEmployeeTimesheets } from '../../hooks/useEmployeeTimesheets';
import { timesheetDeduplication } from '../../services/timesheetDeduplication';
import { generateTimesheetPDF } from '../../services/timesheetPdfExport';
import { getUserWeekContext, submitWeek, updateTimeEntry, updateEntryDescription, updateDayDescription, addManualTimeEntry, deleteTimeEntry, upsertDailyEntry, invalidateTimesheetCache, deleteTimesheet } from '../../services/timesheets';
import { fetchApprovedAbsencesForWeek } from '../../services/timesheetAbsenceIntegration';
import { timesheetValidation } from '../../services/timesheetValidation';
import { calculateWeekTotals, processWeekData } from '../../services/weekDataProcessor';
import { TIMESHEET_ERROR_CODES, TimesheetErrorHandler } from '../../utils/timesheetErrorHandler';
import { DEFAULT_WEEK_START_DAY, formatISODate, getOrderedWeekDates, getWeekRangeForDate } from '../../utils/weekStartUtils';
import { formatHoursInQuarters } from '../../utils/numberFormatter';
import { detectAndConvertToLocal } from '../../utils/timeDisplayUtils';
import { shouldShowSubmitButton } from '../../utils/timesheetUtils';
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '../shared/Table';
import ManualTimeEntryRow from '../timesheets/ManualTimeEntryRow';
import EditTimesheetModal from './EditTimesheetModal';
import Badge from '../ui/Badge';
import Button from '../ui/Button';


// --- Static Display Helpers (Moved out to ensure initialization before use) ---
const formatHoursMin = (sec) => {
  const totalMin = Math.floor((sec || 0) / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
};

const formatClockAMPM = (timeStr) => {
  if (!timeStr || timeStr === '-') return timeStr || '-';
  try {
    const [hStr, mStr] = timeStr.split(':');
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    if (isNaN(h) || isNaN(m)) return timeStr;
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
  } catch {
    return timeStr;
  }
};

const formatDateISO = (isoDate) => {
  if (!isoDate) return '-';
  try {
    const date = new Date(isoDate);
    if (isNaN(date.getTime())) return isoDate;
    return date.toISOString().slice(0, 10); // YYYY-MM-DD
  } catch {
    return isoDate;
  }
};

const formatDateUK = (isoDate) => {
  if (!isoDate) return '-';
  try {
    const date = new Date(isoDate);
    if (isNaN(date.getTime())) return isoDate;
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  } catch {
    return isoDate;
  }
};

const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
};

const toAMPM = (timeStr) => {
  if (!timeStr || timeStr === '-') return timeStr || '-';
  try {
    const [hStr, mStr] = timeStr.split(':');
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr || '0', 10);
    if (isNaN(h)) return timeStr;
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
  } catch { return timeStr; }
};

const formatHM = (sec) => {
  const totalMin = Math.floor((sec || 0) / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
};

// ─── Helper: Calculate duration between two times ────────────────────────────
const calculateDuration = (clockInStr, clockOutStr) => {
  if (!clockInStr || !clockOutStr || clockOutStr === '-' || clockInStr === '-') return null;
  try {
    const parseTime = (timeStr) => {
      const [h, m] = timeStr.split(':').map(Number);
      return h * 60 + m;
    };
    const inMin = parseTime(clockInStr);
    const outMin = parseTime(clockOutStr);
    if (outMin <= inMin) return null; // Invalid pair
    const durationMin = outMin - inMin;
    const durationHours = Math.floor(durationMin / 60);
    const durationMins = durationMin % 60;
    return `${durationHours}h ${String(durationMins).padStart(2, '0')}m`;
  } catch {
    return null;
  }
};

// ─── Component: Single Clock Pair Badge ──────────────────────────────────────
const ClockPairBadge = ({ pair, index, totalPairs, rules }) => {
  let clockIn = pair.clockIn || '-';
  let clockOut = pair.clockOut || '-';

  // Apply rounding rules if needed
  if (pair.roundedStart) {
    const d = new Date(pair.roundedStart);
    if (!isNaN(d.getTime())) clockIn = d.toTimeString().slice(0, 5);
  } else if (pair.rawStart) {
    const d = new Date(pair.rawStart);
    if (!isNaN(d.getTime())) {
      const rounded = applyRoundingToDate(d, rules?.clockIn);
      clockIn = rounded.toTimeString().slice(0, 5);
    }
  }

  if (pair.roundedEnd) {
    const d = new Date(pair.roundedEnd);
    if (!isNaN(d.getTime())) clockOut = d.toTimeString().slice(0, 5);
  } else if (pair.rawEnd) {
    const d = new Date(pair.rawEnd);
    if (!isNaN(d.getTime())) {
      const rounded = applyRoundingToDate(d, rules?.clockOut);
      clockOut = rounded.toTimeString().slice(0, 5);
    }
  }

  const duration = calculateDuration(clockIn, clockOut);
  const isAutoClockOut = pair.notes?.toLowerCase().includes('auto clock out') || 
                         pair.notes?.toLowerCase().includes('system clock out');

  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg hover:border-blue-300 transition-all group">
      {/* Pair Badge Number */}
      {totalPairs > 1 && (
        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold flex-shrink-0">
          {index}
        </div>
      )}

      {/* Clock In Time */}
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-blue-600 font-semibold">IN</span>
        <span className="text-sm font-bold text-gray-900">{formatClockAMPM(clockIn)}</span>
      </div>

      {/* Arrow Divider */}
      <div className="flex items-center justify-center text-gray-400">
        <span className="text-lg">→</span>
      </div>

      {/* Clock Out Time */}
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-indigo-600 font-semibold">OUT</span>
        <span className="text-sm font-bold text-gray-900">{formatClockAMPM(clockOut)}</span>
      </div>

      {/* Duration */}
      {duration && (
        <>
          <div className="w-px h-6 bg-gradient-to-b from-transparent via-blue-200 to-transparent"></div>
          <div className="flex flex-col gap-0.5 ml-1">
            <span className="text-xs text-gray-500 font-medium">Duration</span>
            <span className="text-sm font-bold text-gray-700">{duration}</span>
          </div>
        </>
      )}

      {/* Auto Clock Out Badge */}
      {isAutoClockOut && (
        <div className="ml-auto flex items-center gap-1 px-2 py-0.5 bg-orange-100 rounded-full border border-orange-300">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span>
          <span className="text-xs font-medium text-orange-700">Auto</span>
        </div>
      )}
    </div>
  );
};

// ─── Component: Clock Pairs Display Container ────────────────────────────────
const ClockPairsDisplay = ({ pairs, rules, direction = 'in' }) => {
  const validPairs = pairs.filter(p => {
    if (direction === 'in') {
      return (p.clockIn && p.clockIn !== '-') || p.roundedStart || p.rawStart;
    } else {
      return (p.clockOut && p.clockOut !== '-') || p.roundedEnd || p.rawEnd;
    }
  });

  if (validPairs.length === 0) {
    return <span className="text-sm text-gray-400">-</span>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {validPairs.map((pair, idx) => (
        <ClockPairBadge
          key={idx}
          pair={pair}
          index={validPairs.length > 1 ? idx + 1 : null}
          totalPairs={validPairs.length}
          rules={rules}
        />
      ))}
    </div>
  );
};


const ViewTimesheetModal = ({
  isOpen,
  onClose,
  timesheet,
  onEdit,
  onApprove,
  onDecline,
  isOwnTimesheet = true,
  fallbackUserId = null,
  canEdit = false,
  companySettings = null,
  absencesMap = null
}) => {
  const { weekStartDay: contextWeekStartDay, user: currentUser } = useAuth();
  const { getWeekDetails, isWeekDataReady, isLoading: isContextLoading, weeksByKey, refresh } = useTimesheetContext();
  const { getOpenSession } = useClockSessionContext();

  // Get employee userId first (needed for hook)
  const employeeUserId = useMemo(() => {
    if (isOwnTimesheet) return null;
    const normalizedFallback = typeof fallbackUserId === 'string' ? (fallbackUserId.includes('/') ? fallbackUserId.split('/')[1] : fallbackUserId) : null;
    return (
      timesheet?.raw?.userId ||
      timesheet?.userId ||
      timesheet?.uid ||
      timesheet?.user?.uid ||
      normalizedFallback ||
      null
    );
  }, [isOwnTimesheet, fallbackUserId, timesheet]);

  // Use real-time subscription for employee timesheets (when viewing other employees)
  const { timesheetDocs: employeeTimesheetDocs, loading: isLoadingEmployeeTimesheets } = useEmployeeTimesheets(
    isOwnTimesheet ? null : employeeUserId,
    { maxWeeks: 12 }
  );

  // Get employee sessions - we'll need to subscribe to them separately for other employees
  // For now, we'll fetch them when needed (or use ClockSessionContext if it supports other users)
  const { sessionDocs: currentUserSessions } = useClockSessionContext();

  // State for processed employee week data
  const [employeeWeekData, setEmployeeWeekData] = useState(null);
  const [isProcessingEmployeeData, setIsProcessingEmployeeData] = useState(false);
  const [employeeDataError, setEmployeeDataError] = useState(null);

  // ✅ NEW: Store approval metadata from Firestore
  const [approvalMetadata, setApprovalMetadata] = useState(null);

  // State for own timesheet absences
  const [ownTimesheetAbsences, setOwnTimesheetAbsences] = useState(new Map());

  // State for employee week start day
  const [employeeWeekStartDay, setEmployeeWeekStartDay] = useState(DEFAULT_WEEK_START_DAY);

  // State to force refresh of weekData useMemo after updates
  const [refreshTimestamp, setRefreshTimestamp] = useState(Date.now());

  // State for delete confirmation dialog
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [roundingRules, setRoundingRules] = useState(null);

  // Fetch rounding rules for own timesheet
  useEffect(() => {
    if (isOpen && isOwnTimesheet && currentUser) {
      const loadOwnRules = async () => {
        try {
          const { getRoundingRulesForUser } = await import('../../services/roundingRules');
          const rules = await getRoundingRulesForUser(currentUser);
          setRoundingRules(rules);
          console.log('[ViewTimesheetModal] Loaded rounding rules for own timesheet:', rules);
        } catch (err) {
          console.warn('[ViewTimesheetModal] Failed to load own rounding rules:', err);
        }
      };
      loadOwnRules();
    }
  }, [isOpen, isOwnTimesheet, currentUser]);

  // Get week start date from timesheet - prioritize weekKey/raw.start over weekStart
  // NOTE: weekStart property might be the week END date, so we prioritize weekKey/raw.start
  const weekStartDate = useMemo(() => {
    if (!timesheet) return null;

    console.log('[ViewTimesheetModal] Extracting weekStartDate from timesheet:', {
      id: timesheet.id,
      weekKey: timesheet.weekKey,
      weekStart: timesheet.weekStart,
      weekEnd: timesheet.weekEnd,
      rawStart: timesheet.raw?.start,
      rawWeekKey: timesheet.raw?.weekKey
    });

    // First priority: weekKey or id (format: "2025-11-16_2025-11-22" - most reliable for employee page)
    const weekKeyStr = timesheet.weekKey || timesheet.id;
    if (weekKeyStr && typeof weekKeyStr === 'string' && weekKeyStr.includes('_')) {
      const [startStr] = weekKeyStr.split('_');
      if (startStr && startStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const date = new Date(startStr + 'T00:00:00Z'); // Parse as UTC
        if (!isNaN(date.getTime())) {
          console.log('[ViewTimesheetModal] ✓ Using weekStart from weekKey/id:', startStr);
          return date;
        }
      }
    }

    // Second priority: raw.start (from weekly summary - most reliable)
    if (timesheet.raw?.start) {
      const rawStart = timesheet.raw.start;
      const date = rawStart instanceof Date ? rawStart : new Date(rawStart);
      if (!isNaN(date.getTime())) {
        date.setHours(0, 0, 0, 0);
        console.log('[ViewTimesheetModal] ✓ Using weekStart from raw.start:', date.toISOString().slice(0, 10));
        return date;
      }
    }

    // Third priority: raw.weekKey
    if (timesheet.raw?.weekKey && typeof timesheet.raw.weekKey === 'string' && timesheet.raw.weekKey.includes('_')) {
      const [startStr] = timesheet.raw.weekKey.split('_');
      if (startStr && startStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const date = new Date(startStr + 'T00:00:00Z'); // Parse as UTC
        if (!isNaN(date.getTime())) {
          console.log('[ViewTimesheetModal] ✓ Using weekStart from raw.weekKey:', startStr);
          return date;
        }
      }
    }

    // Fourth priority: weekStart property (but verify it's actually a start date, not end date)
    if (timesheet.weekStart) {
      const dateStr = typeof timesheet.weekStart === 'string' ? timesheet.weekStart : timesheet.weekStart.toISOString().slice(0, 10);
      const date = new Date(dateStr + 'T00:00:00'); // Parse as Local
      if (!isNaN(date.getTime())) {
        // Check if this might be a week end date (Saturday) - if so, subtract 6 days to get start
        const dayOfWeek = date.getDay();
        if (dayOfWeek === 6) { // Saturday - likely week end
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - 6);
          console.log('[ViewTimesheetModal] ⚠ weekStart property is Saturday (week end), calculating start:', weekStart.toISOString().slice(0, 10));
          return weekStart;
        }
        console.log('[ViewTimesheetModal] ⚠ Using weekStart property (fallback):', dateStr);
        return date;
      }
    }

    // Fourth priority: parse from period/week string
    const periodStr = timesheet.period || timesheet.week;
    if (typeof periodStr === 'string') {
      try {
        // Format: "2025, November 16-22" or similar
        const parts = periodStr.split(',');
        if (parts.length >= 2) {
          const year = parts[0].trim();
          const rest = parts[1].trim();
          const monthMatch = rest.match(/(\w+)\s+(\d+)/);
          if (monthMatch && year) {
            const monthName = monthMatch[1];
            const dayStart = monthMatch[2];
            const date = new Date(`${monthName} ${dayStart}, ${year}`);
            date.setHours(0, 0, 0, 0);
            if (!isNaN(date.getTime())) {
              console.log('[ViewTimesheetModal] Using weekStart from period string:', date.toISOString().slice(0, 10));
              return date;
            }
          }
        }
      } catch (e) {
        console.warn('[ViewTimesheetModal] Failed to parse period/week string', e);
      }
    }

    console.warn('[ViewTimesheetModal] Could not extract weekStartDate from timesheet:', timesheet);
    return null;
  }, [timesheet]);

  // Check if timesheet is for a future date
  const isFutureTimesheet = useMemo(() => {
    if (!weekStartDate) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Set to start of day for accurate comparison

    // Get the end of the week (6 days after start)
    const weekEnd = new Date(weekStartDate);
    weekEnd.setDate(weekStartDate.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999); // End of the last day

    // If the week starts after today, it's a future timesheet
    return weekStartDate > today;
  }, [weekStartDate]);

  // Get week key from timesheet (it's the weekKey like "2025-11-17_2025-11-23")
  const weekKey = useMemo(() => {
    if (!timesheet) return null;
    return timesheet.id || timesheet.raw?.weekKey || timesheet.weekKey || null;
  }, [timesheet]);

  // Build a minimal weekData structure from the timesheet's own data when the context
  // hasn't populated weeksByKey yet (e.g. first open, slow context load).
  const buildFallbackWeekData = useCallback(() => {
    if (!timesheet) return null;
    const startStr = timesheet.start || timesheet.weekStart || timesheet.period;
    const endStr   = timesheet.end   || timesheet.weekEnd;
    if (!startStr) return null;

    const startDate = new Date(startStr.includes('T') ? startStr : startStr + 'T00:00:00Z');
    if (isNaN(startDate.getTime())) return null;

    // Build 7 day date list
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      dates.push(d.toISOString().slice(0, 10));
    }

    // Map entries by date
    const entriesByDate = {};
    for (const e of (timesheet.entries || [])) {
      const eDate = e.date || (e.clockIn ? String(e.clockIn).slice(0, 10) : null);
      if (!eDate) continue;
      if (!entriesByDate[eDate]) entriesByDate[eDate] = [];
      entriesByDate[eDate].push(e);
    }

    const days = dates.map(dateStr => {
      const dayEntries = entriesByDate[dateStr] || [];
      const dayName = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
      let effectiveSec = 0, overtimeSec = 0, grossSec = 0;
      let clockInTime = null, clockOutTime = null;
      const clockInOutPairs = [];

      for (const e of dayEntries) {
        effectiveSec += e.effectiveSec || 0;
        overtimeSec  += e.overtimeSec  || 0;
        grossSec     += e.grossSec     || 0;
        if (e.clockIn)  {
          const d = new Date(e.clockIn);
          if (!isNaN(d)) {
            if (!clockInTime || d < clockInTime) clockInTime = d;
            const ciStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
            let coStr = '-';
            if (e.clockOut) {
              const dOut = new Date(e.clockOut);
              if (!isNaN(dOut)) {
                if (!clockOutTime || dOut > clockOutTime) clockOutTime = dOut;
                coStr = dOut.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
              }
            }
            clockInOutPairs.push({
              id: e.id, clockIn: ciStr, clockOut: coStr,
              clockInTime: d, clockOutTime: clockOutTime,
              sessionId: e.sessionId || e.id,
              isManual: e.isManual || false,
              breakSec: 0, breakMin: 0,
            });
          }
        }
      }

      const breakSec = Math.max(0, grossSec - effectiveSec);
      return {
        date: dateStr, day: dayName,
        clockIn: clockInTime ? clockInTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '-',
        clockOut: clockOutTime ? clockOutTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '-',
        clockInTime, clockOutTime,
        clockInOutPairs,
        effectiveSec, totalSec: effectiveSec,
        overtimeSec, grossSec, breakSec,
        scheduledSec: 0,
        notes: null, status: timesheet.status || 'draft',
        isManual: false, isDescriptionOnly: false,
        entries: dayEntries,
        hasAbsence: false,
      };
    });

    const endDate = endStr
      ? new Date(endStr.includes('T') ? endStr : endStr + 'T00:00:00Z')
      : (() => { const d = new Date(startDate); d.setDate(startDate.getDate() + 6); return d; })();

    return {
      weekStart: startDate,
      weekEnd:   endDate,
      days,
      status:    timesheet.status || 'draft',
      totals:    timesheet.totals || { effectiveSec: 0, overtimeSec: 0 },
    };
  }, [timesheet]);

  const weekData = useMemo(() => {
    if (isOwnTimesheet) {
      if (!weekKey) return buildFallbackWeekData();
      // Use data already processed by the Context
      const freshData = weeksByKey?.[weekKey];

      // ── Fallback: build from timesheet entries if context hasn't populated yet ──
      if (!freshData) return buildFallbackWeekData();

      // Enrich with absence information
      // [FIX] Prioritize prop absencesMap (pre-loaded by context) over internal state to prevent flip
      const effectiveAbsences = (absencesMap && absencesMap.size > 0) ? absencesMap : ownTimesheetAbsences;

      if (freshData && effectiveAbsences?.size > 0) {
        const enrichedDays = freshData.days?.map(day => {
          const absence = effectiveAbsences.get(day.date);
          if (absence) {
            return {
              ...day,
              hasAbsence: true,
              absenceType: absence.leaveType,
              absenceLabel: absence.leaveTypeLabel,
              absenceId: absence.id
            };
          }
          return day;
        });

        return {
          ...freshData,
          days: enrichedDays
        };
      }

      return freshData;
    } else {
      // Use fetched employee data, fallback to timesheet entries
      return employeeWeekData || buildFallbackWeekData();
    }
  }, [isOwnTimesheet, weekKey, employeeWeekData, weeksByKey, ownTimesheetAbsences, buildFallbackWeekData]);


  // Fetch absences for own timesheet when modal opens
  useEffect(() => {
    if (!isOpen || !isOwnTimesheet || !weekStartDate || !currentUser?.uid) {
      // Clear absences when modal closes
      if (!isOpen) {
        setOwnTimesheetAbsences(new Map());
      }
      return;
    }

    let cancelled = false;

    const loadOwnTimesheetAbsences = async () => {
      try {
        const start = weekStartDate instanceof Date ? weekStartDate : new Date(weekStartDate);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);

        console.log('[ViewTimesheetModal] Fetching absences for own timesheet:', {
          userId: currentUser.uid,
          weekStart: start.toISOString().split('T')[0],
          weekEnd: end.toISOString().split('T')[0]
        });

        const absencesMap = await fetchApprovedAbsencesForWeek(currentUser.uid, start, end);

        if (!cancelled) {
          console.log('[ViewTimesheetModal] Loaded absences for own timesheet:', absencesMap.size);
          setOwnTimesheetAbsences(absencesMap);
        }
      } catch (error) {
        console.error('[ViewTimesheetModal] Error fetching own timesheet absences:', error);
        if (!cancelled) {
          setOwnTimesheetAbsences(new Map());
        }
      }
    };

    loadOwnTimesheetAbsences();

    return () => {
      cancelled = true;
    };
  }, [isOpen, isOwnTimesheet, weekStartDate, currentUser?.uid]);

  // Fetch employee timesheet data when viewing other employees
  useEffect(() => {
    if (!isOpen || isOwnTimesheet || !employeeUserId || !weekStartDate) {
      // Clear employee data when modal closes
      if (!isOpen) {
        setEmployeeWeekData(null);
      }
      return;
    }

    let cancelled = false;

    // ALWAYS fetch fresh data - clear cache when modal opens
    console.log('[ViewTimesheetModal] Fetching fresh data (cache bypassed)');

        const loadEmployeeData = async () => {
      setIsProcessingEmployeeData(true);
      setEmployeeDataError(null);

      try {
        console.log('[ViewTimesheetModal] Loading employee data:', { employeeUserId, weekStartDate });

        // Use weekStartDate directly
        const start = weekStartDate instanceof Date ? weekStartDate : new Date(weekStartDate + 'T00:00:00');
        start.setHours(0, 0, 0, 0);

        const weekEnd = new Date(start);
        weekEnd.setDate(start.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);

        const weekStartStr = formatISODate(start);

        // Clear cache to ensure fresh data
        invalidateTimesheetCache(employeeUserId, weekStartStr);

        // Consolidated fetches for improved performance via REST
        const [userContext, weekTimesheets, weekSessions, absencesMap] = await Promise.all([
          getUserWeekContext(employeeUserId, { forceRefresh: true }),
          getUserTimesheetsByWeek(employeeUserId, null, weekStartStr),
          getSessionsForDateRange({ userId: employeeUserId, startDate: start, endDate: weekEnd }),
          fetchApprovedAbsencesForWeek(employeeUserId, start, weekEnd)
        ]);

        const weekStart = userContext.weekStartDay || DEFAULT_WEEK_START_DAY;
        setEmployeeWeekStartDay(weekStart);

        console.log('[ViewTimesheetModal] Fetched week timesheets:', {
          count: weekTimesheets.length,
          timesheets: weekTimesheets.map(ts => ({
            id: ts.id,
            period: ts.period,
            status: ts.status
          }))
        });

        const approvalDoc = weekTimesheets.find(ts => ts.id === timesheet?.id && (ts.status === 'approved' || ts.approvedBy))
          || weekTimesheets.find(ts => ts.period === weekStartStr && (ts.status === 'approved' || ts.approvedBy))
          || weekTimesheets.find(ts => ts.status === 'approved' || ts.approvedBy);
        
        if (approvalDoc) {
          setApprovalMetadata({
            approvedBy: approvalDoc.approvedBy,
            approvedByName: approvalDoc.approvedByName,
            approvedAt: approvalDoc.approvedAt,
            hrManagerApproval: approvalDoc.approvals?.hrManager,
            siteManagerApproval: approvalDoc.approvals?.siteManager,
            teamManagerApproval: approvalDoc.approvals?.teamManager
          });
        }

        if (cancelled) return;

        // Get company schedule and rounding rules via REST
        let schedule = {};
        let roundingRules = null;
        const { companyIdPath } = userContext;
        if (companyIdPath) {
          try {
            const companyId = companyIdPath.replace('companies/', '');
            const { company: companyData } = await fetchCompanyDetails(companyId);
            if (companyData) {
              schedule = companyData.workSchedule || {};
              roundingRules = companyData.roundingRules || null;
              setRoundingRules(roundingRules);
            }
          } catch (err) {
            console.warn('[ViewTimesheetModal] Error getting company schedule via REST:', err);
          }
        }

        if (cancelled) return;

        // Process week data using REST data
        const processedWeek = await processWeekData(
          start,
          weekTimesheets,
          weekSessions,
          employeeUserId,
          schedule,
          absencesMap,
          roundingRules
        );

        setEmployeeWeekData(processedWeek);
      } catch (error) {
        console.error('[ViewTimesheetModal] Error loading employee timesheet via REST:', error);
        if (!cancelled) {
          setEmployeeDataError(error);
          toast.error('Failed to load timesheet data');
        }
      } finally {
        if (!cancelled) {
          setIsProcessingEmployeeData(false);
        }
      }
    };

    // Only load if we have timesheet data from real-time subscription
    if (employeeTimesheetDocs && employeeTimesheetDocs.length >= 0) {
      loadEmployeeData();
    } else {
      // If no data yet, wait for real-time subscription to load
      setIsProcessingEmployeeData(true);
    }

    return () => {
      cancelled = true;
    };
  }, [isOpen, isOwnTimesheet, employeeUserId, weekStartDate, weekKey, employeeTimesheetDocs, refreshTimestamp]);




  // Process week data into rows format for modal
  // Process week data into rows format for modal
  const dailyRows = useMemo(() => {
    if (!weekData || !weekData.days) return [];
    console.log("💫 Raw weekData:", weekData);

    return weekData.days.map(day => {
      // Use stored overtime from database (day.overtimeSec)
      const overtimeSec = day.overtimeSec || 0;
      const normalSec = Math.max(0, (day.effectiveSec || 0) - overtimeSec);

      // Format in quarter-hour format (0.25 intervals)
      const formatQuarterHours = (sec) => formatHoursInQuarters(sec);

      // Extract first and last clock times from clockInOutPairs
      let pairs = [...(day.clockInOutPairs || [])];

      let firstClockIn = null;
      let lastClockOut = null;

      if (pairs.length > 0) {
        firstClockIn = pairs[0]?.clockInTime;
        lastClockOut = pairs[pairs.length - 1]?.clockOutTime;
      }

      // Calculate Total as Effective (Gross - Break)
      const effectiveSec = day.effectiveSec || Math.max(0, (day.grossSec || 0) - (day.breakSec || 0));

      // 🔴 CRITICAL FIX: Extract description from various possible sources
      // Priority: 
      // 1. day.notes (from the processed day data)
      // 2. day.description (from the processed day data)
      // 3. From any entry in clockInOutPairs
      // 4. From any entry in entries array
      let extractedDescription = null;

      // Check day-level notes/description first
      if (day.notes && typeof day.notes === 'string' && day.notes.trim() !== '') {
        extractedDescription = day.notes.trim();
        console.log(`📝 Found notes at day level for ${day.date}:`, extractedDescription);
      } else if (day.description && typeof day.description === 'string' && day.description.trim() !== '') {
        extractedDescription = day.description.trim();
        console.log(`📝 Found description at day level for ${day.date}:`, extractedDescription);
      }
      // If no day-level description, check entries
      else if (pairs && pairs.length > 0) {
        // Look through all pairs for any with notes/description
        for (const pair of pairs) {
          if (pair.notes && typeof pair.notes === 'string' && pair.notes.trim() !== '') {
            extractedDescription = pair.notes.trim();
            console.log(`📝 Found notes in pair for ${day.date}:`, extractedDescription);
            break;
          }
          if (pair.description && typeof pair.description === 'string' && pair.description.trim() !== '') {
            extractedDescription = pair.description.trim();
            console.log(`📝 Found description in pair for ${day.date}:`, extractedDescription);
            break;
          }
        }
      }

      // If still no description, check entries array
      if (!extractedDescription && day.entries && day.entries.length > 0) {
        for (const entry of day.entries) {
          if (entry.notes && typeof entry.notes === 'string' && entry.notes.trim() !== '') {
            extractedDescription = entry.notes.trim();
            console.log(`📝 Found notes in entry for ${day.date}:`, extractedDescription);
            break;
          }
          if (entry.description && typeof entry.description === 'string' && entry.description.trim() !== '') {
            extractedDescription = entry.description.trim();
            console.log(`📝 Found description in entry for ${day.date}:`, extractedDescription);
            break;
          }
        }
      }

      console.log(`📅 Day ${day.date} final extracted description:`, extractedDescription);



      return {
        ...day, // Preserve all original fields
        date: day.date,
        day: day.day,
        clockIn: detectAndConvertToLocal(firstClockIn || day.clockIn, day.clockInTime || day.rawStart),
        clockOut: detectAndConvertToLocal(lastClockOut || day.clockOut, day.clockOutTime || day.rawEnd),
        clockInOutPairs: pairs.map((p, idx) => {
          const inSource = p.clockInTime || p.rawStart || p.startedAt || p.originalSessionStart;
          const outSource = p.clockOutTime || p.rawEnd || p.endedAt || p.originalSessionEnd;
          const rawClockIn = detectAndConvertToLocal(p.clockIn, inSource);
          const rawClockOut = detectAndConvertToLocal(p.clockOut, outSource);

          return {
            ...p,
            clockIn: toAMPM(rawClockIn),
            clockOut: toAMPM(rawClockOut)
          };
        }),
        // ✅ Store the extracted description
        displayDescription: extractedDescription,
        breakHours: formatHM(day.breakSec || 0),
        totalHours: formatHM(effectiveSec),
        normalHours: formatHM(normalSec),
        overtime: formatHM(overtimeSec),
        totalSec: effectiveSec,
        overtimeSec: overtimeSec,
        normalSec: normalSec,
        breakSec: day.breakSec || 0,
        scheduledSec: day.scheduledSec || 0,
        isOptimisticallyUpdated: false,
        isManual: day.isManual || false,
        notes: day.notes || null,
        status: day.status || 'draft'
      };
    });
  }, [weekData]);

  // Calculate header totals
  // ✅ CRITICAL FIX: AGGREGATE FROM VISIBLE ROWS
  // We MUST derive totals from the actual visible rows (dailyRows) to ensure
  // that what the user sees in the table matches exactly what is shown in the header.
  // Using stored 'totals' from Firestore is risky because it might be stale
  // or not reflect client-side merges (like ghost sessions or absences).
  const headerTotals = useMemo(() => {
    // Default zero structure
    const zeroTotals = {
      effectiveHours: '0.00',
      overtimeHours: '0.00',
      normalHours: '0.00',
      breakHours: '0.00',

      effectiveSec: 0,
      overtimeSec: 0,
      normalSec: 0,
      breakSec: 0,
      grossSec: 0
    };

    if (!dailyRows || dailyRows.length === 0) {
      return zeroTotals;
    }

    // Sum up seconds from all rows
    const totals = dailyRows.reduce((acc, row) => {
      return {
        effectiveSec: acc.effectiveSec + (row.effectiveSec || 0),
        overtimeSec: acc.overtimeSec + (row.overtimeSec || 0),
        normalSec: acc.normalSec + (row.normalSec || 0),
        breakSec: acc.breakSec + (row.breakSec || 0),
        grossSec: acc.grossSec + (row.totalSec || 0) // Use totalSec (which is effective) or gross? Using effective for now as logic implies.
      };
    }, { effectiveSec: 0, overtimeSec: 0, normalSec: 0, breakSec: 0, grossSec: 0 });

    console.log('[ViewTimesheetModal] Recalculated Header Totals:', totals);

    return {
      // ✅ CHANGED: Use exact H:M format to match List View instead of 0.25 rounding
      effectiveHours: formatHoursMin(totals.effectiveSec),
      overtimeHours: formatHoursMin(totals.overtimeSec),
      normalHours: formatHoursMin(totals.normalSec),
      breakHours: formatHoursMin(totals.breakSec),

      // ✅ Raw seconds for exports
      effectiveSec: totals.effectiveSec,
      overtimeSec: totals.overtimeSec,
      normalSec: totals.normalSec,
      breakSec: totals.breakSec,
      grossSec: totals.grossSec
    };
  }, [dailyRows]);

  const existingIntervalsByDate = useMemo(() => {
    const toMinutes = (timeStr) => {
      if (!timeStr || typeof timeStr !== 'string') return null;
      const parts = timeStr.split(':');
      if (parts.length < 2) return null;
      const h = Number(parts[0]);
      const m = Number(String(parts[1]).slice(0, 2));
      if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
      if (h < 0 || h > 23 || m < 0 || m > 59) return null;
      return h * 60 + m;
    };

    const map = {};
    for (const day of dailyRows || []) {
      const dateStr = day?.date;
      if (!dateStr) continue;
      const intervals = [];
      for (const p of day?.clockInOutPairs || []) {
        const startStr = p?.clockInTime || p?.rawClockIn || p?.clockInTime || null;
        const endStr = p?.clockOutTime || p?.rawClockOut || p?.clockOutTime || null;
        const startMin = toMinutes(startStr);
        const endMin = endStr ? toMinutes(endStr) : null;
        if (startMin == null) continue;
        if (endMin != null && endMin <= startMin) continue;
        intervals.push({
          startMin,
          endMin,
          label: p?.isManual ? 'Manual' : (endMin == null ? 'Open' : undefined)
        });
      }
      map[dateStr] = intervals;
    }
    return map;
  }, [dailyRows]);

  // All week-based views must respect the company-level configuration.
  const effectiveWeekStartDay = isOwnTimesheet
    ? (contextWeekStartDay || DEFAULT_WEEK_START_DAY)
    : (employeeWeekStartDay || contextWeekStartDay || DEFAULT_WEEK_START_DAY);
  const formatReadable = (seconds) => {
    // ✅ CHANGED: Use exact H:M format to match List View
    return formatHoursMin(seconds);
  };


  const targetSecFromSchedule = (isoDateStr, schedule) => {
    try {
      const name = new Date(isoDateStr).toLocaleDateString('en-US', { weekday: 'long' });
      const sch = schedule?.[name];
      if (!sch || sch.enabled === false) return 0;
      if (typeof sch.durationMin === 'number') return Math.max(0, sch.durationMin) * 60;
      const [sH, sM] = String(sch.start || '09:00').split(':').map(Number);
      const [eH, eM] = String(sch.end || '17:00').split(':').map(Number);
      const d = new Date(isoDateStr);
      const s = new Date(d); s.setHours(sH || 0, sM || 0, 0, 0);
      const e = new Date(d); e.setHours(eH || 17, eM || 0, 0, 0);
      return Math.max(0, Math.floor((e - s) / 1000));
    } catch { return 0; }
  };
  const dayName = (dateStr) => {
    try { return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'long' }); } catch { return '-'; }
  };
  const fmt = (date) => {
    if (!date) return '-';
    try {
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch { return '-'; }
  };

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState(null);
  const [showDuplicateConfirm, setShowDuplicateConfirm] = useState(false);
  const [showManualEntryForm, setShowManualEntryForm] = useState(false);
  const [manualEntries, setManualEntries] = useState([]);
  const [isManualEntriesExpanded, setIsManualEntriesExpanded] = useState(false);
  const [editingDescriptionId, setEditingDescriptionId] = useState(null);
  const [savingDescriptionId, setSavingDescriptionId] = useState(null);
  const [tempDescription, setTempDescription] = useState('');

  // Populating manualEntries from dailyRows
  useEffect(() => {
    if (!dailyRows) return;
    const manuals = [];
    dailyRows.forEach(day => {
      // Check clockInOutPairs for manual entries
      if (day.clockInOutPairs) {
        day.clockInOutPairs.forEach(pair => {
          if (pair.isManual) {
            manuals.push({
              ...pair,
              date: day.date, // ensure date is available
              day: day.day
            });
          }
        });
      }
    });
    setManualEntries(manuals);
  }, [dailyRows]);

  // Determine overall loading state
  // For employee timesheets: show loading only if timesheets are still loading OR we're processing
  const isLoading = isOwnTimesheet
    ? isContextLoading
    : (isLoadingEmployeeTimesheets || isProcessingEmployeeData);

  const weekMeta = useMemo(() => {
    if (!weekData) return null;

    return {
      start: weekData.weekStart,
      end: weekData.weekEnd,
      startLabel: weekData.weekStart.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      endLabel: weekData.weekEnd.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    };
  }, [weekData]);

  // No real-time event handlers needed - context handles all updates automatically
  // Modal will automatically re-render when context data changes

  // All data now comes from context - no async loading needed

  const handleEdit = () => {
    console.log('[ViewTimesheetModal] Opening EditTimesheetModal');
    setIsEditModalOpen(true);
  };

  const handleSaveDayDescription = async (day, newDescription) => {
    try {
      const dayEditId = `day-${day.date}`;
      setSavingDescriptionId(dayEditId);

      const userId = isOwnTimesheet ? currentUser?.uid : employeeUserId;
      if (!userId) {
        toast.error('User ID not found');
        return;
      }

      const dateStr = day.date instanceof Date ? day.date.toISOString().split('T')[0] : day.date;
      const pairs = day.clockInOutPairs || [];

      // CRITICAL FIX: Filter out description-only entries and ensure we have valid entries
      const timePairs = pairs.filter(p => {
        // Skip description-only entries
        if (p.isDescriptionOnly) return false;

        // Must have a valid ID
        const hasValidId = p.id || p.sessionId || p.sessionKey || p.entryId;
        if (!hasValidId) {
          console.warn('[ViewTimesheetModal] Skipping entry without ID:', p);
          return false;
        }
        return true;
      });

      const descOnlyPairs = pairs.filter(p => p.isDescriptionOnly);

      console.log('[ViewTimesheetModal] ===== DESCRIPTION UPDATE START =====', {
        dateStr,
        userId,
        timePairsCount: timePairs.length,
        descOnlyPairsCount: descOnlyPairs.length,
        newDescription,
        isClearing: !newDescription || newDescription.trim() === '',
      });

      const isClearing = !newDescription || newDescription.trim() === '';
      const descriptionText = isClearing ? '' : newDescription.trim();

      // Determine Permission locally for safety
      const currentUserRole = currentUser?.role || currentUser?.primaryRole || '';
      const managerRoles = ['sitemanager', 'teammanager', 'seniormanager', 'adminmanager', 'hrmanager', 'hradvisor', 'adminadvisor', 'superuser', 'superadmin'];
      const roleNormalized = currentUserRole.toLowerCase().replace(/_/g, '').replace(/\s/g, '');
      const isManager = managerRoles.includes(roleNormalized);

      const statusRaw = timesheet?.status || timesheet?.raw?.status || '';
      const statusLower = String(statusRaw).toLowerCase();
      const dayStatusLower = (day.status || '').toLowerCase();

      const canModify = isManager || (
        isOwnTimesheet &&
        ['draft', 'rejected', 'pending', 'submitted', ''].includes(dayStatusLower) &&
        ['draft', 'rejected', 'pending', 'submitted', ''].includes(statusLower)
      );

      if (!canModify) {
        toast.error('You do not have permission to modify this timesheet');
        setSavingDescriptionId(null);
        return;
      }

      let processedCount = 0;
      let hasError = false;

      // 1. Update/Clear time entries & description-only entries - CRITICAL FIX: Use single updateDayDescription to prevent race conditions
      // This handles both standard time entries and description-only entries in the timesheet document.
      if (timePairs.length > 0 || descOnlyPairs.length > 0) {
        console.log('[ViewTimesheetModal] Updating day description for all entries:', { dateStr, timeCount: timePairs.length, descOnlyCount: descOnlyPairs.length });
        try {
          const result = await updateDayDescription({
            userId,
            dateStr,
            notes: descriptionText,
            weekStartDay: effectiveWeekStartDay
          });

          if (result && result.success) {
            processedCount += (result.count || 1);
          } else {
            console.warn('[ViewTimesheetModal] updateDayDescription returned non-success:', result);
            hasError = true;
          }
        } catch (error) {
          console.error('[ViewTimesheetModal] Failed to update day description:', error);
          hasError = true;
        }
      }

      // 3. CASE 3: No entries at all - create new one if not clearing
      if (timePairs.length === 0 && descOnlyPairs.length === 0 && !isClearing) {
        console.log('[ViewTimesheetModal] Creating first description entry');
        try {
          const result = await addManualTimeEntry(
            userId,
            dateStr,
            null,
            null,
            effectiveWeekStartDay,
            null,
            {
              notes: descriptionText,
              description: descriptionText,
              isManual: true,
              isDescriptionOnly: true
            }
          );
          if (result) {
            processedCount++;
          }
        } catch (error) {
          console.error('[ViewTimesheetModal] Failed to create description entry:', error);
          hasError = true;
          toast.error('Failed to create description entry');
        }
      }


      // Show final feedback
      if (processedCount > 0 && !hasError) {
        const feedbackMessage = isClearing ? 'Description cleared' :
          (timePairs.length === 0 && descOnlyPairs.length === 0 ? 'Description added' : 'Description updated');
        toast.success(feedbackMessage);

        // ✅ IMPORTANT: Optimistically update local state
        if (weekData && weekData.days) {
          const updatedDays = weekData.days.map(d => {
            if (d.date === dateStr) {
              const updatedDay = { ...d, notes: descriptionText };

              // Also update the description field in all clockInOutPairs locally
              if (updatedDay.clockInOutPairs) {
                updatedDay.clockInOutPairs = updatedDay.clockInOutPairs.map(p => ({
                  ...p,
                  notes: descriptionText,
                  description: descriptionText
                }));
              }

              // If clearing, filter out description-only entries locally
              if (isClearing) {
                updatedDay.entries = updatedDay.entries?.filter(e => !e.isDescriptionOnly) || [];
                updatedDay.clockInOutPairs = updatedDay.clockInOutPairs?.filter(p => !p.isDescriptionOnly) || [];
              }

              return updatedDay;
            }
            return d;
          });

          if (!isOwnTimesheet) {
            setEmployeeWeekData(prev => ({ ...prev, days: updatedDays }));
          } else {
            setRefreshTimestamp(Date.now());
          }
        }
      } else if (isClearing && !hasError) {
        toast.info('No description to clear');
      } else if (!isClearing && processedCount === 0) {
        toast.error('Failed to update description. Please check console for details.');
      }

      // Refresh data from Firestore (Reduced delay for faster UI)
      await refreshAfterUpdate(userId);

      // Clear editing state
      setEditingDescriptionId(null);
      setTempDescription('');

      console.log('[ViewTimesheetModal] ===== DESCRIPTION UPDATE COMPLETE =====');

    } catch (error) {
      console.error('[ViewTimesheetModal] ===== DESCRIPTION UPDATE FAILED =====', error);
      toast.error('Failed to update description: ' + (error.message || 'Unknown error'));
    } finally {
      setSavingDescriptionId(null);
    }
  };

  // Helper function to refresh data after updates
  const refreshAfterUpdate = async (userId) => {
    try {
      console.log('[ViewTimesheetModal] Refreshing after update');

      // Get the correct week start date
      let weekStartStr = null;

      if (weekStartDate) {
        weekStartStr = weekStartDate instanceof Date
          ? weekStartDate.toISOString().slice(0, 10)
          : weekStartDate;
      } else if (timesheet?.weekKey) {
        const [start] = timesheet.weekKey.split('_');
        if (start && start.match(/^\d{4}-\d{2}-\d{2}$/)) {
          weekStartStr = start;
        }
      } else if (timesheet?.raw?.start) {
        weekStartStr = timesheet.raw.start;
      } else if (dailyRows && dailyRows.length > 0) {
        weekStartStr = dailyRows[0]?.date;
      }

      console.log('[ViewTimesheetModal] Using weekStartStr:', weekStartStr);

      // For own timesheet, refresh context immediately
      if (isOwnTimesheet && refresh) {
        console.log('[ViewTimesheetModal] Refreshing context');
        await refresh();
        setRefreshTimestamp(Date.now());
      } else {
        // For employee timesheets, trigger the effect to reload
        setRefreshTimestamp(Date.now());
      }
    } catch (e) {
      console.warn('[ViewTimesheetModal] Failed to refresh after update', e);

      // Fallback refresh
      if (isOwnTimesheet && refresh) {
        await refresh();
      }
      setRefreshTimestamp(Date.now());
    }
  };
  const handleApprove = async () => {
    console.log('[ViewTimesheetModal] handleApprove clicked', { isOwnTimesheet, timesheet });
    setIsSubmitting(true);

    try {
      // ENHANCEMENT: Check for duplicates before submission
      if (isOwnTimesheet) {
        const normalizedFallback = typeof fallbackUserId === 'string' ? (fallbackUserId.includes('/') ? fallbackUserId.split('/')[1] : fallbackUserId) : null;
        const userId = (
          timesheet?.raw?.userId ||
          timesheet?.userId ||
          timesheet?.uid ||
          timesheet?.user?.uid ||
          normalizedFallback ||
          null
        );

        let weekStart = timesheet?.raw?.start || null;
        if (!weekStart && typeof timesheet?.week === 'string') {
          try {
            const parts = timesheet.week.split(',');
            if (parts.length >= 2) {
              const rest = parts[1].trim();
              const monthName = rest.split(' ')[0];
              const range = rest.split(' ')[1];
              const dayStart = range?.split('-')?.[0];
              const year = parts[0].trim();
              if (monthName && dayStart && year) {
                weekStart = new Date(`${monthName} ${dayStart}, ${year}`);
                if (!isNaN(weekStart)) weekStart = weekStart.toISOString().slice(0, 10);
              }
            }
          } catch (e) { console.warn('[ViewTimesheetModal] failed to parse week string', e); }
        }
        if (!weekStart && Array.isArray(dailyRows) && dailyRows.length) {
          weekStart = dailyRows[0]?.date;
        }

        if (userId && weekStart) {
          // Check for existing submission
          const validation = await timesheetValidation.validateWeekSubmission(userId, weekStart, {
            allowUpdateExisting: true,
            checkApprovalStatus: true,
            weekStartDay: effectiveWeekStartDay
          });

          if (!validation.isValid) {
            const error = validation.errors[0];
            TimesheetErrorHandler.handleError(error.code || TIMESHEET_ERROR_CODES.UNKNOWN_ERROR, {
              userId,
              weekStart,
              operation: 'timesheet_submission'
            });
            setIsSubmitting(false);
            return;
          }

          // Check for duplicates
          const duplicates = await timesheetDeduplication.detectDuplicateEntries(userId, weekStart, {
            weekStartDay: effectiveWeekStartDay
          });
          if (duplicates.hasDuplicates && !showDuplicateConfirm) {
            setDuplicateWarning({
              duplicateGroups: duplicates.duplicateGroups,
              totalDocs: duplicates.totalDocs,
              weekStart,
              userId
            });
            setShowDuplicateConfirm(true);
            setIsSubmitting(false);
            return;
          }

          // Show warning for existing submission
          if (validation.existing.hasSubmission && validation.warnings.length > 0) {
            const warning = validation.warnings.find(w => w.code === 'EXISTING_SUBMISSION_UPDATE');
            if (warning && !showDuplicateConfirm) {
              // toast.info(warning.message); // Removed redundant toast
            }
          }
        }
      }
      const raw = timesheet?.raw || timesheet || {};

      // Compute userId robustly
      const normalizedFallback = typeof fallbackUserId === 'string' ? (fallbackUserId.includes('/') ? fallbackUserId.split('/')[1] : fallbackUserId) : null;
      const userId = (
        raw?.userId ||
        timesheet?.userId ||
        timesheet?.uid ||
        timesheet?.user?.uid ||
        normalizedFallback ||
        null
      );
      console.log('[ViewTimesheetModal] derived userId:', userId);

      // Derive weekStart if missing (raw.start preferred). Fallbacks:
      // 1) parse timesheet.week like "2025, October 13-19" -> take first date
      // 2) first daily row date
      // 3) raw.period
      let weekStart = raw?.start || null;
      if (!weekStart && typeof timesheet?.week === 'string') {
        try {
          const parts = timesheet.week.split(',');
          if (parts.length >= 2) {
            const rest = parts[1].trim(); // e.g. "October 13-19"
            const monthName = rest.split(' ')[0];
            const range = rest.split(' ')[1]; // e.g. "13-19"
            const dayStart = range?.split('-')?.[0];
            const year = parts[0].trim();
            if (monthName && dayStart && year) {
              weekStart = new Date(`${monthName} ${dayStart}, ${year}`);
              if (!isNaN(weekStart)) weekStart = weekStart.toISOString().slice(0, 10);
            }
          }
        } catch (e) { console.warn('[ViewTimesheetModal] failed to parse week string', e); }
      }
      if (!weekStart && Array.isArray(dailyRows) && dailyRows.length) {
        weekStart = dailyRows[0]?.date;
      }
      if (!weekStart && raw?.period) {
        weekStart = raw.period;
      }
      console.log('[ViewTimesheetModal] derived weekStart:', weekStart);

      if (isOwnTimesheet) {
        if (!userId) {
          console.error('[ViewTimesheetModal] Missing userId for submit');
          toast.error('Unable to submit: Missing user ID.');
          return;
        }
        if (!weekStart) {
          console.error('[ViewTimesheetModal] Missing week start date for submit');
          toast.error('Unable to submit: Missing week start date.');
          return;
        }
        if (onApprove) {
          console.log('[ViewTimesheetModal] Delegating submit to onApprove');
          await onApprove(timesheet);
          setIsSubmitting(false);
          return;
        }

        console.log('[ViewTimesheetModal] submitting week (fallback)', { userId, weekStart });
        const res = await submitWeek(userId, weekStart, { forceCreateIfEmpty: true });
        console.log('[ViewTimesheetModal] submit result', res);
        if (res?.count > 0) {
          // Trigger parent component refresh by calling refreshing context
          if (refresh && isOwnTimesheet) {
            await refresh();
          }
        } else {
          toast.info('No entries found to submit for this week');
        }
      } else if (onApprove) {
        // Manager approval flow with proper feedback
        console.log('[ViewTimesheetModal] Starting approval process for timesheet:', timesheet?.id);

        try {
          // Show loading state and keep modal open during approval
          const result = await onApprove(timesheet?.id);
          console.log('[ViewTimesheetModal] Approval result:', result);

          // Show success message
          toast.success(`Timesheet approved successfully for ${timesheet?.name || 'employee'}`);

          // Update the timesheet status and approval info in the UI immediately for better UX
          if (timesheet) {
            timesheet.status = 'Approved';
            // Get the manager's display name - prefer firstName + lastName, fall back to displayName, then name
            const approverName = currentUser?.firstName && currentUser?.lastName
              ? `${currentUser.firstName} ${currentUser.lastName}`
              : currentUser?.displayName
                ? currentUser.displayName
                : currentUser?.name
                  ? currentUser.name
                  : 'Manager';
            timesheet.approvedByName = approverName;
            timesheet.approvedAt = new Date();
            timesheet.approvedByName = approverName;
            timesheet.approvedAt = new Date();
            // Save human-readable role for UI instantly
            timesheet.approverRole = (currentUser?.primaryRole || 'Manager').replace(/_/g, ' ');
          }

          // Directly close modal after success for snappy UI
          onClose();

        } catch (approvalError) {
          console.error('[ViewTimesheetModal] Approval failed:', approvalError);
          toast.error(approvalError?.message || 'Failed to approve timesheet. Please try again.');
          // Don't close modal on error so user can retry
          setIsSubmitting(false);
          return;
        }
      }
    } catch (e) {
      console.error('Failed to submit/approve timesheet:', e);
      TimesheetErrorHandler.handleError(e, {
        operation: isOwnTimesheet ? 'submit_timesheet' : 'approve_timesheet',
        timesheetId: timesheet?.id,
        userId: timesheet?.userId
      });
    } finally {
      setIsSubmitting(false);

      // For own timesheet submission, close modal after success message
      if (isOwnTimesheet) {
        // Directly close modal for snappy UI
        onClose();
      }
    }
  };

  const handleDecline = async () => {
    console.log('[ViewTimesheetModal] handleDecline clicked', { timesheet });
    setIsSubmitting(true);

    try {
      if (onDecline) {
        console.log('[ViewTimesheetModal] Starting decline process for timesheet:', timesheet?.id);

        try {
          // Show loading state and keep modal open during decline
          const result = await onDecline(timesheet?.id);
          console.log('[ViewTimesheetModal] Decline result:', result);

          // Show success message
          toast.success(`Timesheet declined for ${timesheet?.name || 'employee'}`);

          // Update the timesheet status in the UI immediately for better UX
          if (timesheet) {
            timesheet.status = 'Rejected';
          }

          // Close modal immediately
          onClose();

        } catch (declineError) {
          console.error('[ViewTimesheetModal] Decline failed:', declineError);
          toast.error(declineError?.message || 'Failed to decline timesheet. Please try again.');
        }
      }
    } catch (e) {
      console.error('Failed to decline timesheet:', e);
      toast.error(e?.message || 'Failed to decline timesheet');
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!timesheet?.id) {
      toast.error('Timesheet ID not found');
      return;
    }

    setIsDeleting(true);
    try {
      await deleteTimesheet(timesheet.id);
      toast.success('Timesheet deleted successfully');
      setShowDeleteConfirm(false);
      onClose();

      // Refresh the timesheet context to update the list
      if (refresh) {
        refresh();
      }
    } catch (error) {
      console.error('Failed to delete timesheet:', error);
      toast.error(error?.message || 'Failed to delete timesheet');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleExportToCSV = () => {
    try {
      if (!dailyRows || dailyRows.length === 0) {
        toast.error("No timesheet data to export");
        return;
      }

      const formatDateForCSV = (isoDate) => {
        if (!isoDate) return "";
        try {
          const d = new Date(isoDate);
          if (isNaN(d.getTime())) return `="${isoDate}"`;
          const dd = String(d.getDate()).padStart(2, "0");
          const mm = String(d.getMonth() + 1).padStart(2, "0");
          const yyyy = d.getFullYear();
          return `="${dd}-${mm}-${yyyy}"`;
        } catch {
          return `="${isoDate}"`;
        }
      };

      const escapeCSV = (v) => {
        if (v === null || v === undefined) return "";
        const str = String(v);
        return /[",;\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
      };

      // Updated headers with new column order
      const headers = [
        "Date",
        "Day",
        "Clock In (Rounded)",
        "Clock Out (Rounded)",
        "Break",
        "Normal Hours",
        "Overtime",
        "Paid Hours",
      ];

      const csvRows = [headers.join(",")];

      // Process daily rows
      dailyRows.forEach((item) => {
        const pairs = item.clockInOutPairs || [];
        const dateStr = item.date ? formatDateForCSV(item.date) : "";
        const dayName = item.day || "";
        const totalHours = item.totalHours || "0h 00m";
        const breakHours = item.breakHours || "0h 00m";
        const normalHours = item.normalHours || "0h 00m";
        const overtime = item.overtime || "0h 00m";

        // Check if this is an absence day
        if (item.hasAbsence && pairs.length === 0) {
          csvRows.push(
            [
              escapeCSV(dateStr),
              escapeCSV(dayName),
              escapeCSV(item.absenceLabel || "Leave"), // Show leave type in Clock In column
              escapeCSV("-"), // Clock Out shows dash
              escapeCSV(breakHours),
              escapeCSV(normalHours),
              escapeCSV(overtime),
              escapeCSV(totalHours),
            ].join(",")
          );
          return;
        }

        if (pairs.length === 0) {
          csvRows.push(
            [
              escapeCSV(dateStr),
              escapeCSV(dayName),
              escapeCSV(item.clockIn || "-"),
              escapeCSV(item.clockOut || "-"),
              escapeCSV(breakHours),
              escapeCSV(normalHours),
              escapeCSV(overtime),
              escapeCSV(totalHours),
            ].join(",")
          );
          return;
        }

        // Multiple Clock-in/out pairs
        pairs.forEach((p, i) => {
          csvRows.push(
            [
              escapeCSV(i === 0 ? dateStr : ""),
              escapeCSV(i === 0 ? dayName : ""),
              escapeCSV(p.clockIn || "-"),
              escapeCSV(p.clockOut || "-"),
              escapeCSV(i === 0 ? breakHours : ""),
              escapeCSV(i === 0 ? normalHours : ""),
              escapeCSV(i === 0 ? overtime : ""),
              escapeCSV(i === 0 ? totalHours : ""),
            ].join(",")
          );
        });
      });

      // Summary row
      csvRows.push("");
      csvRows.push(
        [
          "Summary",
          "",
          "",
          "",
          escapeCSV(formatReadable(headerTotals?.breakSec || 0)),
          escapeCSV(formatReadable((headerTotals?.effectiveSec || 0) - (headerTotals?.overtimeSec || 0))),
          escapeCSV(formatReadable(headerTotals?.overtimeSec || 0)),
          escapeCSV(formatReadable(headerTotals?.effectiveSec || 0)),
        ].join(",")
      );

      // ✅ Add Approval Details to CSV
      if (timesheet?.status?.toLowerCase()?.includes('approved')) {
        const approvedBy = timesheet?.approvedByName || approvalMetadata?.approvedByName || 'Not specified';
        const approvedAt = timesheet?.approvedAt || approvalMetadata?.approvedAt;
        const approvedAtStr = approvedAt ? new Date(approvedAt.toDate ? approvedAt.toDate() : approvedAt).toLocaleDateString('en-GB') : 'Not specified';

        csvRows.push("");
        csvRows.push(["Approved By", escapeCSV(approvedBy)].join(","));
        csvRows.push(["Approved At", escapeCSV(approvedAtStr)].join(","));
      }

      // Download
      const csvContent = csvRows.join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;

      const employeeName = (timesheet?.name || "Employee").replace(/\s+/g, "_");
      const weekRange = weekMeta
        ? `${formatISODate(weekMeta.start)}_to_${formatISODate(weekMeta.end)}`
        : new Date().toISOString().slice(0, 10);

      link.download = `timesheet_${employeeName}_${weekRange}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success("Timesheet exported to CSV successfully");
    } catch (error) {
      console.error("CSV Export Error:", error);
      toast.error("Failed to export timesheet");
    }
  };

  // Handle PDF Download for Approved Timesheets
  const handleDownloadPDF = useCallback(async () => {
    const isApproved = timesheet?.status && (timesheet.status === 'Approved' || timesheet.status === 'approved');
    if (!isApproved) {
      toast.warning('Only approved timesheets can be downloaded as PDF');
      return;
    }

    // NOTE: Even if DB has pdfUrl, we regenerate locally so the PDF always
    // matches the current UI data (dailyRows/headerTotals) and includes details.

    setIsSubmitting(true);
    try {
      // Prepare PDF data with all required information
      const pdfOptions = {
        employeeName: timesheet?.name || 'Employee',
        weekStart: weekMeta?.start,
        weekEnd: weekMeta?.end,
        dailyRows: dailyRows,
        headerTotals: headerTotals,
        approvedByName: timesheet?.approvedByName || timesheet?.approverName || approvalMetadata?.approvedByName,
        siteManager: timesheet?.siteManager,
        approvalDate: timesheet?.approvedAt || approvalMetadata?.approvedAt,
        submissionDate: timesheet?.submittedDate || timesheet?.createdAt,
        approverRole: timesheet?.approverRole, // Let service handle defaults/fallback
        companyName: timesheet?.companyName || '',
        customer: timesheet?.customer || timesheet?.project || '',
        location: timesheet?.location || '',
        projectDetails: timesheet?.workDetails || timesheet?.projectDetails || '',
        clockNumber: timesheet?.clockNumber || timesheet?.employeeId || '',
        contractNumber: timesheet?.contractNumber || '',
        timesheetId: timesheet?.id || timesheet?.timesheetId || ''
      };

      const result = await generateTimesheetPDF(timesheet, weekData, pdfOptions);

      if (result.success) {
        toast.success(`PDF downloaded: ${result.filename}`);
      }
    } catch (error) {
      console.error('Error downloading PDF:', error);
      toast.error(error.message || 'Failed to download PDF. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [timesheet, weekData, dailyRows, headerTotals, weekMeta, approvalMetadata]);

  if (!isOpen || !timesheet) return null;

  // When Edit is open: show EditTimesheetModal only (View dialog disappears like before)
  if (isEditModalOpen) {
    return (
      <EditTimesheetModal
        isOpen={true}
        onClose={() => setIsEditModalOpen(false)} // cancel → go back to view
        timesheet={timesheet}
        onSave={() => {
          console.log('[ViewTimesheetModal] Edit saved, closing (refresh in background)');
          setIsEditModalOpen(false);
          const uid = isOwnTimesheet ? currentUser?.uid : employeeUserId;
          if (uid) {
            void refreshAfterUpdate(uid).catch((e) =>
              console.warn('[ViewTimesheetModal] Background refresh failed:', e)
            );
          }
          onClose();
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]" onClick={onClose}></div>

      <div className="relative w-full max-w-[900px] bg-white rounded-[24px] shadow-[0_4px_20px_rgba(0,0,0,0.1)] p-6 max-h-[90vh] overflow-y-auto scrollbar-custom">

        {/* Loading overlay for approval/decline process */}
        {isSubmitting && !isOwnTimesheet && (
          <div className="absolute inset-0 bg-white/80 backdrop-blur-sm rounded-[24px] flex items-center justify-center z-10">
            <div className="flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
              <p className="text-sm font-medium text-gray-700">
                {timesheet?.status === 'Pending' ? 'Processing approval...' : 'Processing...'}
              </p>
            </div>
          </div>
        )}

        <div className="space-y-6">
          {/* Header */}
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-3">
              <h2 className="text-xl sm:text-2xl font-bold text-text-primary">
                {weekMeta && (
                  <span>
                    Week of {weekMeta.startLabel} – {weekMeta.endLabel}
                  </span>
                )}
                {!weekMeta && (
                  <span>
                    {timesheet?.period || timesheet?.week || timesheet?.raw?.period || 'Timesheet Details'}
                  </span>
                )}
              </h2>
            </div>
            <button onClick={onClose} className="w-6 h-6 flex items-center justify-center bg-black/10 rounded-full hover:bg-black/20 transition-colors">
              <X className="h-4 w-4 text-text-secondary" />
            </button>
          </div>

          {/* Summary Section - Total Hours, Overtime, Status */}
          <div className="flex flex-wrap items-center gap-6 pb-4 border-b border-gray-200">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-gray-700">Paid Hours</span>
              <span className="text-lg font-bold text-gray-900">{headerTotals?.effectiveHours ?? formatReadable(timesheet?.raw?.totals?.effectiveSec || 0)}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-gray-700">Overtime</span>
              <span className="text-lg font-bold text-gray-900">{headerTotals?.overtimeHours ?? formatReadable(timesheet?.raw?.totals?.overtimeSec || 0)}</span>
            </div>
            <div className="flex flex-col gap-1 ml-auto">
              <span className="text-sm font-semibold text-gray-700">Status</span>
              <Badge variant={
                (timesheet?.status || '').toLowerCase() === 'approved' ? 'success'
                  : (timesheet?.status || '').toLowerCase() === 'rejected' ? 'danger'
                    : (timesheet?.status || '').toLowerCase() === 'draft' ? 'info'
                      : 'warning'
              }>
                {timesheet?.status || (timesheet?.raw?.status || 'Draft')}
              </Badge>
            </div>
            {
              (timesheet?.status?.toLowerCase()?.includes('approved')) && (
                <>
                  <div className="flex flex-col items-start gap-0">
                    <span className='text-sm text-text-secondary'>Approved By:</span>
                    <span className='text-sm font-semibold '>{timesheet?.approvedByName || timesheet?.raw?.approvedByName || approvalMetadata?.approvedByName || 'Not specified'}</span>
                  </div>
                  <div className="flex flex-col items-start gap-0">
                    <span className='text-sm text-text-secondary'>Approved At:</span>
                    <span className='text-sm font-semibold '>
                      {(() => {
                        const date = timesheet?.approvedAt || timesheet?.raw?.approvedAt || approvalMetadata?.approvedAt;
                        if (!date) return 'Not specified';
                        return new Date(date?.toDate?.() || date).toLocaleDateString('en-GB');
                      })()}
                    </span>
                  </div>
                </>
              )
            }
          </div>

          {/* Notes Section - Display day-specific notes and approval/rejection notes */}
          {(() => {
            // Collect all day notes from dailyRows
            const dayNotes = dailyRows
              .filter(day => {
                const hasNotes = day.notes && String(day.notes).trim();
                if (hasNotes) {
                  console.log('[ViewTimesheetModal] Found notes for day:', day.date, day.day, day.notes);
                }
                return hasNotes;
              })
              .map(day => ({
                date: day.date,
                day: day.day,
                notes: String(day.notes).trim()
              }));

            console.log('[ViewTimesheetModal] Total day notes collected:', dayNotes.length, dayNotes);

            // Get approval/rejection notes
            const approvalNotes = timesheet?.raw?.approvalNotes || timesheet?.approvalNotes || null;
            const rejectionNotes = timesheet?.raw?.rejectionNotes || timesheet?.rejectionNotes || null;

            // Show section if there are any notes
            if (dayNotes.length > 0 || approvalNotes || rejectionNotes) {
              return (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5">
                      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                        <span className="text-blue-600 text-sm font-semibold">📝</span>
                      </div>
                    </div>
                    <div className="flex-1 space-y-3">
                      <h3 className="text-sm font-semibold text-blue-900">Notes:</h3>

                      {/* Day-specific notes */}
                      {dayNotes.length > 0 && (
                        <div className="space-y-2">
                          {dayNotes.map((dayNote, idx) => (
                            <div key={idx} className="text-sm text-blue-800">
                              <span className="font-medium">{formatDateUK(dayNote.date)} ({dayNote.day}):</span>{' '}
                              <span className="whitespace-pre-wrap">{dayNote.notes}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Approval/Rejection notes */}
                      {(approvalNotes || rejectionNotes) && (
                        <div className="text-sm text-blue-800 whitespace-pre-wrap pt-2 border-t border-blue-300">
                          {approvalNotes || rejectionNotes}
                          {(timesheet?.raw?.approvalNotesBy || timesheet?.raw?.rejectionNotesBy || timesheet?.approvalNotesBy || timesheet?.rejectionNotesBy) && (
                            <p className="text-xs text-blue-600 mt-2">
                              Added by manager
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            }
            return null;
          })()}

          {/* Manual Time Entries Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Manual Time Entries</h3>
              {!showManualEntryForm && (() => {
                // Refined visibility rules for Add new button
                const currentUserRole = currentUser?.role || currentUser?.primaryRole || '';
                const managerRoles = ['sitemanager', 'teammanager', 'seniormanager', 'adminmanager', 'hrmanager', 'hradvisor', 'adminadvisor', 'superuser', 'superadmin'];
                const roleNormalized = currentUserRole.toLowerCase().replace(/_/g, '').replace(/\s/g, '');
                const isManager = managerRoles.includes(roleNormalized);
                const statusRaw = timesheet?.status || timesheet?.raw?.status || '';
                const statusLower = String(statusRaw).toLowerCase();

                // For own timesheet: show if Draft, hide if Approved or Pending
                if (isOwnTimesheet) {
                  return ['draft'].includes(statusLower);
                }

                // For senior managers viewing other users: always show
                if (!isOwnTimesheet && isManager) {
                  return true;
                }

                // For others viewing other users: hide if Approved or Pending
                return !['approved', 'pending'].includes(statusLower);
              })() && (
                  <button
                    onClick={() => setShowManualEntryForm(true)}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition"
                    title="Add manual time entry"
                  >
                    <Plus className="w-4 h-4" />
                    Add new
                  </button>
                )}
            </div>

            {/* Manual Entry Form */}
            {showManualEntryForm && weekMeta && (
              <ManualTimeEntryRow
                isOpen={showManualEntryForm}
                onClose={() => setShowManualEntryForm(false)}
                userId={isOwnTimesheet ? currentUser?.uid : (employeeUserId || timesheet?.userId || fallbackUserId)}
                timesheetId={null} // Let service generate correct ID to avoid WeekKey mismatch
                date={formatISODate(weekMeta.start)}
                weekStartDay={effectiveWeekStartDay}
                weekDates={getOrderedWeekDates(weekMeta.start, effectiveWeekStartDay)}
                existingIntervalsByDate={existingIntervalsByDate}
                onEntryAdded={async (entry) => {
                  console.log('[ViewTimesheetModal] Manual entry added, triggering refresh');

                  // Invalidate cache to force fresh data fetch
                  try {
                    const { invalidateTimesheetCache } = await import('../../services/timesheets');
                    const weekStartStr = formatISODate(weekMeta.start);
                    const targetUserId = isOwnTimesheet ? currentUser?.uid : (employeeUserId || timesheet?.userId || fallbackUserId);

                    if (targetUserId) {
                      invalidateTimesheetCache(targetUserId, weekStartStr);
                      invalidateTimesheetCache(targetUserId, null); // Clear all cache for user
                      console.log('[ViewTimesheetModal] Cache invalidated for user:', targetUserId);
                    }
                  } catch (error) {
                    console.warn('[ViewTimesheetModal] Failed to invalidate cache:', error);
                  }

                  // Close the form - data will refresh automatically via Firestore listener
                  setShowManualEntryForm(false);

                  // Force refresh to show the new entry immediately
                  if (refresh && isOwnTimesheet) {
                    refresh();
                  }
                  setRefreshTimestamp(Date.now());

                  // Additional refresh after a short delay to ensure data is loaded
                  setTimeout(() => {
                    setRefreshTimestamp(Date.now());
                  }, 1000);
                }}
                userRole={currentUser?.role}
              />
            )}

            {/* Display Manual Entries */}
            {/* Display Manual Entries */}
            {manualEntries.length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg overflow-hidden transition-all duration-200">
                <button
                  onClick={() => setIsManualEntriesExpanded(!isManualEntriesExpanded)}
                  className="w-full flex items-center justify-between bg-blue-100 px-4 py-2 hover:bg-blue-200/50 transition-colors text-left"
                >
                  <p className="text-sm font-semibold text-blue-900">
                    {manualEntries.length} Manual Entr{manualEntries.length === 1 ? 'y' : 'ies'}
                  </p>
                  {isManualEntriesExpanded ? (
                    <ChevronUp className="w-4 h-4 text-blue-700" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-blue-700" />
                  )}
                </button>

                {isManualEntriesExpanded && (
                  <div className="space-y-2 p-4 animate-in slide-in-from-top-2 duration-200">
                    {manualEntries.map((entry, idx) => (
                      <div key={idx} className="flex items-start justify-between bg-white p-3 rounded-lg border border-blue-200 shadow-sm">
                        <div className="flex-1">
                          {/* Activity Type (was Description) or Legacy Description */}
                          <p className="text-sm font-medium text-gray-900">
                            {entry.activityType || entry.description || 'Manual Entry'}
                          </p>

                          {/* New Description Field */}
                          {entry.activityType && entry.description && (
                            <p className="text-sm text-gray-700 mt-0.5">{entry.description}</p>
                          )}

                          <p className="text-xs text-gray-600 mt-1">
                            {entry.timeOn || entry.clockIn} - {entry.timeOff || entry.clockOut} {entry.breakMin > 0 && `(break: ${entry.breakMin}m)`}
                          </p>

                          {/* Legacy Work Order (if exists and no new description) */}
                          {entry.workOrder && !entry.activityType && (
                            <p className="text-xs text-gray-500">Work Order: {entry.workOrder}</p>
                          )}
                          {/* Show Work Order if it exists even with new fields (backward compatibility or if user still uses it in some legacy way) */}
                          {entry.workOrder && entry.activityType && (
                            <p className="text-xs text-gray-500">Work Order: {entry.workOrder}</p>
                          )}
                          {entry.notes && (
                            <p className="text-xs text-gray-600 mt-1 italic">{entry.notes}</p>
                          )}
                        </div>
                        <div className="text-right ml-4 flex-shrink-0">
                          <p className="text-sm font-semibold text-gray-900">
                            {(() => {
                              const normalSec = Number.isFinite(entry.normalSec)
                                ? entry.normalSec
                                : Math.max(0, (entry.effectiveSec || 0) - (entry.overtimeSec || 0));

                              return `${Math.floor(normalSec / 3600)}h ${Math.floor((normalSec % 3600) / 60)}m`;
                            })()}
                          </p>
                          {entry.overtimeSec > 0 && (
                            <p className="text-xs text-orange-600">OT: {Math.floor(entry.overtimeSec / 3600)}h {Math.floor((entry.overtimeSec % 3600) / 60)}m</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Daily Breakdown Table */}
          <div className="bg-white border border-border-primary rounded-base overflow-hidden">
            {isLoading || !weekData ? (
              <div className="flex items-center justify-center h-32">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
              </div>
            ) : dailyRows.length === 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableHeaderCell>DATE</TableHeaderCell>
                    <TableHeaderCell>DAY</TableHeaderCell>
                    <TableHeaderCell>CLOCK IN</TableHeaderCell>
                    <TableHeaderCell>CLOCK OUT</TableHeaderCell>
                    <TableHeaderCell>DESCRIPTION</TableHeaderCell>
                    <TableHeaderCell>BREAK</TableHeaderCell>
                    <TableHeaderCell>NORMAL HOURS</TableHeaderCell>
                    <TableHeaderCell>OVERTIME</TableHeaderCell>
                    <TableHeaderCell>PAID HOURS</TableHeaderCell>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-gray-500">
                        No time entries found
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableHeaderCell>DATE</TableHeaderCell>
                    <TableHeaderCell>DAY</TableHeaderCell>
                    <TableHeaderCell>CLOCK IN</TableHeaderCell>
                    <TableHeaderCell>CLOCK OUT</TableHeaderCell>
                    <TableHeaderCell>DESCRIPTION</TableHeaderCell>
                    <TableHeaderCell>BREAK</TableHeaderCell>
                    <TableHeaderCell>NORMAL HOURS</TableHeaderCell>
                    <TableHeaderCell>OVERTIME</TableHeaderCell>
                    <TableHeaderCell>PAID HOURS</TableHeaderCell>
                  </TableHeader>
                  <TableBody>
                    {dailyRows.map((day, idx) => {
                      const pairs = day.clockInOutPairs || [];

                      // Check if this is an absence day with NO clock data
                      if (day.hasAbsence && pairs.length === 0) {
                        // Show leave type for absence days only if no time sessions exist
                        const clockInDisplay = (
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-green-700">{day.absenceLabel}</span>
                          </div>
                        );
                        const clockOutDisplay = (
                          <span className="text-sm text-gray-500">-</span>
                        );

                        return (
                          <TableRow key={idx} className="bg-green-50/30">
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-700">{formatDateISO(day.date)}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="text-sm text-gray-700">{day.day}</span>
                            </TableCell>
                            <TableCell>
                              {clockInDisplay}
                            </TableCell>
                            <TableCell>
                              {clockOutDisplay}
                            </TableCell>
                            <TableCell>
                              <span className="text-sm text-gray-500">{day.absenceLabel}</span>
                            </TableCell>
                            <TableCell>
                              <span className="text-sm font-medium text-red-600">{day.breakHours}</span>
                            </TableCell>
                            <TableCell>
                              <span className="text-sm font-medium text-blue-600">{day.normalHours || '0h 00m'}</span>
                            </TableCell>
                            <TableCell>
                              <span className="text-sm font-medium text-orange-600">{day.overtime}</span>
                            </TableCell>
                            <TableCell>
                              <span className="text-sm font-bold text-gray-900">{day.totalHours}</span>
                            </TableCell>
                          </TableRow>
                        );
                      }

                      // Normal clock in/out display for regular days
                      // Format clock in/out times - show ALL sessions stacked
                      // Deduplicate: Exclude entries that are description-only OR have no times (dash-dash)
                      const timePairs = pairs.filter(p => {
                        if (p.isDescriptionOnly) return false;

                        // Check if ANY time field has valid data (same logic as EditTimesheetModal)
                        const hasValidTime =
                          (p.clockIn && p.clockIn !== '-') ||
                          (p.clockOut && p.clockOut !== '-') ||
                          (p.rawStart) ||
                          (p.rawEnd) ||
                          (p.rawClockIn && p.rawClockIn !== '-') ||
                          (p.rawClockOut && p.rawClockOut !== '-') ||
                          (p.roundedStart) ||
                          (p.roundedEnd);

                        return hasValidTime;
                      });

                      let clockInDisplay = <span className="text-sm text-gray-700">-</span>;
                      let clockOutDisplay = <span className="text-sm text-gray-700">-</span>;

                      if (timePairs.length > 0) {
                        const rules = roundingRules || companySettings?.roundingRules || getDefaultRoundingRules();
                        clockInDisplay = <ClockPairsDisplay pairs={timePairs} rules={rules} direction="in" />;
                        clockOutDisplay = <ClockPairsDisplay pairs={timePairs} rules={rules} direction="out" />;
                      } else if (day.isDescriptionOnly) {
                        // This is a description-only day, keep dashes
                        clockInDisplay = <span className="text-sm text-gray-400">-</span>;
                        clockOutDisplay = <span className="text-sm text-gray-400">-</span>;
                      }

                      // Prepare Description Display
                      let descriptionDisplay = null;

                      // Consolidate descriptions for the day (User request: "per day 1 description")
                      let unifiedDesc = undefined;
                      if (pairs && pairs.length > 0) {
                        const found = pairs.find(p => typeof p.notes === 'string' || typeof p.description === 'string');
                        if (found) {
                          unifiedDesc = typeof found.notes === 'string' ? found.notes : found.description;
                        } else {
                          unifiedDesc = typeof pairs[0].notes === 'string' ? pairs[0].notes : (typeof pairs[0].description === 'string' ? pairs[0].description : undefined);
                        }
                      }
                      if (unifiedDesc === undefined && typeof day.notes === 'string') unifiedDesc = day.notes;

                      // Priority Rule:
                      // 1. Unified Description (User Input, allows empty string)
                      // 2. Absence Label (If day has approved absence)
                      // 3. "Working" (If regular hours exist)
                      // 4. "-" (Empty day)
                      const displayDesc = unifiedDesc !== undefined
                        ? (unifiedDesc === '' ? '-' : unifiedDesc)
                        : (day.hasAbsence ? day.absenceLabel : (pairs && pairs.length > 0 ? 'Working' : '-'));

                      const dayEditId = `day-${day.date}`;
                      const isEditing = editingDescriptionId === dayEditId;
                      // PERMISSION UPDATE: 
                      // 1. Managers can edit descriptions on ANY timesheet status (except maybe strictly locked ones, but generally yes).
                      // 2. Owners can edit descriptions on Draft, Pending, or Rejected timesheets.
                      const currentUserRole = currentUser?.role || currentUser?.primaryRole || '';
                      const managerRoles = ['sitemanager', 'teammanager', 'seniormanager', 'adminmanager', 'hrmanager', 'hradvisor', 'adminadvisor', 'superuser', 'superadmin'];
                      const roleNormalized = currentUserRole.toLowerCase().replace(/_/g, '').replace(/\s/g, '');
                      const isManager = managerRoles.includes(roleNormalized);
                      const statusRaw = timesheet?.status || timesheet?.raw?.status || '';
                      const statusLower = String(statusRaw).toLowerCase();

                      const dayStatusLower = (day.status || '').toLowerCase();
                      // Refined visibility rules for Add description button
                      let canModify = false;

                      // For senior managers viewing other users: always allow
                      if (!isOwnTimesheet && isManager) {
                        canModify = true;
                      }
                      // For own timesheet: only allow if Draft or Rejected (not Approved or Pending)
                      else if (isOwnTimesheet) {
                        canModify = ['draft', 'rejected'].includes(statusLower);
                      }
                      // For others viewing other users: only allow if Draft or Rejected
                      else {
                        canModify = ['draft', 'rejected'].includes(statusLower);
                      }

                      if (isEditing || savingDescriptionId === dayEditId) {
                        const isSavingThis = savingDescriptionId === dayEditId;
                        const isClearing = !tempDescription || tempDescription.trim() === '';
                        descriptionDisplay = (
                          <div className="flex items-center gap-1 min-w-[140px]">
                            <input
                              autoFocus={!isSavingThis}
                              disabled={isSavingThis}
                              className={`bg-white border text-sm rounded px-2 py-1 w-full focus:outline-none focus:border-blue-500 ${isSavingThis ? 'opacity-50' : ''}`}
                              value={tempDescription}
                              onChange={e => setTempDescription(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' && !isSavingThis) handleSaveDayDescription(day, tempDescription);
                                if (e.key === 'Escape' && !isSavingThis) setEditingDescriptionId(null);
                              }}
                              onClick={e => e.stopPropagation()}
                            />
                            {isSavingThis ? (
                              <div className="flex items-center gap-1 px-1 min-w-[48px] justify-center">
                                <div className={`animate-spin rounded-full h-4 w-4 border-b-2 ${isClearing ? 'border-red-600' : 'border-green-600'}`}></div>
                              </div>
                            ) : (
                              <>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleSaveDayDescription(day, tempDescription); }}
                                  className="text-green-600 hover:text-green-700 p-1"
                                  title="Save changes"
                                >
                                  <CheckCircle className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleSaveDayDescription(day, ''); }}
                                  className="text-red-500 hover:text-red-700 p-1"
                                  title="Delete/Clear description"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </div>
                        );
                      } else {
                        descriptionDisplay = (
                          <div className="flex items-center gap-2 group h-full min-h-[1.75rem]">
                            <span className={`text-sm whitespace-nowrap block truncate max-w-[200px] ${!unifiedDesc && !day.hasAbsence ? 'text-gray-400 italic' : 'text-gray-700'}`} title={displayDesc}>
                              {displayDesc}
                            </span>
                            {(() => {
                              const now = new Date();
                              const todayIso = now.toISOString().split('T')[0];
                              const isFutureRow = day.date > todayIso;

                              return canModify && (
                                // In the description display section, update the edit button click handler:
                                <button
                                  onClick={(e) => {
                                    if (isFutureRow) return;
                                    e.stopPropagation();
                                    setEditingDescriptionId(dayEditId);
                                    // Get the current description value properly
                                    let currentDesc = '';

                                    // Try to get from unifiedDesc first
                                    if (unifiedDesc !== undefined && unifiedDesc !== null) {
                                      currentDesc = unifiedDesc;
                                    }
                                    // Fallback to displayDesc if it's not a placeholder
                                    else if (displayDesc !== '-' && displayDesc !== 'Working' && !day.hasAbsence) {
                                      currentDesc = displayDesc;
                                    }

                                    setTempDescription(currentDesc);
                                  }}
                                  disabled={isFutureRow}
                                  className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${isFutureRow ? 'text-gray-500 bg-gray-100 cursor-not-allowed' :
                                    !unifiedDesc ? 'text-blue-600 bg-blue-50 hover:bg-blue-100' :
                                      'text-gray-400 opacity-0 group-hover:opacity-100 hover:text-blue-600 hover:bg-gray-50'
                                    }`}
                                  title={isFutureRow ? "Cannot add description for future date" : (!unifiedDesc ? "Add Description" : "Edit Description")}
                                >
                                  {!unifiedDesc ? <Plus className="w-3.5 h-3.5" /> : <Edit2 className="w-3.5 h-3.5" />}
                                </button>
                              );
                            })()}
                          </div>
                        );
                      }

                      return (
                        <TableRow key={idx} className={
                          day.hasAbsence && pairs.length > 0 ? 'bg-orange-50/30 hover:bg-orange-100/30' : // Worked on leave day
                            day.isManual ? 'bg-blue-50/30 hover:bg-blue-100/30' : 'hover:bg-gray-50/50'
                        }>
                          <TableCell className="align-top">
                            <div className="flex flex-col gap-1">
                              <span className="text-sm text-gray-700 font-semibold">{formatDateISO(day.date)}</span>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {day.isManual && (
                                  <Badge variant="info" className="text-[10px] px-1.5 py-0.5 leading-tight">
                                    Manual
                                  </Badge>
                                )}
                                {day.hasAbsence && pairs.length > 0 && (
                                  <Badge variant="warning" className="text-[10px] px-1.5 py-0.5 leading-tight">
                                    On Leave
                                  </Badge>
                                )}
                              </div>

                              {/* Display Description/Activity Type in the table */}
                              {pairs.length > 0 && pairs.some(p => p.description || p.activityType || p.workOrder) && (
                                <div className="mt-1 flex flex-col gap-0.5">
                                  {/* Deduplicate descriptions to avoid clutter */}
                                  {[...new Set(pairs.map(p => {
                                    // Format: "Activity - Description" or just "Activity" or "Description"
                                    const parts = [];
                                    if (p.activityType) parts.push(p.activityType);
                                    if (p.description) parts.push(p.description);
                                    if (!p.activityType && !p.description && p.workOrder) parts.push(`WO: ${p.workOrder}`);
                                    return parts.join(' - ');
                                  }).filter(Boolean))].map((desc, i) => (
                                    <span key={i} className="text-xs text-gray-500 font-medium leading-tight">
                                      {desc}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="align-top">
                            <span className="text-sm text-gray-700 font-semibold">{day.day}</span>
                          </TableCell>
                          <TableCell className="align-top min-w-max">
                            {clockInDisplay}
                          </TableCell>
                          <TableCell className="align-top min-w-max">
                            {clockOutDisplay}
                          </TableCell>
                          <TableCell className="align-top">
                            {descriptionDisplay}
                          </TableCell>
                          <TableCell className="align-top text-center">
                            <span className="text-sm font-medium text-red-600">{day.breakHours}</span>
                          </TableCell>
                          <TableCell className="align-top text-center">
                            <span className="text-sm font-medium text-blue-600">{day.normalHours || '0h 00m'}</span>
                          </TableCell>
                          <TableCell className="align-top text-center">
                            <span className="text-sm font-medium text-orange-600">{day.overtime}</span>
                          </TableCell>
                          <TableCell className="align-top text-center">
                            <span className="text-sm font-bold text-gray-900">{day.totalHours}</span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
            <p className="text-xs py-4 text-text-secondary text-center md:hidden">
              ← Scroll horizontally to view all columns →
            </p>
          </div>

          {/* Manual Entry Legend - Only show if there are manual entries */}
          {dailyRows.some(day => day.isManual) && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-3 mt-4">
              <AlertCircle className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-blue-900">Manual Entries</p>
                <p className="text-xs text-blue-800">
                  Entries marked as "Manual" were added manually and did not come from automatic clock-in/out sessions.
                  Automatic lunch deductions still apply based on company settings.
                </p>
              </div>
            </div>
          )}

          {/* Absence Legend - Only show if there are absence days */}
          {dailyRows.some(day => day.hasAbsence) && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-start gap-3 mt-4">
              <AlertCircle className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-green-900">Approved Absences</p>
                <p className="text-xs text-green-800">
                  Days showing leave types (e.g., "Annual Leave", "Sick Leave") indicate approved absences.
                  Hours shown reflect scheduled work hours for these days.
                  {dailyRows.some(day => day.hasAbsence && (day.clockInOutPairs?.length || 0) > 0) && (
                    <span className="block mt-1 text-orange-700 font-medium">
                      ⚠️ Days marked "Worked on [Leave Type]" show ALL hours as overtime since employee worked on an approved leave day.
                    </span>
                  )}
                </p>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-gray-200">
            <div className="flex items-center gap-3">
              {/* Export to CSV button */}
              <Button
                variant="outline-secondary"
                icon={Download}
                onClick={handleExportToCSV}
                iconFirst={true}
                cn="h-12"
                disabled={isLoading || !weekData || dailyRows.length === 0}
              >
                Export to CSV
              </Button>

              {/* Download as PDF button - only for approved timesheets */}
              {timesheet?.status === 'Approved' || timesheet?.status === 'approved' ? (
                <Button
                  variant="outline-success"
                  icon={FileText}
                  onClick={handleDownloadPDF}
                  iconFirst={true}
                  cn="h-12"
                  disabled={isSubmitting || isLoading || !weekData || dailyRows.length === 0}
                >
                  {isSubmitting ? 'Generating...' : 'Download PDF'}
                </Button>
              ) : null}

              {/* Edit button - only when user has edit permission */}
              {!isOwnTimesheet && canEdit && (
                <Button
                  variant="outline-primary"
                  icon={Edit2}
                  onClick={handleEdit}
                  iconFirst={true}
                  cn="h-12"
                >
                  Edit
                </Button>
              )}

              {/* Edit button for owners when status is Draft or Rejected */}
              {isOwnTimesheet && (timesheet?.status === 'Draft' || timesheet?.status === 'draft' || timesheet?.status === 'Rejected' || timesheet?.status === 'rejected') && (
                <Button
                  variant="outline-primary"
                  icon={Edit2}
                  onClick={handleEdit}
                  iconFirst={true}
                  cn="h-12"
                >
                  Edit
                </Button>
              )}
            </div>

            <div className="flex items-center gap-3">
              {/* Submit for Approval button - using shared utility for consistency.
                  weekData is the single source of truth: if weekData.days already shows
                  today's clock-out then the button should appear. */}
              {isOwnTimesheet &&
                (() => {
                  const today = new Date();

                  // ✅ FIX: Check if there's actually an active clock-in session today
                  const todayIso = today.toISOString().split('T')[0];
                  const todayDayData = weekData?.days?.find(day => day.date === todayIso);
                  const todayPairs = todayDayData?.clockInOutPairs || [];

                  // Check if there's any open/active session today
                  const hasActiveSession = todayPairs.some(p => {
                    const co = p.clockOut;
                    return !co || co === '-' || co === null || co === undefined;
                  });

                  // Check if tracker is active (using ClockSessionContext)
                  const openSession = getOpenSession();
                  const isTrackerActive = !!openSession;

                  // Check if today is the last working day of the week
                  const effectiveWeekStartDay = contextWeekStartDay || DEFAULT_WEEK_START_DAY;
                  const weekRange = getWeekRangeForDate(today, effectiveWeekStartDay);
                  const isLastWorkingDay = weekRange.end &&
                    today.toDateString() === weekRange.end.toDateString();

                  // Hide submit button if tracker is active AND today is last working day of week
                  if (isTrackerActive && isLastWorkingDay) {
                    return false;
                  }

                  return shouldShowSubmitButton(timesheet, companySettings, absencesMap || ownTimesheetAbsences, {
                    weekData,
                    checkTodayCompletion: true,
                    isCurrentlyActive: hasActiveSession // ✅ FIX: Use actual active session status
                  });
                })() && (
                  <Button
                    variant="solid-success"
                    icon={CheckCircle}
                    onClick={handleApprove}
                    disabled={isSubmitting}
                    iconFirst={true}
                    cn="h-12"
                  >
                    {isSubmitting ? 'Submitting...' : 'Submit for Approval'}
                  </Button>
                )}

              {/* Manager approval/decline buttons */}
              {!isOwnTimesheet && timesheet?.status === 'Pending' && (
                <>
                  <Button
                    variant="outline-danger"
                    icon={isSubmitting ? null : XCircle}
                    onClick={handleDecline}
                    disabled={isSubmitting}
                    iconFirst={true}
                    cn="h-12"
                  >
                    {isSubmitting ? (
                      <div className="flex items-center gap-2">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-600"></div>
                        Declining...
                      </div>
                    ) : 'Decline'}
                  </Button>
                  <Button
                    variant="solid-success"
                    icon={isSubmitting ? null : CheckCircle}
                    onClick={handleApprove}
                    disabled={isSubmitting}
                    iconFirst={true}
                    cn="h-12"
                  >
                    {isSubmitting ? (
                      <div className="flex items-center gap-2">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        Approving...
                      </div>
                    ) : 'Approve'}
                  </Button>
                </>
              )}

              {/* Show status after approval/decline */}
              {!isOwnTimesheet && (timesheet?.status === 'Approved' || timesheet?.status === 'Rejected') && (
                <div className="flex items-center gap-2 text-sm">
                  {timesheet?.status === 'Approved' ? (
                    <>
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span className="text-green-600 font-medium">Timesheet Approved</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-red-600" />
                      <span className="text-red-600 font-medium">Timesheet Declined</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Duplicate Warning Dialog */}
          {showDuplicateConfirm && duplicateWarning && (
            <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowDuplicateConfirm(false)}></div>

              <div className="relative w-full max-w-md bg-white rounded-lg shadow-lg p-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                      <AlertTriangle className="h-5 w-5 text-orange-600" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">Duplicate Entries Detected</h3>
                      <p className="text-sm text-gray-600">Multiple timesheet entries found for this week</p>
                    </div>
                  </div>

                  <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                    <p className="text-sm text-orange-800 mb-2">
                      Found {duplicateWarning.duplicateGroups.length} duplicate groups with {duplicateWarning.totalDocs} total documents.
                    </p>
                    <ul className="text-xs text-orange-700 space-y-1">
                      {duplicateWarning.duplicateGroups.map((group, index) => (
                        <li key={index}>
                          • {group.date}: {group.count} entries
                        </li>
                      ))}
                    </ul>
                  </div>

                  <p className="text-sm text-gray-600">
                    We'll automatically consolidate these entries using the most recent data before submitting. This action cannot be undone.
                  </p>

                  <div className="flex gap-3 justify-end">
                    <Button
                      variant="outline-secondary"
                      onClick={() => {
                        setShowDuplicateConfirm(false);
                        setDuplicateWarning(null);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="solid-primary"
                      onClick={async () => {
                        setShowDuplicateConfirm(false);
                        setDuplicateWarning(null);
                        // Continue with submission - duplicates will be handled in handleApprove
                        await handleApprove();
                      }}
                    >
                      Continue & Consolidate
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div >
  );
};

export default ViewTimesheetModal; 