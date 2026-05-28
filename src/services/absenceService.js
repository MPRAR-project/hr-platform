/**
 * absenceService.js — Phase 4 Migration (REST Only)
 *
 * Replaces all Firestore reads/writes with HR REST API calls.
 * Class shape preserved — all imports across 30+ pages still work.
 *
 * Key decisions:
 *  - Business logic (duration calc, sick-leave auto-approve) kept client-side
 *    for UX speed, server enforces independently
 *  - allowanceService dependency maintained for enrichment
 *  - All method signatures identical to original
 */

import hrApiClient from '../lib/hrApiClient';
import wsClient from '../lib/wsClient';
import { allowanceService } from './allowanceService';
import { safeParseDate } from '../utils/safeDateParse';

// ── Role helpers ──────────────────────────────────────────────────────────────
const MANAGER_ROLES = [
  'superUser', 'siteManager', 'seniorManager', 'hrManager',
  'hrAdvisor', 'adminManager', 'adminAdvisor', 'teamManager',
];

const canApprove = (role) =>
  ['superUser', 'siteManager', 'seniorManager', 'hrManager',
   'hrAdvisor', 'adminManager', 'adminAdvisor'].includes(role);

// ── Date & duration helpers ───────────────────────────────────────────────────
function calcDurationDays(startingDate, endingDate) {
  const s   = safeParseDate(startingDate);
  const e   = safeParseDate(endingDate);
  const raw = Math.ceil((e.getTime() - s.getTime()) / 86400000) + 1;
  return Math.max(1, Math.min(365, raw));
}

function normalizeDateFields(data) {
  if (!data) return data;
  // Convert Firestore-style timestamps to ISO strings for display
  const out = { ...data };
  ['createdAt', 'updatedAt', 'submittedDate', 'approvedDate', 'declinedDate'].forEach((k) => {
    if (out[k]?.toDate) out[k] = out[k].toDate().toISOString();
    else if (out[k]?.seconds) out[k] = new Date(out[k].seconds * 1000).toISOString();
  });
  if (out.absenceType && !out.leaveType) {
    out.leaveType = out.absenceType;
  }
  if (out.leaveType && !out.absenceType) {
    out.absenceType = out.leaveType;
  }
  return out;
}

// ── AbsenceService class ──────────────────────────────────────────────────────
class AbsenceService {
  constructor() {
    this.collection = 'absences'; // kept for backward compat references
  }

