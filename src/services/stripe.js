import hrApiClient from '../lib/hrApiClient';

export const USE_STRIPE = import.meta.env.VITE_USE_STRIPE === 'true';

export const createStripeCustomer = async (companyId, email, name) => {
  if (!USE_STRIPE) throw new Error('Stripe is disabled');
  const { data } = await hrApiClient.post('/hr/billing/customer', { companyId, email, name });
  return data.customerId;
};

export const createStripeSubscription = async (customerId, seatCount, companyId) => {
  if (!USE_STRIPE) throw new Error('Stripe is disabled');
  const { data } = await hrApiClient.post('/hr/billing/subscription', { customerId, seatCount, companyId });
  return data;
};

export const updateStripeSubscription = async (subscriptionId, newQuantity, companyId, prorate = true) => {
  if (!USE_STRIPE) throw new Error('Stripe is disabled');
  const { data } = await hrApiClient.put(`/hr/billing/subscription/${subscriptionId}`, { newQuantity, companyId, prorate });
  return data.subscriptionId;
};

export const cancelStripeSubscription = async (subscriptionId, companyId, immediately = false) => {
  if (!USE_STRIPE) throw new Error('Stripe is disabled');
  const { data } = await hrApiClient.delete(`/hr/billing/subscription/${subscriptionId}`, { data: { companyId, immediately } });
  return data.subscriptionId;
};

export const createStripeCheckoutSession = async (customerId, seatCount, companyId, successUrl, cancelUrl) => {
  if (!USE_STRIPE) throw new Error('Stripe is disabled');
  const { data } = await hrApiClient.post('/hr/billing/checkout', { customerId, seatCount, companyId, successUrl, cancelUrl });
  return data;
};

export const createSeatAdditionCheckoutSession = async (customerId, subscriptionId, additionalSeats, companyId, successUrl, cancelUrl, requestId = null) => {
  if (!USE_STRIPE) throw new Error('Stripe is disabled');
  const { data } = await hrApiClient.post('/hr/billing/checkout/seats', { customerId, subscriptionId, additionalSeats, companyId, successUrl, cancelUrl, requestId });
  return data;
};

export const createStripeCustomerPortalSession = async (customerId, returnUrl) => {
  if (!USE_STRIPE) throw new Error('Stripe is disabled');
  const { data } = await hrApiClient.post('/hr/billing/portal', { customerId, returnUrl });
  return data.url;
};

export const syncStripeSubscription = async (companyId) => {
  if (!USE_STRIPE) throw new Error('Stripe is disabled');
  const { data } = await hrApiClient.post('/hr/billing/sync', { companyId });
  return data;
};

export const getStripeInvoicePDF = async (invoiceId, companyId) => {
  if (!USE_STRIPE) throw new Error('Stripe is disabled');
  const { data } = await hrApiClient.get(`/hr/billing/invoices/${invoiceId}/pdf`, { params: { companyId } });
  return data.pdfUrl;
};

/**
 * Download latest invoice for a customer (simple helper function)
 * @param {string} customerId - Stripe customer ID
 * @returns {Promise<void>}
 */
export const downloadLatestInvoice = async (customerId) => {
  if (!USE_STRIPE) {
    throw new Error('Stripe is disabled');
  }

  const auth = getAuth();
  if (!auth.currentUser) {
    throw new Error('User must be authenticated');
  }

  try {
    const getInvoice = httpsCallable(functions, 'getLatestInvoice');
    const result = await getInvoice({ customerId });
    const pdfUrl = result.data.pdfUrl;

    if (!pdfUrl) {
      alert('No invoice available.');
      return;
    }

    window.open(pdfUrl, '_blank');
  } catch (error) {
    console.error('Failed to download invoice:', error);
    alert('Could not download invoice.');
  }
};

/**
 * Download any invoice by invoice ID (simple helper function)
 * @param {string} invoiceId - Stripe invoice ID (e.g., 'in_xxxxx')
 * @returns {Promise<void>}
 */
export const downloadInvoiceById = async (invoiceId) => {
  if (!USE_STRIPE) {
    throw new Error('Stripe is disabled');
  }

  const auth = getAuth();
  if (!auth.currentUser) {
    throw new Error('User must be authenticated');
  }

  if (!invoiceId) {
    alert('Invoice ID is required.');
    return;
  }

  try {
    const getInvoicePDF = httpsCallable(functions, 'getInvoicePDF');
    const result = await getInvoicePDF({ invoiceId });
    const pdfUrl = result.data.pdfUrl;

    if (!pdfUrl) {
      alert('No invoice PDF available.');
      return;
    }

    window.open(pdfUrl, '_blank');
  } catch (error) {
    console.error('Failed to download invoice:', error);
    alert('Could not download invoice.');
  }
};

/**
 * Get proxy download URL for Stripe invoice PDF (bypasses CORS)
 * @param {string} invoiceId - Stripe invoice ID
 * @param {string} companyId - Company ID
 * @returns {string} Proxy download URL
 */
export const getStripeInvoiceProxyUrl = (invoiceId, companyId) => {
  if (!USE_STRIPE) {
    throw new Error('Stripe is disabled');
  }

  // Get project ID from Firebase config
  const projectId = import.meta.env.VITE_FB_PROJECT_ID || 'mprar-6fc1c';
  const region = 'us-central1'; // Default region for Firebase Functions

  const functionsUrl = `https://${region}-${projectId}.cloudfunctions.net`;

  return `${functionsUrl}/downloadStripeInvoice?invoiceId=${encodeURIComponent(invoiceId)}&companyId=${encodeURIComponent(companyId)}`;
};

/**
 * List Stripe invoices for a customer (helper to find missing invoice IDs)
 * @param {string} companyId - Company ID
 * @param {number} limit - Maximum number of invoices to retrieve
 * @returns {Promise<Array>} Array of Stripe invoices
 */
export const listStripeInvoices = async (companyId, limit = 10) => {
  if (!USE_STRIPE) {
    throw new Error('Stripe is disabled');
  }

  const auth = getAuth();
  if (!auth.currentUser) {
    throw new Error('User must be authenticated');
  }

  const listInvoices = httpsCallable(functions, 'listStripeInvoices');

  try {
    const result = await listInvoices({ companyId, limit });
    return result.data.invoices || [];
  } catch (error) {
    console.error('Error listing Stripe invoices:', error);
    throw error;
  }
};

/**
 * Add a subscription add-on (e.g. scheduling)
 * @param {string} companyId - Company ID
 * @param {string} addonType - Type of addon
 */
export const addSubscriptionAddon = async (companyId, addonType) => {
  if (!USE_STRIPE) return;
  const auth = getAuth();
  if (!auth.currentUser) {
    throw new Error('User must be authenticated');
  }

  const addAddon = httpsCallable(functions, 'addSubscriptionAddon');
  try {
    const result = await addAddon({ companyId, addonType });
    return result.data;
  } catch (error) {
    console.error('Error adding subscription addon:', error);
    throw error;
  }
};

/**
 * Remove a subscription add-on
 * @param {string} companyId - Company ID
 * @param {string} addonType - Type of addon
 */
export const removeSubscriptionAddon = async (companyId, addonType) => {
  if (!USE_STRIPE) return;
  const auth = getAuth();
  if (!auth.currentUser) {
    throw new Error('User must be authenticated');
  }

  const removeAddon = httpsCallable(functions, 'removeSubscriptionAddon');
  try {
    const result = await removeAddon({ companyId, addonType });
    return result.data;
  } catch (error) {
    console.error('Error removing subscription addon:', error);
    throw error;
  }
};

