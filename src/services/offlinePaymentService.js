import { db } from '../firebase/client';
import {
  collection,
  doc,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  updateDoc,
  serverTimestamp,
  getDoc
} from 'firebase/firestore';
import { parseCompanyId } from '../utils/dataParser';
import { recordSubscriptionPayment } from './billing';
import { toast } from 'react-toastify';

/**
 * Create an offline payment verification request
 * @param {Object} requestData - Payment request data
 * @param {string} requestData.companyId - Company ID
 * @param {string} requestData.submittedById - User ID who submitted
 * @param {string} requestData.submittedByName - Name of submitter
 * @param {string} requestData.submittedByEmail - Email of submitter
 * @param {string} requestData.paymentMethod - Payment method (Bank Transfer, Cash, Cheque)
 * @param {string} requestData.paymentEvidence - Evidence/receipt number
 * @param {string} requestData.additionalNotes - Additional notes
 * @param {number} requestData.amount - Payment amount
 * @param {number} requestData.seatCount - Number of seats being paid for
 * @returns {Promise<string>} Request ID
 */
export async function createOfflinePaymentRequest(requestData) {
  try {
    const {
      companyId,
      submittedById,
      submittedByName,
      submittedByEmail,
      paymentMethod,
      paymentEvidence,
      additionalNotes,
      amount,
      seatCount
    } = requestData;

    if (!companyId || !submittedById) {
      throw new Error('Company ID and submitter ID are required');
    }

    const normalizedCompanyId = parseCompanyId(companyId);
    const companyPath = `companies/${normalizedCompanyId}`;

    // Get company name
    const companyRef = doc(db, 'companies', normalizedCompanyId);
    const companySnap = await getDoc(companyRef);
    const companyName = companySnap.exists() ? companySnap.data().name || 'Unknown Company' : 'Unknown Company';

    const requestRef = await addDoc(collection(db, 'offlinePaymentRequests'), {
      companyId: companyPath,
      companyName,
      submittedById,
      submittedByName: submittedByName || 'Unknown',
      submittedByEmail: submittedByEmail || '',
      paymentMethod: paymentMethod || 'Bank Transfer',
      paymentEvidence: paymentEvidence || '',
      additionalNotes: additionalNotes || '',
      amount: Number(amount) || 0,
      seatCount: Number(seatCount) || 0,
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    console.log('[offlinePaymentService] Created offline payment request:', requestRef.id);
    toast.success('Offline payment request submitted successfully. Waiting for verification.');
    return requestRef.id;
  } catch (error) {
    console.error('[offlinePaymentService] Failed to create offline payment request:', error);
    toast.error(error?.message || 'Failed to submit offline payment request');
    throw error;
  }
}

// Request deduplication for pending requests
let pendingRequestsPromise = null;

/**
 * Get all pending offline payment requests (for super users)
 * @returns {Promise<Array>} Array of pending requests
 */
export async function getPendingOfflinePaymentRequests() {
  if (pendingRequestsPromise) return pendingRequestsPromise;

  pendingRequestsPromise = (async () => {
    try {
      let requestsSnap;
      try {
        const requestsQuery = query(
          collection(db, 'offlinePaymentRequests'),
          where('status', '==', 'pending'),
          orderBy('createdAt', 'desc')
        );
        requestsSnap = await getDocs(requestsQuery);
      } catch (orderError) {
        console.warn('[offlinePaymentService] OrderBy failed, fetching pending requests without order:', orderError);
        const requestsQuery = query(
          collection(db, 'offlinePaymentRequests'),
          where('status', '==', 'pending')
        );
        requestsSnap = await getDocs(requestsQuery);
      }
      const requests = [];

      requestsSnap.forEach((docSnap) => {
        const data = docSnap.data();
        requests.push({
          id: docSnap.id,
          companyId: data.companyId,
          companyName: data.companyName || 'Unknown Company',
          submittedById: data.submittedById,
          submittedByName: data.submittedByName || 'Unknown',
          submittedByEmail: data.submittedByEmail || '',
          paymentMethod: data.paymentMethod || 'Bank Transfer',
          paymentEvidence: data.paymentEvidence || '',
          additionalNotes: data.additionalNotes || '',
          amount: Number(data.amount) || 0,
          seatCount: Number(data.seatCount) || 0,
          status: data.status || 'pending',
          submittedDate: data.createdAt?.toDate
            ? data.createdAt.toDate().toISOString().slice(0, 10)
            : new Date().toISOString().slice(0, 10),
          createdAt: data.createdAt
        });
      });

      return requests;
    } catch (error) {
      console.error('[offlinePaymentService] Failed to fetch pending requests:', error);
      throw error;
    } finally {
      pendingRequestsPromise = null;
    }
  })();

  return pendingRequestsPromise;
}

// Request deduplication for payment records
let pendingRecordsPromise = null;

/**
 * Get all payment records (approved/declined) for super users
 * @returns {Promise<Array>} Array of payment records
 */
export async function getAllPaymentRecords() {
  if (pendingRecordsPromise) return pendingRecordsPromise;

  pendingRecordsPromise = (async () => {
    try {
      // Get all offline payment requests (all statuses)
      let offlineRequestsSnap;
      try {
        const offlineRequestsQuery = query(
          collection(db, 'offlinePaymentRequests'),
          orderBy('createdAt', 'desc')
        );
        offlineRequestsSnap = await getDocs(offlineRequestsQuery);
      } catch (orderError) {
        console.warn('[offlinePaymentService] OrderBy failed for offline requests, fetching without order:', orderError);
        offlineRequestsSnap = await getDocs(collection(db, 'offlinePaymentRequests'));
      }

      // Get all payments from payments collection
      let paymentsSnap;
      try {
        const paymentsQuery = query(
          collection(db, 'payments'),
          orderBy('createdAt', 'desc')
        );
        paymentsSnap = await getDocs(paymentsQuery);
      } catch (orderError) {
        console.warn('[offlinePaymentService] OrderBy failed for payments, fetching without order:', orderError);
        paymentsSnap = await getDocs(collection(db, 'payments'));
      }

      const records = [];

      // Process offline payment requests
      offlineRequestsSnap.forEach((docSnap) => {
        const data = docSnap.data();
        const status = data.status || 'pending';
        records.push({
          id: docSnap.id,
          company: data.companyName || 'Unknown Company',
          companyId: data.companyId,
          amount: `£${Number(data.amount || 0).toFixed(2)}`,
          method: data.paymentMethod || 'Bank Transfer',
          type: 'Offline',
          dueDate: data.createdAt?.toDate
            ? data.createdAt.toDate().toISOString().slice(0, 10)
            : '—',
          paidDate: status === 'approved'
            ? data.updatedAt?.toDate
              ? data.updatedAt.toDate().toISOString().slice(0, 10)
              : '—'
            : status === 'declined'
              ? 'Declined'
              : 'Not Paid',
          status: status === 'approved' ? 'active' : status === 'declined' ? 'Declined' : 'Pending',
          source: 'offline',
          requestData: data
        });
      });

      // Process online payments
      paymentsSnap.forEach((docSnap) => {
        const data = docSnap.data();
        const amount = Number(data.totalAmount || data.amount || data.total || 0);
        records.push({
          id: docSnap.id,
          company: data.companyName || 'Unknown Company',
          companyId: data.companyId,
          amount: `£${amount.toFixed(2)}`,
          method: data.paymentMethod || data.method || 'Card',
          type: 'Automatic',
          dueDate: data.createdAt?.toDate
            ? data.createdAt.toDate().toISOString().slice(0, 10)
            : '—',
          paidDate: data.createdAt?.toDate
            ? data.createdAt.toDate().toISOString().slice(0, 10)
            : '—',
          status: data.status === 'paid' ? 'active' : data.status || 'Pending',
          source: 'online',
          paymentData: data
        });
      });

      // Sort by date descending (most recent first)
      records.sort((a, b) => {
        const dateA = new Date(a.dueDate || 0).getTime();
        const dateB = new Date(b.dueDate || 0).getTime();
        return dateB - dateA;
      });

      return records;
    } catch (error) {
      console.error('[offlinePaymentService] Failed to fetch payment records:', error);
      throw error;
    } finally {
      pendingRecordsPromise = null;
    }
  })();
  return pendingRecordsPromise;
}

/**
 * Approve an offline payment request
 * @param {string} requestId - Request ID to approve
 * @returns {Promise<void>}
 */
export async function approveOfflinePaymentRequest(requestId) {
  try {
    const requestRef = doc(db, 'offlinePaymentRequests', requestId);
    const requestSnap = await getDoc(requestRef);

    if (!requestSnap.exists()) {
      throw new Error('Payment request not found');
    }

    const requestData = requestSnap.data();
    if (requestData.status !== 'pending') {
      throw new Error('This request has already been processed');
    }

    const companyId = parseCompanyId(requestData.companyId);
    const seatCount = Number(requestData.seatCount) || 0;

    // Update request status to approved
    await updateDoc(requestRef, {
      status: 'approved',
      approvedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    // Record the subscription payment (same as online payment)
    const parsedCompanyId = parseCompanyId(requestData.companyId);
    if (parsedCompanyId && seatCount > 0) {
      await recordSubscriptionPayment(parsedCompanyId, seatCount);
    }

    // Create a payment record in payments collection
    const paymentRef = await addDoc(collection(db, 'payments'), {
      companyId: requestData.companyId,
      companyName: requestData.companyName,
      amount: requestData.amount,
      totalAmount: requestData.amount,
      paymentMethod: requestData.paymentMethod,
      method: requestData.paymentMethod,
      status: 'paid',
      type: 'offline',
      offlineRequestId: requestId,
      userCount: requestData.seatCount,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    console.log('[offlinePaymentService] Approved offline payment request:', requestId);
    toast.success('Payment request approved. Company subscription has been renewed.');
    return paymentRef.id;
  } catch (error) {
    console.error('[offlinePaymentService] Failed to approve payment request:', error);
    toast.error(error?.message || 'Failed to approve payment request');
    throw error;
  }
}

/**
 * Decline an offline payment request
 * @param {string} requestId - Request ID to decline
 * @returns {Promise<void>}
 */
export async function declineOfflinePaymentRequest(requestId) {
  try {
    const requestRef = doc(db, 'offlinePaymentRequests', requestId);
    const requestSnap = await getDoc(requestRef);

    if (!requestSnap.exists()) {
      throw new Error('Payment request not found');
    }

    const requestData = requestSnap.data();
    if (requestData.status !== 'pending') {
      throw new Error('This request has already been processed');
    }

    // Update request status to declined
    await updateDoc(requestRef, {
      status: 'declined',
      declinedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    console.log('[offlinePaymentService] Declined offline payment request:', requestId);
    toast.success('Payment request declined. Company will remain blocked until payment is verified.');
  } catch (error) {
    console.error('[offlinePaymentService] Failed to decline payment request:', error);
    toast.error(error?.message || 'Failed to decline payment request');
    throw error;
  }
}

