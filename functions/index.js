// Load environment variables from .env file (for local development)
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const crypto = require('crypto');
const sgMail = require('@sendgrid/mail');

// Initialize Admin
try { admin.app(); } catch { admin.initializeApp(); }

// Initialize Stripe with secret key from env or config
const getStripeSecretKey = () => {
  try {
    return process.env.STRIPE_SECRET_KEY || functions.config().stripe?.secret_key;
  } catch (error) {
    console.warn('Functions config not available:', error.message);
    return process.env.STRIPE_SECRET_KEY;
  }
};

// Lazy init for Stripe
let stripeInstance = null;
const getStripe = () => {
  if (!stripeInstance) {
    const key = getStripeSecretKey();
    if (!key) {
      console.warn('Warning: STRIPE_SECRET_KEY not found. Using MOCK Stripe object.');
      stripeInstance = {
        billingPortal: { sessions: { create: () => { } } },
        subscriptions: { retrieve: () => { } },
        invoices: { list: () => { }, retrieve: () => { } },
        items: { data: [] },
        customers: { create: () => { }, retrieve: () => { } }
      };
    } else {
      stripeInstance = require('stripe')(key);
    }
  }
  return stripeInstance;
};

// Import Stripe modules
const { createStripeCustomer } = require('./src/stripe/customers');
const { createSubscription, updateSubscriptionQuantity, cancelSubscription } = require('./src/stripe/subscriptions');
const { createCheckoutSession, createSeatAdditionCheckoutSession } = require('./src/stripe/checkout');
const { processWebhookEvent, getWebhookSecret, mapStripeStatusToLocal } = require('./src/stripe/webhooks');
// Domain: Auth
const { sendUserInvite } = require('./src/domains/auth/invite');
exports.sendUserInvite = sendUserInvite;

// Domain: Notifications
const notificationTriggers = require('./src/domains/notifications/triggers');
exports.onTimesheetWrite = notificationTriggers.onTimesheetWrite;
exports.onAbsenceCreate = notificationTriggers.onAbsenceCreate;
exports.onAbsenceUpdate = notificationTriggers.onAbsenceUpdate;
exports.onAllowanceWrite = notificationTriggers.onAllowanceWrite;

// Domain: Migrations
const { migrateUserDocIds } = require('./src/migrations/migrateUserDocIds');
exports.migrateUserDocIds = migrateUserDocIds;

// Domain: Timesheets
const { updateTimeEntrySafe } = require('./src/timesheets/updateSafe');
const { aggregateWeeklyStats } = require('./src/timesheets/aggregation');
const { syncWeeklySummary } = require('./src/timesheets/syncWeeklySummary');
const { backfillWeeklySummaries } = require('./src/timesheets/backfill');

exports.updateTimeEntrySafe = updateTimeEntrySafe;
exports.aggregateWeeklyStats = aggregateWeeklyStats;
exports.syncWeeklySummary = syncWeeklySummary;
exports.backfillWeeklySummaries = backfillWeeklySummaries;


// Expect functions:config: sendgrid.key to be set
// Lazy init for SendGrid
let sgMailInstance = null;
const getSgMail = () => {
  if (!sgMailInstance) {
    let key;
    try {
      key = process.env.SENDGRID_API_KEY || functions.config().sendgrid?.key;
    } catch (e) {
      key = process.env.SENDGRID_API_KEY;
    }

    if (key) {
      sgMail.setApiKey(key);
      sgMailInstance = sgMail;
    } else {
      // Mock or throw later
      console.warn('SendGrid key not configured');
      return null;
    }
  }
  return sgMailInstance;
};



/**
 * Send custom password reset email
 */
exports.sendPasswordReset = functions.https.onCall(async (data, context) => {
  // Publicly callable - no auth required
  const mail = getSgMail();
  if (!mail) throw new functions.https.HttpsError('failed-precondition', 'SendGrid key not configured');

  const email = (data.email || '').toLowerCase().trim();
  if (!email) {
    throw new functions.https.HttpsError('invalid-argument', 'Email is required');
  }

  try {
    // Generate the standard Firebase reset link
    const link = await admin.auth().generatePasswordResetLink(email);

    await mail.send({
      to: email,
      from: 'notifications@mprar.com',
      templateId: process.env.SENDGRID_TEMPLATE_PASSWORD_RESET || 'd-d94dd4c1f8a340f5aac415bd37f2845c',
      dynamicTemplateData: {
        firstName: email.split('@')[0],
        resetUrl: link
      }
    });

    return { success: true };
  } catch (error) {
    console.error('Error sending password reset:', error);
    if (error.code === 'auth/user-not-found') {
      throw new functions.https.HttpsError('not-found', 'User not found');
    }
    throw new functions.https.HttpsError('internal', 'Failed to send reset email');
  }
});

/**
 * Send payslip/invoice via email
 */
