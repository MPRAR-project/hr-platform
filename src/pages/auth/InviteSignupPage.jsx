import React, { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { auth, db } from "../../firebase/client";
import {
  doc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  updateDoc,
} from "firebase/firestore";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { getCompanyOnboardingSettings, getOnboardingRedirectPath, retryOperation } from "../../utils/onboardingUtils";

const InviteSignupPage = () => {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState(sp.get("email") || "");
  const [token, setToken] = useState(sp.get("token") || "");
  const [valid, setValid] = useState(false);
  const [invite, setInvite] = useState(null);
  const [password, setPassword] = useState("");
  const [cpass, setCpass] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);


  // useEffect(() => {


  //   const fetchCompanyData = async (companyId) => {
  //     try {
  //       // Reference to the document
  //       const companyRef = doc(db, "companies", companyId);

  //       // Get document snapshot
  //       const companySnap = await getDoc(companyRef);

  //       if (companySnap.exists()) {
  //         console.log("Company Data:", companySnap.data());
  //         return companySnap.data();
  //       } else {
  //         console.log("No such company!");
  //         return null;
  //       }
  //     } catch (error) {
  //       console.error("Error fetching company:", error);
  //       throw error;
  //     }
  //   };

  //   fetchCompanyData(invite.companyId);
  // }, []);


  useEffect(() => {
    const verify = async () => {
      try {
        setLoading(true);
        setErr("");
        if (!email || !token) {
          setErr("Invalid invite link");
          setLoading(false);
          return;
        }
        const iq = query(
          collection(db, "invites"),
          where("email", "==", email.toLowerCase()),
          where("status", "==", "pending")
        );
        const snap = await getDocs(iq);
        if (snap.empty) {
          setErr("Invite not found or already used");
          setLoading(false);
          return;
        }
        const docSnap = snap.docs.sort(
          (a, b) =>
            (b.data().createdAt?.toMillis?.() || 0) -
            (a.data().createdAt?.toMillis?.() || 0)
        )[0];
        const inv = { id: docSnap.id, ...docSnap.data() };
        if (inv.expiresAt?.toMillis?.() < Date.now()) {
          setErr("Invite expired");
          setLoading(false);
          return;
        }
        // SHA-256 check
        const enc = new TextEncoder();
        const buf = await crypto.subtle.digest("SHA-256", enc.encode(token));
        const hex = [...new Uint8Array(buf)]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        if (hex !== inv.tokenHash) {
          setErr("Invalid token");
          setLoading(false);
          return;
        }
        setInvite(inv);
        setValid(true);
      } catch (e) {
        setErr("Failed to validate invite");
      } finally {
        setLoading(false);
      }
    };
    verify();
  }, [email, token]);

  const [isSignInMode, setIsSignInMode] = useState(false);

  const processUserSetup = async (uid) => {
    try {
      // Ensure Firebase Auth state is available before any Firestore writes.
      // Firestore security rules rely on `request.auth.uid`.
      if (!auth.currentUser || auth.currentUser.uid !== uid) {
        throw new Error("Authentication not ready. Please try again.");
      }
      await auth.currentUser.getIdToken(true);

      const { getDoc } = await import("firebase/firestore");
      const userRef = doc(db, "users", uid);
      const userSnap = await getDoc(userRef);

      const now = new Date();
      let isExistingUser = false;
      let userData = {
        userId: uid,
        email: email.toLowerCase(),
        displayName: invite.displayName || email,
        updatedAt: now,
      };

      if (userSnap.exists()) {
        isExistingUser = true;
        // Merge with existing data, updating only necessary fields for the context of this invite
        // We do NOT overwrite name if it exists, unless it's a placeholder
        const existing = userSnap.data();
        userData = {
          ...existing,
          primaryCompanyId: `companies/${invite.companyId}`, // Switch context to this company
          // We can optionally update other fields if they are missing
          updatedAt: now
        };
      } else {
        // New user
        userData = {
          ...userData,
          firstName: invite.displayName?.split(' ')[0] || '',
          lastName: invite.displayName?.split(' ').slice(1).join(' ') || '',
          primaryRole: invite.primaryRole, // Default role for global user doc (can be overwritten by profile)
          roles: [invite.primaryRole],
          // Legacy fields for backward compatibility
          role: invite.primaryRole,
          companyId: `companies/${invite.companyId}`,
          primaryCompanyId: `companies/${invite.companyId}`,
          siteId: `sites/${invite.siteId}`,
          reportsTo: invite.reportsTo || null,
          managerUserId: invite.reportsTo || null,
          teamId: invite.reportsTo || null,

          status: "active",
          isOnboardingCompleted: false,
          isOnboardingMandatory: invite.isOnboardingMandatory || false,
          requiresHROnboarding: invite.requiresHROnboarding || false,
          isTrainingMandatory: invite.isTrainingMandatory || false,
          createdAt: now
        };
      }

      // 1. Update/Create Global User Doc
      if (isExistingUser) {
        await updateDoc(userRef, userData);
      } else {
        await setDoc(userRef, userData);
      }

      // 2. Create/Update Company Profile (Idempotent check inside service or just create)
      // The service createUserCompanyProfile creates a new doc. 
      // We should check if one exists first to avoid duplicates if user clicks twice.
      const { createUserCompanyProfile, hasCompanyProfile } = await import('../../services/userCompanyProfiles');

      const existingProfile = await hasCompanyProfile(uid, invite.companyId);

      if (!existingProfile) {
        await createUserCompanyProfile(uid, invite.companyId, {
          primaryRole: invite.primaryRole,
          roles: [invite.primaryRole],
          siteId: `sites/${invite.siteId}`,
          reportsTo: invite.reportsTo || null,
          teamId: invite.reportsTo || null,
          managerUserId: invite.reportsTo || null,
          // Ensure status is active
          status: 'active'
        });
        console.log('Company profile created for invited user:', uid);
      } else {
        // If profile exists (maybe archived?), we should update it to active?
        // The user expects to be "re-invited" essentially.
        const { unarchiveCompanyProfile } = await import('../../services/userCompanyProfiles');
        if (existingProfile.status !== 'active') {
          await unarchiveCompanyProfile(uid, invite.companyId);
          console.log('Existing profile reactivated for invited user:', uid);
        }
      }

      await updateDoc(doc(db, "invites", invite.id), {
        status: "accepted",
        updatedAt: new Date(),
      });
      setLoading(false);

      // Use user-specific onboarding logic to determine redirect path
      try {
        const redirectPath = getOnboardingRedirectPath(userDoc, null);

        console.log('Redirecting new user to:', redirectPath);
        navigate(redirectPath);
      } catch (redirectError) {
        console.error('Error determining redirect path for new user:', redirectError);

        // For new users, if onboarding is mandatory, redirect to onboarding
        // Otherwise, go to dashboard
        if (userDoc.isOnboardingMandatory) {
          console.log('Onboarding is mandatory for this user, redirecting to onboarding');
          navigate('/emp/onboarding');
        } else {
          console.log('Onboarding not mandatory, redirecting to dashboard');
          navigate('/');
        }
      }
    } catch (error) {
      console.error("Error in processUserSetup:", error);
      throw error; // Re-throw to be caught by onSubmit
    }
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      setErr("");
      if (!valid || !invite) throw new Error("Invite invalid");

      if (!isSignInMode && (!password || password !== cpass))
        throw new Error("Passwords do not match");

      let uid;

      if (isSignInMode) {
        // Sign In Flow
        const { signInWithEmailAndPassword } = await import("firebase/auth");
        const cred = await signInWithEmailAndPassword(auth, email, password);
        uid = cred.user.uid;
        await cred.user.getIdToken(true);
      } else {
        // Sign Up Flow
        try {
          const cred = await createUserWithEmailAndPassword(auth, email, password);
          uid = cred.user.uid;
          await cred.user.getIdToken(true);
        } catch (signUpError) {
          if (signUpError.code === 'auth/email-already-in-use') {
            setLoading(false);
            setIsSignInMode(true);
            setErr("An account with this email already exists. Please enter your password to sign in and accept the invite.");
            return;
          }
          throw signUpError;
        }
      }

      await processUserSetup(uid);

    } catch (e) {
      setLoading(false);
      setErr(e.message || "Failed to complete signup");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-100 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 border border-gray-100 animate-fadeIn">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-800">
            {isSignInMode ? "👋 Welcome Back" : "🎉 Complete Your Account"}
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {isSignInMode
              ? "Sign in to accept this invitation and join the team."
              : "Welcome! Let’s finish setting up your account."}
          </p>
        </div>

        {loading && (
          <div className="text-center py-10 text-gray-600">
            <p className="animate-pulse">
              {isSignInMode ? "Signing you in..." : "Validating your invite..."}
            </p>
          </div>
        )}

        {!loading && !valid && err && !isSignInMode && (
          <div className="text-center py-6">
            <p className="text-red-600 font-medium">{err}</p>
          </div>
        )}

        {!loading && valid && (
          <form onSubmit={onSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                value={email}
                disabled
                className="w-full border border-gray-300 rounded-lg px-3 py-2 bg-gray-100 cursor-not-allowed text-gray-600"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder={isSignInMode ? "Enter your password" : "Enter a secure password"}
              />
            </div>

            {!isSignInMode && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={cpass}
                  onChange={(e) => setCpass(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="Re-enter your password"
                />
              </div>
            )}

            {err && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-red-600 text-sm text-center">{err}</p>
              </div>
            )}

            <button
              type="submit"
              className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 text-white py-2.5 rounded-lg font-semibold shadow hover:from-purple-700 hover:to-indigo-700 transition-all"
            >
              {loading
                ? (isSignInMode ? "Signing In..." : "Creating Account...")
                : (isSignInMode ? "Sign In & Accept Invite" : "Create Account")
              }
            </button>

            {isSignInMode && (
              <button
                type="button"
                onClick={() => {
                  setIsSignInMode(false);
                  setErr("");
                }}
                className="w-full text-sm text-purple-600 font-medium hover:underline mt-2"
              >
                Create a new account instead?
              </button>
            )}
          </form>
        )}

        <div className="text-center text-xs text-gray-400 mt-6">
          By continuing, you agree to our{" "}
          <a href="#" className="text-purple-500 hover:underline">
            Terms of Service
          </a>{" "}
          and{" "}
          <a href="#" className="text-purple-500 hover:underline">
            Privacy Policy
          </a>
          .
        </div>
      </div>
    </div>
  );
};

export default InviteSignupPage;
