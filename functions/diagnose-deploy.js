const fs = require('fs');
const path = require('path');

console.log('--- DIAGNOSTIC START ---');
console.log('CWD:', process.cwd());
console.log('__dirname:', __dirname);

try {
    const index = require('./index.js');
    console.log('✅ index.js required successfully.');
    console.log('Exported Keys:', Object.keys(index));

    ['syncWeeklySummary', 'backfillWeeklySummaries'].forEach(fn => {
        if (index[fn]) {
            console.log(`✅ ${fn} found. Type: ${typeof index[fn]}`);
            if (index[fn].__trigger) {
                console.log(`    Trigger: ${JSON.stringify(index[fn].__trigger)}`);
            }
            if (index[fn].__endpoint) {
                console.log(`    Endpoint: ${JSON.stringify(index[fn].__endpoint)}`);
            }
        } else {
            console.error(`❌ ${fn} NOT FOUND in exports.`);
        }
    });

} catch (error) {
    console.error('❌ CRASH loading index.js');
    console.error(error);
}
console.log('--- DIAGNOSTIC END ---');
