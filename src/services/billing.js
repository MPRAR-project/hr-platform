import hrApiClient from '../lib/hrApiClient';

export const BILLING_EVENT_NAME = 'billing:updated';
export const BILLING_CONSTANTS = {
  PRICE_PER_SEAT: 5,
  TRIAL_DAYS: 14,
  CURRENCY: 'GBP'
};

const emitBillingEvent = () => {
  if (typeof window !== 'undefined' && window?.dispatchEvent) {
    window.dispatchEvent(new CustomEvent(BILLING_EVENT_NAME));
  }
};

export const updateBillingConfig = async (companyId, config) => {
  try {
    const { data } = await hrApiClient.put(`/hr/superadmin/companies/${companyId}/billing`, config);
    emitBillingEvent();
    return data;
  } catch (error) {
    console.error('[billing] Error updating billing config:', error);
    throw error;
  }
};

export const getBillingSummary = async (companyId) => {
  try {
    const { data } = await hrApiClient.get('/hr/billing/summary');
    return data;
  } catch (error) {
    console.error('Error fetching billing summary:', error);
    throw error;
  }
};

export const startTrial = async (companyId, seatCount) => {
  try {
    const { data } = await hrApiClient.post('/hr/billing/trial', { seatCount });
    emitBillingEvent();
    return data;
  } catch (error) {
    console.error('Error starting trial:', error);
    throw error;
  }
};

export const recordSubscriptionPayment = async (companyId, seatCountOverride = null) => {
  // This is now handled server-side or via Stripe
  return getBillingSummary(companyId);
};

export const recordSeatTopUp = async (companyId, addedSeats = 1, requestId = null) => {
  try {
    const { data } = await hrApiClient.post('/hr/billing/checkout', {
      seatCount: addedSeats,
      requestId,
      successUrl: `${window.location.origin}/billing?action=seat_added`,
      cancelUrl: `${window.location.origin}/billing?canceled=true`
    });
    
    if (data.url) {
      return { requiresCheckout: true, checkoutUrl: data.url };
    }
    
    emitBillingEvent();
    return data;
  } catch (error) {
    console.error('Error in seat top-up:', error);
    throw error;
  }
};

export const addPluginService = async (companyId, addonType) => {
  try {
    const { data } = await hrApiClient.post('/hr/billing/plugins', { type: addonType, enabled: true });
    emitBillingEvent();
    return data;
  } catch (error) {
    console.error('Error adding plugin:', error);
    throw error;
  }
};

export const removePluginService = async (companyId, addonType) => {
  try {
    const { data } = await hrApiClient.post('/hr/billing/plugins', { type: addonType, enabled: false });
    emitBillingEvent();
    return data;
  } catch (error) {
    console.error('Error removing plugin:', error);
    throw error;
  }
};

export const isSubscriptionExpired = (companyData) => {
  if (!companyData) return false;
  return companyData.isExpired || false;
};

export const listInvoices = async (filters = {}) => {
  try {
    const { data } = await hrApiClient.get('/hr/billing/invoices', { params: filters });
    return data;
  } catch (error) {
    console.error('Error fetching invoices:', error);
    throw error;
  }
};

