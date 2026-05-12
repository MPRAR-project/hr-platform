import React, { createContext, useState, useMemo, useEffect, useCallback } from 'react';
import { loginWithEmailPassword, loginWithToken as authLoginWithToken, logout as authLogout, getCurrentUser } from '../services/auth';
import { clearAllCache } from '../services/dataCache';
import eventBus from '../services/EventBus';
import { shouldRequireOnboarding, isRoleExemptFromOnboarding, getOnboardingRedirectPath } from '../utils/onboardingUtils';
import { resolveWeekStartDay, DEFAULT_WEEK_START_DAY } from '../services/weekStartConfig';

export const AuthContext = createContext(null);
const VALID_WEEK_DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const ALL_ROLES = ['superUser', 'siteManager', 'teamManager', 'adminManager', 'hrManager', 'employee', 'adminAdvisor', 'hrAdvisor', 'contractManager'];

const normalizeWeekStartDay = (value) => {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  return VALID_WEEK_DAYS.includes(normalized) ? normalized : null;
};

const normalizeCachedUser = (user) => {
  if (!user) return null;
  return {
    ...user,
    userId: user.userId || user.id || user.uid,
    uid: user.uid || user.userId || user.id,
    id: user.id || user.userId || user.uid,
    role: user.role || 'employee',
    displayName: user.displayName || user.email,
    companyId: user.companyId,
    siteId: user.siteId,
    isOnboardingCompleted: user.isOnboardingCompleted ?? false,
    isOnboardingMandatory: user.isOnboardingMandatory ?? false,
    isTrainingMandatory: user.isTrainingMandatory ?? false,
    shift: user.shift || 'day',
  };
};

