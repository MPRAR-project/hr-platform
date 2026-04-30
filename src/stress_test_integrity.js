// STRESS TEST: Timesheet Integrity Verification (Volatile Settings)
// Run this in a test environment or browser console console.

import { reconcileTimesheetForWeek } from './services/timesheetReconciler';
import { db } from './firebase/client';
import { doc, setDoc, deleteDoc, getDoc, collection, getDocs, query, where } from 'firebase/firestore';

async function runStressTest() {
    console.log("🔥 STARTING STRESS TEST: Timesheet Integrity 🔥");
    const userId = "stress_test_user_1";
    const companyId = "companies/stress_corp";

    // --- SETUP: CLEAN SLATE ---
    console.log("🧹 Cleanup...");
    const qSnapshot = await getDocs(query(collection(db, 'timesheets'), where('userId', '==', userId)));
    await Promise.all(qSnapshot.docs.map(d => deleteDoc(d.ref)));

    // --- SCENARIO 1: WEEK START = TUESDAY ---
    // EXPECTED:
    // Week A: Jan 13 (Tue) -> Jan 19 (Mon)
    // Week B: Jan 20 (Tue) -> Jan 26 (Mon)

    // ENTRIES:
    // Jan 19 (Mon) -> Should be in Week A (Last Day)
    // Jan 21 (Wed) -> Should be in Week B
    // Jan 23 (Fri) -> Should be in Week B

    console.log("📍 PHASE 1: Week Start = TUESDAY");

    // Create Entry 1 (Jan 19)
    await reconcileTimesheetForWeek(userId, companyId, "2026-01-13", "tuesday", "2026-01-19");
    const entry19 = { id: "e19", date: "2026-01-19", grossSec: 3600, effectiveSec: 3600 };
    await addEntryToRawDoc(userId, "2026-01-13", entry19);

    // Create Entry 2 & 3 (Jan 21, 23)
    await reconcileTimesheetForWeek(userId, companyId, "2026-01-20", "tuesday", "2026-01-26");
    const entry21 = { id: "e21", date: "2026-01-21", grossSec: 7200, effectiveSec: 7200 };
    const entry23 = { id: "e23", date: "2026-01-23", grossSec: 3600, effectiveSec: 3600 };
    await addEntryToRawDoc(userId, "2026-01-20", entry21);
    await addEntryToRawDoc(userId, "2026-01-20", entry23);

    console.log("✅ Phase 1 Data Seeded.");
    await auditData(userId, 3, 14400); // Expect 3 entries, 4 hours total (1+2+1) * 3600 = 14400

    // --- SCENARIO 2: SWITCH TO MONDAY ---
    // EXPECTED:
    // One Unified Week: Jan 19 (Mon) -> Jan 25 (Sun)
    // ALL entries (19, 21, 23) should move here.

    console.log("🔄 PHASE 2: SWITCH TO MONDAY (Transition)");
    const newWeekStart = "2026-01-19"; // Monday
    const newWeekEnd = "2026-01-25";   // Sunday

    // Trigger Self-Healing (Simulate 'Fetch' or 'Upsert')
    const resultMonday = await reconcileTimesheetForWeek(userId, companyId, newWeekStart, "monday", newWeekEnd);

    console.log("🔍 Checking Monday Result:", resultMonday.id);
    const mEntries = resultMonday.entries || [];
    const has19 = mEntries.find(e => e.date === "2026-01-19");
    const has21 = mEntries.find(e => e.date === "2026-01-21");
    const has23 = mEntries.find(e => e.date === "2026-01-23");

    if (has19 && has21 && has23) {
        console.log("✅ SUCCESS: All entries migrated to Unified Monday Week!");
    } else {
        console.error("❌ FAILURE: Missing entries in Monday Week", { has19, has21, has23 });
        console.log("Current Entries:", mEntries);
    }

    await auditData(userId, 3, 14400);

    // --- SCENARIO 3: SWITCH BACK TO TUESDAY ---
    // EXPECTED:
    // Restore Split.
    // Jan 19 -> Moves back to Week A (Jan 13-19)
    // Jan 21, 23 -> Stay/Move to Week B (Jan 20-26)

    console.log("🔄 PHASE 3: SWITCH BACK TO TUESDAY (Revert)");

    // We must trigger healing for BOTH weeks because data is currently in a "Middle" week (Jan 19-25)
    // 1. Heal Week A (Jan 13-19)
    console.log("   -> Healing Week A (Jan 13-19)...");
    const weekA = await reconcileTimesheetForWeek(userId, companyId, "2026-01-13", "tuesday", "2026-01-19");

    // 2. Heal Week B (Jan 20-26)
    console.log("   -> Healing Week B (Jan 20-26)...");
    const weekB = await reconcileTimesheetForWeek(userId, companyId, "2026-01-20", "tuesday", "2026-01-26");

    const aEntries = weekA.entries || [];
    const bEntries = weekB.entries || [];

    const aHas19 = aEntries.find(e => e.date === "2026-01-19");
    const bHas21 = bEntries.find(e => e.date === "2026-01-21");
    const bHas23 = bEntries.find(e => e.date === "2026-01-23");

    if (aHas19 && !bEntries.find(e => e.date === "2026-01-19")) {
        console.log("✅ SUCCESS: Jan 19 returned to Week A");
    } else {
        console.error("❌ FAILURE: Jan 19 failed to return to Week A");
    }

    if (bHas21 && bHas23 && !aEntries.find(e => e.date === "2026-01-21")) {
        console.log("✅ SUCCESS: Jan 21/23 returned to Week B");
    } else {
        console.error("❌ FAILURE: Jan 21/23 failed to return to Week B");
    }

    await auditData(userId, 3, 14400);

    console.log("🏁 STRESS TEST COMPLETE 🏁");
}

// Helper to inject raw data (simulating pre-existing state)
async function addEntryToRawDoc(userId, weekStartStr, entry) {
    const id = `${userId}_${weekStartStr}`;
    const ref = doc(db, 'timesheets', id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return; // Should exist from reconcile
    const data = snap.data();
    const entries = [...(data.entries || []), entry];
    await setDoc(ref, { ...data, entries }, { merge: true });
}

// Global Audit: Sum ALL hours in ALL timesheets for user
async function auditData(userId, expectedCount, expectedSec) {
    const q = query(collection(db, 'timesheets'), where('userId', '==', userId));
    const snap = await getDocs(q);
    let count = 0;
    let sec = 0;

    snap.docs.forEach(d => {
        const data = d.data();
        (data.entries || []).forEach(e => {
            count++;
            sec += (e.effectiveSec || 0);
        });
    });

    if (count === expectedCount && sec === expectedSec) {
        console.log(`🛡️ AUDIT PASS: ${count} entries, ${sec} seconds.`);
    } else {
        console.error(`🛡️ AUDIT FAIL! Expected ${expectedCount}/${expectedSec}, Found ${count}/${sec}`);
        console.log("Dump:", snap.docs.map(d => ({ id: d.id, entries: d.data().entries })));
    }
}
