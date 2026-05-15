import React, { useState, useEffect } from 'react';
import { Button } from '../ui/Button';
import { runAllChecks, getFixRecommendations } from '../../utils/documentSyncDebug';
import { useAuth } from '../../hooks/useAuth';

const DocumentSyncDebugger = () => {
  const { user } = useAuth();
  const [debugResults, setDebugResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [recommendations, setRecommendations] = useState([]);

  const companyId = user?.companyId ? (user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId) : null;

  const runDebugChecks = async () => {
    if (!user || !companyId) {
      alert('User or company ID not available');
      return;
    }

    setLoading(true);
    try {
      const results = await runAllChecks(companyId, user.uid);
      setDebugResults(results);
      setRecommendations(getFixRecommendations(results));
    } catch (error) {
      console.error('Debug check failed:', error);
      alert('Debug check failed: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    alert('Copied to clipboard!');
  };

  if (!user) {
    return (
      <div className="p-6 bg-white rounded-lg shadow">
        <h3 className="text-lg font-semibold mb-4">Document Sync Debugger</h3>
        <p>Please log in to use the debugger.</p>
      </div>
    );
  }

  return (
    <div className="p-6 bg-white rounded-lg shadow">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold">🔍 Document Sync Debugger</h3>
        <Button
          onClick={runDebugChecks}
          disabled={loading}
          variant="gradient"
        >
          {loading ? 'Running Checks...' : '🚀 Run All Checks'}
        </Button>
      </div>

      {debugResults && (
        <div className="space-y-6">
          {/* API Configuration Info */}
          <div className="border rounded-lg p-4">
            <h4 className="font-semibold mb-2">🔧 API Configuration</h4>
            <div className="space-y-1 text-sm">
              <p><strong>HR API URL:</strong> {debugResults.firebaseProject.hrApiUrl}</p>
              <p><strong>WebSocket URL:</strong> {debugResults.firebaseProject.wsUrl}</p>
              <p className="text-gray-600">{debugResults.firebaseProject.recommendation}</p>
            </div>
          </div>

          {/* Collection Consistency */}
          <div className="border rounded-lg p-4">
            <h4 className="font-semibold mb-2">📊 Collection Consistency</h4>
            <div className="space-y-1 text-sm">
              <p><strong>Documents Collection:</strong> {debugResults.collectionConsistency.documentsCollection} docs</p>
              <p><strong>Onboarding Documents:</strong> {debugResults.collectionConsistency.onboardingDocumentsCollection} docs</p>
              <p className="text-gray-600">{debugResults.collectionConsistency.recommendation}</p>
            </div>
          </div>

          {/* Status Filters */}
          <div className="border rounded-lg p-4">
            <h4 className="font-semibold mb-2">📈 Status Distribution</h4>
            <div className="space-y-1 text-sm">
              <p><strong>Total Documents:</strong> {debugResults.statusFilters.totalDocuments}</p>
              <div className="mt-2">
                {Object.entries(debugResults.statusFilters.statusDistribution).map(([status, count]) => (
                  <div key={status} className="flex justify-between">
                    <span>Status "{status}":</span>
                    <span className="font-mono">{count}</span>
                  </div>
                ))}
              </div>
              <p className="text-gray-600">{debugResults.statusFilters.recommendation}</p>
            </div>
          </div>

          {/* Query Results */}
          <div className="border rounded-lg p-4">
            <h4 className="font-semibold mb-2">🔍 Query Filter Results</h4>
            <div className="space-y-2 text-sm">
              {debugResults.queryFilters.queryResults.map((result, index) => (
                <div key={index} className="border-l-4 border-blue-500 pl-3">
                  <p><strong>{result.query}:</strong> {result.count} docs</p>
                  <p className="text-gray-600">{result.filters}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Storage Paths */}
          <div className="border rounded-lg p-4">
            <h4 className="font-semibold mb-2">📁 Storage Paths</h4>
            <div className="space-y-1 text-sm">
              <p><strong>Document Service:</strong> {debugResults.storagePaths.paths.documentService}</p>
              <p><strong>Documents Service:</strong> {debugResults.storagePaths.paths.documentsService}</p>
              <p className="text-orange-600">{debugResults.storagePaths.issue}</p>
            </div>
          </div>

          {/* Raw Data */}
          <div className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-semibold">📄 Raw Document Data</h4>
              <Button
                onClick={() => copyToClipboard(JSON.stringify(debugResults.testWithoutFilters, null, 2))}
                variant="outline"
                size="sm"
              >
                📋 Copy JSON
              </Button>
            </div>
            <div className="text-sm">
              <p><strong>Total Documents:</strong> {debugResults.testWithoutFilters.totalDocuments}</p>
              {debugResults.testWithoutFilters.documents.length > 0 && (
                <div className="mt-2">
                  <p className="font-semibold mb-1">Sample Documents:</p>
                  <pre className="bg-gray-100 p-2 rounded text-xs overflow-x-auto">
                    {JSON.stringify(debugResults.testWithoutFilters.documents.slice(0, 3), null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>

          {/* Recommendations */}
          {recommendations.length > 0 && (
            <div className="border rounded-lg p-4 bg-yellow-50">
              <h4 className="font-semibold mb-2">⚠️ Recommendations</h4>
              <ul className="space-y-1 text-sm">
                {recommendations.map((rec, index) => (
                  <li key={index} className="flex items-start">
                    <span className="mr-2">{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Debug Actions */}
          <div className="flex gap-2">
            <Button
              onClick={() => copyToClipboard(JSON.stringify(debugResults, null, 2))}
              variant="outline"
              size="sm"
            >
              📋 Copy Full Results
            </Button>
            <Button
              onClick={() => setDebugResults(null)}
              variant="outline"
              size="sm"
            >
              🔄 Clear Results
            </Button>
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="mt-6 p-4 bg-gray-50 rounded-lg text-sm">
        <h4 className="font-semibold mb-2">📖 How to Use</h4>
        <ol className="list-decimal list-inside space-y-1">
          <li>Click "Run All Checks" to analyze document sync issues</li>
          <li>Review the results for each category</li>
          <li>Check recommendations for potential fixes</li>
          <li>Copy results to share with development team</li>
        </ol>
      </div>
    </div>
  );
};

export default DocumentSyncDebugger;
