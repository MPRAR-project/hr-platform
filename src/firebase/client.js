import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage'; // ✅ Added Storage import

// Initialize Firebase app from Vite env vars
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FB_API_KEY,
    authDomain: import.meta.env.VITE_FB_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FB_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FB_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FB_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FB_APP_ID,
    measurementId: import.meta.env.VITE_FB_MEASUREMENT_ID,
};

let app;
const getApp = () => {
    if (!app) {
        app = initializeApp(firebaseConfig);
    }
    return app;
};

// Lazy getters for services
let _db;
export const getDb = () => {
    if (!_db) {
        _db = getFirestore(getApp());
        // ✅ Enable Multi-Tab Persistence for O(1) connection multiplexing and scaling
        if (typeof window !== 'undefined') {
            import('firebase/firestore').then(({ enableMultiTabIndexedDbPersistence }) => {
                enableMultiTabIndexedDbPersistence(_db).catch((err) => {
                    if (err.code === 'failed-precondition') {
                        console.warn('Firestore multi-tab persistence failed (multiple tabs open)');
                    } else if (err.code === 'unimplemented') {
                        console.warn('Firestore multi-tab persistence not supported by browser');
                    }
                });
            });
        }
    }
    return _db;
};

let _auth;
export const getAuthService = () => {
    if (!_auth) {
        _auth = getAuth(getApp());
        setPersistence(_auth, browserLocalPersistence).catch(() => { });
    }
    return _auth;
};

let _functions;
export const getFunctionsService = () => {
    if (!_functions) {
        _functions = getFunctions(getApp());
    }
    return _functions;
};

let _storage;
export const getStorageService = () => {
    if (!_storage) {
        _storage = getStorage(getApp());
    }
    return _storage;
};

// Maintain compatibility for existing imports
export const db = getDb();
export const auth = getAuthService();
export const functions = getFunctionsService();
export const storage = getStorageService();

// Temporary hash for demo only. Replace with proper auth or backend hashing.
export function weakClientHash(password, salt) {
    try {
        return btoa(`${password}:${salt}`).slice(0, 64);
    } catch (e) {
        return `${password}:${salt}`.slice(0, 64);
    }
}