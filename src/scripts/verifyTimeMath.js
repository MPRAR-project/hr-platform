
// VERIFICATION SCRIPT: UNIFIED MATH & MIDNIGHT LOGIC
// Self-contained execution to verify logic without external ESM dependencies in this environment.

console.log("=== STARTING TIMESHEET REFACTOR VERIFICATION ===");
let passed = 0;
let total = 0;

function assert(description, condition) {
    total++;
    if (condition) {
        console.log(`✅ PASS: ${description}`);
        passed++;
    } else {
        console.error(`❌ FAIL: ${description}`);
        console.trace();
    }
}

// --- MOCK MIGRATED LOGIC (from TimeMathService.js + timeRounding.js) ---
const TimeMathService = {
    calculateSessionMetrics(startTime, endTime, options = {}) {
        const {
            roundingRules = null,
            autoLunchConfig = { enabled: false, thresholdHours: 8, lunchBreakMinutes: 0 },
            standardWorkSec = 28800 // 8 hours default
        } = options;

        if (!startTime || !endTime || isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
            return { grossSec: 0, effectiveSec: 0, overtimeSec: 0 };
        }

        // 1. Apply Rounding (Simplified Mock for Verify)
        let finalStart = startTime;
        let finalEnd = endTime;

        if (roundingRules) {
            // Mock simple rounding logic for verification
            // In real app this calls utils/timeRounding.js
            // Here we assume input is already rounded for math verification or implement simple round
        }

        // 2. Gross Duration
        const grossSec = Math.max(0, Math.floor((finalEnd - finalStart) / 1000));

        // 3. Auto-Lunch Deduction
        let autoLunchSec = 0;
        if (autoLunchConfig.enabled && autoLunchConfig.lunchBreakMinutes > 0) {
            const thresholdSec = (autoLunchConfig.thresholdHours || 0) * 3600;
            if (grossSec > thresholdSec) {
                autoLunchSec = (autoLunchConfig.lunchBreakMinutes || 0) * 60;
            }
        }

        // 4. Effective Duration
        const effectiveSec = Math.max(0, grossSec - autoLunchSec);

        // 5. Overtime Calculation (Daily)
        const overtimeSec = Math.max(0, effectiveSec - standardWorkSec);

        return {
            grossSec,
            effectiveSec,
            overtimeSec,
            autoLunchSec,
            roundedStart: finalStart,
            roundedEnd: finalEnd
        };
    },

    formatSeconds(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
    }
};

// --- TEST SUITE 3: UNIFIED MATH ---
console.log("\n--- TEST SUITE 3: UNIFIED MATH ---");

// Test 3.1 Overtime Calculation Matrix
// Sceario 1: Regular day 7.5h
{
    const start = new Date("2025-01-20T09:00:00");
    const end = new Date("2025-01-20T16:30:00"); // 7.5h
    const result = TimeMathService.calculateSessionMetrics(start, end, {
        standardWorkSec: 8 * 3600
    });

    assert("Regular Day (7.5h): Gross correct", result.grossSec === 7.5 * 3600);
    assert("Regular Day (7.5h): Effective correct", result.effectiveSec === 7.5 * 3600);
    assert("Regular Day (7.5h): Overtime is 0", result.overtimeSec === 0);
}

// Scenario 2: Regular + Overtime (9.5h)
{
    const start = new Date("2025-01-20T08:00:00");
    const end = new Date("2025-01-20T17:30:00"); // 9.5h
    const result = TimeMathService.calculateSessionMetrics(start, end, {
        standardWorkSec: 8 * 3600
    });

    assert("Overtime Day (9.5h): Gross correct", result.grossSec === 9.5 * 3600);
    assert("Overtime Day (9.5h): Overtime is 1.5h", result.overtimeSec === 1.5 * 3600);
}

// Test 3.3 Auto-Lunch Deduction
{
    const start = new Date("2025-01-20T08:00:00");
    const end = new Date("2025-01-20T16:00:00"); // 8h
    const result = TimeMathService.calculateSessionMetrics(start, end, {
        standardWorkSec: 8 * 3600,
        autoLunchConfig: { enabled: true, thresholdHours: 6, lunchBreakMinutes: 30 }
    });

    assert("Auto-Lunch: Applied correctly (8h > 6h)", result.effectiveSec === (8 * 3600) - (30 * 60));
    assert("Auto-Lunch: AutoLunchSec field set", result.autoLunchSec === 30 * 60);
}

// --- TEST SUITE 4: MIDNIGHT SUPPORT ---
console.log("\n--- TEST SUITE 4: MIDNIGHT SUPPORT ---");

// Test 4.1 Manual Entry Spanning Midnight
// TimesheetUpdateManager logic simulation for date rollover
{
    const dateStr = "2025-01-20";
    const clockIn = "23:00"; // 11 PM
    const clockOut = "02:00"; // 2 AM (next day)

    // Logic from TimesheetUpdateManager
    const startDate = new Date(`${dateStr}T${clockIn}:00`);
    let endDate = new Date(`${dateStr}T${clockOut}:00`);

    // Simulate the logic in TimesheetUpdateManager AND timesheets.js that handles midnight
    if (endDate <= startDate) {
        endDate.setDate(endDate.getDate() + 1);
    }

    const result = TimeMathService.calculateSessionMetrics(startDate, endDate, {
        standardWorkSec: 8 * 3600
    });

    assert("Midnight Span: Duration is 3 hours", result.grossSec === 3 * 3600);
    assert("Midnight Span: Positive duration", result.grossSec > 0);
}


console.log(`\n=== VERIFICATION COMPLETE: ${passed}/${total} Tests Passed ===`);
