import { addDoc, collection, getDocs, query, serverTimestamp, where } from 'firebase/firestore';
import { db } from '../firebase/client';

/**
 * Log action to audit trail
 * @param {string} userId - User ID performing the action
 * @param {string} actionType - Type of action (e.g., 'MANUAL_ENTRY_ADDED', 'MANUAL_ENTRY_DELETED', 'TIMESHEET_EDITED')
 * @param {string} resourceType - Type of resource (e.g., 'TIMESHEET', 'TIME_ENTRY')
 * @param {string} resourceId - ID of the resource being modified
 * @param {object} details - Additional details about the action
 * @returns {Promise<string>} - Document ID of the audit log entry
 */
export async function logAuditTrail(userId, actionType, resourceType, resourceId, details = {}) {
  try {
    const auditEntry = {
      userId,
      actionType,
      resourceType,
      resourceId,
      details: {
        ...details,
        timestamp: new Date().toISOString(),
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown'
      },
      createdAt: serverTimestamp(),
      weekStartDate: details.weekStartDate || null,
      companyId: details.companyId || null
    };

    const docRef = await addDoc(collection(db, 'auditTrail'), auditEntry);
    
    console.log(`[AuditTrail] ${actionType} logged:`, {
      id: docRef.id,
      userId,
      actionType,
      resourceType,
      resourceId,
      details
    });

    return docRef.id;
  } catch (error) {
    console.error('[AuditTrail] Failed to log action:', {
      actionType,
      error: error.message
    });
    // Don't throw - audit trail failures shouldn't block operations
    return null;
  }
}

/**
 * Log manual timesheet entry
 * @param {string} userId - Employee ID
 * @param {string} entryDate - Date of the entry (YYYY-MM-DD)
 * @param {string} description - Description of the manual entry
 * @param {string} clockIn - Clock in time (HH:MM)
 * @param {string} clockOut - Clock out time (HH:MM)
 * @param {number} breakMin - Break time in minutes
 * @param {string} createdBy - Name of user creating the entry
 * @param {string} weekStartDate - Start date of the week
 * @param {string} companyId - Company ID
 * @returns {Promise<string>} - Audit log entry ID
 */
export async function logManualEntryAdded(userId, entryDate, description, clockIn, clockOut, breakMin, createdBy, weekStartDate, companyId) {
  return logAuditTrail(
    userId,
    'MANUAL_ENTRY_ADDED',
    'TIME_ENTRY',
    `${userId}_${entryDate}`,
    {
      entryDate,
      description,
      clockIn,
      clockOut,
      breakMin,
      createdBy,
      weekStartDate,
      companyId,
      action: 'Manual timesheet entry added - employee could not clock in or required manual entry'
    }
  );
}

/**
 * Log manual timesheet entry deletion
 * @param {string} userId - Employee ID
 * @param {string} entryDate - Date of the entry (YYYY-MM-DD)
 * @param {string} description - Description of the manual entry that was deleted
 * @param {string} deletedBy - Name of user deleting the entry
 * @param {string} weekStartDate - Start date of the week
 * @param {string} companyId - Company ID
 * @returns {Promise<string>} - Audit log entry ID
 */
export async function logManualEntryDeleted(userId, entryDate, description, deletedBy, weekStartDate, companyId) {
  return logAuditTrail(
    userId,
    'MANUAL_ENTRY_DELETED',
    'TIME_ENTRY',
    `${userId}_${entryDate}`,
    {
      entryDate,
      description,
      deletedBy,
      weekStartDate,
      companyId,
      action: 'Manual timesheet entry deleted'
    }
  );
}

/**
 * Log timesheet submission with manual entries
 * @param {string} userId - Employee ID
 * @param {string} weekStartDate - Start date of the week
 * @param {number} manualEntryCount - Number of manual entries in the submission
 * @param {array} manualEntries - Array of manual entries submitted
 * @param {string} submittedBy - Name of user submitting
 * @param {string} companyId - Company ID
 * @returns {Promise<string>} - Audit log entry ID
 */
export async function logTimesheetSubmissionWithManualEntries(userId, weekStartDate, manualEntryCount, manualEntries, submittedBy, companyId) {
  return logAuditTrail(
    userId,
    'TIMESHEET_SUBMITTED_WITH_MANUAL_ENTRIES',
    'TIMESHEET',
    `${userId}_${weekStartDate}`,
    {
      weekStartDate,
      manualEntryCount,
      manualEntries: manualEntries.map(entry => ({
        date: entry.entryDate || entry.date,
        description: entry.description,
        hours: entry.effectiveHours || 0
      })),
      submittedBy,
      companyId,
      action: `Timesheet submitted with ${manualEntryCount} manual entries`
    }
  );
}

