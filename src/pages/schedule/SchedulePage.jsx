import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../hooks/useAuth';
import Tabs from '../../components/ui/Tabs';
import ScheduleCalendar from './components/ScheduleCalendar';
import Header from '../../components/layout/Header';
import { Search, User, Briefcase, Calendar } from 'lucide-react';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Loader from '../../components/ui/Loader';
import { getUsersByCompany } from '../../services/users';
import { getRoleName } from '../../utils/getRoleName';

const SchedulePage = () => {
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState('My Schedule');
    const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
    const [employees, setEmployees] = useState([]);
    const [loadingEmployees, setLoadingEmployees] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterRole, setFilterRole] = useState('All Roles');

    const isManager = ['siteManager', 'adminManager', 'superUser', 'teamManager', 'seniorManager'].includes(user?.role);
    const canViewAll = ['siteManager', 'adminManager', 'superUser', 'seniorManager'].includes(user?.role);
    const isSiteManager = user?.role === 'siteManager';

    // Available Tabs
    const tabs = useMemo(() => {
        if (isSiteManager) {
            return [{ label: 'All Schedules' }];
        }
        const t = [{ label: 'My Schedule' }];
        // Managers get All Schedules too
        if (isManager) {
            t.push({ label: 'All Schedules' });
        }
        return t;
    }, [isManager, isSiteManager]);

    // Initial Tab Selection based on available tabs
    useEffect(() => {
        // If the current active tab is not in the available tabs, switch to the first available
        const currentTabExists = tabs.some(t => t.label === activeTab);
        if (!currentTabExists && tabs.length > 0) {
            setActiveTab(tabs[0].label);
        }
    }, [tabs, activeTab]);

    // Load Employees for "All Schedules" tab
    useEffect(() => {
        if (activeTab === 'All Schedules' && isManager) {
            const load = async () => {
                setLoadingEmployees(true);
                try {
                    console.log('🔄 Loading employees for All Schedules...');
                    const startTime = Date.now();

                    const data = await getUsersByCompany(user.companyId);
                    console.log('🔍 Raw user data from getUsersByCompany:', data.length, 'users');
                    console.log('🔍 Load time:', Date.now() - startTime, 'ms');

                    // Show all users except current logged-in user
                    let filteredData = data.filter(u => u.id !== (user.id || user.userId));
                    console.log('🔍 Current user ID:', user.id || user.userId);
                    console.log('🔍 After filtering current user:', filteredData.length, 'users');

                    setEmployees(filteredData);
                    console.log('📊 Employees loaded for All Schedules:', filteredData.length, 'users');
                } catch (e) {
                    console.error('Error loading employees:', e);
                    toast.error('Failed to load employees');
                } finally {
                    setLoadingEmployees(false);
                }
            };
            load();
        }
    }, [activeTab, isManager, user?.companyId, user?.id, user?.uid]);

    // Filtering Logic
    const filteredEmployees = useMemo(() => {
        let result = [...employees];
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter(e =>
                (e.displayName || '').toLowerCase().includes(q) ||
                (e.email || '').toLowerCase().includes(q)
            );
        }
        if (filterRole !== 'All Roles') {
            result = result.filter(e => {
                const role = e.primaryRole || e.role;
                return getRoleName(role) === filterRole || role === filterRole;
            });
        }
        return result;
    }, [employees, searchQuery, filterRole]);

    const availableRoles = useMemo(() => {
        const roles = new Set(employees.map(e => {
            const role = e.primaryRole || e.role;
            return role ? getRoleName(role) : 'Unknown';
        }));
        return Array.from(roles);
    }, [employees]);


    // Render Content
    return (
        <div className="h-screen flex flex-col overflow-hidden bg-gray-50">
            <Header
                title="Schedule Management"
                subtitle="Manage assignments and view shifts."
            />

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 scrollbar-custom">
                <div className="max-w-[1600px] mx-auto space-y-6">

                    {/* Tabs (only if multiple) */}
                    {tabs.length > 1 && !selectedEmployeeId && (
                        <div className="mb-6">
                            <Tabs
                                tabs={tabs}
                                activeTab={activeTab}
                                onTabChange={setActiveTab}
                            />
                        </div>
                    )}

                    {/* View: My Schedule */}
                    {activeTab === 'My Schedule' && !selectedEmployeeId && (
                        <ScheduleCalendar targetUserId={user.userId} />
                    )}

                    {/* View: All Schedules (Employee List) */}
                    {activeTab === 'All Schedules' && !selectedEmployeeId && (
                        <div className="space-y-6">
                            {/* Controls */}
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                                <div className="relative w-full sm:w-96">
                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="Search employees..."
                                        className="w-full h-11 pl-12 pr-4 border border-gray-300 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                                    />
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="text-sm text-gray-500">Filter by Role:</span>
                                    <select
                                        value={filterRole}
                                        onChange={(e) => setFilterRole(e.target.value)}
                                        aria-label="Filter by employee role"
                                        className="h-11 px-4 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    >
                                        <option>All Roles</option>
                                        {availableRoles.map(r => <option key={r} value={r}>{r}</option>)}
                                    </select>
                                </div>
                            </div>

                            {/* List */}
                            {loadingEmployees ? (
                                <Loader variant="spinner" text="Loading employees..." />
                            ) : (
                                <div className="grid gap-4">
                                    {filteredEmployees.map(emp => (
                                        <div key={emp.id} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-all flex flex-col md:flex-row justify-between items-center gap-4">
                                            <div className="flex items-center gap-4 w-full">
                                                <div className="h-12 w-12 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 font-bold text-lg">
                                                    {(emp.displayName || emp.email || '?').charAt(0).toUpperCase()}
                                                </div>
                                                <div>
                                                    <h3 className="font-semibold text-gray-900">
                                                        {emp.displayName ||
                                                            `${emp.firstName || ''} ${emp.lastName || ''}`.trim() ||
                                                            ''}
                                                    </h3>
                                                    <p className="text-sm text-gray-500">{emp.email}</p>
                                                    <div className="flex gap-2 mt-1">
                                                        <Badge variant={(() => {
                                                            const r = emp.primaryRole || emp.role;
                                                            if (['superUser', 'siteManager'].includes(r)) return 'role';
                                                            if (['adminManager', 'hrManager', 'seniorManager'].includes(r)) return 'warning';
                                                            if (['teamManager'].includes(r)) return 'success';
                                                            return 'info';
                                                        })()}>
                                                            {getRoleName(emp.primaryRole || emp.role)}
                                                        </Badge>
                                                    </div>
                                                </div>
                                            </div>
                                            <Button
                                                variant="outline-primary"
                                                onClick={() => setSelectedEmployeeId(emp.id)}
                                                cn="w-full md:w-auto whitespace-nowrap"
                                            >
                                                View Schedule
                                            </Button>
                                        </div>
                                    ))}
                                    {filteredEmployees.length === 0 && (
                                        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
                                            <User className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                                            <p className="text-gray-500">No employees found.</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* View: User Detail (When Selected) */}
                    {selectedEmployeeId && (
                        <div className="animation-fade-in">
                            <ScheduleCalendar
                                targetUserId={selectedEmployeeId}
                                onBack={() => setSelectedEmployeeId(null)}
                            />
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
};

export default SchedulePage;
