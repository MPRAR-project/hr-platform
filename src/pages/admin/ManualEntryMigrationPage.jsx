/**
 * Manual Entry Migration Page
 * Admin page to migrate old manual entries to unified session storage
 */

import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Play, RotateCcw, FileSearch, AlertTriangle, CheckCircle, Clock, Database } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';

import Header from '../../components/layout/Header';
import Button from '../../components/ui/Button';
import Loader from '../../components/ui/Loader';
import Badge from '../../components/ui/Badge';
import { useAuth } from '../../hooks/useAuth';
import {
    scanManualEntriesForMigration,
    migrateManualEntries,
    rollbackMigration,
    getMigrationHistory,
    MIGRATION_MODE
} from '../../services/manualEntryMigration';

const ManualEntryMigrationPage = () => {
    const navigate = useNavigate();
    const { user } = useAuth();

    // State
    const [isLoading, setIsLoading] = useState(true);
    const [scanResult, setScanResult] = useState(null);
    const [migrations, setMigrations] = useState([]);
    const [isRunning, setIsRunning] = useState(false);
    const [progress, setProgress] = useState(null);
    const [lastResult, setLastResult] = useState(null);

    // Check permissions - only superUser can access
    const canAccess = user?.role === 'superUser';

    // Load initial data
    useEffect(() => {
        if (!canAccess) return;
        loadData();
    }, [canAccess]);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const [scan, history] = await Promise.all([
                scanManualEntriesForMigration(),
                getMigrationHistory()
            ]);
            setScanResult(scan);
            setMigrations(history);
        } catch (error) {
            console.error('Failed to load migration data:', error);
            toast.error('Failed to load migration data');
        } finally {
            setIsLoading(false);
        }
    };

    // Handle progress updates - use functional update to ensure fresh state
    const handleProgress = useCallback((progressData) => {
        console.log('[Migration UI] Progress update:', progressData);
        setProgress(prev => ({ ...progressData }));
    }, []);

    // Dry Run
    const handleDryRun = async () => {
        setIsRunning(true);
        setProgress({ phase: 'starting', progress: 0 });
        setLastResult(null);

        try {
            const result = await migrateManualEntries({
                mode: MIGRATION_MODE.DRY_RUN,
                onProgress: handleProgress
            });
            setLastResult(result);
            toast.success(`Dry run complete: ${result.entriesMigrated} entries would be migrated`);
        } catch (error) {
            toast.error(`Dry run failed: ${error.message}`);
        } finally {
            setIsRunning(false);
            setProgress(null);
        }
    };

    // Live Migration
    const handleLiveMigration = async () => {
        if (!confirm('Are you sure you want to run LIVE migration? This will create session documents.')) {
            return;
        }

        setIsRunning(true);
        setProgress({ phase: 'starting', progress: 0 });
        setLastResult(null);

        try {
            const result = await migrateManualEntries({
                mode: MIGRATION_MODE.LIVE,
                onProgress: handleProgress
            });
            setLastResult(result);
            toast.success(`Migration complete: ${result.entriesMigrated} entries migrated`);
            // Reload data
            await loadData();
        } catch (error) {
            toast.error(`Migration failed: ${error.message}`);
        } finally {
            setIsRunning(false);
            setProgress(null);
        }
    };

    // Rollback
    const handleRollback = async (migrationId) => {
        if (!confirm('Are you sure you want to rollback this migration? This will delete created sessions.')) {
            return;
        }

        setIsRunning(true);
        setProgress({ phase: 'rollback', progress: 0 });

        try {
            await rollbackMigration(migrationId, handleProgress);
            toast.success('Rollback complete');
            await loadData();
        } catch (error) {
            toast.error(`Rollback failed: ${error.message}`);
        } finally {
            setIsRunning(false);
            setProgress(null);
        }
    };

    // Permission check
    if (!canAccess) {
        return (
            <div className="h-screen flex flex-col overflow-hidden">
                <Header title="Access Denied" />
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-center">
                        <AlertTriangle className="h-16 w-16 text-orange-500 mx-auto mb-4" />
                        <h2 className="text-xl font-bold text-text-primary">Access Denied</h2>
                        <p className="text-text-secondary mt-2">Only Admin Managers can access this page.</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-screen flex flex-col overflow-hidden">
            <Header
                title="Manual Entry Migration"
                subtitle="Backfill session documents for old manual entries"
            />

            <div className="flex-1 overflow-y-auto p-4 md:p-6 scrollbar-custom">
                <div className="max-w-5xl mx-auto space-y-6">
                    {/* Back Button */}
                    <button
                        onClick={() => navigate(-1)}
                        className="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        <span>Back</span>
                    </button>

                    {isLoading ? (
                        <div className="flex items-center justify-center h-40">
                            <Loader variant="spinner" size="lg" text="Scanning entries..." />
                        </div>
                    ) : (
                        <>
                            {/* Stats Cards */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div className="bg-white rounded-xl border border-border-secondary p-6">
                                    <div className="flex items-center gap-3">
                                        <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center">
                                            <Database className="h-6 w-6 text-blue-500" />
                                        </div>
                                        <div>
                                            <p className="text-2xl font-bold text-text-primary">
                                                {scanResult?.total || 0}
                                            </p>
                                            <p className="text-sm text-text-secondary">Entries Need Migration</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-white rounded-xl border border-border-secondary p-6">
                                    <div className="flex items-center gap-3">
                                        <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center">
                                            <CheckCircle className="h-6 w-6 text-green-500" />
                                        </div>
                                        <div>
                                            <p className="text-2xl font-bold text-text-primary">
                                                {migrations.filter(m => m.status === 'completed').length}
                                            </p>
                                            <p className="text-sm text-text-secondary">Completed Migrations</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-white rounded-xl border border-border-secondary p-6">
                                    <div className="flex items-center gap-3">
                                        <div className="w-12 h-12 rounded-full bg-orange-50 flex items-center justify-center">
                                            <Clock className="h-6 w-6 text-orange-500" />
                                        </div>
                                        <div>
                                            <p className="text-2xl font-bold text-text-primary">
                                                {Object.keys(scanResult?.byUser || {}).length}
                                            </p>
                                            <p className="text-sm text-text-secondary">Users Affected</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="bg-white rounded-xl border border-border-secondary p-6">
                                <h3 className="text-lg font-bold text-text-primary mb-4">Migration Actions</h3>

                                <div className="flex flex-wrap gap-3">
                                    <Button
                                        variant="outline-primary"
                                        onClick={handleDryRun}
                                        disabled={isRunning || scanResult?.total === 0}
                                        icon={FileSearch}
                                    >
                                        Dry Run (Preview)
                                    </Button>

                                    <Button
                                        variant="solid-primary"
                                        onClick={handleLiveMigration}
                                        disabled={isRunning || scanResult?.total === 0}
                                        icon={Play}
                                    >
                                        Live Migration
                                    </Button>

                                    <Button
                                        variant="outline-secondary"
                                        onClick={loadData}
                                        disabled={isRunning}
                                    >
                                        Refresh Scan
                                    </Button>
                                </div>

                                {scanResult?.total === 0 && (
                                    <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                                        <div className="flex items-center gap-2">
                                            <CheckCircle className="h-5 w-5 text-green-600" />
                                            <span className="text-green-800 font-medium">
                                                All manual entries are already migrated!
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Progress Bar */}
                            {progress && (
                                <div className="bg-white rounded-xl border border-border-secondary p-6">
                                    <h3 className="text-lg font-bold text-text-primary mb-3">Progress</h3>
                                    <div className="space-y-2">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-text-secondary capitalize">{progress.phase}</span>
                                            <span className="text-text-primary font-medium">
                                                {progress.progress} / {progress.total || '?'}
                                            </span>
                                        </div>
                                        <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-gradient-to-r from-purple-500 to-purple-600 transition-all duration-300"
                                                style={{
                                                    width: progress.total
                                                        ? `${(progress.progress / progress.total) * 100}%`
                                                        : '0%'
                                                }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Last Result */}
                            {lastResult && (
                                <div className="bg-white rounded-xl border border-border-secondary p-6">
                                    <h3 className="text-lg font-bold text-text-primary mb-3">
                                        {lastResult.mode === 'dry_run' ? 'Dry Run' : 'Migration'} Result
                                    </h3>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                        <div>
                                            <p className="text-sm text-text-secondary">Mode</p>
                                            <Badge variant={lastResult.mode === 'dry_run' ? 'info' : 'success'}>
                                                {lastResult.mode === 'dry_run' ? 'Dry Run' : 'Live'}
                                            </Badge>
                                        </div>
                                        <div>
                                            <p className="text-sm text-text-secondary">Scanned</p>
                                            <p className="text-lg font-bold">{lastResult.entriesScanned}</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-text-secondary">Migrated</p>
                                            <p className="text-lg font-bold text-green-600">{lastResult.entriesMigrated}</p>
                                        </div>
                                        <div>
                                            <p className="text-sm text-text-secondary">Errors</p>
                                            <p className="text-lg font-bold text-red-600">{lastResult.errors?.length || 0}</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Migration History */}
                            <div className="bg-white rounded-xl border border-border-secondary p-6">
                                <h3 className="text-lg font-bold text-text-primary mb-4">Migration History</h3>

                                {migrations.length === 0 ? (
                                    <p className="text-text-secondary text-center py-4">No migrations yet</p>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full">
                                            <thead>
                                                <tr className="border-b border-border-secondary">
                                                    <th className="text-left py-3 px-4 text-sm font-semibold text-text-secondary">ID</th>
                                                    <th className="text-left py-3 px-4 text-sm font-semibold text-text-secondary">Date</th>
                                                    <th className="text-left py-3 px-4 text-sm font-semibold text-text-secondary">Status</th>
                                                    <th className="text-left py-3 px-4 text-sm font-semibold text-text-secondary">Migrated</th>
                                                    <th className="text-left py-3 px-4 text-sm font-semibold text-text-secondary">Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {migrations.map(mig => (
                                                    <tr key={mig.id} className="border-b border-border-secondary hover:bg-bg-secondary/50">
                                                        <td className="py-3 px-4 text-sm font-mono">{mig.migrationId || mig.id}</td>
                                                        <td className="py-3 px-4 text-sm">
                                                            {new Date(mig.startedAt).toLocaleString()}
                                                        </td>
                                                        <td className="py-3 px-4">
                                                            <Badge
                                                                variant={
                                                                    mig.status === 'completed' ? 'success' :
                                                                        mig.status === 'rolled_back' ? 'warning' :
                                                                            mig.status === 'failed' ? 'danger' : 'info'
                                                                }
                                                            >
                                                                {mig.status}
                                                            </Badge>
                                                        </td>
                                                        <td className="py-3 px-4 text-sm">{mig.entriesMigrated || 0}</td>
                                                        <td className="py-3 px-4">
                                                            {mig.status === 'completed' && (
                                                                <Button
                                                                    variant="outline-danger"
                                                                    size="sm"
                                                                    onClick={() => handleRollback(mig.id)}
                                                                    disabled={isRunning}
                                                                    icon={RotateCcw}
                                                                >
                                                                    Rollback
                                                                </Button>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ManualEntryMigrationPage;
