/**
 * allowanceService.js — Phase 4 Migration (REST Only)
 *
 * Replaces all Firestore reads/writes with HR REST API calls.
 * The class structure and all exported method names are identical
 * so every existing import continues working without change.
 *
 * Local helpers (normalizeLeaveType, formatters) kept intact.
 */

import hrApiClient from '../lib/hrApiClient';

// ── Leave type normalisation (unchanged from original) ─────────────────────
const LEAVE_TYPE_ALIASES = {
  'annual leave':   'annualleave',
  'annual':         'annualleave',
  'holiday':        'annualleave',
  'sick leave':     'sickleave',
  'sick':           'sickleave',
  'sickness':       'sickleave',
  'maternity':      'maternityleave',
  'maternity leave': 'maternityleave',
  'paternity':      'paternityleave',
  'paternity leave': 'paternityleave',
  'unpaid':         'unpaidleave',
  'unpaid leave':   'unpaidleave',
  'compassionate':  'compassionateleave',
  'compassionate leave': 'compassionateleave',
  'study leave':    'studyleave',
  'study':          'studyleave',
  'other':          'otherleave',
};

const LEAVE_TYPE_DISPLAY = {
  annualleave:        'Annual Leave',
  sickleave:          'Sick Leave',
  maternityleave:     'Maternity Leave',
  paternityleave:     'Paternity Leave',
  unpaidleave:        'Unpaid Leave',
  compassionateleave: 'Compassionate Leave',
  studyleave:         'Study Leave',
  otherleave:         'Other Leave',
};

// ── Helper: normalize date fields coming back from REST ────────────────────
function normalizeDates(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  ['createdAt','updatedAt','startDate','endDate','expiryDate'].forEach((k) => {
    if (out[k]?.toDate) out[k] = out[k].toDate().toISOString();
    else if (out[k]?.seconds) out[k] = new Date(out[k].seconds * 1000).toISOString();
  });
  return out;
}

// ── AllowanceService class ─────────────────────────────────────────────────
class AllowanceService {

  // ── Normalize leave type key ─────────────────────────────────────────────
  normalizeLeaveType(leaveType) {
    if (!leaveType) return '';
    const lower = String(leaveType).toLowerCase().trim().replace(/_/g, ' ');
    return LEAVE_TYPE_ALIASES[lower] || lower.replace(/\s+/g, '');
  }

  // ── Display name ─────────────────────────────────────────────────────────
  getLeaveTypeDisplay(leaveType) {
    const normalized = this.normalizeLeaveType(leaveType);
    return LEAVE_TYPE_DISPLAY[normalized] || leaveType || 'Unknown Leave';
  }

  // ── Get all allowances for an employee ───────────────────────────────────
  async getEmployeeAllowances(employeeId) {
    try {
      const { data } = await hrApiClient.get('/hr/allowances', {
        params: { employeeId },
      });
      const list = Array.isArray(data)
        ? data
        : [...(data.leaveAllowances || []), ...(data.allowances || [])];
      return list.map(normalizeDates);
    } catch (err) {
      if (err.response?.status === 403) return [];
      throw new Error(err.response?.data?.error || 'Failed to fetch allowances');
    }
  }

  // ── Get allowances (manager — all employees in company) ──────────────────
  async getAllowancesForCompany(companyId) {
    try {
      const { data } = await hrApiClient.get('/hr/allowances');
      const list = Array.isArray(data)
        ? data
        : [...(data.leaveAllowances || []), ...(data.allowances || [])];
      return list.map(normalizeDates);
    } catch (err) {
      if (err.response?.status === 403) return [];
      throw new Error(err.response?.data?.error || 'Failed to fetch company allowances');
    }
  }

  // ── Get pending employee IDs ─────────────────────────────────────────────
  async getPendingEmployeeIds() {
    try {
      const { data } = await hrApiClient.get('/hr/allowances/pending');
      return data.pendingEmployeeIds || [];
    } catch (err) {
      console.error('[allowanceService] Failed to fetch pending employee IDs:', err);
      return [];
    }
  }

  // ── Subscribe to pending employee IDs ────────────────────────────────────
  subscribeToPendingEmployeeIds(callback, onError) {
    const poll = async () => {
      try {
        const data = await this.getPendingEmployeeIds();
        callback(data);
      } catch (err) {
        if (onError) onError(err);
      }
    };
    poll();
    const interval = setInterval(poll, 60000); // 1 min poll
    return () => clearInterval(interval);
  }

