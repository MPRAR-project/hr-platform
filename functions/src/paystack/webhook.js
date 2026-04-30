const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const crypto = require('crypto');

/**
 * Get Paystack secret key from config or env
 */
function getPaystackSecretKey() {
  return process.env.PAYSTACK_SECRET_KEY || functions.config().paystack?.secret_key;
}

/**
 * Handle Paystack Webhook
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
async function handlePaystackWebhook(req, res) {
  const secret = getPaystackSecretKey();
  if (!secret) {
    console.error('PAYSTACK_SECRET_KEY not configured');
    return res.status(500).send('Configuration Error');
  }

  // 1. Verify Signature
  const rawBody = req.rawBody || JSON.stringify(req.body);
  const hash = crypto
    .createHmac('sha512', secret)
    .update(rawBody)
    .digest('hex');

  if (hash !== req.headers['x-paystack-signature']) {
    console.error('Invalid Paystack signature');
    return res.status(401).send('Invalid Signature');
  }

  const event = req.body;
  console.log('Received Paystack event:', event.event);

  // 2. Process Charge Success
  if (event.event === 'charge.success') {
    const data = event.data;
    const reference = data.reference;
    const status = data.status;

    if (status === 'success') {
      try {
        // Double check status with Paystack API for security
        const verificationResponse = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
          headers: {
            Authorization: `Bearer ${secret}`
          }
        });

        const verificationData = await verificationResponse.json();

        if (verificationData.status && verificationData.data.status === 'success') {
          console.log(`Payment verified for reference: ${reference}`);
          
          const db = admin.firestore();
          // Find the application by paymentReference
          const snapshot = await db.collection('applications')
            .where('paymentReference', '==', reference)
            .limit(1)
            .get();

          if (snapshot.empty) {
            console.error(`Application not found for reference: ${reference}`);
            return res.status(404).send('Application Not Found');
          }

          const applicationDoc = snapshot.docs[0];
          await applicationDoc.ref.update({
            status: 'processing',
            paymentVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
            gatewayResponse: verificationData.data.gateway_response,
            paystackData: {
              id: data.id,
              customer: data.customer,
              authorization: data.authorization
            }
          });

          console.log(`Application ${applicationDoc.id} updated to processing`);
        } else {
          console.error(`Paystack verification failed for ${reference}:`, verificationData.message);
        }
      } catch (error) {
        console.error('Error verifying payment or updating Firestore:', error);
        return res.status(500).send('Internal Server Error');
      }
    }
  }

  res.status(200).send('Webhook Received');
}

module.exports = { handlePaystackWebhook };
