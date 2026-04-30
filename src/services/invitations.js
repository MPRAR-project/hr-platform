import { httpsCallable } from 'firebase/functions';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';

import { functions, db } from '../firebase/client';

export async function sendUserInvite(payload) {
  try {
    const fn = httpsCallable(functions, 'sendUserInvite');
    const res = await fn(payload);
    return res?.data || { ok: true };
  } catch (error) {
    console.error('[invitations.js] Invite failed:', error);
    throw error;
  }
}

/**
 * Revoke/cancel a pending user invite.
 * Marks the invite as revoked so the recipient can no longer complete signup.
 * @param {string} inviteId - Firestore document ID of the invite.
 * @param {Object} metadata - Optional metadata about who revoked the invite.
 * @param {string} metadata.revokedBy - User ID who revoked the invite.
 * @param {string} metadata.revokedByEmail - Email of the user who revoked the invite.
 * @param {string} metadata.reason - Optional reason shown in audit trail.
 */
export async function revokeUserInvite(inviteId, metadata = {}) {
  if (!inviteId) {
    throw new Error('Invite ID is required to revoke an invite.');
  }

  try {
    const inviteRef = doc(db, 'invites', inviteId);
    const now = serverTimestamp();

    const updatePayload = {
      status: 'revoked',
      updatedAt: now,
      revokedAt: now,
      revokedBy: metadata.revokedBy || null,
      revokedByEmail: metadata.revokedByEmail || null,
      revokedReason:
        metadata.reason ||
        metadata.revokedReason ||
        'Invite revoked by administrator'
    };

    await updateDoc(inviteRef, updatePayload);
    return { ok: true };
  } catch (error) {
    console.error('Failed to revoke invite:', error);
    throw new Error(error?.message || 'Failed to revoke invitation');
  }
}


