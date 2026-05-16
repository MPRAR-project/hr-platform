import { useState, useCallback, useRef, useEffect } from 'react';
import { userGroupingService } from '../services/userGroupingService';
import { useCache } from '../contexts/CacheContext';
import eventBus from '../services/EventBus';
import { CACHE_EVENTS } from '../services/cacheInvalidationService';
import wsClient from '../lib/wsClient';


const CACHE_TTL = 7 * 60 * 1000;

export function usePaginatedUsers(rawCompanyId, pageSize = 20) {
    const companyId = (rawCompanyId || '').replace(/^companies\//, '');
    const { getItem, setItem, clearItem } = useCache();

    const [users, setUsers] = useState([]);
    const [lastDoc, setLastDoc] = useState(null);
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [error, setError] = useState(null);

    const loadingRef = useRef(false);

    const loadMore = useCallback(async (reset = false) => {
        if (!companyId) return;
        if (loadingRef.current) return;
        if (!reset && !hasMore) return;

        const currentLastDoc = reset ? null : lastDoc;
        const isFirstPage = !currentLastDoc;
        const cacheKey = `paginated_users_${companyId}_p1`;

        // STALE-WHILE-REVALIDATE: Check cache for first page
        if (isFirstPage) {
            const cachedData = getItem(cacheKey);
            if (cachedData && cachedData.users?.length > 0) {
                // Sanity deduplication of cached data by email to prevent historical duplicates from showing
                const seen = new Set();
                const uniqueCached = (cachedData.users || []).filter(u => {
                    const email = (u.email || '').toLowerCase();
                    if (!email) return true;
                    if (seen.has(email)) return false;
                    seen.add(email);
                    return true;
                });

                setUsers(uniqueCached);
                setHasMore(cachedData.hasMore);
                // We don't set lastDoc from cache because it's a Firestore object which cannot be JSON serialized
                // This means 'load more' will always trigger a fresh fetch, which is safer.
                setLoading(false);
            } else {
                setLoading(true);
            }
        } else {
            setLoading(true);
        }

        loadingRef.current = true;
        if (reset) setError(null);

        try {
            const result = await userGroupingService.fetchPaginatedUsers(companyId, pageSize, currentLastDoc);

            // If it's the first page, update persistent cache
            if (isFirstPage) {
                // We only store the serializable part (users + hasMore)
                setItem(cacheKey, { users: result.users, hasMore: result.hasMore }, CACHE_TTL);

                // Optimization: Avoid updating state if network data matches current (cached) data
                const currentDataString = JSON.stringify(users.slice(0, pageSize));
                const newDataString = JSON.stringify(result.users);
                if (isFirstPage && currentDataString === newDataString && !reset) {
                    // Skip updating state to avoid jitter
                } else {
                    setUsers(result.users);
                }
            } else {
                setUsers(prev => {
                    const existingIds = new Set(prev.map(u => u.id));
                    const existingEmails = new Set(prev.map(u => (u.email || '').toLowerCase()).filter(Boolean));

                    const newUniqueUsers = result.users.filter(u => {
                        const email = (u.email || '').toLowerCase();
                        const isDuplicateId = existingIds.has(u.id);
                        const isDuplicateEmail = email && existingEmails.has(email);

                        if (isDuplicateId || isDuplicateEmail) return false;

                        if (email) existingEmails.add(email);
                        existingIds.add(u.id);
                        return true;
                    });
                    return [...prev, ...newUniqueUsers];
                });
            }

            setLastDoc(result.lastDoc);
            setHasMore(result.hasMore);
        } catch (err) {
            console.error('Failed to load users:', err);
            setError(err);
        } finally {
            setLoading(false);
            loadingRef.current = false;
        }
    }, [companyId, pageSize, lastDoc, hasMore, getItem, setItem, users]);

    const reload = useCallback(() => {
        clearItem(`paginated_users_${companyId}_p1`);
        loadMore(true);
    }, [companyId, clearItem, loadMore]);

    const loadMoreRef = useRef(loadMore);
    loadMoreRef.current = loadMore;

    // Refetch when cache is invalidated (DB was updated)
    useEffect(() => {
        if (!companyId) return;
        const unsub = eventBus.on(CACHE_EVENTS.COMPANY_INVALIDATED, (payload) => {
            const targetId = (payload?.companyId || '').replace(/^companies\//, '');
            const myId = (companyId || '').replace(/^companies\//, '');
            if (payload?.all || targetId === myId) {
                clearItem(`paginated_users_${myId || targetId}_p1`);
                loadMoreRef.current?.(true);
            }
        }, 'usePaginatedUsers');
        return unsub;
    }, [companyId, clearItem]);

    // Listen for real-time WebSocket events from Central Sync
    useEffect(() => {
        if (!companyId) return;
        
        const handleSync = () => {
            console.log('[usePaginatedUsers] Real-time sync event received, clearing cache and reloading...');
            clearItem(`paginated_users_${companyId}_p1`);
            reload();
        };

        wsClient.on('employee:synced', handleSync);
        wsClient.on('users:reload', handleSync);

        return () => {
            wsClient.off('employee:synced', handleSync);
            wsClient.off('users:reload', handleSync);
        };
    }, [companyId, reload, clearItem]);

    return { users, loadMore, hasMore, loading, error, reload };
}
