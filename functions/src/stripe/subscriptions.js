const admin = require('firebase-admin');
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
    subscriptions: { create: () => { }, retrieve: () => { }, update: () => { }, cancel: () => { } }
  };
} else {
  stripe = require('stripe')(stripeSecretKey);
}
// const db = admin.firestore(); // REMOVED GLOBAL INIT

const PRICE_PER_SEAT = 5.00;
const CURRENCY = 'gbp';

/**
 * Get Stripe price ID from env or config
 */
function getPriceId() {
  return process.env.STRIPE_PRICE_ID || functions.config().stripe?.price_id;
}

/**
 * Create a Stripe subscription for a company
 * @param {string} customerId - Stripe customer ID
 * @param {number} seatCount - Number of seats
 * @param {string} companyId - Firestore company document ID
 * @returns {Promise<Object>} Stripe subscription object
 */
async function createSubscription(customerId, seatCount, companyId) {
  if (!customerId || !seatCount || seatCount <= 0) {
    throw new Error('Valid customer ID and seat count are required');
  }

  const priceId = getPriceId();
  if (!priceId) {
    throw new Error('Stripe price ID not configured');
  }

  // Fetch company data to check for plugins
  const db = admin.firestore();
  const companyRef = db.collection('companies').doc(companyId);
  const companySnap = await companyRef.get();
  const companyData = companySnap.data() || {};
  const plugins = companyData.plugins || {};

  const items = [{
    price: priceId,
    quantity: seatCount
  }];

  // Check for scheduling plugin
  if (plugins.scheduling) {
    // Get plugin price ID - we need to make sure we use the same ID source as addons.js
    // For now, we'll try to get it from config, otherwise fallback to the hardcoded ID from addons.js
    // In a real app, this should be a shared constant or env var
    const schedulingPriceId = process.env.STRIPE_PRICE_SCHEDULING || functions.config().stripe?.price_scheduling || 'price_1SmCAiASpeIKLh5Q5XdQkkra';

    if (schedulingPriceId) {
      items.push({
        price: schedulingPriceId,
        quantity: 1
      });
    }
  }

  // Create subscription with trial period (if needed)
  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: items,
    currency: CURRENCY,
    metadata: {
      companyId: companyId,
      seatCount: seatCount.toString()
    },
    payment_behavior: 'default_incomplete',
    payment_settings: {
      save_default_payment_method: 'on_subscription'
    }
  });

  // Update Firestore

  const subscriptionItem = subscription.items.data[0];
  const priceInCents = subscriptionItem?.price?.unit_amount || 0;

  await companyRef.update({
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    billingSeatQuota: seatCount,
    billingSubscriptionStatus: subscription.status === 'active' ? 'active' : 'trialing',
    billingPricePerSeat: priceInCents / 100, // Store in major currency unit (e.g. 5.00)
    billingCurrency: subscription.currency?.toUpperCase() || CURRENCY.toUpperCase(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return subscription;
}

/**
 * Update subscription quantity (for seat additions/removals)
 * @param {string} subscriptionId - Stripe subscription ID
 * @param {number} newQuantity - New seat count
 * @param {string} companyId - Firestore company document ID
 * @param {string} prorationBehavior - Stripe proration behavior ('create_prorations', 'none', 'always_invoice')
 * @returns {Promise<Object>} Updated subscription object
 */
async function updateSubscriptionQuantity(subscriptionId, newQuantity, companyId, prorationBehavior = 'create_prorations') {
  if (!subscriptionId || !newQuantity || newQuantity <= 0) {
    throw new Error('Valid subscription ID and quantity are required');
  }

  // Get current subscription
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const subscriptionItemId = subscription.items.data[0].id;

  // Update subscription quantity
  // Add a flag to indicate if this is from a seat addition (to prevent duplicate billing history entries)
  const updateMetadata = {
    companyId: companyId,
    seatCount: newQuantity.toString()
  };

  const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
    items: [{
      id: subscriptionItemId,
      quantity: newQuantity
    }],
    proration_behavior: prorationBehavior,
    metadata: updateMetadata
  });

  // Update Firestore
  const db = admin.firestore(); // Lazy load
  const companyRef = db.collection('companies').doc(companyId);
  await companyRef.update({
    billingSeatQuota: newQuantity,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return updatedSubscription;
}

/**
 * Cancel a Stripe subscription
 * @param {string} subscriptionId - Stripe subscription ID
 * @param {string} companyId - Firestore company document ID
 * @param {boolean} immediately - Cancel immediately or at period end
 * @returns {Promise<Object>} Cancelled subscription object
 */
async function cancelSubscription(subscriptionId, companyId, immediately = false) {
  if (!subscriptionId) {
    throw new Error('Subscription ID is required');
  }

  const subscription = await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: !immediately
  });

  if (immediately) {
    await stripe.subscriptions.cancel(subscriptionId);
  }

  // Update Firestore
  const db = admin.firestore(); // Lazy load
  const companyRef = db.collection('companies').doc(companyId);
  await companyRef.update({
    billingSubscriptionStatus: immediately ? 'cancelled' : 'active',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return subscription;
}

module.exports = {
  createSubscription,
  updateSubscriptionQuantity,
  cancelSubscription
};

