const CENTRAL_TOKEN_KEY = 'mprar_central_token';
const CENTRAL_API_URL = import.meta.env.VITE_CENTRAL_API_URL || 'http://localhost:5000';

function getStoredToken() {
  return localStorage.getItem(CENTRAL_TOKEN_KEY);
}

function setStoredToken(token) {
  if (token) {
    localStorage.setItem(CENTRAL_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(CENTRAL_TOKEN_KEY);
  }
}

function clearStoredToken() {
  localStorage.removeItem(CENTRAL_TOKEN_KEY);
}

async function fetchWithAuth(path, options = {}) {
  const { method = 'GET', body = null, headers = {}, skipToken = false } = options;
  const url = `${CENTRAL_API_URL}${path}`;
  const fetchHeaders = { ...headers, Accept: 'application/json' };

  if (body && !(body instanceof FormData)) {
    fetchHeaders['Content-Type'] = 'application/json';
  }

  const token = getStoredToken();
  if (!skipToken && token) {
    fetchHeaders.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method,
    headers: fetchHeaders,
    credentials: 'include',
    body: body && !(body instanceof FormData) ? JSON.stringify(body) : body,
  });

  if (!response.ok) {
    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      // Ignore malformed JSON on error
    }
    const message = payload?.error || response.statusText || `Request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return response.json().catch(() => null);
}

function normalizeHrRole(role, centralRole) {
  if (role) return role;
  if (!centralRole) return 'employee';

  const normalized = centralRole.toLowerCase();
  if (normalized === 'owner' || normalized === 'admin') return 'siteManager';
  if (normalized === 'super_admin') return 'superUser';
  return normalized;
}

function normalizeUser(rawUser) {
  if (!rawUser) return null;

  const role = normalizeHrRole(rawUser.hrRole || rawUser.role, rawUser.centralRole);
  const displayName = rawUser.displayName || `${rawUser.firstName || ''} ${rawUser.lastName || ''}`.trim() || rawUser.email;

  return {
    ...rawUser,
    userId: rawUser.id || rawUser.userId,
    uid: rawUser.id || rawUser.userId,
    id: rawUser.id || rawUser.userId,
    role,
    displayName,
    email: rawUser.email,
    companyId: rawUser.companyId,
    companyName: rawUser.companyName,
    siteId: rawUser.siteId,
    isOnboardingCompleted: rawUser.isOnboardingCompleted ?? false,
    isOnboardingMandatory: rawUser.isOnboardingMandatory ?? false,
    isTrainingMandatory: rawUser.isTrainingMandatory ?? false,
    shift: rawUser.shift || 'day',
    addons: rawUser.addons || {},
    centralRole: rawUser.centralRole,
    hrRole: rawUser.hrRole,
  };
}

export async function loginWithEmailPassword(email, password) {
  if (!email || !password) {
    throw new Error('Email and password are required.');
  }

  const response = await fetchWithAuth('/auth/login', {
    method: 'POST',
    body: {
      email: email.toLowerCase().trim(),
      password,
      platform: 'hr',
    },
    skipToken: true,
  });

  if (!response || !response.accessToken || !response.user) {
    throw new Error('Invalid login response from authentication server.');
  }

  setStoredToken(response.accessToken);
  return normalizeUser(response.user);
}

export async function loginWithToken(token) {
  if (!token) {
    throw new Error('Bridge token is required.');
  }

  setStoredToken(token);
  const response = await fetchWithAuth('/auth/restore', {
    method: 'POST',
    body: { token },
    skipToken: true,
  });

  if (!response || !response.user) {
    throw new Error('Failed to restore session from bridge token.');
  }

  return normalizeUser(response.user);
}

export async function logout() {
  try {
    await fetchWithAuth('/auth/logout', { method: 'POST', skipToken: true });
  } catch (error) {
    console.warn('[auth] Logout request failed:', error.message || error);
  } finally {
    clearStoredToken();
  }
}

export async function getCurrentUser(retry = true) {
  try {
    const response = await fetchWithAuth('/auth/me');
    if (!response || !response.user) {
      throw new Error('Invalid auth/me response from authentication server.');
    }

    return normalizeUser(response.user);
  } catch (error) {
    if (error.status === 401 && retry) {
      try {
        await refreshAccessToken();
        return getCurrentUser(false);
      } catch (refreshError) {
        clearStoredToken();
        throw refreshError;
      }
    }
    throw error;
  }
}

export async function refreshAccessToken() {
  const response = await fetchWithAuth('/auth/refresh', { method: 'POST', skipToken: true });

  if (!response || !response.accessToken) {
    throw new Error('Failed to refresh authentication token.');
  }

  setStoredToken(response.accessToken);
  return response.accessToken;
}

export async function sendPasswordResetLink(email) {
  try {
    const response = await fetchWithAuth('/auth/forgot-password', {
      method: 'POST',
      body: {
        email: email.toLowerCase().trim(),
        origin: 'hr',
      },
      skipToken: true,
    });

    return response;
  } catch (error) {
    console.error('Password reset request failed via Central:', error);
    throw error;
  }
}
