import React, { useState, useEffect } from 'react';
import { Database, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import Header from '../../components/layout/Header';
import Button from '../../components/ui/Button';
import { checkMigrationStatus, migrateManagerUserIdField, validateMigration, migrateTimesheetsManagerUserId, checkTimesheetsStatus, createMissingUserDocuments, fixTimesheetUserIds, restructureUsersCollection } from '../../services/migration';

const MigrationPage = () => {
    const [status, setStatus] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [migrationResult, setMigrationResult] = useState(null);
    const [validationResult, setValidationResult] = useState(null);
    const [timesheetsMigrationResult, setTimesheetsMigrationResult] = useState(null);
    const [timesheetsStatus, setTimesheetsStatus] = useState(null);
    const [missingUsersResult, setMissingUsersResult] = useState(null);
    const [fixUserIdsResult, setFixUserIdsResult] = useState(null);
    const [restructureResult, setRestructureResult] = useState(null);

    const loadStatus = async () => {
        setIsLoading(true);
        try {
            const result = await checkMigrationStatus();
            setStatus(result);
        } catch (error) {
            console.error('Failed to load migration status:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const runMigration = async () => {
        if (!status?.migrationNeeded) return;
        
        setIsLoading(true);
        try {
            const result = await migrateManagerUserIdField();
            setMigrationResult(result);
            
            // Run validation after migration
            if (result.success) {
                const validation = await validateMigration();
                setValidationResult(validation);
            }
            
            // Reload status after migration
            await loadStatus();
        } catch (error) {
            console.error('Migration failed:', error);
            setMigrationResult({ success: false, error: error.message });
        } finally {
            setIsLoading(false);
        }
    };

    const runValidation = async () => {
        setIsLoading(true);
        try {
            const result = await validateMigration();
            setValidationResult(result);
        } catch (error) {
            console.error('Validation failed:', error);
            setValidationResult({ success: false, error: error.message });
        } finally {
            setIsLoading(false);
        }
    };

    const runTimesheetsMigration = async () => {
        setIsLoading(true);
        try {
            const result = await migrateTimesheetsManagerUserId();
            setTimesheetsMigrationResult(result);
        } catch (error) {
            console.error('Timesheets migration failed:', error);
            setTimesheetsMigrationResult({ success: false, error: error.message });
        } finally {
            setIsLoading(false);
        }
    };

    const checkTimesheets = async () => {
        setIsLoading(true);
        try {
            const result = await checkTimesheetsStatus();
            setTimesheetsStatus(result);
        } catch (error) {
            console.error('Failed to check timesheets status:', error);
            setTimesheetsStatus({ success: false, error: error.message });
        } finally {
            setIsLoading(false);
        }
    };

    const createMissingUsers = async () => {
        setIsLoading(true);
        try {
            const result = await createMissingUserDocuments();
            setMissingUsersResult(result);
        } catch (error) {
            console.error('Failed to create missing user documents:', error);
            setMissingUsersResult({ success: false, error: error.message });
        } finally {
            setIsLoading(false);
        }
    };

    const fixUserIds = async () => {
        setIsLoading(true);
        try {
            const result = await fixTimesheetUserIds();
            setFixUserIdsResult(result);
        } catch (error) {
            console.error('Failed to fix timesheet user IDs:', error);
            setFixUserIdsResult({ success: false, error: error.message });
        } finally {
            setIsLoading(false);
        }
    };

    const restructureUsers = async () => {
        setIsLoading(true);
        try {
            const result = await restructureUsersCollection();
            setRestructureResult(result);
        } catch (error) {
            console.error('Failed to restructure users collection:', error);
            setRestructureResult({ success: false, error: error.message });
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadStatus();
    }, []);

    return (
        <div className="h-screen flex flex-col overflow-hidden">
            <Header
                title="Database Migration"
                subtitle="Manage database schema updates and migrations"
            />

            <div className="flex-1 overflow-y-auto p-3xl space-y-3xl scrollbar-custom">
                <div className="max-w-4xl mx-auto">
                    {/* Migration Status Card */}
                    <div className="bg-white border border-border-accent-purple rounded-lg p-6 space-y-6">
                        <div className="flex items-center gap-3">
                            <Database className="h-6 w-6 text-text-accent-purple" />
                            <h2 className="text-xl font-semibold text-text-primary">
                                Manager User ID Migration
                            </h2>
                        </div>

                        <div className="space-y-4">
                            <p className="text-text-secondary">
                                This migration adds the <code className="bg-gray-100 px-2 py-1 rounded">managerUserId</code> field 
                                to existing user documents. This field provides a direct reference to the user's assigned manager, 
                                making queries more efficient.
                            </p>

                            {isLoading && !status && (
                                <div className="flex items-center gap-3 text-text-secondary">
                                    <Loader2 className="h-5 w-5 animate-spin" />
                                    <span>Checking migration status...</span>
                                </div>
                            )}

                            {status && (
                                <div className="space-y-4">
                                    {/* Status Overview */}
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                            <div className="text-2xl font-bold text-blue-600">
                                                {status.total || 0}
                                            </div>
                                            <div className="text-sm text-blue-800">Total Users</div>
                                        </div>
                                        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                                            <div className="text-2xl font-bold text-green-600">
                                                {status.withManagerUserId || 0}
                                            </div>
                                            <div className="text-sm text-green-800">With managerUserId</div>
                                        </div>
                                        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                                            <div className="text-2xl font-bold text-orange-600">
                                                {status.withoutManagerUserId || 0}
                                            </div>
                                            <div className="text-sm text-orange-800">Need Migration</div>
                                        </div>
                                    </div>

                                    {/* Migration Status */}
                                    {status.migrationNeeded ? (
                                        <div className="flex items-center gap-3 p-4 bg-orange-50 border border-orange-200 rounded-lg">
                                            <AlertTriangle className="h-5 w-5 text-orange-600" />
                                            <div>
                                                <div className="font-semibold text-orange-800">Migration Required</div>
                                                <div className="text-sm text-orange-700">
                                                    {status.withoutManagerUserId} users need the managerUserId field populated
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
                                            <CheckCircle className="h-5 w-5 text-green-600" />
                                            <div>
                                                <div className="font-semibold text-green-800">Migration Complete</div>
                                                <div className="text-sm text-green-700">
                                                    All users have the managerUserId field
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Migration Result */}
                                    {migrationResult && (
                                        <div className={`p-4 border rounded-lg ${
                                            migrationResult.success 
                                                ? 'bg-green-50 border-green-200' 
                                                : 'bg-red-50 border-red-200'
                                        }`}>
                                            <div className={`font-semibold ${
                                                migrationResult.success ? 'text-green-800' : 'text-red-800'
                                            }`}>
                                                {migrationResult.success ? 'Migration Completed' : 'Migration Failed'}
                                            </div>
                                            <div className={`text-sm ${
                                                migrationResult.success ? 'text-green-700' : 'text-red-700'
                                            }`}>
                                                {migrationResult.success 
                                                    ? `Successfully updated ${migrationResult.updated} users`
                                                    : migrationResult.error
                                                }
                                            </div>
                                        </div>
                                    )}

                                    {/* Validation Result */}
                                    {validationResult && (
                                        <div className={`p-4 border rounded-lg ${
                                            validationResult.success 
                                                ? 'bg-green-50 border-green-200' 
                                                : 'bg-yellow-50 border-yellow-200'
                                        }`}>
                                            <div className={`font-semibold ${
                                                validationResult.success ? 'text-green-800' : 'text-yellow-800'
                                            }`}>
                                                {validationResult.success ? 'Validation Passed' : 'Validation Issues Found'}
                                            </div>
                                            <div className={`text-sm ${
                                                validationResult.success ? 'text-green-700' : 'text-yellow-700'
                                            }`}>
                                                {validationResult.success 
                                                    ? `All ${validationResult.validated} assignments are consistent with user documents`
                                                    : `${validationResult.errors?.length || 0} inconsistencies found`
                                                }
                                            </div>
                                            {validationResult.errors && validationResult.errors.length > 0 && (
                                                <div className="mt-2 text-xs text-yellow-700">
                                                    <details>
                                                        <summary className="cursor-pointer font-medium">View Details</summary>
                                                        <ul className="mt-1 list-disc list-inside space-y-1">
                                                            {validationResult.errors.slice(0, 5).map((error, index) => (
                                                                <li key={index}>{error}</li>
                                                            ))}
                                                            {validationResult.errors.length > 5 && (
                                                                <li>... and {validationResult.errors.length - 5} more</li>
                                                            )}
                                                        </ul>
                                                    </details>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Timesheets Status */}
                                    {timesheetsStatus && (
                                        <div className={`p-4 border rounded-lg ${
                                            timesheetsStatus.success 
                                                ? 'bg-blue-50 border-blue-200' 
                                                : 'bg-red-50 border-red-200'
                                        }`}>
                                            <div className={`font-semibold ${
                                                timesheetsStatus.success ? 'text-blue-800' : 'text-red-800'
                                            }`}>
                                                {timesheetsStatus.success ? 'Timesheets Status' : 'Failed to Check Timesheets'}
                                            </div>
                                            <div className={`text-sm ${
                                                timesheetsStatus.success ? 'text-blue-700' : 'text-red-700'
                                            }`}>
                                                {timesheetsStatus.success 
                                                    ? timesheetsStatus.message
                                                    : timesheetsStatus.error
                                                }
                                            </div>
                                            {timesheetsStatus.success && (
                                                <div className="mt-2 text-xs text-blue-600 space-y-1">
                                                    <p>Total: {timesheetsStatus.total} timesheets</p>
                                                    <p>With managerUserId: {timesheetsStatus.withManagerUserId}</p>
                                                    <p>Without managerUserId: {timesheetsStatus.withoutManagerUserId}</p>
                                                    {timesheetsStatus.withoutUserId > 0 && (
                                                        <p className="text-orange-600">Without userId: {timesheetsStatus.withoutUserId}</p>
                                                    )}
                                                    {timesheetsStatus.orphaned && timesheetsStatus.orphaned.length > 0 && (
                                                        <div className="mt-2">
                                                            <p className="text-red-600">Orphaned timesheets: {timesheetsStatus.orphaned.length}</p>
                                                            <details className="mt-1">
                                                                <summary className="cursor-pointer font-medium">View Details</summary>
                                                                <ul className="mt-1 list-disc list-inside space-y-1">
                                                                    {timesheetsStatus.orphaned.slice(0, 5).map((orphan, index) => (
                                                                        <li key={index}>
                                                                            {orphan.id}: {orphan.issue}
                                                                            {orphan.userId && ` (User: ${orphan.userId})`}
                                                                        </li>
                                                                    ))}
                                                                    {timesheetsStatus.orphaned.length > 5 && (
                                                                        <li>... and {timesheetsStatus.orphaned.length - 5} more</li>
                                                                    )}
                                                                </ul>
                                                            </details>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Missing Users Result */}
                                    {missingUsersResult && (
                                        <div className={`p-4 border rounded-lg ${
                                            missingUsersResult.success 
                                                ? 'bg-blue-50 border-blue-200' 
                                                : 'bg-red-50 border-red-200'
                                        }`}>
                                            <div className={`font-semibold ${
                                                missingUsersResult.success ? 'text-blue-800' : 'text-red-800'
                                            }`}>
                                                {missingUsersResult.success ? 'Missing Users Created' : 'Failed to Create Missing Users'}
                                            </div>
                                            <div className={`text-sm ${
                                                missingUsersResult.success ? 'text-blue-700' : 'text-red-700'
                                            }`}>
                                                {missingUsersResult.success 
                                                    ? missingUsersResult.message
                                                    : missingUsersResult.error
                                                }
                                            </div>
                                            {missingUsersResult.success && missingUsersResult.errors && missingUsersResult.errors.length > 0 && (
                                                <div className="mt-2 text-xs text-blue-600">
                                                    <p>Errors: {missingUsersResult.errors.length} users</p>
                                                    <details className="mt-1">
                                                        <summary className="cursor-pointer font-medium">View Details</summary>
                                                        <ul className="mt-1 list-disc list-inside space-y-1">
                                                            {missingUsersResult.errors.slice(0, 3).map((error, index) => (
                                                                <li key={index}>{error.userId}: {error.error}</li>
                                                            ))}
                                                            {missingUsersResult.errors.length > 3 && (
                                                                <li>... and {missingUsersResult.errors.length - 3} more</li>
                                                            )}
                                                        </ul>
                                                    </details>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Fix User IDs Result */}
                                    {fixUserIdsResult && (
                                        <div className={`p-4 border rounded-lg ${
                                            fixUserIdsResult.success 
                                                ? 'bg-green-50 border-green-200' 
                                                : 'bg-red-50 border-red-200'
                                        }`}>
                                            <div className={`font-semibold ${
                                                fixUserIdsResult.success ? 'text-green-800' : 'text-red-800'
                                            }`}>
                                                {fixUserIdsResult.success ? 'User IDs Fixed' : 'Failed to Fix User IDs'}
                                            </div>
                                            <div className={`text-sm ${
                                                fixUserIdsResult.success ? 'text-green-700' : 'text-red-700'
                                            }`}>
                                                {fixUserIdsResult.success 
                                                    ? fixUserIdsResult.message
                                                    : fixUserIdsResult.error
                                                }
                                            </div>
                                            {fixUserIdsResult.success && (
                                                <div className="mt-2 text-xs text-green-600">
                                                    <p>Skipped: {fixUserIdsResult.skipped} timesheets (correct user ID)</p>
                                                    {fixUserIdsResult.errors > 0 && (
                                                        <p>Errors: {fixUserIdsResult.errors} timesheets</p>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Restructure Users Result */}
                                    {restructureResult && (
                                        <div className={`p-4 border rounded-lg ${
                                            restructureResult.success 
                                                ? 'bg-purple-50 border-purple-200' 
                                                : 'bg-red-50 border-red-200'
                                        }`}>
                                            <div className={`font-semibold ${
                                                restructureResult.success ? 'text-purple-800' : 'text-red-800'
                                            }`}>
                                                {restructureResult.success ? 'Users Collection Restructured' : 'Failed to Restructure Users'}
                                            </div>
                                            <div className={`text-sm ${
                                                restructureResult.success ? 'text-purple-700' : 'text-red-700'
                                            }`}>
                                                {restructureResult.success 
                                                    ? restructureResult.message
                                                    : restructureResult.error
                                                }
                                            </div>
                                            {restructureResult.success && (
                                                <div className="mt-2 text-xs text-purple-600">
                                                    <p>Skipped: {restructureResult.skipped} users (already using Auth IDs)</p>
                                                    {restructureResult.errors > 0 && (
                                                        <p>Errors: {restructureResult.errors} users</p>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Timesheets Migration Result */}
                                    {timesheetsMigrationResult && (
                                        <div className={`p-4 border rounded-lg ${
                                            timesheetsMigrationResult.success 
                                                ? 'bg-green-50 border-green-200' 
                                                : 'bg-red-50 border-red-200'
                                        }`}>
                                            <div className={`font-semibold ${
                                                timesheetsMigrationResult.success ? 'text-green-800' : 'text-red-800'
                                            }`}>
                                                {timesheetsMigrationResult.success ? 'Timesheets Migration Completed' : 'Timesheets Migration Failed'}
                                            </div>
                                            <div className={`text-sm ${
                                                timesheetsMigrationResult.success ? 'text-green-700' : 'text-red-700'
                                            }`}>
                                                {timesheetsMigrationResult.success 
                                                    ? `Updated ${timesheetsMigrationResult.updated} timesheets with managerUserId field`
                                                    : timesheetsMigrationResult.error
                                                }
                                            </div>
                                            {timesheetsMigrationResult.success && (
                                                <div className="mt-2 text-xs text-green-600">
                                                    <p>Skipped: {timesheetsMigrationResult.skipped} timesheets (already had managerUserId)</p>
                                                    {timesheetsMigrationResult.errors > 0 && (
                                                        <p>Errors: {timesheetsMigrationResult.errors} timesheets</p>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Action Buttons */}
                                    <div className="flex gap-3 flex-wrap">
                                        {status.migrationNeeded && (
                                            <Button
                                                onClick={runMigration}
                                                disabled={isLoading}
                                                variant="gradient"
                                                icon={isLoading ? Loader2 : Database}
                                                iconFirst={true}
                                            >
                                                {isLoading ? 'Running Migration...' : 'Run Migration'}
                                            </Button>
                                        )}
                                        <Button
                                            onClick={runValidation}
                                            disabled={isLoading}
                                            variant="outline-primary"
                                        >
                                            {isLoading ? 'Validating...' : 'Validate Data'}
                                        </Button>
                                        <Button
                                            onClick={checkTimesheets}
                                            disabled={isLoading}
                                            variant="outline-primary"
                                        >
                                            {isLoading ? 'Checking...' : 'Check Timesheets'}
                                        </Button>
                                        <Button
                                            onClick={restructureUsers}
                                            disabled={isLoading}
                                            variant="gradient"
                                        >
                                            {isLoading ? 'Restructuring...' : 'Restructure Users (Recommended)'}
                                        </Button>
                                        <Button
                                            onClick={fixUserIds}
                                            disabled={isLoading}
                                            variant="outline-primary"
                                        >
                                            {isLoading ? 'Fixing...' : 'Fix User IDs (Alternative)'}
                                        </Button>
                                        <Button
                                            onClick={createMissingUsers}
                                            disabled={isLoading}
                                            variant="outline-primary"
                                        >
                                            {isLoading ? 'Creating...' : 'Create Missing Users'}
                                        </Button>
                                        <Button
                                            onClick={runTimesheetsMigration}
                                            disabled={isLoading}
                                            variant="outline-secondary"
                                        >
                                            {isLoading ? 'Migrating...' : 'Migrate Timesheets'}
                                        </Button>
                                        <Button
                                            onClick={loadStatus}
                                            disabled={isLoading}
                                            variant="outline-secondary"
                                        >
                                            Refresh Status
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {status?.error && (
                                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                                    <div className="font-semibold text-red-800">Error</div>
                                    <div className="text-sm text-red-700">{status.error}</div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Instructions */}
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
                        <h3 className="text-lg font-semibold text-text-primary mb-3">Migration Details</h3>
                        <div className="space-y-2 text-sm text-text-secondary">
                            <p><strong>What these migrations do:</strong></p>
                            <ul className="list-disc list-inside space-y-1 ml-4">
                                <li><strong>Restructure Users (Recommended):</strong> Moves user documents to use Firebase Auth user IDs as document IDs - more future-proof</li>
                                <li><strong>User Migration:</strong> Adds <code>managerUserId</code> field to user documents that don't have it</li>
                                <li><strong>Timesheets Migration:</strong> Adds <code>managerUserId</code> field to existing timesheet documents</li>
                                <li>Populates the field from existing <code>assignments</code> collection (primary source)</li>
                                <li>Falls back to <code>reportsTo</code> field if no assignment found</li>
                                <li>Sets the field to <code>null</code> for users without a manager</li>
                            </ul>
                            <p className="mt-3"><strong>Why this is needed:</strong></p>
                            <ul className="list-disc list-inside space-y-1 ml-4">
                                <li>Enables direct queries for manager-employee relationships</li>
                                <li>Improves performance of timesheet approval queries</li>
                                <li>Simplifies the approval workflow</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MigrationPage;
