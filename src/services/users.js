/**
 * users.js — Phase 5 Migration (REST Only)
 *
 * Replaces all Firestore reads/writes with HR REST API calls.
 * All exported function signatures are 100% identical to the original.
 *
 * Key decisions:
 *  - Central Platform sync (fetch calls) preserved as best-effort
 *  - generateEmployeeId is pure logic — no DB needed, kept as-is
 *  - subscribeToCompanyUsers replaced with REST poll + focus event stub
 *  - createUserWithEmail / getUserByEmail stubs from auth.js still used
 *    for the Central sync path only; actual HR user creation goes to REST
 */

import hrApiClient from '../lib/hrApiClient';
import { validateEmploymentData, transformEmploymentDataForStorage } from '../utils/employmentUtils';


// ── Canonical role names (camelCase) ────────────────────────────────────────
const ROLE_CANONICAL_MAP = {
  sitemanager:     'siteManager',
  teammanager:     'teamManager',
  seniormanager:   'seniorManager',
  adminmanager:    'adminManager',
  hrmanager:       'hrManager',
  adminadvisor:    'adminAdvisor',
  hradvisor:       'hrAdvisor',
  contractmanager: 'contractManager',
  superuser:       'superUser',
  owner:           'owner',
  employee:        'employee',
};

function toCanonicalRole(raw) {
  if (!raw) return undefined;
  const key = String(raw).toLowerCase().replace(/[^a-z]/g, '');
  return ROLE_CANONICAL_MAP[key] || raw;
}

// ── Normalize user shape ──────────────────────────────────────────────────────
function normalizeUser(u) {
  if (!u) return null;
  const firstName = u.firstName || '';
  const lastName  = u.lastName  || '';
  const displayName = u.displayName || `${firstName} ${lastName}`.trim() || u.email || 'Employee';
  return {
    ...u,
    userId:      u.id || u.userId || u.employeeId,
    id:          u.id || u.userId || u.employeeId,
    primaryRole: u.hrRole || u.primaryRole || u.role,
    displayName,
  };
}

// ── Add users (by site manager / admin) ──────────────────────────────────────
export async function addUsersBySiteManager(companyId, siteId, usersPayload) {
  localStorage.setItem('isCreatingUsers', 'true');

  try {
    const { data } = await hrApiClient.post('/hr/employees/bulk', {
      companyId,
      siteId,
      users: usersPayload.map((u) => {
        const firstName = (u.firstName || '').trim();
        const lastName  = (u.lastName  || '').trim();
        return {
          email:                 (u.email || '').toLowerCase(),
          firstName,
          lastName,
          displayName:           `${firstName} ${lastName}`.trim() || u.email || '',
          hrRole:                u.role || u.hrRole || 'employee',
          reportsTo:             u.reportsTo || null,
          siteId:                u.siteId || null,
          isOnboardingMandatory: u.isOnboardingMandatory || false,
        };
      }),
    });

    const created = (data.created || []).map(normalizeUser);

    // Auto sick-leave allowances
    // Note: Central platform sync for new users is handled by the HR backend
    // via HMAC-authenticated backend-to-backend calls; no frontend sync needed.
    try {
      const { automaticAllowanceService } = await import('./automaticAllowanceService');
      for (const user of created) {
        await automaticAllowanceService.ensureEmployeeSickLeave(user.userId || user.id, user).catch(() => {});
      }
    } catch { /* non-fatal */ }

    localStorage.removeItem('isCreatingUsers');
    return { ok: true, created };
  } catch (err) {
    localStorage.removeItem('isCreatingUsers');
    if (err.response?.status === 409) {
      const msg = err.response?.data?.error || 'One or more users already exist in this company';
      throw new Error(msg);
    }
    if (err.response?.status === 402) {
      throw new Error(`Seat limit exceeded. Please upgrade your plan.`);
    }
    throw new Error(err.response?.data?.error || err.message || 'Failed to create users');
  }
}

// ── Update user (safe fields only) ───────────────────────────────────────────
export async function updateUserBySiteManager(userId, updates, contextCompanyId = null) {
  // Build HR-backend-compatible payload (field names the HR REST API accepts)
  const hrAllowed = [
    'firstName', 'lastName', 'phone', 'jobTitle', 'department', 'hrRole',
    'shift', 'hourlyRate', 'contractType', 'startDate', 'siteId', 'teamId',
    'reportsTo', 'status', 'isOnboarded',
  ];
  const hrPayload = {};
  for (const k of hrAllowed) {
    if (k in updates) hrPayload[k] = updates[k];
  }
  // Map frontend field alias → HR backend field name, and normalize role casing
  if (updates.primaryRole !== undefined) {
    hrPayload.hrRole = toCanonicalRole(updates.primaryRole);
  }
  // Convert empty strings to null for nullable FK fields
  if (hrPayload.reportsTo === '') hrPayload.reportsTo = null;
  if (hrPayload.siteId    === '') hrPayload.siteId    = null;
  if (hrPayload.teamId    === '') hrPayload.teamId    = null;

  try {
    await hrApiClient.put(`/hr/employees/${userId}`, hrPayload);
  } catch (err) {
    throw new Error(err.response?.data?.error || 'Failed to update user');
  }

  // Central sync is handled by the HR backend (syncProfileToCentral) on every PUT /hr/employees/:id.
  return { ok: true };
}

