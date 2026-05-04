import React, { createContext, useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { loginWithEmailPassword, logout as authLogout } from '../services/auth';
import { auth, db } from '../firebase/client';
import eventBus from '../services/EventBus';
import { clearAllCache } from '../services/dataCache';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, query, where, getDocs, doc, getDoc, setDoc, limit, updateDoc, serverTimestamp } from 'firebase/firestore';
import { getCompanyOnboardingSettings, shouldRequireOnboarding, isRoleExemptFromOnboarding, getOnboardingRedirectPath } from '../utils/onboardingUtils';
import { resolveWeekStartDay, DEFAULT_WEEK_START_DAY } from '../services/weekStartConfig';


// Create the context
export const AuthContext = createContext(null);

// Create a list of all available roles and dummy user data for each
const ALL_ROLES = ['superUser', 'siteManager', 'teamManager', 'adminManager', 'hrManager', 'employee', 'adminAdvisor', 'hrAdvisor', 'contractManager'];
const USER_DATA_MAP = {
    superUser: { name: 'Super User', email: 'su@mprar.com' },
    siteManager: { name: 'Site Manager', email: 'site@mprar.com' },
    teamManager: { name: 'Team Manager', email: 'tm@mprar.com' },
    hrManager: { name: 'HR Manager', email: 'hr@mprar.com' },
    adminManager: { name: 'Admin Manager', email: 'admin@mprar.com' },
    employee: { name: 'John Doe', email: 'employee@mprar.com' },
    contractManager: { name: 'John Doe', email: 'manager@mprar.com' }
    // Add other roles as needed
};

