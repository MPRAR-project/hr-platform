import { httpsCallable } from 'firebase/functions';
import { getAuth } from 'firebase/auth';
import { functions } from '../firebase/client';

/**
 * Feature flag to enable/disable Stripe integration
 * Set VITE_USE_STRIPE=true in .env when you have real Stripe keys.
 * Defaults to false so all seat/payment ops use Firestore mock path.
 */
export const USE_STRIPE = import.meta.env.VITE_USE_STRIPE === 'true';

/**
 * Create a Stripe customer for a company
 * @param {string} companyId - Company ID
 * @param {string} email - Customer email
 * @param {string} name - Company name
 * @returns {Promise<string>} Stripe customer ID
 */
export const createStripeCustomer = async (companyId, email, name) => {
  if (!USE_STRIPE) {
    throw new Error('Stripe is disabled');
  }

  const auth = getAuth();
  if (!auth.currentUser) {
    throw new Error('User must be authenticated');
  }

  const createCustomer = httpsCallable(functions, 'createStripeCustomer');

  try {
    const result = await createCustomer({
      companyId,
      email,
      name
    });

    return result.data.customerId;
  } catch (error) {
    console.error('Error creating Stripe customer:', error);
    throw error;
  }
};

/**
 * Create a Stripe subscription
 * @param {string} customerId - Stripe customer ID
 * @param {number} seatCount - Number of seats
 * @param {string} companyId - Company ID
 * @returns {Promise<Object>} Subscription object with subscriptionId and clientSecret
 */
export const createStripeSubscription = async (customerId, seatCount, companyId) => {
  if (!USE_STRIPE) {
    throw new Error('Stripe is disabled');
  }

  const auth = getAuth();
  if (!auth.currentUser) {
    throw new Error('User must be authenticated');
  }

  const createSubscription = httpsCallable(functions, 'createStripeSubscription');

  try {
    const result = await createSubscription({
      customerId,
      seatCount,
      companyId
    });

    return {
      subscriptionId: result.data.subscriptionId,
      clientSecret: result.data.clientSecret
    };
  } catch (error) {
    console.error('Error creating Stripe subscription:', error);
    throw error;
  }
};

/**
 * Update Stripe subscription quantity
 * @param {string} subscriptionId - Stripe subscription ID
 * @param {number} newQuantity - New seat count
 * @param {string} companyId - Company ID
 * @param {boolean} prorate - Whether to prorate (default: true)
 * @returns {Promise<string>} Updated subscription ID
 */
export const updateStripeSubscription = async (subscriptionId, newQuantity, companyId, prorate = true) => {
  if (!USE_STRIPE) {
    throw new Error('Stripe is disabled');
  }

  const auth = getAuth();
  if (!auth.currentUser) {
    throw new Error('User must be authenticated');
  }

  const updateSubscription = httpsCallable(functions, 'updateStripeSubscription');

  try {
    const result = await updateSubscription({
      subscriptionId,
      newQuantity,
      companyId,
      prorate
    });

    return result.data.subscriptionId;
  } catch (error) {
    console.error('Error updating Stripe subscription:', error);
    throw error;
  }
};

/**
 * Cancel a Stripe subscription
 * @param {string} subscriptionId - Stripe subscription ID
 * @param {string} companyId - Company ID
 * @param {boolean} immediately - Cancel immediately or at period end
 * @returns {Promise<string>} Cancelled subscription ID
 */
export const cancelStripeSubscription = async (subscriptionId, companyId, immediately = false) => {
  if (!USE_STRIPE) {
    throw new Error('Stripe is disabled');
  }

  const auth = getAuth();
  if (!auth.currentUser) {
    throw new Error('User must be authenticated');
  }

  const cancelSubscription = httpsCallable(functions, 'cancelStripeSubscription');

  try {
    const result = await cancelSubscription({
      subscriptionId,
      companyId,
      immediately
    });

    return result.data.subscriptionId;
  } catch (error) {
    console.error('Error canceling Stripe subscription:', error);
    throw error;
  }
};

/**
 * Create a Stripe Checkout session
 * @param {string} customerId - Stripe customer ID
 * @param {number} seatCount - Number of seats
 * @param {string} companyId - Company ID
 * @param {string} successUrl - URL to redirect on success
 * @param {string} cancelUrl - URL to redirect on cancel
 * @returns {Promise<Object>} Checkout session with sessionId and url
 */
