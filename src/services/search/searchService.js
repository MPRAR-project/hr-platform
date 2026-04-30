import { db } from '../../firebase/client';
import { collection, query, where, getDocs, orderBy, limit, startAfter } from 'firebase/firestore';

/**
 * Interface definition for Search Service
 * Allows for swapping backend implementation (Firestore -> Algolia) transparently.
 */
class SearchServiceInterface {
    async searchUsers(params) { throw new Error('Not implemented'); }
    async searchTimesheets(params) { throw new Error('Not implemented'); }
}

/**
 * Firestore Implementation (Current Default)
 * Uses native Firestore queries. Best for < 50k users.
 */
class FirestoreSearchService extends SearchServiceInterface {
    async searchUsers({ companyId, searchTerm, role, limitCount = 20, lastDoc = null }) {
        const usersRef = collection(db, 'users');
        let q = query(usersRef, where('companyId', '==', `companies/${companyId}`));

        if (role) {
            q = query(q, where('roles', 'array-contains', role));
        }

        // Note: Firestore doesn't support full-text search natively.
        // We simulate prefix search for simple cases, but strictly this requires 
        // external services for 1M+ users as 'searchTerm' won't scale well here 
        // without a dedicated 'keywords' array.
        if (searchTerm) {
            // Basic prefix match (case-sensitive unfortunately in Firestore)
            // For 1M+ users, this method is NOT recommended.
            q = query(q,
                where('displayName', '>=', searchTerm),
                where('displayName', '<=', searchTerm + '\uf8ff')
            );
        }

        q = query(q, orderBy('displayName'), limit(limitCount));

        if (lastDoc) {
            q = query(q, startAfter(lastDoc));
        }

        const snap = await getDocs(q);
        return {
            hits: snap.docs.map(d => ({ id: d.id, ...d.data() })),
            lastDoc: snap.docs[snap.docs.length - 1],
            nbHits: snap.size // This is only for the page, not total
        };
    }
}

// Algolia Constants
const ALGOLIA_APP_ID = 'GYXI7HW7AB';
const ALGOLIA_SEARCH_KEY = '0e48fcdfe01c9b0e1c915e4158cde254';
const ALGOLIA_INDEX_NAME = 'users';

import algoliasearch from 'algoliasearch/lite';

/**
 * Algolia Implementation for 1M+ Users
 */
class AlgoliaSearchService extends SearchServiceInterface {
    constructor() {
        super();
        this.client = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_SEARCH_KEY);
        this.usersIndex = this.client.initIndex(ALGOLIA_INDEX_NAME);
    }

    async searchUsers({ companyId, searchTerm, role, limitCount = 20 }) {
        try {
            // Build filter string
            let filters = `companyId:${companyId}`;
            if (role) filters += ` AND role:${role}`;

            const result = await this.usersIndex.search(searchTerm, {
                filters: filters,
                hitsPerPage: limitCount
            });

            return {
                hits: result.hits.map(h => ({ ...h, id: h.objectID })),
                nbHits: result.nbHits,
                lastDoc: null // Algolia uses pages, not cursors
            };
        } catch (error) {
            console.error('[Algolia] Search failed:', error);
            return { hits: [], nbHits: 0 };
        }
    }
}

// Factory
const USE_EXTERNAL_SEARCH = true; // Enabled for 1M+ Scale

export const searchService = USE_EXTERNAL_SEARCH
    ? new AlgoliaSearchService()
    : new FirestoreSearchService();
