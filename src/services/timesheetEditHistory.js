import hrApiClient from '../lib/hrApiClient';

export async function storeEditHistory(userId, weekStart, date, previousValues, newValues, editedBy, editedByName) {
  try {
    // In the new architecture, the backend should ideally log this automatically during the timesheet update.
    // But if we want to call it explicitly:
    const { data } = await hrApiClient.post('/hr/audit', {
      action: 'timesheet.edit',
      targetType: 'hr_timesheets',
      targetId: userId, // or timesheetId
      description: `Timesheet edited for ${date}`,
      previousData: previousValues,
      newData: newValues
    });
    return data;
  } catch (error) {
    console.error('[timesheetEditHistory] Error storing edit history:', error);
    // Non-fatal for UI
    return { success: false };
  }
}

export async function fetchEditHistory(userId, weekStart) {
  try {
    const { data } = await hrApiClient.get('/hr/audit', {
      params: {
        employeeId: userId,
        targetType: 'hr_timesheets',
        limit: 100
      }
    });
    
    // Filter by weekStart if needed, or assume backend filters by metadata
    const logs = data.logs || [];
    return logs.map(log => ({
      id: log.id,
      userId: log.employeeId,
      weekStart: weekStart, // approximate
      date: log.description?.split('for ')[1] || '',
      previousValues: log.previousData || {},
      newValues: log.newData || {},
      editedBy: log.employeeId,
      editedByName: log.employee ? `${log.employee.firstName} ${log.employee.lastName}` : 'Unknown',
      editedAt: new Date(log.createdAt)
    }));
  } catch (error) {
    console.error('[timesheetEditHistory] Error fetching edit history:', error);
    return [];
  }
}

export async function fetchEditHistoryForDate(userId, date) {
  return fetchEditHistory(userId, null); // Simplified
}

export async function getUserDisplayName(userId) {
    try {
        const { data } = await hrApiClient.get(`/hr/employees/${userId}`);
        return `${data.firstName} ${data.lastName}`;
    } catch {
        return 'Unknown';
    }
}