exports.sendPayslip = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');

  const mail = getSgMail();
  if (!mail) throw new functions.https.HttpsError('failed-precondition', 'SendGrid key not configured');

  const { email, subject, body, attachment, filename } = data;

  if (!email) throw new functions.https.HttpsError('invalid-argument', 'Email is required');
  if (!attachment) throw new functions.https.HttpsError('invalid-argument', 'PDF attachment is required');

  const msg = {
    to: email,
    from: 'notifications@mprar.com',
    subject: subject || 'Your Payslip / Invoice',
    text: body || 'Please find attached your payslip/invoice.',
    html: body ? body.replace(/\n/g, '<br>') : '<p>Please find attached your payslip/invoice.</p>',
    attachments: [
      {
        content: attachment,
        filename: filename || 'document.pdf',
        type: 'application/pdf',
        disposition: 'attachment'
      }
    ]
  };

  try {
    await mail.send(msg);
    return { success: true };
  } catch (error) {
    console.error('SendGrid Error:', error);
    throw new functions.https.HttpsError('internal', 'Failed to send email');
  }
});


// ==================== HR ONBOARDING TRIGGER ====================

/**
 * Trigger: When a new user document is created
 * Purpose: Automatically create HR onboarding profile if requiresHROnboarding flag is set
 */
exports.onUserCreate = functions.firestore
  .document('users/{userId}')
  .onCreate(async (snap, context) => {
    const db = admin.firestore();
    const userId = context.params.userId;
    const userData = snap.data();

    // Check if HR onboarding is required
    if (!userData.requiresHROnboarding) {
      console.log(`[onUserCreate] User ${userId} does not require HR onboarding`);
      return null;
    }

    console.log(`[onUserCreate] Creating HR onboarding profile for user ${userId}`);

    try {
      const companyId = userData.companyId;
      const siteId = userData.siteId;

      if (!companyId || !siteId) {
        console.error(`[onUserCreate] Missing companyId or siteId for user ${userId}`);
        return null;
      }

      // Create HR onboarding profile
      const profileRef = db.collection('hrOnboardingProfiles').doc();
      const now = admin.firestore.Timestamp.now();

      const profileData = {
        id: profileRef.id,
        userId,
        companyId,
        siteId,
        status: 'pending',
        completionPercent: 0,

        sections: {
          personalInfo: {
            status: 'pending',
            completedBy: null,
            completedAt: null,
            fields: {}
          },
          employmentDetails: {
            status: 'pending',
            completedBy: null,
            completedAt: null,
            fields: {}
          },
          contractDocuments: {
            status: 'pending',
            completedBy: null,
            completedAt: null,
            documents: [
              {
                id: 'doc_0',
                name: 'Employment Contract',
                required: true,
                uploaded: false,
                uploadedBy: null,
                uploadedAt: null,
                documentId: null
              },
              {
                id: 'doc_1',
                name: 'Job Description',
                required: true,
                uploaded: false,
                uploadedBy: null,
                uploadedAt: null,
                documentId: null
              },
              {
                id: 'doc_2',
                name: 'NDA',
                required: false,
                uploaded: false,
                uploadedBy: null,
                uploadedAt: null,
                documentId: null
              }
            ]
          },
          allowances: {
            status: 'pending',
            completedBy: null,
            completedAt: null,
            allowances: [
              {
                type: 'annual_leave',
                name: 'Annual Leave',
                required: true,
                unit: 'days',
                amount: null,
                set: false
              },
              {
                type: 'sick_leave',
                name: 'Sick Leave',
                required: true,
                unit: 'days',
                amount: null,
                set: false
              }
            ]
          }
        },

        createdAt: now,
        createdBy: 'system',
        updatedAt: now,
        lastUpdatedBy: 'system',
        completedAt: null
      };

      await profileRef.set(profileData);

      // Update user document with HR onboarding status
      await snap.ref.update({
        hrOnboardingStatus: 'pending',
        hrOnboardingCompletionPercent: 0,
        updatedAt: now
      });

      console.log(`[onUserCreate] Successfully created HR onboarding profile ${profileRef.id} for user ${userId}`);
      return { success: true, profileId: profileRef.id };
    } catch (error) {
      console.error(`[onUserCreate] Error creating HR onboarding profile for user ${userId}: `, error);
      return null;
    }
  });

// ==================== STRIPE FUNCTIONS ====================

/**
 * Create Stripe customer for a company
 */
