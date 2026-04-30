import React, { useState } from 'react';
import { toast } from 'react-toastify';
import { AlertTriangle, CheckCircle, Database, RefreshCw, Shield } from 'lucide-react';
import {
    migrateUsersToCompanyProfiles,
    rollbackMigration,
    verifyMigration
} from '../../services/migrations/migrateToCompanyProfiles';

const MultiCompanyMigrationPage = () => {
    const [isRunning, setIsRunning] = useState(false);
    const [results, setResults] = useState(null);
    const [verificationReport, setVerificationReport] = useState(null);
    const [activeTab, setActiveTab] = useState('migrate');

    const handleDryRun = async () => {
        setIsRunning(true);
        setResults(null);
        try {
            toast.info('Running dry run migration...');
            const result = await migrateUsersToCompanyProfiles({ dryRun: true });
            setResults(result);
            toast.success(`Dry run complete! Would migrate ${result.migrated} users`);
        } catch (error) {
            toast.error(`Dry run failed: ${error.message}`);
            console.error(error);
        } finally {
            setIsRunning(false);
        }
    };

    const handleLiveMigration = async () => {
        if (!window.confirm('⚠️ This will migrate ALL users to the new multi-company system. Are you sure?')) {
            return;
        }

        setIsRunning(true);
        setResults(null);
        try {
            toast.info('Running LIVE migration...');
            const result = await migrateUsersToCompanyProfiles({ dryRun: false, batchSize: 100 });
            setResults(result);
            toast.success(`Migration complete! Migrated ${result.migrated} users`);
        } catch (error) {
            toast.error(`Migration failed: ${error.message}`);
            console.error(error);
        } finally {
            setIsRunning(false);
        }
    };

    const handleVerify = async () => {
        setIsRunning(true);
        setVerificationReport(null);
        try {
            toast.info('Verifying migration integrity...');
            const report = await verifyMigration();
            setVerificationReport(report);

            if (report.usersWithoutProfiles.length === 0 && report.orphanedProfiles.length === 0) {
                toast.success('Verification passed! All users have valid profiles');
            } else {
                toast.warning('Verification found issues - check report below');
            }
        } catch (error) {
            toast.error(`Verification failed: ${error.message}`);
            console.error(error);
        } finally {
            setIsRunning(false);
        }
    };

    const handleRollback = async () => {
        if (!window.confirm('⚠️⚠️⚠️ DANGER: This will DELETE all company profiles and restore the old system. Are you ABSOLUTELY sure?')) {
            return;
        }

        if (!window.confirm('This action cannot be undone. Type YES in the next prompt to confirm.')) {
            return;
        }

        const confirmation = window.prompt('Type YES to confirm rollback:');
        if (confirmation !== 'YES') {
            toast.info('Rollback cancelled');
            return;
        }

        setIsRunning(true);
        try {
            toast.info('Rolling back migration...');
            const result = await rollbackMigration({ dryRun: false });
            toast.success(`Rollback complete! Deleted ${result.profilesDeleted} profiles, restored ${result.usersRestored} users`);
            setResults(null);
            setVerificationReport(null);
        } catch (error) {
            toast.error(`Rollback failed: ${error.message}`);
            console.error(error);
        } finally {
            setIsRunning(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 p-6">
            <div className="max-w-6xl mx-auto">
                {/* Header */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
                    <div className="flex items-center gap-3 mb-2">
                        <Database className="h-8 w-8 text-purple-600" />
                        <h1 className="text-2xl font-bold text-gray-900">Multi-Company User Migration</h1>
                    </div>
                    <p className="text-gray-600">
                        Migrate existing users to the new multi-company profile system. This allows users to work for multiple companies over time using the same email address.
                    </p>
                </div>

                {/* Warning Banner */}
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                        <div>
                            <h3 className="font-semibold text-amber-900 mb-1">Important: Run Dry Run First</h3>
                            <p className="text-sm text-amber-800">
                                Always run a dry run before the live migration to preview changes. Ensure you have a recent database backup before proceeding with live migration.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-2 mb-6 border-b border-gray-200">
                    <button
                        onClick={() => setActiveTab('migrate')}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'migrate'
                                ? 'border-purple-600 text-purple-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                            }`}
                    >
                        Migration
                    </button>
                    <button
                        onClick={() => setActiveTab('verify')}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'verify'
                                ? 'border-purple-600 text-purple-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                            }`}
                    >
                        Verification
                    </button>
                    <button
                        onClick={() => setActiveTab('rollback')}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'rollback'
                                ? 'border-red-600 text-red-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                            }`}
                    >
                        Rollback
                    </button>
                </div>

                {/* Migration Tab */}
                {activeTab === 'migrate' && (
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                        <h2 className="text-lg font-semibold text-gray-900 mb-4">Run Migration</h2>

                        <div className="space-y-4">
                            <div className="flex gap-3">
                                <button
                                    onClick={handleDryRun}
                                    disabled={isRunning}
                                    className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {isRunning ? (
                                        <>
                                            <RefreshCw className="h-5 w-5 animate-spin" />
                                            Running...
                                        </>
                                    ) : (
                                        <>
                                            <Shield className="h-5 w-5" />
                                            Dry Run (Safe)
                                        </>
                                    )}
                                </button>

                                <button
                                    onClick={handleLiveMigration}
                                    disabled={isRunning}
                                    className="flex-1 px-6 py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {isRunning ? (
                                        <>
                                            <RefreshCw className="h-5 w-5 animate-spin" />
                                            Migrating...
                                        </>
                                    ) : (
                                        <>
                                            <Database className="h-5 w-5" />
                                            Live Migration
                                        </>
                                    )}
                                </button>
                            </div>

                            {results && (
                                <div className="mt-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
                                    <h3 className="font-semibold text-gray-900 mb-3">Migration Results</h3>
                                    <div className="grid grid-cols-3 gap-4 text-sm">
                                        <div>
                                            <div className="text-gray-600">Total Users</div>
                                            <div className="text-2xl font-bold text-gray-900">{results.total}</div>
                                        </div>
                                        <div>
                                            <div className="text-gray-600">Migrated</div>
                                            <div className="text-2xl font-bold text-green-600">{results.migrated}</div>
                                        </div>
                                        <div>
                                            <div className="text-gray-600">Skipped</div>
                                            <div className="text-2xl font-bold text-amber-600">{results.skipped}</div>
                                        </div>
                                    </div>

                                    {results.errors && results.errors.length > 0 && (
                                        <div className="mt-4">
                                            <h4 className="font-medium text-red-600 mb-2">Errors ({results.errors.length})</h4>
                                            <div className="max-h-40 overflow-y-auto space-y-1">
                                                {results.errors.map((err, idx) => (
                                                    <div key={idx} className="text-xs text-red-700 bg-red-50 p-2 rounded">
                                                        {err.userId ? `User ${err.userId}: ` : ''}{err.message || err.error}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {results.profiles && results.profiles.length > 0 && (
                                        <div className="mt-4">
                                            <h4 className="font-medium text-gray-700 mb-2">Sample Profiles Created</h4>
                                            <div className="max-h-40 overflow-y-auto space-y-1">
                                                {results.profiles.slice(0, 10).map((profile, idx) => (
                                                    <div key={idx} className="text-xs text-gray-600 bg-white p-2 rounded border border-gray-200">
                                                        User: {profile.userId} → Profile: {profile.profileId} ({profile.status})
                                                    </div>
                                                ))}
                                                {results.profiles.length > 10 && (
                                                    <div className="text-xs text-gray-500 italic">
                                                        ... and {results.profiles.length - 10} more
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Verification Tab */}
                {activeTab === 'verify' && (
                    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                        <h2 className="text-lg font-semibold text-gray-900 mb-4">Verify Migration Integrity</h2>

                        <button
                            onClick={handleVerify}
                            disabled={isRunning}
                            className="w-full px-6 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {isRunning ? (
                                <>
                                    <RefreshCw className="h-5 w-5 animate-spin" />
                                    Verifying...
                                </>
                            ) : (
                                <>
                                    <CheckCircle className="h-5 w-5" />
                                    Run Verification
                                </>
                            )}
                        </button>

                        {verificationReport && (
                            <div className="mt-6 space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                                        <div className="text-sm text-gray-600">Total Users</div>
                                        <div className="text-2xl font-bold text-gray-900">{verificationReport.totalUsers}</div>
                                    </div>
                                    <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                                        <div className="text-sm text-gray-600">Users with Profiles</div>
                                        <div className="text-2xl font-bold text-green-600">{verificationReport.usersWithProfiles}</div>
                                    </div>
                                </div>

                                {verificationReport.usersWithoutProfiles.length > 0 && (
                                    <div className="p-4 bg-red-50 rounded-lg border border-red-200">
                                        <h4 className="font-medium text-red-900 mb-2">
                                            Users Without Profiles ({verificationReport.usersWithoutProfiles.length})
                                        </h4>
                                        <div className="max-h-40 overflow-y-auto space-y-1">
                                            {verificationReport.usersWithoutProfiles.map((user, idx) => (
                                                <div key={idx} className="text-xs text-red-700">
                                                    {user.email} (ID: {user.userId})
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {verificationReport.orphanedProfiles.length > 0 && (
                                    <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
                                        <h4 className="font-medium text-amber-900 mb-2">
                                            Orphaned Profiles ({verificationReport.orphanedProfiles.length})
                                        </h4>
                                        <div className="max-h-40 overflow-y-auto space-y-1">
                                            {verificationReport.orphanedProfiles.map((profile, idx) => (
                                                <div key={idx} className="text-xs text-amber-700">
                                                    Profile {profile.profileId} → Missing User {profile.userId}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {verificationReport.statusMismatches.length > 0 && (
                                    <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
                                        <h4 className="font-medium text-amber-900 mb-2">
                                            Status Mismatches ({verificationReport.statusMismatches.length})
                                        </h4>
                                        <div className="max-h-40 overflow-y-auto space-y-1">
                                            {verificationReport.statusMismatches.map((mismatch, idx) => (
                                                <div key={idx} className="text-xs text-amber-700">
                                                    User {mismatch.userId}: {mismatch.issue}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {verificationReport.usersWithoutProfiles.length === 0 &&
                                    verificationReport.orphanedProfiles.length === 0 &&
                                    verificationReport.statusMismatches.length === 0 && (
                                        <div className="p-4 bg-green-50 rounded-lg border border-green-200 flex items-center gap-3">
                                            <CheckCircle className="h-6 w-6 text-green-600" />
                                            <div>
                                                <div className="font-medium text-green-900">All Checks Passed!</div>
                                                <div className="text-sm text-green-700">Migration integrity verified successfully</div>
                                            </div>
                                        </div>
                                    )}
                            </div>
                        )}
                    </div>
                )}

                {/* Rollback Tab */}
                {activeTab === 'rollback' && (
                    <div className="bg-white rounded-lg shadow-sm border border-red-200 p-6">
                        <div className="flex items-start gap-3 mb-4">
                            <AlertTriangle className="h-6 w-6 text-red-600 flex-shrink-0" />
                            <div>
                                <h2 className="text-lg font-semibold text-red-900 mb-1">Danger Zone: Rollback Migration</h2>
                                <p className="text-sm text-red-700">
                                    This will DELETE all company profiles and restore the old single-company system. Only use this if the migration failed critically.
                                </p>
                            </div>
                        </div>

                        <button
                            onClick={handleRollback}
                            disabled={isRunning}
                            className="w-full px-6 py-3 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {isRunning ? (
                                <>
                                    <RefreshCw className="h-5 w-5 animate-spin" />
                                    Rolling Back...
                                </>
                            ) : (
                                <>
                                    <AlertTriangle className="h-5 w-5" />
                                    Rollback Migration
                                </>
                            )}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default MultiCompanyMigrationPage;
