// @refresh reset
import React, { createContext, useContext, useRef, useCallback, useEffect } from 'react';
import eventBus from '../services/EventBus';

const CACHE_COMPANY_INVALIDATED = 'cache:company:invalidated';
const CacheContext = createContext(null);

export const useCache = () => {
    const context = useContext(CacheContext);
    if (!context) {
        throw new Error('useCache must be used within a CacheProvider');
    }
    return context;
};

export const CacheProvider = ({ children }) => {
    const STORAGE_KEY = 'mprar_global_cache_v1';

    // Keys that should never survive a page refresh to ensure data accuracy for lists
    const NON_PERSISTENT_PREFIXES = [
        'superadmin_users_',
        'paginated_users_',
        'user-list-',
        'company-dashboard-'
    ];

    // Load initial state from localStorage
    const loadFromStorage = () => {
        try {
            const persisted = localStorage.getItem(STORAGE_KEY);
            if (!persisted) return new Map();
            const { data, timestamp } = JSON.parse(persisted);
            // Ignore entire storage if extremely old (e.g. 24 hours)
            if (Date.now() - timestamp > 24 * 60 * 60 * 1000) return new Map();

            const map = new Map();
            for (const [key, value] of Object.entries(data)) {
                // Skip non-persistent prefixes on load
                if (NON_PERSISTENT_PREFIXES.some(p => key.startsWith(p))) continue;

                if (Date.now() < value.expiry) {
                    map.set(key, value);
                }
            }
            return map;
        } catch (e) {
            console.error('CacheProvider: Failed to load from storage', e);
            return new Map();
        }
    };

    const cache = useRef(loadFromStorage());

    const saveToStorage = useCallback(() => {
        try {
            const dataToPersist = {};
            for (const [key, value] of cache.current.entries()) {
                // Skip non-persistent prefixes
                if (NON_PERSISTENT_PREFIXES.some(p => key.startsWith(p))) continue;

                if (Date.now() < value.expiry) {
                    dataToPersist[key] = value;
                }
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                data: dataToPersist,
                timestamp: Date.now()
            }));
        } catch (e) {
            console.warn('CacheProvider: Failed to save to storage', e);
        }
    }, []);

    const setItem = useCallback((key, data, ttl = 300000) => { // Default TTL: 5 minutes
        const item = {
            data,
            expiry: Date.now() + ttl,
        };
        cache.current.set(key, item);
        saveToStorage();
    }, [saveToStorage]);

    const getItem = useCallback((key) => {
        const item = cache.current.get(key);
        if (!item) return null;

        if (Date.now() > item.expiry) {
            cache.current.delete(key);
            saveToStorage();
            return null;
        }

        return item.data;
    }, [saveToStorage]);

    const clearItem = useCallback((key) => {
        cache.current.delete(key);
        saveToStorage();
    }, [saveToStorage]);

    const clearItemsByPrefix = useCallback((prefix) => {
        const toDelete = [];
        for (const key of cache.current.keys()) {
            if (key.startsWith(prefix)) toDelete.push(key);
        }
        toDelete.forEach(k => cache.current.delete(k));
        if (toDelete.length) saveToStorage();
    }, [saveToStorage]);

    const clearAll = useCallback(() => {
        cache.current.clear();
        localStorage.removeItem(STORAGE_KEY);
    }, []);

    const value = {
        setItem,
        getItem,
        clearItem,
        clearItemsByPrefix,
        clearAll
    };

    return (
        <CacheContext.Provider value={value}>
            <CacheInvalidationListener clearItemsByPrefix={clearItemsByPrefix} clearAll={clearAll} />
            {children}
        </CacheContext.Provider>
    );
};

function CacheInvalidationListener({ clearItemsByPrefix, clearAll }) {
    useEffect(() => {
        const unsub = eventBus.on(CACHE_COMPANY_INVALIDATED, (payload) => {
            if (payload?.all) {
                clearAll();
            } else if (payload?.companyId) {
                clearItemsByPrefix(`paginated_users_${payload.companyId}`);
            }
        }, 'CacheContext');
        return unsub;
    }, [clearItemsByPrefix, clearAll]);
    return null;
}

export default CacheProvider;
