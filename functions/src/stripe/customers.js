const admin = require('firebase-admin');
const functions = require('firebase-functions');

// Get Stripe secret key from env or config
const getStripeSecretKey = () => {
  return process.env.STRIPE_SECRET_KEY || functions.config().stripe?.secret_key;
};

const stripeSecretKey = getStripeSecretKey();
let stripe;
if (!stripeSecretKey) {
  // Mock stripe to prevent crash during export discovery
  stripe = {
    customers: { create: () => { }, retrieve: () => { } }
  };
} else {
  stripe = require('stripe')(stripeSecretKey);
}
// const db = admin.firestore(); // REMOVED GLOBAL INIT

/**
 * Create a Stripe customer for a company
 * @param {string} companyId - Firestore company document ID
 * @param {string} email - Customer email
 * @param {string} name - Company name
 * @returns {Promise<string>} Stripe customer ID
 */
async function createStripeCustomer(companyId, email, name) {
  if (!companyId || !email) {
    throw new Error('Company ID and email are required');
  }

  const db = admin.firestore(); // Lazy load

  // Check if customer already exists
  const companyRef = db.collection('companies').doc(companyId);
  const companySnap = await companyRef.get();

  if (!companySnap.exists) {
    throw new Error('Company not found');
  }

  const companyData = companySnap.data();

  // Return existing customer ID if already created
  if (companyData.stripeCustomerId) {
    return companyData.stripeCustomerId;
  }

  // Create Stripe customer
  const customer = await stripe.customers.create({
    email: email.toLowerCase().trim(),
    name: name || companyData.name || 'Company',
    metadata: {
      companyId: companyId,
      firebaseCompanyId: companyId
    }
  });

  // Store customer ID in Firestore
  await companyRef.update({
    stripeCustomerId: customer.id,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return customer.id;
}

module.exports = {
  createStripeCustomer
};

