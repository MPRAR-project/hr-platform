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
    const { data } = await hrApiClient.get('/hr/platform/companies'); // Need this endpoint
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
    const { data } = await hrApiClient.put('/hr/company/plugins', {
      [pluginKey]: isEnabled
    });
    return data;
  } catch (error) {
    console.error(`[companyManagementService] Failed to update plugin ${pluginKey}:`, error);
    toast.error(`Failed to update ${pluginKey} settings`);
    throw error;
  }
}

/**
 * Update all plugin settings
 */
export async function updateCompanyPlugins(companyId, plugins) {
  try {
    const { data } = await hrApiClient.put('/hr/company/plugins', plugins);
    return data;
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
    const data = await getCompany(companyId);
    if (!data) return {};
    return {
      scheduling: data.pluginScheduling,
      payslipAndInvoice: data.pluginPayslipAndInvoice,
      hiring: data.pluginHiring,
      assets: data.pluginAssets,
      absence: data.pluginAbsence !== false
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
