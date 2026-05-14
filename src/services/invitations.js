import hrApiClient from '../lib/hrApiClient';

/**
 * Invitations Service (Phase 4 — REST Migration)
 * 
 * Handles user invitations via the HR REST API.
 * Replaces Firebase Functions and Firestore with centralized Node.js/Prisma logic.
 */

/**
 * Send a user invite
 */
export async function sendUserInvite(payload) {
  try {
    const { data } = await hrApiClient.post('/hr/invites', payload);
    return data;
  } catch (error) {
    console.error('[invitations] Invite failed:', error);
    throw error;
  }
}

/**
 * Revoke/cancel a pending user invite
 */
export async function revokeUserInvite(inviteId, metadata = {}) {
  try {
    const { data } = await hrApiClient.delete(`/hr/invites/${inviteId}`);
    return { ok: true, data };
  } catch (error) {
    console.error('[invitations] Revoke failed:', error);
    throw error;
  }
}

/**
 * List all invites for the company
 */
export async function listInvites() {
  try {
    const { data } = await hrApiClient.get('/hr/invites');
    return data || [];
  } catch (error) {
    console.error('[invitations] List failed:', error);
    return [];
  }
}
