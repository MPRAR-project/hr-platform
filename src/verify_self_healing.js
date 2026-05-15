// Verification Script for Self-Healing System
// Run in specific test context if possible

import { reconcileTimesheetForWeek } from './services/timesheets';
import hrApiClient from './lib/hrApiClient';

async function verifySelfHealing() {
    console.log("--- START SELF-HEALING TEST ---");
    const userId = "test_user_heal_1";
    const companyId = "companies/test_company";

    // CLEANUP via REST
    const oldId = `${userId}_2026-01-18`; // Sunday
    const newId = `${userId}_2026-01-20`; // Tuesday
    try {
        await hrApiClient.delete(`/hr/timesheets/${oldId}`);
        await hrApiClient.delete(`/hr/timesheets/${newId}`);
    } catch (err) {}

    // 1. SETUP: Legacy Timesheet (Sun Jan 18 - Sat Jan 24) via REST
    console.log("1. Creating Legacy Data (Sun Jan 18 - Sat Jan 24)...");
    await hrApiClient.post('/hr/timesheets', {
        id: oldId,
        userId, companyId: "test_company",
        period: "2026-01-18",
        startDate: "2026-01-18",
        endDate: "2026-01-24",
        entries: [
            { id: "e1", date: "2026-01-19", grossSec: 3600, effectiveSec: 3600, notes: "Stay" }, // Mon
            { id: "e2", date: "2026-01-21", grossSec: 3600, effectiveSec: 3600, notes: "Move" }  // Wed
        ],
        totals: { grossSec: 7200, effectiveSec: 7200, overtimeSec: 0 }
    });

    // 2. ACTION: Reconcile for NEW Week (Tue Jan 20 - Mon Jan 26)
    // Pretend settings changed to Tuesday
    console.log("2. Running Reconciler for New Week (Tue Jan 20)...");
    const result = await reconcileTimesheetForWeek(
        userId,
        companyId,
        "2026-01-20", // New Week Start
        "tuesday",
        "2026-01-26"  // New Week End
    );

    // 3. VERIFY
    console.log("3. Verifying Results...");

    // Check New Doc
    if (result.id === newId && result._wasCreated) {
        console.log("✅ New Timesheet Created:", result.id);
    } else {
        console.error("❌ Failed to create new timesheet", result);
    }

    if (result._wasMigrated) {
        console.log("✅ Migration Flag set");
    }

    const movedEntry = result.entries.find(e => e.date === "2026-01-21");
    if (movedEntry) {
        console.log("✅ Entry Jan 21 migrated successfully!");
    } else {
        console.error("❌ Entry Jan 21 MISSING in new doc");
    }

    // Check Old Doc (Should not have Jan 21) via REST
    const { data: oldData } = await hrApiClient.get(`/hr/timesheets/${oldId}`);
    const stayedEntry = oldData.entries.find(e => e.date === "2026-01-19");
    const lostEntry = oldData.entries.find(e => e.date === "2026-01-21");

    if (stayedEntry && !lostEntry) {
        console.log("✅ Old doc correctly updated (Jan 19 stayed, Jan 21 gone)");
    } else {
        console.error("❌ Old doc verification failed", { stayedEntry, lostEntry });
    }
}
