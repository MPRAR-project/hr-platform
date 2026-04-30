const admin = require('firebase-admin');
const functions = require('firebase-functions');

// Get Stripe secret key from env or config
const getStripeSecretKey = () => {
  return process.env.STRIPE_SECRET_KEY || functions.config().stripe?.secret_key;
};

let stripeInstance = null;
const getStripe = () => {
  if (!stripeInstance) {
    stripeInstance = require('stripe')(getStripeSecretKey());
  }
  return stripeInstance;
};

let dbInstance = null;
const getDb = () => {
  if (!dbInstance) {
    if (admin.apps.length === 0) {
      admin.initializeApp();
    }
    dbInstance = admin.firestore();
  }
  return dbInstance;
};

/**
 * Get webhook secret from env or config
 */
function getWebhookSecret() {
  return process.env.STRIPE_WEBHOOK_SECRET || functions.config().stripe?.webhook_secret;
}

/**
 * Process Stripe webhook events
 * @param {Object} event - Stripe event object
 */
async function processWebhookEvent(event) {
  const eventType = event.type;
  const eventData = event.data.object;

  console.log(`Processing Stripe webhook event: ${eventType}`);

  try {
    switch (eventType) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdate(eventData);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(eventData);
        break;

      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(eventData);
        break;

      case 'invoice.payment_failed':
        await handlePaymentFailed(eventData);
        break;

      case 'checkout.session.completed':
        await handleCheckoutCompleted(eventData);
        break;

      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(eventData);
        break;

      case 'invoice.payment_succeeded':
        // Also check if this is a seat addition invoice
        if (eventData.metadata?.action === 'add_seats') {
          await handleSeatAdditionPaymentSucceeded(eventData);
        } else {
          await handlePaymentSucceeded(eventData);
        }
        break;

      default:
        console.log(`Unhandled event type: ${eventType}`);
    }
  } catch (error) {
    console.error(`Error processing webhook event ${eventType}:`, error);
    throw error;
  }
}

/**
 * Handle subscription created/updated
 */
