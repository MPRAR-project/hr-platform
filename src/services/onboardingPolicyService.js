import { db } from '../firebase/client';
import {
  collection,
  doc,
  setDoc,
  getDocs,
  getDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  updateDoc
} from 'firebase/firestore';
import { uploadDocument, DOCUMENT_TYPES, DOCUMENT_CATEGORIES } from './documents';
const COLLECTION = 'companyOnboardingPolicies';

const normalizeCompanyId = (companyId) => {
  if (!companyId) throw new Error('Company ID is required');
  return companyId.startsWith('companies/') ? companyId : `companies/${companyId}`;
};

export async function addCompanyOnboardingPolicy({
  companyId,
  title,
  description = '',
  category = 'policy',
  isRequired = false,
  file,
  uploadedBy,
  uploadedByEmail
}) {
  if (!file) throw new Error('File is required');
  if (!title) throw new Error('Title is required');
  if (!uploadedBy) throw new Error('Uploader is required');

  const normalizedCompanyId = normalizeCompanyId(companyId);
  const uploadResult = await uploadDocument({
    file,
    userId: uploadedBy,
    documentType: DOCUMENT_TYPES.OTHER,
    category: DOCUMENT_CATEGORIES.POLICY_AGREEMENT,
    description: description || `Company policy: ${title}`,
    onboardingApplicationId: null
  });

  const policyRef = doc(collection(db, COLLECTION));
  const policyData = {
    id: policyRef.id,
    companyId: normalizedCompanyId,
    title,
    description,
    category,
    isRequired,
    fileName: uploadResult.fileName || file.name,
    downloadURL: uploadResult.downloadURL,
    storagePath: uploadResult.storagePath || uploadResult.storageFileName || '',
    documentId: uploadResult.id,
    uploadedBy: uploadedBy || null,
    uploadedByEmail: uploadedByEmail || null,
    status: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  await setDoc(policyRef, policyData);
  return { id: policyRef.id, ...policyData, downloadURL: policyData.downloadURL };
}

export async function getCompanyOnboardingPolicies(companyId) {
  const normalizedCompanyId = normalizeCompanyId(companyId);
  const policiesQuery = query(
    collection(db, COLLECTION),
    where('companyId', '==', normalizedCompanyId),
    where('status', '==', 'active'),
    orderBy('createdAt', 'desc')
  );

  try {
    const snapshot = await getDocs(policiesQuery);
    return snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data()
    }));
  } catch (error) {
    console.error('Error getting company onboarding policies:', error);
    
    // Check if this is an index building error
    if (error.code === 'failed-precondition' && error.message?.includes('currently building')) {
      console.warn('[onboardingPolicyService] Index is still building. Returning empty array temporarily.');
      return [];
    }
    
    throw error;
  }
}

export async function deleteCompanyOnboardingPolicy(policyId) {
  if (!policyId) throw new Error('Policy ID is required');

  const policyRef = doc(db, COLLECTION, policyId);
  const policySnap = await getDoc(policyRef);
  if (!policySnap.exists()) return { success: false };

  await updateDoc(policyRef, {
    status: 'inactive',
    updatedAt: serverTimestamp()
  });
  return { success: true };
}

