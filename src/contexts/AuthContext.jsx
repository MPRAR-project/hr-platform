/**
 * AuthContext.jsx — HR Frontend (Phase 3 — JWT/REST, Zero Firebase)
 *
 * Replaces the original 811-line Firebase implementation.
 * The context VALUE shape is identical — all existing pages work with zero changes.
 *
 * What changed:
 *  - onAuthStateChanged()    → localStorage token check on mount
 *  - onSnapshot(users/uid)   → GET /hr/employees/me
 *  - onSnapshot(companies/)  → GET /hr/dashboard (company settings in response)
 *  - signInWithCustomToken() → POST /hr/auth/bridge
 *  - signOut(auth)           → POST /hr/auth/logout
 *  - getIdTokenResult()      → parseJwt(token) — no network call
 *
 * What stays identical:
 *  - Context shape: user, role, isLoading, login, logout, loginWithToken, etc.
 *  - weekStartDay, companySettings, refreshWeekStartDay
 *  - All page components work without modification
 */

import React, { createContext, useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  loginWithEmailPassword,
  loginWithToken as serviceLoginWithToken,
  logout as authLogout,
  getCurrentUser,
  fetchMyProfile,
  parseJwt,
} from '../services/auth';
import hrApiClient, { tokenStore } from '../lib/hrApiClient';
import wsClient from '../lib/wsClient';
import eventBus from '../services/EventBus';
import { clearAllCache } from '../services/dataCache';
import { resolveWeekStartDay, DEFAULT_WEEK_START_DAY } from '../services/weekStartConfig';
import { getOnboardingRedirectPath, isRoleExemptFromOnboarding, shouldRequireOnboarding } from '../utils/onboardingUtils';

export const AuthContext = createContext(null);

const ALL_ROLES = [
  'superUser', 'siteManager', 'teamManager', 'adminManager',
  'hrManager', 'employee', 'adminAdvisor', 'hrAdvisor', 'contractManager',
];

const AUTH_CACHE_KEY   = 'mprar_auth_cache_v1';
const VALID_WEEK_DAYS  = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];

const normalizeWeekStartDay = (value) => {
  if (!value) return null;
  const n = String(value).trim().toLowerCase();
  return VALID_WEEK_DAYS.includes(n) ? n : null;
};