exports.createStripeCustomer = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required');
  }

  const { companyId, email, name } = data;
  if (!companyId || !email) {
    throw new functions.https.HttpsError('invalid-argument', 'Company ID and email are required');
  }

  try {
    const customerId = await createStripeCustomer(companyId, email, name);
    return { customerId, success: true };
  } catch (error) {
    console.error('Error creating Stripe customer:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

/**
 * Create Stripe subscription
 */
exports.createStripeSubscription = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required');
  }

  const { customerId, seatCount, companyId } = data;
  if (!customerId || !seatCount || !companyId) {
    throw new functions.https.HttpsError('invalid-argument', 'Customer ID, seat count, and company ID are required');
  }

  try {
    const subscription = await createSubscription(customerId, seatCount, companyId);
    return { subscriptionId: subscription.id, clientSecret: subscription.latest_invoice?.payment_intent?.client_secret, success: true };
  } catch (error) {
    console.error('Error creating Stripe subscription:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

/**
 * Update Stripe subscription quantity
 */
exports.updateStripeSubscription = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required');
  }

  const { subscriptionId, newQuantity, companyId, prorate = true } = data;
  if (!subscriptionId || !newQuantity || !companyId) {
    throw new functions.https.HttpsError('invalid-argument', 'Subscription ID, quantity, and company ID are required');
  }

  try {
    const subscription = await updateSubscriptionQuantity(subscriptionId, newQuantity, companyId, prorate);
    return { subscriptionId: subscription.id, success: true };
  } catch (error) {
    console.error('Error updating Stripe subscription:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

/**
 * Cancel Stripe subscription
 */
exports.cancelStripeSubscription = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required');
  }

  const { subscriptionId, companyId, immediately = false } = data;
  if (!subscriptionId || !companyId) {
    throw new functions.https.HttpsError('invalid-argument', 'Subscription ID and company ID are required');
  }

  try {
    const subscription = await cancelSubscription(subscriptionId, companyId, immediately);
    return { subscriptionId: subscription.id, success: true };
  } catch (error) {
    console.error('Error canceling Stripe subscription:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

/**
 * Create Stripe Checkout session
 */
exports.createStripeCheckoutSession = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required');
  }

  const { customerId, seatCount, companyId, successUrl, cancelUrl } = data;
  if (!customerId || !seatCount || !companyId) {
    throw new functions.https.HttpsError('invalid-argument', 'Customer ID, seat count, and company ID are required');
  }

  try {
    const session = await createCheckoutSession(customerId, seatCount, companyId, 'subscription', successUrl, cancelUrl);
    return { sessionId: session.id, url: session.url, success: true };
  } catch (error) {
    console.error('Error creating Stripe checkout session:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

/**
 * Create Stripe Checkout session for adding seats to existing subscription
 */
exports.createSeatAdditionCheckoutSession = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required');
  }

  const { customerId, subscriptionId, additionalSeats, companyId, successUrl, cancelUrl, requestId } = data;
  if (!customerId || !subscriptionId || !additionalSeats || !companyId) {
    throw new functions.https.HttpsError('invalid-argument', 'Customer ID, subscription ID, additional seats, and company ID are required');
  }

  try {
    console.log('Creating seat addition checkout session with params:', {
      customerId,
      subscriptionId,
      additionalSeats,
      companyId,
      hasSuccessUrl: !!successUrl,
      hasCancelUrl: !!cancelUrl,
      requestId
    });

    const session = await createSeatAdditionCheckoutSession(customerId, subscriptionId, additionalSeats, companyId, successUrl, cancelUrl, requestId);

    console.log('Checkout session created successfully:', {
      sessionId: session.id,
      hasUrl: !!session.url
    });

    return {
      sessionId: session.id,
      url: session.url,
      success: true
    };
  } catch (error) {
    console.error('Error creating seat addition checkout session:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      type: error.type,
      code: error.code
    });
    throw new functions.https.HttpsError('internal', error.message || 'Failed to create checkout session');
  }
});

/**
 * Create Stripe Customer Portal session
 */
exports.createStripeCustomerPortalSession = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required');
  }

  const { customerId, returnUrl } = data;
  if (!customerId) {
    throw new functions.https.HttpsError('invalid-argument', 'Customer ID is required');
  }

  try {
    const baseUrl = process.env.RETURN_URL || 'https://your-domain.com';
    const session = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl || `${baseUrl}/billing`
    });
    return { url: session.url, success: true };
  } catch (error) {
    console.error('Error creating Stripe customer portal session:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

// Import Addon Functions
const { addSubscriptionAddon, removeSubscriptionAddon } = require('./src/stripe/addons');

/**
 * Add a plugin add-on to subscription
 */
exports.addSubscriptionAddon = functions.https.onCall(async (data, context) => {
  // 1. Validate authentication
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { companyId, addonType } = data;

  // 2. Validate input parameters
  if (!companyId || !addonType) {
    throw new functions.https.HttpsError('invalid-argument', 'Company ID and addon type are required');
  }

  try {
    const db = admin.firestore();

    // 3. Permission check: Ensure user belongs to this company
    const userDoc = await db.collection('users').doc(context.auth.uid).get();

    if (!userDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'User profile not found');
    }

    const userData = userDoc.data();
    const isAdmin = userData.primaryRole === 'HR Manager' || userData.primaryRole === 'Super Admin';

    // Check if user is associated with this company
    if (userData.companyId !== companyId && userData.primaryRole !== 'Super Admin') {
      console.warn(`Unauthorized addon addition attempt: User ${context.auth.uid} tried to modify company ${companyId}`);
      throw new functions.https.HttpsError('permission-denied', 'You do not have permission to modify this company');
    }

    // Only HR Managers or Super Admins should be able to touch billing/addons
    if (!isAdmin) {
      throw new functions.https.HttpsError('permission-denied', 'Only administrators can manage subscription add-ons');
    }

    // 4. Perform addition
    const result = await addSubscriptionAddon(companyId, addonType);
    return result;
  } catch (error) {
    console.error('Error in addSubscriptionAddon:', error);

    // If it's already an HttpsError, re-throw it
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    // Otherwise, wrap in a generic internal error
    throw new functions.https.HttpsError(
      'internal',
      error.message || 'Failed to add subscription add-on'
    );
  }
});

/**
 * Remove a plugin add-on from subscription
 */
exports.removeSubscriptionAddon = functions.https.onCall(async (data, context) => {
  // 1. Validate authentication
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }

  const { companyId, addonType } = data;

  // 2. Validate input parameters
  if (!companyId || !addonType) {
    throw new functions.https.HttpsError('invalid-argument', 'Company ID and addon type are required');
  }

  try {
    const db = admin.firestore();

    // 3. Permission check: Ensure user belongs to this company
    const userDoc = await db.collection('users').doc(context.auth.uid).get();

    if (!userDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'User profile not found');
    }

    const userData = userDoc.data();
    const isAdmin = userData.primaryRole === 'HR Manager' || userData.primaryRole === 'Super Admin';

    // Check if user is associated with this company
    if (userData.companyId !== companyId && userData.primaryRole !== 'Super Admin') {
      console.warn(`Unauthorized addon removal attempt: User ${context.auth.uid} tried to modify company ${companyId}`);
      throw new functions.https.HttpsError('permission-denied', 'You do not have permission to modify this company');
    }

    // Only HR Managers or Super Admins should be able to touch billing/addons
    if (!isAdmin) {
      throw new functions.https.HttpsError('permission-denied', 'Only administrators can manage subscription add-ons');
    }

    // 4. Perform removal
    const result = await removeSubscriptionAddon(companyId, addonType);
    return result;
  } catch (error) {
    console.error('Error in removeSubscriptionAddon:', error);

    // If it's already an HttpsError, re-throw it
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    // Otherwise, wrap in a generic internal error
    throw new functions.https.HttpsError(
      'internal',
      error.message || 'Failed to remove subscription add-on'
    );
  }
});

