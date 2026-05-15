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

export const downloadLatestInvoice = async (customerId) => {
  if (!USE_STRIPE) throw new Error('Stripe is disabled');
  try {
    const { data } = await hrApiClient.get('/hr/billing/invoices/latest', { params: { customerId } });
    const pdfUrl = data.pdfUrl;
    if (!pdfUrl) { alert('No invoice available.'); return; }
    window.open(pdfUrl, '_blank');
  } catch (error) {
    console.error('Failed to download invoice:', error);
    alert('Could not download invoice.');
  }
};

export const downloadInvoiceById = async (invoiceId) => {
  if (!USE_STRIPE) throw new Error('Stripe is disabled');
  if (!invoiceId) { alert('Invoice ID is required.'); return; }
  try {
    const { data } = await hrApiClient.get(`/hr/billing/invoices/${invoiceId}/pdf`);
    const pdfUrl = data.pdfUrl;
    if (!pdfUrl) { alert('No invoice PDF available.'); return; }
    window.open(pdfUrl, '_blank');
  } catch (error) {
    console.error('Failed to download invoice:', error);
    alert('Could not download invoice.');
  }
};

export const getStripeInvoiceProxyUrl = (invoiceId, companyId) => {
  if (!USE_STRIPE) throw new Error('Stripe is disabled');
  const baseUrl = import.meta.env.VITE_HR_API_URL || 'http://localhost:5001';
  return `${baseUrl}/hr/billing/invoices/${encodeURIComponent(invoiceId)}/pdf?companyId=${encodeURIComponent(companyId)}`;
};

export const listStripeInvoices = async (companyId, limit = 10) => {
  if (!USE_STRIPE) throw new Error('Stripe is disabled');
  try {
    const { data } = await hrApiClient.get('/hr/billing/invoices', { params: { companyId, limit } });
    return data.invoices || [];
  } catch (error) {
    console.error('Error listing Stripe invoices:', error);
    throw error;
  }
};

export const addSubscriptionAddon = async (companyId, addonType) => {
  if (!USE_STRIPE) return;
  try {
    const { data } = await hrApiClient.post('/hr/billing/addon', { companyId, addonType });
    return data;
  } catch (error) {
    console.error('Error adding subscription addon:', error);
    throw error;
  }
};

export const removeSubscriptionAddon = async (companyId, addonType) => {
  if (!USE_STRIPE) return;
  try {
    const { data } = await hrApiClient.delete('/hr/billing/addon', { data: { companyId, addonType } });
    return data;
  } catch (error) {
    console.error('Error removing subscription addon:', error);
    throw error;
  }
};

