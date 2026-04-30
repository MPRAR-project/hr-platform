// Simple firestore backup script
// Run with: node scripts/simple-backup.js

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Initialize (reuses existing app if available)
try {
    admin.app();
} catch {
    admin.initializeApp();
}

const db = admin.firestore();

const COLLECTIONS = [
    'users',
    'companies',
    'sites',
    'assignments',
    'timesheets'
];

async function backup() {
    console.log('🚀 Backing up Firestore...\n');

    const dir = path.join(__dirname, '..', 'backups', `backup-${new Date().toISOString().split('T')[0]}`);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    console.log(`📁 ${dir}\n`);

    for (const col of COLLECTIONS) {
        console.log(`📦 ${col}...`);
        const snap = await db.collection(col).get();
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        fs.writeFileSync(path.join(dir, `${col}.json`), JSON.stringify(data, null, 2));
        console.log(`   ✓ ${data.length} docs\n`);
    }

    console.log('✅ Done!\n');
}

backup().catch(console.error);
