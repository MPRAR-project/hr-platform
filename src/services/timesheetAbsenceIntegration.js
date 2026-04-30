/**
 * Timesheet Absence Integration Service
 * Handles fetching and mapping approved absences for timesheet display
 */

import { db } from '../firebase/client';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { LEAVE_TYPES } from '../constants/leaveTypes';

/**
 * Get leave type display label from value
 * @param {string} leaveTypeValue - The leave type value (e.g., 'sick_leave')
 * @returns {string} Display label (e.g., 'Sick Leave')
 */
export function getLeaveTypeLabel(leaveTypeValue) {
    const leaveType = LEAVE_TYPES.find(lt => lt.value === leaveTypeValue);
    return leaveType ? leaveType.label : leaveTypeValue;
}

/**
 * Fetch approved absences for a specific week
 * @param {string} userId - The user ID
 * @param {Date} weekStartDate - Start of the week
 * @param {Date} weekEndDate - End of the week
 * @returns {Promise<Map>} Map of date string (YYYY-MM-DD) to absence object
 */
export async function fetchApprovedAbsencesForWeek(userId, weekStartDate, weekEndDate) {
    try {
        // Query all approved absences for the user
        const q = query(
            collection(db, 'absences'),
            where('userId', '==', userId),
            where('status', '==', 'Approved')
        );

        const querySnapshot = await getDocs(q);
        const absencesMap = new Map();

        querySnapshot.forEach((doc) => {
            const absence = {
                id: doc.id,
                ...doc.data()
            };

            // Parse absence dates
            const absenceStartDate = new Date(absence.startDate);
            const absenceEndDate = new Date(absence.endDate);

            // Check if absence overlaps with the week
            if (absenceEndDate >= weekStartDate && absenceStartDate <= weekEndDate) {
                // Generate all dates covered by this absence within the week
                const currentDate = new Date(Math.max(absenceStartDate.getTime(), weekStartDate.getTime()));
                const endDate = new Date(Math.min(absenceEndDate.getTime(), weekEndDate.getTime()));

                while (currentDate <= endDate) {
                    const dateStr = currentDate.toISOString().split('T')[0]; // YYYY-MM-DD format

                    // Store absence data for this date
                    absencesMap.set(dateStr, {
                        id: absence.id,
                        leaveType: absence.leaveType,
                        leaveTypeLabel: getLeaveTypeLabel(absence.leaveType),
                        startDate: absence.startDate,
                        endDate: absence.endDate,
                        reason: absence.reason,
                        status: absence.status
                    });

                    // Move to next day
                    currentDate.setDate(currentDate.getDate() + 1);
                }
            }
        });


        return absencesMap;
    } catch (error) {
        console.error('[AbsenceIntegration] Error fetching absences:', error);
        // Return empty map on error to not break timesheet display
        return new Map();
    }
}

/**
 * Get scheduled hours for a specific day from work schedule
 * @param {Object} workSchedule - Company work schedule
 * @param {string} dayName - Day name (e.g., 'Monday')
 * @returns {number} Scheduled hours in seconds
 */
export function getScheduledHoursForDay(workSchedule, dayName) {
    if (!workSchedule || !workSchedule[dayName]) {
        return 8 * 3600; // Default 8 hours
    }

    const daySchedule = workSchedule[dayName];

    if (!daySchedule.enabled) {
        return 0; // Not a working day
    }

    // Use durationMin if available, otherwise calculate from start/end times
    if (daySchedule.durationMin) {
        return daySchedule.durationMin * 60; // Convert minutes to seconds
    }

    // Fallback: calculate from start and end times
    if (daySchedule.start && daySchedule.end) {
        const [startHour, startMin] = daySchedule.start.split(':').map(Number);
        const [endHour, endMin] = daySchedule.end.split(':').map(Number);

        const startMinutes = startHour * 60 + startMin;
        const endMinutes = endHour * 60 + endMin;
        const durationMinutes = endMinutes - startMinutes;

        return durationMinutes * 60; // Convert to seconds
    }

    return 8 * 3600; // Default 8 hours
}
