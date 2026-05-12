/**
 * Auth Shim for MPRAR Central
 * Satisfies all legacy auth imports.
 */

export const getAuth = () => ({ currentUser: null });
export const signInWithEmailAndPassword = async () => ({ user: { uid: 'shim' } });
export const createUserWithEmailAndPassword = async () => ({ user: { uid: 'shim' } });
export const signOut = async () => {};
export const onAuthStateChanged = (auth, cb) => { cb(null); return () => {}; };
export const updateProfile = async () => {};
export const sendPasswordResetEmail = async () => {};
export const GoogleAuthProvider = class {};
export const signInWithPopup = async () => ({ user: { uid: 'shim' } });

export default {
    getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
    onAuthStateChanged, updateProfile, sendPasswordResetEmail, GoogleAuthProvider,
    signInWithPopup
};