async function handleSubscriptionUpdate(subscription) {
  const companyId = subscription.metadata?.companyId;
  if (!companyId) {
    console.warn('Subscription missing companyId metadata');
    return;
  }

  const companyRef = getDb().collection('companies').doc(companyId);
  const subscriptionItem = subscription.items.data[0];
  const quantity = subscriptionItem?.quantity || 0;

  const mappedStatus = mapStripeStatusToLocal(subscription.status);

  const updateData = {
    stripeSubscriptionId: subscription.id,
    billingSeatQuota: quantity,
    billingSubscriptionStatus: mappedStatus,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  // Update renewal date from subscription period end
  if (subscription.current_period_end) {
    const renewalTimestamp = subscription.current_period_end * 1000;
    const renewalDate = new Date(renewalTimestamp);
    const now = new Date();

    // If renewal date is in the past, set to 1 month from now
    // This handles cases where dates were manually changed in Firestore
    if (renewalDate <= now) {
      renewalDate.setMonth(renewalDate.getMonth() + 1);
      updateData.billingRenewalDate = admin.firestore.Timestamp.fromDate(renewalDate);
      console.warn(`Renewal date was in the past for company ${companyId}, setting to 1 month from now`);
    } else {
      updateData.billingRenewalDate = admin.firestore.Timestamp.fromMillis(renewalTimestamp);
    }
  }

  // If subscription is active, ensure status is active (override any pending status)
  if (subscription.status === 'active' && mappedStatus !== 'active') {
    updateData.billingSubscriptionStatus = 'active';
    console.log(`Forcing status to 'active' for company ${companyId} as subscription is active in Stripe`);
  }

  // Determine if plugin add-ons are active
  const schedulingPriceId = process.env.STRIPE_PRICE_SCHEDULING || functions.config().stripe?.price_scheduling || 'price_1Sm5CrASpeIKLh5QIOofi6lM';
  const hasSchedulingAddon = subscription.items.data.some(
    item => item.price.id === schedulingPriceId
  );

  // If the add-on is present in the subscription, ensure it is enabled in Firestore
  if (hasSchedulingAddon && subscription.status === 'active') {
    updateData['plugins.scheduling'] = true;
    console.log(`Enabling scheduling plugin for company ${companyId} due to active subscription item`);
  }
  // IMPORTANT: We do NOT automatically disable it if missing, because an Admin might have enabled it manually (free access).
  // The 'removeSubscriptionAddon' function explicitly sets it to false.
  // However, if the user HAD it and now doesn't (removed by Stripe dashboard?), we might want to sync?
  // For safety/hybrid approach, we only FORCE enable if paid. We don't force disable here to allow manual overrides.

  await companyRef.update(updateData);

  // Check if this update is from a seat addition to prevent duplicate billing history entries
  // If there's a recent seat_topup entry (within last 30 seconds), skip creating subscription entry
  let isSeatAddition = false;
  try {
    const companySnap = await companyRef.get();
    if (companySnap.exists) {
      const companyData = companySnap.data();
      const billingHistory = companyData.billingHistory || [];
      const now = Date.now();

      // Check for recent seat_topup entries (within last 30 seconds)
      const recentSeatTopup = billingHistory.find(entry => {
        if (entry.type === 'seat_topup' && entry.createdAtMs) {
          const timeDiff = now - entry.createdAtMs;
          return timeDiff < 30000; // 30 seconds
        }
        return false;
      });

      if (recentSeatTopup) {
        isSeatAddition = true;
        console.log(`Skipping subscription billing history entry for company ${companyId} - recent seat addition detected (${recentSeatTopup.id})`);
      }
    }
  } catch (checkError) {
    console.warn('Could not check for recent seat additions:', checkError);
    // Continue with normal flow if check fails
  }

  // Add to billing history (only if this is a significant change AND not from seat addition)
  // Also try to get the latest invoice for this subscription to store invoice ID
  if (!isSeatAddition && (subscription.status === 'active' || subscription.status === 'trialing')) {
    let latestInvoiceId = null;
    let invoicePdfUrl = null;

    // Try to get the latest invoice for this subscription
    try {
      const invoices = await stripe.invoices.list({
        subscription: subscription.id,
        limit: 1
      });

      if (invoices.data.length > 0) {
        const latestInvoice = invoices.data[0];
        latestInvoiceId = latestInvoice.id;
        invoicePdfUrl = latestInvoice.invoice_pdf;
      }
    } catch (invoiceError) {
      console.warn('Could not fetch latest invoice for subscription:', invoiceError);
      // Continue without invoice ID
    }

    const historyEntry = {
      id: `stripe-${subscription.id}-${Date.now()}`,
      type: subscription.status === 'trialing' ? 'trial' : 'subscription',
      seats: quantity,
      amount: (quantity * 5.00).toFixed(2),
      currency: 'GBP',
      note: `Subscription ${subscription.status === 'active' ? 'activated' : 'updated'} via Stripe`,
      createdAt: new Date().toISOString(),
      createdAtMs: Date.now(),
      stripeSubscriptionId: subscription.id,
      // Store invoice ID if available
      stripeInvoiceId: latestInvoiceId || null,
      invoicePdfUrl: invoicePdfUrl || null
    };

    await companyRef.update({
      billingHistory: admin.firestore.FieldValue.arrayUnion(historyEntry)
    });
  }
}

/**
 * Handle subscription deleted
 */
async function handleSubscriptionDeleted(subscription) {
  const companyId = subscription.metadata?.companyId;
  if (!companyId) {
    console.warn('Subscription missing companyId metadata');
    return;
  }

  const companyRef = getDb().collection('companies').doc(companyId);
  await companyRef.update({
    billingSubscriptionStatus: 'cancelled',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

/**
 * Handle successful payment
 */
async function handlePaymentSucceeded(invoice) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) {
    // One-time payment, skip
    return;
  }

  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  const companyId = subscription.metadata?.companyId;
  if (!companyId) {
    console.warn('Subscription missing companyId metadata');
    return;
  }

  const companyRef = getDb().collection('companies').doc(companyId);
  const subscriptionItem = subscription.items.data[0];
  const quantity = subscriptionItem?.quantity || 0;

  // Always set status to active when payment succeeds
  const updateData = {
    billingSubscriptionStatus: 'active',
    billingSeatQuota: quantity, // Ensure seat quota is updated
    billingLastPaymentAt: admin.firestore.FieldValue.serverTimestamp(),
    billingLastPaymentType: 'subscription',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  // Update renewal date from subscription period end
  // This ensures the renewal date is always in the future
  if (subscription.current_period_end) {
    const renewalTimestamp = subscription.current_period_end * 1000;
    const renewalDate = new Date(renewalTimestamp);
    const now = new Date();

    // If renewal date is in the past (shouldn't happen, but handle it), set to 1 month from now
    if (renewalDate <= now) {
      renewalDate.setMonth(renewalDate.getMonth() + 1);
      updateData.billingRenewalDate = admin.firestore.Timestamp.fromDate(renewalDate);
      console.warn(`Renewal date was in the past for company ${companyId}, setting to 1 month from now`);
    } else {
      updateData.billingRenewalDate = admin.firestore.Timestamp.fromMillis(renewalTimestamp);
    }
  }

  await companyRef.update(updateData);

  // Add to billing history
  const historyEntry = {
    id: `stripe-invoice-${invoice.id}-${Date.now()}`,
    type: 'subscription',
    seats: quantity,
    amount: (invoice.amount_paid / 100).toFixed(2),
    currency: invoice.currency.toUpperCase(),
    note: `Monthly subscription payment for ${quantity} seat(s)`,
    createdAt: new Date().toISOString(),
    createdAtMs: Date.now(),
    stripeInvoiceId: invoice.id,
    stripeSubscriptionId: subscriptionId,
    // Also store PDF URL for direct access
    invoicePdfUrl: invoice.invoice_pdf || null
  };

  await companyRef.update({
    billingHistory: admin.firestore.FieldValue.arrayUnion(historyEntry)
  });
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(invoice) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) {
    return;
  }

  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  const companyId = subscription.metadata?.companyId;
  if (!companyId) {
    console.warn('Subscription missing companyId metadata');
    return;
  }

  const companyRef = getDb().collection('companies').doc(companyId);
  await companyRef.update({
    billingSubscriptionStatus: 'past_due',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

/**
 * Handle checkout session completed
 */
async function handleCheckoutCompleted(session) {
  const companyId = session.metadata?.companyId;
  if (!companyId) {
    console.warn('Checkout session missing companyId metadata');
    return;
  }

  // Handle seat addition checkout (payment mode)
  if (session.mode === 'payment' && session.metadata?.action === 'add_seats') {
    const subscriptionId = session.metadata?.subscriptionId;
    const targetQuantity = parseInt(session.metadata?.targetQuantity || '0', 10);
    const additionalSeats = parseInt(session.metadata?.additionalSeats || '0', 10);

    if (!subscriptionId || !targetQuantity || targetQuantity <= 0) {
      console.warn('Seat addition checkout missing required metadata');
      return;
    }

    // Only proceed if payment was successful
    if (session.payment_status !== 'paid') {
      console.log(`Seat addition checkout payment not completed: ${session.payment_status}`);
      return;
    }

    try {
      // Import updateSubscriptionQuantity function
      const { updateSubscriptionQuantity } = require('./subscriptions');

      // Update subscription quantity (this will create a prorated invoice automatically)
      // FIX: Pass 'none' for proration behavior because the user already paid via Checkout
      const updatedSubscription = await updateSubscriptionQuantity(subscriptionId, targetQuantity, companyId, 'none');

      // Also update seatCount to match the new quantity
      const companyRef = getDb().collection('companies').doc(companyId);

      // Get the payment intent from the checkout session to find/create invoice
      let invoiceId = null;
      let invoicePdfUrl = null;
      let actualAmount = (additionalSeats * 5.00).toFixed(2);

      try {

        // Prio 1: Check session.invoice directly (NEW - from invoice_creation: enabled)
        if (session.invoice) {
          const invoice = await getStripe().invoices.retrieve(session.invoice);
          invoiceId = invoice.id;
          invoicePdfUrl = invoice.invoice_pdf;
          console.log('✓ Found Stripe-generated invoice from session:', invoiceId);
        }

        // Get payment intent from checkout session
        const paymentIntentId = session.payment_intent;

        if (!invoiceId && paymentIntentId) {
          const paymentIntent = await getStripe().paymentIntents.retrieve(paymentIntentId);
          actualAmount = (paymentIntent.amount / 100).toFixed(2);

          // Prio 2: Check invoice from payment intent
          if (paymentIntent.invoice) {
            const invoice = await getStripe().invoices.retrieve(paymentIntent.invoice);
            invoiceId = invoice.id;
            invoicePdfUrl = invoice.invoice_pdf;
            console.log('✓ Found Stripe-generated invoice from payment intent:', invoiceId);
          } else {
            // Create an invoice for this one-time payment
            try {
              console.log('Creating invoice for seat addition payment:', {
                customerId,
                amount: paymentIntent.amount,
                additionalSeats,
                paymentIntentId: paymentIntent.id
              });

              // Step 1: Create invoice
              const invoice = await getStripe().invoices.create({
                customer: customerId,
                collection_method: 'charge_automatically',
                auto_advance: false, // Don't auto-advance since payment already made
                metadata: {
                  companyId: companyId,
                  action: 'add_seats',
                  additionalSeats: additionalSeats.toString(),
                  subscriptionId: subscriptionId,
                  paymentIntentId: paymentIntent.id
                }
              });

              console.log('Invoice created:', invoice.id);

              // Step 2: Add line item to invoice
              await getStripe().invoiceItems.create({
                customer: customerId,
                invoice: invoice.id,
                amount: paymentIntent.amount,
                currency: paymentIntent.currency || 'gbp',
                description: `${additionalSeats} additional seat${additionalSeats > 1 ? 's' : ''} for monthly subscription`
              });

              console.log('Invoice item added to invoice:', invoice.id);

              // Step 3: Finalize the invoice (this makes it available for download)
              const finalizedInvoice = await getStripe().invoices.finalizeInvoice(invoice.id);

              if (finalizedInvoice.status !== 'open' && finalizedInvoice.status !== 'paid') {
                console.warn('Invoice finalized but status is unexpected:', finalizedInvoice.status);
              }

              console.log('Invoice finalized:', finalizedInvoice.id, 'Status:', finalizedInvoice.status);

              // Step 4: Mark invoice as paid since payment already succeeded
              const paidInvoice = await getStripe().invoices.pay(finalizedInvoice.id, {
                paid_out_of_band: true
              });

              if (paidInvoice.status !== 'paid') {
                console.warn('Invoice marked as paid but status is:', paidInvoice.status);
              }

              console.log('Invoice marked as paid:', paidInvoice.id, 'Status:', paidInvoice.status);

              // Step 5: Re-fetch the invoice to ensure we have the latest PDF URL
              // Sometimes the PDF URL is not immediately available
              let retries = 3;
              let finalInvoice = paidInvoice;

              while (retries > 0 && !finalInvoice.invoice_pdf) {
                console.log(`Waiting for invoice PDF URL (${retries} retries left)...`);
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
                finalInvoice = await getStripe().invoices.retrieve(paidInvoice.id);
                retries--;
              }

              invoiceId = finalInvoice.id;
              invoicePdfUrl = finalInvoice.invoice_pdf;

              if (!invoicePdfUrl) {
                console.warn('Invoice PDF URL not available after retries for invoice:', invoiceId);
              }

              console.log('Invoice creation completed:', {
                invoiceId,
                hasPdfUrl: !!invoicePdfUrl,
                invoiceStatus: finalInvoice.status,
                invoiceNumber: finalInvoice.number
              });
            } catch (invoiceCreateError) {
              console.error('Error creating invoice for seat addition (will retry):', invoiceCreateError);

              // Simple retry logic for the entire invoice creation block
              try {
                // Wait 2 seconds before retry
                await new Promise(resolve => setTimeout(resolve, 2000));

                console.log('Retrying invoice creation...');
                const invoice = await getStripe().invoices.create({
                  customer: customerId,
                  collection_method: 'charge_automatically',
                  auto_advance: false,
                  metadata: {
                    companyId: companyId,
                    action: 'add_seats',
                    additionalSeats: additionalSeats.toString(),
                    subscriptionId: subscriptionId,
                    paymentIntentId: paymentIntent.id
                  }
                });

                await getStripe().invoiceItems.create({
                  customer: customerId,
                  invoice: invoice.id,
                  amount: paymentIntent.amount,
                  currency: paymentIntent.currency || 'gbp',
                  description: `${additionalSeats} additional seat${additionalSeats > 1 ? 's' : ''} for monthly subscription`
                });

                const finalizedInvoice = await getStripe().invoices.finalizeInvoice(invoice.id);
                const paidInvoice = await getStripe().invoices.pay(finalizedInvoice.id, { paid_out_of_band: true });

                invoiceId = paidInvoice.id;
                invoicePdfUrl = paidInvoice.invoice_pdf;
                console.log('Retry successful - Invoice created:', invoiceId);
              } catch (retryError) {
                console.error('CRITICAL: Invoice creation failed after retry:', retryError);
                // We still continue to ensure the subscription is updated, 
                // but we log a critical error that an invoice is missing for a paid transaction.
              }
            }
          }
        }
      } catch (invoiceError) {
        console.warn('Could not retrieve/create invoice after seat addition:', invoiceError);
        // Try one more time to find invoice from Stripe by payment intent
        if (!invoiceId && paymentIntentId) {
          try {
            console.log('Attempting to find invoice from payment intent:', paymentIntentId);
            const paymentIntent = await getStripe().paymentIntents.retrieve(paymentIntentId);
            if (paymentIntent.invoice) {
              const foundInvoice = await getStripe().invoices.retrieve(paymentIntent.invoice);
              invoiceId = foundInvoice.id;
              invoicePdfUrl = foundInvoice.invoice_pdf;
              console.log('✓ Found invoice from payment intent:', invoiceId);
            } else {
              // Search for invoices created around this time with matching amount
              const invoices = await getStripe().invoices.list({
                customer: customerId,
                limit: 10
              });
              const matchingInvoice = invoices.data.find(inv => {
                const amountMatch = Math.abs(inv.amount_paid - paymentIntent.amount) < 1;
                const metadataMatch = inv.metadata?.action === 'add_seats' &&
                  inv.metadata?.paymentIntentId === paymentIntentId;
                const recentMatch = (Date.now() / 1000) - inv.created < 300; // Within 5 minutes
                return amountMatch && (metadataMatch || recentMatch);
              });
              if (matchingInvoice) {
                invoiceId = matchingInvoice.id;
                invoicePdfUrl = matchingInvoice.invoice_pdf;
                console.log('✓ Found matching invoice from Stripe:', invoiceId);
              }
            }
          } catch (findError) {
            console.error('Failed to find invoice from payment intent:', findError);
          }
        }
      }

      // Add to billing history with invoice info
      const historyEntry = {
        id: `stripe-seat-addition-${Date.now()}`,
        type: 'seat_topup',
        seats: additionalSeats,
        amount: actualAmount,
        currency: 'GBP',
        note: `Added ${additionalSeats} seat(s) via Stripe checkout`,
        createdAt: new Date().toISOString(),
        createdAtMs: Date.now(),
        stripeInvoiceId: invoiceId || null, // Ensure it's null if not found, not undefined
        stripeSubscriptionId: subscriptionId,
        invoicePdfUrl: invoicePdfUrl || null // Ensure it's null if not found, not undefined
      };

      // Log the entry being saved for debugging
      console.log('Saving seat addition billing history entry:', {
        invoiceId: historyEntry.stripeInvoiceId,
        hasPdfUrl: !!historyEntry.invoicePdfUrl,
        amount: historyEntry.amount,
        seats: historyEntry.seats
      });

      await companyRef.update({
        seatCount: targetQuantity,
        billingHistory: admin.firestore.FieldValue.arrayUnion(historyEntry),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log(`Seat addition completed: Added ${additionalSeats} seats to subscription ${subscriptionId} for company ${companyId}. New total: ${targetQuantity} seats. Invoice ID: ${invoiceId || 'not found'}`);

      // Update seat request status if requestId is present
      const requestId = session.metadata?.requestId;
      if (requestId) {
        try {
          console.log(`Updating seat request ${requestId} to approved`);
          await getDb().collection('seatRequests').doc(requestId).update({
            status: 'approved',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            approvedAt: admin.firestore.FieldValue.serverTimestamp(),
            billingHistoryId: historyEntry.id
          });
          console.log(`Seat request ${requestId} approved successfully`);
        } catch (reqError) {
          console.error(`Error updating seat request ${requestId}:`, reqError);
        }
      }
    } catch (error) {
      console.error(`Error updating subscription after seat addition checkout:`, error);
      // Don't throw - let payment_intent.succeeded handle it as fallback
    }
    return;
  }

  // Handle subscription checkout (existing logic)
  if (session.mode !== 'subscription') {
    return;
  }

  const subscriptionId = session.subscription;
  if (!subscriptionId) {
    console.warn('Checkout session missing subscription ID');
    return;
  }

  // Retrieve the subscription to get current status and period
  try {
    const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
    const companyRef = getDb().collection('companies').doc(companyId);
    const subscriptionItem = subscription.items.data[0];
    const quantity = subscriptionItem?.quantity || 0;

    // If payment was successful, immediately activate the subscription
    if (session.payment_status === 'paid' && subscription.status === 'active') {
      const updateData = {
        stripeSubscriptionId: subscriptionId,
        billingSubscriptionStatus: 'active',
        billingSeatQuota: quantity,
        billingLastPaymentAt: admin.firestore.FieldValue.serverTimestamp(),
        billingLastPaymentType: 'subscription',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      // Set renewal date from subscription period end
      if (subscription.current_period_end) {
        const renewalTimestamp = subscription.current_period_end * 1000;
        const renewalDate = new Date(renewalTimestamp);
        const now = new Date();

        // Ensure renewal date is in the future
        if (renewalDate <= now) {
          renewalDate.setMonth(renewalDate.getMonth() + 1);
          updateData.billingRenewalDate = admin.firestore.Timestamp.fromDate(renewalDate);
        } else {
          updateData.billingRenewalDate = admin.firestore.Timestamp.fromMillis(renewalTimestamp);
        }
      }

      await companyRef.update(updateData);
      console.log(`Checkout completed and subscription activated for company ${companyId}, subscription ${subscriptionId}`);
    } else {
      // Payment pending or subscription not yet active, just log
      console.log(`Checkout completed for company ${companyId}, subscription ${subscriptionId}, status: ${subscription.status}, payment: ${session.payment_status}`);
    }
  } catch (error) {
    console.error(`Error processing checkout completion for company ${companyId}:`, error);
    // Don't throw - other webhooks will handle the update
  }
}

/**
 * Handle payment intent succeeded (fallback for seat addition)
 */
async function handlePaymentIntentSucceeded(paymentIntent) {
  // Check if this is a seat addition payment
  if (paymentIntent.metadata?.action !== 'add_seats') {
    return;
  }

  const companyId = paymentIntent.metadata?.companyId;
  const subscriptionId = paymentIntent.metadata?.subscriptionId;
  const targetQuantity = parseInt(paymentIntent.metadata?.targetQuantity || '0', 10);

  if (!companyId || !subscriptionId || !targetQuantity || targetQuantity <= 0) {
    console.warn('Payment intent missing required metadata for seat addition');
    return;
  }

  try {
    // Import updateSubscriptionQuantity function
    const { updateSubscriptionQuantity } = require('./subscriptions');

    // Get customer ID from payment intent
    const customerId = paymentIntent.customer;
    const amount = paymentIntent.amount / 100; // Convert from cents

    // Create an invoice for this one-time payment
    let invoiceId = null;
    let invoicePdfUrl = null;

    try {
      console.log('Creating invoice for seat addition payment intent:', {
        customerId,
        amount: paymentIntent.amount,
        additionalSeats: paymentIntent.metadata?.additionalSeats,
        paymentIntentId: paymentIntent.id
      });

      // Step 1: Create invoice
      const invoice = await stripe.invoices.create({
        customer: customerId,
        collection_method: 'charge_automatically',
        auto_advance: false, // Don't auto-advance since payment already made
        metadata: {
          companyId: companyId,
          action: 'add_seats',
          additionalSeats: paymentIntent.metadata?.additionalSeats || '0',
          subscriptionId: subscriptionId,
          paymentIntentId: paymentIntent.id
        }
      });

      console.log('Invoice created:', invoice.id);

      // Step 2: Add line item to invoice
      await stripe.invoiceItems.create({
        customer: customerId,
        invoice: invoice.id,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency || 'gbp',
        description: `${paymentIntent.metadata?.additionalSeats || '0'} additional seat(s) for monthly subscription`
      });

      console.log('Invoice item added to invoice:', invoice.id);

      // Step 3: Finalize the invoice
      const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);

      if (finalizedInvoice.status !== 'open' && finalizedInvoice.status !== 'paid') {
        console.warn('Invoice finalized but status is unexpected:', finalizedInvoice.status);
      }

      console.log('Invoice finalized:', finalizedInvoice.id, 'Status:', finalizedInvoice.status);

      // Step 4: Mark invoice as paid since payment already succeeded
      const paidInvoice = await stripe.invoices.pay(finalizedInvoice.id, {
        paid_out_of_band: true
      });

      if (paidInvoice.status !== 'paid') {
        console.warn('Invoice marked as paid but status is:', paidInvoice.status);
      }

      console.log('Invoice marked as paid:', paidInvoice.id, 'Status:', paidInvoice.status);

      // Step 5: Re-fetch the invoice to ensure we have the latest PDF URL
      let retries = 3;
      let finalInvoice = paidInvoice;

      while (retries > 0 && !finalInvoice.invoice_pdf) {
        console.log(`Waiting for invoice PDF URL (${retries} retries left)...`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
        finalInvoice = await stripe.invoices.retrieve(paidInvoice.id);
        retries--;
      }

      invoiceId = finalInvoice.id;
      invoicePdfUrl = finalInvoice.invoice_pdf;

      if (!invoicePdfUrl) {
        console.warn('Invoice PDF URL not available after retries for invoice:', invoiceId);
      }

      console.log('Invoice creation completed:', {
        invoiceId,
        hasPdfUrl: !!invoicePdfUrl,
        invoiceStatus: finalInvoice.status,
        invoiceNumber: finalInvoice.number
      });
    } catch (invoiceError) {
      console.error('Error creating invoice for payment intent:', {
        error: invoiceError.message,
        stack: invoiceError.stack,
        customerId,
        paymentIntentId: paymentIntent.id,
        additionalSeats: paymentIntent.metadata?.additionalSeats
      });
    }

    // Update subscription quantity
    // FIX: Pass 'none' for proration behavior because the user already paid via Checkout
    await updateSubscriptionQuantity(subscriptionId, targetQuantity, companyId, 'none');

    // Also update seatCount to match the new quantity and add to billing history
    const companyRef = getDb().collection('companies').doc(companyId);

    const historyEntry = {
      id: `stripe-seat-addition-${Date.now()}`,
      type: 'seat_topup',
      seats: parseInt(paymentIntent.metadata?.additionalSeats || '0', 10),
      amount: amount.toFixed(2),
      currency: (paymentIntent.currency || 'gbp').toUpperCase(),
      note: `Added ${paymentIntent.metadata?.additionalSeats || '0'} seat(s) via Stripe checkout`,
      createdAt: new Date().toISOString(),
      createdAtMs: Date.now(),
      stripeInvoiceId: invoiceId,
      stripeSubscriptionId: subscriptionId,
      invoicePdfUrl: invoicePdfUrl
    };

    await companyRef.update({
      seatCount: targetQuantity,
      billingHistory: admin.firestore.FieldValue.arrayUnion(historyEntry),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`Seat addition completed via payment intent: Updated subscription ${subscriptionId} to ${targetQuantity} seats for company ${companyId}. Invoice: ${invoiceId}`);

    // Update seat request status if requestId is present
    const requestId = paymentIntent.metadata?.requestId;
    if (requestId) {
      try {
        console.log(`Updating seat request ${requestId} to approved (via payment intent)`);
        await getDb().collection('seatRequests').doc(requestId).update({
          status: 'approved',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          approvedAt: admin.firestore.FieldValue.serverTimestamp(),
          billingHistoryId: historyEntry.id
        });
        console.log(`Seat request ${requestId} approved successfully`);
      } catch (reqError) {
        console.error(`Error updating seat request ${requestId}:`, reqError);
      }
    }
  } catch (error) {
    console.error(`Error updating subscription after payment intent:`, error);
    // Don't throw - this is a fallback handler
  }
}

/**
 * Handle seat addition payment succeeded (from invoice)
 */
async function handleSeatAdditionPaymentSucceeded(invoice) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) {
    console.warn('Seat addition invoice missing subscription ID');
    return;
  }

  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  const companyId = subscription.metadata?.companyId || invoice.metadata?.companyId;

  if (!companyId) {
    console.warn('Seat addition invoice missing companyId metadata');
    return;
  }

  const companyRef = getDb().collection('companies').doc(companyId);
  const subscriptionItem = subscription.items.data[0];
  const quantity = subscriptionItem?.quantity || 0;

  // Update company with new seat count and billing info
  const updateData = {
    billingSubscriptionStatus: 'active',
    billingSeatQuota: quantity,
    seatCount: quantity, // Update seatCount to match
    billingLastPaymentAt: admin.firestore.FieldValue.serverTimestamp(),
    billingLastPaymentType: 'seat_topup',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  // Update renewal date from subscription period end
  if (subscription.current_period_end) {
    const renewalTimestamp = subscription.current_period_end * 1000;
    const renewalDate = new Date(renewalTimestamp);
    const now = new Date();

    if (renewalDate <= now) {
      renewalDate.setMonth(renewalDate.getMonth() + 1);
      updateData.billingRenewalDate = admin.firestore.Timestamp.fromDate(renewalDate);
    } else {
      updateData.billingRenewalDate = admin.firestore.Timestamp.fromMillis(renewalTimestamp);
    }
  }

  await companyRef.update(updateData);

  // Add to billing history
  const historyEntry = {
    id: `stripe-invoice-${invoice.id}-${Date.now()}`,
    type: 'seat_topup',
    seats: quantity,
    amount: (invoice.amount_paid / 100).toFixed(2),
    currency: invoice.currency.toUpperCase(),
    note: `Added ${quantity} seat(s) via Stripe checkout`,
    createdAt: new Date().toISOString(),
    createdAtMs: Date.now(),
    stripeInvoiceId: invoice.id,
    stripeSubscriptionId: subscriptionId,
    invoicePdfUrl: invoice.invoice_pdf || null
  };

  await companyRef.update({
    billingHistory: admin.firestore.FieldValue.arrayUnion(historyEntry)
  });

  console.log(`Seat addition payment succeeded: Updated company ${companyId} to ${quantity} seats via invoice ${invoice.id}`);
}

/**
 * Map Stripe subscription status to local status
 */
function mapStripeStatusToLocal(stripeStatus) {
  const statusMap = {
    'active': 'active',
    'trialing': 'trial',
    'past_due': 'past_due',
    'canceled': 'cancelled',
    'unpaid': 'expired',
    'incomplete': 'pending',
    'incomplete_expired': 'expired'
  };

  return statusMap[stripeStatus] || 'active';
}

/**
 * Map Stripe subscription status to local status
 */


module.exports = {
  processWebhookEvent,
  getWebhookSecret,
  mapStripeStatusToLocal
};