/**
 * Get audit trail for a timesheet
 * @param {string} userId - Employee ID
 * @param {string} weekStartDate - Start date of the week (YYYY-MM-DD)
 * @returns {Promise<array>} - Array of audit trail entries
 */
export async function getTimesheetAuditTrail(userId, weekStartDate) {
  try {
    const q = query(
      collection(db, 'auditTrail'),
      where('userId', '==', userId),
      where('weekStartDate', '==', weekStartDate),
      where('resourceType', '==', 'TIME_ENTRY')
    );

    const snapshot = await getDocs(q);
    const entries = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return entries.sort((a, b) => {
      const timeA = a.createdAt?.toDate?.() || new Date(a.details?.timestamp);
      const timeB = b.createdAt?.toDate?.() || new Date(b.details?.timestamp);
      return timeB - timeA; // Newest first
    });
  } catch (error) {
    console.error('[AuditTrail] Failed to fetch audit trail:', error);
    return [];
  }
}

/**
 * Get all manual entries for an employee in a date range
 * @param {string} userId - Employee ID
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Promise<array>} - Array of manual entry audit logs
 */
export async function getManualEntriesAuditLog(userId, startDate, endDate) {
  try {
    const q = query(
      collection(db, 'auditTrail'),
      where('userId', '==', userId),
      where('actionType', 'in', ['MANUAL_ENTRY_ADDED', 'MANUAL_ENTRY_DELETED'])
    );

    const snapshot = await getDocs(q);
    const entries = snapshot.docs
      .map(doc => ({
        id: doc.id,
        ...doc.data()
      }))
      .filter(entry => {
        const entryDate = entry.details?.entryDate;
        if (!entryDate) return false;
        return entryDate >= startDate && entryDate <= endDate;
      });

    return entries.sort((a, b) => {
      const timeA = a.createdAt?.toDate?.() || new Date(a.details?.timestamp);
      const timeB = b.createdAt?.toDate?.() || new Date(b.details?.timestamp);
      return timeB - timeA; // Newest first
    });
  } catch (error) {
    console.error('[AuditTrail] Failed to fetch manual entries audit log:', error);
    return [];
  }
}

/**
 * Get audit trail statistics for a company
 * @param {string} companyId - Company ID
 * @param {string} startDate - Start date (YYYY-MM-DD)
 * @param {string} endDate - End date (YYYY-MM-DD)
 * @returns {Promise<object>} - Statistics object
 */
export async function getManualEntryStatistics(companyId, startDate, endDate) {
  try {
    const q = query(
      collection(db, 'auditTrail'),
      where('companyId', '==', companyId),
      where('actionType', 'in', ['MANUAL_ENTRY_ADDED', 'MANUAL_ENTRY_DELETED'])
    );

    const snapshot = await getDocs(q);
    const entries = snapshot.docs
      .map(doc => doc.data())
      .filter(entry => {
        const entryDate = entry.details?.entryDate;
        if (!entryDate) return false;
        return entryDate >= startDate && entryDate <= endDate;
      });

    const stats = {
      totalManualEntries: entries.filter(e => e.actionType === 'MANUAL_ENTRY_ADDED').length,
      deletedManualEntries: entries.filter(e => e.actionType === 'MANUAL_ENTRY_DELETED').length,
      usersWithManualEntries: new Set(entries.map(e => e.userId)).size,
      byUser: {}
    };

    // Group by user
    entries.forEach(entry => {
      if (!stats.byUser[entry.userId]) {
        stats.byUser[entry.userId] = {
          name: entry.details?.createdBy || 'Unknown',
          added: 0,
          deleted: 0,
          entries: []
        };
      }
      if (entry.actionType === 'MANUAL_ENTRY_ADDED') {
        stats.byUser[entry.userId].added++;
      } else {
        stats.byUser[entry.userId].deleted++;
      }
      stats.byUser[entry.userId].entries.push({
        date: entry.details?.entryDate,
        description: entry.details?.description
      });
    });

    return stats;
  } catch (error) {
    console.error('[AuditTrail] Failed to generate statistics:', error);
    return {
      totalManualEntries: 0,
      deletedManualEntries: 0,
      usersWithManualEntries: 0,
      byUser: {}
    };
  }
}