  // ── Create ──────────────────────────────────────────────────────────────────
  async createAbsence(absenceData, userId) {
    const durationDays      = calcDurationDays(absenceData.startingDate, absenceData.endingDate);
    const normalizedLeaveType = (allowanceService.normalizeLeaveType || ((t) => (t || '').toLowerCase().replace(/\s/g, '')))(absenceData.leaveType);
    const isSickLeave         = normalizedLeaveType === 'sickleave' || normalizedLeaveType === 'sick_leave';

    // Check allowance (non-fatal)
    let allowanceCheck = { canAutoApprove: false, hasAllowance: false, reason: 'No allowance configured' };
    try {
      allowanceCheck = await allowanceService.checkAutoApproval(userId, absenceData.leaveType, durationDays);
    } catch { /* non-fatal */ }

    const status          = isSickLeave ? 'Approved' : 'Pending';
    const approvalReason  = isSickLeave
      ? 'Automatic approval: Sick Leave Policy'
      : `Manual approval required${allowanceCheck.reason ? ': ' + allowanceCheck.reason : ''}`;

    const payload = {
      ...absenceData,
      absenceType:  absenceData.leaveType || absenceData.leave || absenceData.absenceType,
      startDate:    absenceData.startingDate,
      endDate:      absenceData.endingDate,
      duration:     `${durationDays} days`,
      durationDays,
      status,
      allowanceInfo: allowanceCheck.hasAllowance ? {
        totalDays:         allowanceCheck.totalDays,
        usedDays:          allowanceCheck.usedDays,
        remainingDays:     allowanceCheck.remainingDays,
        autoApprovalReason: approvalReason,
      } : null,
      ...(isSickLeave && {
        approvedBy:     'System',
        approvalReason,
      }),
    };

    // Remove undefined
    Object.keys(payload).forEach((k) => { if (payload[k] === undefined) delete payload[k]; });

    try {
      const { data } = await hrApiClient.post('/hr/absences', payload);
      return normalizeDateFields({ ...data });
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      throw new Error(msg || 'Failed to create absence request');
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
  async deleteAbsence(absenceId, currentUser) {
    // Permission check done server-side; include user context
    try {
      await hrApiClient.delete(`/hr/absences/${absenceId}`);
      return true;
    } catch (err) {
      if (err.response?.status === 403) throw new Error('You do not have permission to delete this absence request');
      if (err.response?.status === 404) throw new Error('Absence not found');
      throw new Error(err.response?.data?.error || 'Failed to delete absence');
    }
  }

  // ── Get My Absences ──────────────────────────────────────────────────────────
  async getUserAbsences(userId) {
    try {
      const { data } = await hrApiClient.get('/hr/absences');
      return (data.absences || data || []).map(normalizeDateFields);
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Failed to fetch absences');
    }
  }

  // ── Get Employee Absences (role-based) ────────────────────────────────────
  async getEmployeeAbsences(currentUser) {
    try {
      const { data } = await hrApiClient.get('/hr/absences');
      const absences = (data.absences || data || []).map(normalizeDateFields);

      // Enrich with allowances for managers (only if feasible count)
      if (MANAGER_ROLES.includes(currentUser.role) && absences.length <= 50) {
        await this._batchEnrichAllowances(absences);
      }
      return absences;
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Failed to fetch employee absences');
    }
  }

  // ── Get Employee Absences (paginated) ────────────────────────────────────
  async getEmployeeAbsencesPaginated(currentUser, options = {}) {
    const { limitCount = 50, startDate = null, enrichWithAllowances = false } = options;

    const defaultStart = new Date();
    defaultStart.setMonth(defaultStart.getMonth() - 6);

    try {
      const { data } = await hrApiClient.get('/hr/absences', {
        params: {
          limit: limitCount,
          startDate: (startDate || defaultStart).toISOString().split('T')[0],
        },
      });

      const absences = (data.absences || data || []).map(normalizeDateFields);

      if (enrichWithAllowances && absences.length > 0) {
        await this._batchEnrichAllowances(absences);
      }

      return { absences, lastDoc: null };
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Failed to fetch employee absences');
    }
  }

  // ── Get Absences By Employee ID ───────────────────────────────────────────
  async getEmployeeAbsencesById(employeeId, currentUser, options = {}) {
    const { enrichWithAllowances = false } = options;

    try {
      const { data } = await hrApiClient.get('/hr/absences', {
        params: { employeeId },
      });
      const absences = (data.absences || data || []).map(normalizeDateFields);

      if (enrichWithAllowances && MANAGER_ROLES.includes(currentUser.role) && absences.length > 0) {
        await this._batchEnrichAllowances(absences);
      }

      return absences;
    } catch (err) {
      if (err.response?.status === 403) throw new Error('Permission denied');
      throw new Error(err.response?.data?.error || 'Failed to fetch employee absences');
    }
  }

  // ── Get Single Absence ─────────────────────────────────────────────────────
  async getAbsenceById(absenceId, currentUser) {
    try {
      const { data } = await hrApiClient.get(`/hr/absences/${absenceId}`);
      const absence  = normalizeDateFields(data);

      // Enrich with allowance if manager and absence has leave type
      if (canApprove(currentUser.role) && absence.leaveType) {
        try {
          const summary = await allowanceService.getAllowanceSummary(absence.userId, absence.leaveType);
          if (summary) absence.allowanceInfo = summary;
        } catch { /* non-fatal */ }
      }

      return absence;
    } catch (err) {
      if (err.response?.status === 404) throw new Error('Absence not found');
      throw new Error(err.response?.data?.error || 'Failed to fetch absence');
    }
  }

  // ── Update Absence ─────────────────────────────────────────────────────────
  async updateAbsence(absenceId, updateData, currentUser) {
    const preparedData = {
      ...updateData,
      absenceType: updateData.leaveType || updateData.leave || updateData.absenceType
    };
    // Recalculate duration if dates changed
    if (preparedData.startingDate || preparedData.endingDate) {
      const days = calcDurationDays(
        preparedData.startingDate || preparedData.startDate,
        preparedData.endingDate   || preparedData.endDate
      );
      preparedData.duration     = `${days} days`;
      preparedData.durationDays = days;
      if (preparedData.startingDate) { preparedData.startDate = preparedData.startingDate; delete preparedData.startingDate; }
      if (preparedData.endingDate)   { preparedData.endDate   = preparedData.endingDate;   delete preparedData.endingDate;   }
    }

    try {
      const { data } = await hrApiClient.put(`/hr/absences/${absenceId}`, preparedData);
      return normalizeDateFields(data);
    } catch (err) {
      if (err.response?.status === 403) throw new Error('Permission denied');
      if (err.response?.status === 404) throw new Error('Absence not found');
      throw new Error(err.response?.data?.error || 'Failed to update absence');
    }
  }

  // ── Approve Absence ────────────────────────────────────────────────────────
  async approveAbsence(absenceId, currentUser) {
    try {
      const { data } = await hrApiClient.post(`/hr/absences/${absenceId}/approve`);
      return normalizeDateFields(data);
    } catch (err) {
      if (err.response?.status === 403) throw new Error('Permission denied');
      if (err.response?.status === 404) throw new Error('Absence not found');
      throw new Error(err.response?.data?.error || 'Failed to approve absence');
    }
  }

  // ── Decline / Reject Absence ───────────────────────────────────────────────
  async declineAbsence(absenceId, reason, currentUser) {
    try {
      const { data } = await hrApiClient.post(`/hr/absences/${absenceId}/reject`, { reason });
      return normalizeDateFields(data);
    } catch (err) {
      if (err.response?.status === 403) throw new Error('Permission denied');
      if (err.response?.status === 404) throw new Error('Absence not found');
      throw new Error(err.response?.data?.error || 'Failed to decline absence');
    }
  }

  // ── Absence Summary (yearly by type) ──────────────────────────────────────
  async getAbsenceSummary(userId) {
    try {
      const { data } = await hrApiClient.get(`/hr/absences/summary/${userId}`);
      return data;
    } catch (err) {
      if (err.response?.status === 404) return {};
      throw new Error(err.response?.data?.error || 'Failed to fetch absence summary');
    }
  }

  // ── Real-time subscription (Phase 6) ─────────────────────────────────────
  subscribeToAbsences(currentUser, callback) {
    if (!currentUser) return () => {};

    const handler = () => {
      this.getEmployeeAbsences(currentUser)
        .then(callback)
        .catch((err) => console.warn('[absenceService] refresh failed:', err));
    };

    // Listen for WebSocket events
    wsClient.on('absence:updated', handler);

    // Initial fetch
    handler();

    return () => wsClient.off('absence:updated', handler);
  }

  // Alias used by some pages
  subscribeToEmployeeAbsences(currentUser, callback) {
    return this.subscribeToAbsences(currentUser, callback);
  }

  // ── Subscribe to logged-in user's own absences ─────────────────────────────
  // Used by MyAbsencePage: subscribeToUserAbsences(userId, (absences, err) => {})
  subscribeToUserAbsences(userId, callback) {
    if (!userId) return () => {};

    const handler = () => {
      this.getUserAbsences(userId)
        .then((absences) => callback(absences, null))
        .catch((err) => {
          console.warn('[absenceService] subscribeToUserAbsences refresh failed:', err);
          callback([], err);
        });
    };

    // Listen for WebSocket events
    wsClient.on('absence:updated', handler);

    // Initial fetch
    handler();

    return () => wsClient.off('absence:updated', handler);
  }

  // ── Permission helpers ─────────────────────────────────────────────────────
  canDeleteAbsence(absence, currentUser) {
    if (!currentUser?.userId) return false;
    const isOwn    = absence.userId === currentUser.userId;
    const isPending = (absence.status || '').toLowerCase() === 'pending';
    if (isOwn && isPending) return true;
    return canApprove(currentUser.role);
  }

  canEditAbsence(absence, currentUser) {
    if (!currentUser?.userId) return false;
    const isOwn    = absence.userId === currentUser.userId;
    const isPending = (absence.status || '').toLowerCase() === 'pending';
    if (isOwn && isPending) return true;
    return canApprove(currentUser.role);
  }

  canApproveAbsence(absence, currentUser) {
    if (!currentUser?.userId) return false;
    return canApprove(currentUser.role);
  }

  canViewEmployeeAbsences(employeeId, currentUser) {
    if (!currentUser?.userId) return false;
    if (currentUser.userId === employeeId) return true;
    return MANAGER_ROLES.includes(currentUser.role);
  }

  // ── Internal: batch enrich allowances (N+1 eliminated) ────────────────────
  async _batchEnrichAllowances(absences) {
    try {
      const uniquePairs = new Map();
      absences.forEach((a) => {
        if (a.leaveType && a.userId) {
          const k = `${a.userId}:${a.leaveType}`;
          if (!uniquePairs.has(k)) uniquePairs.set(k, { userId: a.userId, leaveType: a.leaveType });
        }
      });
      if (!uniquePairs.size) return;

      const results = await Promise.allSettled(
        Array.from(uniquePairs.values()).map(async ({ userId, leaveType }) => {
          const summary = await allowanceService.getAllowanceSummary(userId, leaveType);
          return { key: `${userId}:${leaveType}`, summary };
        })
      );

      const map = new Map();
      results.forEach((r) => { if (r.status === 'fulfilled' && r.value.summary) map.set(r.value.key, r.value.summary); });

      absences.forEach((a) => {
        if (a.leaveType && a.userId) {
          const info = map.get(`${a.userId}:${a.leaveType}`);
          if (info) a.allowanceInfo = info;
        }
      });
    } catch { /* non-fatal */ }
  }
}

export const absenceService = new AbsenceService();
export default absenceService;