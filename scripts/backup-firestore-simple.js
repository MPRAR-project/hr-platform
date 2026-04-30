/**
 * Simple Firestore Backup Script
 * Uses Firebase Admin SDK without requiring service account key file
 * Run this from the functions directory where Firebase is already initialized
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Initialize Firebase Admin (will use default credentials if available)
if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

// Collections to backup
const COLLECTIONS = [
    'users',
    'companies',
    'sites',
    'assignments',
    'timesheets',
    'onboarding',
    'onboardingApplications',
    'trainingAssignments',
    'trainings'
];

async function exportCollection(collectionName) {
    console.log(`📦 Exporting: ${collectionName}`);

    try {
        const snapshot = await db.collection(collectionName).get();
        const data = [];

        snapshot.forEach(doc => {
            const docData = doc.data();
            // Convert timestamps to ISO strings for JSON compatibility
            Object.keys(docData).forEach(key => {
                if (docData[key] && typeof docData[key].toDate === 'function') {
                    docData[key] = docData[key].toDate().toISOString();
                }
            });

            data.push({
                id: doc.id,
                ...docData
            });
        });

        console.log(`   ✓ ${data.length} documents\n`);
        return data;

    } catch (error) {
        console.error(`   ✗ Error: ${error.message}\n`);
        return [];
    }
}

async function backup() {
    console.log('🚀 Starting Firestore backup...\n');

    const timestamp = new Date().toISOString().split('T')[0];
    const backupDir = path.join(__dirname, '..', 'backups', `backup-${timestamp}`);

    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    console.log(`📁 ${backupDir}\n`);

    const results = {};

    for (const collectionName of COLLECTIONS) {
        const data = await exportCollection(collectionName);
        results[collectionName] = data.length;

        // Save collection file
        fs.writeFileSync(
            path.join(backupDir, `${collectionName}.json`),
            JSON.stringify(data, null, 2)
        );
    }

    // Save summary
    const summary = {
        date: timestamp,
        collections: results,
        total: Object.values(results).reduce((a, b) => a + b, 0)
    };

    fs.writeFileSync(
        path.join(backupDir, 'summary.json'),
        JSON.stringify(summary, null, 2)
    );

    console.log('✅ Backup complete!\n');
    console.log('📊 Summary:');
    Object.entries(results).forEach(([name, count]) => {
        console.log(`   ${name}: ${count} documents`);
    });
    console.log(`\n   Total: ${summary.total} documents`);
    console.log(`\n📂 ${backupDir}`);
}

backup().catch(console.error);
