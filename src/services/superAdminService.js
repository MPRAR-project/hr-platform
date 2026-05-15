import hrApiClient from '../lib/hrApiClient';

/**
 * Super Admin Service (Phase 4 — REST Migration)
 */

export async function fetchAllUsers(options = {}) {
  try {
    const { data } = await hrApiClient.get('/hr/superadmin/users', {
      params: options,
    });
    return data;
  } catch (error) {
    console.error('[superAdminService] Error fetching all users:', error);
    throw error;
  }
}

export async function fetchAllCompanies() {
  try {
    const { data } = await hrApiClient.get('/hr/superadmin/companies');
    return data.companies || data || [];
  } catch (error) {
    console.error('[superAdminService] Error fetching all companies:', error);
    throw error;
  }
}

export async function fetchUsersByCompanyGrouped() {
  try {
    const { data } = await hrApiClient.get('/hr/superadmin/users/grouped-by-company');
    return data.grouped || data || {};
  } catch (error) {
    console.error('[superAdminService] Error fetching grouped users:', error);
    throw error;
  }
}

export async function updateWeekStartConfig(companyId, config) {
  try {
    const { data } = await hrApiClient.post(`/hr/superadmin/companies/${companyId}/week-start`, config);
    return data;
  } catch (error) {
    console.error('[superAdminService] Error updating week start config:', error);
    throw error;
  }
}

export async function scanDataForCleanup(targetType, targetId, options = {}) {
  try {
    const { data } = await hrApiClient.get('/hr/superadmin/cleanup/scan', {
      params: { targetType, targetId, ...options },
    });
    return data;
  } catch (error) {
    console.error('[superAdminService] Error scanning data for cleanup:', error);
    throw error;
  }
}

export async function performDataCleanup(targetType, targetId, options = {}) {
  try {
    const { data } = await hrApiClient.post('/hr/superadmin/cleanup/execute', {
      targetType,
      targetId,
      ...options,
    });
    return data;
  } catch (error) {
    console.error('[superAdminService] Error performing data cleanup:', error);
    throw error;
  }
}

const superAdminService = {
  fetchAllUsers,
  fetchAllCompanies,
  fetchUsersByCompanyGrouped,
  updateWeekStartConfig,
  scanDataForCleanup,
  performDataCleanup,
};

export default superAdminService;
