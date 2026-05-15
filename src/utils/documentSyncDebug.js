/**
 * Document Synchronization Debug Tool
 * Use this to test and debug mobile-web document sync issues
 */

import hrApiClient from '../lib/hrApiClient';

/**
 * 1️⃣ Check Firestore Collection Consistency
 */
export async function checkCollectionConsistency() {
    console.log('🔍 Checking Firestore Collection Consistency...');
    
    try {
        // Test REST endpoints
        const [docsRes, onboardingRes] = await Promise.all([
            hrApiClient.get('/hr/documents'),
            hrApiClient.get('/hr/onboarding-documents')
        ]);
        
        const docs = docsRes.data.documents || docsRes.data || [];
        const onboardingDocs = onboardingRes.data.documents || onboardingRes.data || [];
        
        console.log('📊 Documents collection size:', docs.length);
        console.log('📊 Onboarding-documents collection size:', onboardingDocs.length);
        
        if (docs.length > 0) {
            console.log('✅ Documents collection has data');
            docs.slice(0, 3).forEach(doc => {
                console.log('📄 Document sample:', doc.id, doc);
            });
        }
        
        if (onboardingDocs.length > 0) {
            console.log('✅ Onboarding-documents collection has data');
            onboardingDocs.slice(0, 3).forEach(doc => {
                console.log('📄 Onboarding document sample:', doc.id, doc);
            });
        }

        return {
            documentsCollection: docs.length,
            onboardingDocumentsCollection: onboardingDocs.length,
            recommendation: docs.length > 0 ? 'Use "documents" collection' : 'Use "onboarding-documents" collection'
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
        // Get all documents without status filter via REST
        const { data } = await hrApiClient.get('/hr/documents', {
            params: { companyId }
        });
        const docs = data.documents || data || [];
        
        console.log('📊 Total documents (no status filter):', docs.length);
        
        // Check different status values
        const statusCounts = {};
        docs.forEach(doc => {
            const status = doc.status || 'undefined';
            statusCounts[status] = (statusCounts[status] || 0) + 1;
        });
        
        console.log('📈 Status distribution:', statusCounts);
        
        // Test common status filters
        const commonStatuses = ['uploaded', 'active', 'pending', 'approved'];
        for (const status of commonStatuses) {
            const { data: sData } = await hrApiClient.get('/hr/documents', {
                params: { companyId, status }
            });
            const sDocs = sData.documents || sData || [];
            console.log(`📊 Status "${status}": ${sDocs.length} documents`);
        }
        
        return {
            totalDocuments: docs.length,
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
        const results = [];
        // 1. Only company filter
        const res1 = await hrApiClient.get('/hr/documents', { params: { companyId } });
        const docs1 = res1.data.documents || res1.data || [];
        results.push({ query: 'Query 1', filters: 'companyId only', count: docs1.length, sample: docs1[0] });

        // 2. Company + userId
        const res2 = await hrApiClient.get('/hr/documents', { params: { companyId, employeeId: userId } });
        const docs2 = res2.data.documents || res2.data || [];
        results.push({ query: 'Query 2', filters: 'companyId + userId', count: docs2.length, sample: docs2[0] });

        // 3. Company + userId + status
        const res3 = await hrApiClient.get('/hr/documents', { params: { companyId, employeeId: userId, status: 'uploaded' } });
        const docs3 = res3.data.documents || res3.data || [];
        results.push({ query: 'Query 3', filters: 'companyId + userId + status', count: docs3.length, sample: docs3[0] });

        results.forEach(r => console.log(`📊 ${r.query}: ${r.count} documents`));
        
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
 * 4️⃣ Check API Configuration
 */
export function checkFirebaseProject() {
    console.log('🔍 Checking API Configuration...');

    try {
        const apiConfig = {
            hrApiUrl: import.meta.env.VITE_HR_API_URL || 'http://localhost:5001',
            wsUrl: import.meta.env.VITE_HR_WS_URL || 'ws://localhost:5001',
        };

        console.log('🔧 API Config:', apiConfig);

        return {
            hrApiUrl: apiConfig.hrApiUrl,
            wsUrl: apiConfig.wsUrl,
            recommendation: 'Ensure mobile app connects to same HR API URL'
        };
    } catch (error) {
        console.error('❌ Error checking API config:', error);
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
        const { data } = await hrApiClient.get('/hr/documents');
        const docs = data.documents || data || [];
        console.log('📊 Total documents in collection:', docs.length);
        
        docs.forEach(doc => {
            console.log('📄 Document:', doc.id, doc);
        });
        
        return {
            totalDocuments: docs.length,
            documents: docs,
            recommendation: docs.length > 0 ? 
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
