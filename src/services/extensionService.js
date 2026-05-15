import hrApiClient from '../lib/hrApiClient';

/**
 * extensionService.js
 * Handles training deadline extension requests.
 */
export const extensionService = {
  /**
   * Submit a new extension request
   */
  submitExtensionRequest: async (extensionData, userId, companyId) => {
    try {
      const { data } = await hrApiClient.post('/hr/training/extensions/submit', extensionData);
      return { success: true, data };
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Failed to submit extension request');
    }
  },

  /**
   * Approve an extension request (Managers only)
   */
  approveExtensionRequest: async (requestId, approverId, role, companyId, notes) => {
    try {
      const { data } = await hrApiClient.post(`/hr/training/extensions/${requestId}/approve`, { notes });
      return { success: true, data };
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Failed to approve extension request');
    }
  },

  /**
   * Decline an extension request (Managers only)
   */
  declineExtensionRequest: async (requestId, declinerId, role, companyId, reason) => {
    try {
      const { data } = await hrApiClient.post(`/hr/training/extensions/${requestId}/decline`, { reason });
      return { success: true, data };
    } catch (err) {
      throw new Error(err.response?.data?.error || 'Failed to decline extension request');
    }
  }
};

export default extensionService;
