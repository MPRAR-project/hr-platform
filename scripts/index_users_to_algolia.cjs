const admin = require('firebase-admin');
const algoliasearch = require('algoliasearch');

// Initialize Firebase
if (!admin.apps.length) {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        admin.initializeApp();
    } else {
        try {
            admin.initializeApp();
        } catch (e) {
            console.log('Using default credentials...');
            admin.initializeApp();
        }
    }
}
const db = admin.firestore();

// ---------------------------------------------------------
// CONFIGURATION
// ---------------------------------------------------------
const ALGOLIA_APP_ID = 'GYXI7HW7AB';
const ALGOLIA_ADMIN_KEY = 'd3fe8832b7730ce5afaa57562de42f6e'; // Needed for writing
const ALGOLIA_INDEX_NAME = 'users';

const client = algoliasearch(ALGOLIA_APP_ID, ALGOLIA_ADMIN_KEY);
const index = client.initIndex(ALGOLIA_INDEX_NAME);

async function indexUsers() {
    console.log('🚀 Starting User Indexing to Algolia...');
    const usersRef = db.collection('users');
    let lastDoc = null;
    let totalIndexed = 0;
    const BATCH_SIZE = 500;

    while (true) {
        let query = usersRef.orderBy(admin.firestore.FieldPath.documentId()).limit(BATCH_SIZE);
        if (lastDoc) {
            query = query.startAfter(lastDoc);
        }

        const snapshot = await query.get();
        if (snapshot.empty) break;

        const records = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            // Select only searchable fields
            records.push({
                objectID: doc.id,
                firstName: data.firstName || '',
                lastName: data.lastName || '',
                email: data.email || '',
                role: data.role || '',
                companyId: data.companyId || '',
                // Add any other fields you want to filter/search by
            });
        });

        if (records.length > 0) {
            await index.saveObjects(records);
            totalIndexed += records.length;
            console.log(`✅ Indexed ${totalIndexed} users so far...`);
        }

        lastDoc = snapshot.docs[snapshot.docs.length - 1];
    }

    console.log(`🎉 Finished! Total users indexed: ${totalIndexed}`);
    process.exit(0);
}

indexUsers().catch(console.error);
