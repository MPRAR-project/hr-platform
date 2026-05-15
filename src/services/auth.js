/**
 * auth.js — HR Frontend Auth Service (Phase 8 — Finalized Zero-Shim)
 *
 * All functions call the HR REST API.
 * All Firebase dependencies and stubs have been removed.
 */

import hrApiClient, { tokenStore } from '../lib/hrApiClient';

// ── Login with email + password ───────────────────────────────────────────────
export async function loginWithEmailPassword(email, password) {
  try {
    const { data } = await hrApiClient.post('/hr/auth/login', {
      email: email.toLowerCase().trim(),
      password,
    });

    // Store tokens
    tokenStore.setTokens(data.accessToken, null); // refresh token is in httpOnly cookie

    return normalizeEmployee(data.employee);
  } catch (err) {
    const message = err.response?.data?.error || err.message || 'Login failed';
    const status  = err.response?.status;

    if (status === 403) {
      throw new Error('This account does not have HR platform access. Please subscribe via the Central Platform.');
    }
    if (status === 401) {
      throw new Error('Invalid email or password.');
    }

    throw new Error(message);
  }
}

// ── Login with Central JWT token (SSO bridge) ──────────────────────────────────
export async function loginWithToken(centralToken) {
  try {
    const { data } = await hrApiClient.post('/hr/auth/bridge', {
      token: centralToken,
    });

    tokenStore.setTokens(data.accessToken, null);

    return normalizeEmployee(data.employee);
  } catch (err) {
    const message = err.response?.data?.error || err.message || 'Bridge authentication failed';
    const status  = err.response?.status;

    if (status === 403) {
      throw new Error('This company does not have HR platform access. Please subscribe first.');
    }
    if (status === 401) {
      throw new Error('Your session has expired. Please log in again from the Central Platform.');
    }

    throw new Error(message);
  }
}

// ── Logout ────────────────────────────────────────────────────────────────────
export async function logout() {
  try {
    await hrApiClient.post('/hr/auth/logout');
  } catch {
    // Non-fatal — clear tokens regardless
  } finally {
    tokenStore.clearAll();
  }
}

// ── Get current user (from token payload — no network) ────────────────────────
export function getCurrentUser() {
  const token = tokenStore.getAccess();
  if (!token) return null;

  try {
    const payload = parseJwt(token);

    // Check expiry
    if (payload.exp && Date.now() / 1000 > payload.exp) {
      return null;
    }

    return {
      userId:    payload.userId || payload.sub,
      companyId: payload.companyId,
      hrRole:    payload.hrRole,
      email:     payload.email,
      role:      payload.hrRole, // alias for components that use `role`
    };
  } catch {
    return null;
  }
}

// ── Fetch full employee profile from API ──────────────────────────────────────
export async function fetchMyProfile() {
  try {
    const { data } = await hrApiClient.get('/hr/employees/me');
    return data;
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw err;
  }
}

// ── Refresh access token ───────────────────────────────────────────────────────
export async function refreshAccessToken() {
  try {
    const { data } = await hrApiClient.post('/hr/auth/refresh');
    tokenStore.setAccess(data.accessToken);
    return data.accessToken;
  } catch {
    tokenStore.clearAll();
    return null;
  }
}

// ── Password Reset (Central Platform Proxy) ───────────────────────────────────
export async function sendPasswordResetLink(email) {
  try {
    const centralApiUrl = import.meta.env.VITE_CENTRAL_API_URL || 'http://localhost:5000';
    const response = await fetch(`${centralApiUrl}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        email: email.toLowerCase().trim(),
        origin: window.location.origin // pass origin so Central knows where to redirect back if needed
      }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to send reset link');
    }

    return true;
  } catch (err) {
    console.error('[auth] Password reset failed:', err.message);
    throw err;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * normalizeEmployee — maps HR employee record to the shape
 * that AuthContext and all HR pages expect.
 * Preserves backward compatibility: role, userId, uid, id, displayName all set.
 */
function normalizeEmployee(emp) {
  if (!emp) return null;

  const displayName = [emp.firstName, emp.lastName].filter(Boolean).join(' ') || emp.email || '';

  return {
    // Primary fields (new standard)
    userId:        emp.id,
    companyId:     emp.companyId,
    role:          emp.hrRole,
    hrRole:        emp.hrRole,
    email:         emp.email,
    firstName:     emp.firstName || '',
    lastName:      emp.lastName  || '',
    displayName,
    status:        emp.status,
    isOnboarded:   emp.isOnboarded || false,

    // Backward-compat aliases (so existing pages keep working)
    uid:           emp.id,
    id:            emp.id,
    primaryRole:   emp.hrRole,
    isOnboardingCompleted: emp.isOnboarded || false,
    isOnboardingMandatory: false,
    isTrainingMandatory:   false,
    shift:         emp.shift || 'day',
    siteId:        emp.siteId || null,
    teamId:        emp.teamId || null,
    reportsTo:     emp.reportsTo || null,
    seatCount:     10,

    // Metadata
    centralUserId: emp.centralUserId,
    _source:       'hr-rest-api', // debug marker
  };
}

/**
 * parseJwt — decode JWT payload without verifying (client-side only).
 * Verification is done on the server.
 */
function parseJwt(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  try {
    const base64Url = token.split('.')[1];
    const base64    = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const json      = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(json);
  } catch (err) {
    console.warn('Failed to parse JWT:', err.message);
    return null;
  }
}

export { parseJwt };