export const AuthProvider = ({ children }) => {
  const AUTH_CACHE_KEY = 'mprar_auth_cache_v1';
  const [authedUser, setAuthedUser] = useState(() => {
    try {
      const cached = localStorage.getItem(AUTH_CACHE_KEY);
      return cached ? normalizeCachedUser(JSON.parse(cached)) : null;
    } catch (e) {
      return null;
    }
  });
  const [role, setRole] = useState(() => authedUser?.role || null);
  const [isLoading, setIsLoading] = useState(true);
  const [weekStartDay, setWeekStartDay] = useState(DEFAULT_WEEK_START_DAY);
  const [isWeekStartLoading, setIsWeekStartLoading] = useState(false);
  const [companySettings, setCompanySettings] = useState(null);
  const [isCompanyLoading, setIsCompanyLoading] = useState(false);

  useEffect(() => {
    const restoreSession = async () => {
      const token = localStorage.getItem('mprar_central_token');
      if (!token) {
        setAuthedUser(null);
        setRole(null);
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        const currentUser = await getCurrentUser();
        const normalized = normalizeCachedUser(currentUser);
        setAuthedUser(normalized);
        setRole(normalized.role);
        localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(normalized));
      } catch (error) {
        console.warn('AuthContext: Failed to restore session', error);
        setAuthedUser(null);
        setRole(null);
        localStorage.removeItem(AUTH_CACHE_KEY);
      } finally {
        setIsLoading(false);
      }
    };

    restoreSession();
  }, []);

  const persistAuthCache = useCallback((userData) => {
    try {
      if (!userData) {
        localStorage.removeItem(AUTH_CACHE_KEY);
        return;
      }
      localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(userData));
    } catch (e) {
      console.warn('AuthContext: Failed to persist auth cache', e);
    }
  }, []);

  const login = useCallback(async (email, password) => {
    const userData = await loginWithEmailPassword(email, password);
    const normalized = normalizeCachedUser(userData);
    setAuthedUser(normalized);
    setRole(normalized.role);
    persistAuthCache(normalized);

    try {
      localStorage.removeItem('mprar_timesheet_user_cache');
      clearAllCache();
      eventBus.emit('cache:company:invalidated', { all: true });
    } catch (e) {
      console.warn('AuthContext: Failed to clear caches on login', e);
    }

    return normalized;
  }, [persistAuthCache]);

  const logout = useCallback(async () => {
    await authLogout();

    try {
      localStorage.clear();
      sessionStorage.clear();
      clearAllCache();
      eventBus.emit('cache:company:invalidated', { all: true });
      console.log('AuthContext: Local storage and cache cleared');
    } catch (e) {
      console.warn('AuthContext: Failed to clear caches on logout', e);
    }

    setAuthedUser(null);
    setRole(null);
    setWeekStartDay(DEFAULT_WEEK_START_DAY);
    setCompanySettings(null);
  }, []);

  const loginWithToken = useCallback(async (token) => {
    const userData = await authLoginWithToken(token);
    const normalized = normalizeCachedUser(userData);
    setAuthedUser(normalized);
    setRole(normalized.role);
    persistAuthCache(normalized);

    try {
      localStorage.removeItem('mprar_timesheet_user_cache');
      clearAllCache();
      eventBus.emit('cache:company:invalidated', { all: true });
    } catch (e) {
      console.warn('AuthContext: Failed to clear caches on token login', e);
    }

    return normalized;
  }, [persistAuthCache]);

  const refreshWeekStartDay = useCallback(async (companyId, siteId) => {
    if (!companyId && !siteId) {
      setWeekStartDay(DEFAULT_WEEK_START_DAY);
      return DEFAULT_WEEK_START_DAY;
    }

    try {
      setIsWeekStartLoading(true);
      const resolved = await resolveWeekStartDay(companyId, siteId);
      const normalized = resolved || DEFAULT_WEEK_START_DAY;
      setWeekStartDay(normalized);
      return normalized;
    } catch (error) {
      console.warn('[AuthContext] Failed to resolve week start day', error);
      setWeekStartDay(DEFAULT_WEEK_START_DAY);
      return DEFAULT_WEEK_START_DAY;
    } finally {
      setIsWeekStartLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authedUser?.companyId || authedUser?.siteId) {
      refreshWeekStartDay(authedUser.companyId, authedUser.siteId);
    } else {
      setWeekStartDay(DEFAULT_WEEK_START_DAY);
    }
  }, [authedUser?.companyId, authedUser?.siteId, refreshWeekStartDay]);

  const refreshUserData = useCallback(async () => {
    try {
      const userData = await getCurrentUser();
      const normalized = normalizeCachedUser(userData);
      setAuthedUser(normalized);
      setRole(normalized.role);
      persistAuthCache(normalized);
      await refreshWeekStartDay(normalized.companyId, normalized.siteId);
      return normalized;
    } catch (error) {
      console.error('AuthContext: Error refreshing user data:', error);
      return null;
    }
  }, [persistAuthCache, refreshWeekStartDay]);

  const refreshClaims = useCallback(async () => {
    const refreshed = await refreshUserData();
    return refreshed ? { ...refreshed } : null;
  }, [refreshUserData]);

  const user = useMemo(() => {
    if (!authedUser) return null;

    return {
      role,
      userId: authedUser.userId,
      uid: authedUser.uid,
      id: authedUser.id,
      email: authedUser.email,
      displayName: authedUser.displayName,
      companyId: authedUser.companyId,
      companyName: authedUser.companyName,
      siteId: authedUser.siteId,
      isOnboardingCompleted: authedUser.isOnboardingCompleted,
      isOnboardingMandatory: authedUser.isOnboardingMandatory,
      isTrainingMandatory: authedUser.isTrainingMandatory,
      shift: authedUser.shift || 'day',
      avatarUrl: 'https://i.pravatar.cc/40',
      addons: authedUser.addons || {},
      centralRole: authedUser.centralRole,
      hrRole: authedUser.hrRole,
      weekStartDay,
    };
  }, [role, authedUser, weekStartDay]);

  const checkOnboardingRequirement = useCallback(async () => {
    if (!user) {
      return { requiresOnboarding: false, redirectPath: '/' };
    }

    try {
      const requiresOnboarding = shouldRequireOnboarding(user, null);
      const redirectPath = getOnboardingRedirectPath(user, null);

      return {
        requiresOnboarding,
        redirectPath,
        isRoleExempt: isRoleExemptFromOnboarding(user.role),
      };
    } catch (error) {
      console.error('Error checking onboarding requirement:', error);
      return { requiresOnboarding: false, redirectPath: '/' };
    }
  }, [user]);

  const switchRole = useCallback((newRole) => {
    if (ALL_ROLES.includes(newRole)) {
      setRole(newRole);
    }
  }, []);

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
  }), [user, role, authedUser, isLoading, companySettings, isCompanyLoading, weekStartDay, isWeekStartLoading, switchRole, login, loginWithToken, logout, checkOnboardingRequirement, refreshUserData, refreshClaims, refreshWeekStartDay]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