  // ── Get single allowance ─────────────────────────────────────────────────
  async getAllowanceById(allowanceId) {
    try {
      const { data } = await hrApiClient.get(`/hr/allowances/${allowanceId}`);
      return normalizeDates(data);
    } catch (err) {
      if (err.response?.status === 404) return null;
      throw new Error(err.response?.data?.error || 'Failed to fetch allowance');
    }
  }

  // ── Create allowance ─────────────────────────────────────────────────────
  async createAllowance(allowanceData, companyId, createdBy) {
    const payload = {
      ...allowanceData,
      companyId: allowanceData.companyId || companyId,
      createdBy: createdBy || null,
    };
    // Remove undefined
    Object.keys(payload).forEach((k) => { if (payload[k] === undefined) delete payload[k]; });

    try {
      const { data } = await hrApiClient.post('/hr/allowances', payload);
      return normalizeDates(data);
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      if (err.response?.status === 409) throw new Error('An allowance of this type already exists for this employee');
      throw new Error(msg || 'Failed to create allowance');
    }
  }

  // ── Update allowance ─────────────────────────────────────────────────────
  async updateAllowance(allowanceId, updateData, updatedBy) {
    try {
      const { data } = await hrApiClient.put(`/hr/allowances/${allowanceId}`, {
        ...updateData,
        updatedBy: updatedBy || null,
      });
      return normalizeDates(data);
    } catch (err) {
      if (err.response?.status === 404) throw new Error('Allowance not found');
      if (err.response?.status === 403) throw new Error('Permission denied');
      throw new Error(err.response?.data?.error || 'Failed to update allowance');
    }
  }

  // ── Delete allowance ─────────────────────────────────────────────────────
  async deleteAllowance(allowanceId) {
    try {
      await hrApiClient.delete(`/hr/allowances/${allowanceId}`);
      return true;
    } catch (err) {
      if (err.response?.status === 404) throw new Error('Allowance not found');
      if (err.response?.status === 403) throw new Error('Permission denied');
      throw new Error(err.response?.data?.error || 'Failed to delete allowance');
    }
  }

  // ── Get allowance summary for one employee + leave type ─────────────────
  async getAllowanceSummary(employeeId, leaveType) {
    try {
      const allowances = await this.getEmployeeAllowances(employeeId);
      const normalized = this.normalizeLeaveType(leaveType);

      const match = allowances.find((a) => {
        const aType = this.normalizeLeaveType(a.leaveType || a.type);
        return aType === normalized;
      });

      if (!match) return null;

      return {
        totalDays:     match.totalDays     || match.allowanceDays  || 0,
        usedDays:      match.usedDays      || match.daysUsed       || 0,
        remainingDays: match.remainingDays || ((match.totalDays || 0) - (match.usedDays || 0)),
        leaveType,
        displayName:   this.getLeaveTypeDisplay(leaveType),
      };
    } catch {
      return null;
    }
  }

  // ── Check auto-approval eligibility ─────────────────────────────────────
  async checkAutoApproval(userId, leaveType, durationDays) {
    try {
      const summary = await this.getAllowanceSummary(userId, leaveType);
      if (!summary) {
        return { canAutoApprove: false, hasAllowance: false, reason: 'No allowance configured' };
      }

      const canAutoApprove = summary.remainingDays >= durationDays;
      return {
        canAutoApprove,
        hasAllowance:  true,
        totalDays:     summary.totalDays,
        usedDays:      summary.usedDays,
        remainingDays: summary.remainingDays,
        reason: canAutoApprove
          ? `${summary.remainingDays} days remaining`
          : `Insufficient balance: ${summary.remainingDays} days remaining, ${durationDays} requested`,
      };
    } catch {
      return { canAutoApprove: false, hasAllowance: false, reason: 'Error checking allowance' };
    }
  }

