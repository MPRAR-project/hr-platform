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

// ── Central Platform sync helper (best-effort, fire-and-forget) ─────────────
function getCentralContext() {
  return {
    apiUrl: import.meta.env.VITE_CENTRAL_API_URL || 'http://localhost:5000',
    token:  localStorage.getItem('mprar_central_token'),
  };
}

async function centralFetch(path, method = 'GET', body = null) {
  const { apiUrl, token } = getCentralContext();
  if (!token || !apiUrl) return null;
  try {
    const res = await fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.warn(`[HR→Central sync] ${method} ${path} failed:`, err.error || res.status);
    }
    return res;
  } catch (err) {
    console.warn(`[HR→Central sync] Network error ${method} ${path}:`, err.message);
    return null;
  }
}

// ── Normalize user shape ──────────────────────────────────────────────────────
function normalizeUser(u) {
  if (!u) return null;
  return {
    ...u,
    userId:      u.id || u.userId || u.employeeId,
    id:          u.id || u.userId || u.employeeId,
    primaryRole: u.hrRole || u.primaryRole || u.role,
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
        const full  = (u.fullName || '').trim();
        const parts = full.split(' ');
        return {
          email:                 (u.email || '').toLowerCase(),
          firstName:             parts[0] || '',
          lastName:              parts.slice(1).join(' ').trim(),
          displayName:           full,
          primaryRole:           u.role,
          reportsTo:             u.reportsTo || null,
          isOnboardingMandatory: u.isOnboardingMandatory || false,
        };
      }),
    });

    const created = (data.created || []).map(normalizeUser);

    // Best-effort Central Platform sync
    const cleanCompanyId = companyId.replace('companies/', '');
    await Promise.allSettled(
      created
        .filter((u) => !u._isExistingUser)
        .map((u) =>
          centralFetch(`/companies/${cleanCompanyId}/users`, 'POST', {
            email:       u.email,
            firstName:   u.firstName,
            lastName:    u.lastName,
            hrRole:      u.primaryRole || 'employee',
            reportsTo:   u.reportsTo  || null,
            centralRole: null,
          })
        )
    );

    // Auto sick-leave allowances
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
  const allowed = [
    'displayName','firstName','lastName','email','primaryRole','roles',
    'reportsTo','managerUserId','status','rates','cisDeduction','utrNumber','siteId','companyId',
  ];
  const payload = {};
  for (const k of allowed) {
    if (k in updates) payload[k] = updates[k];
  }

  try {
    await hrApiClient.put(`/hr/employees/${userId}`, payload);
  } catch (err) {
    throw new Error(err.response?.data?.error || 'Failed to update user');
  }

  // Best-effort Central sync
  const companyId = contextCompanyId || payload.companyId;
  await syncUserToCentral(userId, companyId, {
    primaryRole: payload.primaryRole,
    reportsTo:   payload.reportsTo === '' ? null : (payload.reportsTo || undefined),
    firstName:   payload.firstName,
    lastName:    payload.lastName,
    status:      payload.status,
    email:       payload.email,
  });

  return { ok: true };
}

// ── Sync user to Central Platform ─────────────────────────────────────────────
export async function syncUserToCentral(userId, companyId, payload) {
  try {
    const cleanCompanyId = (companyId || '').toString().replace('companies/', '');
    if (!cleanCompanyId) return;

    if (payload.primaryRole || payload.reportsTo !== undefined) {
      await centralFetch(`/companies/${cleanCompanyId}/users/${userId}/roles`, 'PUT', {
        hrRole:    payload.primaryRole || undefined,
        reportsTo: payload.reportsTo   || undefined,
      });
    }

    if (payload.firstName || payload.lastName || payload.status || payload.email) {
      const rawStatus = typeof payload.status === 'string' ? payload.status.trim().toLowerCase() : undefined;
      const normalizedStatus = rawStatus === 'archived' ? 'inactive'
        : rawStatus === 'active'   ? 'active'
        : rawStatus === 'inactive' ? 'inactive'
        : undefined;

      await centralFetch(`/companies/${cleanCompanyId}/users/${userId}`, 'PUT', {
        firstName: payload.firstName || undefined,
        lastName:  payload.lastName  || undefined,
        status:    normalizedStatus,
        email:     payload.email     || undefined,
      });
    }
  } catch (syncErr) {
    console.warn('[HR→Central sync] Failed (non-fatal):', syncErr.message);
  }
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

  // Get user's company for Central sync
  try {
    const user = await getUserById(userId);
    const companyId = user?.primaryCompanyId || user?.companyId;
    if (companyId) await syncUserToCentral(userId, companyId, { status });
  } catch { /* non-fatal */ }

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

  // Best-effort Central sync
  try {
    if (companyId) {
      await centralFetch(
        `/companies/${companyId.replace('companies/', '')}/users/${userId}`,
        'DELETE'
      );
    }
  } catch { /* non-fatal */ }

  return { ok: true };
}

// ── Unarchive user ────────────────────────────────────────────────────────────
export async function unarchiveUser(userId, companyId = null) {
  try {
    await hrApiClient.put(`/hr/employees/${userId}`, { status: 'active' });
  } catch (err) {
    throw new Error(err.response?.data?.error || `Failed to unarchive user: ${err.message}`);
  }

  // Best-effort Central sync — reactivate user
  try {
    const user = await getUserById(userId);
    if (user && companyId) {
      await syncUserToCentral(userId, companyId, {
        firstName:   user.firstName,
        lastName:    user.lastName,
        email:       user.email,
        primaryRole: user.primaryRole || user.role,
        reportsTo:   user.reportsTo   || user.managerUserId,
        status:      'active',
      });
    }
  } catch { /* non-fatal */ }

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
