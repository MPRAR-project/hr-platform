import { db } from '../firebase/client';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where
} from 'firebase/firestore';
import { recordSeatTopUp } from './billing';

const COLLECTION = 'seatRequests';

const normalizeCompanyId = (companyId = '') =>
  companyId.startsWith('companies/') ? companyId : `companies/${companyId}`;

export async function createSeatRequest(
  {
    companyId,
    siteId,
    requestedById,
    requestedByName,
    requestedByEmail
  },
  { additionalSeats, reason }
) {
  if (!companyId) throw new Error('Company identifier is required.');
  if (!requestedById) throw new Error('Requester information is required.');

  const payload = {
    companyId: normalizeCompanyId(companyId),
    siteId: siteId ? (siteId.startsWith('sites/') ? siteId : `sites/${siteId}`) : null,
    additionalSeats: Number(additionalSeats) || 0,
    reason: reason || '',
    status: 'pending',
    requestedBy: {
      id: requestedById,
      name: requestedByName || 'Unknown',
      email: requestedByEmail || null
    },
    requestedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  const docRef = await addDoc(collection(db, COLLECTION), payload);
  return { id: docRef.id, ...payload };
}

export async function fetchSeatRequests(companyId, { statuses = [], limit = null } = {}) {
  if (!companyId) throw new Error('Company identifier is required.');
  const normalizedCompanyId = normalizeCompanyId(companyId);

  let seatQuery = query(
    collection(db, COLLECTION),
    where('companyId', '==', normalizedCompanyId),
    orderBy('requestedAt', 'desc')
  );

  try {
    const snapshot = await getDocs(seatQuery);
    const data = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data()
    }));

    let filtered = data;
    if (Array.isArray(statuses) && statuses.length > 0) {
      const statusSet = new Set(statuses.map((s) => s.toLowerCase()));
      filtered = data.filter((req) => statusSet.has((req.status || '').toLowerCase()));
    }

    if (limit && limit > 0) {
      filtered = filtered.slice(0, limit);
    }

    return filtered;
  } catch (error) {
    console.error('Error fetching seat requests:', error);
    
    // Check if this is an index building error
    if (error.code === 'failed-precondition' && error.message?.includes('currently building')) {
      console.warn('[seatRequestService] Index is still building. Returning empty array temporarily.');
      return [];
    }
    
    throw error;
  }
}

/**
 * Calculate how many seats need immediate payment for a seat request
 * @param {string} requestId - Request ID
 * @returns {Promise<{seatsToCharge: number, additionalSeats: number}>}
 */
export async function calculateSeatRequestPayment(requestId) {
  if (!requestId) throw new Error('Seat request ID is required.');

  const reqRef = doc(db, COLLECTION, requestId);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) {
    throw new Error('Seat request not found.');
  }

  const currentData = reqSnap.data();
  if (!currentData?.companyId || !Number.isFinite(currentData.additionalSeats)) {
    return { seatsToCharge: 0, additionalSeats: 0 };
  }

  const companyId = currentData.companyId.includes('/')
    ? currentData.companyId.split('/').pop()
    : currentData.companyId;
  
  // Get current company data to check seat usage
  const companyRef = doc(db, 'companies', companyId);
  const companySnap = await getDoc(companyRef);
  
  if (!companySnap.exists()) {
    throw new Error('Company not found');
  }
  
  const companyData = companySnap.data();
  const additionalSeats = Number(currentData.additionalSeats) || 0;
  
  // Current values
  const currentSeatCount = Number(companyData.seatCount || 0);
  const currentBillingSeatQuota = Number(companyData.billingSeatQuota || companyData.seatCount || 0);
  const currentEmployeeCount = Number(companyData.currentEmployeeCount || 0);
  
  // Calculate how many seats need immediate payment
  // If all seats are used (currentEmployeeCount >= currentSeatCount), charge for all new seats
  // If there are empty seats, only charge for seats beyond what's already available
  const seatsAlreadyAvailable = Math.max(currentBillingSeatQuota, currentEmployeeCount);
  const newTotalSeats = currentSeatCount + additionalSeats;
  const seatsToCharge = Math.max(0, newTotalSeats - seatsAlreadyAvailable);
  
  return { seatsToCharge, additionalSeats };
}