// ── Set user status ───────────────────────────────────────────────────────────
export async function setUserStatus(userId, status) {
  const allowed = ['Active','Inactive','Archived','active','inactive','archived'];
  if (!allowed.includes(status)) throw new Error('Invalid status');

  try {
    await hrApiClient.put(`/hr/employees/${userId}`, { status });
  } catch (err) {
    throw new Error(err.response?.data?.error || 'Failed to update user status');
  }

  // Central sync is handled by the HR backend on every status update.
  return { ok: true };
}

// ── Update employment details ─────────────────────────────────────────────────
export async function updateUserEmploymentDetails(userId, employmentData, updatedBy) {
  const validation = validateEmploymentData(employmentData);
  if (!validation.isValid) {
    throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
  }

  const transformedData = transformEmploymentDataForStorage(employmentData, updatedBy);

  try {
    await hrApiClient.put(`/hr/employees/${userId}`, {
      employmentDetails: transformedData,
    });
    return { ok: true, employmentDetails: transformedData };
  } catch (err) {
    throw new Error(err.response?.data?.error || `Failed to update employment details: ${err.message}`);
  }
}

// ── Get employment details ────────────────────────────────────────────────────
export async function getUserEmploymentDetails(userId) {
  try {
    const user = await getUserById(userId);
    if (!user) return null;

    // Merge employment details with HR onboarding profile data
    const employmentDetails = user.employmentDetails || {};

    // Try HR onboarding endpoint for more complete data
    try {
      const { data } = await hrApiClient.get(`/hr/onboarding/employee/${userId}`);
      const hrFields = data?.sections?.employmentDetails?.fields || {};

      return {
        jobTitle:             hrFields.jobTitle?.value             || employmentDetails.jobTitle             || '',
        department:           hrFields.department?.value           || employmentDetails.department           || '',
        employmentType:       hrFields.employmentType?.value       || employmentDetails.employmentType       || '',
        startDate:            hrFields.startDate?.value            || employmentDetails.startDate            || '',
        probationPeriod:      hrFields.probationPeriod?.value      || employmentDetails.probationPeriod      || '',
        primaryWorkLocation:  hrFields.primaryWorkLocation?.value  || employmentDetails.primaryWorkLocation  || '',
        workPattern:          hrFields.workPattern?.value          || employmentDetails.workPattern          || '',
        officeAddress:        hrFields.officeAddress?.value        || employmentDetails.officeAddress        || '',
        bankAccountName:      hrFields.bankAccountName?.value      || employmentDetails.bankAccountName      || '',
        bankName:             hrFields.bankName?.value             || employmentDetails.bankName             || '',
        bankAccountNumber:    hrFields.bankAccountNumber?.value    || employmentDetails.bankAccountNumber    || '',
        sortCode:             hrFields.sortCode?.value             || employmentDetails.sortCode             || '',
        branchName:           hrFields.branchName?.value           || employmentDetails.branchName           || '',
        iban:                 hrFields.iban?.value                 || employmentDetails.iban                 || '',
        annualSalary:         hrFields.annualSalary?.value         || employmentDetails.annualSalary         || '',
        payFrequency:         hrFields.payFrequency?.value         || employmentDetails.payFrequency         || '',
        hourlyRate:           hrFields.hourlyRate?.value           || employmentDetails.hourlyRate           || '',
        chargeRate:           hrFields.chargeRate?.value           || employmentDetails.chargeRate           || '',
        benefits:             hrFields.benefits?.value             || employmentDetails.benefits             || '',
        adminNotes:           hrFields.adminNotes?.value           || employmentDetails.adminNotes           || employmentDetails.notes || '',
      };
    } catch {
      return employmentDetails;
    }
  } catch (err) {
    throw new Error(`Failed to fetch employment details: ${err.message}`);
  }
}

// ── Get user by ID ────────────────────────────────────────────────────────────
export async function getUserById(userId) {
  try {
    const { data } = await hrApiClient.get(`/hr/employees/${userId}`);
    return normalizeUser(data);
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw new Error(err.response?.data?.error || `Failed to fetch user: ${err.message}`);
  }
}

