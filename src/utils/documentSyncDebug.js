/**
 * Document Synchronization Debug Tool
 * Use this to test and debug mobile-web document sync issues
 */

import { db } from '../firebase/client';
import { collection, getDocs, query, where, documentId } from 'firebase/firestore';

/**
 * 1️⃣ Check Firestore Collection Consistency
 */
export async function checkCollectionConsistency() {
    console.log('🔍 Checking Firestore Collection Consistency...');
    
    try {
        // Test both potential collection names
        const documentsQuery = query(collection(db, 'documents'));
        const onboardingDocumentsQuery = query(collection(db, 'onboarding-documents'));
        
        const [documentsSnap, onboardingSnap] = await Promise.all([
            getDocs(documentsQuery),
            getDocs(onboardingDocumentsQuery)
        ]);
        
        console.log('📊 Documents collection size:', documentsSnap.size);
        console.log('📊 Onboarding-documents collection size:', onboardingSnap.size);
        
        if (documentsSnap.size > 0) {
            console.log('✅ Documents collection has data');
            documentsSnap.forEach(doc => {
                console.log('📄 Document sample:', doc.id, doc.data());
            });
        }
        
        if (onboardingSnap.size > 0) {
            console.log('✅ Onboarding-documents collection has data');
            onboardingSnap.forEach(doc => {
                console.log('📄 Onboarding document sample:', doc.id, doc.data());
            });
        }
        
        return {
            documentsCollection: documentsSnap.size,
            onboardingDocumentsCollection: onboardingSnap.size,
            recommendation: documentsSnap.size > 0 ? 'Use "documents" collection' : 'Use "onboarding-documents" collection'
        };
    } catch (error) {
        console.error('❌ Error checking collections:', error);
        return { error: error.message };
    }
}

/**
 * 2️⃣ Check Status Filter Consistency
 */
export async function checkStatusFilters(companyId) {
    console.log('🔍 Checking Status Filter Consistency...');
    
    try {
        // Get all documents without status filter
        const allDocsQuery = query(
            collection(db, 'documents'),
            where('companyId', 'in', [companyId, `companies/${companyId}`])
        );
        const allDocsSnap = await getDocs(allDocsQuery);
        
        console.log('📊 Total documents (no status filter):', allDocsSnap.size);
        
        // Check different status values
        const statusCounts = {};
        allDocsSnap.forEach(doc => {
            const status = doc.data().status || 'undefined';
            statusCounts[status] = (statusCounts[status] || 0) + 1;
        });
        
        console.log('📈 Status distribution:', statusCounts);
        
        // Test common status filters
        const commonStatuses = ['uploaded', 'active', 'pending', 'approved'];
        for (const status of commonStatuses) {
            const statusQuery = query(
                collection(db, 'documents'),
                where('companyId', 'in', [companyId, `companies/${companyId}`]),
                where('status', '==', status)
            );
            const statusSnap = await getDocs(statusQuery);
            console.log(`📊 Status "${status}": ${statusSnap.size} documents`);
        }
        
        return {
            totalDocuments: allDocsSnap.size,
            statusDistribution: statusCounts,
            recommendation: Object.keys(statusCounts).length > 0 ? 
                `Use status: "${Object.keys(statusCounts)[0]}"` : 'No status field found'
        };
    } catch (error) {
        console.error('❌ Error checking status filters:', error);
        return { error: error.message };
    }
}

/**
 * 3️⃣ Check Query Filter Issues
 */
export async function checkQueryFilters(companyId, userId) {
    console.log('🔍 Checking Query Filter Issues...');
    
    try {
        // Test different query combinations
        const queries = [
            // 1. Only company filter (safest)
            query(
                collection(db, 'documents'),
                where('companyId', 'in', [companyId, `companies/${companyId}`])
            ),
            // 2. Company + userId
            query(
                collection(db, 'documents'),
                where('companyId', 'in', [companyId, `companies/${companyId}`]),
                where('userId', '==', userId)
            ),
            // 3. Company + userId + status
            query(
                collection(db, 'documents'),
                where('companyId', 'in', [companyId, `companies/${companyId}`]),
                where('userId', '==', userId),
                where('status', '==', 'uploaded')
            )
        ];
        
        const results = [];
        for (let i = 0; i < queries.length; i++) {
            const snap = await getDocs(queries[i]);
            results.push({
                query: `Query ${i + 1}`,
                filters: getQueryDescription(i),
                count: snap.size,
                sample: snap.size > 0 ? snap.docs[0].data() : null
            });
            console.log(`📊 Query ${i + 1}: ${snap.size} documents`);
        }
        
        return {
            queryResults: results,
            recommendation: results[0].count > 0 ? 'Use minimal filters' : 'No documents found'
        };
    } catch (error) {
        console.error('❌ Error checking query filters:', error);
        return { error: error.message };
    }
}

