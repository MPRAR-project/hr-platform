import hrApiClient from '../lib/hrApiClient';
import { toast } from 'react-toastify';

/**
 * Company Management Service (Phase 4 — REST Migration)
 * 
 * Handles company-level administrative tasks via HR REST API.
 */

/**
 * Suspend a company and all its users
 */
export async function suspendCompany(companyId) {
  try {
    const { data } = await hrApiClient.post('/hr/company/suspend');
    toast.success('Company suspended successfully.');
    return data;
  } catch (error) {
    console.error('[companyManagementService] Failed to suspend company:', error);
    toast.error(error?.response?.data?.error || 'Failed to suspend company');
    throw error;
  }
}

/**
 * Activate a company
 */
export async function activateCompany(companyId) {
  try {
    const { data } = await hrApiClient.post('/hr/company/activate');
    toast.success('Company activated successfully.');
    return data;
  } catch (error) {
    console.error('[companyManagementService] Failed to activate company:', error);
    toast.error(error?.response?.data?.error || 'Failed to activate company');
    throw error;
  }
}

/**
 * Fetch all companies (SuperUser only)
 */
export async function getAllCompanies() {
  try {
    const { data } = await hrApiClient.get('/hr/companies');
    return (data || []).map(c => ({
      value: c.id,
      label: c.name || 'Unnamed Company'
    }));
  } catch (error) {
    console.error('[companyManagementService] Failed to fetch companies:', error);
    return [];
  }
}

/**
 * Update a specific plugin setting for a company
 */
export async function updateCompanyPlugin(companyId, pluginKey, isEnabled) {
  try {
    const { data } = await hrApiClient.post('/hr/billing/plugins', {
      type: pluginKey,
      enabled: isEnabled,
    });
    return data;
  } catch (error) {
    console.error(`[companyManagementService] Failed to update plugin ${pluginKey}:`, error);
    toast.error(`Failed to update ${pluginKey} settings`);
    throw error;
  }
}

/**
 * Update all plugin settings (one POST per key — billing endpoint is atomic per plugin)
 */
export async function updateCompanyPlugins(companyId, plugins) {
  try {
    const results = await Promise.all(
      Object.entries(plugins).map(([type, enabled]) =>
        hrApiClient.post('/hr/billing/plugins', { type, enabled: Boolean(enabled) })
          .then(r => r.data)
      )
    );
    return results;
  } catch (error) {
    console.error('[companyManagementService] Failed to update plugins:', error);
    throw error;
  }
}

/**
 * Get company details
 */
export async function getCompany(companyId) {
  try {
    const { data } = await hrApiClient.get('/hr/company');
    return data;
  } catch (error) {
    console.error('[companyManagementService] Failed to fetch company:', error);
    return null;
  }
}

/**
 * Get plugin settings for a company
 */
export async function getCompanyPlugins(companyId) {
  try {
    const response = await getCompany(companyId);
    if (!response) return {};
    // Response shape: { company: { plugins: {...}, ... }, ... }
    const company = response.company || response;
    const p = company?.plugins || {};
    return {
      scheduling: p.scheduling,
      payslipAndInvoice: p.payslipAndInvoice,
      hiring: p.hiring,
      assets: p.assets,
      absence: p.absence !== false,
    };
  } catch (error) {
    console.error('[companyManagementService] Failed to fetch plugins:', error);
    return {};
  }
}

/**
 * Update company profile
 */
export async function updateCompanyProfile(companyId, updateData) {
    try {
        const { data } = await hrApiClient.put('/hr/company', updateData);
        return data;
    } catch (error) {
        console.error('[companyManagementService] Profile update failed:', error);
        throw error;
    }
}