// ── Get onboarding details ────────────────────────────────────────────────────
export async function getUserOnboardingDetails(userId) {
  try {
    const { data } = await hrApiClient.get(`/hr/onboarding/employee/${userId}`);
    return data ? { userId, id: userId, ...data } : null;
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw new Error(`Failed to fetch onboarding details: ${err.message}`);
  }
}

// ── Generate employee ID (pure function — no DB) ──────────────────────────────
export function generateEmployeeId(userData, userId, store = false) {
  try {
    const year      = new Date().getFullYear();
    const firstName = userData.firstName || '';
    const lastName  = userData.lastName  || '';
    if (firstName && lastName) {
      const initials = (firstName.charAt(0) + lastName.charAt(0)).toUpperCase();
      const shortId  = String(userId).slice(-4);
      return `${initials}${year}${shortId}`;
    }
    const shortId = String(userId).slice(-4);
    return `EMP${year}${shortId}`;
  } catch {
    return `EMP${new Date().getFullYear()}${String(userId).slice(-4)}`;
  }
}

// ── Get all users by company ──────────────────────────────────────────────────
export async function getUsersByCompany(companyId) {
  try {
    const { data } = await hrApiClient.get('/hr/employees', {
      params: {
        status: 'active',
        companyId: companyId.replace('companies/', ''),
      },
    });
    return (data.employees || data || []).map(normalizeUser);
  } catch (err) {
    if (err.response?.status === 403) return [];
    throw new Error(err.response?.data?.error || 'Failed to fetch users');
  }
}

// ── Fetch HR employees (paginated + search) ─────────────────────────────────
export async function fetchHrEmployees(companyId, { limit = 20, cursor = null, search = '' } = {}) {
  try {
    const page = cursor?.page || 1;
    const { data } = await hrApiClient.get('/hr/employees', {
      params: {
        limit,
        page,
        search: search || undefined,
        companyId: companyId.replace('companies/', ''),
      },
    });

    const employees = (data.employees || []).map(normalizeUser);
    const hasMore   = (data.page * data.limit) < data.total;

    return {
      employees,
      nextCursor: hasMore ? { page: data.page + 1 } : null,
      total:      data.total,
    };
  } catch (err) {
    throw new Error(err.response?.data?.error || 'Failed to fetch employees');
  }
}

// ── Archive user ──────────────────────────────────────────────────────────────
export async function archiveUser(userId, companyId = null) {
  try {
    await hrApiClient.put(`/hr/employees/${userId}`, { status: 'archived' });
  } catch (err) {
    throw new Error(err.response?.data?.error || `Failed to archive user: ${err.message}`);
  }
  // Central sync is handled by the HR backend on every status update.
  return { ok: true };
}

// ── Unarchive user ────────────────────────────────────────────────────────────
export async function unarchiveUser(userId, companyId = null) {
  try {
    await hrApiClient.put(`/hr/employees/${userId}`, { status: 'active' });
  } catch (err) {
    throw new Error(err.response?.data?.error || `Failed to unarchive user: ${err.message}`);
  }
  // HR backend already syncs status to Central via the internal route.
  return { ok: true };
}

// ── Subscribe to company users (REST + focus-event poll) ─────────────────────
// Phase 6: replace with wsClient.on('employee:*', callback)
export function subscribeToCompanyUsers(companyId, onUpdate, onError, options = {}) {
  if (!companyId) return () => {};

  const { status = 'active' } = options;

  const fetchAndEmit = () => {
    hrApiClient.get('/hr/employees', {
      params: {
        status,
        companyId: companyId.replace('companies/', ''),
      },
    })
      .then(({ data }) => {
        const users = (data.employees || data || []).map(normalizeUser);
        onUpdate(users);
      })
      .catch((err) => {
        console.error('[users] subscription fetch failed:', err);
        if (onError) onError(err);
      });
  };

  // Initial fetch
  fetchAndEmit();

  // Re-fetch on tab focus (catches background changes)
  const onFocus = () => fetchAndEmit();
  window.addEventListener('focus', onFocus);

  // Re-fetch every 60 s if tab is visible
  const intervalId = setInterval(() => {
    if (document.visibilityState === 'visible') fetchAndEmit();
  }, 60_000);

  return () => {
    window.removeEventListener('focus', onFocus);
    clearInterval(intervalId);
  };
}

// ── Backward compat alias ─────────────────────────────────────────────────────
export const deleteUser = archiveUser;

export async function getEmployeeCount(companyId) {
  try {
    const { data } = await hrApiClient.get('/hr/dashboard');
    return data.employeeCount || data.totalEmployees || 0;
  } catch {
    return 0;
  }
}
