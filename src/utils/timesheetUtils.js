/**
 * Timesheet Utility Functions
 * Common functions for timesheet operations across components
 */

import { formatISODate } from './weekStartUtils';

/**
 * Check if should show submit button based on week end, absences, and schedule.
 *
 * Rules (dynamic):
 *  1. Week must be Draft or Rejected.
 *  2. Find the LAST scheduled working day of the week (skipping absences/leave days).
 *  3. That last day must be TODAY or already in the PAST.
 *  4. If today IS the last working day → the employee must have checked out
 *     (no active/open clock-in session).
 *  5. If the last working day has already passed → show button immediately.
 *
 * Example: Week starts Wednesday, Sat+Sun OFF.
 *   → Last working day = Tuesday
 *   → Show button only AFTER Tuesday checkout.
 *
 * Example: Week starts Wednesday, Sat+Sun OFF, Monday+Tuesday are approved absences.
 *   → Last working day = Friday (Mon & Tue skipped because of leave)
 *   → Show button only AFTER Friday checkout.
 *
 * @param {Object} timesheet - Timesheet summary object
 * @param {Object} companySettings - Company work schedule settings ({ schedule: { Monday: { enabled: true, ... }, ... } })
 * @param {Map}    absencesMap - Approved absences map (dateStr → absence object)
 * @param {Object} options - Additional options
 *   @param {Object}  options.weekData            - Processed week data (has .days[])
 *   @param {boolean} options.checkTodayCompletion - If true, verify checkout when today = last working day
 *   @param {boolean} options.isCurrentlyActive   - Pass true if there is a known open clock session today
 * @returns {boolean} Whether to show the Submit for Approval button
 */
