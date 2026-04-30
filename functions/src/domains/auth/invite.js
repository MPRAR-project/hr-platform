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
    subject: 'You’re invited to MPRAR',
    html: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Invitation to Join</title>
  </head>
  <body style="font-family: 'Segoe UI', Arial, sans-serif; background-color: #f7f9fc; margin: 0; padding: 0;">
    <table width="100%" cellspacing="0" cellpadding="0" style="background-color: #f7f9fc; padding: 40px 0;">
      <tr>
        <td align="center">
          <table width="600" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">

            <!-- Header -->
            <tr>
              <td align="center" style="background-color: #0069d9; color: #ffffff; padding: 25px 10px; font-size: 22px; font-weight: bold;">
                Welcome to Our Team!
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="padding: 40px 30px; color: #333333;">
                <p style="font-size: 18px; margin: 0 0 15px 0;">Hello${displayName ? ' ' + displayName : ''},</p>
                
                <p style="font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
                  You’ve been invited to join our platform. We’re excited to have you on board!
                </p>

                <p style="font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">
                  Please click the button below to complete your account setup and get started.
                </p>

                <p style="text-align: center; margin: 40px 0;">
                  <a href="${inviteLink}"
                    style="background-color: #0069d9; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: 600; display: inline-block;">
                    Complete Your Account
                  </a>
                </p>

                <p style="font-size: 14px; color: #777777; margin: 0 0 15px 0;">
                  <strong>Note:</strong> This invitation link will expire in <strong>7 days</strong>.
                </p>

                <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 30px 0;" />

                <p style="font-size: 14px; color: #777777; margin: 0;">
                  If you didn’t request this invitation, please ignore this email.
                </p>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td align="center" style="background-color: #f0f4f8; padding: 20px; font-size: 13px; color: #666666;">
                &copy; ${new Date().getFullYear()} MPRAR. All rights reserved.
              </td>
            </tr>
            
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
  });

  return { success: true, message: 'Invite sent' };
});
