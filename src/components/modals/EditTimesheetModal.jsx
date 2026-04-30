import { collection, getDocs, query, where } from 'firebase/firestore';
import { AlertTriangle, Clock, History, Loader2, Save, User, X } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { toast } from 'react-toastify';
import { detectAndConvertToLocal } from '../../utils/timeDisplayUtils';
import { db } from '../../firebase/client';
import { useAuth } from '../../hooks/useAuth';
import { fetchEditHistory, storeEditHistory } from '../../services/timesheetEditHistory';
import { fetchWeekDetails, formatISODate, getUserWeekContext, getWeekRange, deleteTimeEntry } from '../../services/timesheets';
import timesheetUpdateManager from '../../services/TimesheetUpdateManager';
import { DEFAULT_WEEK_START_DAY, formatWeeklyRange, getOrderedWeekDays } from '../../utils/weekStartUtils';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { generateEntryId } from '../../utils/idUtils';
import { createTimesheetEntry } from '../../utils/entryFactory'; // [FIX #4] Unified entry factory
import { getSites } from '../../services/sites';
import { resolveRoundingRules } from '../../services/roundingRules';
import { roundSessionRange } from '../../utils/timeRounding';

// FORMAT HELPERS MOVED OUT FOR SYNC INITIALIZATION
const zeroPad = (value) => String(value).padStart(2, '0');

