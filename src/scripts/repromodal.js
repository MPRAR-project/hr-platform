// REPRODUCTION SCRIPT: LEGACY DOC FETCH FAILURE
// Purpose: Proves that strict Point Reads fail to find legacy data that Range Queries find.

// --- 1. MOCK DATA ---
// Legacy Document: Anchored to SUNDAY
const LEGACY_DOC_ID = 'user123_2025-01-19'; // Sunday Jan 19
const LEGACY_DATA = {
    id: LEGACY_DOC_ID,
    userId: 'user123',
    period: '2025-01-19',
    weekStart: '2025-01-19',
    entries: [
        { id: 'e1', date: '2025-01-21', grossSec: 3600 } // Tuesday entry
    ]
};

// --- 2. MOCK FETCH LOGIC (CURRENT BROKEN LOGIC) ---
// Simulates fetchWeekDetails using strict calculation
function fetchUsingPointRead(dateStr) {
    // Current Logic: Always maps to MONDAY if anchor enabled
    // Monday of the week containing Jan 21 is Jan 20.
    const expectedDocId = 'user123_2025-01-20';

    console.log(`[PointRead] Looking for: ${expectedDocId}`);

    if (expectedDocId === LEGACY_DOC_ID) {
        return LEGACY_DATA;
    } else {
        return null; // 404 Not Found
    }
}

// --- 3. MOCK FETCH LOGIC (PROPOSED FIX) ---
// Simulates Range Query
function fetchUsingRangeQuery(dateStr) {
    // Range: Jan 20 to Jan 26
    const queryRange = { start: '2025-01-20', end: '2025-01-26' };

    console.log(`[RangeQuery] Looking for docs overlapping: ${queryRange.start} - ${queryRange.end}`);

    // Legacy Doc Period: 2025-01-19 to 2025-01-25
    // Overlap Check:
    // (DocStart <= RangeEnd) && (DocEnd >= RangeStart)
    const docStart = '2025-01-19';
    const docEnd = '2025-01-25';

    if (docStart <= queryRange.end && docEnd >= queryRange.start) {
        return [LEGACY_DATA]; // Found it!
    }
    return [];
}

// --- 4. EXECUTION ---
console.log("=== STARTING FETCH REPRODUCTION ===");

const targetDate = '2025-01-21'; // Tuesday

// Attempt 1: Current Logic
const result1 = fetchUsingPointRead(targetDate);
if (!result1) {
    console.error("❌ Point Read FAILED: Did not find legacy document.");
} else {
    console.log("✅ Point Read SUCCESS");
}

// Attempt 2: Proposed Logic
const result2 = fetchUsingRangeQuery(targetDate);
if (result2.length > 0) {
    console.log(`✅ Range Query SUCCESS: Found ${result2.length} document(s).`);
    console.log("   Found ID:", result2[0].id);
} else {
    console.error("❌ Range Query FAILED");
}
