import hrApiClient from '../lib/hrApiClient';
import { toast } from 'react-toastify';

/**
 * Offline Payment Service (Phase 4 — REST Migration)
 * All operations now call the HR REST API.
 */

/**
 * Create an offline payment verification request
 */
export async function createOfflinePaymentRequest(requestData) {
  try {
    const {
      amount,
      seatCount,
      paymentMethod,
      paymentEvidence,
      additionalNotes
    } = requestData;

    const { data } = await hrApiClient.post('/hr/billing/offline-requests', {
      amount: Number(amount),
      seatCount: Number(seatCount),
      paymentMethod: paymentMethod || 'Bank Transfer',
      evidence: paymentEvidence || '',
      notes: additionalNotes || ''
    });

    toast.success('Offline payment request submitted successfully. Waiting for verification.');
    return data.id;
  } catch (error) {
    console.error('[offlinePaymentService] Failed to create offline payment request:', error);
    const msg = error.response?.data?.error || error.message || 'Failed to submit offline payment request';
    toast.error(msg);
    throw new Error(msg);
  }
}

/**
 * Get all pending offline payment requests
 */
export async function getPendingOfflinePaymentRequests() {
  try {
    const { data } = await hrApiClient.get('/hr/billing/offline-requests', {
      params: { status: 'pending' }
    });
    
    // Normalize response to match existing UI expectation
    return (data.requests || data || []).map(req => ({
      ...req,
      companyName: req.company?.name || 'Unknown Company',
      submittedDate: req.createdAt ? new Date(req.createdAt).toISOString().slice(0, 10) : '—',
      paymentMethod: req.paymentMethod,
      paymentEvidence: req.evidence,
      additionalNotes: req.notes
    }));
  } catch (error) {
    console.error('[offlinePaymentService] Failed to fetch pending requests:', error);
    throw error;
  }
}

/**
 * Get all payment records (approved/declined)
 */
export async function getAllPaymentRecords() {
  try {
    const { data } = await hrApiClient.get('/hr/billing/offline-requests');
    
    return (data.requests || data || []).map(req => ({
      id: req.id,
      company: req.company?.name || 'Unknown Company',
      companyId: req.companyId,
      amount: `£${Number(req.amount || 0).toFixed(2)}`,
      method: req.paymentMethod || 'Bank Transfer',
      type: 'Offline',
      dueDate: req.createdAt ? new Date(req.createdAt).toISOString().slice(0, 10) : '—',
      paidDate: req.status === 'approved' 
        ? (req.processedAt ? new Date(req.processedAt).toISOString().slice(0, 10) : '—')
        : (req.status === 'declined' ? 'Declined' : 'Pending'),
      status: req.status === 'approved' ? 'active' : (req.status === 'declined' ? 'Declined' : 'Pending'),
      source: 'offline',
      requestData: req
    }));
  } catch (error) {
    console.error('[offlinePaymentService] Failed to fetch payment records:', error);
    throw error;
  }
}

/**
 * Approve an offline payment request
 */
export async function approveOfflinePaymentRequest(requestId, companyId) {
  try {
    const { data } = await hrApiClient.put(`/hr/billing/offline-requests/${requestId}`, {
      status: 'approved',
      companyId // Backend needs companyId to update the correct company
    });

    toast.success('Payment request approved. Company subscription has been renewed.');
    return data.id;
  } catch (error) {
    console.error('[offlinePaymentService] Failed to approve payment request:', error);
    const msg = error.response?.data?.error || error.message || 'Failed to approve payment request';
    toast.error(msg);
    throw new Error(msg);
  }
}

/**
 * Decline an offline payment request
 */
export async function declineOfflinePaymentRequest(requestId, companyId, reason) {
  try {
    await hrApiClient.put(`/hr/billing/offline-requests/${requestId}`, {
      status: 'declined',
      companyId,
      reason
    });

    toast.success('Payment request declined.');
  } catch (error) {
    console.error('[offlinePaymentService] Failed to decline payment request:', error);
    const msg = error.response?.data?.error || error.message || 'Failed to decline payment request';
    toast.error(msg);
    throw new Error(msg);
  }
}
