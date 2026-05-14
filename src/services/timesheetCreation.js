import hrApiClient from '../lib/hrApiClient';
import { DEFAULT_WEEK_START_DAY, formatISODate } from '../utils/weekStartUtils';

/**
 * Create a blank weekly timesheet for a specific week start date
 * In REST mode, this calls the backend which handles initialization.
 */
export async function createBlankTimesheet(userId, weekStartDate, weekStartDay = DEFAULT_WEEK_START_DAY) {
    try {
        const date = new Date(weekStartDate);
        const weekStart = formatISODate(date);

        const { data } = await hrApiClient.post('/hr/timesheets', {
            employeeId: userId,
            weekStart
        });

        console.log('[createBlankTimesheet] ✓ SUCCESS - Weekly timesheet initialized via REST', data.id);

        return {
            success: true,
            timesheetId: data.id,
            weekStart: data.weekStart,
            weekEnd: data.weekEnd
        };
    } catch (error) {
        console.error('[createBlankTimesheet] ✗ ERROR:', error);
        throw error;
    }
}

/**
 * Fix existing timesheet with incorrect workingDays
 * In REST mode, the backend manages the work schedule synchronization.
 */
export async function fixTimesheetWorkingDays(timesheetId, userId) {
    try {
        // The backend automatically pulls the latest company work schedule
        // so we just trigger a refresh if needed, or assume it's correct.
        const { data } = await hrApiClient.get(`/hr/timesheets/${timesheetId}`);
        return { success: true, updated: false, data };
    } catch (error) {
        console.error('[fixTimesheetWorkingDays] ✗ ERROR:', error);
        return { success: false, updated: false };
    }
}
