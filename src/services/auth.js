import { auth, db, functions } from '../firebase/client';
import { httpsCallable } from 'firebase/functions';
import { signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithCustomToken } from 'firebase/auth';
import { collection, query, where, getDocs, doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { clearAllCache } from './dataCache';
import eventBus from './EventBus';

async function getInviteStatusMessageForEmail(email) {
    try {
        const normalizedEmail = (email || '').toLowerCase();
        if (!normalizedEmail) return null;

        const invitesCol = collection(db, 'invites');
        const inviteQuery = query(invitesCol, where('email', '==', normalizedEmail));
        const inviteSnap = await getDocs(inviteQuery);

        if (inviteSnap.empty) {
            return null;
        }

        const invites = inviteSnap.docs
            .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
            .sort((a, b) => {
                const aTime = a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0;
                const bTime = b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0;
                return bTime - aTime;
            });

        const latestInvite = invites[0];
        if (!latestInvite) return null;

        if (latestInvite.status === 'revoked') {
            return 'Your invitation was rejected. Please contact your administrator.';
        }

        if (latestInvite.status === 'pending') {
            return 'Your invitation is still pending. Please use the link in your invite email to finish setting up your account.';
        }

        return null;
    } catch (error) {
        console.warn('Failed to check invite status for email:', email, error);
        return null;
    }
}

export async function loginWithEmailPassword(email, password) {
    try {
        console.log('Login attempt for:', email, 'with password provided:', !!password);
        let firebaseUser;

        if (password) {
            // Authenticate with Firebase Auth
            console.log('Attempting Firebase Auth sign in...');
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            firebaseUser = userCredential.user;
            console.log('Firebase Auth sign in successful');
        } else {
            // Get current user (for auth state changes)
            firebaseUser = auth.currentUser;
            if (!firebaseUser || firebaseUser.email !== email) {
                throw new Error('No authenticated user found');
            }
        }

        // Get user data from Firestore
        const usersCol = collection(db, 'users');
        const userQuery = query(usersCol, where('email', '==', email));
        const userSnap = await getDocs(userQuery);

        if (userSnap.empty) {
            // User exists in Firebase Auth but not in Firestore — auto-repair by creating the doc
            console.warn('[auth] No Firestore doc for', email, '— auto-creating...');
            try {
                const uid = firebaseUser.uid;
                const repairData = {
                    userId: uid,
                    email,
                    displayName: firebaseUser.displayName || email,
                    firstName: '',
                    lastName: '',
                    primaryRole: 'employee',
                    role: 'employee',
                    status: 'Active',
                    shift: 'day',
                    isOnboardingCompleted: false,
                    isOnboardingMandatory: false,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                    _autoRepaired: true,
                };
                await setDoc(doc(db, 'users', uid), repairData);
                console.log('[auth] Auto-repair: created users/', uid);
                // Re-query so the rest of the function works normally
                const reSnap = await getDocs(query(collection(db, 'users'), where('email', '==', email)));
                if (!reSnap.empty) {
                    // Continue with the newly created doc (fall through below)
                    const userDoc2 = reSnap.docs[0];
                    const userData2 = { id: userDoc2.id, ...userDoc2.data() };
                    try {
                        await updateDoc(doc(db, 'users', userData2.id), { lastActive: serverTimestamp(), updatedAt: serverTimestamp() });
                    } catch (_) { }
                    return {
                        userId: firebaseUser.uid,
                        email: userData2.email,
                        role: userData2.primaryRole || 'employee',
                        displayName: userData2.displayName,
                        companyId: userData2.companyId,
                        siteId: userData2.siteId,
                        firebaseUser,
                        lastActive: new Date()
                    };
                }
            } catch (repairErr) {
                console.error('[auth] Auto-repair failed:', repairErr);
            }
            // If repair failed, fall back to original error
            await signOut(auth);
            const inviteMessage = await getInviteStatusMessageForEmail(email);
            if (inviteMessage) {
                throw new Error(inviteMessage);
            }
            throw new Error('User account not found. Please contact your administrator.');
        }

        // Prefer the user doc whose ID matches Firebase Auth UID (correct profile); fallback to first match
        const uid = firebaseUser.uid;
        const matchByUid = userSnap.docs.find((d) => d.id === uid);
        const userDoc = matchByUid || userSnap.docs[0];
        const userData = { id: userDoc.id, ...userDoc.data() };

        // Check if user is active (treat missing/empty as active; only block explicit inactive/archived)
        const normalizedStatus = (userData.status || '').toString().toLowerCase().trim();
        if (normalizedStatus === 'inactive' || normalizedStatus === 'Inactive' || normalizedStatus === 'archived') {
            await signOut(auth);
            throw new Error('Your account is inactive. Please contact your administrator.');
        }

        // Check if user was suspended by company
        if (userData.suspendedByCompany === true) {
            await signOut(auth);
            throw new Error('Your company was suspended. Please contact your administrator.');
        }

        // Check if company is suspended
        if (userData.companyId) {
            try {
                const companyId = userData.companyId.includes('/')
                    ? userData.companyId.split('/')[1]
                    : userData.companyId;
                const companyRef = doc(db, 'companies', companyId);
                const companySnap = await getDoc(companyRef);

                if (companySnap.exists()) {
                    const companyData = companySnap.data();

                    // Block all users (including site managers) if company is suspended
                    if (companyData.status === 'suspended') {
                        await signOut(auth);
                        throw new Error('Your company was suspended. Please contact your administrator.');
                    }
                }
            } catch (companyError) {
                console.warn('[auth] Failed to check company status:', companyError);
                // Don't block login if company check fails - just log the warning
            }
        }

        // Update lastActive timestamp
        try {
            await updateDoc(doc(db, 'users', userData.id), {
                lastActive: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
        } catch (e) {
            console.warn('Failed to update lastActive timestamp:', e);
        }

        // Return user data with Firebase Auth UID (role from doc so cache gets correct role)
        return {
            userId: firebaseUser.uid,     // ← Use userId consistently
            uid: firebaseUser.uid,        // Alias for backward compatibility
            id: firebaseUser.uid,         // Alias for backward compatibility
            email: firebaseUser.email,
            role: userData.primaryRole || userData.role || 'employee',
            displayName: userData.displayName || firebaseUser.displayName || firebaseUser.email,
            companyId: userData.primaryCompanyId || userData.companyId,
            siteId: userData.siteId,
            isOnboardingCompleted: userData.isOnboardingCompleted || false,
            isOnboardingMandatory: userData.isOnboardingMandatory || false,
            isTrainingMandatory: userData.isTrainingMandatory || false,
            shift: userData.shift || 'day', // Add shift to login response
            firebaseUser: firebaseUser // Keep raw user for some legacy components
        };
    } catch (error) {
        console.log('Login error:', error.code, error.message);

        // Fallbacks for users created via dashboard without Auth accounts
        if (['auth/user-not-found', 'auth/wrong-password', 'auth/invalid-credential'].includes(error.code)) {
            console.log('Auth error detected, checking Firestore for user...');

            // Check if the user exists in Firestore (invited/added by site manager)
            const usersCol = collection(db, 'users');
            const userQueryRef = query(usersCol, where('email', '==', email));
            const userSnapCheck = await getDocs(userQueryRef);

            if (!userSnapCheck.empty) {
                console.log('User found in Firestore, checking password...');

                // Legacy behavior: if password equals email, auto-provision Auth user and login
                if (password && password === email) {
                    console.log('Password equals email, auto-provisioning Firebase Auth user...');
                    try {
                        const created = await createUserWithEmailAndPassword(auth, email, password);
                        const firebaseUser = created.user;
                        const userDoc = userSnapCheck.docs[0];
                        const userData = { id: userDoc.id, ...userDoc.data() };

                        const normalizedStatusLegacy = (userData.status || '').toString().toLowerCase().trim();
                        if (normalizedStatusLegacy === 'inactive' || normalizedStatusLegacy === 'Inactive' || normalizedStatusLegacy === 'archived') {
                            await signOut(auth);
                            throw new Error('Your account is inactive. Please contact your administrator.');
                        }

                        // Check if user was suspended by company
                        if (userData.suspendedByCompany === true) {
                            await signOut(auth);
                            throw new Error('Your company was suspended. Please contact your administrator.');
                        }

                        // Check if company is suspended
                        if (userData.companyId) {
                            try {
                                const companyId = userData.companyId.includes('/')
                                    ? userData.companyId.split('/')[1]
                                    : userData.companyId;
                                const companyRef = doc(db, 'companies', companyId);
                                const companySnap = await getDoc(companyRef);

                                if (companySnap.exists()) {
                                    const companyData = companySnap.data();

                                    // Block all users (including site managers) if company is suspended
                                    if (companyData.status === 'suspended') {
                                        await signOut(auth);
                                        throw new Error('Your company was suspended. Please contact your administrator.');
                                    }
                                }
                            } catch (companyError) {
                                console.warn('[auth] Failed to check company status:', companyError);
                            }
                        }

                        console.log('Auto-provisioning successful, returning user data');
                        return {
                            userId: firebaseUser.uid,     // ← Use userId consistently
                            email: userData.email,
                            role: userData.primaryRole,
                            displayName: userData.displayName,
                            companyId: userData.companyId,
                            siteId: userData.siteId,
                            firebaseUser
                        };
                    } catch (provisionErr) {
                        console.log('Auto-provisioning failed:', provisionErr);
                        throw new Error('Account setup failed. Please contact your administrator.');
                    }
                }

                // Otherwise just error out (do NOT send auto reset)
                throw new Error('Invalid credentials. Please check your password or use the Forgot Password link.');
            }

            // Not in Firestore either
            console.log('User not found in Firestore');
            const inviteMessage = await getInviteStatusMessageForEmail(email);
            if (inviteMessage) {
                throw new Error(inviteMessage);
            }
            throw new Error('No account found with this email address.');
        }

        // Handle other Firebase Auth errors
        if (error.code === 'auth/invalid-email') {
            throw new Error('Invalid email address format.');
        } else if (error.code === 'auth/too-many-requests') {
            throw new Error('Too many failed login attempts. Please try again later.');
        } else if (error.code === 'auth/network-request-failed') {
            throw new Error('Network error. Please check your connection and try again.');
        }

        throw new Error(error.message || 'Login failed. Please try again.');
    }
}

export async function loginWithToken(token) {
    try {
        console.log('Bridge login attempt with token');
        const userCredential = await signInWithCustomToken(auth, token);
        const firebaseUser = userCredential.user;
        const email = firebaseUser.email;

        // --- SYNC ROLES FROM CUSTOM TOKEN ---
        const idTokenResult = await firebaseUser.getIdTokenResult();
        const claims = idTokenResult.claims || {};
        
        if (claims.bridged) {
            let hrRole = claims.hr_role;
            
            // Enforce central platform role mapping rules
            if (claims.central_role === 'admin') {
                hrRole = 'superUser';
            } else if (claims.central_role === 'owner') {
                hrRole = 'siteManager';
            }
            
            if (hrRole) {
                const userRef = doc(db, 'users', firebaseUser.uid);
                // Normalize companyId to path format for consistency across all Firestore queries
                const rawCompanyId = claims.company_id || null;
                const normalizedCompanyId = rawCompanyId
                    ? (rawCompanyId.startsWith('companies/') ? rawCompanyId : `companies/${rawCompanyId}`)
                    : null;

                const snap = await getDoc(userRef);
                if (snap.exists()) {
                    await updateDoc(userRef, { 
                        role: hrRole, 
                        primaryRole: hrRole,
                        status: 'active', // Ensure user is marked as active when bridging from Central
                        centralRole: claims.central_role || null,
                        companyId: normalizedCompanyId || snap.data().companyId,
                        primaryCompanyId: normalizedCompanyId || snap.data().primaryCompanyId,
                        'plugins.scheduling': !!claims.shift_roster,
                        'plugins.traveller': !!claims.traveller,
                        'plugins.timeworks': !!claims.timeworks
                    });
                    console.log(`Synchronized role and centralRole to bridged user ${firebaseUser.email}`);
                } else {
                    await setDoc(userRef, {
                        email: firebaseUser.email,
                        displayName: firebaseUser.displayName || firebaseUser.email.split('@')[0],
                        role: hrRole,
                        primaryRole: hrRole,
                        centralRole: claims.central_role || null,
                        companyId: normalizedCompanyId || null,
                        primaryCompanyId: normalizedCompanyId || null,
                        status: 'active',
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp()
                    });
                    console.log(`Auto-created HR profile for bridged user ${firebaseUser.email}`);
                }
            }
            
            // Auto-create or synchronize company document for bridged users
            if (claims.company_id) {
                const compId = claims.company_id.includes('/') ? claims.company_id.split('/')[1] : claims.company_id;
                const compRef = doc(db, 'companies', compId);
                const compSnap = await getDoc(compRef);
                if (!compSnap.exists()) {
                    await setDoc(compRef, {
                        name: claims.company_name || 'My Company',
                        status: 'active',
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp(),
                        seatCount: claims.seat_count || 10,
                        currentEmployeeCount: 1,
                        subscriptionTier: 'trial',
                        billingSubscriptionStatus: 'trial',
                        plugins: {
                            scheduling: !!claims.shift_roster,
                            traveller: !!claims.traveller,
                            timeworks: !!claims.timeworks
                        }
                    });
                    console.log(`Auto-created missing company profile for ${compId}`);
                    await updateDoc(compRef, {
                        seatCount: claims.seat_count,
                        'plugins.scheduling': !!claims.shift_roster,
                        'plugins.traveller': !!claims.traveller,
                        'plugins.timeworks': !!claims.timeworks
                    });
                } else {
                    const pluginUpdates = {};
                    if (claims.shift_roster !== undefined) pluginUpdates['plugins.scheduling'] = !!claims.shift_roster;
                    if (claims.traveller !== undefined) pluginUpdates['plugins.traveller'] = !!claims.traveller;
                    if (claims.timeworks !== undefined) pluginUpdates['plugins.timeworks'] = !!claims.timeworks;

                    // Owners bridging from Central should always have an active company status in HR
                    if (claims.central_role === 'owner') {
                        pluginUpdates.status = 'active';
                    }
                    
                    if (Object.keys(pluginUpdates).length > 0) {
                        await updateDoc(compRef, pluginUpdates);
                        console.log('Synchronized company status and plugins');
                    }
                }
            }
        }

        // Reuse the logic from loginWithEmailPassword for consistency
        // If email is missing (e.g. anonymous or phone), we use UID
        if (email) {
            return await loginWithEmailPassword(email, null);
        } else {
             // Fetch doc by UID instead
             const userDocSnap = await getDoc(doc(db, 'users', firebaseUser.uid));
             if (!userDocSnap.exists()) {
                 throw new Error('User record not found in HR platform.');
             }
             const userData = { id: userDocSnap.id, ...userDocSnap.data() };
             return {
                 userId: firebaseUser.uid,
                 email: userData.email,
                 role: userData.primaryRole || 'employee',
                 displayName: userData.displayName,
                 companyId: userData.companyId,
                 siteId: userData.siteId,
                 firebaseUser
             };
        }
    } catch (error) {
        console.error('Bridge login error:', error);
        throw error;
    }
}

export async function logout() {
    try {
        // Clear all caches before signOut so refresh never shows previous user's data
        try {
            localStorage.removeItem('mprar_auth_cache_v1');
            localStorage.removeItem('mprar_global_cache_v1');
            clearAllCache();
            eventBus.emit('cache:company:invalidated', { all: true });
        } catch (e) {
            console.warn('auth.logout: Failed to clear some caches', e);
        }
        await signOut(auth);
    } catch (error) {
        console.error('Logout error:', error);
        throw new Error('Failed to logout. Please try again.');
    }
}

export async function createUserWithEmail(email, password) {
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        return userCredential.user;
    } catch (error) {
        if (error.code === 'auth/email-already-in-use') {
            throw new Error('An account with this email already exists.');
        } else if (error.code === 'auth/invalid-email') {
            throw new Error('Invalid email address format.');
        } else if (error.code === 'auth/weak-password') {
            throw new Error('Password should be at least 6 characters long.');
        } else if (error.code === 'auth/network-request-failed') {
            throw new Error('Network error. Please check your connection and try again.');
        } else {
            throw new Error(error.message || 'Account creation failed. Please try again.');
        }
    }
}

/**
 * Check if a user exists in Firebase Auth by email
 * @param {string} email - Email address to check
 * @returns {Promise<Object|null>} User object if exists, null otherwise
 */
export async function getUserByEmail(email) {
    try {
        // Query Firestore users collection to find user by email
        const usersCol = collection(db, 'users');
        const userQuery = query(usersCol, where('email', '==', email.toLowerCase()));
        const userSnap = await getDocs(userQuery);

        if (userSnap.empty) {
            return null;
        }

        const userDoc = userSnap.docs[0];
        return { userId: userDoc.id, ...userDoc.data() };
    } catch (error) {
        console.error('Error checking user by email:', error);
        return null;
    }
}




export async function sendPasswordResetLink(email) {
    try {
        // Redirect to Central Platform for identity management
        // Central is the master of identity and handles syncing to Firebase
        const centralBackendUrl = import.meta.env.VITE_CENTRAL_API_URL || 'http://localhost:5000';
        
        const response = await fetch(`${centralBackendUrl}/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.toLowerCase().trim() })
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || 'Failed to send reset link.');
        }

        return { success: true };
    } catch (error) {
        console.error('Password reset request failed via Central:', error);
        throw error;
    }
}