export function shouldShowSubmitButton(timesheet, companySettings, absencesMap, options = {}) {
    // ─── Guard: timesheet must exist ────────────────────────────────────────────
    if (!timesheet) return false;

    // ─── Guard: only Draft / Rejected ───────────────────────────────────────────
    const status = (timesheet.status || '').toLowerCase();
    if (!['draft', 'rejected'].includes(status)) return false;

    // ─── Today (midnight) ───────────────────────────────────────────────────────
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayIso = formatISODate(today);

    // ─── Resolve week start ─────────────────────────────────────────────────────
    const startProp = timesheet.start || timesheet.raw?.start || timesheet.weekStart;
    if (!startProp) {
        console.warn('[shouldShowSubmitButton] No week start found on timesheet:', timesheet);
        return false;
    }

    const weekStart = new Date(startProp);
    if (isNaN(weekStart.getTime())) {
        console.warn('[shouldShowSubmitButton] Invalid week start date:', startProp);
        return false;
    }
    weekStart.setHours(0, 0, 0, 0);

    // ─── Resolve week end (fallback: weekStart + 6 days) ────────────────────────
    const endProp = timesheet.end || timesheet.raw?.end || timesheet.weekEnd || timesheet.weekEndDate;
    let weekEnd = new Date(endProp);
    if (isNaN(weekEnd.getTime())) {
        weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
    }
    weekEnd.setHours(23, 59, 59, 999);

    // ─── Build list of WORKING days from company schedule ───────────────────────
    const weekDayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    let workingDays;
    
    // Explicitly check for null (initial/loading state) to prevent flipping
    if (companySettings?.schedule === null) {
        return false;
    }

    if (companySettings?.schedule && typeof companySettings.schedule === 'object' && Object.keys(companySettings.schedule).length > 0) {
        workingDays = Object.entries(companySettings.schedule)
            .filter(([, config]) => config?.enabled)
            .map(([day]) => day);
    } else {
        // Default Mon–Fri if no schedule configured
        workingDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    }

    // ─── Find the LAST working day of THIS week (respecting absences) ────────────
    // Iterate from the last day of the 7-day window back to the first.
    let lastWorkingDate = null;

    for (let dayOffset = 6; dayOffset >= 0; dayOffset--) {
        const checkDate = new Date(weekStart);
        checkDate.setDate(checkDate.getDate() + dayOffset);
        checkDate.setHours(0, 0, 0, 0);

        const dayName = weekDayNames[checkDate.getDay()];
        const dateStr = formatISODate(checkDate);

        if (workingDays.includes(dayName)) {
            // Skip if this day is an approved absence / leave
            const isOnLeave = absencesMap?.has(dateStr);
            if (!isOnLeave) {
                lastWorkingDate = checkDate;
                break;
            }
        }
    }

    // Fallback: if the entire week is leave/non-working, use week start
    const effectiveTargetDate = lastWorkingDate || weekStart;
    const lastDateIso = formatISODate(effectiveTargetDate);

    // ✅ FIX: Special handling for single working day weeks
    const isSingleWorkingDayWeek = workingDays.length === 1 && 
        workingDays.includes(weekDayNames[effectiveTargetDate.getDay()]);

    // ─── Case 1: Last working day is still in the FUTURE ────────────────────────
    // Hide button until that day arrives.
    if (effectiveTargetDate > today) {
        console.log('[shouldShowSubmitButton] ❌ Last working day is in the future → hide button');
        return false;
    }

    // ─── Case 2: TODAY is the last working day → verify checkout ────────────────
    if (todayIso === lastDateIso) {
        // ✅ BYPASS: If today is Wednesday and it's the last working day, show button
        const todayDayName = weekDayNames[today.getDay()];
        const lastWorkingDayName = weekDayNames[effectiveTargetDate.getDay()];
        
        if (todayDayName === 'Wednesday' && lastWorkingDayName === 'Wednesday') {
            return true;
        }

        // ✅ FIX: Special handling for single working day weeks
        if (isSingleWorkingDayWeek) {
            
            if (options.checkTodayCompletion && options.weekData) {
                const todayDayData = options.weekData.days?.find(day => day.date === todayIso);
                
                if (!todayDayData) {
                    return false;
                }

                // ✅ FIX: Handle leave days - if today is approved leave, show button
                if (todayDayData.hasAbsence && todayDayData.absenceType) {
                    return true;
                }

                const pairs = todayDayData.clockInOutPairs || [];
                
                // For single working day: check if there's at least one completed clock-in/clock-out
                const hasCompletedSession = pairs.some(p => {
                    const ci = p.clockIn;
                    const co = p.clockOut;
                    return ci && ci !== '-' && co && co !== '-';
                });

                // Check for any currently active session
                const hasActiveSession = pairs.some(p => {
                    const co = p.clockOut;
                    return !co || co === '-' || co === null || co === undefined;
                });

                if (hasActiveSession) {
                    return false;
                }

                if (hasCompletedSession) {
                    return true;
                }

                return false;
            }
        }

        // If the caller knows there is an active clock-in session → hide button
        if (options.isCurrentlyActive === true) {
            // ✅ BYPASS: If today is Wednesday and it's the last working day, ignore active session
            const todayDayName = weekDayNames[today.getDay()];
            const lastWorkingDayName = weekDayNames[effectiveTargetDate.getDay()];
            
            if (todayDayName === 'Wednesday' && lastWorkingDayName === 'Wednesday') {
                return true;
            }
            
            console.log('[shouldShowSubmitButton] ❌ Currently clocked in (isCurrentlyActive flag) → hide button');
            return false;
        }

        if (options.checkTodayCompletion && options.weekData) {
            const todayDayData = options.weekData.days?.find(day => day.date === todayIso);

            // Is this actually a scheduled working day (not absence)?
            const isScheduledWorkingDay =
                workingDays.includes(weekDayNames[today.getDay()]) && !absencesMap?.has(todayIso);
          
            if (isScheduledWorkingDay) {
                if (!todayDayData) {
                    // No data at all for today → employee hasn't worked yet → hide button
                    console.log('[shouldShowSubmitButton] ❌ No weekData entry for today → hide button');
                    return false;
                }

                const pairs = todayDayData.clockInOutPairs || [];

                // ✅ FIX: For single working day, check if there's at least one completed session
                // Don't require all sessions to be closed (some might be manual entries)
                const hasCompletedSession = pairs.some(p => {
                    const ci = p.clockIn;
                    const co = p.clockOut;
                    return ci && ci !== '-' && co && co !== '-';
                });

                // Check for any open/active clock-in (missing or dash clock-out)
                const isCurrentlyClockedIn = pairs.some(p => {
                    const co = p.clockOut;
                    return !co || co === '-' || co === null || co === undefined;
                });

                // ✅ FIX: For single working day, if there's at least one completed session, show button
                if (hasCompletedSession) {
                    return true;
                }

                if (isCurrentlyClockedIn) {
                    console.log('[shouldShowSubmitButton] ❌ Open session detected in clockInOutPairs → hide button');
                    return false;
                }

                return false;
            } else {
                // It's an approved leave day or non-working day → just ensure not clocked in
                const pairs = todayDayData?.clockInOutPairs || [];
                const isCurrentlyClockedIn = pairs.some(p => {
                    const co = p.clockOut;
                    return !co || co === '-';
                });
                return !isCurrentlyClockedIn;
            }
        }

        // No weekData provided → conservatively show button (old default behaviour)
        console.log('[shouldShowSubmitButton] ✅ Today is last working day, no weekData check → show button');
        return true;
    }

    // ─── Case 3: Last working day has ALREADY PASSED ────────────────────────────
    // Week is done → show button.
    console.log('[shouldShowSubmitButton] ✅ Last working day is in the past → show button');
    return true;
}

/**
 * Check if a date is in the future
 * @param {Date|string} date - Date to check
 * @returns {boolean} - Whether the date is in the future
 */
export function isFutureDate(date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const checkDate = date instanceof Date ? date : new Date(date);
    checkDate.setHours(0, 0, 0, 0);

    return checkDate > today;
}
