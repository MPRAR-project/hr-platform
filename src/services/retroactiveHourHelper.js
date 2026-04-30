import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase/client';
import { formatISODate } from '../utils/dateUtils';

/**
 * Retroactive Hour Helper Service
 * 
 * Provides utilities for handling hours that were logged before a client
 * assignment was created, enabling retroactive association with clients.
 */

/**
 * Get the earliest date with unassigned hours for a user
 * Used to backdate assignment start when client is assigned
 * 
 * @param {string} userId - User ID to check
 * @param {string} companyId - Company ID (optional, for validation)
 * @returns {Promise<Date|null>} Earliest date with unassigned hours, or null if none
 */
export async function getEarliestUnassignedEntryDate(userId, companyId = null) {
    try {
        console.log(`[RetroactiveHelper] Finding earliest unassigned entry for user ${userId}`);

        // Query timesheets for this user
        const tsCol = collection(db, 'timesheets');
        const q = query(
            tsCol,
            where('userId', '==', userId),
            orderBy('period', 'asc'), // Get oldest first
            limit(20) // Check up to 20 timesheets for performance
        );

        const snap = await getDocs(q);

        if (snap.empty) {
            console.log(`[RetroactiveHelper] No timesheets found for user ${userId}`);
            return null;
        }

        let earliestDate = null;

        // Look through timesheet entries for unassigned ones
        for (const doc of snap.docs) {
            const ts = doc.data();
            const entries = ts.entries || [];

            for (const entry of entries) {
                // Check if entry has no assignmentId (unassigned)
                if (!entry.assignmentId && entry.date) {
                    const entryDate = new Date(entry.date);

                    // Track earliest date
                    if (!earliestDate || entryDate < earliestDate) {
                        earliestDate = entryDate;
                    }
                }
            }
        }

        if (earliestDate) {
            console.log(`[RetroactiveHelper] Earliest unassigned entry: ${formatISODate(earliestDate)}`);
        } else {
            console.log(`[RetroactiveHelper] No unassigned entries found for user ${userId}`);
        }

        return earliestDate;

    } catch (error) {
        console.error('[RetroactiveHelper] Error finding earliest unassigned entry:', error);
        return null; // Fail gracefully, don't block assignment creation
    }
}

/**
 * Get unassigned hours for a user within a date range
 * Used by invoice calculations to include retroactive hours
 * 
 * @param {string} userId - User ID
 * @param {string} startDateStr - Start date (ISO string YYYY-MM-DD)
 * @param {string} endDateStr - End date (ISO string YYYY-MM-DD)
 * @returns {Promise<Object>} Object with hours breakdown and entry details
 */
export async function getUnassignedHoursForUser(userId, startDateStr, endDateStr) {
    try {
        console.log(`[RetroactiveHelper] Getting unassigned hours for user ${userId} from ${startDateStr} to ${endDateStr}`);

        const tsCol = collection(db, 'timesheets');

        // Get timesheets that might contain entries in our date range
        const bufferDate = new Date(startDateStr);
        bufferDate.setDate(bufferDate.getDate() - 7);
        const bufferDateStr = formatISODate(bufferDate);

        const q = query(
            tsCol,
            where('userId', '==', userId),
            where('period', '>=', bufferDateStr),
            where('period', '<=', endDateStr)
        );

        const snap = await getDocs(q);

        let totalBasicHours = 0;
        let totalOvertimeHours = 0;
        const days = {};
        const entries = [];

        snap.docs.forEach(doc => {
            const ts = doc.data();

            (ts.entries || []).forEach(entry => {
                // Only include entries in date range AND without assignmentId
                if (entry.date >= startDateStr && entry.date <= endDateStr && !entry.assignmentId) {
                    const gross = (entry.grossSec || 0) / 3600;
                    const overtime = (entry.overtimeSec || 0) / 3600;
                    const effective = (entry.effectiveSec || 0) / 3600;
                    const basic = Math.max(0, effective - overtime);

                    totalBasicHours += basic;
                    totalOvertimeHours += overtime;

                    if (!days[entry.date]) {
                        days[entry.date] = { basic: 0, overtime: 0 };
                    }
                    days[entry.date].basic += basic;
                    days[entry.date].overtime += overtime;

                    entries.push({
                        date: entry.date,
                        basic,
                        overtime,
                        effective,
                        isRetroactive: true
                    });
                }
            });
        });

        const result = {
            totalBasicHours,
            totalOvertimeHours,
            totalHours: totalBasicHours + totalOvertimeHours,
            days,
            entries,
            hasUnassignedHours: entries.length > 0
        };

        if (result.hasUnassignedHours) {
            console.log(`[RetroactiveHelper] Found ${result.totalHours.toFixed(2)} unassigned hours for user ${userId}`);
        }

        return result;

    } catch (error) {
        console.error('[RetroactiveHelper] Error getting unassigned hours:', error);
        return {
            totalBasicHours: 0,
            totalOvertimeHours: 0,
            totalHours: 0,
            days: {},
            entries: [],
            hasUnassignedHours: false
        };
    }
}

