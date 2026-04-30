/**
 * Prefetch document data so Documents page loads in <500ms when user navigates.
 * Call when user is ready (e.g. from MainLayout); uses limit for fast response.
 */
import { documentService } from './documentService';

const PREFETCH_LIMIT = 100; // Fewer docs = faster (~500ms)
const CACHE_TTL_MS = 7 * 60 * 1000;

export async function prefetchDocumentData(companyId, userRole, userId, setItem) {
  if (!companyId || !userRole || !userId || typeof setItem !== 'function') return;
  const cacheKey = `docs_${companyId}_${userRole}_${userId}`;
  try {
    const [requestsResult, documentsResult, statsResult] = await Promise.all([
      documentService.getDocumentRequests(companyId, userRole, userId, { status: 'all', limit: PREFETCH_LIMIT }),
      documentService.getDocuments(companyId, userRole, userId, { status: 'all', documentType: 'all', limit: PREFETCH_LIMIT }),
      documentService.getDocumentStatistics(companyId, userRole, userId)
    ]);
    const data = {
      requests: requestsResult.success ? requestsResult.data : [],
      documents: documentsResult.success ? documentsResult.data : [],
      statistics: statsResult.success ? statsResult.data : {}
    };
    setItem(cacheKey, data, CACHE_TTL_MS);
  } catch (_) {
    // Prefetch is best-effort; ignore errors
  }
}
