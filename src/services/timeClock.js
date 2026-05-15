/**
 * timeClock.js — Phase 4 Migration (REST Only)
 *
 * Replaces all Firestore reads/writes with HR REST API calls.
 * All local computation (rounding, auto-lunch, overtime) is preserved
 * — only the persistence layer changes.
 *
 * Server-side: the HR backend handles final timesheet record creation
 * via POST /hr/time-entries/clock-in and POST /hr/time-entries/clock-out.
 * Local post-processing (display rounding, overtime hints) still happens
 * client-side so the UI feels instant.
 */

import hrApiClient from '../lib/hrApiClient';
import { getUserCurrentLocation } from './locationService';

// ── Device info helper ────────────────────────────────────────────────────────
function getDeviceInfo() {
  const ua = navigator.userAgent;
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  return {
    type: 'web',
    platform: isMobile ? 'mobile_web' : 'desktop_web',
    userAgent: ua,
  };
}

// ── Location helper ───────────────────────────────────────────────────────────
async function captureLocation(assignedLocationId = null, assignedLocationName = null) {
  try {
    const loc = await getUserCurrentLocation();
    return {
      lat: loc.latitude,
      lng: loc.longitude,
      accuracy: loc.accuracy,
      capturedAt: new Date().toISOString(),
      assignedLocationId: assignedLocationId || null,
      assignedLocationName: assignedLocationName || null,
    };
  } catch (err) {
    return {
      error: err.message,
      code: err.code || 'UNKNOWN',
      capturedAt: new Date().toISOString(),
      assignedLocationId: assignedLocationId || null,
      assignedLocationName: assignedLocationName || null,
    };
  }
}

// ── Clock In ─────────────────────────────────────────────────────────────────
export async function startClock({
  userId,
  companyId,
  siteId,
  assignedLocationId = null,
  assignedLocationName = null,
  startedAt = null,
  notes = null,
}) {
  const location   = await captureLocation(assignedLocationId, assignedLocationName);
  const deviceInfo = getDeviceInfo();

  const payload = {
    siteId:               siteId || null,
    notes:                notes  || null,
    startedAt:            startedAt ? (startedAt instanceof Date ? startedAt.toISOString() : startedAt) : null,
    location,
    deviceInfo,
    assignedLocationId:   assignedLocationId   || null,
    assignedLocationName: assignedLocationName || null,
  };

  try {
    const { data } = await hrApiClient.post('/hr/time-entries/clock-in', payload);

    return {
      sessionId:    data.timeEntry?.id || data.id,
      roundedStart: data.timeEntry?.clockIn || data.clockIn,
      entryId:      data.timeEntry?.id || data.id,
    };
  } catch (err) {
    const msg = err.response?.data?.error || err.message;
    if (err.response?.status === 409) {
      throw new Error('Already clocked in. Please clock out first.');
    }
    if (err.response?.status === 403) {
      throw new Error('Your account is inactive. You cannot clock in.');
    }
    throw new Error(msg || 'Clock-in failed. Please try again.');
  }
}

// ── Clock Out ────────────────────────────────────────────────────────────────
export async function stopClock({
  userId,
  sessionId = null,
  breakSec = 0,
  endedAt = null,
  pupilCount = null,
  notes = null,
}) {
  // Get open session if sessionId not provided
  let entryId = sessionId;
  if (!entryId) {
    try {
      const { data } = await hrApiClient.get('/hr/time-entries/my-session');
      entryId = data?.id;
    } catch {
      throw new Error('No active clock session found. Please clock in first.');
    }
  }
  if (!entryId) {
    throw new Error('No active clock session found. Please clock in first.');
  }

  const location   = await captureLocation();
  const deviceInfo = getDeviceInfo();

  const payload = {
    endedAt:      endedAt ? (endedAt instanceof Date ? endedAt.toISOString() : endedAt) : null,
    breakSec:     breakSec || 0,
    notes:        notes    || null,
    pupilCount:   pupilCount !== null ? pupilCount : null,
    clockOutLocation:   location,
    clockOutDeviceInfo: deviceInfo,
  };

  try {
    const { data } = await hrApiClient.post('/hr/time-entries/clock-out', {
      ...payload,
      entryId,
    });

    return {
      sessionId:            entryId,
      overtimeSec:          data.overtimeSec          || 0,
      breakSec:             data.breakSec             || breakSec,
      durationGrossSec:     data.durationGrossSec     || 0,
      durationEffectiveSec: data.durationEffectiveSec || 0,
      autoLunchApplied:     data.autoLunchApplied     || false,
      autoLunchBreakSec:    data.autoLunchBreakSec    || 0,
      roundedEnd:           data.clockOut             || null,
    };
  } catch (err) {
    const msg = err.response?.data?.error || err.message;
    if (err.response?.status === 404) {
      throw new Error('Active session not found. It may have already been closed.');
    }
    throw new Error(msg || 'Clock-out failed. Please try again.');
  }
}

