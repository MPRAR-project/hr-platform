import hrApiClient from '../lib/hrApiClient';

/**
 * Retroactive Hour Helper Service (Phase 4 — REST Migration)
 * 
 * Provides utilities for handling hours that were logged before a client
 * assignment was created, enabling retroactive association with clients.
 */

/**
 * Get the earliest date with unassigned hours for a user
 */
export async function getEarliestUnassignedEntryDate(userId, companyId = null) {
    try {
        const { data } = await hrApiClient.get(`/hr/timesheets/retroactive/earliest/${userId}`);
        return data.date ? new Date(data.date) : null;
    } catch (error) {
        console.error('[RetroactiveHelper] Error finding earliest unassigned entry:', error);
        return null; 
    }
}

/**
 * Get unassigned hours for a user within a date range
 * NOTE: This is now largely handled by the backend. 
 * We fetch the raw list of entries if needed for specific logic.
 */
export async function getUnassignedHoursForUser(userId, startDateStr, endDateStr) {
    try {
        const { data } = await hrApiClient.get('/hr/time-entries', {
            params: {
                employeeId: userId,
                startDate: startDateStr,
                endDate: endDateStr,
                isUnassigned: true // Backend filter for entries without a timesheet/assignment
            }
        });

        const entries = data.entries || data || [];
        
        let totalBasicHours = 0;
        let totalOvertimeHours = 0;
        const days = {};

        entries.forEach(entry => {
            const hours = (entry.totalMinutes || 0) / 60;
            // Simple split for now, real logic could be more complex
            totalBasicHours += hours; 

            const date = entry.clockIn ? new Date(entry.clockIn).toISOString().slice(0, 10) : 'unknown';
            if (!days[date]) days[date] = { basic: 0, overtime: 0 };
            days[date].basic += hours;
        });

        return {
            totalBasicHours,
            totalOvertimeHours,
            totalHours: totalBasicHours + totalOvertimeHours,
            days,
            entries: entries.map(e => ({
                date: e.clockIn ? new Date(e.clockIn).toISOString().slice(0, 10) : 'unknown',
                hours: (e.totalMinutes || 0) / 60,
                isRetroactive: true
            })),
            hasUnassignedHours: entries.length > 0
        };
    } catch (error) {
        console.error('[RetroactiveHelper] Error getting unassigned hours:', error);
        return { totalHours: 0, entries: [], hasUnassignedHours: false };
    }
}

/**
 * Check if a user has any unassigned hours (quick check)
 */
export async function hasUnassignedHours(userId) {
    const result = await getEarliestUnassignedEntryDate(userId);
    return result !== null;
}

/**
 * Get all users with timesheet hours who are not assigned to any client
 */
export async function getAllUnassignedUsersWithHours(companyId, startDateStr, endDateStr) {
    try {
        const { data } = await hrApiClient.get('/hr/timesheets/retroactive/unassigned-users', {
            params: { startDate: startDateStr, endDate: endDateStr }
        });
        return data || [];
    } catch (error) {
        console.error('[RetroactiveHelper] Error getting unassigned users:', error);
        return [];
    }
}