/**
 * Stripe webhook handler
 * Note: For Firebase Functions v1, we need to use express middleware to get raw body
 */
// ==================== PAYSTACK FUNCTIONS ====================
const { handlePaystackWebhook } = require('./src/paystack/webhook');
exports.paystackWebhook = functions.https.onRequest(handlePaystackWebhook);

/**
 * Debug billing state for a company
 */
exports.debugBilling = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');

  const { companyId } = data;
  if (!companyId) throw new functions.https.HttpsError('invalid-argument', 'Company ID required');

  try {
    const db = admin.firestore();
    const companyDoc = await db.collection('companies').doc(companyId).get();

    if (!companyDoc.exists) {
      return { exists: false, error: 'Company not found' };
    }

    const companyData = companyDoc.data();
    const stripeSubscriptionId = companyData.stripeSubscriptionId;

    let stripeInfo = { id: stripeSubscriptionId };
    if (stripeSubscriptionId) {
      try {
        const subscription = await getStripe().subscriptions.retrieve(stripeSubscriptionId);
        stripeInfo.status = subscription.status;
        stripeInfo.items = subscription.items.data.map(item => ({
          id: item.id,
          priceId: item.price.id,
          quantity: item.quantity
        }));
      } catch (e) {
        stripeInfo.error = e.message;
      }
    }

    return {
      success: true,
      exists: true,
      companyId,
      plugins: companyData.plugins || {},
      stripe: stripeInfo,
      auth: {
        uid: context.auth.uid,
        token: context.auth.token
      }
    };
  } catch (error) {
    console.error('Debug billing error:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

/**
 * Sync subscription status from Stripe (utility function for fixing sync issues)
 * Call this if subscription status in Firestore doesn't match Stripe
 */
exports.syncStripeSubscription = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required');
  }
  const db = admin.firestore();

  const { companyId } = data;
  if (!companyId) {
    throw new functions.https.HttpsError('invalid-argument', 'Company ID is required');
  }

  try {
    const companyRef = db.collection('companies').doc(companyId);
    const companySnap = await companyRef.get();

    if (!companySnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Company not found');
    }

    const companyData = companySnap.data();
    let subscriptionId = companyData.stripeSubscriptionId;
    const stripeCustomerId = companyData.stripeCustomerId;

    // Fallback: If no subscription ID, try finding one via customer ID
    if (!subscriptionId) {
      console.log(`[syncStripeSubscription] No subscription ID in company ${companyId}. Searching by customer ID: ${stripeCustomerId}`);

      if (stripeCustomerId) {
        // List active subscriptions for this customer
        const subscriptions = await getStripe().subscriptions.list({
          customer: stripeCustomerId,
          status: 'active',
          limit: 1
        });

        if (subscriptions.data.length > 0) {
          subscriptionId = subscriptions.data[0].id;
          console.log(`[syncStripeSubscription] Found active subscription in Stripe: ${subscriptionId}. Updating company.`);

          await companyRef.update({
            stripeSubscriptionId: subscriptionId
          });
        }
      }
    }

    if (!subscriptionId) {
      throw new functions.https.HttpsError('failed-precondition', 'No Stripe subscription found for this company');
    }

    // Retrieve subscription from Stripe
    const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
    const subscriptionItem = subscription.items.data[0];
    const quantity = subscriptionItem?.quantity || 0;

    const updateData = {
      billingSeatQuota: quantity,
      billingSubscriptionStatus: subscription.status === 'active' ? 'active' : mapStripeStatusToLocal(subscription.status),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      stripeSubscriptionId: subscription.id // Ensure it is set
    };

    // Update renewal date from subscription period end
    if (subscription.current_period_end) {
      const renewalTimestamp = subscription.current_period_end * 1000;
      const renewalDate = new Date(renewalTimestamp);
      const now = new Date();

      // If renewal date is in the past, set to 1 month from now
      if (renewalDate <= now) {
        renewalDate.setMonth(renewalDate.getMonth() + 1);
        updateData.billingRenewalDate = admin.firestore.Timestamp.fromDate(renewalDate);
      } else {
        updateData.billingRenewalDate = admin.firestore.Timestamp.fromMillis(renewalTimestamp);
      }
    }

    // If subscription is active in Stripe, force status to active
    if (subscription.status === 'active') {
      updateData.billingSubscriptionStatus = 'active';

      // Fetch recent invoices to populate billing history
      let invoices = await getStripe().invoices.list({
        subscription: subscriptionId,
        limit: 12
      });

      // Fallback: If no subscription invoices, check customer invoices (e.g., first payment)
      if (invoices.data.length === 0 && companyData.stripeCustomerId) {
        console.log('No subscription invoices found, checking customer invoices...');
        invoices = await getStripe().invoices.list({
          customer: companyData.stripeCustomerId,
          limit: 12
        });
      }

      const billingHistory = [];
      if (invoices.data.length > 0) {
        // Update last payment info if the latest invoice is paid
        if (invoices.data[0].status === 'paid') {
          updateData.billingLastPaymentAt = admin.firestore.Timestamp.fromMillis(
            invoices.data[0].status_transitions.paid_at * 1000
          );
          updateData.billingLastPaymentType = 'subscription';
        }

        // Map invoices to billingHistory format
        const historyItems = invoices.data.map(inv => ({
          id: inv.id,
          stripeInvoiceId: inv.id,
          amount: (inv.amount_paid / 100).toFixed(2),
          date: admin.firestore.Timestamp.fromMillis(inv.created * 1000),
          status: inv.status,
          invoicePdfUrl: inv.invoice_pdf,
          type: 'subscription',
          currency: inv.currency
        }));
        billingHistory.push(...historyItems);

        // Store billing history in company document
        updateData.billingHistory = billingHistory;
      }
    }

    await companyRef.update(updateData);

    return {
      success: true,
      subscriptionId: subscription.id,
      status: subscription.status,
      localStatus: updateData.billingSubscriptionStatus,
      renewalDate: updateData.billingRenewalDate?.toDate?.()?.toISOString() || null,
      invoiceCount: updateData.billingHistory ? updateData.billingHistory.length : 0
    };
  } catch (error) {
    console.error('Error syncing Stripe subscription:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

/**
 * Get Stripe invoice PDF download URL
 */
exports.getStripeInvoicePDF = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required');
  }
  const db = admin.firestore();

  const { invoiceId, companyId } = data;
  if (!invoiceId) {
    throw new functions.https.HttpsError('invalid-argument', 'Invoice ID is required');
  }

  try {
    let invoice;

    // Verify the invoice belongs to the company
    if (companyId) {
      const companyRef = db.collection('companies').doc(companyId);
      const companySnap = await companyRef.get();

      if (companySnap.exists) {
        const companyData = companySnap.data();
        const customerId = companyData.stripeCustomerId;

        if (customerId) {
          // Retrieve invoice from Stripe to verify it belongs to this customer
          invoice = await getStripe().invoices.retrieve(invoiceId);

          if (invoice.customer !== customerId) {
            throw new functions.https.HttpsError('permission-denied', 'Invoice does not belong to this company');
          }
        }
      }
    }

    // Retrieve the invoice if not already loaded during verification
    if (!invoice) {
      invoice = await getStripe().invoices.retrieve(invoiceId);
    }


    if (!invoice.invoice_pdf) {
      throw new functions.https.HttpsError('not-found', 'Invoice PDF not available');
    }

    // Return both the direct URL and a proxy URL option
    return {
      pdfUrl: invoice.invoice_pdf,
      invoiceNumber: invoice.number || invoiceId,
      success: true,
      // Also return the invoice data for potential proxy download
      invoiceId: invoice.id
    };
  } catch (error) {
    console.error('Error retrieving Stripe invoice PDF:', error);
    if (error.type === 'StripeInvalidRequestError') {
      throw new functions.https.HttpsError('not-found', 'Invoice not found in Stripe');
    }
    throw new functions.https.HttpsError('internal', error.message);
  }
});

