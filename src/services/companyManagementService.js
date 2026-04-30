import { db } from '../firebase/client';
import { doc, updateDoc, getDoc, getDocs, query, where, collection, serverTimestamp, writeBatch } from 'firebase/firestore';
import { toast } from 'react-toastify';

/**
 * Suspend a company and all its users (except site managers)
 * @param {string} companyId - The company ID to suspend
 * @returns {Promise<void>}
 */
export async function suspendCompany(companyId) {
  if (!companyId) {
    throw new Error('Company ID is required');
  }

  try {
    const normalizedId = companyId.includes('/') ? companyId.split('/').pop() : companyId;
    const companyRef = doc(db, 'companies', normalizedId);
    const companySnap = await getDoc(companyRef);

    if (!companySnap.exists()) {
      throw new Error('Company not found');
    }

    // Update company status to suspended
    await updateDoc(companyRef, {
      status: 'suspended',
      updatedAt: serverTimestamp()
    });

    // Get all users for this company
    const usersQuery = query(
      collection(db, 'users'),
      where('companyId', '==', `companies/${normalizedId}`)
    );
    const usersSnap = await getDocs(usersQuery);

    // Use batch to update all users at once (including site managers)
    const batch = writeBatch(db);
    let userCount = 0;

    usersSnap.forEach((userDoc) => {
      // Suspend all users including site managers
      batch.update(userDoc.ref, {
        status: 'inactive',
        suspendedByCompany: true,
        updatedAt: serverTimestamp()
      });
      userCount++;
    });

    // Commit all user updates
    if (userCount > 0) {
      await batch.commit();
    }

    console.log(`[companyManagementService] Suspended company ${normalizedId} and ${userCount} users`);
    toast.success(`Company suspended successfully. ${userCount} users have been deactivated.`);
  } catch (error) {
    console.error('[companyManagementService] Failed to suspend company:', error);
    toast.error(error?.message || 'Failed to suspend company');
    throw error;
  }
}

/**
 * Activate a company and reactivate all its previously suspended users
 * @param {string} companyId - The company ID to activate
 * @returns {Promise<void>}
 */
export async function activateCompany(companyId) {
  if (!companyId) {
    throw new Error('Company ID is required');
  }

  try {
    const normalizedId = companyId.includes('/') ? companyId.split('/').pop() : companyId;
    const companyRef = doc(db, 'companies', normalizedId);
    const companySnap = await getDoc(companyRef);

    if (!companySnap.exists()) {
      throw new Error('Company not found');
    }

    // Update company status to active
    await updateDoc(companyRef, {
      status: 'active',
      updatedAt: serverTimestamp()
    });

    // Get all users for this company that were suspended by company
    const usersQuery = query(
      collection(db, 'users'),
      where('companyId', '==', `companies/${normalizedId}`)
    );
    const usersSnap = await getDocs(usersQuery);

    // Use batch to reactivate all users that were suspended by company
    const batch = writeBatch(db);
    let userCount = 0;

    usersSnap.forEach((userDoc) => {
      const userData = userDoc.data();

      // Reactivate users that were suspended by company
      if (userData.suspendedByCompany === true) {
        batch.update(userDoc.ref, {
          status: 'active',
          suspendedByCompany: false,
          updatedAt: serverTimestamp()
        });
        userCount++;
      }
    });

    // Commit all user updates
    if (userCount > 0) {
      await batch.commit();
    }

    console.log(`[companyManagementService] Activated company ${normalizedId} and reactivated ${userCount} users`);
    toast.success(`Company activated successfully. ${userCount} users have been reactivated.`);
  } catch (error) {
    console.error('[companyManagementService] Failed to activate company:', error);
    toast.error(error?.message || 'Failed to activate company');
    throw error;
  }
}

/**
 * Fetch all active companies for the dropdown
 * @returns {Promise<Array<{value: string, label: string}>>}
 */
export async function getAllCompanies() {
  try {
    const q = query(
      collection(db, 'companies'),
      where('status', '==', 'active')
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
      value: doc.id,
      label: doc.data().name || 'Unnamed Company'
    })).sort((a, b) => a.label.localeCompare(b.label));
  } catch (error) {
    console.error('[companyManagementService] Failed to fetch companies:', error);
    toast.error('Failed to load companies');
    return [];
  }
}

/**
 * Update a specific plugin setting for a company
 * @param {string} companyId - The company ID to update
 * @param {string} pluginKey - The plugin key (e.g., 'scheduling', 'payslipAndInvoice')
 * @param {boolean} isEnabled - Whether the plugin should be enabled
 * @returns {Promise<void>}
 */
export async function updateCompanyPlugin(companyId, pluginKey, isEnabled) {
  if (!companyId) throw new Error('Company ID is required');
  if (!pluginKey) throw new Error('Plugin key is required');

  try {
    const normalizedId = companyId.includes('/') ? companyId.split('/').pop() : companyId;
    const companyRef = doc(db, 'companies', normalizedId);

    // Use dot notation to update only the specific plugin field
    // This prevents overwriting other plugins or the entire map
    const updateData = {
      [`plugins.${pluginKey}`]: isEnabled,
      updatedAt: serverTimestamp()
    };

    await updateDoc(companyRef, updateData);
    console.log(`[companyManagementService] Updated plugin ${pluginKey} for ${normalizedId} to ${isEnabled}`);
  } catch (error) {
    console.error(`[companyManagementService] Failed to update plugin ${pluginKey}:`, error);
    toast.error(`Failed to update ${pluginKey} settings`);
    throw error;
  }
}

/**
 * Update all plugin settings for a company (Legacy - try to avoid using this)
 * @param {string} companyId 
 * @param {Object} plugins 
 */
export async function updateCompanyPlugins(companyId, plugins) {
  if (!companyId) throw new Error('Company ID is required');

  try {
    const normalizedId = companyId.includes('/') ? companyId.split('/').pop() : companyId;
    const companyRef = doc(db, 'companies', normalizedId);

    // Convert object to dot notation updates to be safe
    const updateData = { updatedAt: serverTimestamp() };
    Object.keys(plugins).forEach(key => {
      updateData[`plugins.${key}`] = plugins[key];
    });

    await updateDoc(companyRef, updateData);
  } catch (error) {
    console.error('[companyManagementService] Failed to update plugins:', error);
    throw error;
  }
}

/**
 * Get plugin settings for a company
 * @param {string} companyId 
 * @returns {Promise<{payslipAndInvoice: boolean, scheduling: boolean}>}
 */
export async function getCompanyPlugins(companyId) {
  if (!companyId) throw new Error('Company ID is required');
  try {
    const normalizedId = companyId.includes('/') ? companyId.split('/').pop() : companyId;
    const companyRef = doc(db, 'companies', normalizedId);
    const snap = await getDoc(companyRef);
    if (snap.exists()) {
      return snap.data().plugins || {};
    }
    return {};
  } catch (error) {
    console.error('[companyManagementService] Failed to fetch plugins:', error);
    return {};
  }
}
