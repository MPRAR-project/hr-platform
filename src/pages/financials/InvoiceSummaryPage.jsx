import React, { useState, useEffect, useMemo } from 'react';

import { useInvoiceCalculations } from '../../hooks/useInvoiceCalculations';
import InvoiceTable from '../../components/financials/InvoiceTable';
import { Loader2, Download, Settings, ChevronLeft, ChevronRight, Menu } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useUI } from '../../hooks/useUI';
import { getUserWeekContext } from '../../services/timesheets';
import { getSites } from '../../services/sites';
import { getClients } from '../../services/clients';
import { resolveWeekStartDay } from '../../services/weekStartConfig';
import {
    formatISODate,
    getWeekRangeForDate,
    shiftDateByWeeks,
    normalizeWeekStartDay,
    DEFAULT_WEEK_START_DAY,
    describeWeek
} from '../../utils/weekStartUtils';

const InvoiceSummaryPage = () => {
    const { user } = useAuth();
    const { openSidebar } = useUI();

    // Configuration State
    const [weekStartDay, setWeekStartDay] = useState(DEFAULT_WEEK_START_DAY);
    const [isConfigLoading, setIsConfigLoading] = useState(true);

    // Navigation State (Anchor Date)
    const [anchorDate, setAnchorDate] = useState(new Date());

    // Fetch User/Company Week Configuration
    useEffect(() => {
        const loadConfig = async () => {
            if (user?.uid) {
                console.log('[InvoiceSummary] Loading config for user:', user.uid, 'Company:', user.companyId);
                try {
                    let resolvedFnStr = DEFAULT_WEEK_START_DAY;

                    // Optimization: If we already have company/site in the user object, resolve directly
                    if (user.companyId) {
                        console.log('[InvoiceSummary] Resolving directly from user object props...');
                        resolvedFnStr = await resolveWeekStartDay(user.companyId, user.siteId);
                        console.log('[InvoiceSummary] Resolved from user object:', resolvedFnStr);
                    } else {
                        // Fallback to fetching context if user object is incomplete
                        console.log('[InvoiceSummary] Fetching context from DB...');
                        const ctx = await getUserWeekContext(user.uid, { forceRefresh: true });
                        console.log('[InvoiceSummary] getUserWeekContext result:', ctx);
                        if (ctx?.weekStartDay) {
                            resolvedFnStr = ctx.weekStartDay;
                        }
                    }

                    const normalized = normalizeWeekStartDay(resolvedFnStr || user?.weekStartDay || DEFAULT_WEEK_START_DAY);
                    console.log('[InvoiceSummary] Final normalized start day:', normalized);
                    setWeekStartDay(normalized);

                } catch (error) {
                    console.warn('[InvoiceSummary] Failed to load week config', error);
                    // Try to recover from user object
                    if (user?.weekStartDay) {
                        const normalized = normalizeWeekStartDay(user.weekStartDay);
                        console.log('[InvoiceSummary] Error recovery using user.weekStartDay:', normalized);
                        setWeekStartDay(normalized);
                    }
                } finally {
                    setIsConfigLoading(false);
                }
            } else if (user?.weekStartDay) {
                const normalized = normalizeWeekStartDay(user.weekStartDay);
                console.log('[InvoiceSummary] No UID, using user.weekStartDay:', normalized);
                setWeekStartDay(normalized);
                setIsConfigLoading(false);
            } else {
                console.log('[InvoiceSummary] No user context available yet.');
                setIsConfigLoading(false);
            }
        };
        loadConfig();
    }, [user?.uid, user?.companyId, user?.siteId, user?.weekStartDay]);

    // Load sites and clients for filters
    useEffect(() => {
        const loadFilters = async () => {
            if (user?.companyId) {
                try {
                    const [allSites, allClients] = await Promise.all([
                        getSites(user.companyId),
                        getClients(user.companyId)
                    ]);
                    setSites(allSites);
                    setClients(allClients);
                } catch (error) {
                    console.error('Failed to load filters:', error);
                }
            }
        };
        loadFilters();
    }, [user?.companyId]);

    // Derived State: Current Week Range
    const currentRange = useMemo(() => {
        console.log('[InvoiceSummary] Recalculating range for:', anchorDate.toISOString(), 'StartDay:', weekStartDay);
        const { start, end } = getWeekRangeForDate(anchorDate, weekStartDay);
        console.log('[InvoiceSummary] Content Range Result:', { start: start.toISOString(), end: end.toISOString() });
        return { start, end };
    }, [anchorDate, weekStartDay]);

    // Derived State: Dates Array for Table
    const dates = useMemo(() => {
        const arr = [];
        if (currentRange.start && currentRange.end) {
            let curr = new Date(currentRange.start);
            while (curr <= currentRange.end) {
                arr.push(formatISODate(curr));
                curr.setDate(curr.getDate() + 1);
            }
        }
        return arr;
    }, [currentRange]);

    // Derived State: Human Readable Label
    const weekLabel = useMemo(() => {
        const desc = describeWeek(anchorDate, weekStartDay);
        return `${desc.startLabel} - ${desc.endLabel}`;
    }, [anchorDate, weekStartDay]);

    const [mode, setMode] = useState('pay');
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [visibleColumns, setVisibleColumns] = useState({});
    const [sites, setSites] = useState([]);
    const [clients, setClients] = useState([]);
    const [selectedSite, setSelectedSite] = useState('all');
    const [selectedClient, setSelectedClient] = useState('all');

    // Navigation Handlers
    const handlePrevWeek = () => {
        setAnchorDate(prev => shiftDateByWeeks(prev, -1, weekStartDay));
    };

    const handleNextWeek = () => {
        setAnchorDate(prev => shiftDateByWeeks(prev, 1, weekStartDay));
    };

    const handleToday = () => {
        setAnchorDate(new Date());
    };

    // Initialize/Update columns when dates change
    useEffect(() => {
        const initialCols = {
            'employee': true,
            'type': true
        };
        dates.forEach(d => {
            initialCols[d] = true;
        });
        initialCols['rate'] = true;
        initialCols['total'] = true;
        setVisibleColumns(prev => {
            // Preserve explicit user choices if possible, but ensure new dates are added
            // For simplicity, we reset on week change to ensure correct columns exist
            return initialCols;
        });
    }, [dates.join(',')]); // Depend on the actual date strings

    const { data, loading, error } = useInvoiceCalculations(currentRange, user);

    const handleExportPDF = async () => {
        const { generateInvoicePDF } = await import('../../utils/pdfExport');
        generateInvoicePDF(data, dates, mode, currentRange, visibleColumns);
        setShowExportMenu(false);
    };

    const getColumnLabel = (key) => {
        if (key === 'employee') return 'Employee Name';
        if (key === 'type') return 'Type (Basic/OT)';
        if (key === 'rate') return 'Rate';
        if (key === 'total') return 'Total Payment';
        // Check if date
        if (key.match(/^\d{4}-\d{2}-\d{2}$/)) {
            const d = new Date(key);
            return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
        }
        return key;
    };

    return (
        <div className="p-6 relative">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                <div className="flex items-center">

                    <button
                        onClick={openSidebar}
                        className="lg:hidden mr-3 p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                    >
                        <Menu className="w-6 h-6" />
                    </button>
                    <h1 className="text-2xl font-bold text-gray-900">Invoice Summary</h1>
                </div>

                {/* Week Navigation */}
                <div className="flex items-center bg-white rounded-lg border border-gray-200 p-1 shadow-sm">
                    <button
                        onClick={handlePrevWeek}
                        className="p-1 hover:bg-gray-100 rounded-md text-gray-500"
                        title="Previous Week"
                    >
                        <ChevronLeft className="w-5 h-5" />
                    </button>
                    <div className="px-4 font-medium text-gray-700 w-48 text-center text-sm">
                        {weekLabel}
                    </div>
                    <button
                        onClick={handleNextWeek}
                        className="p-1 hover:bg-gray-100 rounded-md text-gray-500"
                        title="Next Week"
                    >
                        <ChevronRight className="w-5 h-5" />
                    </button>
                    <div className="w-px h-6 bg-gray-200 mx-2"></div>
                    <button
                        onClick={handleToday}
                        className="text-xs font-medium text-blue-600 hover:text-blue-700 px-2"
                    >
                        Today
                    </button>
                </div>

                <div className="flex items-center gap-3">
                    <label htmlFor="site-filter" className="sr-only">Filter by Site</label>
                    <select
                        id="site-filter"
                        value={selectedSite}
                        onChange={(e) => setSelectedSite(e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                        <option value="all">All Sites</option>
                        {sites.map(site => (
                            <option key={site.id} value={site.id}>{site.name}</option>
                        ))}
                    </select>

                    <label htmlFor="client-filter" className="sr-only">Filter by Client</label>
                    <select
                        id="client-filter"
                        value={selectedClient}
                        onChange={(e) => setSelectedClient(e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                        <option value="all">All Clients</option>
                        {clients.map(client => (
                            <option key={client.id} value={client.id}>{client.name}</option>
                        ))}
                    </select>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowExportMenu(!showExportMenu)}
                        className="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium flex items-center gap-2 text-sm sm:text-base transition-colors"
                        title="Export Options"
                    >
                        <Settings className="w-4 h-4" />
                        <span className="hidden md:inline">Options</span>
                    </button>
                    <div className="w-px h-6 bg-gray-200 mx-1"></div>
                    <button
                        onClick={handleExportPDF}
                        disabled={loading || !data}
                        className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm sm:text-base disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Download className="w-4 h-4" />
                        <span className="hidden sm:inline">Export PDF</span>
                    </button>
                </div>
            </div>

            {/* Export Menu Dropdown */}
            {
                showExportMenu && (
                    <div className="absolute right-6 top-20 w-64 bg-white border border-gray-200 rounded-lg shadow-xl z-20 p-3 max-h-96 overflow-y-auto">
                        <h3 className="text-sm font-medium text-gray-900 mb-2 border-b pb-1">Export Columns</h3>
                        <div className="space-y-2">
                            {/* Order: Employee, Type, Dates..., Rate, Total */}
                            {['employee', 'type', ...dates, 'rate', 'total'].map(key => (
                                <label key={key} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer hover:bg-gray-50 p-1 rounded">
                                    <input
                                        type="checkbox"
                                        checked={!!visibleColumns[key]}
                                        onChange={e => setVisibleColumns(prev => ({ ...prev, [key]: e.target.checked }))}
                                        className="rounded text-blue-600 focus:ring-blue-500"
                                    />
                                    {getColumnLabel(key)}
                                </label>
                            ))}
                        </div>
                    </div>
                )
            }

            {/* Tabs */}
            <div className="border-b border-gray-200 mb-4">
                <nav className="-mb-px flex space-x-8">
                    <button
                        onClick={() => setMode('pay')}
                        className={`whitespace-nowrap pb-4 px-1 border-b-2 font-medium text-sm transition-colors ${mode === 'pay'
                            ? 'border-blue-500 text-blue-600'
                            : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                            }`}
                    >
                        Paid Rates (Payroll)
                    </button>
                    <button
                        onClick={() => setMode('charge')}
                        className={`whitespace-nowrap pb-4 px-1 border-b-2 font-medium text-sm transition-colors ${mode === 'charge'
                            ? 'border-blue-500 text-blue-600'
                            : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                            }`}
                    >
                        Charge Back (Client)
                    </button>
                </nav>
            </div>

            {/* Content */}
            {
                (loading || isConfigLoading) ? (
                    <div className="flex justify-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                    </div>
                ) : error ? (
                    <div className="bg-red-50 text-red-600 p-4 rounded-lg">
                        Error loading data: {error.message}
                    </div>
                ) : (
                    <MemoizedInvoiceContent
                        data={data}
                        selectedSite={selectedSite}
                        selectedClient={selectedClient}
                        sites={sites}
                        dates={dates}
                        mode={mode}
                    />
                )
            }
        </div >
    );
};

const MemoizedInvoiceContent = ({ data, selectedSite, selectedClient, sites, dates, mode }) => {
    const filteredData = useMemo(() => {
        const filtered = {};
        Object.entries(data || {}).forEach(([userId, item]) => {
            const matchesSite = selectedSite === 'all' ||
                item.user?.siteId === selectedSite ||
                item.user?.siteId === `sites/${selectedSite}`;

            let matchesClient = selectedClient === 'all';
            if (!matchesClient && item.user?.siteId) {
                const userSite = sites.find(s => s.id === item.user.siteId || `sites/${s.id}` === item.user.siteId);
                if (userSite) {
                    matchesClient = userSite.clientId === selectedClient;
                }
            }

            if (matchesSite && matchesClient) {
                filtered[userId] = item;
            }
        });
        return filtered;
    }, [data, selectedSite, selectedClient, sites]);

    return <InvoiceTable data={filteredData} dates={dates} mode={mode} />;
};

export default InvoiceSummaryPage;
