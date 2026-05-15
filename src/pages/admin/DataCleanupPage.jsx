import React, { useState } from 'react';
import { scanDataForCleanup, performDataCleanup } from '../../services/superAdminService';
import { Trash2, Search, AlertTriangle, ShieldAlert, CheckCircle } from 'lucide-react';
import Header from '../../components/layout/Header';
import Loader from '../../components/ui/Loader';
import { toast } from 'react-toastify';
import { useAuth } from '../../hooks/useAuth';
import { useCache } from '../../contexts/CacheContext';
import { clearPlatformCache } from '../../services/platformDashboardService';

const DataCleanupPage = () => {
    const { user } = useAuth();
    const [targetId, setTargetId] = useState('');
    const [targetType, setTargetType] = useState('companyId');
    const [isLoading, setIsLoading] = useState(false);
    const [scanResult, setScanResult] = useState(null);
    const [deleteProgress, setDeleteProgress] = useState(null);
    const [confirmText, setConfirmText] = useState('');
    const { clearItemsByPrefix, clearAll } = useCache();
    const [onlyFake, setOnlyFake] = useState(true);

    const FAKE_DOMAINS = ['.test', 'worker', 'fake', 'seed', 'example.com', 'test.com', 'workerw'];

    // Only allow specific roles (although route should be protected)
    const canAccess = ['developer', 'site_owner', 'admin'].includes(user?.role) || user?.email?.includes('admin'); // Fallback check

    const handleScan = async () => {
        if (!targetId.trim()) {
            toast.error('Please enter a valid ID');
            return;
        }

        setIsLoading(true);
        setScanResult(null);
        setDeleteProgress(null);

        try {
            const data = await scanDataForCleanup(targetType, targetId.trim(), { onlyFake });
            
            setScanResult({
                timesheetsCount: data.counts.timesheets,
                sessionsCount: data.counts.sessions,
                usersCount: data.counts.users,
                profilesCount: data.counts.profiles,
                // No need to store docs refs anymore as server handles execution
            });

            const total = data.counts.timesheets + data.counts.sessions + data.counts.users + data.counts.profiles;
            if (total === 0) {
                toast.info('No records found for this ID.');
            } else {
                toast.success(`Found ${total} total records via REST.`);
            }

        } catch (error) {
            console.error('[Cleanup] Scan failed:', error);
            toast.error('Scan failed: ' + (error.response?.data?.error || error.message));
        } finally {
            setIsLoading(false);
        }
    };

    const handleDelete = async () => {
        if (confirmText !== 'DELETE') {
            toast.error('Please type DELETE to confirm.');
            return;
        }
        if (!scanResult) return;

        setIsLoading(true);
        const totalToStep = scanResult.timesheetsCount + scanResult.sessionsCount + scanResult.usersCount + scanResult.profilesCount;
        setDeleteProgress({ total: totalToStep, deleted: 0 });

        try {
            await performDataCleanup(targetType, targetId.trim(), { onlyFake });

            // Clear cache
            if (targetType === 'companyId') {
                clearItemsByPrefix(`paginated_users_${targetId.trim()}`);
                clearItemsByPrefix(`userGroups_${targetId.trim()}`);
                clearItemsByPrefix(`platform_stats_${targetId.trim()}`);
                clearPlatformCache();
            } else {
                clearAll();
                clearPlatformCache();
            }

            toast.success('Deletion completed successfully and cache cleared via REST.');
            setScanResult(null);
            setConfirmText('');
            setTargetId('');

        } catch (error) {
            console.error('[Cleanup] Delete failed:', error);
            toast.error('Delete failed: ' + (error.response?.data?.error || error.message));
        } finally {
            setIsLoading(false);
            setDeleteProgress(null);
        }
    };

    return (
        <div className="flex flex-col h-full bg-gray-50">
            <Header
                title="Data Cleanup Tool"
                subtitle="Bulk delete timesheet data by Company or Site ID. Use with caution."
            />

            <div className="flex-1 p-6 overflow-y-auto">
                <div className="max-w-3xl mx-auto space-y-6">

                    {/* Warning Card */}
                    <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-md shadow-sm">
                        <div className="flex items-start">
                            <AlertTriangle className="w-6 h-6 text-red-600 mt-0.5 mr-3" />
                            <div>
                                <h3 className="text-red-800 font-bold">Warning: Destructive Actions</h3>
                                <p className="text-red-700 text-sm mt-1">
                                    Files deleted here cannot be recovered. This tool permanently removes Timesheets, Sessions, Users, and Profiles.
                                    Ensure you have the correct ID before scanning and deleting.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Scan Controls */}
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                        <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center">
                            <Search className="w-5 h-5 mr-2 text-purple-600" />
                            Step 1: Scan for Data
                        </h2>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Target Type</label>
                                <select
                                    value={targetType}
                                    onChange={e => setTargetType(e.target.value)}
                                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500"
                                >
                                    <option value="companyId">By Company ID</option>
                                    <option value="siteId">By Site ID</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Target ID</label>
                                <input
                                    type="text"
                                    value={targetId}
                                    onChange={e => setTargetId(e.target.value)}
                                    placeholder={targetType === 'companyId' ? "e.g. comp_123..." : "e.g. site_abc..."}
                                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500"
                                />
                                <p className="text-xs text-gray-400 mt-1">Enter the exact Firestore ID string.</p>
                            </div>
                        </div>

                        {targetType === 'companyId' && (
                            <div className="mb-4 flex items-center">
                                <input
                                    type="checkbox"
                                    id="onlyFake"
                                    checked={onlyFake}
                                    onChange={e => setOnlyFake(e.target.checked)}
                                    className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                                />
                                <label htmlFor="onlyFake" className="ml-2 text-sm text-gray-600 cursor-pointer">
                                    Only Scan/Delete Fake Users (emails with .test, worker, fake, etc.)
                                </label>
                            </div>
                        )}

                        <button
                            onClick={handleScan}
                            disabled={isLoading || !targetId}
                            className={`w-full py-2 px-4 rounded-md font-medium transition-colors flex items-center justify-center ${isLoading || !targetId
                                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                : 'bg-purple-600 text-white hover:bg-purple-700'
                                }`}
                        >
                            {isLoading ? <Loader size="sm" color="white" /> : 'Scan Database'}
                        </button>
                    </div>

                    {/* Results & Delete Action */}
                    {scanResult && (
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 animate-in fade-in slide-in-from-bottom-4">
                            <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center text-red-600">
                                <ShieldAlert className="w-5 h-5 mr-2" />
                                Step 2: Confirm Deletion
                            </h2>

                            <div className="bg-gray-50 p-4 rounded-lg mb-6 border border-gray-200">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                                    <div className="p-3 bg-white rounded shadow-sm">
                                        <p className="text-2xl font-bold text-gray-900">{scanResult.timesheetsCount}</p>
                                        <p className="text-xs text-gray-500 uppercase tracking-wide">Timesheets</p>
                                    </div>
                                    <div className="p-3 bg-white rounded shadow-sm">
                                        <p className="text-2xl font-bold text-gray-900">{scanResult.sessionsCount}</p>
                                        <p className="text-xs text-gray-500 uppercase tracking-wide">Sessions</p>
                                    </div>
                                    <div className="p-3 bg-white rounded shadow-sm">
                                        <p className="text-2xl font-bold text-gray-900">{scanResult.usersCount}</p>
                                        <p className="text-xs text-gray-500 uppercase tracking-wide">Users</p>
                                    </div>
                                    <div className="p-3 bg-white rounded shadow-sm">
                                        <p className="text-2xl font-bold text-gray-900">{scanResult.profilesCount}</p>
                                        <p className="text-xs text-gray-500 uppercase tracking-wide">Profiles</p>
                                    </div>
                                </div>
                                <div className="mt-4 text-center">
                                    <p className="font-medium text-gray-700">Total Items to Delete: {scanResult.timesheetsCount + scanResult.sessionsCount + scanResult.usersCount + scanResult.profilesCount}</p>
                                </div>
                            </div>

                            {scanResult.timesheetsCount + scanResult.sessionsCount + scanResult.usersCount + scanResult.profilesCount > 0 ? (
                                <div className="border-t border-gray-200 pt-6">
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Type <span className="font-bold text-red-600">DELETE</span> to confirm
                                    </label>
                                    <div className="flex gap-3">
                                        <input
                                            type="text"
                                            value={confirmText}
                                            onChange={e => setConfirmText(e.target.value)}
                                            placeholder="DELETE"
                                            className="flex-1 p-2 border border-red-300 rounded-md focus:ring-red-500 focus:border-red-500 text-red-600 font-bold"
                                        />
                                        <button
                                            onClick={handleDelete}
                                            disabled={isLoading || confirmText !== 'DELETE'}
                                            className={`px-6 py-2 rounded-md font-bold text-white transition-colors flex items-center ${confirmText === 'DELETE'
                                                ? 'bg-red-600 hover:bg-red-700 shadow-md'
                                                : 'bg-gray-300 cursor-not-allowed'
                                                }`}
                                        >
                                            {isLoading && deleteProgress ? (
                                                <span>Deleting {deleteProgress.deleted} / {deleteProgress.total}...</span>
                                            ) : (
                                                <>
                                                    <Trash2 className="w-4 h-4 mr-2" />
                                                    DELETE ALL
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center text-gray-500 py-2">
                                    <CheckCircle className="w-8 h-8 mx-auto text-green-500 mb-2" />
                                    <p>Nothing to clean up!</p>
                                </div>
                            )}
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
};

export default DataCleanupPage;
