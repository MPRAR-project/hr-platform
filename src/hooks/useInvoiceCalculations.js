import { useState, useEffect } from 'react';
import { formatISODate } from '../utils/dateUtils';
import { getUsersByCompany, getUserById } from '../services/users';
import { getAssignmentsForInvoice } from '../services/userAssignments';
import { getTimesheetsInRange } from '../services/timesheets';


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
            console.log('[useInvoiceCalculations] ========= CALCULATION STARTED (REST) =========');
            
            // Get all assignments for this client via REST
            const assignments = await getAssignmentsForInvoice(
                clientId,
                startDateStr,
                endDateStr
            );

            console.log(`[useInvoiceCalculations] Found ${assignments.length} assignments for client`);

            // Build assignment lookup: userId -> assignment
            const assignmentsByUser = {};
            assignments.forEach(assignment => {
                const uid = assignment.userId || assignment.employeeId;
                if (!uid) return;
                if (!assignmentsByUser[uid]) {
                    assignmentsByUser[uid] = [];
                }
                assignmentsByUser[uid].push(assignment);
            });

            // Get user details for assigned users via REST
            const userIds = [...new Set(assignments.map(a => a.userId || a.employeeId))];
            const userMap = {};

            // Fetch users individually or via bulk endpoint if available
            // For now, we'll fetch them in parallel using getUserById
            await Promise.all(userIds.map(async (uid) => {
                if (!uid) return;
                try {
                    const user = await getUserById(uid);
                    if (user) userMap[uid] = user;
                } catch (e) {
                    console.warn(`[useInvoiceCalculations] Failed to fetch user ${uid}`, e);
                }
            }));

            // Initialize aggregation for each assignment
            const aggregation = {};
            assignments.forEach(assignment => {
                const uid = assignment.userId || assignment.employeeId;
                const user = userMap[uid];

                if (!user) return;

                const rates = {
                    standardPayRate: resolveRate(user.rates?.payBasic, user.rates?.standardPayRate),
                    overtimePayRate: resolveRate(user.rates?.payOvertime, user.rates?.overtimePayRate),
                    standardChargeRate: resolveRate(assignment.chargeRate, user.rates?.chargeBackBasic, user.rates?.standardChargeRate),
                    overtimeChargeRate: resolveRate(assignment.overtimeChargeRate, user.rates?.chargeBackOvertime, user.rates?.overtimeChargeRate)
                };

                if (!aggregation[uid]) {
                    aggregation[uid] = {
                        user: {
                            id: uid,
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
                        assignmentId: assignment.id,
                        clientId: assignment.clientId
                    };
                }
            });

            // Get timesheets in range via REST
            const bufferStart = new Date(startDateStr);
            bufferStart.setDate(bufferStart.getDate() - 7);
            const bufferStartStr = formatISODate(bufferStart);

            const bufferEnd = new Date(endDateStr);
            bufferEnd.setDate(bufferEnd.getDate() + 7);
            const bufferEndStr = formatISODate(bufferEnd);

            const timesheets = await getTimesheetsInRange(currentUser.companyId, bufferStartStr, bufferEndStr);

            console.log(`[useInvoiceCalculations] Processing ${timesheets.length} timesheets (REST)`);

            const flattenedEntries = [];
            const seenEntryIds = new Set();
            const timesheetUserIds = new Set();

            timesheets.forEach(ts => {
                const uid = ts.userId || ts.employeeId;
                if (!uid) return;
                timesheetUserIds.add(uid);

                (ts.entries || []).forEach(entry => {
                    const uniqueId = entry.id || entry.sessionId || entry.sessionKey;
                    if (uniqueId && seenEntryIds.has(uniqueId)) return;
                    if (uniqueId) seenEntryIds.add(uniqueId);

                    flattenedEntries.push({ ...entry, userId: uid });
                });
            });

            // Fetch any missing users found in timesheets
            const missingUserIds = [...timesheetUserIds].filter(uid => !userMap[uid]);
            if (missingUserIds.length > 0) {
                await Promise.all(missingUserIds.map(async (uid) => {
                    try {
                        const user = await getUserById(uid);
                        if (user) userMap[uid] = user;
                    } catch (e) {}
                }));
            }

            const retroactiveData = { totalHours: 0, userCount: 0, users: [] };

            flattenedEntries.forEach(entry => {
                const uid = entry.userId;
                const date = entry.date;
                const user = userMap[uid];
                if (!user || date < startDateStr || date > endDateStr) return;

                const userAssignments = assignmentsByUser[uid] || [];
                const entryDate = new Date(date);
                entryDate.setHours(0, 0, 0, 0);

                const activeAssignment = userAssignments.find(a => {
                    const start = new Date(a.startDate);
                    start.setHours(0, 0, 0, 0);
                    const end = a.endDate ? new Date(a.endDate) : new Date(8640000000000000);
                    if (end) end.setHours(23, 59, 59, 999);

                    if (entryDate < start || entryDate > end) return false;
                    if (siteId && a.siteId !== siteId) return false;
                    return true;
                });

                const effective = (entry.effectiveSec || 0) / 3600;
                const overtime = (entry.overtimeSec || 0) / 3600;
                const basic = Math.max(0, effective - overtime);

                let aggItem = aggregation[uid];
                if (!aggItem) {
                    const rates = {
                        standardPayRate: resolveRate(user.rates?.payBasic, user.rates?.standardPayRate),
                        overtimePayRate: resolveRate(user.rates?.payOvertime, user.rates?.overtimePayRate),
                        standardChargeRate: resolveRate(user.rates?.chargeBackBasic, user.rates?.standardChargeRate),
                        overtimeChargeRate: resolveRate(user.rates?.chargeBackOvertime, user.rates?.overtimeChargeRate)
                    };

                    aggItem = {
                        user: {
                            id: uid,
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

                if (!aggItem.days[date]) aggItem.days[date] = { basic: 0, overtime: 0 };
                aggItem.days[date].basic += basic;
                aggItem.days[date].overtime += overtime;
                aggItem.totals.basicHours += basic;
                aggItem.totals.overtimeHours += overtime;

                if (!activeAssignment) {
                    if (entry.siteId && siteId && entry.siteId !== siteId) return;
                    aggItem.isRetroactive = true;
                    retroactiveData.totalHours += effective;
                    let retroUser = retroactiveData.users.find(u => u.id === uid);
                    if (!retroUser) {
                        retroactiveData.userCount++;
                        retroactiveData.users.push({ id: uid, name: aggItem.user.name, hours: effective });
                    } else {
                        retroUser.hours += effective;
                    }
                }
            });

            Object.values(aggregation).forEach(item => {
                const { basicHours, overtimeHours } = item.totals;
                const { standardPayRate, overtimePayRate, standardChargeRate, overtimeChargeRate } = item.rates;
                item.totals.pay = (basicHours * standardPayRate) + (overtimeHours * overtimePayRate);
                item.totals.charge = (basicHours * standardChargeRate) + (overtimeHours * overtimeChargeRate);
            });

            return { aggregation, retroactive: retroactiveData };
        }

        async function calculateByUsers(startDateStr, endDateStr) {
            const staff = await getUsersByCompany(currentUser.companyId);
            const aggregation = {};
            
            staff.forEach(user => {
                const rates = {
                    standardPayRate: resolveRate(user.rates?.payBasic, user.rates?.standardPayRate),
                    overtimePayRate: resolveRate(user.rates?.payOvertime, user.rates?.overtimePayRate),
                    standardChargeRate: resolveRate(user.rates?.chargeBackBasic, user.rates?.standardChargeRate),
                    overtimeChargeRate: resolveRate(user.rates?.chargeBackOvertime, user.rates?.overtimeChargeRate)
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
                    totals: { basicHours: 0, overtimeHours: 0, pay: 0, charge: 0 }
                };
            });

            const bufferDate = new Date(startDateStr);
            bufferDate.setDate(bufferDate.getDate() - 7);
            const timesheets = await getTimesheetsInRange(currentUser.companyId, formatISODate(bufferDate), endDateStr);

            timesheets.forEach(ts => {
                const uid = ts.userId || ts.employeeId;
                if (!aggregation[uid]) return;

                (ts.entries || []).forEach(entry => {
                    const date = entry.date;
                    if (date < startDateStr || date > endDateStr) return;

                    const effective = (entry.effectiveSec || 0) / 3600;
                    const overtime = (entry.overtimeSec || 0) / 3600;
                    const basic = Math.max(0, effective - overtime);

                    if (!aggregation[uid].days[date]) aggregation[uid].days[date] = { basic: 0, overtime: 0 };
                    aggregation[uid].days[date].basic += basic;
                    aggregation[uid].days[date].overtime += overtime;
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
