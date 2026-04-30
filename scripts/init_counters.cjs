const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json'); // User needs to provide this or use default credential

// Initialize app securely
if (!admin.apps.length) {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        admin.initializeApp();
    } else {
        try {
            // Attempt to load from local file, or fall back to default
            // const serviceAccount = require('./serviceAccountKey.json'); 
            // admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
            admin.initializeApp();
        } catch (e) {
            console.log('Using default credentials...');
            admin.initializeApp();
        }
    }
}

const db = admin.firestore();

/**
 * Creates shards for a distributed counter
 */
async function createCounter(refPath, numShards = 10) {
    console.log(`Initializing counter at ${refPath} with ${numShards} shards...`);
    const batch = db.batch();

    // Initialize shards with 0
    for (let i = 0; i < numShards; i++) {
        const shardRef = db.doc(`${refPath}/shards/${i}`);
        batch.set(shardRef, { count: 0 }, { merge: true });
    }

    await batch.commit();
    console.log(`✅ Counter ${refPath} initialized.`);
}

async function main() {
    try {
        console.log('🚀 Starting Counter Initialization...');

        // 1. Total Users Counter
        await createCounter('counters/totalUsers', 20);

        // 2. Total Timesheets Counter (Example)
        await createCounter('counters/totalTimesheets', 20);

        // 3. Active Timesheets Counter
        await createCounter('counters/activeTimesheets', 20);

        console.log('🎉 All counters initialized successfully.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error initializing counters:', error);
        process.exit(1);
    }
}

main();
