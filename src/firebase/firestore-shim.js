/**
 * Firestore Shim for MPRAR Central
 * Satisfies all legacy firestore imports by providing no-op or proxy functions.
 */

export const getFirestore = () => ({ _isShim: true });
export const getCountFromServer = async () => ({ data: () => ({ count: 0 }) });
export const collection = (db, path) => ({ path, _isShim: true });
export const doc = (db, path, id) => ({ path, id, _isShim: true });
export const query = (col, ...constraints) => ({ col, constraints, _isShim: true });
export const where = (field, op, value) => ({ field, op, value, _isShim: true });
export const getDocs = async (q) => ({ docs: [], empty: true, size: 0 });
export const getDoc = async (d) => ({ exists: () => false, data: () => ({}) });
export const setDoc = async () => {};
export const updateDoc = async () => {};
export const deleteDoc = async () => {};
export const addDoc = async () => ({ id: 'shim-' + Date.now() });
export const onSnapshot = (q, cb) => { cb({ docs: [], empty: true }); return () => {}; };
export const serverTimestamp = () => new Date();
export const increment = (n) => n;
export const arrayUnion = (...items) => items;
export const arrayRemove = (...items) => items;
export const orderBy = () => ({ _isShim: true });
export const limit = () => ({ _isShim: true });
export const startAfter = () => ({ _isShim: true });
export const writeBatch = () => ({ 
  set: () => {}, 
  update: () => {}, 
  delete: () => {}, 
  commit: async () => {} 
});
export const documentId = () => '__name__';
export const Timestamp = {
    now: () => ({ toDate: () => new Date(), seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 }),
    fromDate: (d) => ({ toDate: () => d, seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0 }),
    fromMillis: (m) => ({ toDate: () => new Date(m), seconds: Math.floor(m / 1000), nanoseconds: 0 })
};

export default {
    collection, doc, query, where, getDocs, getDoc, setDoc, updateDoc, deleteDoc, addDoc, onSnapshot,
    serverTimestamp, increment, arrayUnion, arrayRemove, orderBy, limit, startAfter, writeBatch,
    documentId, Timestamp
};