/**
 * Get latest Stripe invoice for a customer (simple download feature)
 * This is a standalone function that doesn't interfere with existing functionality
 */
exports.getLatestInvoice = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required');
  }

  const { customerId } = data;
  if (!customerId) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Customer ID is required'
    );
  }

  try {
    // Use the existing Stripe instance (already initialized)
    const invoices = await getStripe().invoices.list({
      customer: customerId,
      limit: 1,
    });

    if (!invoices.data.length) {
      throw new functions.https.HttpsError(
        'not-found',
        'No invoices found for this customer'
      );
    }

    const invoice = invoices.data[0];

    return {
      invoiceId: invoice.id,
      pdfUrl: invoice.invoice_pdf,
      success: true
    };
  } catch (error) {
    console.error('Error getting latest invoice:', error);
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError('internal', error.message);
  }
});

/**
 * Get Stripe invoice PDF by invoice ID (simple download for any invoice)
 * This is a standalone function that doesn't interfere with existing functionality
 */
exports.getInvoicePDF = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required');
  }

  const { invoiceId } = data;
  if (!invoiceId) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Invoice ID is required'
    );
  }

  try {
    // Use the existing Stripe instance (already initialized)
    const invoice = await getStripe().invoices.retrieve(invoiceId);

    if (!invoice.invoice_pdf) {
      throw new functions.https.HttpsError(
        'not-found',
        'Invoice PDF not available'
      );
    }

    return {
      invoiceId: invoice.id,
      pdfUrl: invoice.invoice_pdf,
      success: true
    };
  } catch (error) {
    console.error('Error getting invoice PDF:', error);
    if (error.type === 'StripeInvalidRequestError') {
      throw new functions.https.HttpsError('not-found', 'Invoice not found in Stripe');
    }
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError('internal', error.message);
  }
});

