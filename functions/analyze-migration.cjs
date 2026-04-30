/**
 * Analyze User Migration - Phase 1
 * 
 * Run from functions directory: node analyze-migration.cjs
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Initialize or reuse existing app
try {
    admin.app();
    console.log('Using existing Firebase app');
} catch {
    admin.initializeApp();
    console.log('Initialized new Firebase app');
}

const db = admin.firestore();

const AFFECTED_COLLECTIONS = {
    assignments: ['employeeId', 'managerId'],
    timesheets: ['userId', 'managerUserId'],
    onboardingApplications: ['userId', 'assignedTo'],
    trainingAssignments: ['userId', 'createdBy'],
    schedules: ['employeeId', 'createdBy'],
    absences: ['employeeId'],
    allowances: ['employeeId', 'createdBy'],
    auditTrail: ['userId'],
    hrOnboardingProfiles: ['userId']
};

async function analyzeUserMigration() {
    console.log('\n🔍 Analyzing User Document ID Migration Scope...\n');

    const results = {
        timestamp: new Date().toISOString(),
        users: {
            total: 0,
            needingMigration: [],
            alreadyMigrated: [],
            errors: []
        },
        affectedDocuments: {},
        summary: {}
    };

    try {
        // Step 1: Analyze users
        console.log('📊 Step 1: Analyzing users collection...');
        const usersSnapshot = await db.collection('users').get();
        results.users.total = usersSnapshot.size;

        for (const doc of usersSnapshot.docs) {
            const data = doc.data();
            const docId = doc.id;
            const uidField = data.uid || data.userId;

            if (!uidField) {
                results.users.errors.push({
                    docId,
                    email: data.email,
                    error: 'No UID field found'
                });
                continue;
            }

            if (docId === uidField) {
                results.users.alreadyMigrated.push({
                    docId,
                    email: data.email
                });
            } else {
                results.users.needingMigration.push({
                    currentDocId: docId,
                    targetDocId: uidField,
                    email: data.email,
                    displayName: data.displayName
                });
            }
        }

        console.log(`   Total: ${results.users.total}`);
        console.log(`   Already migrated: ${results.users.alreadyMigrated.length}`);
        console.log(`   Need migration: ${results.users.needingMigration.length}`);
        console.log(`   Errors: ${results.users.errors.length}\n`);

        // Step 2: Count affected documents
        console.log('📊 Step 2: Counting affected documents...\n');

        const legacyUserIds = new Set(results.users.needingMigration.map(u => u.currentDocId));

        for (const [collectionName, fields] of Object.entries(AFFECTED_COLLECTIONS)) {
            console.log(`   ${collectionName}...`);

            try {
                const snapshot = await db.collection(collectionName).get();
                let affectedCount = 0;

                for (const doc of snapshot.docs) {
                    const data = doc.data();
                    let isAffected = false;

                    for (const field of fields) {
                        const value = data[field];
                        if (!value) continue;

                        const normalized = typeof value === 'string' ? value.replace('users/', '') : value;

                        if (legacyUserIds.has(normalized)) {
                            isAffected = true;
                        }

                        if (Array.isArray(value)) {
                            for (const item of value) {
                                const norm = typeof item === 'string' ? item.replace('users/', '') : item;
                                if (legacyUserIds.has(norm)) isAffected = true;
                            }
                        }
                    }

                    if (isAffected) affectedCount++;
                }

                results.affectedDocuments[collectionName] = {
                    total: snapshot.size,
                    affected: affectedCount
                };

                console.log(`      Total: ${snapshot.size}, Affected: ${affectedCount}`);
            } catch (error) {
                console.error(`      Error: ${error.message}`);
                results.affectedDocuments[collectionName] = { error: error.message };
            }
        }

        console.log('');

        // Summary
        const totalAffected = Object.values(results.affectedDocuments)
            .reduce((sum, coll) => sum + (coll.affected || 0), 0);

        results.summary = {
            usersNeedingMigration: results.users.needingMigration.length,
            usersAlreadyMigrated: results.users.alreadyMigrated.length,
            totalAffectedDocuments: totalAffected,
            estimatedWrites: results.users.needingMigration.length + totalAffected
        };

        // Save report
        const reportDir = path.join(__dirname, '..', 'migration-reports');
        if (!fs.existsSync(reportDir)) {
            fs.mkdirSync(reportDir, { recursive: true });
        }

        const reportFile = path.join(reportDir, `analysis-${Date.now()}.json`);
        fs.writeFileSync(reportFile, JSON.stringify(results, null, 2));

        console.log('📋 SUMMARY');
        console.log('═════════════════════════════════════════');
        console.log(`Users needing migration:    ${results.summary.usersNeedingMigration}`);
        console.log(`Users already migrated:     ${results.summary.usersAlreadyMigrated}`);
        console.log(`Total affected documents:   ${results.summary.totalAffectedDocuments}`);
        console.log(`Estimated database writes:  ${results.summary.estimatedWrites}`);
        console.log('═════════════════════════════════════════\n');

        if (results.users.needingMigration.length > 0) {
            console.log('👥 USERS NEEDING MIGRATION:');
            results.users.needingMigration.forEach((user, i) => {
                console.log(`   ${i + 1}. ${user.email}`);
                console.log(`      Current: ${user.currentDocId}`);
                console.log(`      Target:  ${user.targetDocId}`);
            });
            console.log('');
        }

        console.log(`📁 Report: ${reportFile}\n`);

        return results;

    } catch (error) {
        console.error('❌ Analysis failed:', error);
        throw error;
    }
}

analyzeUserMigration()
    .then(() => {
        console.log('✅ Analysis complete!\n');
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Failed:', error);
        process.exit(1);
    });
