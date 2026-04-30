
// Diagnostic script to simulate overtime calculation
// Run with: node src/diagnose.js

const dateStr = '2025-12-11'; // Thursday
const scheduleDurationHours = 1; // From user settings
const targetSec = scheduleDurationHours * 3600;

// User Data from request
// Entry 1: 09:36 AM - 05:45 PM
// Duration: 8h 9m = 8.15h = 29340s
const entry1 = {
    id: 'e1',
    date: dateStr,
    clockIn: '09:36',
    clockOut: '17:45',
    effectiveSec: 29340, // assume raw duration for now
    startIso: '2025-12-11T09:36:00.000Z'
};

// Entry 2: 03:45 PM - 06:50 PM
// Duration: 3h 5m = 3.08h = 11100s
// Less 30m lunch = 2h 35m = 2.58h = 9300s
const entry2 = {
    id: 'e2',
    date: dateStr,
    clockIn: '15:45',
    clockOut: '18:50',
    effectiveSec: 9300, // 2h 35m
    startIso: '2025-12-11T15:45:00.000Z' // overlap!
};

const entries = [entry1, entry2];

console.log('--- Config ---');
console.log('Target Hours:', scheduleDurationHours);
console.log('Target Seconds:', targetSec);

// Sort (logic from recomputeOvertimeForCompany)
entries.sort((a, b) => a.startIso.localeCompare(b.startIso));

console.log('\n--- Simulation ---');
let runningTotal = 0;
let totalOvertime = 0;

for (const entry of entries) {
    console.log(`\nProcessing Entry ${entry.id} (${entry.clockIn} - ${entry.clockOut})`);
    const eff = entry.effectiveSec;
    console.log(`Effective Sec: ${eff} (${(eff / 3600).toFixed(2)}h)`);

    const previousTotal = runningTotal;
    runningTotal += eff;
    console.log(`Running Total (before this entry): ${previousTotal} (${(previousTotal / 3600).toFixed(2)}h)`);
    console.log(`Running Total (after this entry): ${runningTotal} (${(runningTotal / 3600).toFixed(2)}h)`);

    // Logic from recomputeOvertimeForCompany
    // const normalPortion = Math.min(eff, Math.max(0, targetSec - previousTotal));
    // const overtimePortion = Math.max(0, eff - normalPortion);

    const remainingNormalCapacity = Math.max(0, targetSec - previousTotal);
    console.log(`Remaining Normal Capacity: ${remainingNormalCapacity} (${(remainingNormalCapacity / 3600).toFixed(2)}h)`);

    const normalPortion = Math.min(eff, remainingNormalCapacity);
    const overtimePortion = Math.max(0, eff - normalPortion);

    console.log(`Normal Portion: ${normalPortion} (${(normalPortion / 3600).toFixed(2)}h)`);
    console.log(`Overtime Portion: ${overtimePortion} (${(overtimePortion / 3600).toFixed(2)}h)`);

    totalOvertime += overtimePortion;
}

console.log('\n--- Result ---');
console.log(`Total Overtime: ${totalOvertime} s`);
console.log(`Total Overtime: ${(totalOvertime / 3600).toFixed(2)} h`);

// Expected:
// Entry 1: 8.15h. Target 1h. Normal 1h. Overtime 7.15h.
// Entry 2: 2.58h. Target 1h (exhausted). Normal 0h. Overtime 2.58h.
// Total OT: 9.73h.

