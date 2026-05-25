/**
 * Timesheet Absence Integration Service
 * Handles fetching and mapping approved absences for timesheet display
 */

import hrApiClient, { tokenStore } from '../lib/hrApiClient';
import { refreshAccessToken } from './auth';
import { LEAVE_TYPES } from '../constants/leaveTypes';

/**
 * Get leave type display label from value
 */
export function getLeaveTypeLabel(leaveTypeValue) {
    const leaveType = LEAVE_TYPES.find(lt => lt.value === leaveTypeValue);
    return leaveType ? leaveType.label : (leaveTypeValue || 'Unknown');
}

/**
 * Fetch approved absences for a specific week
 * @param {string} userId - The employee ID
 * @param {Date} weekStartDate - Start of the week
 * @param {Date} weekEndDate - End of the week
 * @returns {Promise<Map>} Map of date string (YYYY-MM-DD) to absence object
 */
export async function fetchApprovedAbsencesForWeek(userId, weekStartDate, weekEndDate) {
    try {
        // Ensure access token exists; attempt refresh if missing to avoid 401s
        if (!tokenStore.getAccess()) {
            await refreshAccessToken();
        }

        // If still no token, bail out with empty map
        if (!tokenStore.getAccess()) return new Map();

        const { data } = await hrApiClient.get('/hr/absences', {
            params: {
                employeeId: userId,
                status: 'approved',
                from: weekStartDate.toISOString().split('T')[0],
                to: weekEndDate.toISOString().split('T')[0]
            }
        });

        const absencesMap = new Map();
        const absences = data.absences || [];

        absences.forEach((absence) => {
            const absenceStartDate = new Date(absence.startDate);
            const absenceEndDate = new Date(absence.endDate);

            // Check if absence overlaps with the week
            if (absenceEndDate >= weekStartDate && absenceStartDate <= weekEndDate) {
                const currentDate = new Date(Math.max(absenceStartDate.getTime(), weekStartDate.getTime()));
                const endDate = new Date(Math.min(absenceEndDate.getTime(), weekEndDate.getTime()));

                while (currentDate <= endDate) {
                    const dateStr = currentDate.toISOString().split('T')[0];
                    absencesMap.set(dateStr, {
                        id: absence.id,
                        leaveType: absence.absenceType,
                        leaveTypeLabel: getLeaveTypeLabel(absence.absenceType),
                        startDate: absence.startDate,
                        endDate: absence.endDate,
                        reason: absence.reason,
                        status: absence.status
                    });
                    currentDate.setDate(currentDate.getDate() + 1);
                }
            }
        });

        return absencesMap;
    } catch (error) {
        console.error('[AbsenceIntegration] Error fetching absences:', error);
        return new Map();
    }
}

/**
 * Get scheduled hours for a specific day from work schedule
 */
export function getScheduledHoursForDay(workSchedule, dayName) {
    if (!workSchedule || !workSchedule[dayName]) {
        return 8 * 3600; 
    }

    const daySchedule = workSchedule[dayName];
    if (!daySchedule.enabled) return 0;

    if (daySchedule.durationMin) return daySchedule.durationMin * 60;

    if (daySchedule.start && daySchedule.end) {
        const [startHour, startMin] = daySchedule.start.split(':').map(Number);
        const [endHour, endMin] = daySchedule.end.split(':').map(Number);
        return ((endHour * 60 + endMin) - (startHour * 60 + startMin)) * 60;
    }

    return 8 * 3600;
}