export const createStripeCheckoutSession = async (customerId, seatCount, companyId, successUrl, cancelUrl) => {
  if (!USE_STRIPE) {
    throw new Error('Stripe is disabled');
  }

  const auth = getAuth();
  if (!auth.currentUser) {
    throw new Error('User must be authenticated');
  }

  const createCheckout = httpsCallable(functions, 'createStripeCheckoutSession');

  try {
    const result = await createCheckout({
      customerId,
      seatCount,
      companyId,
      successUrl,
      cancelUrl
    });

    return {
      sessionId: result.data.sessionId,
      url: result.data.url
    };
  } catch (error) {
    console.error('Error creating Stripe checkout session:', error);
    throw error;
  }
};

/**
 * Create a Stripe Checkout session for adding seats to existing subscription
 * @param {string} customerId - Stripe customer ID
 * @param {string} subscriptionId - Existing Stripe subscription ID
 * @param {number} additionalSeats - Number of additional seats to add
 * @param {string} companyId - Company ID
 * @param {string} successUrl - URL to redirect on success
 * @param {string} cancelUrl - URL to redirect on cancel
 * @param {string} cancelUrl - URL to redirect on cancel
 * @param {string} requestId - Optional seat request ID
 * @returns {Promise<Object>} Checkout session with sessionId and url
 */
export const createSeatAdditionCheckoutSession = async (customerId, subscriptionId, additionalSeats, companyId, successUrl, cancelUrl, requestId = null) => {
  if (!USE_STRIPE) {
    throw new Error('Stripe is disabled');
  }

  const auth = getAuth();
  if (!auth.currentUser) {
    throw new Error('User must be authenticated');
  }

  const createCheckout = httpsCallable(functions, 'createSeatAdditionCheckoutSession');

  try {
    const result = await createCheckout({
      customerId,
      subscriptionId,
      additionalSeats,
      companyId,
      successUrl,
      cancelUrl,
      requestId
    });

    return {
      sessionId: result.data.sessionId,
      url: result.data.url
    };
  } catch (error) {
    console.error('Error creating seat addition checkout session:', error);
    throw error;
  }
};

/**
 * Create a Stripe Customer Portal session
 * @param {string} customerId - Stripe customer ID
 * @param {string} returnUrl - URL to return to after portal
 * @returns {Promise<string>} Portal session URL
 */
export const createStripeCustomerPortalSession = async (customerId, returnUrl) => {
  if (!USE_STRIPE) {
    throw new Error('Stripe is disabled');
  }

  const auth = getAuth();
  if (!auth.currentUser) {
    throw new Error('User must be authenticated');
  }

  const createPortal = httpsCallable(functions, 'createStripeCustomerPortalSession');

  try {
    const result = await createPortal({
      customerId,
      returnUrl
    });

    return result.data.url;
  } catch (error) {
    console.error('Error creating Stripe customer portal session:', error);
    throw error;
  }
};

/**
 * Sync subscription status from Stripe to Firestore
 * Use this to fix sync issues when payment succeeded but status is wrong
 * @param {string} companyId - Company ID
 * @returns {Promise<Object>} Sync result with status and renewal date
 */
export const syncStripeSubscription = async (companyId) => {
  if (!USE_STRIPE) {
    throw new Error('Stripe is disabled');
  }

  const auth = getAuth();
  if (!auth.currentUser) {
    throw new Error('User must be authenticated');
  }

  const syncSubscription = httpsCallable(functions, 'syncStripeSubscription');

  try {
    const result = await syncSubscription({ companyId });
    return result.data;
  } catch (error) {
    console.error('Error syncing Stripe subscription:', error);
    throw error;
  }
};

/**
 * Get Stripe invoice PDF download URL
 * @param {string} invoiceId - Stripe invoice ID
 * @param {string} companyId - Company ID (for verification)
 * @returns {Promise<string>} PDF download URL
 */
export const getStripeInvoicePDF = async (invoiceId, companyId) => {
  if (!USE_STRIPE) {
    throw new Error('Stripe is disabled');
  }

  const auth = getAuth();
  if (!auth.currentUser) {
    throw new Error('User must be authenticated');
  }

  const getInvoicePDF = httpsCallable(functions, 'getStripeInvoicePDF');

  try {
    const result = await getInvoicePDF({ invoiceId, companyId });
    return result.data.pdfUrl;
  } catch (error) {
    console.error('Error getting Stripe invoice PDF:', error);
    throw error;
  }
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

