/**
 * Analyze User Migration - Phase 1
 * 
 * This script analyzes the current state of user documents and related collections
 * to determine the scope of the migration from random doc IDs to UID-based doc IDs.
 * 
 * Run: cd f:\work\mprar\MPRAR && node scripts/analyze-user-migration.js
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Initialize Firebase Admin
try {
    admin.app();
} catch {
    admin.initializeApp();
}

const db = admin.firestore();

// Collections that store user ID foreign keys
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
    console.log('🔍 Analyzing User Document ID Migration Scope...\n');

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
        // Step 1: Analyze users collection
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
                // Already migrated
                results.users.alreadyMigrated.push({
                    docId,
                    email: data.email,
                    uid: uidField
                });
            } else {
                // Needs migration
                results.users.needingMigration.push({
                    currentDocId: docId,
                    targetDocId: uidField,
                    email: data.email,
                    displayName: data.displayName,
                    companyId: data.companyId,
                    status: data.status
                });
            }
        }

        console.log(`   ✓ Total users: ${results.users.total}`);
        console.log(`   ✓ Already migrated: ${results.users.alreadyMigrated.length}`);
        console.log(`   ✓ Need migration: ${results.users.needingMigration.length}`);
        console.log(`   ✓ Errors: ${results.users.errors.length}\n`);

        // Step 2: Count affected documents in related collections
        console.log('📊 Step 2: Counting affected documents in related collections...\n');

        // Get all legacy user doc IDs
        const legacyUserIds = new Set(results.users.needingMigration.map(u => u.currentDocId));

        for (const [collectionName, fields] of Object.entries(AFFECTED_COLLECTIONS)) {
            console.log(`   Analyzing ${collectionName}...`);

            try {
                const snapshot = await db.collection(collectionName).get();
                let affectedCount = 0;
                const affectedFields = {};

                for (const doc of snapshot.docs) {
                    const data = doc.data();
                    let isAffected = false;

                    for (const field of fields) {
                        const value = data[field];
                        if (!value) continue;

                        // Handle both plain UID and "users/{uid}" format
                        const normalizedValue = typeof value === 'string' ?
                            value.replace('users/', '') : value;

                        if (legacyUserIds.has(normalizedValue)) {
                            isAffected = true;
                            affectedFields[field] = (affectedFields[field] || 0) + 1;
                        }

                        // Also check arrays (like managedEmployees)
                        if (Array.isArray(value)) {
                            for (const item of value) {
                                const normalizedItem = typeof item === 'string' ?
                                    item.replace('users/', '') : item;
                                if (legacyUserIds.has(normalizedItem)) {
                                    isAffected = true;
                                    affectedFields[field] = (affectedFields[field] || 0) + 1;
                                }
                            }
                        }
                    }

                    if (isAffected) affectedCount++;
                }

                results.affectedDocuments[collectionName] = {
                    total: snapshot.size,
                    affected: affectedCount,
                    fieldBreakdown: affectedFields
                };

                console.log(`      Total: ${snapshot.size}, Affected: ${affectedCount}`);
            } catch (error) {
                console.error(`      Error analyzing ${collectionName}:`, error.message);
                results.affectedDocuments[collectionName] = {
                    error: error.message
                };
            }
        }

        console.log('');

        // Step 3: Generate summary
        const totalAffected = Object.values(results.affectedDocuments)
            .reduce((sum, coll) => sum + (coll.affected || 0), 0);

        results.summary = {
            usersNeedingMigration: results.users.needingMigration.length,
            usersAlreadyMigrated: results.users.alreadyMigrated.length,
            totalUsersWithErrors: results.users.errors.length,
            totalAffectedDocuments: totalAffected,
            collectionsAffected: Object.keys(AFFECTED_COLLECTIONS).length,
            estimatedWrites: results.users.needingMigration.length + totalAffected
        };

        // Save results
        const outputDir = path.join(__dirname, '..', 'migration-reports');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const outputFile = path.join(outputDir, `migration-analysis-${Date.now()}.json`);
        fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));

        console.log('📋 SUMMARY');
        console.log('═══════════════════════════════════════════════════');
        console.log(`Users needing migration:     ${results.summary.usersNeedingMigration}`);
        console.log(`Users already migrated:      ${results.summary.usersAlreadyMigrated}`);
        console.log(`Users with errors:           ${results.summary.totalUsersWithErrors}`);
        console.log(`Total affected documents:    ${results.summary.totalAffectedDocuments}`);
        console.log(`Collections affected:        ${results.summary.collectionsAffected}`);
        console.log(`Estimated database writes:   ${results.summary.estimatedWrites}`);
        console.log('═══════════════════════════════════════════════════\n');

        if (results.users.needingMigration.length > 0) {
            console.log('👥 USERS NEEDING MIGRATION:');
            results.users.needingMigration.forEach((user, i) => {
                console.log(`   ${i + 1}. ${user.email}`);
                console.log(`      Current ID: ${user.currentDocId}`);
                console.log(`      Target ID:  ${user.targetDocId}`);
            });
            console.log('');
        }

        if (results.users.errors.length > 0) {
            console.log('⚠️  USERS WITH ERRORS:');
            results.users.errors.forEach((error, i) => {
                console.log(`   ${i + 1}. ${error.email || error.docId}: ${error.error}`);
            });
            console.log('');
        }

        console.log(`📁 Detailed report saved to: ${outputFile}\n`);

        return results;

    } catch (error) {
        console.error('❌ Analysis failed:', error);
        throw error;
    }
}

// Run analysis
analyzeUserMigration()
    .then(() => {
        console.log('✅ Analysis complete!');
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Analysis failed:', error);
        process.exit(1);
    });
