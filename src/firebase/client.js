/**
 * MPRAR Central - Firebase Client Shim
 * This file replaces the original firebase client initialization.
 * It provides dummy objects to satisfy imports.
 */

export const db = {
  _isShim: true,
  collection: () => ({ _isShim: true }),
  doc: () => ({ _isShim: true })
};

export const auth = {
  _isShim: true,
  currentUser: null,
  onAuthStateChanged: (cb) => {
    // We can potentially link this to our new auth state
    return () => {};
  }
};

export const storage = {
  _isShim: true
};

export const functions = {
  _isShim: true
};

export default { db, auth, storage, functions };
