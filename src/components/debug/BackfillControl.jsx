import { useState } from 'react';
import { functions } from '../../firebase/client';
import { httpsCallable } from 'firebase/functions';
import Button from '../ui/Button';
import { Loader } from 'lucide-react';

export default function BackfillControl() {
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);

    const handleBackfill = async () => {
        if (!confirm('This will trigger a Cloud Function to scan ALL timesheets and create weekly summaries. Continue?')) return;

        setLoading(true);
        setResult(null);
        try {
            const backfillFn = httpsCallable(functions, 'backfillWeeklySummaries');
            // eslint-disable-next-line no-console
            console.log('🚀 Triggering backfillWeeklySummaries...');

            const response = await backfillFn({});

            // eslint-disable-next-line no-console
            console.log('✅ Backfill response:', response);
            setResult(`Success! Processed: ${response.data?.processed} | Updated: ${response.data?.updated}`);

            alert(`Backfill Complete!\nProcessed: ${response.data?.processed}\nUpdated: ${response.data?.updated}\nDuration: ${response.data?.duration}`);
            window.location.reload();
        } catch (error) {
            console.error('Backfill failed:', error);
            setResult(`Error: ${error.message}`);
            alert(`Backfill Failed: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-4 mb-4 bg-yellow-50 border border-yellow-200 rounded-lg shadow-sm">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-semibold text-yellow-800">🛠️ Admin Tool: Data Backfill</h3>
                    <p className="text-xs text-yellow-700 mt-1">
                        Run this ONCE to populate the new fast-loading cache.
                    </p>
                </div>
                <Button
                    variant="primary"
                    onClick={handleBackfill}
                    disabled={loading}
                    className="bg-yellow-600 hover:bg-yellow-700 text-white border-transparent"
                >
                    {loading ? (
                        <>
                            <Loader className="w-4 h-4 mr-2 animate-spin" />
                            Processing...
                        </>
                    ) : (
                        'Run Backfill Now'
                    )}
                </Button>
            </div>
            {result && (
                <div className="mt-2 text-xs font-mono p-2 bg-white rounded border border-gray-200 text-gray-700">
                    {result}
                </div>
            )}
        </div>
    );
}
