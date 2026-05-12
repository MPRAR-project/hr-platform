import { useState, useEffect, useCallback } from 'react';
import { fetchHrEmployees } from '../services/users';

export function useHrEmployees(companyId, { initialLimit = 20, search = '' } = {}) {
    const [employees, setEmployees] = useState([]);
    const [nextCursor, setNextCursor] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [hasMore, setHasMore] = useState(false);
    const [currentSearch, setCurrentSearch] = useState(search);

    const loadEmployees = useCallback(async (opts = {}) => {
        if (!companyId) return;
        setLoading(true);
        setError(null);

        try {
            const response = await fetchHrEmployees(companyId, {
                limit: opts.limit || initialLimit,
                cursor: opts.cursor || null,
                search: opts.search ?? currentSearch,
            });

            setEmployees((prev) => {
                if (opts.reset) {
                    return response.employees;
                }
                const existingIds = new Set(prev.map((item) => item.id));
                return [...prev, ...response.employees.filter((item) => !existingIds.has(item.id))];
            });
            setNextCursor(response.nextCursor || null);
            setHasMore(Boolean(response.nextCursor));
            setCurrentSearch(opts.search ?? currentSearch);
        } catch (err) {
            setError(err);
        } finally {
            setLoading(false);
        }
    }, [companyId, currentSearch, initialLimit]);

    useEffect(() => {
        if (!companyId) return;
        setEmployees([]);
        setNextCursor(null);
        setHasMore(false);
        loadEmployees({ reset: true, search });
    }, [companyId, loadEmployees, search]);

    const loadMore = useCallback(() => {
        if (!hasMore || loading) return;
        loadEmployees({ cursor: nextCursor, search: currentSearch });
    }, [currentSearch, hasMore, loadEmployees, loading, nextCursor]);

    return { employees, nextCursor, hasMore, loading, error, loadMore, reload: () => loadEmployees({ reset: true, search: currentSearch }) };
}