  // ── Deduct days from allowance ────────────────────────────────────────────
  async deductAllowance(employeeId, leaveType, daysToDeduct, reason = '') {
    try {
      const allowances = await this.getEmployeeAllowances(employeeId);
      const normalized = this.normalizeLeaveType(leaveType);
      const match = allowances.find((a) => this.normalizeLeaveType(a.leaveType || a.type) === normalized);

      if (!match) throw new Error('No allowance found for this leave type');

      const newUsed      = (match.usedDays || 0) + daysToDeduct;
      const newRemaining = (match.totalDays || 0) - newUsed;

      return await this.updateAllowance(match.id, {
        usedDays:      newUsed,
        remainingDays: Math.max(0, newRemaining),
        lastDeductedAt: new Date().toISOString(),
        lastDeductionReason: reason,
      });
    } catch (err) {
      throw new Error(err.message || 'Failed to deduct allowance');
    }
  }

  // ── Get allowances for team/manager view ─────────────────────────────────
  async getTeamAllowances(employeeIds) {
    if (!employeeIds?.length) return [];
    try {
      // Batch fetch — one call per employee (parallel)
      const results = await Promise.allSettled(
        employeeIds.map((id) => this.getEmployeeAllowances(id))
      );
      return results
        .filter((r) => r.status === 'fulfilled')
        .flatMap((r) => r.value);
    } catch {
      return [];
    }
  }

  // ── Get employees (those eligible for allowances) ────────────────────────
  async getEmployeesForAllowances(user) {
    try {
      const { data } = await hrApiClient.get('/hr/employees', {
        params: { 
          hrRole: 'employee',
        }
      });
      const list = data.employees || data || [];
      return list.map(emp => ({
        ...emp,
        name: `${emp.firstName || ''} ${emp.lastName || ''}`.trim() || emp.email,
        location: emp.siteId || 'Main Office'
      }));
    } catch (err) {
      console.error('[allowanceService] Error fetching employees:', err);
      return [];
    }
  }

  // ── Create multiple allowances ───────────────────────────────────────────
  async createAllowances(employeeId, allowances, user) {
    try {
      const { data } = await hrApiClient.post(`/hr/allowances/bulk`, {
        employeeId,
        allowances
      });
      return data;
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Failed to create bulk allowances');
    }
  }

  getLeaveTypeDisplayName(leaveType) {
    return this.getLeaveTypeDisplay(leaveType);
  }

  // ── Subscription wrappers (polling based fallback) ────────────────────────
  subscribeEmployeesForAllowances(user, callback, onError) {
    const poll = async () => {
      try {
        const data = await this.getEmployeesForAllowances(user);
        callback(data);
      } catch (err) {
        if (onError) onError(err);
      }
    };
    poll();
    const interval = setInterval(poll, 60000); // 1 min poll
    return () => clearInterval(interval);
  }

  subscribeToEmployeeAllowances(employeeId, user, year, callback, onError) {
    const poll = async () => {
      try {
        const data = await this.getEmployeeAllowances(employeeId);
        callback(data);
      } catch (err) {
        if (onError) onError(err);
      }
    };
    poll();
    const interval = setInterval(poll, 60000); // 1 min poll
    return () => clearInterval(interval);
  }

  subscribeToCompanyAllowances(companyId, user, year, callback, onError) {
    const poll = async () => {
      try {
        const data = await this.getAllowancesForCompany(companyId);
        callback(data);
      } catch (err) {
        if (onError) onError(err);
      }
    };
    poll();
    const interval = setInterval(poll, 60000);
    return () => clearInterval(interval);
  }

  // ── Calculate days between dates (inclusive) ─────────────────────────────
  calculateDaysFromDates(startDate, endDate) {
    if (!startDate || !endDate) return 0;
    try {
      const start = new Date(startDate);
      const end   = new Date(endDate);
      const diffTime = Math.max(0, end.getTime() - start.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
      return diffDays;
    } catch {
      return 0;
    }
  }

  // ── Ensure sick leave allowance exists (called from users.js) ─────────────
  async ensureSickLeaveAllowance(employeeId, employeeData = {}) {
    try {
      const existing = await this.getAllowanceSummary(employeeId, 'Sick Leave');
      if (existing) return existing;
      return await this.createAllowance({
        employeeId,
        leaveType: 'Sick Leave',
        totalDays:     20,
        usedDays:      0,
        remainingDays: 20,
        isActive:      true,
        notes:         'Auto-created sick leave allowance',
      }, employeeData.companyId || '', employeeId);
    } catch {
      return null;
    }
  }
}

export const allowanceService = new AllowanceService();
export default allowanceService;