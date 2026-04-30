// Test month-end week ending calculation
console.log('Testing month-end week ending calculation:\n');

const testDates = [
    '2026-02-21', // February 21 - should show 28-02
    '2026-02-15', // February 15 - should show 28-02  
    '2026-03-10', // March 10 - should show 31-03
    '2026-04-05', // April 5 - should show 30-04
];

testDates.forEach(dateStr => {
    const date = new Date(dateStr);
    const lastDayOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const weekEndingLabel = `${String(lastDayOfMonth.getDate()).padStart(2, '0')}-${String(lastDayOfMonth.getMonth() + 1).padStart(2, '0')}`;
    
    console.log(`${dateStr} → ${weekEndingLabel}`);
});
