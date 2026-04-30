
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/client';
import { formatISODate } from '../utils/weekStartUtils';
import { DEFAULT_WEEK_START_DAY } from '../utils/weekStartUtils';

/**
 * Fetch invoice data for a company for a specific week or date range.
 * Relies on effectiveSec from timesheets and rates from user employment details.
 * 
 * @param {string} companyId - The company ID (e.g. 'companies/123' or '123')
 * @param {Date} weekStartDate - The start of the week/period to report on.
 * @param {Date} weekEndDate - The end of the week/period.
 */
import { getManagedEmployeeIdsForManager } from './teams';

/**
 * Fetch invoice data for a company for a specific week or date range.
 * Relies on effectiveSec from timesheets and rates from user employment details.
 * 
 * @param {string} companyId - The company ID (e.g. 'companies/123' or '123')
 * @param {Date} weekStartDate - The start of the week/period to report on.
 * @param {Date} weekEndDate - The end of the week/period.
 * @param {Object} currentUser - The current user object for RBAC.
 */
export async function getCompanyInvoiceData(companyId, weekStartDate, weekEndDate, currentUser) {
    if (!companyId) return [];

    try {
        const normalizedCompanyId = companyId.includes('/') ? companyId.split('/')[1] : companyId;
        const startStr = formatISODate(weekStartDate);
        const endStr = formatISODate(weekEndDate);

        // Determine access level based on role
        let allowedUserIds = null; // null means ALL users in company

        if (currentUser) {
            const role = currentUser.role;
            const uid = currentUser.userId || currentUser.id;

            // Roles with full company access
            const fullAccessRoles = ['superUser', 'siteManager', 'adminManager', 'adminAdvisor', 'hrManager', 'hrAdvisor'];

            if (fullAccessRoles.includes(role)) {
                allowedUserIds = null; // Can see everyone
            }
            else if (role === 'teamManager') {
                // Fetch team members
                const teamIds = await getManagedEmployeeIdsForManager(uid, normalizedCompanyId);
                // Team Manager sees their team AND themselves
                teamIds.add(uid);
                allowedUserIds = teamIds;
            }
            else {
                // Default to simplified access (only themselves) for 'employee' or unknown roles
                allowedUserIds = new Set([uid]);
            }
        }

        // 1. Fetch all active users for this company to get their rates
        // We fetching ALL users first, because we need rates even if they have no timesheet (though they won't show up in list if 0 hours, usually)
        // Optimization: In a huge system we might want to fetch users found in timesheets, but we need rates which are on user doc.
        const usersCol = collection(db, 'users');
        const userQuery = query(usersCol, where('companyId', '==', normalizedCompanyId), where('status', '==', 'active'));
        const userDocs = await getDocs(userQuery);

        const userMap = new Map();
        userDocs.forEach(doc => {
            // RBAC Filter: Skip if allowedUserIds is set and this user is not in it
            if (allowedUserIds && !allowedUserIds.has(doc.id)) {
                return;
            }

            const data = doc.data();
            const employment = data.employmentDetails || {};
            // Fallback to top level compensation if employment details structure varies (defensive)
            const hourlyRate = parseFloat(employment.hourlyRate || data.hourlyRate || 0);
            const chargeRate = parseFloat(employment.chargeRate || data.chargeRate || 0);

            userMap.set(doc.id, {
                id: doc.id,
                name: data.displayName || `${data.firstName} ${data.lastName}`.trim() || data.email,
                hourlyRate,
                chargeRate,
                email: data.email
            });
        });
        console.log(`[invoiceService] Found ${userMap.size} users for invoice report`);

        // 2. Fetch Timesheets for relevant users
        // Strategy: Instead of one giant query that might miss legacy IDs, we query per user or use a broader fetch.
        // Given we have a filtered list of users (userMap), we can fetch timesheets for these users.
        // To avoid N+1 queries if list is huge, we could do `where('userId', 'in', batch)` but let's stick to parallel fetches for now or a simpler company-wide fetch if index exists.

        // Let's try the company-wide fetch again but with fewer restrictions, then filter in memory for maximum safety.
        // The previous query was: where('companyId', '==', normalizedCompanyId), where('start', '>=', startStr), where('start', '<=', endStr)
        // If 'start' in DB is different from 'startStr' due to week alignment, it might fail.

        // BETTER STRATEGY: Fetch ALL timesheets for this company for the approximate period (with buffer)
        // OR: Query by userId for the specific users we are interested in.

        // Let's go with: Query by Company, but filter looser.
        const tsCol = collection(db, 'timesheets');
        // We'll just query by company. If this is too much data, we'll need composite indexes.
        // Assumption: Client has composite index for companyId + start.
        // We add a buffer to the start/end search to catch timesheets that might overlap
        const searchStart = new Date(weekStartDate);
        searchStart.setDate(searchStart.getDate() - 21); // Increased buffer to 3 weeks just in case
        const searchStartStr = formatISODate(searchStart);

        console.log(`[invoiceService] Querying timesheets for company ${normalizedCompanyId} >= ${searchStartStr}`);

        const tsQuery = query(
            tsCol,
            where('companyId', '==', normalizedCompanyId),
            where('start', '>=', searchStartStr)
            // We don't cap the end too strictly to allow for multi-week sheets if they exist
        );

        const tsDocs = await getDocs(tsQuery);
        console.log(`[invoiceService] Fetched ${tsDocs.size} raw timesheet docs`);

        // 3. Aggregate Data
        const invoiceRows = [];
        const userTimesheetMap = new Map();

        tsDocs.docs.forEach(d => {
            const data = d.data();
            const userId = data.userId;

            // Log a sample for debugging
            if (userTimesheetMap.size === 0) console.log('[invoiceService] Sample Timesheet:', data.id, 'Start:', data.start, 'Entries:', data.entries?.length);

            // Only process timesheets for users we have in our filtered map
            if (userMap.has(userId)) {
                if (!userTimesheetMap.has(userId)) {
                    userTimesheetMap.set(userId, []);
                }
                userTimesheetMap.get(userId).push(data);
            }
        });

        console.log(`[invoiceService] Processing ${userTimesheetMap.size} users with timesheets`);

        // Process each user
        userMap.forEach((user, userId) => {
            const timesheets = userTimesheetMap.get(userId) || [];

            // Initialize counters
            let totalSeconds = 0;
            const dailySeconds = {
                Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0
            };

            timesheets.forEach(ts => {
                // If the timesheet has daily entries, aggregate them
                // We rely on entry.date to determine day of week
                (ts.entries || []).forEach(entry => {
                    // Check if entry date is within requested range
                    if (entry.date >= startStr && entry.date <= endStr) {
                        const date = new Date(entry.date);
                        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' }); // Mon, Tue...

                        // effectiveSec is the payable time
                        // Fallback to grossSec if effectiveSec is missing (defensive)
                        const secs = (typeof entry.effectiveSec === 'number') ? entry.effectiveSec : (entry.grossSec || 0);

                        if (dailySeconds[dayName] !== undefined) {
                            dailySeconds[dayName] += secs;
                        }
                        totalSeconds += secs;
                    }
                });
            });

            // Even if 0 hours, we might want to show them if they are in the list? 
            // The requirement implies "calculate total hours worked", usually implies > 0.
            // But let's only skip if they have absolutely no data found to avoid clutter.
            if (totalSeconds === 0) return;

            const totalHours = totalSeconds / 3600;
            const paidTotal = totalHours * user.hourlyRate;
            const chargeTotal = totalHours * user.chargeRate;

            invoiceRows.push({
                userId: uid,
                name: user.name,
                rates: {
                    hourly: user.hourlyRate,
                    charge: user.chargeRate
                },
                dailyHours: {
                    Mon: dailySeconds.Mon / 3600,
                    Tue: dailySeconds.Tue / 3600,
                    Wed: dailySeconds.Wed / 3600,
                    Thu: dailySeconds.Thu / 3600,
                    Fri: dailySeconds.Fri / 3600,
                    Sat: dailySeconds.Sat / 3600,
                    Sun: dailySeconds.Sun / 3600
                },
                totalHours,
                financials: {
                    paidTotal,
                    chargeTotal,
                    margin: chargeTotal - paidTotal
                }
            });
        });

        invoiceRows.sort((a, b) => a.name.localeCompare(b.name));
        return invoiceRows;

    } catch (error) {
        console.error("Error fetching invoice data:", error);
        throw error;
    }
}
