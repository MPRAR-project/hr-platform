const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const crypto = require('crypto');
const sgMail = require('@sendgrid/mail');

// Lazy init for SendGrid
let sgMailInstance = null;
const getSgMail = () => {
  if (!sgMailInstance) {
    const key = process.env.SENDGRID_API_KEY;
    if (key) {
      sgMail.setApiKey(key);
      sgMailInstance = sgMail;
    } else {
      console.warn('SendGrid key not configured');
      return null;
    }
  }
  return sgMailInstance;
};

exports.sendUserInvite = functions.https.onCall(async (data, context) => {
  const db = admin.firestore();
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required');

  const mail = getSgMail();
  if (!mail) throw new functions.https.HttpsError('failed-precondition', 'SendGrid key not configured');

  const email = (data.email || '').toLowerCase().trim();
  const displayName = (data.displayName || '').trim();
  const primaryRole = (data.primaryRole || '').trim();
  const reportsTo = (data.reportsTo || '').trim();
  const companyId = (data.companyId || '').trim();
  const siteId = (data.siteId || '').trim();
  const inviteBaseUrl = (data.inviteBaseUrl || '').trim();

  if (!email || !primaryRole || !companyId || !siteId || !inviteBaseUrl) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing required fields');
  }

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const now = admin.firestore.Timestamp.now();
  const expiresAt = admin.firestore.Timestamp.fromMillis(now.toMillis() + 7 * 24 * 60 * 60 * 1000);

  const isOnboardingMandatory = data.isOnboardingMandatory || false;
  const requiresHROnboarding = data.requiresHROnboarding || false;
  const isTrainingMandatory = data.isTrainingMandatory || false;

  const inviteRef = db.collection('invites').doc();
  await inviteRef.set({
    email,
    displayName,
    primaryRole,
    reportsTo,
    companyId,
    siteId,
    isOnboardingMandatory,
    requiresHROnboarding,
    isTrainingMandatory,
    tokenHash,
    status: 'pending',
    createdBy: context.auth.uid,
    createdAt: now,
    updatedAt: now,
    expiresAt,
  });

  const inviteLink = `${inviteBaseUrl}?token=${token}&email=${encodeURIComponent(email)}`;

  await mail.send({
    to: email,
    from: 'notifications@mprar.com',
    templateId: process.env.SENDGRID_TEMPLATE_WELCOME || 'd-12bfa9f6d8b64f0c99ad302e71158364',
    dynamicTemplateData: {
      firstName: displayName || email.split('@')[0],
      loginUrl: inviteLink,
      companyName: 'MPRaR Platform', // Could be dynamic if company name is passed in data
      platformName: 'HR Portal'
    }
  });

  return { success: true, message: 'Invite sent' };
});
