import { db } from '../firebase/client';
import { collection, addDoc, updateDoc, deleteDoc, doc, query, where, getDocs, serverTimestamp, getDoc } from 'firebase/firestore';

const COLLECTION = 'clients';

export async function addClient(companyId, data) {
    if (!companyId) throw new Error('Company ID is required');

    const payload = {
        ...data,
        companyId, // Link to parent company
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    };

    const ref = await addDoc(collection(db, COLLECTION), payload);
    return { id: ref.id, ...payload };
}

export async function updateClient(clientId, data) {
    if (!clientId) throw new Error('Client ID is required');

    const ref = doc(db, COLLECTION, clientId);
    const payload = {
        ...data,
        updatedAt: serverTimestamp()
    };

    await updateDoc(ref, payload);
    return { id: clientId, ...payload };
}

export async function deleteClient(clientId) {
    if (!clientId) throw new Error('Client ID is required');
    await deleteDoc(doc(db, COLLECTION, clientId));
    return true;
}

export async function getClients(companyId) {
    if (!companyId) return [];

    // Handle full path vs ID
    const compKey = companyId.includes('/') ? companyId.split('/')[1] : companyId;

    // Query mostly by companyId string, but handle legacy formats if needed
    // Assuming clients refer to companyId as string key
    const q = query(collection(db, COLLECTION), where('companyId', '==', compKey));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getClient(clientId) {
    if (!clientId) return null;
    const snap = await getDoc(doc(db, COLLECTION, clientId));
    if (snap.exists()) return { id: snap.id, ...snap.data() };
    return null;
}
