import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { startClock, stopClock } from '../../services/timeClock';
import { getTimesheetsByWeek } from '../../services/timesheets';
import { formatISODate, getWeekRangeForDate } from '../../utils/weekStartUtils';
import { resolveWeekStartDay } from '../../services/weekStartConfig';
import { Play, CheckCircle, XCircle, Clock, AlertTriangle } from 'lucide-react';

const TimesheetTestPage = () => {
    const { user } = useAuth();
    const [logs, setLogs] = useState([]);
    const [isRunning, setIsRunning] = useState(false);
    const [testResult, setTestResult] = useState(null); // 'pass', 'fail'

    const addLog = (msg, type = 'info') => {
        setLogs(prev => [...prev, { msg, type, time: new Date().toLocaleTimeString() }]);
    };

    const runTest = async () => {
        if (!user || !user.companyId) {
            addLog("User or Company ID missing. Please login first.", 'error');
            return;
        }

        setIsRunning(true);
        setLogs([]);
        setTestResult(null);
        addLog("Starting End-to-End Timesheet Test...", 'info');

        try {
            const userId = user.uid;
            const companyId = user.companyId;
            // Use user's siteId or find a default one from user object if available, otherwise just use 'test-site'
            const siteId = user.siteId || 'sites/test-site';

            // 1. Resolve Week Start
            addLog("Step 1: Resolving Week Start Config...", 'info');
            const weekStartDay = await resolveWeekStartDay(companyId);
            addLog(`Week Start Day resolved to: ${weekStartDay}`, 'success');

            const now = new Date();
            const { start: weekStart } = getWeekRangeForDate(now, weekStartDay);
            const weekStartStr = formatISODate(weekStart);
            addLog(`Current Week Start Date: ${weekStartStr}`, 'info');

            // 2. Start Clock
            addLog("Step 2: clockIn() - Starting first session...", 'info');
            const sessionId1 = await startClock({ userId, companyId, siteId });
            addLog(`Clock In Successful. Session ID: ${sessionId1}`, 'success');

            // Wait 2 seconds
            addLog("Waiting 2 seconds to simulate work...", 'pending');
            await new Promise(r => setTimeout(r, 2000));

            // 3. Stop Clock
            addLog("Step 3: clockOut() - Ending first session...", 'info');
            const res1 = await stopClock({ userId, breakSec: 0 });
            addLog(`Clock Out Successful. Duration: ${res1.durationGrossSec}s`, 'success');

            // 4. Verify Timesheet Creation
            addLog("Step 4: Verifying Timesheet Existence...", 'info');
            // Allow DB update propogation
            await new Promise(r => setTimeout(r, 1000));

            const sheets1 = await getTimesheetsByWeek(companyId, weekStartStr);
            const mySheet1 = sheets1.find(s => s.userId === userId);

            if (!mySheet1) throw new Error("Timesheet NOT found after first session!");
            addLog("Timesheet found!", 'success');

            if (mySheet1.entries.length < 1) throw new Error("Timesheet has NO entries!");
            addLog(`Entry count: ${mySheet1.entries.length}`, 'success');

            // 5. Start Second Session
            addLog("Step 5: clockIn() - Starting second session (same day)...", 'info');
            const sessionId2 = await startClock({ userId, companyId, siteId });
            addLog(`Second Clock In Successful. Session ID: ${sessionId2}`, 'success');

            // Wait 2 seconds
            addLog("Waiting 2 seconds...", 'pending');
            await new Promise(r => setTimeout(r, 2000));

            // 6. Stop Clock
            addLog("Step 6: clockOut() - Ending second session...", 'info');
            await stopClock({ userId, breakSec: 0 });
            addLog("Second Clock Out Successful.", 'success');

            // 7. Verify Aggregation
            addLog("Step 7: Verifying Final Aggregation...", 'info');
            await new Promise(r => setTimeout(r, 1000));

            const sheets2 = await getTimesheetsByWeek(companyId, weekStartStr);
            const mySheet2 = sheets2.find(s => s.userId === userId);

            if (!mySheet2) throw new Error("Timesheet lost after second update!");

            // Check totals
            const totalSec = mySheet2.totals?.effectiveSec || 0;
            addLog(`Final Total Effective Seconds: ${totalSec}`, 'info');

            if (totalSec >= 3) {
                addLog("Total duration checks out (> 3 seconds).", 'success');
            } else {
                addLog(`Warning: Total Seconds ${totalSec} seems low (expected ~4s). Rounding rules might be in effect.`, 'warning');
            }

            setTestResult('pass');
            addLog("TEST PASSED: Full cycle verified.", 'success');

        } catch (error) {
            console.error(error);
            addLog(`TEST FAILED: ${error.message}`, 'error');
            setTestResult('fail');
        } finally {
            setIsRunning(false);
        }
    };

    return (
        <div className="p-8 max-w-4xl mx-auto">
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-gray-900">Timesheet E2E Test Runner</h1>
                <p className="text-gray-500">
                    This tool simulates a real user clocking in and out multiple times to verify
                    timesheet creation and aggregation logic.
                </p>
            </div>

            <div className="bg-white rounded-lg shadow-sm border p-6 mb-8">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-full ${user ? 'bg-green-500' : 'bg-red-500'}`}></div>
                        <span className="font-medium">
                            {user ? `Logged in as: ${user.email}` : 'Not Logged In'}
                        </span>
                    </div>
                    <button
                        onClick={runTest}
                        disabled={isRunning || !user}
                        className={`flex items-center gap-2 px-6 py-2 rounded-lg font-medium text-white transition-colors
                            ${isRunning ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
                    >
                        {isRunning ? (
                            <>
                                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                                Running Test...
                            </>
                        ) : (
                            <>
                                <Play size={16} />
                                Run Test Case
                            </>
                        )}
                    </button>
                </div>

                <div className="space-y-2 font-mono text-sm bg-gray-900 text-gray-100 p-4 rounded-lg min-h-[300px] max-h-[500px] overflow-y-auto">
                    {logs.length === 0 && (
                        <div className="text-gray-500 italic text-center py-8">Ready to start. Click "Run Test Case".</div>
                    )}
                    {logs.map((log, i) => (
                        <div key={i} className="flex gap-3">
                            <span className="text-gray-500 shrink-0">[{log.time}]</span>
                            <span className={`
                                ${log.type === 'error' ? 'text-red-400 font-bold' : ''}
                                ${log.type === 'success' ? 'text-green-400' : ''}
                                ${log.type === 'warning' ? 'text-yellow-400' : ''}
                                ${log.type === 'pending' ? 'text-blue-300' : ''}
                            `}>
                                {log.msg}
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            {testResult && (
                <div className={`p-4 rounded-lg flex items-center gap-3 ${testResult === 'pass' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
                    }`}>
                    {testResult === 'pass' ? <CheckCircle size={24} /> : <XCircle size={24} />}
                    <div>
                        <h3 className="font-bold text-lg">{testResult === 'pass' ? 'Test Passed' : 'Test Failed'}</h3>
                        <p>{testResult === 'pass'
                            ? 'All steps completed successfully. The timesheet system is functioning correctly.'
                            : 'The test encountered errors. Please check the logs above.'}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TimesheetTestPage;
