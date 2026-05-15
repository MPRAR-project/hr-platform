import React, { useEffect, useState, useMemo } from 'react';
import Header from '../../components/layout/Header';
import Button from '../../components/ui/Button';
import SectionContainer from '../../components/shared/SectionContainer';
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '../../components/shared/Table';
import Badge from '../../components/ui/Badge';
import { fetchAllUsers, fetchUsersByCompanyGrouped } from '../../services/superAdminService';
import { useAuth } from '../../hooks/useAuth';
import { toast } from 'react-toastify';
import { Search, ChevronDown, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCache } from '../../contexts/CacheContext';

const SuperAdminUserListPage = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const { getItem, setItem } = useCache();

    const CACHE_KEY_ALL = 'superadmin_users_all';
    const CACHE_KEY_BY_COMPANY = 'superadmin_users_by_company';

    const [users, setUsers] = useState(() => getItem(CACHE_KEY_ALL) || []);
    const [loading, setLoading] = useState(!(getItem(CACHE_KEY_ALL) || getItem(CACHE_KEY_BY_COMPANY)));
    const [searchTerm, setSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useState('all'); // 'all' | 'byCompany'
    const [companiesData, setCompaniesData] = useState(() => getItem(CACHE_KEY_BY_COMPANY) || {}); // { companyId: { name, users: [] } }
    const [expandedCompanies, setExpandedCompanies] = useState(new Set());

    // Pagination State
    const [lastVisible, setLastVisible] = useState(null);
    const [pageHistory, setPageHistory] = useState([]); // Stack of startAfter docs to go back
    const [page, setPage] = useState(1);
    const PAGE_SIZE = 20;

    // Helper function to normalize status
    const normalizeStatus = (status) => {
        if (!status) return 'active';

        // Convert to lowercase for comparison
        const normalized = status.toLowerCase();

        // Check if it's a valid status
        if (['active', 'suspended', 'inactive', 'pending'].includes(normalized)) {
            return normalized;
        }

        return 'active'; // Default to active for unknown values
    };

    // Helper function to get display text
    const getStatusDisplay = (status) => {
        const normalized = normalizeStatus(status);
        // Capitalize first letter for display
        return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    };

    // Helper function to get badge variant
    const getStatusVariant = (status) => {
        const normalized = normalizeStatus(status);
        switch (normalized) {
            case 'active':
                return 'success'; // Green
            case 'suspended':
                return 'danger'; // Red
            case 'inactive':
            case 'pending':
                return 'warning'; // Orange/Yellow
            default:
                return 'warning';
        }
    };

    const formatRoles = (role) => {
        if (!role) return 'N/A';
        return role.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, c => c.toUpperCase());
    };

    useEffect(() => {
        if (user?.role !== 'superUser') {
            navigate('/');
            return;
        }
        if (activeTab === 'all') {
            fetchUsers(true);
        } else {
            fetchUsersByCompany();
        }
    }, [user, navigate, activeTab]);

    const fetchUsers = async (loadNext = true, isSearch = false) => {
        try {
            setLoading(true);
            
            const params = {
                limit: PAGE_SIZE,
                page: loadNext ? page : 1,
                search: searchTerm && searchTerm.trim() !== '' ? searchTerm : undefined
            };

            const data = await fetchAllUsers(params);
            const uniqueUsers = (data.users || data || []).map(u => ({
                ...u,
                id: u.id || u.userId
            }));

            setUsers(uniqueUsers);

            // PERSIST: Cache page 1 results
            if (page === 1 && !searchTerm) {
                setItem(CACHE_KEY_ALL, uniqueUsers, 10 * 60 * 1000);
            }

        } catch (error) {
            console.error("[SuperAdmin] Error fetching users via REST:", error);
            toast.error("Failed to load users");
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = (e) => {
        e.preventDefault();
        fetchUsers(false, true);
    };

    const handleNextPage = () => {
        setPage(p => p + 1);
        fetchUsers(true);
    };

    const handleReset = () => {
        setSearchTerm('');
        setPage(1);
        fetchUsers(false);
    };

    const fetchUsersByCompany = async () => {
        try {
            setLoading(true);
            const grouped = await fetchUsersByCompanyGrouped();
            
            setCompaniesData(grouped);
            setItem(CACHE_KEY_BY_COMPANY, grouped, 15 * 60 * 1000);

            // Expand all companies by default
            setExpandedCompanies(new Set(Object.keys(grouped)));

        } catch (error) {
            console.error("[SuperAdmin] Error fetching users by company via REST:", error);
            toast.error("Failed to load users by company");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-screen bg-bg-secondary font-sans overflow-hidden">
            <Header />
            <div className="flex-1 overflow-auto scrollbar-custom p-6">
                <div className="max-w-7xl mx-auto space-y-6">

                    {/* Page Header */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">User Database</h1>
                            <p className="text-sm text-gray-500">Global list of all users registered on the platform</p>
                        </div>

                        {/* Search Bar - Only show in "All Users" tab */}
                        {activeTab === 'all' && (
                            <form onSubmit={handleSearch} className="relative flex gap-2">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                                    <input
                                        type="text"
                                        placeholder="Search by email..."
                                        className="pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 w-full md:w-64"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                    />
                                </div>
                                <Button variant="outline-primary" type="submit" disabled={loading}>
                                    Search
                                </Button>
                                {searchTerm && (
                                    <Button variant="ghost" onClick={handleReset} type="button">
                                        Clear
                                    </Button>
                                )}
                            </form>
                        )}
                    </div>

                    {/* Tab Navigation */}
                    <div className="border-b border-gray-200">
                        <nav className="-mb-px flex space-x-8">
                            <button
                                onClick={() => setActiveTab('all')}
                                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'all'
                                    ? 'border-purple-500 text-purple-600'
                                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                    }`}
                            >
                                All Users
                            </button>
                            <button
                                onClick={() => setActiveTab('byCompany')}
                                className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'byCompany'
                                    ? 'border-purple-500 text-purple-600'
                                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                    }`}
                            >
                                By Company
                            </button>
                        </nav>
                    </div>

                    <SectionContainer className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        {loading ? (
                            <div className="flex items-center justify-center p-12">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
                            </div>
                        ) : activeTab === 'all' ? (
                            // All Users View
                            users.length === 0 ? (
                                <div className="text-center py-12 text-gray-500">
                                    {searchTerm ? "No users found matching that email." : "No users found in database."}
                                </div>
                            ) : (
                                <>
                                    <div className="overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableHeaderCell>NAME</TableHeaderCell>
                                                <TableHeaderCell>EMAIL</TableHeaderCell>
                                                <TableHeaderCell>ROLE</TableHeaderCell>
                                                <TableHeaderCell>STATUS</TableHeaderCell>
                                                <TableHeaderCell>REGISTERED</TableHeaderCell>
                                            </TableHeader>
                                            <TableBody>
                                                {users.map((user) => (
                                                    <TableRow key={user.id}>
                                                        <TableCell>
                                                            <div className="flex flex-col">
                                                                <span className="font-medium text-gray-900">
                                                                    {user.firstName && user.lastName
                                                                        ? `${user.firstName} ${user.lastName}`
                                                                        : (user.name || user.displayName || 'N/A')}
                                                                </span>
                                                                <span className="text-xs text-gray-500">{user.id}</span>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell>
                                                            <span className="text-gray-700">{user.email || 'N/A'}</span>
                                                        </TableCell>
                                                        <TableCell>
                                                            <Badge variant="outline-primary" className="capitalize">
                                                                {formatRoles(user.primaryRole || user.role)}
                                                            </Badge>
                                                        </TableCell>
                                                        <TableCell>
                                                            <Badge variant={getStatusVariant(user.status)}>
                                                                {getStatusDisplay(user.status)}
                                                            </Badge>
                                                        </TableCell>
                                                        <TableCell>
                                                            <span className="text-gray-500 text-sm">
                                                                {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}
                                                            </span>
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>

                                    {/* Pagination Controls */}
                                    <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-between items-center">
                                        <p className="text-xs text-gray-500">
                                            Showing {users.length} users (Page {page})
                                        </p>
                                        <div className="flex gap-2">
                                            {page > 1 && (
                                                <Button variant="outline-secondary" size="sm" onClick={handleReset}>
                                                    Start Over
                                                </Button>
                                            )}
                                            {users.length === PAGE_SIZE && (
                                                <Button variant="outline-primary" size="sm" onClick={handleNextPage} disabled={loading}>
                                                    Next Page
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                </>
                            )
                        ) : (
                            // By Company View
                            Object.keys(companiesData).length === 0 ? (
                                <div className="text-center py-12 text-gray-500">
                                    No companies found.
                                </div>
                            ) : (
                                <div className="divide-y divide-gray-100">
                                    {Object.entries(companiesData)
                                        .sort(([, a], [, b]) => a.name.localeCompare(b.name))
                                        .map(([companyId, companyData]) => {
                                            const isExpanded = expandedCompanies.has(companyId);
                                            return (
                                                <div key={companyId} className="border-b border-gray-100 last:border-0">
                                                    {/* Company Header */}
                                                    <button
                                                        onClick={() => {
                                                            const newExpanded = new Set(expandedCompanies);
                                                            if (isExpanded) {
                                                                newExpanded.delete(companyId);
                                                            } else {
                                                                newExpanded.add(companyId);
                                                            }
                                                            setExpandedCompanies(newExpanded);
                                                        }}
                                                        className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            {isExpanded ? (
                                                                <ChevronDown className="h-5 w-5 text-gray-400" />
                                                            ) : (
                                                                <ChevronRight className="h-5 w-5 text-gray-400" />
                                                            )}
                                                            <div className="text-left">
                                                                <h3 className="font-semibold text-gray-900">{companyData.name}</h3>
                                                                <p className="text-sm text-gray-500">
                                                                    {companyData.users.length} {companyData.users.length === 1 ? 'user' : 'users'}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <Badge variant="outline-secondary">
                                                            {companyData.users.length}
                                                        </Badge>
                                                    </button>

                                                    {/* Company Users Table */}
                                                    {isExpanded && (
                                                        <div className="bg-gray-50">
                                                            <Table>
                                                                <TableHeader>
                                                                    <TableHeaderCell>NAME</TableHeaderCell>
                                                                    <TableHeaderCell>EMAIL</TableHeaderCell>
                                                                    <TableHeaderCell>ROLE</TableHeaderCell>
                                                                    <TableHeaderCell>STATUS</TableHeaderCell>
                                                                    <TableHeaderCell>REGISTERED</TableHeaderCell>
                                                                </TableHeader>
                                                                <TableBody>
                                                                    {companyData.users.map((user) => (
                                                                        <TableRow key={user.id}>
                                                                            <TableCell>
                                                                                <div className="flex flex-col">
                                                                                    <span className="font-medium text-gray-900">
                                                                                        {user.firstName && user.lastName
                                                                                            ? `${user.firstName} ${user.lastName}`
                                                                                            : (user.name || user.displayName || 'N/A')}
                                                                                    </span>
                                                                                    <span className="text-xs text-gray-500">{user.id}</span>
                                                                                </div>
                                                                            </TableCell>
                                                                            <TableCell>
                                                                                <span className="text-gray-700">{user.email || 'N/A'}</span>
                                                                            </TableCell>
                                                                            <TableCell>
                                                                                <Badge variant="outline-primary" className="capitalize">
                                                                                    {formatRoles(user.primaryRole || user.role)}
                                                                                </Badge>
                                                                            </TableCell>
                                                                            <TableCell>
                                                                                <Badge variant={getStatusVariant(user.status)}>
                                                                                    {getStatusDisplay(user.status)}
                                                                                </Badge>
                                                                            </TableCell>
                                                                            <TableCell>
                                                                                <span className="text-gray-500 text-sm">
                                                                                    {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}
                                                                                </span>
                                                                            </TableCell>
                                                                        </TableRow>
                                                                    ))}
                                                                </TableBody>
                                                            </Table>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                </div>
                            )
                        )}
                    </SectionContainer>
                </div>
            </div>
        </div>
    );
};

export default SuperAdminUserListPage;