const admin = require('firebase-admin');

/**
 * SEED SCRIPT: Add Akhil Senior Manager
 * 
 * To run:
 * 1. cd functions && npm install
 * 2. cd ..
 * 3. node add_user.js
 * 
 * NOTE: Requires GOOGLE_APPLICATION_CREDENTIALS or gcloud auth.
 */

const PROJECT_ID = 'mprar-6fc1c';

// Use firebase-admin from functions node_modules if not in root
let adminLib;
try {
    adminLib = require('firebase-admin');
} catch (e) {
    try {
        adminLib = require('./functions/node_modules/firebase-admin');
    } catch (e2) {
        console.error('Error: firebase-admin not found. Please run "npm install firebase-admin" or "cd functions && npm install"');
        process.exit(1);
    }
}

if (adminLib.apps.length === 0) {
    adminLib.initializeApp({
        projectId: PROJECT_ID
    });
}

const db = adminLib.firestore();
const auth = adminLib.auth();

const userToAdd = {
    email: 'akhilemployee@gmail.com',
    role: 'seniorManager',
    displayName: 'Akhil Senior Manager',
    password: '123456'
};

async function addUser() {
    console.log(`Starting process for ${userToAdd.email}...`);

    try {
        // 1. Get default company/site for template
        const companySnap = await db.collection('companies').limit(1).get();
        if (companySnap.empty) throw new Error('No company found in DB');
        const companyId = `companies/${companySnap.docs[0].id}`;

        const siteSnap = await db.collection('sites').where('companyId', '==', companyId).limit(1).get();
        const siteId = siteSnap.empty ? null : `sites/${siteSnap.docs[0].id}`;

        if (!siteId) throw new Error(`No site found for company ${companyId}`);

        // 2. Auth User
        let firebaseUser;
        try {
            firebaseUser = await auth.getUserByEmail(userToAdd.email);
            console.log(`   User exists in Auth: ${firebaseUser.uid}`);
        } catch (e) {
            firebaseUser = await auth.createUser({
                email: userToAdd.email,
                password: userToAdd.password,
                displayName: userToAdd.displayName
            });
            console.log(`   Created Auth user: ${firebaseUser.uid}`);
        }

        const uid = firebaseUser.uid;
        const now = adminLib.firestore.FieldValue.serverTimestamp();

        // 3. User Doc
        await db.collection('users').doc(uid).set({
            uid: uid,
            userId: uid,
            email: userToAdd.email,
            displayName: userToAdd.displayName,
            primaryRole: userToAdd.role,
            roles: [userToAdd.role],
            companyId: companyId,
            primaryCompanyId: companyId,
            siteId: siteId,
            status: 'active',
            createdAt: now,
            updatedAt: now,
        }, { merge: true });

        // 4. Company Profile
        const profileRef = db.collection('userCompanyProfiles').doc();
        await profileRef.set({
            userId: uid,
            companyId: companyId,
            status: 'active',
            joinedAt: now,
            createdAt: now,
            updatedAt: now,
            primaryRole: userToAdd.role,
            roles: [userToAdd.role],
            siteId: siteId
        });

        // 5. Link profile
        await db.collection('users').doc(uid).update({
            companyProfiles: adminLib.firestore.FieldValue.arrayUnion(profileRef.id)
        });

        console.log(`✅ Successfully added ${userToAdd.email}`);

    } catch (err) {
        if (err.message.includes('Could not load the default credentials')) {
            console.error('\n❌ AUTH ERROR: No credentials found.');
            console.error('Please run: gcloud auth application-default login');
        } else {
            console.error('Error:', err.message);
        }
    }
}

addUser();