// Create the Provider component
export const AuthProvider = ({ children }) => {
    const AUTH_CACHE_KEY = 'mprar_auth_cache_v1';

    // Load initial state from cache for instant startup
    const [authedUser, setAuthedUser] = useState(() => {
        try {
            const cached = localStorage.getItem(AUTH_CACHE_KEY);
            return cached ? JSON.parse(cached) : null;
        } catch (e) { return null; }
    });
    const [role, setRole] = useState(() => authedUser?.role || null);
    const [isLoading, setIsLoading] = useState(!authedUser);
    const [weekStartDay, setWeekStartDay] = useState(DEFAULT_WEEK_START_DAY);
    const [isWeekStartLoading, setIsWeekStartLoading] = useState(false);

    // State for the raw Firebase user (auth only)
    const [firebaseUser, setFirebaseUser] = useState(null);
    const [authInitialized, setAuthInitialized] = useState(false);

    // 1. Listen for Firebase Auth state changes (Run once)
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            const isCreatingUsers = localStorage.getItem('isCreatingUsers') === 'true';
            const signupInProgress = localStorage.getItem('signupInProgress') === 'true';

            if ((isCreatingUsers || signupInProgress) && user) {
                return;
            }

            setFirebaseUser(user);
            setAuthInitialized(true);

            if (!user) {
                // Clear state and all caches when logged out (or session ended)
                setAuthedUser(null);
                setRole(null);
                setWeekStartDay(DEFAULT_WEEK_START_DAY);
                try {
                    localStorage.removeItem(AUTH_CACHE_KEY);
                    localStorage.removeItem('mprar_global_cache_v1');
                    clearAllCache();
                    eventBus.emit('cache:company:invalidated', { all: true });
                } catch (e) {
                    console.warn('AuthContext: Failed to clear caches on auth state clear', e);
                }
                setIsLoading(false);
            }
        });

        return () => unsubscribe();
    }, []);

    // 2. Real-time Firestore Subscription (Ref-Guarded)
    const activeListenerUid = useRef(null);
    const lastActiveUpdateRef = useRef(0); // Track last active update locally

    useEffect(() => {
        if (!authInitialized) return;
        const uid = firebaseUser?.uid;

        // 🛑 STOP THE LOOP: If we are already listening to this UID, do nothing.
        if (activeListenerUid.current === uid) {
            return;
        }

        // Handle Logout
        if (!uid) {
            activeListenerUid.current = null;
            setIsLoading(false);
            return;
        }

        // 🔒 LOCK IT: Set the ref so future renders are blocked
        activeListenerUid.current = uid;

        // On refresh: Keep existing auth cache for instant render, but refresh in background
        // setIsLoading(true) is only called if we don't have a cached user (handled in useState initializers)

        let userUnsubscribe = null;
        let profileUnsubscribe = null;

        const setupSubscription = async () => {
            try {
                // Direct UID lookup (all users now use UID as doc ID)
                const userDocRef = doc(db, 'users', uid);

                let lastPrefetchedCid = null;

                // Helper to merge and set user data
                const updateAuthedUser = (baseUserData, profileData = null) => {
                    const effectiveData = profileData ? { ...baseUserData, ...profileData } : baseUserData;

                    // Determine which companyId to use:
                    const effectiveCompanyId = profileData?.companyId || baseUserData.primaryCompanyId || baseUserData.companyId;

                    // Determine effective role
                    const effectiveRole = profileData?.primaryRole || baseUserData.primaryRole || baseUserData.role || 'employee';
                    const newUser = {
                        userId: firebaseUser.uid,     // ← Use userId consistently
                        email: baseUserData.email,
                        role: effectiveRole,
                        displayName: baseUserData.displayName,
                        companyId: effectiveCompanyId,
                        siteId: profileData?.siteId || baseUserData.siteId,

                        // Merge other fields, preferring profile data
                        reportsTo: profileData?.reportsTo || baseUserData.reportsTo,
                        managerUserId: profileData?.managerUserId || baseUserData.managerUserId,
                        teamId: profileData?.teamId || baseUserData.teamId,

                        // Handle both old and new field names for backward compatibility
                        isOnboardingCompleted: baseUserData.isOnboardingCompleted ?? baseUserData.isOnbordingCompleted ?? false,
                        isOnboardingMandatory: baseUserData.isOnboardingMandatory ?? false,
                        isTrainingMandatory: baseUserData.isTrainingMandatory ?? false,
                        shift: baseUserData.shift || 'day',
                        firebaseUser: firebaseUser,

                        // Store raw data for debugging/advanced usage
                        _profileId: profileData?.id,
                        _isMultiCompany: !!profileData
                    };

                    let hasChanged = false;
                    setAuthedUser((prev) => {
                        // Deep compare to prevent unnecessary re-renders
                        if (prev && JSON.stringify(prev) === JSON.stringify(newUser)) {
                            return prev;
                        }
                        hasChanged = true;
                        // PERSIST: Cache auth state
                        localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(newUser));
                        return newUser;
                    });

                    if (effectiveRole !== role) {
                        setRole(effectiveRole);
                    }

                    setIsLoading((prev) => {
                        if (prev === false) return prev;
                        return false;
                    });

                    // Prefetch company dashboard only if companyId CHANGED or hasn't been fetched yet
                    // Use closure variable lastPrefetchedCid to track
                    const cid = (effectiveCompanyId || '').toString().split('/').pop() || (effectiveCompanyId || '').toString();
                    if (cid && cid !== 'undefined' && cid !== 'null' && cid !== lastPrefetchedCid) {
                        lastPrefetchedCid = cid;
                        import('../services/dataCache').then((m) => m.fetchCompanyDashboardData(cid).catch(() => { }));
                    }
                };


                // Retry logic for fetching user document (short delays for faster first load)
                let userDocSnap = null;
                let attempts = 0;
                const maxAttempts = 2;
                const retryDelayMs = 400;

                while (attempts < maxAttempts) {
                    try {
                        userDocSnap = await getDoc(userDocRef);
                        if (userDocSnap.exists()) break;
                        if (attempts < maxAttempts - 1) {
                            await new Promise(r => setTimeout(r, retryDelayMs));
                        }
                        attempts++;
                    } catch (err) {
                        console.error('AuthContext: Error fetching user doc:', err);
                        if (attempts < maxAttempts - 1) {
                            await new Promise(r => setTimeout(r, retryDelayMs));
                        }
                        attempts++;
                    }
                }

                if (!userDocSnap || !userDocSnap.exists()) {
                    console.warn('AuthContext: User document not found for UID:', uid, '— attempting auto-repair...');

                    // AUTO-REPAIR: The user exists in Firebase Auth but has no Firestore doc.
                    // This happens when users are created via Auth but the Firestore write failed.
                    try {
                        const fbUser = auth.currentUser;
                        const email = (fbUser?.email || '').toLowerCase();

                        // Check if there's an existing doc by email (wrong ID / legacy)
                        let existingData = null;
                        if (email) {
                            try {
                                const emailSnap = await getDocs(
                                    query(collection(db, 'users'), where('email', '==', email), limit(1))
                                );
                                if (!emailSnap.empty) {
                                    existingData = emailSnap.docs[0].data();
                                    console.log('AuthContext: Found existing doc by email, migrating to UID-based doc...');
                                }
                            } catch (legacyLookupErr) {
                                console.warn('AuthContext: Legacy lookup by email failed (non-fatal):', legacyLookupErr);
                            }
                        }

                        // Get custom claims from the token
                        const idTokenResult = await fbUser.getIdTokenResult();
                        const claims = idTokenResult.claims || {};
                        
                        // Map Central roles to HR roles
                        // Central 'admin' or 'owner' usually maps to 'siteManager' in HR
                        let hrRole = claims.hr_role;
                        if (claims.central_role === 'admin') {
                            hrRole = 'superUser';
                        } else if (claims.central_role === 'owner') {
                            hrRole = 'siteManager';
                        }
                        if (!hrRole) hrRole = 'employee';

                        const repairData = {
                            userId: uid,
                            email: email || '',
                            displayName: existingData?.displayName || fbUser?.displayName || email || uid,
                            firstName: existingData?.firstName || '',
                            lastName: existingData?.lastName || '',
                            primaryRole: hrRole,
                            role: hrRole,
                            companyId: claims.company_id || existingData?.companyId || existingData?.primaryCompanyId || null,
                            primaryCompanyId: claims.company_id || existingData?.primaryCompanyId || existingData?.companyId || null,
                            siteId: existingData?.siteId || null,
                            status: 'active',
                            shift: existingData?.shift || 'day',
                            isOnboardingCompleted: existingData?.isOnboardingCompleted ?? false,
                            isOnboardingMandatory: existingData?.isOnboardingMandatory ?? false,
                            createdAt: existingData?.createdAt || serverTimestamp(),
                            updatedAt: serverTimestamp(),
                            _autoRepaired: true,
                            _bridgedFromCentral: true
                        };

                        await setDoc(userDocRef, repairData);
                        console.log('AuthContext: Auto-repair successful — created users/', uid);

                        // Archive the stale old doc if found
                        if (existingData && email) {
                            try {
                                const emailSnap2 = await getDocs(
                                    query(collection(db, 'users'), where('email', '==', email), limit(5))
                                );
                                for (const staleDoc of emailSnap2.docs) {
                                    if (staleDoc.id !== uid) {
                                        await updateDoc(staleDoc.ref, { status: 'archived', _migratedToUid: uid, updatedAt: serverTimestamp() });
                                        console.log('AuthContext: Archived stale doc:', staleDoc.id);
                                    }
                                }
                            } catch (_) { /* non-fatal */ }
                        }

                        // Re-fetch the doc we just created
                        userDocSnap = await getDoc(userDocRef);
                    } catch (repairErr) {
                        console.error('AuthContext: Auto-repair failed:', repairErr);
                        if (activeListenerUid.current === uid) {
                            activeListenerUid.current = null;
                            await signOut(auth);
                        }
                        setIsLoading(false);
                        return;
                    }
                }

                // Unblock UI immediately with user doc (companyId/role from user); profile merges in when listener fires
                let initialUserData = userDocSnap.data();

                // Fallback: doc at users/uid may be minimal (only updatedAt/lastActive) if full record lives under another id (e.g. legacy site manager)
                const hasEssentialFields = initialUserData.email && (initialUserData.primaryRole != null || initialUserData.role != null);
                if (!hasEssentialFields && firebaseUser?.email) {
                    try {
                        const emailSnap = await getDocs(
                            query(collection(db, 'users'), where('email', '==', (firebaseUser.email || '').toLowerCase()), limit(5))
                        );
                        if (!emailSnap.empty) {
                            const matchByUid = emailSnap.docs.find((d) => d.id === uid);
                            const fullDoc = matchByUid || emailSnap.docs.find((d) => {
                                const d2 = d.data();
                                return d2.email && (d2.primaryRole != null || d2.role != null);
                            }) || emailSnap.docs[0];
                            const fullData = fullDoc ? { id: fullDoc.id, ...fullDoc.data() } : null;
                            if (fullData && (fullData.email || fullData.primaryRole != null || fullData.role != null)) {
                                initialUserData = fullData;
                                if (fullDoc.id !== uid) {
                                    const { id: _omit, ...toMerge } = fullData;
                                    await setDoc(userDocRef, toMerge, { merge: true });
                                }
                            }
                        }
                    } catch (e) {
                        console.warn('AuthContext: Fallback fetch by email failed', e);
                    }
                }

                const initialStatus = (initialUserData.status || '').toLowerCase();
                if (initialStatus !== 'inactive' && initialStatus !== 'archived') {
                    updateAuthedUser(initialUserData, null);
                }

                // Subscribe to User Document (and profile when company exists)
                const { onSnapshot } = await import('firebase/firestore');

                // SCALABILITY: Import subscription monitor (graceful - doesn't break if fails)
                let subscriptionMonitor = null;
                try {
                    subscriptionMonitor = (await import('../utils/subscriptionMonitor')).default;
                } catch (e) {
                    console.warn('[AuthContext] Subscription monitor not available:', e);
                }

                userUnsubscribe = onSnapshot(userDocRef, async (docSnap) => {
                    if (!docSnap.exists()) {
                        console.warn('AuthContext: User document deleted, signing out');
                        if (activeListenerUid.current === uid) {
                            activeListenerUid.current = null;
                            await signOut(auth);
                        }
                        return;
                    }

                    // Ignore local latency updates for the auth user triggers to prevent loops
                    const hasPendingWrites = docSnap.metadata.hasPendingWrites;

                    const userData = docSnap.data();

                    // Ignore minimal doc (only updatedAt/lastActive) so we don't overwrite auth state; initial load fallback already resolved full data
                    const hasEssential = userData.email && (userData.primaryRole != null || userData.role != null);
                    if (!hasEssential) return;

                    // Check active status (Global level)
                    const normalizedStatus = (userData.status || '').toLowerCase();
                    if (normalizedStatus === 'inactive' || normalizedStatus === 'archived') {
                        console.warn('AuthContext: User is globally inactive/archived, signing out');
                        if (activeListenerUid.current === uid) {
                            activeListenerUid.current = null;
                            await signOut(auth);
                        }
                        return;
                    }

                    // Determine Primary Company
                    const targetCompanyId = userData.primaryCompanyId || userData.companyId;

                    if (targetCompanyId) {
                        // Clean up old profile listener if company changed
                        if (profileUnsubscribe && profileUnsubscribe._companyId !== targetCompanyId) { // Optimization tag
                            if (profileUnsubscribe) profileUnsubscribe();
                            profileUnsubscribe = null;
                        }

                        if (!profileUnsubscribe) {
                            // Subscribe to the specific company profile
                            const profilesRef = collection(db, 'userCompanyProfiles');
                            const q = query(
                                profilesRef,
                                where('userId', '==', uid),
                                where('companyId', '==', targetCompanyId),
                                limit(1)
                            );

                            profileUnsubscribe = onSnapshot(q, (profileSnap) => {
                                let profileData = null;
                                if (!profileSnap.empty) {
                                    const pDoc = profileSnap.docs[0];
                                    profileData = { id: pDoc.id, ...pDoc.data() };

                                    // Check PROFILE status
                                    if (profileData.status === 'archived' || profileData.status === 'inactive') {
                                        // If the ONLY active profile is archived, we might want to warn or redirect.
                                        // For now, let's load it but maybe the UI handles the "Archived" state.
                                        // OR, we should try to switch to another active company if available?
                                        // (Automated switching is complex, let's stick to loading what we have)
                                    }
                                } else {
                                    // No profile found (pre-migration or error)
                                    // Fallback to user doc data
                                }
                                updateAuthedUser(userData, profileData);

                            }, (err) => {
                                console.error('AuthContext: Profile listener error', err);
                                updateAuthedUser(userData, null);
                            });
                            profileUnsubscribe._companyId = targetCompanyId;

                            // SCALABILITY: Register profile subscription with monitor
                            if (subscriptionMonitor) {
                                try {
                                    subscriptionMonitor.register(uid, 'userProfile', profileUnsubscribe);
                                } catch (e) {
                                    console.warn('[AuthContext] Failed to register profile subscription:', e);
                                }
                            }
                        } else {
                            // If we already have a profile listener, we just update the user data part
                            // The profile listener will fire on its own if profile changes.
                            // However, we need to trigger updateAuthedUser with CURRENT profile data?
                            // We don't have it here. This is tricky. 
                            // Actually, updateAuthedUser merges `userData` + `profileData`.
                            // If `userData` changes, we need to re-merge with *latest* profile data.
                            // But we don't have it stored accessible.
                            // Simplified: We can't easily cache the profile. 
                            // Re-running the query setup is safer if we don't store state.
                            // BUT re-running it causes loops if not careful.
                            // Let's stick to the previous implementation but verify the loop isn't here.
                            updateAuthedUser(userData, null); // Fallback if profile listener is active but we don't have profileData here
                        }
                    } else {
                        // No company assigned
                        updateAuthedUser(userData, null);
                    }

                    // Auto-track last active
                    // Skip if this snapshot is just our own local write (pending)
                    if (!hasPendingWrites) {
                        try {
                            const now = Date.now();
                            // Throttle updates to once every 5 minute (300000ms)
                            if (!lastActiveUpdateRef.current || (now - lastActiveUpdateRef.current > 60000)) {

                                const dbLastActive = userData.lastActive?.toDate ? userData.lastActive.toDate() : new Date(userData.lastActive || 0);
                                const diff = now - dbLastActive.getTime();

                                // Only write if DB is older than 1 minute
                                if (diff > 60000) {
                                    lastActiveUpdateRef.current = now; // Lock

                                    // Fire and forget
                                    updateDoc(userDocRef, {
                                        lastActive: serverTimestamp(),
                                        updatedAt: serverTimestamp()
                                    }).catch(e => console.warn('AuthContext: Failed auto-track', e));
                                }
                            }
                        } catch (e) {
                            console.warn('AuthContext: Failed auto-track', e);
                        }
                    }

                }, error => {
                    console.error('AuthContext: User listener error', error);
                    activeListenerUid.current = null;
                    setIsLoading(false);
                });

                // SCALABILITY: Register user subscription with monitor
                if (subscriptionMonitor) {
                    try {
                        subscriptionMonitor.register(uid, 'user', userUnsubscribe);
                    } catch (e) {
                        console.warn('[AuthContext] Failed to register user subscription:', e);
                    }
                }

            } catch (error) {
                console.error('AuthContext: Error setting up listener', error);
                activeListenerUid.current = null;
                setIsLoading(false);
            }
        };

        setupSubscription();

        return () => {
            if (userUnsubscribe) {
                userUnsubscribe();
                // SCALABILITY: Cleanup subscription monitor
                try {
                    const subscriptionMonitor = require('../utils/subscriptionMonitor').default;
                    subscriptionMonitor.cleanup(uid);
                } catch (e) {
                    // Ignore - monitor not available or already cleaned up
                }
            }
            if (profileUnsubscribe) {
                profileUnsubscribe();
            }
            activeListenerUid.current = null;
        };
    }, [firebaseUser?.uid, authInitialized]);

    const switchRole = useCallback((newRole) => {
        if (ALL_ROLES.includes(newRole)) {
            setRole(newRole);
        }
    }, []);

    const login = useCallback(async (email, password) => {
        const u = await loginWithEmailPassword(email, password);
        setRole(u.role);
        setAuthedUser(u);

        // Clear caches on login to ensure fresh data
        try {
            localStorage.removeItem('mprar_timesheet_user_cache');
            clearAllCache();
            eventBus.emit('cache:company:invalidated', { all: true });
        } catch (e) {
            console.warn('AuthContext: Failed to clear caches on login', e);
        }

        // Persist fresh DB user to auth cache so cache always has latest after login
        try {
            const cacheUser = {
                userId: u.userId,     // ← Use userId consistently
                email: u.email,
                role: u.role,
                displayName: u.displayName,
                companyId: u.companyId,
                siteId: u.siteId,
                isOnboardingCompleted: u.isOnboardingCompleted ?? false,
                isOnboardingMandatory: u.isOnboardingMandatory ?? false,
                isTrainingMandatory: u.isTrainingMandatory ?? false,
                shift: u.shift || 'day',
            };
            localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(cacheUser));
        } catch (e) {
            console.warn('AuthContext: Failed to write auth cache after login', e);
        }
        return u;
    }, []);

    const logout = useCallback(async () => {
        try {
            await authLogout();
            // Clear all caches so next user never sees previous user's data
            try {
                localStorage.removeItem(AUTH_CACHE_KEY);
                localStorage.removeItem('mprar_global_cache_v1');
                clearAllCache();
                // Clear timesheet user cache
                localStorage.removeItem('mprar_timesheet_user_cache');
                eventBus.emit('cache:company:invalidated', { all: true });
            } catch (e) {
                console.warn('AuthContext: Failed to clear some caches on logout', e);
            }
            setAuthedUser(null);
            setRole(null);
            setWeekStartDay(DEFAULT_WEEK_START_DAY);
        } catch (error) {
            console.error('Logout error:', error);
            throw error;
        }
    }, []);

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

    // useMemo ensures the user object only changes when the role changes
    const user = useMemo(() => {
        if (!authedUser) return null;

        const userData = {
            role,
            userId: authedUser.userId,     // ← Use userId consistently
            uid: authedUser.userId,        // Alias for backward compatibility
            id: authedUser.userId,         // Alias for backward compatibility
            email: authedUser.email,
            displayName: authedUser.displayName,
            companyId: authedUser.companyId,
            siteId: authedUser.siteId,
            isOnboardingCompleted: authedUser.isOnboardingCompleted,
            isOnboardingMandatory: authedUser.isOnboardingMandatory,
            isTrainingMandatory: authedUser.isTrainingMandatory,
            shift: authedUser.shift || 'day', // Default to day shift
            avatarUrl: 'https://i.pravatar.cc/40',
            weekStartDay
        };
        // log suppressed to reduce noise
        return userData;
    }, [role, authedUser, weekStartDay]);


    // Helper function to check if current user needs onboarding
    const checkOnboardingRequirement = useCallback(async () => {
        if (!user) {
            return { requiresOnboarding: false, redirectPath: '/' };
        }

        try {
            // NEW: Use user-specific onboarding requirement
            const requiresOnboarding = shouldRequireOnboarding(user, null);
            const redirectPath = getOnboardingRedirectPath(user, null);

            return {
                requiresOnboarding,
                redirectPath,
                isRoleExempt: isRoleExemptFromOnboarding(user.role)
            };
        } catch (error) {
            console.error('Error checking onboarding requirement:', error);
            // Return safe defaults on error
            return { requiresOnboarding: false, redirectPath: '/' };
        }
    }, [user]);

    // Function to refresh user data from database
    const refreshUserData = useCallback(async () => {
        if (!auth.currentUser) return;

        try {
            let userData = null;

            try {
                const userDocRef = doc(db, 'users', auth.currentUser.uid);
                const userDocSnap = await getDoc(userDocRef);

                if (userDocSnap.exists()) {
                    userData = userDocSnap.data();
                } else {
                    console.error('AuthContext: User document not found during refresh for UID:', auth.currentUser.uid);
                }
            } catch (error) {
                console.error('AuthContext: Error refreshing user data:', error);
            }

            if (userData) {
                setAuthedUser({
                    userId: auth.currentUser.uid,     // ← Use userId consistently
                    email: userData.email,
                    role: userData.primaryRole,
                    displayName: userData.displayName,
                    companyId: userData.companyId,
                    siteId: userData.siteId,
                    // Handle both old and new field names for backward compatibility
                    isOnboardingCompleted: userData.isOnboardingCompleted ?? userData.isOnbordingCompleted ?? false,
                    isOnboardingMandatory: userData.isOnboardingMandatory ?? false,
                    isTrainingMandatory: userData.isTrainingMandatory ?? false, // Ensure this field is exposed
                    shift: userData.shift || 'day', // Default to day shift
                    firebaseUser: auth.currentUser
                });
                setRole(userData.primaryRole);
                await refreshWeekStartDay(userData.companyId, userData.siteId);
            }
        } catch (error) {
            console.error('AuthContext: Error refreshing user data:', error);
        }
    }, [refreshWeekStartDay]);

    const loginWithToken = useCallback(async (token) => {
        const { loginWithToken: serviceLoginWithToken } = await import('../services/auth');
        const u = await serviceLoginWithToken(token);
        setRole(u.role);
        setAuthedUser(u);

        try {
            localStorage.removeItem('mprar_timesheet_user_cache');
            clearAllCache();
            eventBus.emit('cache:company:invalidated', { all: true });
        } catch (e) {
            console.warn('AuthContext: Failed to clear caches on token login', e);
        }
        return u;
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
        weekStartDay,
        refreshWeekStartDay,
        isWeekStartLoading
    }), [user, role, authedUser, isLoading, weekStartDay, isWeekStartLoading, refreshWeekStartDay, switchRole, login, loginWithToken, logout, checkOnboardingRequirement, refreshUserData]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}; 