/**
 * 4️⃣ Check Firebase Project Consistency
 */
export function checkFirebaseProject() {
    console.log('🔍 Checking Firebase Project Configuration...');
    
    try {
        const firebaseConfig = {
            projectId: import.meta.env.VITE_FB_PROJECT_ID,
            authDomain: import.meta.env.VITE_FB_AUTH_DOMAIN,
            storageBucket: import.meta.env.VITE_FB_STORAGE_BUCKET
        };
        
        console.log('🔧 Firebase Config:', firebaseConfig);
        
        return {
            projectId: firebaseConfig.projectId,
            authDomain: firebaseConfig.authDomain,
            storageBucket: firebaseConfig.storageBucket,
            recommendation: 'Ensure mobile app uses same projectId'
        };
    } catch (error) {
        console.error('❌ Error checking Firebase config:', error);
        return { error: error.message };
    }
}

/**
 * 5️⃣ Check Storage Path Consistency
 */
export function checkStoragePaths() {
    console.log('🔍 Checking Storage Path Consistency...');
    
    try {
        // Document service uses: employee-documents/${companyId}/${userId}/${documentType}_${timestamp}.${extension}
        // Documents service uses: onboarding-documents/${userId}/${fileName}
        
        const paths = {
            documentService: 'employee-documents/{companyId}/{userId}/{documentType}_{timestamp}.{ext}',
            documentsService: 'onboarding-documents/{userId}/{fileName}'
        };
        
        console.log('📁 Storage paths:', paths);
        
        return {
            paths,
            recommendation: 'Standardize to one path pattern',
            issue: 'Different services use different storage paths'
        };
    } catch (error) {
        console.error('❌ Error checking storage paths:', error);
        return { error: error.message };
    }
}

/**
 * 6️⃣ Test Without Filters (Debug Method)
 */
export async function testWithoutFilters() {
    console.log('🔍 Testing Without Any Filters...');
    
    try {
        const snapshot = await getDocs(collection(db, 'documents'));
        console.log('📊 Total documents in collection:', snapshot.size);
        
        const documents = [];
        snapshot.forEach(doc => {
            documents.push({
                id: doc.id,
                ...doc.data()
            });
            console.log('📄 Document:', doc.id, doc.data());
        });
        
        return {
            totalDocuments: snapshot.size,
            documents: documents,
            recommendation: snapshot.size > 0 ? 
                'Documents exist - check your filters' : 'No documents in collection'
        };
    } catch (error) {
        console.error('❌ Error testing without filters:', error);
        return { error: error.message };
    }
}

/**
 * Helper function to get query description
 */
function getQueryDescription(index) {
    const descriptions = [
        'companyId only',
        'companyId + userId',
        'companyId + userId + status'
    ];
    return descriptions[index];
}

/**
 * Run all checks
 */
export async function runAllChecks(companyId, userId) {
    console.log('🚀 Running All Document Sync Checks...');
    
    const results = {
        collectionConsistency: await checkCollectionConsistency(),
        statusFilters: await checkStatusFilters(companyId),
        queryFilters: await checkQueryFilters(companyId, userId),
        firebaseProject: checkFirebaseProject(),
        storagePaths: checkStoragePaths(),
        testWithoutFilters: await testWithoutFilters()
    };
    
    console.log('📋 Complete Results:', results);
    return results;
}

/**
 * Fix recommendations based on findings
 */
export function getFixRecommendations(results) {
    const recommendations = [];
    
    // Collection consistency
    if (results.collectionConsistency.documentsCollection > 0 && 
        results.collectionConsistency.onboardingDocumentsCollection > 0) {
        recommendations.push('⚠️ Both collections have data - standardize to one');
    }
    
    // Status filters
    if (results.statusFilters.totalDocuments > 0 && 
        Object.keys(results.statusFilters.statusDistribution).length > 1) {
        recommendations.push('⚠️ Multiple status values found - check filter logic');
    }
    
    // Query filters
    if (results.queryFilters.queryResults[0].count > 0 && 
        results.queryFilters.queryResults[2].count === 0) {
        recommendations.push('⚠️ Status filter too restrictive - use broader filter');
    }
    
    // Storage paths
    if (results.storagePaths.issue) {
        recommendations.push('⚠️ Storage paths inconsistent - standardize paths');
    }
    
    return recommendations;
}
