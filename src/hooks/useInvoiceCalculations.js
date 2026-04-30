import { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase/client';
import { formatISODate } from '../utils/dateUtils';
import { getUsersByCompany } from '../services/users';
import { getAssignmentsForInvoice } from '../services/userAssignments';


// Helper to resolve rates respecting 0
const resolveRate = (...values) => {
    for (const val of values) {
        if (val !== undefined && val !== null && val !== '') {
            const num = Number(val);
            if (!isNaN(num)) return num;
        }
    }
    return 0; // Default
};

/**
 * DYNAMIC invoice calculations hook
 * Works with or without assignmentId stored in timesheet entries
 * Matches timesheets to assignments based on user + date
 */
export function useInvoiceCalculations(dateRange, currentUser, clientId = null, siteId = null) {
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState({});
    const [error, setError] = useState(null);
    const [retroactiveInfo, setRetroactiveInfo] = useState({ totalHours: 0, userCount: 0, users: [] });

    useEffect(() => {
        async function calculate() {
            if (!dateRange || !dateRange.start || !dateRange.end || !currentUser?.companyId) return;

            setLoading(true);
            setError(null);

            try {
                const { start, end } = dateRange;
                const startDateStr = formatISODate(start);
                const endDateStr = formatISODate(end);

                // Use assignment-based or legacy user-based calculation
                if (clientId) {
                    const { aggregation, retroactive } = await calculateByAssignmentsDynamic(startDateStr, endDateStr, clientId, siteId);
                    setData(aggregation);
                    setRetroactiveInfo(retroactive);
                } else {
                    const userData = await calculateByUsers(startDateStr, endDateStr);
                    setData(userData);
                    setRetroactiveInfo({ totalHours: 0, userCount: 0, users: [] });
                }

            } catch (err) {
                console.error("Invoice Calculation Error:", err);
                setError(err);
            } finally {
                setLoading(false);
            }
        }

        /**
         * DYNAMIC Assignment-Based Calculation
         * Doesn't require assignmentId to be stored - looks it up dynamically!
         */
        async function calculateByAssignmentsDynamic(startDateStr, endDateStr, clientId, siteId) {
            console.log('[useInvoiceCalculations] ========= CALCULATION STARTED =========');
            console.log('[useInvoiceCalculations] Input:', { startDateStr, endDateStr, clientId, siteId });
            console.log('[useInvoiceCalculations] Using DYNAMIC assignment-based calculation for client:', clientId);

            // Get all assignments for this client
            // Ensure we include the full end day for assignment overlap check
            const assignmentQueryEnd = new Date(endDateStr);
            assignmentQueryEnd.setHours(23, 59, 59, 999);

            const assignments = await getAssignmentsForInvoice(
                clientId,
                siteId,
                new Date(startDateStr),
                assignmentQueryEnd
            );

            console.log(`[useInvoiceCalculations] Found ${assignments.length} assignments for client`);
            assignments.forEach(a => console.log('[useInvoiceCalculations] Assignment:', {
                id: a.id,
                userId: a.userId,
                startDate: a.startDate?.toDate?.()?.toISOString?.() || a.startDate
            }));

            // [FIX] REMOVED EARLY RETURN
            // Even if no "Active Assignments" are found for this specific week (e.g. gaps, future starts),
            // we MUST proceed to check timesheets for any billable hours (Retroactive/Unassigned flow).
            // if (assignments.length === 0) { return {}; }

            // Build assignment lookup: userId -> assignment
            const assignmentsByUser = {};
            assignments.forEach(assignment => {
                if (!assignmentsByUser[assignment.userId]) {
                    assignmentsByUser[assignment.userId] = [];
                }
                assignmentsByUser[assignment.userId].push(assignment);
            });

            // Get user details - fetch by user IDs from assignments to ensure all assigned users are included
            // This is more reliable than getUsersByCompany which may filter out some users
            const userIds = [...new Set(assignments.map(a => a.userId))];
            const userMap = {};

            // Fetch users in batches (Firestore has a limit of 10 for 'in' queries)
            const batchSize = 10;
            for (let i = 0; i < userIds.length; i += batchSize) {
                const batch = userIds.slice(i, i + batchSize);
                const usersRef = collection(db, 'users');
                const q = query(usersRef, where('__name__', 'in', batch));
                const snapshot = await getDocs(q);
                snapshot.forEach(doc => {
                    userMap[doc.id] = { id: doc.id, ...doc.data() };
                });
            }
            console.log(`[useInvoiceCalculations] Fetched ${Object.keys(userMap).length} users from ${userIds.length} assignment userIds`);

            // Initialize aggregation for each assignment
            const aggregation = {};
            console.log(`[DEBUG] Building aggregation from ${assignments.length} assignments...`);

            assignments.forEach(assignment => {
                const user = userMap[assignment.userId];
                // console.log(`[DEBUG] Processing assignment ${assignment.id} for user ${assignment.userId}`); // Reduce log spam

                if (!user) {
                    return;
                }

                const rates = {
                    standardPayRate: resolveRate(user.rates?.payBasic, user.rates?.standardPayRate),
                    overtimePayRate: resolveRate(user.rates?.payOvertime, user.rates?.overtimePayRate),
                    standardChargeRate: resolveRate(assignment.chargeRate, user.rates?.chargeBackBasic, user.rates?.standardChargeRate),
                    overtimeChargeRate: resolveRate(assignment.overtimeChargeRate, user.rates?.chargeBackOvertime, user.rates?.overtimeChargeRate)
                };

                if (!aggregation[user.id]) {
                    aggregation[user.id] = {
                        user: {
                            id: user.id,
                            name: user.displayName || 'Unknown',
                            firstName: user.firstName || '',
                            lastName: user.lastName || '',
                            email: user.email || '',
                            role: user.primaryRole || user.role || 'Staff',
                            cisDeduction: user.cisDeduction || 'N/A',
                            utrNumber: user.utrNumber || '',
                            siteId: user.siteId || ''
                        },
                        rates,
                        days: {},
                        totals: {
                            basicHours: 0,
                            overtimeHours: 0,
                            pay: 0,
                            charge: 0
                        },
                        assignmentId: assignment.id,
                        clientId: assignment.clientId
                    };
                }
            });

            console.log(`[DEBUG] Aggregation built with ${Object.keys(aggregation).length} users`);


            // Get timesheets
            // [FIX] Query Range Expansion
            // We must fetch timesheets that might START after the invoice period but contain overlapping entries
            // (e.g. if week settings changed, or "Twin Weeks" exist).
            // We expand the fetch window by +7 days on both sides to be safe.

            const tsCol = collection(db, 'timesheets');

            const bufferStart = new Date(startDateStr);
            bufferStart.setDate(bufferStart.getDate() - 7);
            const bufferStartStr = formatISODate(bufferStart);

            const bufferEnd = new Date(endDateStr);
            bufferEnd.setDate(bufferEnd.getDate() + 7);
            const bufferEndStr = formatISODate(bufferEnd);

            console.log(`[useInvoiceCalculations] Fetching timesheets with period range: ${bufferStartStr} to ${bufferEndStr}`);

            const q = query(
                tsCol,
                where('period', '>=', bufferStartStr),
                where('period', '<=', bufferEndStr)
            );

            const snap = await getDocs(q);
            const timesheets = snap.docs.map(d => d.data());

            console.log(`[useInvoiceCalculations] Processing ${timesheets.length} timesheets`);

            // [FIX] Robust Local Deduplication Strategy
            // We flatten ALL timesheets into a single stream of { ...entry, userId } objects.
            // We use a Set to ignore duplicates (Twin Week overlap) by Session Key or ID.
            const flattenedEntries = [];
            const seenEntryIds = new Set();
            const timesheetUserIds = new Set();

            timesheets.forEach(ts => {
                const uid = ts.userId;
                if (!uid) return;
                timesheetUserIds.add(uid);

                // [FIX] Removed Aggregation Check Optimization
                // We MUST process all entries.

                (ts.entries || []).forEach(entry => {
                    // Use explicit ID or fallback to sessionKey
                    const uniqueId = entry.id || entry.sessionKey || entry.sessionId;

                    // Deduplication Check
                    if (uniqueId && seenEntryIds.has(uniqueId)) {
                        return; // Skip duplicate
                    }
                    if (uniqueId) seenEntryIds.add(uniqueId);

                    // Add to flat list with Context
                    flattenedEntries.push({
                        ...entry,
                        userId: uid // Critical: Carry over parent userId
                    });
                });
            });

            console.log(`[useInvoiceCalculations] Extracted ${flattenedEntries.length} unique entries from ${timesheets.length} timesheets`);

            // [FIX] Ensure we have user details for everyone found in timesheets
            // (Even if they didn't have an active assignment in the initial query)
            const missingUserIds = [...timesheetUserIds].filter(uid => !userMap[uid]);
            if (missingUserIds.length > 0) {
                console.log(`[useInvoiceCalculations] Fetching ${missingUserIds.length} users found in timesheets but missing from assignments`);
                const batchSize = 10;
                for (let i = 0; i < missingUserIds.length; i += batchSize) {
                    const batch = missingUserIds.slice(i, i + batchSize);
                    const usersRef = collection(db, 'users');
                    const q = query(usersRef, where('__name__', 'in', batch));
                    const snapshot = await getDocs(q);
                    snapshot.forEach(doc => {
                        userMap[doc.id] = { id: doc.id, ...doc.data() };
                    });
                }
            }

            // Process each UNIQUE entry - Match to assignment
            const retroactiveData = { totalHours: 0, userCount: 0, users: [] };

            flattenedEntries.forEach(entry => {
                const uid = entry.userId;
                const date = entry.date;
                const user = userMap[uid];

                if (!user) {
                    // Should not happen after fetch above
                    return;
                }

                // Date Boundary Check
                if (date < startDateStr || date > endDateStr) {
                    return;
                }

                // DYNAMIC ASSIGNMENT MATCHING
                const userAssignments = assignmentsByUser[uid] || [];

                const entryDate = new Date(date);
                entryDate.setHours(0, 0, 0, 0);

                const activeAssignment = userAssignments.find(a => {
                    const startDate = a.startDate?.toDate ? a.startDate.toDate() : new Date(a.startDate);
                    startDate.setHours(0, 0, 0, 0);

                    const endDate = a.endDate?.toDate ? a.endDate.toDate() : null;
                    if (endDate) endDate.setHours(23, 59, 59, 999);

                    // Date range check
                    if (entryDate < startDate) return false;
                    if (endDate && entryDate > endDate) return false;

                    // Site filter check
                    if (siteId && a.siteId !== siteId) return false;

                    return true;
                });

                // Calculate Hours
                const gross = (entry.grossSec || 0) / 3600;
                const overtime = (entry.overtimeSec || 0) / 3600;
                const effective = (entry.effectiveSec || 0) / 3600;
                const basic = Math.max(0, effective - overtime);

                // Ensure Aggregation Bucket Exists
                let aggItem = aggregation[uid];

                if (!aggItem) {
                    const rates = {
                        standardPayRate: resolveRate(user.rates?.payBasic, user.rates?.standardPayRate),
                        overtimePayRate: resolveRate(user.rates?.payOvertime, user.rates?.overtimePayRate),
                        standardChargeRate: resolveRate(user.rates?.chargeBackBasic, user.rates?.standardChargeRate), // No assignment rate
                        overtimeChargeRate: resolveRate(user.rates?.chargeBackOvertime, user.rates?.overtimeChargeRate)
                    };

                    aggItem = {
                        user: {
                            id: user.id || uid,
                            name: user.displayName || 'Unknown',
                            firstName: user.firstName || '',
                            lastName: user.lastName || '',
                            email: user.email || '',
                            role: user.primaryRole || user.role || 'Staff',
                            cisDeduction: user.cisDeduction || 'N/A',
                            utrNumber: user.utrNumber || '',
                            siteId: user.siteId || ''
                        },
                        rates,
                        days: {},
                        totals: { basicHours: 0, overtimeHours: 0, pay: 0, charge: 0 },
                        clientId: clientId
                    };

                    aggregation[uid] = aggItem;
                }

                if (activeAssignment) {
                    // Standard Aggregation (Matched Assignment)
                    if (!aggItem.days[date]) {
                        aggItem.days[date] = { basic: 0, overtime: 0 };
                    }

                    aggItem.days[date].basic += basic;
                    aggItem.days[date].overtime += overtime;
                    aggItem.totals.basicHours += basic;
                    aggItem.totals.overtimeHours += overtime;

                } else {
                    // Retroactive / Unassigned Logic
                    if (entry.siteId && siteId && entry.siteId !== siteId) {
                        return; // Explicit site mismatch
                    }

                    if (!aggItem.days[date]) {
                        aggItem.days[date] = { basic: 0, overtime: 0 };
                    }

                    aggItem.days[date].basic += basic;
                    aggItem.days[date].overtime += overtime;
                    aggItem.totals.basicHours += basic;
                    aggItem.totals.overtimeHours += overtime;

                    aggItem.isRetroactive = true;

                    // Stats Tracking
                    retroactiveData.totalHours += effective;
                    let retroUser = retroactiveData.users.find(u => u.id === uid);
                    if (!retroUser) {
                        retroactiveData.userCount++;
                        retroactiveData.users.push({
                            id: uid,
                            name: aggItem.user.name,
                            hours: effective
                        });
                    } else {
                        retroUser.hours += effective;
                    }
                }
            });

            // Calculate pay and charge
            Object.values(aggregation).forEach(item => {
                const { basicHours, overtimeHours } = item.totals;
                const { standardPayRate, overtimePayRate, standardChargeRate, overtimeChargeRate } = item.rates;

                item.totals.pay = (basicHours * standardPayRate) + (overtimeHours * overtimePayRate);
                item.totals.charge = (basicHours * standardChargeRate) + (overtimeHours * overtimeChargeRate);
            });

            // [REMOVED] Redundant Fallback Loop
            // The main loop now captures unassigned hours for any user in the aggregation.
            // No need to query getUnassignedHoursForUser separately.

            if (retroactiveData.userCount > 0) {
                console.log(`[useInvoiceCalculations] Retroactive summary: ${retroactiveData.totalHours.toFixed(2)} hours from ${retroactiveData.userCount} employees`);
            }

            return { aggregation, retroactive: retroactiveData };
        }

        async function calculateByUsers(startDateStr, endDateStr) {
            console.log('[useInvoiceCalculations] Using legacy user-based calculation');

            const allUsers = await getUsersByCompany(currentUser.companyId);
            const staff = allUsers.filter(u => u.role !== 'companyAdmin');

            const aggregation = {};
            staff.forEach(user => {
                const userRates = user.rates || {};
                const rates = {
                    standardPayRate: resolveRate(userRates.payBasic, userRates.standardPayRate),
                    overtimePayRate: resolveRate(userRates.payOvertime, userRates.overtimePayRate),
                    standardChargeRate: resolveRate(userRates.chargeBackBasic, userRates.standardChargeRate),
                    overtimeChargeRate: resolveRate(userRates.chargeBackOvertime, userRates.overtimeChargeRate)
                };

                aggregation[user.id] = {
                    user: {
                        id: user.id,
                        name: user.displayName || 'Unknown',
                        firstName: user.firstName || '',
                        lastName: user.lastName || '',
                        email: user.email || '',
                        role: user.primaryRole || user.role || 'Staff',
                        cisDeduction: user.cisDeduction || 'N/A',
                        utrNumber: user.utrNumber || '',
                        siteId: user.siteId || ''
                    },
                    rates,
                    days: {},
                    totals: {
                        basicHours: 0,
                        overtimeHours: 0,
                        pay: 0,
                        charge: 0
                    }
                };
            });

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
            const timesheets = snap.docs.map(d => d.data());

            timesheets.forEach(ts => {
                const uid = ts.userId;
                if (!aggregation[uid]) return;

                (ts.entries || []).forEach(entry => {
                    const date = entry.date;
                    if (date < startDateStr || date > endDateStr) return;

                    const gross = (entry.grossSec || 0) / 3600;
                    const overtime = (entry.overtimeSec || 0) / 3600;
                    const effective = (entry.effectiveSec || 0) / 3600;
                    const basic = Math.max(0, effective - overtime);

                    if (!aggregation[uid].days[date]) {
                        aggregation[uid].days[date] = { basic: 0, overtime: 0 };
                    }

                    aggregation[uid].days[date].basic = (aggregation[uid].days[date].basic || 0) + basic;
                    aggregation[uid].days[date].overtime = (aggregation[uid].days[date].overtime || 0) + overtime;

                    aggregation[uid].totals.basicHours += basic;
                    aggregation[uid].totals.overtimeHours += overtime;
                });
            });

            Object.values(aggregation).forEach(item => {
                const { basicHours, overtimeHours } = item.totals;
                const { standardPayRate, overtimePayRate, standardChargeRate, overtimeChargeRate } = item.rates;

                item.totals.pay = (basicHours * standardPayRate) + (overtimeHours * overtimePayRate);
                item.totals.charge = (basicHours * standardChargeRate) + (overtimeHours * overtimeChargeRate);
            });

            return aggregation;
        }

        calculate();
    }, [dateRange, currentUser, clientId, siteId]);

    return { data, loading, error, retroactiveInfo };
}