// ── Provider ──────────────────────────────────────────────────────────────────
export const AuthProvider = ({ children }) => {
  // ── State ──────────────────────────────────────────────────────────────────
  const [authedUser, setAuthedUser] = useState(() => {
    try {
      const cached = localStorage.getItem(AUTH_CACHE_KEY);
      return cached ? JSON.parse(cached) : null;
    } catch { return null; }
  });

  const [role, setRole]                           = useState(() => authedUser?.role || null);
  const [isLoading, setIsLoading]                 = useState(!authedUser);
  const [weekStartDay, setWeekStartDay]           = useState(DEFAULT_WEEK_START_DAY);
  const [isWeekStartLoading, setIsWeekStartLoading] = useState(false);
  const [companySettings, setCompanySettings]     = useState(null);
  const [isCompanyLoading, setIsCompanyLoading]   = useState(false);

  const initDoneRef = useRef(false);

  // ── 1. Bootstrap: Check token on mount ────────────────────────────────────
  useEffect(() => {
    if (initDoneRef.current) return;
    initDoneRef.current = true;

    const bootstrap = async () => {
      const tokenUser = getCurrentUser(); // decode JWT from localStorage — no network

      if (!tokenUser) {
        // No valid token — clear stale cache and show login
        tokenStore.clearAll();
        localStorage.removeItem(AUTH_CACHE_KEY);
        setAuthedUser(null);
        setRole(null);
        setIsLoading(false);
        return;
      }

      // We have a valid token — fetch fresh employee profile in background
      try {
        const employee = await fetchMyProfile();
        if (employee) {
          const normalized = buildUserState(employee, tokenUser);
          persistAndSet(normalized);
          wsClient.connect(tokenStore.getAccess());
          await loadCompanySettings(normalized.companyId);
        } else {
          // Profile 404 — clear and require re-login
          handleForceLogout();
        }
      } catch (err) {
        // Network error — use cache for offline resilience
        console.warn('[AuthContext] Profile fetch failed, using cache:', err.message);
        if (authedUser) {
          // Keep existing cache — don't clear
          setIsLoading(false);
        } else {
          handleForceLogout();
        }
      }
    };

    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 2. Listen for forced logout (token refresh failed in hrApiClient) ──────
  useEffect(() => {
    const onForceLogout = () => {
      handleForceLogout();
    };
    window.addEventListener('hr:auth:logout', onForceLogout);
    return () => window.removeEventListener('hr:auth:logout', onForceLogout);
  }, []);

  // ── Internal helpers ───────────────────────────────────────────────────────
  function buildUserState(employee, tokenUser) {
    const displayName = [employee.firstName, employee.lastName].filter(Boolean).join(' ')
      || employee.email || '';

    return {
      // Standard fields
      userId:        employee.id,
      uid:           employee.id,    // alias
      id:            employee.id,    // alias
      email:         employee.email,
      displayName,
      firstName:     employee.firstName || '',
      lastName:      employee.lastName  || '',
      role:          employee.hrRole || employee.role || tokenUser.hrRole,
      hrRole:        employee.hrRole || tokenUser.hrRole,
      primaryRole:   employee.hrRole || tokenUser.hrRole,
      companyId:     employee.companyId || tokenUser.companyId,
      primaryCompanyId: employee.companyId || tokenUser.companyId,
      siteId:        employee.siteId   || null,
      teamId:        employee.teamId   || null,
      reportsTo:     employee.reportsTo || null,
      shift:         employee.shift    || 'day',
      status:        employee.status   || 'active',
      isOnboardingCompleted: employee.isOnboarded || false,
      isOnboardingMandatory: false,
      isTrainingMandatory:   false,
      seatCount:     10,
      centralUserId: employee.centralUserId,
      _source:       'hr-rest-api',
    };
  }

  function persistAndSet(userData) {
    setAuthedUser((prev) => {
      if (prev && JSON.stringify(prev) === JSON.stringify(userData)) return prev;
      localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(userData));
      return userData;
    });
    setRole(userData.role);
    setIsLoading(false);
  }

  function handleForceLogout() {
    tokenStore.clearAll();
    localStorage.removeItem(AUTH_CACHE_KEY);
    try { clearAllCache(); } catch { /* silent */ }
    try { eventBus.emit('cache:company:invalidated', { all: true }); } catch { /* silent */ }
    wsClient.disconnect();
    setAuthedUser(null);
    setRole(null);
    setWeekStartDay(DEFAULT_WEEK_START_DAY);
    setCompanySettings(null);
    setIsLoading(false);
  }

  async function loadCompanySettings(companyId) {
    if (!companyId) return;
    try {
      setIsCompanyLoading(true);
      // Dashboard endpoint returns company-level config
      const { data } = await hrApiClient.get('/hr/dashboard');
      if (data.weekStartDay) {
        const normalized = normalizeWeekStartDay(data.weekStartDay);
        if (normalized) setWeekStartDay(normalized);
      }
      setCompanySettings(data);
    } catch {
      // Non-fatal — keep defaults
    } finally {
      setIsCompanyLoading(false);
    }
  }

  // ── login ──────────────────────────────────────────────────────────────────
  const login = useCallback(async (email, password) => {
    const emp = await loginWithEmailPassword(email, password);

    const userState = buildUserState(emp, {});
    persistAndSet(userState);

    try { clearAllCache(); } catch { /* silent */ }
    try { eventBus.emit('cache:company:invalidated', { all: true }); } catch { /* silent */ }

    wsClient.connect(tokenStore.getAccess());
    await loadCompanySettings(userState.companyId);

    return emp;
  }, []);

  // ── loginWithToken (bridge from Central) ───────────────────────────────────
  const loginWithToken = useCallback(async (token) => {
    const emp = await serviceLoginWithToken(token);

    const userState = buildUserState(emp, {});
    persistAndSet(userState);

    try { clearAllCache(); } catch { /* silent */ }
    try { eventBus.emit('cache:company:invalidated', { all: true }); } catch { /* silent */ }

    wsClient.connect(tokenStore.getAccess());
    await loadCompanySettings(userState.companyId);

    return emp;
  }, []);

  // ── logout ─────────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    try { await authLogout(); } catch { /* ignore */ }
    handleForceLogout();
  }, []);

  // ── refreshUserData — re-fetch profile from API ───────────────────────────
  const refreshUserData = useCallback(async () => {
    try {
      const employee = await fetchMyProfile();
      if (employee) {
        const userState = buildUserState(employee, getCurrentUser() || {});
        persistAndSet(userState);
        await refreshWeekStartDay(userState.companyId, userState.siteId);
      }
    } catch (err) {
      console.warn('[AuthContext] refreshUserData failed:', err.message);
    }
  }, []);

  // ── refreshClaims — re-check token and refresh employee data ─────────────
  const refreshClaims = useCallback(async () => {
    return refreshUserData();
  }, [refreshUserData]);

  // ── switchRole — dev/test utility ─────────────────────────────────────────
  const switchRole = useCallback((newRole) => {
    if (ALL_ROLES.includes(newRole)) setRole(newRole);
  }, []);

  // ── refreshWeekStartDay ────────────────────────────────────────────────────
  const refreshWeekStartDay = useCallback(async (companyId, siteId) => {
    if (!companyId && !siteId) {
      setWeekStartDay(DEFAULT_WEEK_START_DAY);
      return DEFAULT_WEEK_START_DAY;
    }
    try {
      setIsWeekStartLoading(true);
      const resolved   = await resolveWeekStartDay(companyId, siteId);
      const normalized = resolved || DEFAULT_WEEK_START_DAY;
      setWeekStartDay(normalized);
      return normalized;
    } catch {
      setWeekStartDay(DEFAULT_WEEK_START_DAY);
      return DEFAULT_WEEK_START_DAY;
    } finally {
      setIsWeekStartLoading(false);
    }
  }, []);

  // Auto-refresh weekStartDay when companyId/siteId changes
  useEffect(() => {
    if (authedUser?.companyId || authedUser?.siteId) {
      refreshWeekStartDay(authedUser.companyId, authedUser.siteId);
    } else {
      setWeekStartDay(DEFAULT_WEEK_START_DAY);
    }
  }, [authedUser?.companyId, authedUser?.siteId, refreshWeekStartDay]);

  // ── checkOnboardingRequirement ────────────────────────────────────────────
  const checkOnboardingRequirement = useCallback(async () => {
    if (!user) return { requiresOnboarding: false, redirectPath: '/' };
    try {
      const requiresOnboarding = shouldRequireOnboarding(user, null);
      const redirectPath       = getOnboardingRedirectPath(user, null);
      return {
        requiresOnboarding,
        redirectPath,
        isRoleExempt: isRoleExemptFromOnboarding(user.role),
      };
    } catch {
      return { requiresOnboarding: false, redirectPath: '/' };
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived user object ─────────────────────────────────────────────────────
  const user = useMemo(() => {
    if (!authedUser) return null;
    return {
      role,
      userId:        authedUser.userId,
      uid:           authedUser.userId,
      id:            authedUser.userId,
      email:         authedUser.email,
      displayName:   authedUser.displayName,
      companyId:     authedUser.companyId,
      siteId:        authedUser.siteId,
      isOnboardingCompleted: authedUser.isOnboardingCompleted ?? false,
      isOnboardingMandatory: authedUser.isOnboardingMandatory ?? false,
      isTrainingMandatory:   authedUser.isTrainingMandatory   ?? false,
      shift:         authedUser.shift || 'day',
      avatarUrl:     'https://i.pravatar.cc/40',
      weekStartDay,
    };
  }, [role, authedUser, weekStartDay]);

  // ── Context value — identical shape to original ───────────────────────────
  const value = useMemo(() => ({
    user,
    role,
    authedUser,
    isLoading,
    switchRole,
    allRoles: ALL_ROLES,
    login,
    loginWithToken,
    logout,
    checkOnboardingRequirement,
    refreshUserData,
    refreshClaims,
    companySettings,
    isCompanyLoading,
    weekStartDay,
    refreshWeekStartDay,
    isWeekStartLoading,
  }), [
    user, role, authedUser, isLoading,
    companySettings, isCompanyLoading,
    weekStartDay, isWeekStartLoading,
    refreshWeekStartDay, switchRole,
    login, loginWithToken, logout,
    checkOnboardingRequirement, refreshUserData, refreshClaims,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
