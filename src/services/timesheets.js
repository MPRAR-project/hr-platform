/**
 * timesheets.js — Phase 5 Migration (REST Primary, Firebase Shim for complex paths)
 *
 * Strategy:
 *   1. All API functions → hrApiClient REST calls
 *   2. All pure computation functions (getWeekRange, formatISODate, getTimesheetId,
 *      computeTargetSecondsForDay, etc.) are KEPT INTACT — zero Firebase needed
 *   3. getUserWeekContext → REST via /hr/employees/me (cached in-memory)
 *   4. upsertDailyEntry / saveWeekEdits → REST via /hr/timesheets/*
 *   5. Submit / Approve / Decline → REST
 *   6. Subscriptions → REST + focus-event polling stub
 *
 * Exports preserved (complete list used across 30+ files):
 *   getTimesheetsByWeek, getUserTimesheetsByWeek, getTimesheetId,
 *   ensureWeeklyTimesheet, getUserWeekContext, invalidateUserWeekContext,
 *   getCompanyWorkSchedule, computeTargetSecondsForDay, upsertDailyEntry,
 *   updateTimeEntry, deleteTimeEntry, addManualTimeEntry, submitWeek,
 *   approveTimesheet, declineTimesheet, fetchWeekDetails, saveWeekEdits,
 *   recomputeTimesheetsSafe, invalidateTimesheetCache, triggerTimesheetArchive,
 *   reconcileTimesheetForWeek, getWeekRange, formatISODate,
 *   updateEntryDescription
 */

import hrApiClient from '../lib/hrApiClient';
import wsClient from '../lib/wsClient';
import {
  DEFAULT_WEEK_START_DAY,
  formatISODate as formatISODateUtil,
  getOrderedWeekDates,
  getWeekRangeForDate,
  STORAGE_ANCHOR_DAY,
  isMondayAnchorEnabled,
} from '../utils/weekStartUtils';
import { getDefaultRoundingRules, roundSessionRange } from '../utils/timeRounding';
import { generateEntryId } from '../utils/idUtils';

// ── Re-export utility functions that other files import from here ─────────────
export { formatISODateUtil as formatISODate };

export function getWeekRange(dateStr, weekStartDay = DEFAULT_WEEK_START_DAY) {
  const { start, end } = getWeekRangeForDate(dateStr, weekStartDay);
  return { start, end };
}

// ── Timesheet ID (deterministic — pure, no Firebase) ─────────────────────────
export function getTimesheetId(userId, dateStr) {
  if (!dateStr || !userId) return null;
  const { start } = getWeekRangeForDate(dateStr, DEFAULT_WEEK_START_DAY);
  if (!start) return null;
  const ds = formatISODateUtil(start);
  return `${userId}_${ds}`;
}

// ── Compute target seconds for a day (pure) ───────────────────────────────────
export function computeTargetSecondsForDay(dateStr, schedule) {
  if (!schedule || !dateStr) return 8 * 3600;
  try {
    const d       = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T12:00:00');
    const dayName = d.toLocaleDateString('en-US', { weekday: 'long' });
    const sch     = schedule[dayName] || schedule[dayName.toLowerCase()];
    if (!sch || sch.enabled === false) return 0;
    if (typeof sch.durationMin === 'number' && sch.durationMin > 0) return sch.durationMin * 60;
    if (sch.start && sch.end) {
      const [sH, sM] = sch.start.split(':').map(Number);
      const [eH, eM] = sch.end.split(':').map(Number);
      return Math.max(0, ((eH || 17) * 60 + (eM || 0)) - ((sH || 9) * 60 + (sM || 0))) * 60;
    }
  } catch { /* fall through */ }
  return 8 * 3600;
}

// ── In-memory caches (session-lived) ─────────────────────────────────────────
const _userWeekCtxCache = new Map();
const _companyScheduleCache = new Map();
const _timesheetMemCache   = new Map();

