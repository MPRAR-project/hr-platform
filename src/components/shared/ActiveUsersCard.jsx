/**
 * Active Users Card Component
 * 
 * Displays a card showing all employees currently clocked in
 * Shows employee name, role, clock-in time, and elapsed time
 * Updates in real-time as employees clock in/out
 * 
 * Features:
 * - Real-time updates via Firestore listener
 * - Displays user information: name, role, clock-in time, elapsed time
 * - Shows "No active users" message when nobody is clocked in
 * - Loading state while fetching data
 * - Error handling with user-friendly messages
 * - Responsive card layout
 */

import { AlertCircle, Clock, RefreshCw, Users } from 'lucide-react';
import React, { useEffect } from 'react';
import { useActiveSessions } from '../../hooks/useActiveSessions';
import { useAuth } from '../../hooks/useAuth';

const ActiveUsersCard = () => {
    const { activeUsers, isLoading, error, refresh, count } = useActiveSessions();
    const { user } = useAuth();

    // Auto-refresh elapsed time display every minute
    const [, setRefreshCounter] = React.useState(0);

    useEffect(() => {
        // Update the display every minute to keep elapsed time current
        const interval = setInterval(() => {
            setRefreshCounter(prev => prev + 1);
        }, 60000); // Update every 60 seconds

        return () => clearInterval(interval);
    }, []);

    // Only show for owners/managers who can see all employees
    const userRole = (user?.role || user?.primaryRole || '').toLowerCase();
    const canViewActiveUsers = userRole.includes('admin') ||
        userRole.includes('manager') ||
        userRole.includes('hr') ||
        userRole.includes('owner') ||
        userRole.includes('site');

    // Log for debugging
    // Log for debugging
    // console.log('[ActiveUsersCard] User role check:', {
    //     userRole: user?.role,
    //     primaryRole: user?.primaryRole,
    //     normalizedRole: userRole,
    //     canView: canViewActiveUsers
    // });

    if (!canViewActiveUsers) {
        console.log('[ActiveUsersCard] User not authorized to view active users');
        return null;
    }

    return (
        <div className="bg-white rounded-lg shadow-sm border border-border-secondary p-6">
            {/* Header Section */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-green-100 rounded-lg">
                        <Users className="h-5 w-5 text-green-600" />
                    </div>
                    <div>
                        <h2 className="text-lg font-semibold text-text-primary">Active Users</h2>
                        <p className="text-sm text-text-secondary">
                            Employees currently clocked in
                        </p>
                    </div>
                </div>

                {/* Refresh Button */}
                <button
                    onClick={refresh}
                    disabled={isLoading}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
                    title="Refresh active users"
                >
                    <RefreshCw
                        className={`h-4 w-4 text-text-secondary ${isLoading ? 'animate-spin' : ''}`}
                    />
                </button>
            </div>

            {/* Active Users Count Badge */}
            <div className="mb-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-green-50 rounded-full">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                    <span className="text-sm font-medium text-green-700">
                        {count} {count === 1 ? 'person' : 'people'} active
                    </span>
                </div>
            </div>

            {/* Loading State */}
            {isLoading && (
                <div className="flex items-center justify-center py-8">
                    <div className="text-center">
                        <div className="inline-block">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-text-accent-blue"></div>
                        </div>
                        <p className="mt-2 text-sm text-text-secondary">Loading active users...</p>
                    </div>
                </div>
            )}

            {/* Error State */}
            {error && !isLoading && (
                <div className="flex items-center gap-3 p-3 bg-red-50 rounded-lg border border-red-200">
                    <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                    <p className="text-sm text-red-700">{error}</p>
                </div>
            )}

            {/* Empty State */}
            {!isLoading && !error && activeUsers.length === 0 && (
                <div className="flex items-center justify-center py-8">
                    <div className="text-center">
                        <div className="inline-block p-3 bg-gray-100 rounded-lg mb-2">
                            <Users className="h-6 w-6 text-text-secondary" />
                        </div>
                        <p className="text-sm font-medium text-text-primary">No active users</p>
                        <p className="text-xs text-text-secondary mt-1">
                            Employees will appear here when they clock in
                        </p>
                    </div>
                </div>
            )}

            {/* Active Users List */}
            {!isLoading && !error && activeUsers.length > 0 && (
                <div className="space-y-2">
                    {activeUsers.map((user) => (
                        <div
                            key={user.sessionId}
                            className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                        >
                            {/* User Info */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                                        <span className="text-xs font-semibold text-blue-700">
                                            {user.userName.charAt(0).toUpperCase()}
                                        </span>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-text-primary truncate">
                                            {user.userName}
                                        </p>
                                        <p className="text-xs text-text-secondary">
                                            {user.primaryRole}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Clock In Time and Elapsed */}
                            <div className="flex items-center gap-4 ml-4">
                                {/* Clock In Time */}
                                <div className="text-right">
                                    <div className="flex items-center gap-1 text-xs text-text-secondary mb-1">
                                        <Clock className="h-3 w-3" />
                                        Clocked In
                                    </div>
                                    <p className="text-sm font-medium text-text-primary">
                                        {user.clockInTimeFormatted}
                                    </p>
                                </div>

                                {/* Elapsed Time */}
                                <div className="text-right min-w-[60px]">
                                    <p className="text-xs text-text-secondary mb-1">Total Time</p>
                                    <p className="text-sm font-semibold text-green-600">
                                        {user.elapsedTime}
                                    </p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Footer Info */}
            {!isLoading && !error && activeUsers.length > 0 && (
                <div className="mt-4 pt-3 border-t border-border-secondary">
                    <p className="text-xs text-text-secondary text-center">
                        Last updated: {new Date().toLocaleTimeString('en-US', {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                        })}
                    </p>
                </div>
            )}
        </div>
    );
};

export default ActiveUsersCard;
