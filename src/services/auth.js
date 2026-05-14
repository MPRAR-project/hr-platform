/**
 * auth.js — HR Frontend Auth Service (Phase 3 — REST Only)
 *
 * All functions now call the HR REST API instead of Firebase.
 * Firebase calls have been removed from this file.
 * Firebase SDK imports are preserved in firebase/client.js until Phase 7.
 *
 * COMPAT NOTE: createUserWithEmail / getUserByEmail stubs are kept
 * so that users.js (Phase 4 — not yet migrated) still builds.
 * These will be removed when users.js is migrated in Phase 4.
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

// ── Phase 4 backward-compat stubs ─────────────────────────────────────────────
// users.js and other Phase 4 files still import these.
// They delegate to Firebase (still available) until Phase 4 migration is done.
// REMOVE these stubs when Phase 4 is complete.

export async function createUserWithEmail(email, password) {
  const { createUserWithEmailAndPassword } = await import('firebase/auth');
  const { auth } = await import('../firebase/client');
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function getUserByEmail(email) {
  // Firebase Admin SDK is not available on the client.
  // This function is called in users.js to check if a user already exists.
  // Return null → caller treats user as new (safe fallback during transition).
  console.warn('[auth compat] getUserByEmail: Firebase Admin not available on client — returning null');
  return null;
}

export async function sendPasswordResetLink(email) {
  // ForgotPasswordPage still uses this — delegates to Firebase until Phase 4.
  const { sendPasswordResetEmail } = await import('firebase/auth');
  const { auth } = await import('../firebase/client');
  await sendPasswordResetEmail(auth, email);
}