// ── getUserWeekContext ────────────────────────────────────────────────────────
export async function getUserWeekContext(userId, options = {}) {
  const { forceRefresh = false } = options;
  if (!userId) return { companyIdPath: '', siteIdPath: '', weekStartDay: DEFAULT_WEEK_START_DAY };

  if (!forceRefresh && _userWeekCtxCache.has(userId)) {
    return _userWeekCtxCache.get(userId);
  }

  try {
    const { data } = await hrApiClient.get('/hr/employees/me');
    const ctx = {
      companyIdPath: data.companyId || '',
      siteIdPath:    data.siteId    || '',
      // Normalize to lowercase — backend now returns it lowercase, but guard for safety
      weekStartDay:  (data.weekStartDay || DEFAULT_WEEK_START_DAY).toLowerCase(),
    };
    _userWeekCtxCache.set(userId, ctx);
    return ctx;
  } catch {
    const fallback = { companyIdPath: '', siteIdPath: '', weekStartDay: DEFAULT_WEEK_START_DAY };
    _userWeekCtxCache.set(userId, fallback);
    return fallback;
  }

}

export function invalidateUserWeekContext(userId) {
  if (userId) _userWeekCtxCache.delete(userId);
  else _userWeekCtxCache.clear();
}

// ── Get company work schedule ─────────────────────────────────────────────────
export async function getCompanyWorkSchedule(companyIdPath) {
  const key = (companyIdPath || '').replace('companies/', '');
  if (!key) return {};
  if (_companyScheduleCache.has(key)) return _companyScheduleCache.get(key);

  try {
    const { data } = await hrApiClient.get(`/hr/companies/${key}/schedule`);
    const schedule = data.workSchedule || data || {};
    _companyScheduleCache.set(key, schedule);
    return schedule;
  } catch {
    return {};
  }
}

// ── Cache helpers ─────────────────────────────────────────────────────────────
export function invalidateTimesheetCache(userId, weekStr, datesToInvalidate = [], opts = {}) {
  const key = `${userId}_${weekStr}`;
  _timesheetMemCache.delete(key);
  if (opts.cascade) {
    // Invalidate surrounding weeks too
    _timesheetMemCache.forEach((_, k) => { if (k.startsWith(`${userId}_`)) _timesheetMemCache.delete(k); });
  }
}

