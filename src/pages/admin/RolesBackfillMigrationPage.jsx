
import React, { useState } from 'react';
import Header from '../../components/layout/Header';
import Button from '../../components/ui/Button';
import SectionContainer from '../../components/shared/SectionContainer';
import { scanUsersForMissingRoles, migrateMissingRoles, MIGRATION_MODE } from '../../services/rolesBackfillMigration';
import { toast } from 'react-toastify';

const RolesBackfillMigrationPage = () => {
    const [loading, setLoading] = useState(false);
    const [scanResults, setScanResults] = useState(null);
    const [migrationResults, setMigrationResults] = useState(null);
    const [progress, setProgress] = useState(null); // { phase, progress, total, current }

    const handleScan = async () => {
        try {
            setLoading(true);
            setScanResults(null);
            setMigrationResults(null);
            const results = await scanUsersForMissingRoles();
            setScanResults(results);
        } catch (error) {
            console.error(error);
            toast.error("Scan failed");
        } finally {
            setLoading(false);
        }
    };

    const handleMigrate = async (mode) => {
        try {
            setLoading(true);
            const results = await migrateMissingRoles({
                mode,
                onProgress: (p) => setProgress(p)
            });
            setMigrationResults(results);
            if (mode === MIGRATION_MODE.LIVE) {
                toast.success("Migration complete!");
                // Re-scan to show empty list
                const newScan = await scanUsersForMissingRoles();
                setScanResults(newScan);
            } else {
                toast.info("Dry run complete");
            }
        } catch (error) {
            console.error(error);
            toast.error("Migration failed");
        } finally {
            setLoading(false);
            setProgress(null);
        }
    };

    return (
        <div className="flex flex-col h-screen bg-bg-secondary font-sans overflow-hidden">
            <Header />
            <div className="flex-1 overflow-auto scrollbar-custom p-6">
                <div className="max-w-4xl mx-auto space-y-6">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">User Roles Backfill Migration</h1>
                        <p className="text-sm text-gray-500">Fix users who are missing the 'roles' array field.</p>
                    </div>

                    <SectionContainer className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-6">
                        <div className="flex gap-4">
                            <Button
                                variant="outline-primary"
                                onClick={handleScan}
                                disabled={loading}
                            >
                                {loading ? 'Scanning...' : 'Scan / Check Status'}
                            </Button>
                        </div>

                        {progress && (
                            <div className="space-y-2">
                                <div className="flex justify-between text-sm text-gray-600">
                                    <span>Phase: {progress.phase}</span>
                                    <span>{progress.progress} / {progress.total}</span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-2.5">
                                    <div
                                        className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                                        style={{ width: `${(progress.progress / (progress.total || 1)) * 100}%` }}
                                    ></div>
                                </div>
                                {progress.current && <p className="text-xs text-gray-400">Processing: {progress.current}</p>}
                            </div>
                        )}

                        {scanResults && (
                            <div className="space-y-4">
                                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                                    <h3 className="font-semibold text-lg">Scan Results</h3>
                                    <p>Found <strong>{scanResults.total}</strong> users missing 'roles'.</p>

                                    {scanResults.total > 0 && (
                                        <div className="mt-4 flex gap-3">
                                            <Button
                                                variant="outline-secondary"
                                                onClick={() => handleMigrate(MIGRATION_MODE.DRY_RUN)}
                                                disabled={loading}
                                            >
                                                Run Dry Run (Test)
                                            </Button>
                                            <Button
                                                variant="primary"
                                                onClick={() => handleMigrate(MIGRATION_MODE.LIVE)}
                                                disabled={loading}
                                            >
                                                Start Live Migration
                                            </Button>
                                        </div>
                                    )}
                                </div>

                                {scanResults.users.length > 0 && (
                                    <div className="max-h-60 overflow-y-auto border border-gray-200 rounded-lg">
                                        <table className="min-w-full text-sm">
                                            <thead className="bg-gray-100 sticky top-0">
                                                <tr>
                                                    <th className="p-2 text-left">Email</th>
                                                    <th className="p-2 text-left">Role (Current)</th>
                                                    <th className="p-2 text-left">Proposed Roles</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {scanResults.users.map(u => (
                                                    <tr key={u.id} className="border-t border-gray-100">
                                                        <td className="p-2">{u.email}</td>
                                                        <td className="p-2">{u.currentPrimaryRole || JSON.stringify(u.currentRoleLegacy)}</td>
                                                        <td className="p-2 font-mono text-xs">{JSON.stringify(u.proposedRoles)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}

                        {migrationResults && (
                            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                                <h3 className="font-semibold text-green-800">Migration Results ({migrationResults.mode})</h3>
                                <p className="text-green-700">Processed: {migrationResults.usersMigrated}</p>
                                {migrationResults.errors.length > 0 && (
                                    <div className="mt-2 text-red-600">
                                        <p>Errors: {migrationResults.errors.length}</p>
                                        <pre className="text-xs bg-red-50 p-2 rounded">{JSON.stringify(migrationResults.errors, null, 2)}</pre>
                                    </div>
                                )}
                            </div>
                        )}

                    </SectionContainer>
                </div>
            </div>
        </div>
    );
};

export default RolesBackfillMigrationPage;