/**
 * Check if a user has any unassigned hours (quick check)
 * 
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} True if user has unassigned hours
 */
export async function hasUnassignedHours(userId) {
    const result = await getEarliestUnassignedEntryDate(userId);
    return result !== null;
}

/**
 * Get all users with timesheet hours who are not assigned to any client
 * Used by Invoice Generator to show unassigned users panel
 * 
 * @param {string} companyId - Company ID to scope the query
 * @param {string} startDateStr - Start date (ISO string YYYY-MM-DD)
 * @param {string} endDateStr - End date (ISO string YYYY-MM-DD)
 * @returns {Promise<Array>} Array of users with their hour summaries
 */
export async function getAllUnassignedUsersWithHours(companyId, startDateStr, endDateStr) {
    try {
        // Normalize companyId - strip 'companies/' prefix if present
        const normalizedCompanyId = companyId?.includes('/')
            ? companyId.split('/')[1]
            : companyId;

        console.log(`[RetroactiveHelper] Getting all unassigned users with hours for company ${normalizedCompanyId}`);
        console.log(`[RetroactiveHelper] Date range: ${startDateStr} to ${endDateStr}`);

        // Get timesheets in date range
        const tsCol = collection(db, 'timesheets');
        const bufferDate = new Date(startDateStr);
        bufferDate.setDate(bufferDate.getDate() - 7);
        const bufferDateStr = formatISODate(bufferDate);

        const q = query(
            tsCol,
            where('period', '>=', bufferDateStr),
            where('period', '<=', endDateStr)
        );

        const snap = await getDocs(q);
        console.log(`[RetroactiveHelper] Found ${snap.size} timesheets in range`);

        // Aggregate hours by userId
        const userHours = {};

        snap.docs.forEach(doc => {
            const ts = doc.data();
            const userId = ts.userId;

            (ts.entries || []).forEach(entry => {
                // Only include entries in date range
                if (entry.date >= startDateStr && entry.date <= endDateStr) {
                    if (!userHours[userId]) {
                        userHours[userId] = {
                            userId,
                            totalHours: 0,
                            weeks: new Set()
                        };
                    }

                    const effective = (entry.effectiveSec || 0) / 3600;
                    userHours[userId].totalHours += effective;
                    userHours[userId].weeks.add(ts.period || entry.date?.slice(0, 7));
                }
            });
        });

        console.log(`[RetroactiveHelper] Users with hours in range:`, Object.keys(userHours));

        // Get user details and filter to unassigned ones
        const { collection: coll, getDocs: gd } = await import('firebase/firestore');
        const usersCol = coll(db, 'users');
        const usersSnap = await gd(usersCol);

        const userMap = {};
        usersSnap.docs.forEach(d => {
            userMap[d.id] = { id: d.id, ...d.data() };
        });

        // Build result - only users WITHOUT clientId
        const unassignedUsers = [];

        for (const [userId, hours] of Object.entries(userHours)) {
            const user = userMap[userId];

            // Skip if user not found
            if (!user) {
                console.log(`[RetroactiveHelper] User ${userId} not found in users collection`);
                continue;
            }

            // Skip if user has client assignment
            if (user.clientId) {
                console.log(`[RetroactiveHelper] User ${userId} has clientId: ${user.clientId}, skipping`);
                continue;
            }

            // Also check if user belongs to the company
            const userCompanyId = user.companyId?.includes('/')
                ? user.companyId.split('/')[1]
                : user.companyId;

            if (normalizedCompanyId && userCompanyId !== normalizedCompanyId) {
                console.log(`[RetroactiveHelper] User ${userId} company mismatch: ${userCompanyId} !== ${normalizedCompanyId}`);
                continue;
            }

            console.log(`[RetroactiveHelper] Adding unassigned user:`, { userId, name: user.displayName || user.email, hours: hours.totalHours });

            unassignedUsers.push({
                id: userId,
                name: user.displayName || `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email || 'Unknown',
                email: user.email,
                totalHours: hours.totalHours,
                weekLabel: [...hours.weeks].sort().pop() || '-', // Latest week
                siteId: user.siteId
            });
        }

        console.log(`[RetroactiveHelper] Found ${unassignedUsers.length} unassigned users with hours`);
        return unassignedUsers;

    } catch (error) {
        console.error('[RetroactiveHelper] Error getting unassigned users:', error);
        return [];
    }
}
