
// VERIFICATION SCRIPT: WEEK START DAY BOUNDARY LOGIC
// Simulates Timesheet Unification logic to prove data persistence across settings changes.

// --- 1. MOCK UTILS (DETERMINISTIC UTC logic) ---
const WeekUtils = {
    formatISODate(date) {
        if (!date) return '';
        return date.toISOString().split('T')[0];
    },

    getWeekRangeForDate(date, weekStartDayName) {
        // Force UTC interpretation
        const d = new Date(date);
        // Example: '2025-01-20' -> '2025-01-20T00:00:00.000Z'

        const dayMap = { 'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3, 'thursday': 4, 'friday': 5, 'saturday': 6 };
        let startDay = dayMap[weekStartDayName.toLowerCase()] ?? 1; // Default Monday

        const day = d.getUTCDay(); // UTC Day of Week
        const diff = (day < startDay) ? (7 - startDay + day) : (day - startDay);

        const start = new Date(d);
        start.setUTCDate(d.getUTCDate() - diff);
        start.setUTCHours(0, 0, 0, 0);

        const end = new Date(start);
        end.setUTCDate(start.getUTCDate() + 6);
        end.setUTCHours(23, 59, 59, 999);

        return { start, end };
    },

    generateWeekKey(date, weekStartDayName) {
        const { start } = this.getWeekRangeForDate(date, weekStartDayName);
        return this.formatISODate(start);
    }
};

// --- 2. MOCK UNIFICATION LOGIC (Inlining from src/services/timesheetUnification.js) ---
function unifyTimesheetsByEntries(allEntries, weekStartDay) {
    if (!allEntries || allEntries.length === 0) return [];

    const weekMap = new Map();

    allEntries.forEach(entry => {
        if (!entry.date) return;

        // Ensure entry.date is treated as UTC
        // Real app might have more complex timezone logic, but for "Date-Only" strings, UTC is the safe transport.
        const entryDate = new Date(entry.date);

        // CRITICAL: Determine bucket based on CURRENT SETTING (weekStartDay)
        const { start, end } = WeekUtils.getWeekRangeForDate(entryDate, weekStartDay);
        const weekKey = WeekUtils.formatISODate(start);

        if (!weekMap.has(weekKey)) {
            weekMap.set(weekKey, {
                weekKey,
                start: WeekUtils.formatISODate(start),
                end: WeekUtils.formatISODate(end),
                entries: [],
                totalHours: 0
            });
        }

        const bin = weekMap.get(weekKey);
        bin.entries.push(entry);
        bin.totalHours += (entry.grossSec || 0) / 3600;
    });

    return Array.from(weekMap.values()).sort((a, b) => b.weekKey.localeCompare(a.weekKey));
}


// --- 3. TEST DATA ---
// Dates in YYYY-MM-DD format (ISO)
const RAW_ENTRIES = [
    { id: 'A', date: '2025-01-21', grossSec: 9 * 3600, label: 'Tuesday Session' }, // Tue Jan 21
    { id: 'B', date: '2025-01-23', grossSec: 4 * 3600, label: 'Thursday Session' }, // Thu Jan 23
    { id: 'C', date: '2025-01-24', grossSec: 4 * 3600, label: 'Friday Night Session' }, // Fri Jan 24
    { id: 'D', date: '2025-01-25', grossSec: 4 * 3600, label: 'Saturday Session' } // Sat Jan 25
];

const BOUNDARY_ENTRIES = [
    { id: 'E', date: '2025-01-20', grossSec: 3 * 3600, label: 'Mon 11pm-Tue 2am' } // Mon Jan 20
];


// --- 4. EXECUTION & ASSERTIONS ---
console.log("=== STARTING WEEK BOUNDARY VERIFICATION ===");
const ALL_TEST_ENTRIES = [...RAW_ENTRIES, ...BOUNDARY_ENTRIES];

let passed = 0;
let total = 0;
function assert(desc, cond) {
    total++;
    if (cond) { console.log(`✅ PASS: ${desc}`); passed++; }
    else { console.error(`❌ FAIL: ${desc}`); }
}

// Scenario 1: Sunday Start (Default)
console.log("\n--- Scenario 1: Week Start = SUNDAY ---");
// Jan 20 (Mon), 21 (Tue), 23 (Thu), 24 (Fri), 25 (Sat)
// All belong to week starting Jan 19 (Sunday).
const unifiedSun = unifyTimesheetsByEntries(ALL_TEST_ENTRIES, 'sunday');
console.log('DEBUG: Unified Sun Keys:', unifiedSun.map(w => w.weekKey));

const weekSun = unifiedSun.find(w => w.weekKey === '2025-01-19');

assert("Week 2025-01-19 exists", !!weekSun);
assert("Week contains 5 entries (A,B,C,D,E)", weekSun && weekSun.entries.length === 5);
assert("Total Hours = 24", weekSun && weekSun.totalHours === 24); // 9+4+4+4+3


// Scenario 2: Tuesday Start (Setting Changed)
console.log("\n--- Scenario 2: Week Start = TUESDAY ---");
// Expectation:
// Week 1: Tue Jan 14 - Mon Jan 20. Should contain E (Jan 20).
// Week 2: Tue Jan 21 - Mon Jan 27. Should contain A, B, C, D (Jan 21-25).
const unifiedTue = unifyTimesheetsByEntries(ALL_TEST_ENTRIES, 'tuesday');
console.log('DEBUG: Unified Tue Keys:', unifiedTue.map(w => w.weekKey));

const weekTue1 = unifiedTue.find(w => w.weekKey === '2025-01-14');
const weekTue2 = unifiedTue.find(w => w.weekKey === '2025-01-21');

assert("Week 1 (Jan 14) exists", !!weekTue1);
assert("Week 1 contains 1 entry (E - Mon Jan 20)", weekTue1 && weekTue1.entries.length === 1 && weekTue1.entries[0].label === 'Mon 11pm-Tue 2am');

assert("Week 2 (Jan 21) exists", !!weekTue2);
assert("Week 2 contains 4 entries (A,B,C,D)", weekTue2 && weekTue2.entries.length === 4);

// Verify Session Integrity
const movedEntry = weekTue2 ? weekTue2.entries.find(e => e.id === 'A') : null;
assert("Entry A moved correctly to Week 2", !!movedEntry);
assert("Entry A data preserved", movedEntry && movedEntry.grossSec === 9 * 3600);


// Scenario 3: Boundary Logic (Visual Verification)
console.log("\n--- Scenario 3: Boundary Logic ---");
assert("Boundary Session E is visible in Week 1", weekTue1 && weekTue1.entries.some(e => e.id === 'E'));


console.log(`\n=== VERIFICATION COMPLETE: ${passed}/${total} Tests Passed ===`);
