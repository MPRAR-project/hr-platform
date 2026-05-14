/**
 * dashboardData.js — Phase 4 Migration (REST Only)
 *
 * Replaces multiple Firestore queries with a single
 * GET /hr/dashboard call that returns a role-aware aggregated view.
 * All exported function names preserved for backward compatibility.
 */

import hrApiClient from '../lib/hrApiClient';

// ── Get Dashboard Summary ────────────────────────────────────────────────────
export async function getDashboardSummary(user) {
  try {
    const { data } = await hrApiClient.get('/hr/dashboard');
    return normalizeDashboard(data, user);
  } catch (err) {
    if (err.response?.status === 403) return getEmptyDashboard();
    throw new Error(err.response?.data?.error || 'Failed to fetch dashboard data');
  }
}

// ── Get Company Dashboard (manager view) ──────────────────────────────────────
export async function getCompanyDashboard(companyId) {
  try {
    const { data } = await hrApiClient.get('/hr/dashboard');
    return normalizeDashboard(data);
  } catch (err) {
    if (err.response?.status === 403) return getEmptyDashboard();
    throw new Error(err.response?.data?.error || 'Failed to fetch company dashboard');
  }
}

// ── Get Employee Self-Service Dashboard ───────────────────────────────────────
export async function getEmployeeDashboard(userId) {
  try {
    const { data } = await hrApiClient.get('/hr/dashboard');
    return normalizeDashboard(data);
  } catch (err) {
    if (err.response?.status === 403) return getEmptyDashboard();
    throw new Error(err.response?.data?.error || 'Failed to fetch employee dashboard');
  }
}

// ── Get Active Clock Sessions ─────────────────────────────────────────────────
export async function getActiveSessions(companyId) {
  try {
    const { data } = await hrApiClient.get('/hr/time-entries/active-sessions');
    return data.activeSessions || data || [];
  } catch (err) {
    if (err.response?.status === 403) return [];
    return [];
  }
}

// ── Get Pending Absences Count ────────────────────────────────────────────────
export async function getPendingAbsencesCount(companyId) {
  try {
    const { data } = await hrApiClient.get('/hr/dashboard');
    return data.pendingAbsences || data.pendingAbsencesCount || 0;
  } catch {
    return 0;
  }
}

// ── Get Weekly Summary ────────────────────────────────────────────────────────
export async function getWeeklySummary(companyId, weekStart) {
  try {
    const { data } = await hrApiClient.get('/hr/timesheets/week-summary', {
      params: { weekStart: weekStart instanceof Date ? weekStart.toISOString().split('T')[0] : weekStart },
    });
    return data;
  } catch (err) {
    if (err.response?.status === 403) return {};
    throw new Error(err.response?.data?.error || 'Failed to fetch weekly summary');
  }
}

// ── Normalise dashboard shape ─────────────────────────────────────────────────
function normalizeDashboard(data, user) {
  // Server returns both manager and employee shapes
  // Expose all fields — pages use what they need
  return {
    // Manager fields
    totalEmployees:         data.totalEmployees         || 0,
    activeEmployees:        data.activeEmployees         || 0,
    pendingAbsences:        data.pendingAbsences         || 0,
    pendingAbsencesCount:   data.pendingAbsences         || 0,
    activeSessions:         data.activeSessions          || [],
    activeSessionsCount:    data.activeSessionsCount     || (data.activeSessions || []).length,
    weeklyHours:            data.weeklyHours             || 0,
    approvedTimesheets:     data.approvedTimesheets      || 0,
    pendingTimesheets:      data.pendingTimesheets        || 0,
    teamSize:               data.teamSize                || data.totalEmployees || 0,
    weekStartDay:           data.weekStartDay            || 'monday',

    // Employee fields
    myHoursThisWeek:        data.myHoursThisWeek         || 0,
    myAbsencesThisYear:     data.myAbsencesThisYear      || 0,
    myPendingAbsences:      data.myPendingAbsences        || 0,
    myCurrentTimesheet:     data.myCurrentTimesheet       || null,
    myActiveSession:        data.myActiveSession          || null,
    myNotificationsUnread:  data.myNotificationsUnread    || 0,
    myAllowances:           data.myAllowances             || [],

    // Raw data for pages that render their own UI
    _raw: data,
  };
}

function getEmptyDashboard() {
  return normalizeDashboard({});
}

// ── Default export (backward compat) ──────────────────────────────────────────
const dashboardData = {
  getDashboardSummary,
  getCompanyDashboard,
  getEmployeeDashboard,
  getActiveSessions,
  getPendingAbsencesCount,
  getWeeklySummary,
};

export default dashboardData;