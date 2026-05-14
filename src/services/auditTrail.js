import hrApiClient from '../lib/hrApiClient';

/**
 * Log action to audit trail (REST Migration)
 * @param {string} userId - User ID performing the action
 * @param {string} actionType - Type of action
 * @param {string} resourceType - Type of resource
 * @param {string} resourceId - ID of the resource
 * @param {object} details - Additional details
 * @returns {Promise<string>} - ID of the audit log entry
 */
export async function logAuditTrail(userId, actionType, resourceType, resourceId, details = {}) {
  try {
    const { data } = await hrApiClient.post('/hr/audit', {
      action: actionType,
      resource: resourceType,
      resourceId,
      description: details.action || `Action ${actionType} on ${resourceType}`,
      metadata: {
        ...details,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown'
      }
    });

    console.log(`[AuditTrail] ${actionType} logged:`, data.id);
    return data.id;
  } catch (error) {
    console.error('[AuditTrail] Failed to log action:', error);
    return null;
  }
}

/**
 * Log manual timesheet entry
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
      action: 'Manual timesheet entry added'
    }
  );
}

/**
 * Log manual timesheet entry deletion
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
      manualEntries: (manualEntries || []).map(entry => ({
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
 */
export async function getTimesheetAuditTrail(userId, weekStartDate) {
  try {
    const { data } = await hrApiClient.get('/hr/audit', {
      params: {
        actorId: userId,
        resource: 'TIME_ENTRY'
      }
    });
    
    // Filter locally for weekStartDate if needed (or we could add it to the backend params)
    const logs = data.logs || [];
    return logs.filter(log => log.metadata?.weekStartDate === weekStartDate);
  } catch (error) {
    console.error('[AuditTrail] Failed to fetch audit trail:', error);
    return [];
  }
}

/**
 * Get all manual entries for an employee in a date range
 */
export async function getManualEntriesAuditLog(userId, startDate, endDate) {
  try {
    const { data } = await hrApiClient.get('/hr/audit', {
      params: { actorId: userId }
    });

    const logs = data.logs || [];
    return logs.filter(log => {
      const entryDate = log.metadata?.entryDate;
      return entryDate && entryDate >= startDate && entryDate <= endDate;
    });
  } catch (error) {
    console.error('[AuditTrail] Failed to fetch manual entries audit log:', error);
    return [];
  }
}

/**
 * Get audit trail statistics for a company
 */
export async function getManualEntryStatistics(companyId, startDate, endDate) {
  try {
    const { data } = await hrApiClient.get('/hr/audit', {
      params: { limit: 1000 }
    });

    const logs = data.logs || [];
    const entries = logs.filter(log => {
      const entryDate = log.metadata?.entryDate;
      return entryDate && entryDate >= startDate && entryDate <= endDate && 
             ['MANUAL_ENTRY_ADDED', 'MANUAL_ENTRY_DELETED'].includes(log.action);
    });

    const stats = {
      totalManualEntries: entries.filter(e => e.action === 'MANUAL_ENTRY_ADDED').length,
      deletedManualEntries: entries.filter(e => e.action === 'MANUAL_ENTRY_DELETED').length,
      usersWithManualEntries: new Set(entries.map(e => e.actorId)).size,
      byUser: {}
    };

    entries.forEach(entry => {
      const uid = entry.actorId;
      if (!stats.byUser[uid]) {
        stats.byUser[uid] = {
          name: entry.metadata?.createdBy || 'Unknown',
          added: 0,
          deleted: 0,
          entries: []
        };
      }
      if (entry.action === 'MANUAL_ENTRY_ADDED') {
        stats.byUser[uid].added++;
      } else {
        stats.byUser[uid].deleted++;
      }
      stats.byUser[uid].entries.push({
        date: entry.metadata?.entryDate,
        description: entry.metadata?.description
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