const toTimeInputValue = (value) => {
  if (!value) return '';

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${zeroPad(value.getHours())}:${zeroPad(value.getMinutes())}`;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';

    const ampmMatch = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
    if (ampmMatch) {
      let hours = parseInt(ampmMatch[1], 10);
      const minutes = parseInt(ampmMatch[2] ?? '0', 10);
      const meridiem = ampmMatch[3].toLowerCase();
      if (meridiem === 'pm' && hours < 12) hours += 12;
      if (meridiem === 'am' && hours === 12) hours = 0;
      return `${zeroPad(hours)}:${zeroPad(minutes)}`;
    }

    const colonMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (colonMatch) {
      const hours = parseInt(colonMatch[1], 10);
      const minutes = parseInt(colonMatch[2], 10);
      return `${zeroPad(hours)}:${zeroPad(minutes)}`;
    }

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return `${zeroPad(parsed.getHours())}:${zeroPad(parsed.getMinutes())}`;
    }
  }

  return '';
};

const computeBreakMinutesFromEntry = (entry) => {
  if (!entry) return 0;

  if (Number.isFinite(entry.breakMin)) return Number(entry.breakMin);
  if (Number.isFinite(entry.breakMinutes)) return Number(entry.breakMinutes);

  const manual = Number.isFinite(entry.manualBreakSec) ? entry.manualBreakSec : 0;
  const auto = Number.isFinite(entry.autoLunchBreakSec) ? entry.autoLunchBreakSec : 0;
  const breakSecCandidate = Number.isFinite(entry.breakSec) ? entry.breakSec : manual + auto;

  if (Number.isFinite(breakSecCandidate) && breakSecCandidate > 0) {
    return Math.round(breakSecCandidate / 60);
  }

  const gross = Number(entry.grossSec);
  const effective = Number(entry.effectiveSec);
  if (Number.isFinite(gross) && Number.isFinite(effective) && gross > effective) {
    return Math.round((gross - effective) / 60);
  }

  return 0;
};

const EditTimesheetModal = ({ isOpen, onClose, onSave, timesheet }) => {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const [validationErrors, setValidationErrors] = useState({});
  const [retryCount, setRetryCount] = useState(0);
  const [showRetry, setShowRetry] = useState(false);
  const [editHistory, setEditHistory] = useState([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [originalDailyData, setOriginalDailyData] = useState({}); // Store original values for comparison
  const [schedule, setSchedule] = useState({});
  const { weekStartDay: contextWeekStartDay, user } = useAuth();
  const [roundingRules, setRoundingRules] = useState(null);
  // Editing should always respect the company-configured week start day.
  const effectiveWeekStartDay = contextWeekStartDay || DEFAULT_WEEK_START_DAY;

  // ROLE CHECK: Manager can edit all fields, Owner can only edit Description/Manual Entries
  const isManager = ['site_manager', 'manager', 'admin', 'super_admin'].includes(user?.role);

  const [targetWeekStartDay, setTargetWeekStartDay] = useState(null);
  const resolvedWeekStartDay = targetWeekStartDay || effectiveWeekStartDay;

  // SYNCHRONOUS INITIALIZATION from Props to prevent UI "flip"
  const initialData = useMemo(() => {
    if (!timesheet) return { range: { start: null, end: null }, totals: { grossSec: 0, effectiveSec: 0, overtimeSec: 0 }, dts: [], dd: {} };

    const rawData = timesheet.raw || timesheet;
    const sDate = rawData.start ? new Date(rawData.start) : (timesheet.weekStartDate ? new Date(timesheet.weekStartDate) : null);
    if (!sDate) return { range: { start: null, end: null }, totals: { grossSec: 0, effectiveSec: 0, overtimeSec: 0 }, dts: [], dd: {} };

    const { start: wStart } = getWeekRange(sDate, resolvedWeekStartDay);
    const dayDates = [];
    const dayNamesList = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    for (let i = 0; i < 7; i++) {
      const d = new Date(wStart); d.setDate(wStart.getDate() + i);
      const iso = formatISODate(d);
      dayDates.push({ day: dayNamesList[d.getDay()], date: iso });
    }

    const dd = {};
    dayNamesList.forEach(name => { dd[name] = []; });

    const entries = rawData?.entries || [];
    entries.forEach(e => {
      const isoDate = e.date || e.isoDate || e.day?.date || e.period;
      if (!isoDate) return;
      const d = new Date(isoDate);
      const name = dayNamesList[d.getDay()];
      if (!dd[name]) return;

      let clockInValue = toTimeInputValue(e.rawStart || e.rawClockIn || e.roundedStart || e.clockIn || e.roundedClockIn);
      let clockOutValue = toTimeInputValue(e.rawEnd || e.rawClockOut || e.roundedEnd || e.clockOut || e.roundedClockOut);

      clockInValue = detectAndConvertToLocal(clockInValue, e.rawStart || e.roundedStart);
      clockOutValue = detectAndConvertToLocal(clockOutValue, e.rawEnd || e.roundedEnd);
      const breakMinutes = computeBreakMinutesFromEntry(e);

      dd[name].push({
        id: e.id || generateEntryId(),
        clockIn: clockInValue,
        clockOut: clockOutValue,
        breakMin: String(Math.max(0, Number.isFinite(breakMinutes) ? breakMinutes : 0)),
        description: e.notes || e.description || '',
        sessionIds: e.sessionIds || (e.id && !e.id.startsWith('manual_') && !e.id.startsWith('entry_') ? [e.id] : []),
        sessionKey: e.sessionKey || (e.id && !e.id.startsWith('manual_') && !e.id.startsWith('entry_') ? e.id : null),
        computedGrossSec: Number(e.grossSec || 0),
        computedEffectiveSec: Number(e.effectiveSec || 0),
        computedOvertimeSec: Number(e.overtimeSec || 0),
        isManual: Boolean(e.isManual || (e.id && e.id.toString().startsWith('manual_')))
      });
    });

    return {
      range: { start: formatISODate(wStart), end: formatISODate(new Date(new Date(wStart).setDate(wStart.getDate() + 6))) },
      totals: {
        grossSec: Number(rawData.totals?.grossSec) || 0,
        effectiveSec: Number(rawData.totals?.effectiveSec) || 0,
        overtimeSec: Number(rawData.totals?.overtimeSec) || 0
      },
      dts: dayDates,
      dd
    };
  }, [timesheet, resolvedWeekStartDay]);

  const [periodRange, setPeriodRange] = useState(initialData.range);
  const [weekTotals, setWeekTotals] = useState(initialData.totals);
  const [weekDays, setWeekDays] = useState(initialData.dts);
  const [selectedDay, setSelectedDay] = useState(initialData.dts[0]?.day || 'Monday');
  const [dailyData, setDailyData] = useState(initialData.dd);

  // Update synchronous state if props change (handles subsequent opens)
  useEffect(() => {
    if (isOpen && initialData.dts.length > 0) {
      setPeriodRange(initialData.range);
      setWeekTotals(initialData.totals);
      setWeekDays(initialData.dts);
      setDailyData(initialData.dd);
      if (!selectedDay || !initialData.dts.some(d => d.day === selectedDay)) {
        setSelectedDay(initialData.dts[0].day);
      }
    }
  }, [isOpen, initialData]);

  // REAL-TIME VALIDATION EFFECT: Detect overlaps and block save
  const [overlapDetected, setOverlapDetected] = useState(false);

  useEffect(() => {
    let foundOverlap = false;

    // Helper: Convert HH:MM to comparable number
    const getT = (timeStr) => {
      if (!timeStr || !timeStr.includes(':')) return 0;
      const [h, m] = timeStr.split(':').map(Number);
      return (h * 60) + m;
    };

    setValidationErrors(prev => {
      const newErrors = { ...prev };
      let changed = false;

      // 1. CLEAR existing overlap markers from all sessions
      Object.keys(newErrors).forEach(id => {
        if (newErrors[id]?.clockOut === 'Overlaps with next session' ||
          newErrors[id]?.clockIn === 'Overlaps with previous session') {
          const sErr = { ...newErrors[id] };
          delete sErr.clockOut;
          delete sErr.clockIn;
          if (Object.keys(sErr).length === 0) delete newErrors[id];
          else newErrors[id] = sErr;
          changed = true;
        }
      });

      // 2. ADD current overlap markers
      Object.keys(dailyData).forEach(day => {
        const sessions = dailyData[day] || [];
        const validSessions = sessions.filter(s => s.clockIn && s.clockOut && !s.isDeleted);
        if (validSessions.length < 2) return;

        const sorted = [...validSessions].map(s => ({
          id: s.id,
          start: getT(s.clockIn),
          end: getT(s.clockOut)
        })).sort((a, b) => a.start - b.start);

        for (let i = 0; i < sorted.length - 1; i++) {
          const current = sorted[i];
          const next = sorted[i + 1];
          if (current.end > next.start) {
            foundOverlap = true;
            newErrors[current.id] = { ...newErrors[current.id], clockOut: 'Overlaps with next session' };
            newErrors[next.id] = { ...newErrors[next.id], clockIn: 'Overlaps with previous session' };
            changed = true;
          }
        }
      });

      if (foundOverlap !== overlapDetected) setOverlapDetected(foundOverlap);
      return changed ? newErrors : prev;
    });
  }, [dailyData, overlapDetected]);

  const [sites, setSites] = useState([]);
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [deletedSessions, setDeletedSessions] = useState(new Map()); // Track deleted sessions -> dateStr

  // Format date in UK format (DD-MM-YYYY)
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


  const formatPeriodLabel = (startIso, endIso) => formatWeeklyRange(startIso, endIso);

  const normalizeStatus = (status) => {
    if (!status) return 'draft';
    return String(status).toLowerCase();
  };

  const getStatusVariant = (status) => {
    switch (status) {
      case 'approved':
        return 'success';
      case 'pending':
        return 'warning';
      case 'rejected':
        return 'danger';
      case 'submitted':
        return 'info';
      default:
        return 'info';
    }
  };

  const formatStatusLabel = (status) => {
    if (!status) return 'Draft';
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  // Track the last loaded timesheet identity to prevent re-initialization loops
  const lastLoadedIdentity = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      lastLoadedIdentity.current = null;
      return;
    }

    if (!timesheet || !resolvedWeekStartDay) return;

    // Helper to derive identity
    const deriveIdentity = () => {
      const raw = timesheet?.raw || timesheet;
      const startDate = raw?.start ? new Date(raw.start) : (timesheet?.weekStart ? new Date(timesheet.weekStart) : null);
      if (!startDate) return null;
      const userId = raw?.userId || timesheet?.userId || timesheet?.uid || timesheet?.user?.uid || null;
      const weekStartStr = formatISODate(startDate); // This might be approximate before exact calc

      // identity includes parameters that should trigger a reload
      return `${userId}_${weekStartStr}_${resolvedWeekStartDay}_${targetWeekStartDay}_${effectiveWeekStartDay}`;
    };

    const currentIdentity = deriveIdentity();
    if (!currentIdentity) return;

    // If we have already loaded this exact timesheet context, DO NOT re-initialize.
    if (lastLoadedIdentity.current === currentIdentity) {
      return;
    }

    // Mark as loaded
    lastLoadedIdentity.current = currentIdentity;
    console.log('EditTimesheetModal - Initializing for:', currentIdentity);

    (async () => {
      const raw = timesheet?.raw || timesheet;
      const startDate = raw?.start ? new Date(raw.start) : (timesheet?.weekStart ? new Date(timesheet.weekStart) : null);
      if (!startDate) return;
      const userId = raw?.userId || timesheet?.userId || timesheet?.uid || timesheet?.user?.uid || null;

      if (raw?.totals) {
        setWeekTotals({
          grossSec: Number(raw.totals.grossSec) || 0,
          effectiveSec: Number(raw.totals.effectiveSec) || 0,
          overtimeSec: Number(raw.totals.overtimeSec) || 0
        });
      }

      let weekStartDayToUse = resolvedWeekStartDay;
      if (userId) {
        try {
          const userWeekContext = await getUserWeekContext(userId, { forceRefresh: true }); // Always force refresh
          if (userWeekContext?.weekStartDay) {
            weekStartDayToUse = userWeekContext.weekStartDay;
            if (userWeekContext.weekStartDay !== targetWeekStartDay) {
              setTargetWeekStartDay(userWeekContext.weekStartDay);
            }
          }

          // Fetch rounding rules and schedule
          if (userWeekContext?.companyIdPath) {
            const rules = await resolveRoundingRules(userWeekContext.companyIdPath);
            setRoundingRules(rules);

            // Fetch company schedule
            const compKey = userWeekContext.companyIdPath.includes('/') ? userWeekContext.companyIdPath.split('/')[1] : userWeekContext.companyIdPath;
            const compSnap = await getDoc(doc(db, 'companies', compKey));
            if (compSnap.exists()) {
              setSchedule(compSnap.data().workSchedule || {});
            }
          }
        } catch (error) {
          console.warn('[EditTimesheetModal] Failed to resolve user week start day, falling back to viewer preference', error);
        }
      }

      const { start } = getWeekRange(startDate, weekStartDayToUse);
      const days = [];
      const dd = {};
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      for (let i = 0; i < 7; i++) {
        const d = new Date(start); d.setDate(start.getDate() + i);
        const iso = formatISODate(d);
        const name = dayNames[d.getDay()];
        days.push({ day: name, date: iso });
        dd[name] = [];
      }
      // Try to fetch fresh data from database to get latest notes
      let entries = raw?.entries || [];
      let freshData = null;

      if (userId && startDate) {
        try {
          const weekStartStr = formatISODate(start);
          console.log('[EditTimesheetModal] Fetching fresh week details for:', userId, weekStartStr);

          // ALWAYS fetch fresh data - clear cache first to bypass cache
          try {
            const { invalidateTimesheetCache } = await import('../../services/timesheets');
            invalidateTimesheetCache(userId, weekStartStr);
            console.log('[EditTimesheetModal] Cleared cache before fetching fresh data');
          } catch (cacheError) {
            console.warn('[EditTimesheetModal] Failed to clear cache (continuing anyway):', cacheError);
          }

          freshData = await fetchWeekDetails(userId, weekStartStr, {
            weekStartDay: weekStartDayToUse
          });

          if (freshData?.entries && Array.isArray(freshData.entries) && freshData.entries.length > 0) {
            // Extract entries from fresh data
            const freshEntries = [];
            for (const entry of freshData.entries) {
              if (entry.entries && Array.isArray(entry.entries)) {
                // Nested entries structure
                freshEntries.push(...entry.entries);
              } else if (entry.date) {
                // Direct entry
                freshEntries.push(entry);
              }
            }
            if (freshEntries.length > 0) {
              console.log('[EditTimesheetModal] Using fresh entries with notes:', freshEntries.map(e => ({
                date: e.date,
                notes: e.notes || e.description || null
              })));
              entries = freshEntries;
            }
          }
        } catch (error) {
          console.warn('[EditTimesheetModal] Failed to fetch fresh data, using timesheet prop:', error);
        }
      }

      console.log('[EditTimesheetModal] Loading entries with notes:', entries.map(e => ({
        date: e.date,
        notes: e.notes || e.description || null
      })));

      const seenSessionIds = new Set();
      const seenRealSessionKeys = new Set(); // [FIX] Track underlying session keys to prevent duplicates (e.g. entry_ID vs real_ID)

      for (const e of entries) {
        try {
          const isoDate = e.date || e.isoDate || e.day?.date || e.period;
          if (!isoDate) continue;
          const d = new Date(isoDate);
          const name = dayNames[d.getDay()];
          if (!dd[name]) continue;

          // Extract clock in/out from various possible fields
          // Priority: rawStart/rawEnd (Exact) > rawClockIn/rawClockOut > clockIn/clockOut (Rounded Strings)
          // [FIX] Priority inversion: Always prefer raw times (e.g., 3:11) over rounded strings (e.g., 3:00)
          let clockInValue = '';
          let clockOutValue = '';

          // 1. Try Raw Sources First
          if (e.rawStart) {
            const rawStartDate = e.rawStart instanceof Date ? e.rawStart : new Date(e.rawStart);
            if (!isNaN(rawStartDate.getTime())) {
              clockInValue = toTimeInputValue(rawStartDate);
            }
          }
          if (!clockInValue && e.rawClockIn) {
            clockInValue = toTimeInputValue(e.rawClockIn);
          }

          // 2. Fallback to Standard/Rounded Sources
          if (!clockInValue && e.roundedStart) {
            const roundedStartDate = e.roundedStart instanceof Date ? e.roundedStart : new Date(e.roundedStart);
            if (!isNaN(roundedStartDate.getTime())) {
              clockInValue = toTimeInputValue(roundedStartDate);
            }
          } else if (!clockInValue && e.clockIn) {
            clockInValue = toTimeInputValue(e.clockIn);
          }

          // 1. Try Raw End Sources
          if (e.rawEnd) {
            const rawEndDate = e.rawEnd instanceof Date ? e.rawEnd : new Date(e.rawEnd);
            if (!isNaN(rawEndDate.getTime())) {
              clockOutValue = toTimeInputValue(rawEndDate);
            }
          }
          if (!clockOutValue && e.rawClockOut) {
            clockOutValue = toTimeInputValue(e.rawClockOut);
          }

          // 2. Fallback to Standard/Rounded End Sources
          if (!clockOutValue && e.roundedEnd) {
            const roundedEndDate = e.roundedEnd instanceof Date ? e.roundedEnd : new Date(e.roundedEnd);
            if (!isNaN(roundedEndDate.getTime())) {
              clockOutValue = toTimeInputValue(roundedEndDate);
            }
          } else if (!clockOutValue && e.clockOut) {
            clockOutValue = toTimeInputValue(e.clockOut);
          }

          // Final Fallback for backward compatibility
          if (!clockInValue) {
            clockInValue = toTimeInputValue(e.roundedClockIn);
          }
          if (!clockOutValue) {
            clockOutValue = toTimeInputValue(e.roundedClockOut);
          }


          clockInValue = detectAndConvertToLocal(clockInValue, e.rawStart || e.roundedStart || (e.startedAt?.toDate?.()));
          clockOutValue = detectAndConvertToLocal(clockOutValue, e.rawEnd || e.roundedEnd || (e.endedAt?.toDate?.()));
          const breakMinutes = computeBreakMinutesFromEntry(e);
          const existingBreak = parseFloat(dd[name].breakMin) || 0;
          const computedGrossSec = Number(e.grossSec ?? e.rawDurationSec ?? e.roundedGrossSec) || 0;
          const computedEffectiveSec = Number(e.effectiveSec ?? e.rawEffectiveSec ?? e.roundedEffectiveSec) || 0;
          const computedOvertimeSec = Number(e.overtimeSec ?? e.roundedOvertimeSec) || 0;

          // Load notes - prioritize saved notes from entry
          const savedNotes = e.notes || e.description || null;
          if (savedNotes) {
            console.log('[EditTimesheetModal] Loading notes for', isoDate, name, ':', savedNotes);
          }

          // Preserve existing description if we already have notes loaded
          const existingDescription = dd[name].description || '';
          const finalDescription = savedNotes || existingDescription;

          let sessionId = e.id || generateEntryId();

          // CRITICAL: Detect and fixing malformed IDs that look like Timesheet IDs (User_Date)
          // This prevents "No document to update" errors when saving
          // [FIX] Removed destructive ID regeneration that caused "Time entry not found" errors
          /*
          const isTimesheetId = sessionId.includes('_') &&
            /\d{4}-\d{2}-\d{2}$/.test(sessionId) &&
            !sessionId.startsWith('entry_') &&
            !sessionId.startsWith('manual_');

          if (isTimesheetId) {
            console.warn('[EditTimesheetModal] Detected malformed session ID (is likely Timesheet ID). Regenerating to prevent update failure:', sessionId);
            sessionId = generateEntryId();
          }
          */

          // [FIX] Deduplicate based on underlying Session Key as well
          const realSessionKey = e.sessionKey || e.sessionId;
          if (realSessionKey) {
            if (seenRealSessionKeys.has(realSessionKey)) {
              console.warn('[EditTimesheetModal] Found duplicate underlying session, skipping:', realSessionKey);
              continue;
            }
            seenRealSessionKeys.add(realSessionKey);
          }

          // CRITICAL: Deduplicate IDs to prevent React key warnings
          if (seenSessionIds.has(sessionId)) {
            console.warn('[EditTimesheetModal] Found duplicate session ID, treating as new entry:', sessionId);
            sessionId = `${sessionId}_dup_${Math.random().toString(36).substr(2, 5)}`;
          }
          seenSessionIds.add(sessionId);

          // dd[name] is now an array
          dd[name].push({
            id: sessionId,
            clockIn: clockInValue,
            clockOut: clockOutValue,
            breakMin: String(Math.max(0, Number.isFinite(breakMinutes) ? breakMinutes : 0)), // Don't inherit existing break if pushing new
            description: finalDescription,
            // CRITICAL: Preserve Lineage for De-Duplication and Write-Through
            // If sessionIds exists, use it. If not, and it's NOT a manual entry (starts with sess_), assume it IS the raw session.
            sessionIds: e.sessionIds || (e.id && !e.id.startsWith('manual_') && !e.id.startsWith('entry_') ? [e.id] : []),
            sessionKey: e.sessionKey || (e.id && !e.id.startsWith('manual_') && !e.id.startsWith('entry_') ? e.id : null),
            // Preserve raw start for better fuzzy matching in UI if needed
            rawStart: e.rawStart || e.clockIn || clockInValue,
            computedGrossSec,
            computedEffectiveSec,
            computedOvertimeSec,
            // Keep track of original values for drift detection
            original: { clockIn: clockInValue, clockOut: clockOutValue, breakMin: breakMinutes },
            // MANUAL ENTRY FLAG: Determine if this is a manual entry or automatic
            // If it has 'isManual' from DB, trust it. Or if ID starts with manual_.
            // Otherwise, it is an automatic entry (default false).
            isManual: Boolean(e.isManual || (e.id && e.id.toString().startsWith('manual_')))
          });

          console.log('[EditTimesheetModal] Set description for', name, 'to:', finalDescription);
        } catch (err) {
          console.warn('[EditTimesheetModal] Error processing entry:', err, e);
        }
      }

      // Prefill clock-in/out from timeClockSessions within the week
      try {
        const userId = raw?.userId || timesheet?.userId || timesheet?.uid || timesheet?.user?.uid;
        if (userId) {
          console.log('userId1234:', userId);
          const sessQ = query(collection(db, 'timeClockSessions'), where('userId', '==', userId), where('status', '==', 'closed'));
          const sessSnap = await getDocs(sessQ);
          const sessions = sessSnap.docs.map(d => d.data());
          const isoSet = new Set(days.map(d => d.date));
          const toHM = (date) => `${zeroPad(date.getHours())}:${zeroPad(date.getMinutes())}`;
          const byIso = new Map();
          for (const s of sessions) {
            const st = s.startedAt?.toDate?.();
            const et = s.endedAt?.toDate?.();
            if (!st) continue;
            const iso = st.toISOString().slice(0, 10);
            if (!isoSet.has(iso)) continue;
            const roundedStart = s.roundedStartedAt?.toDate?.() || st;
            const roundedEnd = s.roundedEndedAt?.toDate?.() || et;

            // Initialize or get accumulator
            const cur = byIso.get(iso) || {
              firstIn: null,
              lastOut: null,
              roundedFirstIn: null,
              roundedLastOut: null,
              breakSec: 0,
              sessionIds: [],   // Collect all IDs
              primaryId: null   // Track the main ID (first one found) 
            };

            if (!cur.firstIn || st < cur.firstIn) cur.firstIn = st;
            if (roundedStart && (!cur.roundedFirstIn || roundedStart < cur.roundedFirstIn)) cur.roundedFirstIn = roundedStart;
            if (et && (!cur.lastOut || et > cur.lastOut)) cur.lastOut = et;
            if (roundedEnd && (!cur.roundedLastOut || roundedEnd > cur.roundedLastOut)) cur.roundedLastOut = roundedEnd;

            // Validate and collect IDs
            if (s.id) {
              cur.sessionIds.push(s.id);
              // Prioritize non-temp IDs as primary
              if (!cur.primaryId && !s.id.startsWith('manual_') && !s.id.startsWith('entry_')) {
                cur.primaryId = s.id;
              } else if (!cur.primaryId) {
                cur.primaryId = s.id;
              }
            }

            const manual = Number.isFinite(s.manualBreakSec) ? Math.max(0, s.manualBreakSec) : 0;
            const autoLunch = Number.isFinite(s.autoLunchBreakSec) ? Math.max(0, s.autoLunchBreakSec) : 0;
            const legacyBreak = Math.max(0, s.breakSec || 0);
            cur.breakSec += (manual || autoLunch) ? manual + autoLunch : legacyBreak;
            byIso.set(iso, cur);
          }
          for (const { day, date } of days) {
            const agg = byIso.get(date);
            if (agg) {
              // CRITICAL FIX: Only use session data if there's no saved timesheet entry data
              // Prioritize saved timesheet entry values (clockIn/clockOut) over session data
              // Sessions might have old values, but saved timesheet entries have the latest edited values
              const existingClockIn = dd[day]?.clockIn;
              const existingClockOut = dd[day]?.clockOut;

              // Only use session data if there's no saved clock in/out from timesheet entries
              const sessionClockIn = agg.roundedFirstIn ? toHM(agg.roundedFirstIn) : (agg.firstIn ? toHM(agg.firstIn) : null);
              const sessionClockOut = agg.roundedLastOut ? toHM(agg.roundedLastOut) : (agg.lastOut ? toHM(agg.lastOut) : null);

              // Only use session data if we don't have ANY entries for this day yet from the timesheet
              // This logic is slightly different now: if dd[day] is empty, populate from sessions.
              // If dd[day] has entries, we assume they are authoritative.
              if (dd[day].length === 0 && (agg.firstIn || agg.lastIn)) {
                // If we found a valid primary ID, use it. Otherwise, THEN we generate a temp ID.
                // This ensures existing sessions are UPDATED, not duplicate-created.
                const finalId = agg.primaryId || generateEntryId();

                if (sessionClockIn) {
                  dd[day].push({
                    id: finalId,
                    clockIn: sessionClockIn || '',
                    clockOut: sessionClockOut || '',
                    breakMin: String(Math.floor(agg.breakSec / 60)),
                    description: '',
                    computedGrossSec: 0,
                    computedEffectiveSec: 0,
                    computedOvertimeSec: 0,
                    // LINEAGE PRESERVATION:
                    sessionIds: agg.sessionIds || (agg.primaryId ? [agg.primaryId] : []),
                    sessionKey: agg.primaryId || null,
                    isManual: false // Time Clock sessions are always automatic
                  });
                }
              }
            }
          }
        }
      } catch (_) { }

      setWeekDays(days);
      setDailyData(dd);
      // Store original data for comparison when saving
      setOriginalDailyData(JSON.parse(JSON.stringify(dd)));

      if (days.length > 0) {
        setPeriodRange({
          start: days[0].date,
          end: days[days.length - 1].date
        });
      } else {
        setPeriodRange({ start: null, end: null });
      }
      setSelectedDay(days[0]?.day || 'Monday');

      // Load edit history for this timesheet
      if (userId && startDate) {
        const weekStartStr = formatISODate(start);
        loadEditHistory(userId, weekStartStr);
      }
    })();
  }, [isOpen, timesheet, resolvedWeekStartDay, targetWeekStartDay, effectiveWeekStartDay]);

  // Fetch Sites
  useEffect(() => {
    if (user?.companyId && isOpen) {
      getSites(user.companyId).then(setSites).catch(console.error);
    }
  }, [user?.companyId, isOpen]);

  // Set initial site selection
  useEffect(() => {
    if (timesheet?.siteId) {
      setSelectedSiteId(timesheet.siteId);
    } else if (sites.length > 0 && !selectedSiteId) {
      // Optional: Default to first site if none selected?
      // setSelectedSiteId(sites[0].id);
    }
  }, [timesheet, sites]);

  // Load edit history
  const loadEditHistory = async (userId, weekStart) => {
    try {
      setIsLoadingHistory(true);
      console.log('[EditTimesheetModal] Loading edit history for:', { userId, weekStart });

      // Normalize weekStart to ISO string format
      let weekStartStr = weekStart;
      if (weekStart instanceof Date) {
        weekStartStr = formatISODate(weekStart);
      } else if (typeof weekStart === 'string' && !weekStart.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const date = new Date(weekStart);
        if (!isNaN(date.getTime())) {
          weekStartStr = formatISODate(date);
        }
      }

      console.log('[EditTimesheetModal] Normalized weekStart:', weekStartStr);
      const history = await fetchEditHistory(userId, weekStartStr);
      console.log('[EditTimesheetModal] Loaded edit history:', history);
      setEditHistory(history || []);
    } catch (error) {
      console.error('[EditTimesheetModal] Error loading edit history:', error);
      setEditHistory([]);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const currentDaySessions = dailyData[selectedDay] || [];
  const periodLabel = formatPeriodLabel(periodRange?.start, periodRange?.end) || '—';
  const normalizedStatusValue = normalizeStatus(timesheet?.status ?? timesheet?.raw?.status);
  const statusVariant = getStatusVariant(normalizedStatusValue);
  const statusLabel = formatStatusLabel(normalizedStatusValue);

  function calculateDayTotals(clockIn, clockOut, breakMin) {
    if (!clockIn || !clockOut) {
      return { grossSec: 0, effectiveSec: 0, overtimeSec: 0 };
    }

    try {
      let clockInTime = new Date(`2000-01-01T${clockIn}:00`);
      let clockOutTime = new Date(`2000-01-01T${clockOut}:00`);

      // Apply Rounding if rules available
      if (roundingRules) {
        const rounded = roundSessionRange(clockInTime, clockOutTime, roundingRules);
        clockInTime = rounded.roundedStart;
        clockOutTime = rounded.roundedEnd;
      }

      const grossSec = Math.max(0, Math.floor((clockOutTime - clockInTime) / 1000));
      const breakSec = Math.max(0, (Number(breakMin) || 0) * 60);
      const effectiveSec = Math.max(0, grossSec - breakSec);

      // Daily target seconds for overtime calculation
      const daySchedule = schedule[selectedDay] || {};
      const standardWorkSec = Number(daySchedule.targetSec) || (8 * 60 * 60); // Default to 8 hours
      const overtimeSec = Math.max(0, effectiveSec - standardWorkSec);

      return { grossSec, effectiveSec, overtimeSec };
    } catch (error) {
      console.warn('calculateDayTotals error:', error);
      return { grossSec: 0, effectiveSec: 0, overtimeSec: 0 };
    }
  }

  const selectedDayTotals = useMemo(() => {
    const dayData = dailyData[selectedDay];
    if (!dayData) return { grossSec: 0, effectiveSec: 0, overtimeSec: 0 };
    const calculated = calculateDayTotals(dayData.clockIn, dayData.clockOut, dayData.breakMin);
    if (calculated.grossSec > 0 || calculated.effectiveSec > 0 || calculated.overtimeSec > 0) {
      return calculated;
    }
    return {
      grossSec: Number(dayData.computedGrossSec) || 0,
      effectiveSec: Number(dayData.computedEffectiveSec) || 0,
      overtimeSec: Number(dayData.computedOvertimeSec) || 0
    };
  }, [dailyData, selectedDay, roundingRules, schedule]);

  // Filter edit history to only show entries for the currently selected day
  const filteredEditHistory = useMemo(() => {
    if (!selectedDay || !weekDays.length || !editHistory.length) return [];

    const selectedDate = weekDays.find(w => w.day === selectedDay)?.date;
    if (!selectedDate) return [];

    // Filter history to only show items for the selected day
    // Normalize dates to ISO format for comparison
    const normalizeDate = (date) => {
      if (!date) return null;
      if (typeof date === 'string') {
        // If it's already in YYYY-MM-DD format, return as is
        if (date.match(/^\d{4}-\d{2}-\d{2}$/)) return date;
        // Otherwise try to parse it
        try {
          const d = new Date(date);
          if (!isNaN(d.getTime())) {
            return formatISODate(d);
          }
        } catch {
          return null;
        }
      }
      if (date instanceof Date) {
        return formatISODate(date);
      }
      return null;
    };

    const normalizedSelectedDate = normalizeDate(selectedDate);
    if (!normalizedSelectedDate) return [];

    return editHistory.filter(historyItem => {
      const normalizedHistoryDate = normalizeDate(historyItem.date);
      return normalizedHistoryDate === normalizedSelectedDate;
    });
  }, [editHistory, selectedDay, weekDays]);

  // ENHANCEMENT: Validate day entry
  // ENHANCEMENT: Validate day entry
  const validateDayEntry = (clockIn, clockOut, breakMin, dateStr) => {
    const errors = {};
    const now = new Date();
    const todayIso = formatISODate(now);
    const currentTimeStr = now.toTimeString().slice(0, 5); // HH:MM format

    // Check for future date
    if (dateStr && dateStr > todayIso) {
      errors.clockIn = 'Cannot add entries for future dates';
      return errors;
    }

    // Check for future time on today
    if (dateStr === todayIso) {
      if (clockIn && clockIn > currentTimeStr) {
        errors.clockIn = 'Cannot select future time for today';
      }
      if (clockOut && clockOut > currentTimeStr) {
        errors.clockOut = 'Cannot select future time for today';
      }
    }

    if (clockIn && clockOut) {
      const clockInTime = new Date(`2000-01-01T${clockIn}:00`);
      const clockOutTime = new Date(`2000-01-01T${clockOut}:00`);

      // Handle simple overnight case or reverse time (strict for now)
      if (clockOutTime <= clockInTime) {
        // Double check if it is exactly same time or just earlier
        // For now, same time = 0 duration which is valid or invalid? 
        // Let's assume > 0 duration required.
        if (clockOutTime.getTime() === clockInTime.getTime()) {
          errors.clockOut = 'End time cannot be same as start time';
        } else {
          errors.clockOut = 'Clock out time must be after clock in time';
        }
      }

      const totalHours = (clockOutTime - clockInTime) / (1000 * 60 * 60);
      if (totalHours > 24) {
        errors.clockOut = 'Total hours cannot exceed 24 hours';
      }
    }

    if (clockIn && !clockOut) {
      errors.clockOut = 'Clock out time is required when clock in is set';
    }

    if (!clockIn && clockOut) {
      errors.clockIn = 'Clock in time is required when clock out is set';
    }

    if (breakMin < 0 || breakMin > 480) { // Max 8 hours break
      errors.breakMin = 'Break time must be between 0 and 480 minutes';
    }

    if (Object.keys(errors).length > 0) {
      // console.warn('[EditTimesheetModal] Entry Invalid:', errors);
    }

    return errors;
  };

  // ENHANCEMENT: Calculate week totals
  const calculateWeekTotals = useCallback((data = dailyData) => {
    const totals = { grossSec: 0, effectiveSec: 0, overtimeSec: 0 };

    Object.values(data).forEach(daySessions => {
      if (Array.isArray(daySessions)) {
        daySessions.forEach(session => {
          if (session.clockIn && session.clockOut) {
            const dayTotals = calculateDayTotals(session.clockIn, session.clockOut, session.breakMin);
            totals.grossSec += dayTotals.grossSec;
            totals.effectiveSec += dayTotals.effectiveSec;
            totals.overtimeSec += dayTotals.overtimeSec;
          } else if (
            (Number(session?.computedGrossSec) || Number(session?.computedEffectiveSec) || Number(session?.computedOvertimeSec))
          ) {
            totals.grossSec += Number(session.computedGrossSec) || 0;
            totals.effectiveSec += Number(session.computedEffectiveSec) || 0;
            totals.overtimeSec += Number(session.computedOvertimeSec) || 0;
          }
        });
      }
    });

    setWeekTotals(totals);
    return totals;
  }, [dailyData, calculateDayTotals, roundingRules]);
  // But default IS used: `data = dailyData`. So dailyData IS a dependency.

  // Recalculate totals when rounding rules or schedule arrives
  useEffect(() => {
    if (roundingRules || Object.keys(schedule).length > 0) {
      console.log('[EditTimesheetModal] Recalculating totals with new rules/schedule');
      calculateWeekTotals(dailyData);
    }
  }, [roundingRules, schedule, dailyData]);

  // Initial calculation when dailyData is first populated
  useEffect(() => {
    if (Object.keys(dailyData).length > 0) {
      calculateWeekTotals(dailyData);
    }
  }, [dailyData]);

  // Update data for a specific session
  const updateSession = useCallback((sessionId, field, value) => {
    setDailyData(prevDailyData => {
      const daySessions = prevDailyData[selectedDay] || [];
      const sessionIndex = daySessions.findIndex(s => s.id === sessionId);
      if (sessionIndex === -1) return prevDailyData;

      const updatedSession = {
        ...daySessions[sessionIndex],
        [field]: value
      };

      // Recalculate totals for this session
      const totals = calculateDayTotals(
        updatedSession.clockIn,
        updatedSession.clockOut,
        updatedSession.breakMin
      );

      const finalSession = {
        ...updatedSession,
        computedGrossSec: totals.grossSec,
        computedEffectiveSec: totals.effectiveSec,
        computedOvertimeSec: totals.overtimeSec
      };

      const newSessions = [...daySessions];
      newSessions[sessionIndex] = finalSession;

      // Validate
      const selectedDate = weekDays.find(w => w.day === selectedDay)?.date;
      const errors = validateDayEntry(
        finalSession.clockIn,
        finalSession.clockOut,
        finalSession.breakMin,
        selectedDate
      );

      setValidationErrors(prev => {
        const next = { ...prev };
        // Clear error for the field being edited to satisfy "remove error on input"
        const sessionErrors = { ...(next[sessionId] || {}) };
        delete sessionErrors[field];

        // Merge with new structural errors (from validateDayEntry)
        const combinedErrors = { ...sessionErrors, ...errors };

        if (Object.keys(combinedErrors).length === 0) {
          delete next[sessionId];
        } else {
          next[sessionId] = combinedErrors;
        }
        return next;
      });

      // ENHANCEMENT: Recalculate week totals
      calculateWeekTotals({
        ...prevDailyData,
        [selectedDay]: newSessions
      });

      return {
        ...prevDailyData,
        [selectedDay]: newSessions
      };
    });
  }, [selectedDay, calculateDayTotals, validateDayEntry, setValidationErrors, roundingRules, schedule]);

  // [FIX #4] Use unified entry factory for consistent schema
  const addSession = () => {
    // IMPORTANT: New rows must be treated as NEW entries during save.
    // saveWeekEdits() routes to CREATE only when sessionId is missing or starts with `manual_`/`entry_`.
    // If we use a plain random id, it is treated as an existing session and updateTimeEntrySafe will fail.
    const sessionId = `manual_${generateEntryId()}`;
    const selectedDate = weekDays.find(w => w.day === selectedDay)?.date || '';

    // Use the unified entry factory to ensure consistent schema
    const newSession = createTimesheetEntry({
      id: sessionId,
      sessionId: sessionId,
      date: selectedDate,
      clockIn: null,
      clockOut: null,
      grossSec: 0,
      effectiveSec: 0,
      overtimeSec: 0,
      breakSec: 0,
      manualBreakSec: 0,
      isManual: true,
      source: 'manual',
      status: 'closed',
      sessionKey: sessionId,
      sessionIds: [sessionId]
    });

    // Add UI-specific fields for the modal
    const sessionWithUIFields = {
      ...newSession,
      breakMin: '0',
      description: '',
      computedGrossSec: 0,
      computedEffectiveSec: 0,
      computedOvertimeSec: 0,
      clockIn: '', // Override to empty string for form input
      clockOut: '' // Override to empty string for form input
    };

    setDailyData(prevDailyData => ({
      ...prevDailyData,
      [selectedDay]: [...(prevDailyData[selectedDay] || []), sessionWithUIFields]
    }));
  };

  const removeSession = useCallback((sessionId) => {
    if (!sessionId) return;

    // Track deletion date BEFORE removing from state
    try {
      const selectedDate = weekDays.find(w => w.day === selectedDay)?.date || null;

      // Track deletion only if it's not a temporary new entry
      if (selectedDate && !sessionId.toString().includes('manual_') && !sessionId.toString().includes('entry_')) {
        setDeletedSessions(prev => {
          const next = new Map(prev);
          next.set(String(sessionId), selectedDate);
          return next;
        });
        console.log('[EditTimesheetModal] Marked session for deletion:', { sessionId, date: selectedDate });
      }
    } catch (e) {
      console.warn('[EditTimesheetModal] Failed to track deletion date:', e);
    }

    // Remove from UI state
    setDailyData(prevDailyData => {
      const newSessions = (prevDailyData[selectedDay] || []).filter(s => s.id !== sessionId);
      const updatedDailyData = {
        ...prevDailyData,
        [selectedDay]: newSessions
      };
      calculateWeekTotals(updatedDailyData);
      return updatedDailyData;
    });
  }, [selectedDay, weekDays]);



  // Format seconds to hours and minutes
  const formatTime = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
  };

  // Calculate total hours for the week (legacy function for display)
  const calculateTotalHours = () => {
    const hours = Math.floor(weekTotals.effectiveSec / 3600);
    return hours;
  };



  // Helper: Merge overlapping sessions
  const mergeOverlappingSessions = (sessions) => {
    const validSessions = sessions.filter(s => s.clockIn && s.clockOut && !s.isDeleted);
    if (validSessions.length < 2) return validSessions;

    // Helper to Convert HH:MM to timestamp
    const getTimestamp = (timeStr) => {
      if (!timeStr) return 0;
      const [h, m] = timeStr.split(':').map(Number);
      const d = new Date();
      d.setHours(h, m, 0, 0);
      return d.getTime();
    };

    // Sort by Start Time
    const sorted = [...validSessions].sort((a, b) =>
      getTimestamp(a.clockIn) - getTimestamp(b.clockIn)
    );

    const merged = [];
    let current = { ...sorted[0] }; // Clone to avoid mutating original state

    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i];

      const currentEnd = getTimestamp(current.clockOut);
      const nextStart = getTimestamp(next.clockIn);
      const nextEnd = getTimestamp(next.clockOut);

      // Overlap Check (Strict: only merge if they actually overlap)
      // Touching sessions (e.g. 1:00-2:00 and 2:00-3:00) remain separate.
      if (currentEnd > nextStart) {
        // MERGE: Extend current end if next end is later
        if (nextEnd > currentEnd) {
          current.clockOut = next.clockOut;
        }
        // Merge Breaks and Notes
        current.breakMin = String((Number(current.breakMin) || 0) + (Number(next.breakMin) || 0));
        if (next.description && !current.description.includes(next.description)) {
          current.description = current.description ? `${current.description} | ${next.description}` : next.description;
        }

        // CRITICAL: Preserve Lineage from BOTH sessions
        // If we merge session A (real) and session B (real), we need to track both IDs
        const currentIds = current.sessionIds || (current.id && !current.id.startsWith('manual_') && !current.id.startsWith('entry_') ? [current.id] : []);
        const nextIds = next.sessionIds || (next.id && !next.id.startsWith('manual_') && !next.id.startsWith('entry_') ? [next.id] : []);
        current.sessionIds = [...new Set([...currentIds, ...nextIds])];

        // Keep the most relevant session key (prioritize existing database IDs over temp ones)
        if (!current.sessionKey && next.sessionKey) {
          current.sessionKey = next.sessionKey;
        }
      } else {
        // No overlap, push current and move to next
        merged.push(current);
        current = { ...next };
      }
    }
    merged.push(current);
    return merged;
  };

  const handleSave = async (isRetry = false) => {
    try {
      setIsSaving(true);
      setError(null);
      setShowRetry(false);

      if (!isRetry) {
        setRetryCount(0);
      }

      // ENHANCEMENT: Pre-process data to Merge Overlaps
      const processedDailyData = {};
      Object.keys(dailyData).forEach(day => {
        if (Array.isArray(dailyData[day])) {
          processedDailyData[day] = mergeOverlappingSessions(dailyData[day]);
        } else {
          processedDailyData[day] = [];
        }
      });
      console.log('[EditTimesheetModal] Merged Sessions:', processedDailyData);

      // ENHANCEMENT: Validate all entries using the MERGED data
      const allErrors = {};
      let hasErrors = false;

      weekDays.forEach(({ day }) => {
        const daySessions = processedDailyData[day]; // Use processed data
        if (Array.isArray(daySessions)) {
          // 1. Validate Individual Entries
          daySessions.forEach(session => {
            if (session.clockIn || session.clockOut) {
              const selectedDate = weekDays.find(w => w.day === day)?.date;
              const errors = validateDayEntry(session.clockIn, session.clockOut, session.breakMin, selectedDate);
              if (Object.keys(errors).length > 0) {
                console.warn(`[EditTimesheetModal] Validation failed for ${day} session ${session.id}:`, errors, {
                  clockIn: session.clockIn,
                  clockOut: session.clockOut,
                  breakMin: session.breakMin
                });
                // Use a composite key or fallback to index if ID is lost in merge
                allErrors[`${day}_${session.id}`] = errors;
                hasErrors = true;
              }
            }
          });

          // 2. Validate Overlaps between Entries (Should be clean after merge, but good as safety net)
          const validSessions = daySessions.filter(s =>
            s.clockIn &&
            s.clockOut &&
            !allErrors[`${day}_${s.id}`]
          );

          if (validSessions.length > 1) {
            // Helper to get comparable timestamp
            const getTimestamp = (timeVal) => {
              // ... reused logic ...
              if (!timeVal) return 0;
              const [h, m] = typeof timeVal === 'string' ? timeVal.split(':').map(Number) : [0, 0];
              const d = new Date();
              d.setHours(h || 0, m || 0, 0, 0);
              return d.getTime();
            };

            // Re-sort just in case
            const intervals = validSessions.map(s => ({
              start: getTimestamp(s.clockIn),
              end: getTimestamp(s.clockOut),
              id: s.id
            })).sort((a, b) => a.start - b.start);

            for (let i = 0; i < intervals.length - 1; i++) {
              if (intervals[i].end > intervals[i + 1].start) {
                // This shouldn't happen after merge, but if it does:
                console.warn(`[EditTimesheetModal] Overlap detected on ${day}:`, intervals[i], intervals[i + 1]);
                allErrors[`${day}_${intervals[i + 1].id}`] = { clockIn: 'Overlaps with previous entry' };
                hasErrors = true;
              }
            }
          }
        }
      });

      if (hasErrors) {
        console.error('[EditTimesheetModal] Save blocked by validation errors:', allErrors);
        setValidationErrors(allErrors);

        // ENHANCEMENT: Show specific error in toast to guide user
        try {
          const firstErrorKey = Object.keys(allErrors)[0]; // e.g., "Wednesday_entry_123"
          if (firstErrorKey) {
            const dayName = firstErrorKey.split('_')[0]; // Extract day name
            const errorObj = allErrors[firstErrorKey];
            const errorMsg = Object.values(errorObj)[0]; // Get first error message
            toast.error(`Error on ${dayName}: ${errorMsg}`);
          } else {
            toast.error('Please fix validation errors before saving');
          }
        } catch (e) {
          toast.error('Please fix validation errors before saving');
        }
        return;
      }

      console.log('[EditTimesheetModal] Starting save operation:', timesheet);
      const raw = timesheet?.raw || timesheet;
      let weekStart = raw?.start || timesheet?.weekStart;
      const userId = raw?.userId || timesheet?.userId || timesheet?.uid || timesheet?.user?.uid;

      // Normalize weekStart to ISO string format for consistency
      if (weekStart instanceof Date) {
        weekStart = formatISODate(weekStart);
      } else if (typeof weekStart === 'string' && !weekStart.match(/^\d{4}-\d{2}-\d{2}$/)) {
        // If it's not in YYYY-MM-DD format, convert it
        const date = new Date(weekStart);
        if (!isNaN(date.getTime())) {
          weekStart = formatISODate(date);
        }
      }

      // [FIX] Build dayEdits with unified entry schema fields
      const dayEdits = [];
      weekDays.forEach(w => {
        const sessions = processedDailyData[w.day];
        if (Array.isArray(sessions)) {
          sessions.forEach(s => {
            if (s.clockIn || s.clockOut) {
              // [FIX] Ensure ghost sessions or entries with malformed IDs are treated as NEW
              // IDs that don't match Firestore UUID pattern or start with manual_/entry_ should be suspect
              const isGhostOrLegacy = s.id && (s.id.includes('_') || s.id.length < 10) &&
                !s.id.startsWith('entry_') && !s.id.startsWith('manual_');

              // IMPORTANT:
              // - `sessionId` should refer to the underlying timeClockSessions doc id (if any).
              // - `entryId` should refer to the timesheet entry id in timesheets.entries[].
              // For some records (manual/legacy/description-only), these may differ.
              const finalSessionId = isGhostOrLegacy
                ? null
                : (s.sessionKey || (Array.isArray(s.sessionIds) && s.sessionIds[0]) || null);
              const entryId = s.id || null;

              dayEdits.push({
                date: w.date,
                clockIn: s.clockIn || '',
                clockOut: s.clockOut || '',
                breakMin: Number(s.breakMin || 0),
                notes: s.description || s.notes || '',

                // ID fields - prioritize correctly for saveWeekEdits to detect isNewEntry
                sessionId: finalSessionId,
                entryId,
                sessionIds: s.sessionIds || (s.sessionKey ? [s.sessionKey] : (s.id && !isGhostOrLegacy ? [s.id] : [])),
                sessionKey: finalSessionId,

                // [FIX #4] Include unified schema fields
                status: s.status || 'closed',
                source: s.source || (s.isManual ? 'manual' : 'clock'),
                isManual: s.isManual || false
              });
            }
          });
        }
      });

      console.log('[EditTimesheetModal] Saving day edits (including manual entries):', dayEdits);

      // Store edit history before saving
      const editedBy = user?.uid || '';
      const editedByName = user?.displayName || user?.name || 'Unknown';

      // Compare with original values and store history for changed entries
      const editHistoryPromises = [];
      for (const edit of dayEdits) {
        const dayName = weekDays.find(w => w.date === edit.date)?.day;
        if (dayName && originalDailyData[dayName]) {
          const originalSessions = originalDailyData[dayName] || [];
          const original = originalSessions.find(s => s.id === edit.sessionId) || {};

          const hasChanges =
            (original.clockIn || '') !== (edit.clockIn || '') ||
            (original.clockOut || '') !== (edit.clockOut || '') ||
            (Number(original.breakMin) || 0) !== (Number(edit.breakMin) || 0) ||
            (original.description || '') !== (edit.notes || '');

          if (hasChanges) {
            const historyPromise = storeEditHistory(
              userId,
              weekStart,
              edit.date,
              {
                clockIn: original.clockIn || '',
                clockOut: original.clockOut || '',
                breakMin: Number(original.breakMin) || 0,
                notes: original.description || ''
              },
              {
                clockIn: edit.clockIn || '',
                clockOut: edit.clockOut || '',
                breakMin: Number(edit.breakMin) || 0,
                notes: edit.notes || ''
              },
              editedBy,
              editedByName
            ).catch(error => {
              console.error('[EditTimesheetModal] Error storing edit history:', error);
              // Don't fail the save if history storage fails
            });
            editHistoryPromises.push(historyPromise);
          }
        }
      }

      // Snapshot deletions before close — state is cleared on unmount
      const deletedSnapshot = new Map(deletedSessions);

      // [UI-BLOCKING SAVE] Execute save in foreground to ensure UI consistency
      try {
        if (deletedSnapshot.size > 0) {
          console.log('[EditTimesheetModal] Processing deletions:', Array.from(deletedSnapshot.entries()));
          // Same weekly timesheet doc for all days — parallel deletes race (last write wins).
          for (const [sessionId, dateStr] of deletedSnapshot.entries()) {
            try {
              await deleteTimeEntry({
                userId,
                dateStr: dateStr || weekStart,
                weekStartDay: resolvedWeekStartDay,
                entry: {
                  id: sessionId,
                  sessionId: sessionId,
                  sessionKey: sessionId,
                  entryId: sessionId
                }
              });
            } catch (err) {
              console.error('[EditTimesheetModal] Failed to delete session:', sessionId, err);
            }
          }
        }

        const result = await timesheetUpdateManager.updateTimesheet(
          userId,
          weekStart,
          dayEdits,
          {
            optimistic: true,
            batchUpdates: false,
            invalidateCache: true,
            broadcastEvents: true,
            siteId: selectedSiteId
          }
        );

        await Promise.allSettled(editHistoryPromises);
        console.log('[EditTimesheetModal] Save result:', result);

        if (result.success) {
          try {
            const raw = timesheet?.raw || timesheet;
            const startDate = raw?.start ? new Date(raw.start) : (timesheet?.weekStart ? new Date(timesheet.weekStart) : null);

            if (userId && startDate) {
              let weekStartDayToUse = resolvedWeekStartDay;
              try {
                const userWeekContext = await getUserWeekContext(userId, { forceRefresh: true });
                if (userWeekContext?.weekStartDay) weekStartDayToUse = userWeekContext.weekStartDay;
              } catch (_) { }

              const { start } = getWeekRange(startDate, weekStartDayToUse);
              const weekStartStr = formatISODate(start);

              try {
                const { invalidateTimesheetCache } = await import('../../services/timesheets');
                invalidateTimesheetCache(userId, weekStartStr);
              } catch (e) { console.warn('Cache clear failed', e); }

              await fetchWeekDetails(userId, weekStartStr, { weekStartDay: weekStartDayToUse });
            }
          } catch (reloadError) {
            console.warn('[EditTimesheetModal] Reload failed:', reloadError);
          }

          toast.success('Timesheet saved');
          setError(null);
          setShowRetry(false);
          
          if (onSave) {
            onSave({
              success: true,
              weekStart,
              userId
            });
          }
          onClose();
        } else {
          toast.error(result.error || 'Could not save changes. Please try again.');
          setError(result.error);
        }
      } catch (error) {
        console.error('[EditTimesheetModal] Save failed:', error);
        toast.error(error.message || 'Could not save changes. Please try again.');
        setError(error.message);
      } finally {
        setIsSaving(false);
      }

    } catch (error) {
      console.error('[EditTimesheetModal] Save failed:', error);

      // ENHANCEMENT: Determine error type and show appropriate handling
      const isNetworkError = error.message.includes('network') ||
        error.message.includes('fetch') ||
        error.message.includes('timeout') ||
        error.code === 'unavailable';

      const isPermissionError = error.message.includes('permission') ||
        error.message.includes('unauthorized') ||
        error.code === 'permission-denied';

      let errorMessage = error.message || 'Failed to save timesheet edits';

      if (isNetworkError && retryCount < 3) {
        errorMessage = `Network error occurred. You can retry the operation.`;
        setShowRetry(true);
        setRetryCount(prev => prev + 1);
      } else if (isPermissionError) {
        errorMessage = 'You do not have permission to edit this timesheet. Please contact your manager.';
      } else if (retryCount >= 3) {
        errorMessage = 'Multiple attempts failed. Please check your connection and try again later.';
      }

      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  // ENHANCEMENT: Retry function
  const handleRetry = () => {
    handleSave(true);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}></div>

      <div className="relative w-full max-w-[480px] bg-white rounded-t-[28px] sm:rounded-[28px] shadow-[0_12px_40px_rgba(0,0,0,0.15)] p-5 sm:p-6 max-h-[92vh] overflow-y-auto scrollbar-hide">
        {/* Drag Handle for mobile feel */}
        <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-6 sm:hidden"></div>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex justify-between items-center mb-1">
            <h2 className="text-[22px] font-bold text-text-primary tracking-tight">Edit Timesheet</h2>
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-full transition-colors">
              <X className="h-5 w-5 text-text-primary" />
            </button>
          </div>

          {/* Period and Status */}
          <div className="space-y-0.5">
            <p className="text-[13px] font-medium text-[#94a3b8]">Period</p>
            <div className="flex justify-between items-center">
              <h3 className="text-[17px] font-bold text-text-primary leading-tight">Weekly Summary {periodLabel.includes(',') ? periodLabel.split(',')[0] : periodLabel}</h3>
              <div className="px-3 py-1 bg-gray-50 border border-gray-100 rounded-full text-[11px] font-bold text-[#64748b] tracking-wider">
                {statusLabel}
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 my-4"></div>          {/* Horizontal Date Selection */}
          <div className="flex justify-between items-center px-0.5 mb-5">
            {weekDays.map(({ day, date }) => {
              const isSelected = selectedDay === day;
              const dateObj = new Date(date);
              const dayOfMonth = dateObj.getDate();
              const dayOfWeekShort = day.substring(0, 3);

              const now = new Date();
              const todayIso = now.toISOString().split('T')[0];
              const isFuture = date > todayIso;

              return (
                <button
                  key={day}
                  onClick={() => !isFuture && setSelectedDay(day)}
                  disabled={isFuture}
                  className={`flex flex-col items-center transition-all ${isFuture ? 'opacity-40 cursor-not-allowed filter grayscale-[0.5]' : ''}`}
                >
                  <div className={`w-[44px] h-[44px] flex flex-col items-center justify-center rounded-full transition-all ${isSelected
                    ? 'bg-[#7c3aed] text-white shadow-[0_4px_10px_rgba(124,58,237,0.25)]'
                    : isFuture ? 'bg-gray-100 text-gray-400' : 'text-text-primary hover:bg-gray-50'
                    }`}>
                    <span className={`text-[15px] font-bold leading-none ${isSelected ? 'mb-0' : 'mb-0.5'}`}>{dayOfMonth}</span>
                    <span className={`text-[10px] font-bold leading-none uppercase ${isSelected ? 'text-purple-100' : isFuture ? 'text-gray-400' : 'text-[#94a3b8]'}`}>
                      {dayOfWeekShort}
                    </span>
                  </div>
                  {isFuture && <div className="mt-1 w-1 h-1 bg-gray-300 rounded-full"></div>}
                </button>
              );
            })}
          </div>

          {/* Weekly Summary (Compact Version) */}
          <div className="bg-[#f8fafc] rounded-[20px] p-4 mb-5 border border-gray-100">
            <div className="flex justify-between items-center mb-3">
              <span className="text-[12px] font-bold text-[#64748b] uppercase tracking-wider">Weekly Totals</span>
              <div className="flex gap-4">
                <div className="text-right">
                  <p className="text-[10px] text-[#94a3b8] font-bold uppercase">Gross</p>
                  <p className="text-[16px] font-bold text-text-primary leading-tight">{formatTime(weekTotals.grossSec)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-[#94a3b8] font-bold uppercase">Effective</p>
                  <p className="text-[16px] font-bold text-[#7c3aed] leading-tight">{formatTime(weekTotals.effectiveSec)}</p>
                </div>
              </div>
            </div>
            {weekTotals.overtimeSec > 0 && (
              <div className="flex justify-between items-center pt-2 border-t border-gray-100">
                <span className="text-[12px] font-bold text-[#64748b]">Total Overtime</span>
                <span className="text-[14px] font-bold text-orange-500">+{formatTime(weekTotals.overtimeSec)}</span>
              </div>
            )}
          </div>

          {/* Daily Entry Form */}
          <div className="space-y-6">
            {/* Sessions List */}
            <div className="space-y-6">
              {(Array.isArray(currentDaySessions) ? currentDaySessions : []).map((session, index) => {
                const isTimeLocked = false; // User requested: Allow editing of ALL sessions (was: !isManager && !session.isManual)
                const sessionErrors = validationErrors[session.id] || {}; // Patch: Define sessionErrors or use empty object

                return (
                  <div key={session.id} className="bg-background-secondary/30 border border-border-primary rounded-xl p-4 relative group">
                    {/* Remove Button - Only allow if not locked */}
                    {!isTimeLocked && (
                      <button
                        onClick={() => removeSession(session.id)}
                        className="absolute -top-2.5 -right-2.5 bg-white border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-100 rounded-full p-2 shadow-sm transition-all z-20 flex items-center justify-center group/del"
                        title="Remove Session"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}

                    <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-3">
                      {session.isManual ? 'Manual Entry' : `Session ${index + 1}`}
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                      {/* Clock In */}
                      <div>
                        <label className="text-sm font-medium text-text-secondary mb-1.5 block">Clock In</label>
                        <input
                          type="time"
                          value={session.clockIn}
                          onChange={(e) => updateSession(session.id, 'clockIn', e.target.value)}
                          disabled={isTimeLocked}
                          max={(() => {
                            const now = new Date();
                            const todayIso = now.toISOString().split('T')[0];
                            const selectedDateStr = weekDays.find(d => d.day === selectedDay)?.date;
                            return selectedDateStr === todayIso ? now.toTimeString().slice(0, 5) : undefined;
                          })()}
                          className={`w-full h-10 px-3 border rounded-lg text-sm text-text-primary focus:outline-none focus:border-[#7c3aed] focus:bg-white focus:ring-0 ${sessionErrors.clockIn
                            ? 'border-red-300 bg-red-50'
                            : 'border-border-secondary'
                            } ${isTimeLocked ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
                        />
                        {/* Error text removed per user request - centralized banner used instead */}
                      </div>

                      {/* Clock Out */}
                      <div>
                        <label className="text-sm font-medium text-text-secondary mb-1.5 block">Clock Out</label>
                        <input
                          type="time"
                          value={session.clockOut}
                          onChange={(e) => updateSession(session.id, 'clockOut', e.target.value)}
                          disabled={isTimeLocked}
                          max={(() => {
                            const now = new Date();
                            const todayIso = now.toISOString().split('T')[0];
                            const selectedDateStr = weekDays.find(d => d.day === selectedDay)?.date;
                            return selectedDateStr === todayIso ? now.toTimeString().slice(0, 5) : undefined;
                          })()}
                          className={`w-full h-10 px-3 border rounded-lg text-sm text-text-primary focus:outline-none focus:border-border-accent-purple ${sessionErrors.clockOut
                            ? 'border-red-300 bg-red-50'
                            : 'border-border-secondary'
                            } ${isTimeLocked ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
                        />
                        {/* Error text removed per user request - centralized banner used instead */}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Break */}
                      <div>
                        <label className="text-sm font-medium text-text-secondary mb-1.5 block">Break (min)</label>
                        <input
                          type="number"
                          min="0"
                          max="480"
                          value={session.breakMin}
                          onChange={(e) => updateSession(session.id, 'breakMin', e.target.value)}
                          disabled={isTimeLocked}
                          className={`w-full h-10 px-3 border rounded-lg text-sm text-text-primary focus:outline-none focus:border-border-accent-purple ${sessionErrors.breakMin
                            ? 'border-red-300 bg-red-50'
                            : 'border-border-secondary'
                            } ${isTimeLocked ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : ''}`}
                        />
                      </div>

                      {/* Notes - Always Editable */}
                      <div>
                        <label className="text-sm font-medium text-text-secondary mb-1.5 block">Notes</label>
                        <input
                          type="text"
                          value={session.description}
                          onChange={(e) => updateSession(session.id, 'description', e.target.value)}
                          placeholder="Optional notes..."
                          className="w-full h-10 px-3 border border-border-secondary rounded-lg text-sm text-text-primary focus:outline-none focus:border-border-accent-purple placeholder:text-text-tertiary"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Future Time Warning */}
              {(() => {
                const now = new Date();
                const todayIso = now.toISOString().split('T')[0];
                const selectedDateStr = weekDays.find(d => d.day === selectedDay)?.date;
                const currentTimeStr = now.toTimeString().slice(0, 5);

                const hasFutureTime = selectedDateStr === todayIso && (currentDaySessions || []).some(s =>
                  (s.clockIn && s.clockIn > currentTimeStr) ||
                  (s.clockOut && s.clockOut > currentTimeStr)
                );

                if (hasFutureTime) {
                  return (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3 mb-2">
                      <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0" />
                      <p className="text-sm text-red-800 font-medium">
                        You cannot select a future time for today. Please adjust your entries.
                      </p>
                    </div>
                  );
                }
                return null;
              })()}

              {/* Add Session Button */}
              {(() => {
                const now = new Date();
                const todayIso = now.toISOString().split('T')[0];
                const selectedDateStr = weekDays.find(d => d.day === selectedDay)?.date;
                const isFutureDate = selectedDateStr && selectedDateStr > todayIso;

                if (isFutureDate) return null;

                return (
                  <button
                    onClick={addSession}
                    className="w-full py-3 border-2 border-dashed border-border-secondary rounded-xl text-text-secondary hover:border-border-accent-purple hover:text-text-accent-purple hover:bg-background-accent-purple-light/50 transition-all flex items-center justify-center gap-2 font-medium text-sm"
                  >
                    <Clock className="h-4 w-4" />
                    Add Another Session
                  </button>
                );
              })()}

              {/* Overlap Error Message */}
              {/* Centralized Validation Banner - Replaces per-input error text */}
              {(overlapDetected || Object.keys(validationErrors).length > 0) && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3 mt-4">
                  <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0" />
                  <p className="text-sm text-red-800 font-medium">
                    {overlapDetected 
                      ? 'Warning: You have overlapping time entries. Please adjust them before saving.'
                      : 'Warning: Please check your time entries and correct any errors before saving.'}
                  </p>
                </div>
              )}
            </div>



            {/* Edit History Section */}
            <div>
              <h3 className="text-md font-semibold text-text-primary mb-3 flex items-center gap-2">
                <History className="h-4 w-4" />
                Edit History ({selectedDay})
              </h3>
              {isLoadingHistory ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-text-secondary" />
                  <span className="ml-2 text-sm text-text-secondary">Loading history...</span>
                </div>
              ) : filteredEditHistory.length === 0 ? (
                <div className="bg-background-secondary rounded-lg p-4 text-center">
                  <p className="text-sm text-text-secondary">No edit history available for {selectedDay}</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-64 overflow-y-auto scrollbar-custom">
                  {filteredEditHistory.map((historyItem, index) => {
                    // Format edit date
                    const editDate = historyItem.editedAt instanceof Date
                      ? historyItem.editedAt
                      : new Date(historyItem.editedAt);
                    const formattedEditDate = editDate.toLocaleDateString('en-GB', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    });

                    // Format entry date
                    const entryDate = new Date(historyItem.date);
                    const formattedEntryDate = formatDateUK(historyItem.date);
                    const entryDayName = entryDate.toLocaleDateString('en-US', { weekday: 'long' });

                    return (
                      <div
                        key={historyItem.id || index}
                        className="border border-border-accent-purple rounded-lg p-4 bg-purple-50"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-text-secondary" />
                            <span className="text-xs font-medium text-text-secondary">
                              {formattedEditDate}
                            </span>
                          </div>
                          <Badge variant="info" className="text-xs">
                            {entryDayName}, {formattedEntryDate}
                          </Badge>
                        </div>

                        <div className="flex items-center gap-2 mb-3">
                          <User className="h-3 w-3 text-text-secondary" />
                          <span className="text-xs text-text-secondary">
                            Edited by: <span className="font-medium text-text-primary">{historyItem.editedByName}</span>
                          </span>
                        </div>

                        <div className="space-y-2">
                          {/* Clock In Change */}
                          {(historyItem.previousValues.clockIn !== historyItem.newValues.clockIn) && (
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-text-secondary font-medium w-20">Clock In:</span>
                              <span className="text-red-600 line-through">{historyItem.previousValues.clockIn || '—'}</span>
                              <span className="text-text-secondary">→</span>
                              <span className="text-green-600 font-medium">{historyItem.newValues.clockIn || '—'}</span>
                            </div>
                          )}

                          {/* Clock Out Change */}
                          {(historyItem.previousValues.clockOut !== historyItem.newValues.clockOut) && (
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-text-secondary font-medium w-20">Clock Out:</span>
                              <span className="text-red-600 line-through">{historyItem.previousValues.clockOut || '—'}</span>
                              <span className="text-text-secondary">→</span>
                              <span className="text-green-600 font-medium">{historyItem.newValues.clockOut || '—'}</span>
                            </div>
                          )}

                          {/* Break Time Change */}
                          {(Number(historyItem.previousValues.breakMin) !== Number(historyItem.newValues.breakMin)) && (
                            <div className="flex items-center gap-2 text-xs">
                              <span className="text-text-secondary font-medium w-20">Break:</span>
                              <span className="text-red-600 line-through">{historyItem.previousValues.breakMin || 0} min</span>
                              <span className="text-text-secondary">→</span>
                              <span className="text-green-600 font-medium">{historyItem.newValues.breakMin || 0} min</span>
                            </div>
                          )}

                          {/* Notes Change */}
                          {(historyItem.previousValues.notes !== historyItem.newValues.notes) && (
                            <div className="text-xs">
                              <span className="text-text-secondary font-medium">Notes:</span>
                              <div className="mt-1 pl-4 border-l-2 border-border-secondary">
                                <div className="text-red-600 line-through mb-1">
                                  {historyItem.previousValues.notes || '(empty)'}
                                </div>
                                <div className="text-text-secondary mb-1">→</div>
                                <div className="text-green-600 font-medium">
                                  {historyItem.newValues.notes || '(empty)'}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
            <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-800">Save Failed</p>
              <p className="text-xs text-red-600">{error}</p>
            </div>
            {showRetry && (
              <Button
                variant="outline-danger"
                size="sm"
                onClick={handleRetry}
                disabled={isSaving}
              >
                Retry
              </Button>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="grid grid-cols-3 gap-4 pt-4 sm:pt-6">
          <Button
            onClick={onClose}
            variant='outline-secondary'
            cn='col-span-1 h-12'
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            variant='gradient'
            cn="col-span-2 h-12 flex justify-center"
            icon={isSaving ? Loader2 : Save}
            iconFirst={true}
            disabled={isSaving || overlapDetected || Object.keys(validationErrors).length > 0 || (() => {
              const now = new Date();
              const todayIso = formatISODate(now);
              const currentTimeStr = now.toTimeString().slice(0, 5);

              // Check ALL days in dailyData for future entries
              return Object.entries(dailyData || {}).some(([dayKey, sessions]) => {
                const dayDate = weekDays.find(wd => wd.day === dayKey)?.date;
                if (!dayDate || !sessions || sessions.length === 0) return false;

                if (dayDate > todayIso) return true;
                if (dayDate === todayIso) {
                  return sessions.some(s =>
                    (s.clockIn && s.clockIn > currentTimeStr) ||
                    (s.clockOut && s.clockOut > currentTimeStr)
                  );
                }
                return false;
              });
            })()}
          >
            <span>{isSaving ? 'Saving…' : 'Save Changes'}</span>
          </Button>
        </div>
      </div>
    </div>
  );
};

// Optimization: Memoized Session Row Component
const SessionEntryRow = React.memo(({
  session,
  index,
  selectedDay,
  onUpdate,
  onRemove,
  validationErrors
}) => {
  const sessionErrorKey = `${selectedDay}_${session.id}`;
  const sessionErrors = validationErrors[sessionErrorKey] || {};

  return (
    <div className="bg-background-secondary/30 border border-border-primary rounded-xl p-4 relative group">
      {/* Remove Button */}
      <button
        onClick={() => onRemove(session.id)}
        className="absolute -top-2 -right-2 bg-background-primary border border-border-secondary text-text-secondary hover:text-red-600 hover:border-red-200 rounded-full p-1.5 shadow-sm opacity-0 group-hover:opacity-100 transition-all z-10"
        title="Remove Session"
      >
        <X className="h-3 w-3" />
      </button>

      <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-3">
        Session {index + 1}
      </h4>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        {/* Clock In */}
        <div>
          <label className="text-sm font-medium text-text-secondary mb-1.5 block">Clock In</label>
          <input
            type="time"
            value={session.clockIn}
            onChange={(e) => onUpdate(session.id, 'clockIn', e.target.value)}
            className={`w-full p-2.5 rounded-lg border bg-background-primary text-text-primary focus:ring-2 focus:ring-accent-purple/20 transition-all ${sessionErrors.clockIn ? 'border-red-500 focus:border-red-500' : 'border-border-secondary focus:border-border-accent-purple'}`}
          />
          {sessionErrors.clockIn && <p className="text-xs text-red-500 mt-1">{sessionErrors.clockIn}</p>}
        </div>

        {/* Clock Out */}
        <div>
          <label className="text-sm font-medium text-text-secondary mb-1.5 block">Clock Out</label>
          <input
            type="time"
            value={session.clockOut}
            onChange={(e) => onUpdate(session.id, 'clockOut', e.target.value)}
            className={`w-full p-2.5 rounded-lg border bg-background-primary text-text-primary focus:ring-2 focus:ring-accent-purple/20 transition-all ${sessionErrors.clockOut ? 'border-red-500 focus:border-red-500' : 'border-border-secondary focus:border-border-accent-purple'}`}
          />
          {sessionErrors.clockOut && <p className="text-xs text-red-500 mt-1">{sessionErrors.clockOut}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Break Duration */}
        <div>
          <label className="text-sm font-medium text-text-secondary mb-1.5 block">Break (minutes)</label>
          <div className="relative">
            <Clock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
            <input
              type="number"
              min="0"
              value={session.breakMin}
              onChange={(e) => onUpdate(session.id, 'breakMin', e.target.value)}
              className={`w-full pl-9 p-2.5 rounded-lg border bg-background-primary text-text-primary focus:ring-2 focus:ring-accent-purple/20 transition-all ${sessionErrors.breakMin ? 'border-red-500 focus:border-red-500' : 'border-border-secondary focus:border-border-accent-purple'}`}
            />
          </div>
          {sessionErrors.breakMin && <p className="text-xs text-red-500 mt-1">{sessionErrors.breakMin}</p>}
        </div>

        {/* Notes */}
        <div>
          <label className="text-sm font-medium text-text-secondary mb-1.5 block">Notes</label>
          <input
            type="text"
            value={session.description}
            onChange={(e) => onUpdate(session.id, 'description', e.target.value)}
            placeholder="Add notes..."
            className="w-full p-2.5 rounded-lg border border-border-secondary bg-background-primary text-text-primary focus:ring-2 focus:ring-accent-purple/20 focus:border-border-accent-purple transition-all"
          />
        </div>
      </div>

      {/* Calculated Totals Badge */}
      <div className="mt-4 pt-3 border-t border-dashed border-border-secondary flex gap-3 text-xs">
        <div className="bg-background-tertiary px-2 py-1 rounded text-text-secondary">
          Gross: <span className="font-medium text-text-primary">{formatTime(session.computedGrossSec)}</span>
        </div>
        <div className="bg-green-50 text-green-700 px-2 py-1 rounded border border-green-100">
          Effective: <span className="font-bold">{formatTime(session.computedEffectiveSec)}</span>
        </div>
        {session.computedOvertimeSec > 0 && (
          <div className="bg-orange-50 text-orange-700 px-2 py-1 rounded border border-orange-100">
            Overtime: <span className="font-bold">{formatTime(session.computedOvertimeSec)}</span>
          </div>
        )}
      </div>
    </div>
  );
});

export default EditTimesheetModal;