/**
 * List Stripe invoices for a customer (to help find missing invoice IDs)
 */
exports.listStripeInvoices = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required');
  }
  const db = admin.firestore();

  const { companyId, limit = 10 } = data;
  if (!companyId) {
    throw new functions.https.HttpsError('invalid-argument', 'Company ID is required');
  }

  try {
    const companyRef = db.collection('companies').doc(companyId);
    const companySnap = await companyRef.get();

    // FIX: In Admin SDK, exists is a property, not a function
    if (!companySnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Company not found');
    }

    const companyData = companySnap.data();
    const customerId = companyData.stripeCustomerId;

    if (!customerId) {
      throw new functions.https.HttpsError('failed-precondition', 'No Stripe customer found for this company');
    }

    // List invoices from Stripe
    const invoices = await getStripe().invoices.list({
      customer: customerId,
      limit: limit,
      expand: ['data.subscription']
    });

    // Return simplified invoice data
    return {
      invoices: invoices.data.map(inv => ({
        id: inv.id,
        number: inv.number,
        amount_paid: inv.amount_paid,
        amount_due: inv.amount_due,
        currency: inv.currency,
        status: inv.status,
        created: inv.created,
        invoice_pdf: inv.invoice_pdf,
        subscription: inv.subscription
      })),
      success: true
    };
  } catch (error) {
    console.error('Error listing Stripe invoices:', error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

/**
 * Stripe webhook handler
 * Note: For Firebase Functions v1, we need to use express middleware to get raw body
 */
exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = getWebhookSecret();

  if (!webhookSecret) {
    console.error('Webhook secret not configured');
    return res.status(500).send('Webhook secret not configured');
  }

  let event;

  try {
    // Get raw body - Firebase Functions v1 provides it as req.rawBody
    const rawBody = req.rawBody || JSON.stringify(req.body);
    event = getStripe().webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    await processWebhookEvent(event);
    res.json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Proxy endpoint to download Stripe invoice PDF (bypasses CORS)
 * Usage: GET /downloadStripeInvoice?invoiceId=in_xxx&companyId=xxx
 */
exports.downloadStripeInvoice = functions.https.onRequest(async (req, res) => {
  const db = admin.firestore();
  // CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  const { invoiceId, companyId } = req.query;

  if (!invoiceId) {
    res.status(400).send('Invoice ID is required');
    return;
  }

  try {
    let invoice; // Declare invoice here to be accessible throughout the try block

    // Verify the invoice belongs to the company (if companyId provided)
    if (companyId) {
      const companyRef = db.collection('companies').doc(companyId);
      const companySnap = await companyRef.get();

      if (companySnap.exists) {
        const companyData = companySnap.data();
        const customerId = companyData.stripeCustomerId;

        if (customerId) {
          invoice = await getStripe().invoices.retrieve(invoiceId); // FIRST RETRIEVAL

          if (invoice.customer !== customerId) {
            res.status(403).send('Invoice does not belong to this company');
            return;
          }
        }
      }
    }

    // If invoice was not retrieved during the companyId check, retrieve it now.
    // Or if companyId was not provided at all.
    if (!invoice) {
      invoice = await getStripe().invoices.retrieve(invoiceId);
    }

    console.log('Invoice retrieved:', {
      id: invoice.id,
      status: invoice.status,
      number: invoice.number,
      hasPdf: !!invoice.invoice_pdf,
      pdfUrl: invoice.invoice_pdf
    });

    if (!invoice.invoice_pdf) {
      console.error('Invoice PDF not available for invoice:', invoiceId);
      res.status(404).send('Invoice PDF not available. The invoice may not be finalized yet.');
      return;
    }

    console.log('Fetching PDF from URL:', invoice.invoice_pdf);

    // Use axios for better HTTP handling (or Node's https with proper options)
    const https = require('https');
    const http = require('http');
    const { URL } = require('url');

    const pdfUrl = new URL(invoice.invoice_pdf);
    const client = pdfUrl.protocol === 'https:' ? https : http;

    // Fetch PDF with proper headers and follow redirects
    const options = {
      hostname: pdfUrl.hostname,
      path: pdfUrl.pathname + pdfUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Firebase-Cloud-Functions)',
        'Accept': 'application/pdf, */*'
      },
      timeout: 30000 // 30 second timeout
    };

    const request = client.request(options, (pdfResponse) => {
      console.log('PDF Response status:', pdfResponse.statusCode);
      console.log('PDF Response headers:', pdfResponse.headers);

      // Handle redirects (301, 302, etc.)
      if (pdfResponse.statusCode >= 300 && pdfResponse.statusCode < 400 && pdfResponse.headers.location) {
        console.log('Following redirect to:', pdfResponse.headers.location);
        // Recursively follow redirect
        const redirectUrl = new URL(pdfResponse.headers.location, invoice.invoice_pdf);
        const redirectClient = redirectUrl.protocol === 'https:' ? https : http;
        const redirectOptions = {
          hostname: redirectUrl.hostname,
          path: redirectUrl.pathname + redirectUrl.search,
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Firebase-Cloud-Functions)',
            'Accept': 'application/pdf, */*'
          },
          timeout: 30000
        };

        const redirectRequest = redirectClient.request(redirectOptions, (redirectResponse) => {
          if (redirectResponse.statusCode !== 200) {
            console.error('Redirect response status:', redirectResponse.statusCode);
            res.status(redirectResponse.statusCode).send('Failed to fetch PDF from Stripe');
            return;
          }

          // Set headers for PDF download
          res.set('Content-Type', redirectResponse.headers['content-type'] || 'application/pdf');
          res.set('Content-Disposition', `attachment; filename="invoice-${invoiceId}.pdf"`);
          res.set('Cache-Control', 'private, max-age=0');

          // Pipe PDF to response
          redirectResponse.pipe(res);
        });

        redirectRequest.on('error', (error) => {
          console.error('Error fetching PDF from redirect:', error);
          res.status(500).send('Failed to download PDF');
        });

        redirectRequest.end();
        return;
      }

      if (pdfResponse.statusCode !== 200) {
        console.error('PDF response status:', pdfResponse.statusCode);
        res.status(pdfResponse.statusCode).send('Failed to fetch PDF from Stripe');
        return;
      }

      // Set headers for PDF download
      res.set('Content-Type', pdfResponse.headers['content-type'] || 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="invoice-${invoiceId}.pdf"`);
      res.set('Cache-Control', 'private, max-age=0');

      // Pipe PDF to response
      pdfResponse.pipe(res);
    });

    request.on('error', (error) => {
      console.error('Error fetching PDF from Stripe:', error);
      res.status(500).send('Failed to download PDF: ' + error.message);
    });

    request.on('timeout', () => {
      console.error('Request timeout');
      request.destroy();
      res.status(504).send('Request timeout');
    });

    request.setTimeout(30000);
    request.end();
  } catch (error) {
    console.error('Error downloading Stripe invoice PDF:', error);
    res.status(500).send(error.message || 'Internal server error');
  }
});
// Impersonate user
exports.impersonateUser = functions.https.onCall(async (data, context) => {
  // Ensure caller is authenticated
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be logged in.');
  }

  const callerUid = context.auth.uid;

  // 2. Optional: Only allow Admins or HR Managers to impersonate
  // (You can skip this if you want all users to be able to switch)
  if (!context.auth.token.admin && !context.auth.token.hrManager) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Only admins/managers can switch users.'
    );
  }

  const targetUid = data.uid;
  if (!targetUid) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing UID.');
  }

  // 3. Create Firebase Custom Token
  try {
    const token = await admin.auth().createCustomToken(targetUid, {
      impersonatedBy: callerUid,
      impersonation: true
    });

    return { token };
  } catch (err) {
    console.error("Impersonation error:", err);
    throw new functions.https.HttpsError('internal', 'Failed to impersonate user');
  }
});



// ... existing impersonateUser ...

/**
 * Fetch company logo as base64 to bypass CORS issues on frontend
 */
exports.getCompanyLogo = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Login required');
  }

  const { url } = data;
  if (!url) {
    throw new functions.https.HttpsError('invalid-argument', 'URL is required');
  }

  try {
    const https = require('https');
    const { URL } = require('url');
    const parsedUrl = new URL(url);

    return new Promise((resolve, reject) => {
      const req = https.get(parsedUrl, (res) => {
        if (res.statusCode !== 200) {
          reject(new functions.https.HttpsError('not-found', 'Failed to fetch image'));
          return;
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const base64 = buffer.toString('base64');
          const mimeType = res.headers['content-type'] || 'image/png';
          resolve({ base64: `data:${mimeType};base64,${base64}` });
        });
      });

      req.on('error', (err) => {
        console.error("Error fetching logo:", err);
        reject(new functions.https.HttpsError('internal', 'Image fetch failed'));
      });

      req.end();
    });

  } catch (error) {
    console.error("Error in getCompanyLogo:", error);
    throw new functions.https.HttpsError('internal', error.message);
  }
});

// ==================== USER MANAGEMENT SCALABILITY ====================
exports.syncUserProfile = require('./src/users/syncUserProfile').syncUserProfile;
exports.backfillUserProfiles = require('./src/users/backfillUserProfiles').backfillUserProfiles;


// ==================== DOCUMENT COUNTERS SCALABILITY ====================
exports.syncDocumentCounters = require('./src/documents/syncDocumentCounters').syncDocumentCounters;
exports.syncRequestCounters = require('./src/documents/syncRequestCounters').syncRequestCounters;
exports.backfillDocumentCounters = require('./src/documents/backfillDocumentCounters').backfillDocumentCounters;






// Debug Deployment
try {
  console.log('=== INDEX.JS LOADED ===');
  console.log('Export Keys:', Object.keys(exports));
} catch (e) {
  console.error('Debug Log Error:', e);
}

// Add User Function
exports.addSiteOwnerUser = functions.https.onCall(async (data, context) => {
  const { getAuth } = require('firebase-admin/auth');
  const auth = getAuth();

  const newUser = {
    email: 'siteowner1@gmail.com',
    role: 'siteManager',
    displayName: 'Site Owner',
    password: '123456'
  };

  try {
    console.log('Adding new user:', newUser.email);

    // Create user in Firebase Auth
    const userRecord = await auth.createUser({
      email: newUser.email,
      password: newUser.password,
      displayName: newUser.displayName,
      emailVerified: false
    });

    console.log('Firebase Auth user created:', userRecord.uid);

    // Create user document in Firestore
    const userDoc = {
      userId: userRecord.uid,
      email: newUser.email,
      displayName: newUser.displayName,
      firstName: 'Site',
      lastName: 'Owner',
      primaryRole: newUser.role,
      role: newUser.role,
      status: 'Active',
      shift: 'day',
      isOnboardingCompleted: false,
      isOnboardingMandatory: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      tempPassword: newUser.password
    };

    await admin.firestore().collection('users').doc(userRecord.uid).set(userDoc);
    console.log('Firestore user document created');

    return {
      success: true,
      uid: userRecord.uid,
      email: newUser.email,
      message: 'User added successfully'
    };

  } catch (error) {
    console.error('Error adding user:', error);

    if (error.code === 'auth/email-already-exists') {
      // Get existing user and create Firestore doc if needed
      const existingUser = await auth.getUserByEmail(newUser.email);
      const userDoc = {
        userId: existingUser.uid,
        email: newUser.email,
        displayName: newUser.displayName || existingUser.displayName,
        firstName: 'Site',
        lastName: 'Owner',
        primaryRole: newUser.role,
        role: newUser.role,
        status: 'Active',
        shift: 'day',
        isOnboardingCompleted: false,
        isOnboardingMandatory: false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        tempPassword: newUser.password
      };

      await admin.firestore().collection('users').doc(existingUser.uid).set(userDoc);

      return {
        success: true,
        uid: existingUser.uid,
        email: newUser.email,
        message: 'User already existed in Auth, Firestore document created'
      };
    }

    throw new functions.https.HttpsError('internal', error.message);
  }
});
