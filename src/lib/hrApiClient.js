/**
 * hrApiClient.js — HR Backend Axios Instance
 *
 * Responsibilities:
 *  1. Attaches HR JWT from localStorage to every request (Authorization: Bearer)
 *  2. On 401 TOKEN_EXPIRED → calls /hr/auth/refresh → retries original request once
 *  3. On refresh failure → clears tokens → emits 'auth:logout' event
 *
 * Usage:
 *   import hrApiClient from '../lib/hrApiClient';
 *   const { data } = await hrApiClient.get('/hr/employees');
 *   const { data } = await hrApiClient.post('/hr/auth/login', { email, password });
 */

import axios from 'axios';

const BASE_URL = import.meta.env.VITE_HR_API_URL || 'http://localhost:5001';

// ── Token storage ─────────────────────────────────────────────────────────────
// Access token is kept in memory only (never localStorage) to mitigate XSS.
// Refresh token lives exclusively in an httpOnly cookie set by the backend.
let _accessToken = null;

export const tokenStore = {
  getAccess:  ()      => _accessToken,
  getRefresh: ()      => null, // httpOnly cookie — not accessible from JS
  setAccess:  (token) => { _accessToken = token; },
  setTokens:  (access, _refresh) => {
    _accessToken = access;
    // refresh is in httpOnly cookie — nothing to store here
  },
  clearAll: () => {
    _accessToken = null;
    localStorage.removeItem('mprar_auth_cache_v1');
    // Legacy cleanup in case old tokens exist in localStorage
    localStorage.removeItem('hr_access_token');
    localStorage.removeItem('hr_refresh_token');
  },
};

// ── Axios instance ────────────────────────────────────────────────────────────
const hrApiClient = axios.create({
  baseURL:         BASE_URL,
  timeout:         15000,
  withCredentials: true, // sends httpOnly refresh token cookie
  headers: { 'Content-Type': 'application/json' },
});

// Helper to decode JWT payload client-side without verifying
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
  } catch {
    return null;
  }
}

function isTokenExpired(token) {
  const payload = parseJwt(token);
  if (!payload || !payload.exp) return true;
  // Pre-emptively refresh if token expires in less than 15 seconds
  return (Date.now() / 1000) > (payload.exp - 15);
}

let activeRefreshPromise = null;

// ── Request interceptor — attach access token with pre-emptive refresh ─────────
hrApiClient.interceptors.request.use(
  async (config) => {
    const urlStr = config.url || '';
    const isAuthPath = urlStr.includes('/hr/auth/refresh') || 
                       urlStr.includes('/hr/auth/login') || 
                       urlStr.includes('/hr/auth/bridge') || 
                       urlStr.includes('/hr/auth/register');

    let token = tokenStore.getAccess();

    if (!isAuthPath) {
      const needsRefresh = !token || isTokenExpired(token);
      
      // Only attempt pre-emptive refresh if we have a cached user state indicating we are logged in
      const hasSession = localStorage.getItem('mprar_auth_cache_v1');

      if (needsRefresh && hasSession) {
        if (!activeRefreshPromise) {
          activeRefreshPromise = (async () => {
            try {
              const { data } = await axios.post(
                `${BASE_URL}/hr/auth/refresh`,
                {},
                { withCredentials: true }
              );
              const newAccessToken = data.accessToken;
              tokenStore.setAccess(newAccessToken);
              return newAccessToken;
            } catch (err) {
              tokenStore.clearAll();
              window.dispatchEvent(new CustomEvent('hr:auth:logout'));
              throw err;
            } finally {
              activeRefreshPromise = null;
            }
          })();
        }

        try {
          token = await activeRefreshPromise;
        } catch (err) {
          return Promise.reject(err);
        }
      }
    }

    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ── Response interceptor — auto-refresh on 401 ────────────────────────────────
let isRefreshing    = false;
let failedQueue     = [];

function processQueue(error, token = null) {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
}

hrApiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Only handle 401 — and only once per request
    if (
      error.response?.status === 401 &&
      !originalRequest._retry
    ) {
      if (isRefreshing) {
        // Queue requests while refresh is in progress
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers['Authorization'] = `Bearer ${token}`;
            return hrApiClient(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // Refresh token lives in httpOnly cookie — sent automatically via withCredentials
        const { data } = await axios.post(
          `${BASE_URL}/hr/auth/refresh`,
          {},
          { withCredentials: true }
        );

        const newAccessToken = data.accessToken;
        tokenStore.setAccess(newAccessToken);

        processQueue(null, newAccessToken);

        originalRequest.headers['Authorization'] = `Bearer ${newAccessToken}`;
        return hrApiClient(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        handleLogout();
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

// ── Logout helper — clear tokens and notify app ───────────────────────────────
function handleLogout() {
  tokenStore.clearAll();
  // Dispatch a custom event — AuthContext listens and resets state
  window.dispatchEvent(new CustomEvent('hr:auth:logout'));
}

export default hrApiClient;
