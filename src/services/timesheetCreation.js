import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/client';
import {
    DEFAULT_WEEK_START_DAY,
    formatISODate as formatISODateUtil,
    getWeekRangeForDate
} from '../utils/weekStartUtils';

// Import from timesheets.js
const COLLECTION_NAME = 'timesheets';

// We need to import these functions from timesheets.js
// But to avoid circular dependencies, we'll import them dynamically or define them here
// For now, let's import them properly
import { getTimesheetId, getUserWeekContext } from './timesheets';
import { invalidateTimesheetCache } from './timesheetCache';
import { fetchCompanyDetails } from './companyService';

/**
 * Create a blank weekly timesheet for a specific week start date
 * @param {string} userId - User ID
 * @param {Date|string} weekStartDate - The start date of the week
 * @param {string} weekStartDay - The week start day setting (e.g., 'tuesday', 'monday')
 * @returns {Promise<{success: boolean, timesheetId: string}>}
 */
export async function createBlankTimesheet(userId, weekStartDate, weekStartDay = DEFAULT_WEEK_START_DAY) {
    try {
        console.log('[createBlankTimesheet] Creating blank weekly timesheet', { userId, weekStartDate, weekStartDay });

        if (!userId) {
            throw new Error('User ID is required');
        }

        // Normalize week start date
        const weekStartObj = weekStartDate instanceof Date ? weekStartDate : new Date(weekStartDate);
        if (isNaN(weekStartObj.getTime())) {
            throw new Error('Invalid week start date');
        }
        const weekStartStr = formatISODateUtil(weekStartObj);

        // Get week range
        const { start, end } = getWeekRangeForDate(weekStartObj, weekStartDay);
        const endStr = formatISODateUtil(end);

        // Get user context for company/site info
        const userContext = await getUserWeekContext(userId);
        const { companyIdPath, siteIdPath } = userContext;

        // Fetch company details to get work schedule
        let workingDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']; // Default fallback
        if (companyIdPath) {
            try {
                const companyId = companyIdPath.replace('companies/', '');
                const companyDetails = await fetchCompanyDetails(companyId);
                if (companyDetails?.workSchedule) {
                    workingDays = Object.entries(companyDetails.workSchedule)
                        .filter(([, config]) => config && config.enabled !== false)
                        .map(([day]) => day);
                    console.log('[createBlankTimesheet] Generated workingDays from company schedule:', { companyId, workingDays, workSchedule: companyDetails.workSchedule });
                } else {
                    console.log('[createBlankTimesheet] No workSchedule found, using default workingDays:', workingDays);
                }
            } catch (error) {
                console.warn('[createBlankTimesheet] Failed to fetch company details, using default workingDays:', error);
            }
        } else {
            console.log('[createBlankTimesheet] No companyIdPath found, using default workingDays:', workingDays);
        }

        // Generate timesheet ID using the week start date
        const timesheetId = getTimesheetId(userId, weekStartStr);

        // Create blank weekly timesheet document
        const blankTimesheet = {
            userId,
            companyId: companyIdPath || '',
            siteId: siteIdPath || '',
            period: weekStartStr,
            start: weekStartStr,
            end: endStr,
            weekStartDay: weekStartDay,
            workingDays: workingDays,
            status: 'draft',
            entries: [],
            totals: {
                grossSec: 0,
                effectiveSec: 0,
                overtimeSec: 0
            },
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            submittedAt: null,
            approvedAt: null,
            rejectedAt: null,
            adminNotes: ''
        };

        // Write to Firestore
        const timesheetRef = doc(db, COLLECTION_NAME, timesheetId);
        await setDoc(timesheetRef, blankTimesheet);

        console.log('[createBlankTimesheet] ✓ SUCCESS - Blank weekly timesheet created', timesheetId);

        // Invalidate cache for the entire week
        for (let i = 0; i < 7; i++) {
            const currentDate = new Date(start);
            currentDate.setDate(start.getDate() + i);
            const dateStr = formatISODateUtil(currentDate);
            invalidateTimesheetCache(userId, dateStr);
        }

        return {
            success: true,
            timesheetId,
            weekStart: weekStartStr,
            weekEnd: endStr
        };
    } catch (error) {
        console.error('[createBlankTimesheet] ✗ ERROR:', error);
        throw error;
    }
}

/**
 * Fix existing timesheet with incorrect workingDays by updating it based on company work schedule
 * @param {string} timesheetId - Timesheet ID to fix
 * @param {string} userId - User ID for context
 * @returns {Promise<{success: boolean, updated: boolean}>}
 */
export async function fixTimesheetWorkingDays(timesheetId, userId) {
    try {
        console.log('[fixTimesheetWorkingDays] Fixing workingDays for timesheet:', { timesheetId, userId });

        // Get user context for company info
        const userContext = await getUserWeekContext(userId);
        const { companyIdPath } = userContext;

        if (!companyIdPath) {
            console.log('[fixTimesheetWorkingDays] No companyIdPath found, cannot fix');
            return { success: false, updated: false };
        }

        // Fetch company details to get correct work schedule
        const companyId = companyIdPath.replace('companies/', '');
        const companyDetails = await fetchCompanyDetails(companyId);
        
        if (!companyDetails?.workSchedule) {
            console.log('[fixTimesheetWorkingDays] No workSchedule found, cannot fix');
            return { success: false, updated: false };
        }

        // Generate correct workingDays from company schedule
        const correctWorkingDays = Object.entries(companyDetails.workSchedule)
            .filter(([, config]) => config && config.enabled !== false)
            .map(([day]) => day);

        console.log('[fixTimesheetWorkingDays] Generated correct workingDays:', { 
            companyId, 
            correctWorkingDays, 
            workSchedule: companyDetails.workSchedule 
        });

        // Update the timesheet with correct workingDays
        const timesheetRef = doc(db, COLLECTION_NAME, timesheetId);
        await updateDoc(timesheetRef, {
            workingDays: correctWorkingDays,
            updatedAt: serverTimestamp()
        });

        console.log('[fixTimesheetWorkingDays] ✓ SUCCESS - Timesheet workingDays fixed', timesheetId);

        // Invalidate cache for this timesheet
        invalidateTimesheetCache(userId);

        return { success: true, updated: true };
    } catch (error) {
        console.error('[fixTimesheetWorkingDays] ✗ ERROR:', error);
        return { success: false, updated: false };
    }
}
