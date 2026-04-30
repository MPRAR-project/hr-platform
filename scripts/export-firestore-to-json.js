/**
 * Export Firestore data to local JSON files
 * This is useful for creating a local backup before migration
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Initialize Firebase Admin
const serviceAccount = require('../functions/service-account-key.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

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
    'trainings',
    'schedules',
    'shifts',
    'absences',
    'allowances',
    'auditTrail',
    'weekSubmissions'
];

async function exportCollection(collectionName) {
    console.log(`\n📦 Exporting collection: ${collectionName}`);

    const snapshot = await db.collection(collectionName).get();
    const data = [];

    snapshot.forEach(doc => {
        data.push({
            id: doc.id,
            ...doc.data()
        });
    });

    console.log(`   ✓ Found ${data.length} documents`);

    return data;
}

async function backupFirestore() {
    console.log('🚀 Starting Firestore backup...\n');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(__dirname, '..', 'backups', `firestore-backup-${timestamp}`);

    // Create backup directory
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    console.log(`📁 Backup directory: ${backupDir}\n`);

    const backup = {
        timestamp,
        collections: {}
    };

    try {
        // Export each collection
        for (const collectionName of COLLECTIONS) {
            try {
                const data = await exportCollection(collectionName);
                backup.collections[collectionName] = data;

                // Save individual collection file
                const collectionFile = path.join(backupDir, `${collectionName}.json`);
                fs.writeFileSync(collectionFile, JSON.stringify(data, null, 2));

            } catch (error) {
                console.error(`   ✗ Error exporting ${collectionName}:`, error.message);
            }
        }

        // Save complete backup file
        const backupFile = path.join(backupDir, 'complete-backup.json');
        fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));

        // Create summary
        const summary = {
            timestamp,
            totalCollections: Object.keys(backup.collections).length,
            collectionsBackedUp: Object.keys(backup.collections),
            documentCounts: {}
        };

        Object.entries(backup.collections).forEach(([name, docs]) => {
            summary.documentCounts[name] = docs.length;
        });

        const summaryFile = path.join(backupDir, 'backup-summary.json');
        fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));

        console.log('\n✅ Backup completed successfully!');
        console.log('\n📊 Summary:');
        console.log(`   Total collections: ${summary.totalCollections}`);
        console.log(`   Total documents: ${Object.values(summary.documentCounts).reduce((a, b) => a + b, 0)}`);
        console.log(`\n📂 Backup location: ${backupDir}`);

    } catch (error) {
        console.error('\n❌ Backup failed:', error);
        process.exit(1);
    }

    process.exit(0);
}

// Run backup
backupFirestore();
