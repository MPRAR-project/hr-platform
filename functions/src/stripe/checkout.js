const functions = require('firebase-functions');

// Get Stripe secret key from env or config
const getStripeSecretKey = () => {
  try {
    return process.env.STRIPE_SECRET_KEY || functions.config().stripe?.secret_key;
  } catch (error) {
    console.warn('Functions config not available:', error.message);
    return process.env.STRIPE_SECRET_KEY;
  }
};

const stripeSecretKey = getStripeSecretKey();
let stripe;
if (!stripeSecretKey) {
  // Mock stripe to prevent crash during export discovery
  stripe = {
    checkout: { sessions: { create: () => { } } }
  };
} else {
  stripe = require('stripe')(stripeSecretKey);
}

/**
 * Get Stripe price ID from env or config
 */
function getPriceId() {
  return process.env.STRIPE_PRICE_ID || functions.config().stripe?.price_id;
}

/**
 * Create a Stripe Checkout session
 * @param {string} customerId - Stripe customer ID
 * @param {number} seatCount - Number of seats
 * @param {string} companyId - Firestore company document ID
 * @param {string} mode - 'subscription' or 'setup'
 * @param {string} successUrl - URL to redirect on success
 * @param {string} cancelUrl - URL to redirect on cancel
 * @returns {Promise<Object>} Checkout session object
 */
async function createCheckoutSession(customerId, seatCount, companyId, mode = 'subscription', successUrl, cancelUrl) {
  if (!customerId || !seatCount || seatCount <= 0) {
    throw new Error('Valid customer ID and seat count are required');
  }

  const priceId = getPriceId();
  if (!priceId) {
    throw new Error('Stripe price ID not configured');
  }

  const baseUrl = process.env.SUCCESS_URL || process.env.CANCEL_URL || 'https://your-domain.com';
  const sessionParams = {
    customer: customerId,
    mode: mode,
    success_url: successUrl || `${baseUrl}/billing?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl || `${baseUrl}/billing?canceled=true`,
    metadata: {
      companyId: companyId,
      seatCount: seatCount.toString()
    }
  };

  if (mode === 'subscription') {
    // Fetch company data to check for plugins
    const db = require('firebase-admin').firestore();
    const companyRef = db.collection('companies').doc(companyId);
    const companySnap = await companyRef.get();
    const companyData = companySnap.data() || {};
    const plugins = companyData.plugins || {};

    const lineItems = [{
      price: priceId,
      quantity: seatCount
    }];

    // Check for scheduling plugin
    if (plugins.scheduling) {
      const schedulingPriceId = process.env.STRIPE_PRICE_SCHEDULING || functions.config().stripe?.price_scheduling || 'price_1SmCAiASpeIKLh5Q5XdQkkra';
      if (schedulingPriceId) {
        lineItems.push({
          price: schedulingPriceId,
          quantity: 1
        });
      }
    }

    sessionParams.line_items = lineItems;
    sessionParams.payment_method_collection = 'always';
    sessionParams.subscription_data = {
      metadata: {
        companyId: companyId,
        seatCount: seatCount.toString()
      }
    };
  }

  const session = await stripe.checkout.sessions.create(sessionParams);

  return session;
}

/**
 * Create a Stripe Checkout session for adding seats to existing subscription
 * @param {string} customerId - Stripe customer ID
 * @param {string} subscriptionId - Existing Stripe subscription ID
 * @param {number} additionalSeats - Number of additional seats to add
 * @param {string} companyId - Firestore company document ID
 * @param {string} successUrl - URL to redirect on success
 * @param {string} cancelUrl - URL to redirect on cancel
 * @param {string} cancelUrl - URL to redirect on cancel
 * @param {string} requestId - Optional seat request ID to approve on success
 * @returns {Promise<Object>} Checkout session object
 */
async function createSeatAdditionCheckoutSession(customerId, subscriptionId, additionalSeats, companyId, successUrl, cancelUrl, requestId = null) {
  if (!customerId || !subscriptionId || !additionalSeats || additionalSeats <= 0 || !companyId) {
    throw new Error('Valid customer ID, subscription ID, additional seats, and company ID are required');
  }

  const priceId = getPriceId();
  if (!priceId) {
    throw new Error('Stripe price ID not configured');
  }

  // Get current subscription to calculate target quantity
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const currentQuantity = subscription.items.data[0]?.quantity || 0;
  const targetQuantity = currentQuantity + additionalSeats;

  // Get the price details to extract unit amount for one-time payment
  // We can't use subscription price in payment mode, so we'll create a one-time price inline
  const price = await stripe.prices.retrieve(priceId);
  const unitAmount = price.unit_amount; // Amount in cents (e.g., 500 for £5.00)
  // Force currency to GBP only - no other currency options
  const currency = 'gbp';

  const baseUrl = process.env.SUCCESS_URL || process.env.CANCEL_URL || 'https://your-domain.com';

  const sessionParams = {
    customer: customerId,
    mode: 'payment', // One-time payment mode
    currency: currency, // Force GBP currency
    payment_method_types: ['card'], // Only card payments
    success_url: successUrl || `${baseUrl}/billing?session_id={CHECKOUT_SESSION_ID}&action=seat_added`,
    cancel_url: cancelUrl || `${baseUrl}/billing?canceled=true&action=seat_addition`,
    line_items: [{
      price_data: {
        currency: currency, // Force GBP
        product_data: {
          name: `Additional Seat${additionalSeats > 1 ? 's' : ''}`,
          description: `${additionalSeats} additional seat${additionalSeats > 1 ? 's' : ''} for monthly subscription`
        },
        unit_amount: unitAmount
      },
      quantity: additionalSeats
    }],
    metadata: {
      companyId: companyId,
      action: 'add_seats',
      additionalSeats: additionalSeats.toString(),
      targetQuantity: targetQuantity.toString(),
      subscriptionId: subscriptionId,
      currentQuantity: currentQuantity.toString(),
      ...(requestId ? { requestId } : {})
    },
    payment_intent_data: {
      metadata: {
        companyId: companyId,
        action: 'add_seats',
        additionalSeats: additionalSeats.toString(),
        targetQuantity: targetQuantity.toString(),
        subscriptionId: subscriptionId,
        ...(requestId ? { requestId } : {})
      }
    },
    // Allow promotion codes
    allow_promotion_codes: true,
    invoice_creation: {
      enabled: true
    }
  };

  const session = await stripe.checkout.sessions.create(sessionParams);

  return session;
}

module.exports = {
  createCheckoutSession,
  createSeatAdditionCheckoutSession
};

