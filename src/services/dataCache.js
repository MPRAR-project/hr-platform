// Data Cache Shim for MPRAR HR Frontend
// Mocks caching functions to prevent build errors during the REST transition.

export const clearAllCache = () => {
  console.log('[DataCache] Cache cleared (Shim)');
};

export const getCachedData = (key) => null;
export const setCachedData = (key, data) => {};

export const fetchCompanyDashboardData = async () => ({});
export class DataCache {
  static clearAll() {}
  static get(key) { return null; }
  static set(key, val) {}
}

export default {
  clearAllCache,
  getCachedData,
  setCachedData,
  fetchCompanyDashboardData,
  DataCache
};