// ── Normalize timesheet from REST ─────────────────────────────────────────────────────────
// ── Normalise a date-like value to YYYY-MM-DD string (safe for all inputs) ────
function toDateStr(val) {
  if (!val) return null;
  // Already date-only string
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  // ISO string with time part — strip it
  if (typeof val === 'string') {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  if (val instanceof Date && !isNaN(val.getTime())) return val.toISOString().slice(0, 10);
  return String(val).slice(0, 10); // last-resort truncation
}

function normalizeTimesheet(ts) {
  if (!ts) return null;
  const emp = ts.employee || {};

  // Convert backend hours (Decimal/number) → seconds for the totals object
  const totalHours    = Number(ts.totalHours    || 0);
  const regularHours  = Number(ts.regularHours  || 0);
  const overtimeHours = Number(ts.overtimeHours || 0);

  // ── period MUST be YYYY-MM-DD so processWeekData dates.includes(ts.period) works ──
  const periodStr = toDateStr(ts.period || ts.weekStart);
  const startStr  = toDateStr(ts.start  || ts.weekStart);
  const endStr    = toDateStr(ts.end    || ts.weekEnd);

  // ── Approval metadata — try nested relation or flat field ──────────────────
  const approverEmp = ts.approver || ts.approvedByEmployee || null;
  const approvedByName =
    ts.approvedByName ||
    (approverEmp ? `${approverEmp.firstName || ''} ${approverEmp.lastName || ''}`.trim() : null) ||
    null;

  // Normalise approvedAt to a plain JS Date (or keep ISO string) ─────────────
  const approvedAt = ts.approvedAt
    ? (ts.approvedAt instanceof Date ? ts.approvedAt : new Date(ts.approvedAt))
    : null;

  return {
    ...ts,
    id:            ts.id       || ts.timesheetId,
    userId:        ts.userId   || ts.employeeId || emp.id,
    companyId:     ts.companyId,
    // ✅ Always YYYY-MM-DD — critical for processWeekData matching
    period:        periodStr,
    start:         startStr,
    end:           endStr,
    weekStart:     startStr,
    weekEnd:       endStr,
    status:        ts.status   || 'draft',
    approvedByName,
    approvedAt,
    employee: {
      ...emp,
      displayName: emp.displayName || `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || 'Employee',
      primaryRole: emp.primaryRole || emp.hrRole || 'employee',
    },
    entries:  (ts.entries || ts.timeEntries || []).map(normalizeEntry),
    totals:   {
      grossSec:     totalHours    * 3600,
      effectiveSec: totalHours    * 3600,
      overtimeSec:  overtimeHours * 3600,
      regularSec:   regularHours  * 3600,
    },
    // Expose a `raw` block so ViewTimesheetModal can read weekKey, start, end, status
    raw: ts.raw || {
      weekKey:     periodStr && endStr ? `${periodStr}_${endStr}` : null,
      start:       startStr,
      end:         endStr,
      status:      ts.status || 'draft',
      totals: {
        grossSec:     totalHours    * 3600,
        effectiveSec: totalHours    * 3600,
        overtimeSec:  overtimeHours * 3600,
      },
    },
  };
}

function normalizeEntry(e) {
  if (!e) return e;
  // Derive date from clockIn if not explicitly set
  const date = e.date || (e.clockIn ? e.clockIn.split('T')[0] : null);
  // Compute gross seconds from totalMinutes (stored in backend)
  const grossSec = e.grossSec || e.durationGrossSec || (e.totalMinutes ? e.totalMinutes * 60 : 0);
  return {
    ...e,
    id:           e.id          || e.entryId,
    sessionId:    e.sessionId   || e.id,
    date,
    grossSec,
    effectiveSec: e.effectiveSec || e.durationEffectiveSec || grossSec,
    overtimeSec:  e.overtimeSec  || 0,
    source:       e.source       || e.entryType || 'clock',
  };
}


// ── Get timesheets by week (manager view) ─────────────────────────────────────
export async function getTimesheetsByWeek(companyId, weekStartStr) {
  const cacheKey = `all_${companyId}_${weekStartStr}`;
  if (_timesheetMemCache.has(cacheKey)) return _timesheetMemCache.get(cacheKey);

  try {
    const { data } = await hrApiClient.get('/hr/timesheets', {
      params: {
        weekStart: weekStartStr,
        companyId: companyId.replace('companies/', ''),
      },
    });
    const sheets = (data.timesheets || data || []).map(normalizeTimesheet);
    _timesheetMemCache.set(cacheKey, sheets);
    setTimeout(() => _timesheetMemCache.delete(cacheKey), 30_000); // 30s TTL
    return sheets;
  } catch (err) {
    if (err.response?.status === 403) return [];
    throw new Error(err.response?.data?.error || 'Failed to fetch timesheets');
  }
}

export async function fetchCompanyTimesheetsForWeek(companyId, weekStartStr) {
  return getTimesheetsByWeek(companyId, weekStartStr);
}

// ── Get timesheets in a date range (reporting/invoices) ────────────────────────
export async function getTimesheetsInRange(companyId, startDate, endDate) {
  try {
    const { data } = await hrApiClient.get('/hr/timesheets', {
      params: {
        startDate,
        endDate,
        companyId: companyId.replace('companies/', ''),
      },
    });
    return (data.timesheets || data || []).map(normalizeTimesheet);
  } catch (err) {
    if (err.response?.status === 403) return [];
    throw new Error(err.response?.data?.error || 'Failed to fetch timesheets in range');
  }
}

// ── Get user timesheets by week (employee view) ────────────────────────────────
export async function getUserTimesheetsByWeek(userId, companyId, weekStartStr) {
  const cacheKey = `${userId}_${weekStartStr}`;
  if (_timesheetMemCache.has(cacheKey)) return _timesheetMemCache.get(cacheKey);

  try {
    const { data } = await hrApiClient.get('/hr/timesheets', {
      params: {
        weekStart:  weekStartStr,
        employeeId: userId,
      },
    });
    const sheets = (data.timesheets || data || []).map(normalizeTimesheet);
    _timesheetMemCache.set(cacheKey, sheets);
    setTimeout(() => _timesheetMemCache.delete(cacheKey), 30_000);
    return sheets;
  } catch (err) {
    if (err.response?.status === 404) return [];
    throw new Error(err.response?.data?.error || 'Failed to fetch timesheets');
  }
}

// ── Ensure weekly timesheet exists ────────────────────────────────────────────
export async function ensureWeeklyTimesheet(userId, dateStr, companyIdPath) {
  if (!dateStr || !userId) return null;
  const { start: weekStart, end: weekEnd } = getWeekRangeForDate(dateStr, DEFAULT_WEEK_START_DAY);
  const weekStartStr = formatISODateUtil(weekStart);
  const weekEndStr   = formatISODateUtil(weekEnd);

  try {
    const { data } = await hrApiClient.post('/hr/timesheets/ensure', {
      employeeId: userId,
      weekStart:  weekStartStr,
      weekEnd:    weekEndStr,
      companyId:  companyIdPath ? companyIdPath.replace('companies/', '') : null,
    });
    return data?.id || getTimesheetId(userId, dateStr);
  } catch (err) {
    // If already exists (409), that's fine
    if (err.response?.status === 409) return getTimesheetId(userId, dateStr);
    console.warn('[ensureWeeklyTimesheet]', err.message);
    return getTimesheetId(userId, dateStr);
  }
}

// ── Upsert daily entry (called from timeClock.js after clock-out) ─────────────
// Server handles the actual persistence via /hr/time-entries/clock-out.
// This function now acts as a client-side cache invalidator + confirmation.
export async function upsertDailyEntry({
  userId, companyId, siteId, dateStr, sessionId,
  grossSec, effectiveSec, overtimeSec = 0,
  roundedStart = null, roundedEnd = null,
  rawStart = null, rawEnd = null,
  rawDurationSec = 0, rawEffectiveSec = 0,
  breakMeta = {}, location, clockOutLocation,
  deviceInfo, clockOutDeviceInfo,
  pupilCount, notes, status = 'closed', autoClockOut = false,
}) {
  // Server already persisted the time entry via clock-out endpoint.
  // Invalidate local cache so next fetch gets fresh data.
  const { start } = getWeekRangeForDate(dateStr, DEFAULT_WEEK_START_DAY);
  const weekStr   = formatISODateUtil(start);
  invalidateTimesheetCache(userId, weekStr, [dateStr], { cascade: false });

  // Return a synthetic entry ID for backward compat (callers only use this for logging)
  return sessionId || generateEntryId();
}

// ── Update a time entry ───────────────────────────────────────────────────────
export async function updateTimeEntry({ userId, dateStr, sessionId, entryId, updates, originalClockIn }) {
  if (!userId) throw new Error('UserId is required');

  const payload = {
    clockIn:  updates?.clockIn  || null,
    clockOut: updates?.clockOut || null,
    breakMin: updates?.breakMin ?? null,
    notes:    updates?.notes    ?? null,
    date:     dateStr,
  };

  const id = entryId || sessionId;
  if (!id) throw new Error('entryId or sessionId is required');

  try {
    const { data } = await hrApiClient.put(`/hr/time-entries/${id}`, payload);
    invalidateTimesheetCache(userId, dateStr, [dateStr], { cascade: true });
    return { success: true, updatedTimesheet: data };
  } catch (err) {
    if (err.response?.status === 404) throw new Error('Time entry not found');
    throw new Error(err.response?.data?.error || 'Failed to update time entry');
  }
}

// ── Update entry description/notes only ──────────────────────────────────────
export async function updateEntryDescription(userId, dateStr, entryId, description) {
  return updateTimeEntry({ userId, dateStr, entryId, updates: { notes: description } });
}

// ── Delete a time entry ───────────────────────────────────────────────────────
export async function deleteTimeEntry(userId, dateStr, entryId, sessionId) {
  const id = entryId || sessionId;
  if (!id) throw new Error('entryId or sessionId is required');

  try {
    await hrApiClient.delete(`/hr/time-entries/${id}`);
    invalidateTimesheetCache(userId, dateStr, [dateStr], { cascade: true });
    return { success: true };
  } catch (err) {
    if (err.response?.status === 404) throw new Error('Time entry not found');
    throw new Error(err.response?.data?.error || 'Failed to delete time entry');
  }
}

export async function addManualTimeEntry(
  firstArg,
  _date,
  _clockIn,
  _clockOut,
  _weekStartDay,
  _timesheetId,
  _options = {}
) {
  let userId, companyId, siteId, date, clockIn, clockOut;
  let breakMin = 0;
  let notes = '';
  let source = 'manual';

  if (firstArg && typeof firstArg === 'object') {
    userId = firstArg.userId;
    companyId = firstArg.companyId;
    siteId = firstArg.siteId;
    date = firstArg.date;
    clockIn = firstArg.clockIn;
    clockOut = firstArg.clockOut;
    breakMin = firstArg.breakMin ?? firstArg.breakMinutes ?? 0;
    notes = firstArg.notes ?? '';
    source = firstArg.source ?? 'manual';
  } else {
    userId = firstArg;
    date = _date;
    clockIn = _clockIn;
    clockOut = _clockOut;
    siteId = _options?.siteId || null;
    breakMin = _options?.breakMin || _options?.breakMinutes || 0;
    notes = _options?.notes || _options?.description || '';
    source = _options?.source || 'manual';
  }

  const payload = {
    employeeId: userId,
    date,
    clockIn,
    clockOut,
    breakMinutes: breakMin,
    notes,
    source,
    siteId: siteId || null,
  };

  try {
    const { data } = await hrApiClient.post('/hr/time-entries', payload);
    invalidateTimesheetCache(userId, date, [date], { cascade: true });
    return normalizeEntry(data);
  } catch (err) {
    if (err.response?.status === 409) throw new Error('A time entry already exists for this period');
    throw new Error(err.response?.data?.error || 'Failed to add time entry');
  }
}

// ── Submit week for approval ───────────────────────────────────────────────────
export async function submitWeek(userId, companyId, weekStartStr) {
  try {
    // Step 1: ensure the timesheet exists and get its ID
    const ensureRes = await hrApiClient.post('/hr/timesheets/ensure', {
      employeeId: userId,
      weekStart:  weekStartStr,
    });
    const timesheetId = ensureRes.data?.id;
    if (!timesheetId) throw new Error('Could not find or create timesheet');

    // Step 2: submit it
    const { data } = await hrApiClient.post(`/hr/timesheets/${timesheetId}/submit`);
    invalidateTimesheetCache(userId, weekStartStr, [], { cascade: true });
    return { success: true, ...data };
  } catch (err) {
    if (err.response?.status === 404) throw new Error('Timesheet not found for this week');
    if (err.response?.status === 400) throw new Error(err.response?.data?.error || 'Cannot submit timesheet in its current state');
    throw new Error(err.response?.data?.error || err.message || 'Failed to submit timesheet');
  }
}


// ── Approve timesheet ─────────────────────────────────────────────────────────
export async function approveTimesheet(timesheetId, approverId, approverName) {
  try {
    const { data } = await hrApiClient.post(`/hr/timesheets/${timesheetId}/approve`, {
      approverId,
      approverName: approverName || null,
    });
    _timesheetMemCache.clear(); // Clear all caches on approval
    return { success: true, ...data };
  } catch (err) {
    if (err.response?.status === 404) throw new Error('Timesheet not found');
    if (err.response?.status === 403) throw new Error('Permission denied');
    throw new Error(err.response?.data?.error || 'Failed to approve timesheet');
  }
}

// ── Decline timesheet ─────────────────────────────────────────────────────────
export async function declineTimesheet(timesheetId, reason, declinerId) {
  try {
    const { data } = await hrApiClient.post(`/hr/timesheets/${timesheetId}/reject`, {
      reason,
      declinerId: declinerId || null,
    });
    _timesheetMemCache.clear();
    return { success: true, ...data };
  } catch (err) {
    if (err.response?.status === 404) throw new Error('Timesheet not found');
    if (err.response?.status === 403) throw new Error('Permission denied');
    throw new Error(err.response?.data?.error || 'Failed to decline timesheet');
  }
}

// ── Fetch week details (used by EditTimesheetModal, TimesheetArchivePage) ──────
// Supports both:  fetchWeekDetails(userId, weekStartStr)
//           and:  fetchWeekDetails(userId, companyId, weekStartStr)   ← legacy 3-arg form
export async function fetchWeekDetails(userId, companyIdOrWeekStart, weekStartStrOrUndef) {
  // Detect call style by checking if 3rd arg is provided
  const weekStartStr = weekStartStrOrUndef !== undefined ? weekStartStrOrUndef : companyIdOrWeekStart;

  const timesheets = await getUserTimesheetsByWeek(userId, '', weekStartStr);
  const ts         = timesheets.find((t) => t.period === weekStartStr || t.start === weekStartStr)
    || timesheets[0]; // fall back to first result if exact match missed
  if (!ts) return null;

  return {
    ...ts,
    weekDays: getOrderedWeekDates(weekStartStr, ts.weekStartDay || DEFAULT_WEEK_START_DAY),
  };
}


// ── Save week edits (UnifiedTimesheetEditor, TimesheetUpdateManager) ──────────
export async function saveWeekEdits(userId, dayEdits, createDateTimeFromStrings) {
  if (!dayEdits?.length) return { success: true, affected: 0 };

  const results = await Promise.allSettled(
    dayEdits.map(async (edit) => {
      let clockInISO  = null;
      let clockOutISO = null;
      if (edit.clockIn  && createDateTimeFromStrings) {
        const d = createDateTimeFromStrings(edit.date, edit.clockIn);
        if (!isNaN(d?.getTime())) clockInISO = d.toISOString();
      }
      if (edit.clockOut && createDateTimeFromStrings) {
        const d = createDateTimeFromStrings(edit.date, edit.clockOut);
        if (!isNaN(d?.getTime())) clockOutISO = d.toISOString();
      }

      return updateTimeEntry({
        userId,
        dateStr:   edit.date,
        entryId:   edit.entryId,
        sessionId: edit.sessionId,
        updates: {
          clockIn:  clockInISO,
          clockOut: clockOutISO,
          breakMin: edit.breakMin,
          notes:    edit.notes || edit.description,
        },
      });
    })
  );

  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length) {
    throw new Error(failed[0].reason?.message || 'Failed to save some edits');
  }

  return { success: true, affected: dayEdits.length, updatedTimesheet: null };
}

// ── Trigger PDF archive ───────────────────────────────────────────────────────
export async function triggerTimesheetArchive(timesheetId, userId, weekStartStr) {
  try {
    await hrApiClient.post(`/hr/timesheets/${timesheetId}/archive`);
    return true;
  } catch {
    // Non-fatal
    return false;
  }
}

// ── Recompute timesheets safe (called from SettingsPage) ──────────────────────
export async function recomputeTimesheetsSafe(companyId, options = {}) {
  try {
    const { data } = await hrApiClient.post('/hr/timesheets/recompute', { companyId });
    _timesheetMemCache.clear();
    return { success: true, ...data };
  } catch {
    return { success: false };
  }
}

// ── Reconcile timesheet for week ──────────────────────────────────────────────
export async function reconcileTimesheetForWeek(userId, companyId, weekStartStr, weekStartDay, weekEndStr) {
  try {
    const { data } = await hrApiClient.post('/hr/timesheets/reconcile', {
      employeeId: userId,
      weekStart:  weekStartStr,
      weekEnd:    weekEndStr   || null,
      weekStartDay: weekStartDay || DEFAULT_WEEK_START_DAY,
    });
    invalidateTimesheetCache(userId, weekStartStr, [], { cascade: true });
    return normalizeTimesheet(data);
  } catch {
    return null;
  }
}

// ── Fetch week details for modal ──────────────────────────────────────────────
export { fetchWeekDetails as fetchWeekDetailsForModal };

// ── Delete timesheet (used by ViewTimesheetModal delete confirmation) ──────────
export async function deleteTimesheet(timesheetId, userId) {
  try {
    await hrApiClient.delete(`/hr/timesheets/${timesheetId}`);
    _timesheetMemCache.clear();
    return { success: true };
  } catch (err) {
    if (err.response?.status === 404) throw new Error('Timesheet not found');
    if (err.response?.status === 403) throw new Error('Permission denied');
    throw new Error(err.response?.data?.error || 'Failed to delete timesheet');
  }
}

// ── Prime user week context (internal helper used by timesheetCreation etc.) ──
export function primeUserWeekContext(userId, companyIdPath, siteIdPath, weekStartDay) {
  if (!userId) return;
  _userWeekCtxCache.set(userId, {
    companyIdPath: companyIdPath || '',
    siteIdPath:    siteIdPath    || '',
    weekStartDay:  weekStartDay  || DEFAULT_WEEK_START_DAY,
  });
}


export async function updateDayDescription(userIdOrObj, dateStr, description) {
  // Support both legacy positional args and new object-based call from ViewTimesheetModal
  let userId, dateStrResolved, notes, weekStartDay;

  if (userIdOrObj && typeof userIdOrObj === 'object') {
    ({ userId, dateStr: dateStrResolved, notes, weekStartDay } = userIdOrObj);
    description = notes;
  } else {
    userId = userIdOrObj;
    dateStrResolved = dateStr;
  }

  if (!userId) throw new Error('userId is required');
  if (!dateStrResolved) throw new Error('dateStr is required');

  // Fetch entries for this day to get real entryIds
  try {
    const { data } = await hrApiClient.get('/hr/time-entries', {
      params: { userId, date: dateStrResolved },
    });

    const entries = data?.entries || data || [];
    if (entries.length === 0) {
      // No entries for this day — nothing to update (caller handles creation)
      return { success: true, count: 0 };
    }

    // Update notes on each entry for the day
    let count = 0;
    for (const entry of entries) {
      const entryId = entry.id || entry.entryId || entry.sessionId;
      if (!entryId) continue;
      await updateTimeEntry({ userId, dateStr: dateStrResolved, entryId, updates: { notes: description ?? '' } });
      count++;
    }
    return { success: true, count };
  } catch (err) {
    // Fallback: try updateEntryDescription with a direct API call if time-entries list fails
    throw new Error(err.message || 'Failed to update day description');
  }
}

// ── Subscribe to timesheets ────────────────────────────────────────────────────

// Phase 6: WS integration
export function subscribeToTimesheets(userId, companyId, weekStartStr, callback) {
  const fetch = () =>
    getUserTimesheetsByWeek(userId, companyId, weekStartStr)
      .then(callback)
      .catch((err) => console.warn('[timesheets] subscription fetch failed:', err));

  fetch(); // Initial fetch
  
  const onFocus = () => fetch();
  window.addEventListener('focus', onFocus);

  // WebSocket handler
  const wsHandler = () => fetch();
  wsClient.on('timesheet:updated', wsHandler);

  return () => {
    window.removeEventListener('focus', onFocus);
    wsClient.off('timesheet:updated', wsHandler);
  };
}

/**
 * Subscribe to all timesheets in a company (manager view)
 */
export function subscribeToCompanyTimesheets(companyId, callback) {
  const fetch = () =>
    getTimesheetsByWeek(companyId, '') // Empty string fetches recent
      .then(callback)
      .catch((err) => console.warn('[timesheets] manager subscription fetch failed:', err));

  fetch();

  const onFocus = () => fetch();
  window.addEventListener('focus', onFocus);

  const wsHandler = () => fetch();
  wsClient.on('timesheet:updated', wsHandler);

  return () => {
    window.removeEventListener('focus', onFocus);
    wsClient.off('timesheet:updated', wsHandler);
  };
}

// ── Re-export reconcileTimesheetForWeek to callers who import it from here ────
export { reconcileTimesheetForWeek as default };

// ── Backward-compat aliases ───────────────────────────────────────────────────
// submitCurrentWeek → submitWeek (used by TimesheetTab.jsx)
export const submitCurrentWeek = submitWeek;

// ── Bulk / manager utilities (used by useTimesheetData.js hook) ───────────────

/**
 * Fetch weekly summaries for a user (replaces Firestore "summary" collection)
 */
export async function fetchWeeklySummaries(userId, maxWeeks = 12) {
  try {
    const { data } = await hrApiClient.get('/hr/timesheets', {
      params: { employeeId: userId, limit: maxWeeks },
    });
    return (data.timesheets || data || []).map(normalizeTimesheet);
  } catch (err) {
    if (err.response?.status === 404 || err.response?.status === 403) return [];
    throw new Error(err.response?.data?.error || 'Failed to fetch weekly summaries');
  }
}

/**
 * Fetch timesheets for multiple users (manager batch view)
 */
export async function fetchTimesheetsForUsers(userIds, options = {}) {
  const { maxWeeks = 4 } = options;
  const results = {};
  await Promise.allSettled(
    userIds.map(async (uid) => {
      try {
        const sheets = await fetchWeeklySummaries(uid, maxWeeks);
        results[uid] = sheets;
      } catch {
        results[uid] = [];
      }
    })
  );
  return results;
}

/**
 * Fetch pending approvals for a manager.
 * Backend stores submitted timesheets with status = 'submitted'.
 * JWT scope already limits results to the manager's company.
 */
export async function fetchPendingApprovalsForManager(managerId, options = {}) {
  try {
    const { data } = await hrApiClient.get('/hr/timesheets', {
      // 'submitted' is the backend status for timesheets awaiting approval
      params: { status: 'submitted', limit: 100 },
    });
    return (data.timesheets || data || []).map(normalizeTimesheet);
  } catch (err) {
    if (err.response?.status === 403) return [];
    throw new Error(err.response?.data?.error || 'Failed to fetch pending approvals');
  }
}


/**
 * Prefetch adjacent weeks (background warm-up, non-fatal)
 */
export async function prefetchAdjacentWeeks(userId, weekStart, options = {}) {
  const { weeksBefore = 1, weeksAfter = 1 } = options;
  // Fire-and-forget — errors here are non-fatal
  const ms     = 7 * 24 * 60 * 60 * 1000;
  const base   = new Date(weekStart instanceof Date ? weekStart : weekStart + 'T00:00:00');
  const weeks  = [];
  for (let i = 1; i <= weeksBefore; i++) {
    weeks.push(new Date(base.getTime() - i * ms));
  }
  for (let i = 1; i <= weeksAfter; i++) {
    weeks.push(new Date(base.getTime() + i * ms));
  }
  await Promise.allSettled(
    weeks.map((d) => {
      const ws = formatISODateUtil(d);
      return getUserTimesheetsByWeek(userId, '', ws).catch(() => {});
    })
  );
}