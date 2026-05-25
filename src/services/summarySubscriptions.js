import hrApiClient from '../lib/hrApiClient';
import wsClient from '../lib/wsClient';

/**
 * Subscribe to Weekly Summaries (Phase 6 — WebSocket Activation)
 * 
 * Maps legacy real-time Firestore listeners to the new HR REST API via WebSockets.
 */

export async function subscribeWeeklySummaries(userId, callback) {
    if (!userId) {
        callback([]);
        return () => {};
    }

    const fetchSummaries = async () => {
        try {
            const { data } = await hrApiClient.get('/hr/timesheets', {
                params: { 
                    employeeId: userId,
                    limit: 50
                }
            });

            const timesheets = data.timesheets || data || [];

            const weeklySummaries = timesheets.map(ts => {
                const weekStart = ts.weekStart ? new Date(ts.weekStart).toISOString().slice(0, 10) : '—';
                const weekEnd = ts.weekEnd ? new Date(ts.weekEnd).toISOString().slice(0, 10) : '—';

                // Use backend-stored hour fields (converted to seconds for the UI layer)
                const totalHours    = Number(ts.totalHours    || 0);
                const regularHours  = Number(ts.regularHours  || 0);
                const overtimeHours = Number(ts.overtimeHours || 0);
                
                return {
                    id: ts.id,
                    userId,
                    weekStart,
                    weekEnd,
                    start: weekStart,
                    end: weekEnd,
                    weekKey: `${weekStart}_${weekEnd}`,
                    status: ts.status,
                    totals: {
                        grossSec:     totalHours    * 3600,
                        effectiveSec: totalHours    * 3600,
                        overtimeSec:  overtimeHours * 3600,
                        regularSec:   regularHours  * 3600,
                    },
                    submitted: ts.submittedAt ? new Date(ts.submittedAt).toLocaleString() : '—',
                    approvedByName: ts.approvedBy || null,
                    docIds: [ts.id]
                };
            });

            callback(weeklySummaries);
        } catch (error) {
            console.error('[summarySubscriptions] Failed to fetch weekly summaries:', error);
            callback([]);
        }
    };


    // Initial fetch
    fetchSummaries();

    // Listen for WebSocket events
    const wsHandler = () => fetchSummaries();
    wsClient.on('timesheet:updated', wsHandler);

    return () => wsClient.off('timesheet:updated', wsHandler);
}

/**
 * Extract lightweight summary (Not needed for REST but kept for interface compatibility)
 */
export function extractSummaryFromTimesheet(timesheet) {
    if (!timesheet) return null;
    return {
        weekKey: `${timesheet.weekStart}_${timesheet.weekEnd}`,
        start: timesheet.weekStart,
        end: timesheet.weekEnd,
        status: timesheet.status || 'draft',
        totals: {
            effectiveSec: (timesheet.totalHours || 0) * 3600
        }
    };
}
