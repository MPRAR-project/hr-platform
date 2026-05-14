import hrApiClient from '../../lib/hrApiClient';
import algoliasearch from 'algoliasearch/lite';

/**
 * Interface definition for Search Service
 */
class SearchServiceInterface {
    async searchUsers(params) { throw new Error('Not implemented'); }
    async searchTimesheets(params) { throw new Error('Not implemented'); }
}

/**
 * REST Implementation (Phase 4 — Postgres-backed)
 * Uses the HR REST API which queries PostgreSQL.
 */
class RESTSearchService extends SearchServiceInterface {
    async searchUsers({ companyId, searchTerm, role, limitCount = 20, page = 1 }) {
        try {
            const { data } = await hrApiClient.get('/hr/employees', {
                params: {
                    search: searchTerm,
                    hrRole: role,
                    limit: limitCount,
                    page
                }
            });

            return {
                hits: data.employees || [],
                nbHits: data.total || 0,
                lastDoc: null // REST uses numeric pagination
            };
        } catch (error) {
            console.error('[RESTSearch] Search failed:', error);
            return { hits: [], nbHits: 0 };
        }
    }

    async searchTimesheets({ employeeId, status, searchTerm, limitCount = 20 }) {
        try {
            const { data } = await hrApiClient.get('/hr/timesheets', {
                params: {
                    employeeId,
                    status,
                    search: searchTerm,
                    limit: limitCount
                }
            });
            return { hits: data.timesheets || [], nbHits: data.total || 0 };
        } catch (error) {
            console.error('[RESTSearch] Timesheet search failed:', error);
            return { hits: [], nbHits: 0 };
        }
    }
}

// Algolia Constants
const ALGOLIA_APP_ID = 'GYXI7HW7AB';
const ALGOLIA_SEARCH_KEY = '0e48fcdfe01c9b0e1c915e4158cde254';
const ALGOLIA_INDEX_NAME = 'users';

/**
 * Algolia Implementation for 1M+ Users (Optional fallback)
 */
class AlgoliaSearchService extends SearchServiceInterface {
    constructor() {
        super();
        this.client = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_SEARCH_KEY);
        this.usersIndex = this.client.initIndex(ALGOLIA_INDEX_NAME);
    }

    async searchUsers({ companyId, searchTerm, role, limitCount = 20 }) {
        try {
            let filters = `companyId:${companyId}`;
            if (role) filters += ` AND role:${role}`;

            const result = await this.usersIndex.search(searchTerm, {
                filters: filters,
                hitsPerPage: limitCount
            });

            return {
                hits: result.hits.map(h => ({ ...h, id: h.objectID })),
                nbHits: result.nbHits,
                lastDoc: null
            };
        } catch (error) {
            console.error('[Algolia] Search failed:', error);
            return { hits: [], nbHits: 0 };
        }
    }
}

// Factory
// Default to REST (Postgres) for Zero-Firebase compliance. 
// Can be toggled to Algolia for massive scale.
const SEARCH_PROVIDER = 'rest'; 

export const searchService = SEARCH_PROVIDER === 'rest' 
    ? new RESTSearchService() 
    : new AlgoliaSearchService();
