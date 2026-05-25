/**
 * seatRequestService.js
 *
 * All calls go to the HR Backend via hrApiClient (authenticated, auto-refresh).
 *
 * Role matrix (enforced on the backend):
 *   SEAT_PURCHASERS  (siteManager, seniorManager, superUser) — use /billing/checkout directly
 *   SEAT_REQUESTERS  (adminManager, adminAdvisor, hrManager, hrAdvisor, teamManager) — use createSeatRequest()
 */

import hrApiClient from '../lib/hrApiClient';

// ── Create a seat request (SEAT_REQUESTERS only) ──────────────────────────────
export async function createSeatRequest({ seatCount, reason }) {
  const { data } = await hrApiClient.post('/hr/billing/seat-requests', { seatCount, reason });
  return data;
}

// ── List seat requests ────────────────────────────────────────────────────────
// Purchasers see all; others see only their own (scoped server-side).
export async function fetchSeatRequests({ status } = {}) {
  const { data } = await hrApiClient.get('/hr/billing/seat-requests', {
    params: status ? { status } : undefined,
  });
  return data;
}

// ── Get a single seat request ─────────────────────────────────────────────────
export async function getSeatRequest(requestId) {
  const { data } = await hrApiClient.get(`/hr/billing/seat-requests/${requestId}`);
  return data;
}

// ── Calculate payment for a seat request ─────────────────────────────────────
export async function calculateSeatRequestPayment(requestId) {
  const { data } = await hrApiClient.get(`/hr/billing/seat-requests/${requestId}/payment-calc`);
  return data;
}

// ── Approve a seat request (BILLING_ADMINS only) ──────────────────────────────
// Pass skipSeatIncrement=true when /billing/checkout was already called first.
export async function approveSeatRequest(requestId, { notes, skipSeatIncrement = false } = {}) {
  const { data } = await hrApiClient.put(`/hr/billing/seat-requests/${requestId}/approve`, {
    notes,
    skipSeatIncrement,
  });
  return data;
}

// ── Reject a seat request (BILLING_ADMINS only) ───────────────────────────────
export async function rejectSeatRequest(requestId, { notes } = {}) {
  const { data } = await hrApiClient.put(`/hr/billing/seat-requests/${requestId}/reject`, { notes });
  return data;
}

// ── Cancel a seat request (requester only) ────────────────────────────────────
export async function cancelSeatRequest(requestId) {
  const { data } = await hrApiClient.put(`/hr/billing/seat-requests/${requestId}/cancel`, {});
  return data;
}

// ── Compatibility shim: old updateSeatRequestStatus() call shape ──────────────
// SeatSettingsTab.jsx and SeatManagementPage.jsx call this. Keep the shape so
// existing pages continue to work while being migrated individually.
export async function updateSeatRequestStatus(requestId, status, meta = {}) {
  const { notes, skipSeatIncrement } = meta;
  if (status === 'approved') return approveSeatRequest(requestId, { notes, skipSeatIncrement });
  if (status === 'rejected') return rejectSeatRequest(requestId, { notes });
  if (status === 'cancelled') return cancelSeatRequest(requestId);
  throw new Error(`Unknown seat request status: ${status}`);
}

// ── Emit a custom DOM event so other components refresh ───────────────────────
export function emitSeatRequestEvent() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('seatRequests:updated'));
  }
}