// ── Get My Active Session ─────────────────────────────────────────────────────
export async function getMyActiveSession(userId) {
  try {
    const { data } = await hrApiClient.get('/hr/time-entries/my-session');
    if (!data) return null;
    // Normalize shape to match what UI components expect
    return {
      sessionId:   data.id,
      id:          data.id,
      userId:      data.employeeId,
      companyId:   data.companyId,
      siteId:      data.siteId,
      startedAt:   data.clockIn,
      status:      data.clockOut ? 'closed' : 'open',
      breakSec:    data.breakMinutes ? data.breakMinutes * 60 : 0,
      notes:       data.notes,
      location:    data.location,
    };
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw err;
  }
}

// ── Get All Active Sessions (Manager view) ────────────────────────────────────
export async function getActiveSessionsForCompany(companyId) {
  try {
    const { data } = await hrApiClient.get('/hr/time-entries/active-sessions');
    return (data.activeSessions || data || []).map((s) => ({
      sessionId:   s.id,
      id:          s.id,
      userId:      s.employeeId,
      companyId:   s.companyId,
      siteId:      s.siteId,
      startedAt:   s.clockIn,
      status:      'open',
      breakSec:    s.breakMinutes ? s.breakMinutes * 60 : 0,
      employeeName: s.employee
        ? [s.employee.firstName, s.employee.lastName].filter(Boolean).join(' ')
        : null,
    }));
  } catch (err) {
    if (err.response?.status === 403) return [];
    throw err;
  }
}

// ── Start Break ───────────────────────────────────────────────────────────────
// Kept as client-side state for now (break timing is local UX, not server-persisted)
// Server receives final breakSec on clock-out.
let breakStartTime = null;

export async function startBreak({ userId, sessionId = null }) {
  if (breakStartTime) throw new Error('Already on break.');
  breakStartTime = Date.now();
  return {
    sessionId:      sessionId,
    breakStartTime: new Date(breakStartTime),
  };
}

export async function endBreak({ userId, sessionId = null }) {
  if (!breakStartTime) throw new Error('Not currently on break.');
  const now             = Date.now();
  const breakDurationSec = Math.floor((now - breakStartTime) / 1000);
  breakStartTime        = null;
  return {
    sessionId:      sessionId,
    breakDurationSec,
    totalBreakSec:  breakDurationSec, // caller accumulates
  };
}

// ── Get Sessions for Date Range ───────────────────────────────────────────────
export async function getSessionsForDateRange({ userId, companyId, startDate, endDate }) {
  try {
    const { data } = await hrApiClient.get('/hr/time-entries', {
      params: {
        startDate: startDate instanceof Date ? startDate.toISOString().split('T')[0] : startDate,
        endDate:   endDate   instanceof Date ? endDate.toISOString().split('T')[0]   : endDate,
      },
    });
    return (data.entries || data || []).map(normalizeEntry);
  } catch (err) {
    if (err.response?.status === 404) return [];
    throw err;
  }
}

// ── Get Single Session ────────────────────────────────────────────────────────
export async function getSessionById(sessionId) {
  try {
    const { data } = await hrApiClient.get(`/hr/time-entries/${sessionId}`);
    return normalizeEntry(data);
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw err;
  }
}

// ── Normalize entry shape ─────────────────────────────────────────────────────
function normalizeEntry(e) {
  return {
    id:          e.id,
    sessionId:   e.id,
    userId:      e.employeeId,
    companyId:   e.companyId,
    siteId:      e.siteId,
    startedAt:   e.clockIn,
    endedAt:     e.clockOut,
    status:      e.clockOut ? 'closed' : 'open',
    durationGrossSec:     e.durationGrossSec     || 0,
    durationEffectiveSec: e.durationEffectiveSec || 0,
    overtimeSec:          e.overtimeSec          || 0,
    breakSec:    e.breakMinutes ? e.breakMinutes * 60 : 0,
    notes:       e.notes,
    location:    e.location,
  };
}

export { normalizeEntry as normalizeSession };