export async function updateSeatRequestStatus(requestId, status, metadata = {}) {
  if (!requestId) throw new Error('Seat request ID is required.');
  if (!status) throw new Error('Status is required.');

  const reqRef = doc(db, COLLECTION, requestId);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) {
    throw new Error('Seat request not found.');
  }

  const currentData = reqSnap.data();
  const updatePayload = {
    status,
    updatedAt: serverTimestamp()
  };

  if (metadata.resolvedById) {
    updatePayload.resolvedBy = {
      id: metadata.resolvedById,
      name: metadata.resolvedByName || null,
      email: metadata.resolvedByEmail || null
    };
  }

  if (metadata.notes) {
    updatePayload.resolutionNotes = metadata.notes;
  }

  if (status !== 'pending') {
    updatePayload.resolvedAt = serverTimestamp();
  }

  await updateDoc(reqRef, updatePayload);

  if (
    status === 'approved' &&
    currentData?.status !== 'approved' &&
    currentData?.companyId &&
    Number.isFinite(currentData.additionalSeats)
  ) {
    const companyId = currentData.companyId.includes('/')
      ? currentData.companyId.split('/').pop()
      : currentData.companyId;
    
    // Get current company data to check seat usage
    const companyRef = doc(db, 'companies', companyId);
    const companySnap = await getDoc(companyRef);
    
    if (!companySnap.exists()) {
      throw new Error('Company not found');
    }
    
    const companyData = companySnap.data();
    const additionalSeats = Number(currentData.additionalSeats) || 0;
    
    // Current values
    const currentSeatCount = Number(companyData.seatCount || 0);
    const currentBillingSeatQuota = Number(companyData.billingSeatQuota || companyData.seatCount || 0);
    const currentEmployeeCount = Number(companyData.currentEmployeeCount || 0);
    
    // Calculate how many seats need immediate payment
    // If all seats are used (currentEmployeeCount >= currentSeatCount), charge for all new seats
    // If there are empty seats, only charge for seats beyond what's already available
    const seatsAlreadyAvailable = Math.max(currentBillingSeatQuota, currentEmployeeCount);
    const newTotalSeats = currentSeatCount + additionalSeats;
    const seatsToCharge = Math.max(0, newTotalSeats - seatsAlreadyAvailable);
    
    // If billing update is skipped, it means payment was already processed separately
    // In that case, seatCount was already updated by recordSeatTopUp
    // We only need to update seatCount by the difference (additionalSeats - seatsToCharge)
    if (metadata.skipBillingUpdate) {
      // Payment was already processed, seatCount was updated by recordSeatTopUp
      // We need to update seatCount by the remaining seats (if any)
      const seatsAlreadyUpdated = Number(metadata.seatsToCharge || 0); // This was already added by recordSeatTopUp
      const remainingSeats = additionalSeats - seatsAlreadyUpdated;
      if (remainingSeats > 0) {
        await updateDoc(companyRef, {
          seatCount: increment(remainingSeats),
          updatedAt: serverTimestamp()
        });
      } else {
        // Just update timestamp
        await updateDoc(companyRef, {
          updatedAt: serverTimestamp()
        });
      }
    } else {
      // Normal flow: update seatCount first (always increase available seats)
      await updateDoc(companyRef, {
        seatCount: increment(additionalSeats),
        updatedAt: serverTimestamp()
      });
      
      // If seats need immediate payment, update billing
      if (seatsToCharge > 0) {
        await recordSeatTopUp(companyId, seatsToCharge);
      }
    }
  }

  return { success: true };
}

export function emitSeatRequestEvent() {
  window.dispatchEvent(new CustomEvent('seatRequests:updated'));
}

export async function addCompanySeats(companyId, seats = 1) {
  await recordSeatTopUp(companyId, seats);
  return { success: true };
}

