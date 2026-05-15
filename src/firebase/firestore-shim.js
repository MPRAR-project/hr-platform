// Firebase Shim for MPRAR HR Frontend (Post-Migration)
// This file provides empty mocks for Firebase SDKs to prevent build errors.

export const initializeApp = () => ({});
export const getAuth = () => ({ 
  currentUser: null, 
  onAuthStateChanged: (cb) => { cb(null); return () => {}; },
  signOut: async () => {},
});
export const getFirestore = () => ({});
export const getFunctions = () => ({});
export const getStorage = () => ({});

// Firestore mocks
export const doc = () => ({});
export const getDoc = async () => ({ exists: () => false, data: () => ({}) });
export const updateDoc = async () => {};
export const setDoc = async () => {};
export const collection = () => ({});
export const query = () => ({});
export const where = () => ({});
export const limit = () => ({});
export const orderBy = () => ({});
export const startAfter = () => ({});
export const onSnapshot = () => () => {};
export const getDocs = async () => ({ docs: [], forEach: () => {} });
export const serverTimestamp = () => new Date();
export const Timestamp = {
  now: () => new Date(),
  fromDate: (date) => date,
  fromMillis: (ms) => new Date(ms),
};
export const writeBatch = () => ({
  set: () => {},
  update: () => {},
  delete: () => {},
  commit: async () => {},
});

// Auth mocks
export const signInWithEmailAndPassword = async () => ({ user: {} });
export const createUserWithEmailAndPassword = async () => ({ user: {} });
export const onIdTokenChanged = () => () => {};

// Functions mocks
export const httpsCallable = () => async () => ({ data: {} });

// Storage mocks
export const ref = () => ({});
export const uploadBytes = async () => ({});
export const getDownloadURL = async () => '';

export default {
  initializeApp, getAuth, getFirestore, getFunctions, getStorage
};
