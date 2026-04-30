// Manual Verification Script for Week Start Logic
// Run this in browser console or a temporary node script if firebase env is set up

import { getTimesheetsByWeek, upsertDailyEntry } from './services/timesheets';
import { db } from './firebase/client';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';

async function verifyWeekStartTransition() {
    console.log("--- STARTING VERIFICATION ---");
    const testUserId = "test_user_verify_v1";
    const testCompanyId = "companies/test_company";

    // Clean up previous test data
    await deleteDoc(doc(db, 'timesheets', `${testUserId}_2023-10-22`));
    await deleteDoc(doc(db, 'timesheets', `${testUserId}_2023-10-26`));

    // 1. SETUP: Create a LEAGCY Sunday-based timesheet (Oct 22 - Oct 28)
    // Pretend user was on Sunday schedule.
    console.log("1. Setting up Legacy Data (Sun Oct 22 - Sat Oct 28)...");
    await setDoc(doc(db, 'timesheets', `${testUserId}_2023-10-22`), {
        userId: testUserId,
        companyId: "test_company",
        start: "2023-10-22",
        end: "2023-10-28",
        period: "2023-10-22",
        entries: [
            { date: "2023-10-22", id: "entry_1", notes: "Old Entry Sunday" },
            { date: "2023-10-23", id: "entry_2", notes: "Old Entry Monday" }
        ],
        weekStartDay: "sunday"
    });

    // 2. WRITE TEST (Overlap): User is now on 'Thursday' schedule.
    // Date: Friday Oct 27 (Falls in Old Doc range 22-28, but if new logic applied strictly it would be week 26-01)
    // Expectation: Should write to Old Doc 2023-10-22
    console.log("2. Testing Write: Bridge Day (Oct 27)...");

    // Mock user context (In real app, useAuth provided this. We rely on upsertDailyEntry logic)
    // Note: We need to ensure upsertDailyEntry is called with a date.
    await upsertDailyEntry({
        userId: testUserId,
        companyId: testCompanyId,
        dateStr: "2023-10-27",
        sessionId: "session_bridge_1",
        grossSec: 3600,
        effectiveSec: 3600,
        notes: "Bridge Day Entry"
    });

    // 3. WRITE TEST (New Week): Date Monday Oct 30
    // Old Doc Ends Oct 28. New Schedule Starts Thu Oct 26 -> Ends Nov 1.
    // Expectation: Should create NEW Doc 2023-10-26 (Thursday start)
    console.log("3. Testing Write: New Week Day (Oct 30)...");
    await upsertDailyEntry({
        userId: testUserId,
        companyId: testCompanyId,
        dateStr: "2023-10-30",
        sessionId: "session_new_1",
        grossSec: 3600,
        effectiveSec: 3600,
        notes: "New Week Entry"
    });

    // 4. READ TEST (The View): View Week of Thu Oct 26 - Wed Nov 1
    // Expectation: Get BOTH docs.
    console.log("4. Testing Read: View Week (Oct 26 - Nov 1)...");
    const timesheets = await getTimesheetsByWeek(testCompanyId, "2023-10-26");

    console.log(`Docs Found: ${timesheets.length}`);
    timesheets.forEach(t => {
        console.log(` - Doc ID: ${t.id} | Start: ${t.start} | End: ${t.end} | Entries: ${t.entries?.length}`);
    });

    const hasLegacy = timesheets.find(t => t.id.includes('2023-10-22'));
    const hasNew = timesheets.find(t => t.id.includes('2023-10-26'));

    if (hasLegacy && hasNew) {
        console.log("SUCCESS: Both overlapping docs retrieved!");
    } else {
        console.error("FAILURE: Missing one or both docs.");
    }
}
