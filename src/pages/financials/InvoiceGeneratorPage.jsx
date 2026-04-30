import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db, functions } from '../../firebase/client';
import { httpsCallable } from 'firebase/functions';
import { useAuth } from '../../hooks/useAuth';
import { useInvoiceCalculations } from '../../hooks/useInvoiceCalculations';
import { getSites } from '../../services/sites';
import { getClients } from '../../services/clients';
import { getInvoiceSettings } from '../../services/invoiceSettings';
import { createInvoice, getInvoices } from '../../services/invoices';
import { generateFormalInvoicePDF } from '../../utils/formalPdfExport';
import { getWeekRange, formatISODate } from '../../utils/dateUtils';
import { getWeekStartIndex } from '../../utils/weekStartUtils';
import { getAllUnassignedUsersWithHours } from '../../services/retroactiveHourHelper';
import { updateUserSiteAndClient } from '../../services/userSiteClientSync';
import UnassignedUsersPanel from '../../components/financials/UnassignedUsersPanel';
import { Loader2, FileText, Plus, Calendar, Building, Download, Eye, Menu, Info, AlertTriangle } from 'lucide-react';
import { useUI } from '../../hooks/useUI';
import { toast } from 'react-toastify';
import { format } from 'date-fns';

const WEEK_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const InvoiceGeneratorPage = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const { openSidebar } = useUI();


    // UI State
    const [clients, setClients] = useState([]);
    const [sites, setSites] = useState([]);
    const [settings, setSettings] = useState(null);
    const [history, setHistory] = useState([]);
    const [activeTab, setActiveTab] = useState('new'); // 'new' | 'history'
    const [companyWeekStartDay, setCompanyWeekStartDay] = useState(1); // Default Monday, fetched from company
    const [logoBase64, setLogoBase64] = useState(null); // Store Base64 logo avoiding CORS

    // Form State
    const [weekStart, setWeekStart] = useState(() => {
        const today = new Date();
        const { start } = getWeekRange(today, 1);
        return formatISODate(start);
    });
    const [selectedClientId, setSelectedClientId] = useState('');
    const [selectedSiteId, setSelectedSiteId] = useState('');
    const [description, setDescription] = useState('');
    const [generating, setGenerating] = useState(false);

    // Unassigned users state
    const [unassignedUsers, setUnassignedUsers] = useState([]);
    const [loadingUnassigned, setLoadingUnassigned] = useState(false);

    // Data Fetching
    // Calculate date range from weekStart
    const dateRange = useMemo(() => {
        return getWeekRange(weekStart, companyWeekStartDay);
    }, [weekStart, companyWeekStartDay]);

    // Data Fetching - NOW USING ASSIGNMENT-BASED CALCULATIONS
    const { data: invoiceData, loading: calcLoading, retroactiveInfo } = useInvoiceCalculations(
        dateRange,
        user,
        selectedClientId, // Pass client ID for assignment filtering
        selectedSiteId    // Pass site ID for additional filtering
    );

    // Initial Load
    useEffect(() => {
        const loadData = async () => {
            if (!user?.companyId) return;

            try {
                // Fetch company document to get weekStartDay
                const companyPath = user.companyId;
                const companyId = companyPath.includes('/') ? companyPath.split('/').pop() : companyPath;
                const companyRef = doc(db, 'companies', companyId);
                const companySnap = await getDoc(companyRef);

                if (companySnap.exists()) {
                    const companyData = companySnap.data();
                    // weekStartDay in company is stored as string like 'saturday'
                    const wsIndex = getWeekStartIndex(companyData.weekStartDay);
                    setCompanyWeekStartDay(wsIndex);

                    // Recalculate weekStart with the correct start day
                    const { start } = getWeekRange(new Date(), wsIndex);
                    setWeekStart(formatISODate(start));
                }
            } catch (error) {
                console.error('Error loading company weekStartDay:', error);
            }

            // Load other data
            getClients(user.companyId).then(setClients).catch(console.error);
            getSites(user.companyId).then(setSites).catch(console.error);
            getSites(user.companyId).then(setSites).catch(console.error);
            getInvoiceSettings(user.companyId).then(async (s) => {
                setSettings(s);
                // Fetch Logo via Cloud Function to bypass CORS
                if (s?.logoUrl) {
                    try {
                        const getCompanyLogo = httpsCallable(functions, 'getCompanyLogo');
                        const result = await getCompanyLogo({ url: s.logoUrl });
                        if (result.data?.base64) {
                            setLogoBase64(result.data.base64);
                        }
                    } catch (e) {
                        console.error("Failed to load logo via Cloud Function", e);
                    }
                }
            }).catch(console.error);
            loadHistory();
        };

        loadData();
    }, [user?.companyId]);

    // No longer need the settings-based weekStart update since we fetch directly from company

    const loadHistory = async () => {
        try {
            const docs = await getInvoices(user.companyId);
            setHistory(docs);
        } catch (error) {
            console.error('Invoice History Load Error:', error);
            // If it's a missing index error, the error message will contain a link
            if (error.message?.includes('index')) {
                toast.error('Database index required. Please contact support or check console.');
            } else {
                toast.error('Failed to load invoice history');
            }
        }
    };

    // Fetch unassigned users with hours
    const loadUnassignedUsers = useCallback(async () => {
        if (!user?.companyId || !dateRange.start || !dateRange.end) return;

        setLoadingUnassigned(true);
        try {
            const users = await getAllUnassignedUsersWithHours(
                user.companyId,
                formatISODate(dateRange.start),
                formatISODate(dateRange.end)
            );
            setUnassignedUsers(users);
        } catch (error) {
            console.error('Error loading unassigned users:', error);
        } finally {
            setLoadingUnassigned(false);
        }
    }, [user?.companyId, dateRange]);

    // Load unassigned users when date range changes
    useEffect(() => {
        loadUnassignedUsers();
    }, [loadUnassignedUsers]);

    // Handle assign from panel
    const handleAssignUser = async (userId, clientId, siteId) => {
        try {
            await updateUserSiteAndClient(userId, siteId, clientId);
            toast.success('User assigned successfully!');
            // Refresh unassigned users list
            await loadUnassignedUsers();
        } catch (error) {
            console.error('Error assigning user:', error);
            toast.error('Failed to assign user: ' + error.message);
            throw error;
        }
    };

    // Derived Totals & Line Items
    const { totals, lineItems, missingRatesCount } = useMemo(() => {
        if (!invoiceData || !selectedSiteId) return { totals: { net: 0, vat: 0, total: 0, count: 0 }, lineItems: [], missingRatesCount: 0 };

        let netTotal = 0;
        let headcount = 0;
        let missingCount = 0;
        const items = [];

        Object.values(invoiceData).forEach(item => {
            // Filter by Site
            // Note: We need to ensure user objects have siteId populated. 
            // If fetching from users collection, it should be there.
            // Removed incorrect filtering by user's current siteId
            // The backend already filters by assignment siteId, so all users in this list
            // are valid for this site invoice, regardless of their current profile site.

            // Calculate Charge Back Total (Basic + Overtime)
            const basic = (item.totals?.basicHours || 0) * (Number(item.rates?.standardChargeRate) || 0);
            const ot = (item.totals?.overtimeHours || 0) * (Number(item.rates?.overtimeChargeRate) || 0);
            const itemTotal = basic + ot;
            const totalHours = (item.totals?.basicHours || 0) + (item.totals?.overtimeHours || 0);

            // Only count if they have money OR valid hours (missing rate)
            if (itemTotal > 0 || totalHours > 0) {
                headcount++;

                // Flag missing rates
                if (itemTotal === 0 && totalHours > 0) {
                    item.isMissingRate = true;
                    missingCount++;
                } else {
                    item.isMissingRate = false;
                    netTotal += itemTotal;
                }
                items.push(item);
            }
        });

        const vat = netTotal * 0.20; // 20% VAT
        return {
            totals: {
                net: netTotal,
                vat: vat,
                total: netTotal + vat,
                count: headcount
            },
            lineItems: items,
            missingRatesCount: missingCount
        };
    }, [invoiceData, selectedSiteId]);

    const handleGenerate = async () => {
        if (!selectedClientId) return toast.error('Please select a client');
        if (!selectedSiteId) return toast.error('Please select a site');
        if (!settings) return toast.error('Please configure invoice settings first');
        if (totals.count === 0) return toast.error('No billable hours found for this client/site/week');

        setGenerating(true);
        try {
            const selectedClient = clients.find(c => c.id === selectedClientId);
            const invoicePayload = {
                companyId: user.companyId,
                clientId: selectedClientId,
                clientName: selectedClient?.name || 'Unknown Client',
                siteId: selectedSiteId,
                siteName: sites.find(s => s.id === selectedSiteId)?.name || 'Unknown Site',
                weekStart,
                description,
                totals: {
                    net: totals.net,
                    vat: totals.vat,
                    grandTotal: totals.total
                },
                lineItems, // Save the breakdown
                invoiceNumber: `${settings.nextInvoicePrefix}${settings.nextInvoiceNumber}`,
                settingsSnapshot: settings // Freeze settings at time of generation
            };

            await createInvoice(invoicePayload);
            toast.success('Invoice generated successfully');
            loadHistory();
            setActiveTab('history');

            // Increment local settings counter optimistically
            setSettings(prev => ({ ...prev, nextInvoiceNumber: (prev.nextInvoiceNumber || 0) + 1 }));

        } catch (error) {
            console.error('Generate Invoice Error:', error);
            toast.error(`Failed to generate invoice: ${error.message}`);
        } finally {
            setGenerating(false);
        }
    };

    // PDF Generation
    const handleDownloadPDF = (invoice) => {
        if (!invoice || !invoice.lineItems) {
            toast.error('Invoice data incomplete (missing line items)');
            return;
        }

        // Check if logo is still loading (optional UX improvement)
        if (invoice.settingsSnapshot?.logoUrl && !logoBase64 && !invoice.settingsSnapshot?.logoBase64) {
            // If generating from history, settingsSnapshot might not have the base64 if it wasn't saved.
            // But for NEW invoices, we rely on the state `logoBase64`.
            // If history invoice has cached settings but no base64, we might not be able to show it easily 
            // unless we re-fetch. For now, we'll try to use the live one if compatible or just skip.
        }

        try {
            // Inject the pre-loaded Base64 logo into settings
            // If it's a historical invoice, it might have its own settingsSnapshot. 
            // We'll try to inject the current loaded logo if the URL matches, OR just use current global if undefined.
            const settingsWithLogo = { ...invoice.settingsSnapshot };

            // If historical invoice has same logo URL as current settings, use the loaded base64
            // OR if new invoice being generated (where invoice.settingsSnapshot is current settings)
            if (logoBase64 && (!settingsWithLogo.logoBase64)) {
                settingsWithLogo.logoBase64 = logoBase64;
            }

            const pdfInvoice = { ...invoice, settingsSnapshot: settingsWithLogo };
            generateFormalInvoicePDF(pdfInvoice, invoice.lineItems);
        } catch (error) {
            console.error(error);
            toast.error('Failed to generate PDF');
        }
    };

    return (
        <div className="p-6 max-w-6xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-3">
                    <button
                        onClick={openSidebar}
                        className="lg:hidden p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                    >
                        <Menu className="w-6 h-6" />
                    </button>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Invoice Generator</h1>
                        <p className="text-gray-500">Create and manage invoices for your job sites.</p>
                    </div>
                </div>
            </div>
            <div className="flex gap-2 mb-6">
                <button
                    onClick={() => setActiveTab('new')}
                    className={`px-4 py-2 rounded-lg font-medium transition ${activeTab === 'new' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}
                >
                    New Invoice
                </button>
                <button
                    onClick={() => setActiveTab('history')}
                    className={`px-4 py-2 rounded-lg font-medium transition ${activeTab === 'history' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`}
                >
                    Invoice History
                </button>
            </div>


            {
                activeTab === 'new' && (
                    <>
                        {/* Unassigned Users Panel */}
                        <UnassignedUsersPanel
                            unassignedUsers={unassignedUsers}
                            sites={sites}
                            clients={clients}
                            onAssign={handleAssignUser}
                            loading={loadingUnassigned}
                        />

                        {/* Missing Rates Banner */}
                        {missingRatesCount > 0 && (
                            <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start justify-between">
                                <div className="flex items-start gap-3">
                                    <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5" />
                                    <div>
                                        <h3 className="text-sm font-semibold text-yellow-800">Missing Rates Detected</h3>
                                        <p className="text-sm text-yellow-700 mt-1">
                                            {missingRatesCount} employee{missingRatesCount !== 1 ? 's' : ''} {missingRatesCount === 1 ? 'has' : 'have'} hours logged but <strong>£0.00</strong> cost because their rates are not set.
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => navigate('/financials/allowances')}
                                    className="px-4 py-2 bg-yellow-100 text-yellow-800 text-sm font-medium rounded-lg hover:bg-yellow-200 transition whitespace-nowrap"
                                >
                                    Fix Rates
                                </button>
                            </div>
                        )}

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                            {/* Left Column: Input Form */}
                            <div className="lg:col-span-2 space-y-6">
                                <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
                                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Invoice Details</h2>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Client</label>
                                            <select
                                                className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                                                value={selectedClientId}
                                                onChange={e => setSelectedClientId(e.target.value)}
                                                aria-label="Select Client"
                                            >
                                                <option value="">-- Select Client --</option>
                                                {clients.map(c => (
                                                    <option key={c.id} value={c.id}>{c.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Billing Week (Start Date)</label>
                                            <input
                                                type="date"
                                                className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                                                value={weekStart}
                                                onChange={e => {
                                                    if (!e.target.value) return;
                                                    const { start } = getWeekRange(e.target.value, companyWeekStartDay);
                                                    setWeekStart(formatISODate(start));
                                                }}
                                            />
                                            <p className="text-xs text-gray-500 mt-1">
                                                Billing week starts on <span className="font-medium text-gray-700">{WEEK_DAYS[companyWeekStartDay]}</span>
                                            </p>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Job Site</label>
                                            <select
                                                className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                                                value={selectedSiteId}
                                                onChange={e => setSelectedSiteId(e.target.value)}
                                                aria-label="Select Job Site"
                                            >
                                                <option value="">-- Select Site --</option>
                                                {sites.map(s => (
                                                    <option key={s.id} value={s.id}>{s.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="md:col-span-2">
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Services Description</label>
                                            <textarea
                                                className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                                                rows="3"
                                                value={description}
                                                onChange={e => setDescription(e.target.value)}
                                                placeholder="e.g. Security Services provided for week ending..."
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Employee Preview Table */}
                                {selectedSiteId && lineItems.length > 0 && (
                                    <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
                                        <h2 className="text-lg font-semibold text-gray-900 mb-4">Employee Breakdown</h2>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-sm">
                                                <thead className="bg-gray-800 text-white">
                                                    <tr>
                                                        <th className="px-4 py-3 text-left font-medium">Name</th>
                                                        <th className="px-4 py-3 text-left font-medium">Role</th>
                                                        <th className="px-4 py-3 text-right font-medium">Basic Hrs</th>
                                                        <th className="px-4 py-3 text-right font-medium">Rate</th>
                                                        <th className="px-4 py-3 text-right font-medium">OT Hrs</th>
                                                        <th className="px-4 py-3 text-right font-medium">OT Rate</th>
                                                        <th className="px-4 py-3 text-right font-medium">Total</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-200">
                                                    {lineItems.map((item, idx) => {
                                                        const basicTotal = (item.totals?.basicHours || 0) * (Number(item.rates?.standardChargeRate) || 0);
                                                        const otTotal = (item.totals?.overtimeHours || 0) * (Number(item.rates?.overtimeChargeRate) || 0);
                                                        const total = basicTotal + otTotal;

                                                        return (
                                                            <tr key={idx} className={`hover:bg-gray-50 ${item.isMissingRate ? 'bg-red-50 hover:bg-red-100' : ''}`}>
                                                                <td className="px-4 py-3 font-medium text-gray-900">{item.user?.name || 'Unknown'}</td>
                                                                <td className="px-4 py-3 text-gray-600">employee</td>
                                                                <td className="px-4 py-3 text-right text-gray-900">{(item.totals?.basicHours || 0).toFixed(2)}</td>
                                                                <td className="px-4 py-3 text-right text-gray-900">
                                                                    {item.isMissingRate && !item.rates?.standardChargeRate ? (
                                                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 border border-red-200">
                                                                            Missing
                                                                        </span>
                                                                    ) : (Number(item.rates?.standardChargeRate) || 0).toFixed(0)}
                                                                </td>
                                                                <td className="px-4 py-3 text-right text-gray-900">{(item.totals?.overtimeHours || 0).toFixed(2)}</td>
                                                                <td className="px-4 py-3 text-right text-gray-900">{(Number(item.rates?.overtimeChargeRate) || 0).toFixed(0)}</td>
                                                                <td className="px-4 py-3 text-right font-medium text-gray-900">
                                                                    {item.isMissingRate ? (
                                                                        <span className="text-red-600 font-bold">£0.00</span>
                                                                    ) : (
                                                                        `£${total.toFixed(2)}`
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Right Column: Preview & Action */}
                            <div className="space-y-6">
                                <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
                                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Summary Preview</h2>

                                    {calcLoading ? (
                                        <div className="flex justify-center py-8"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
                                    ) : (
                                        <div className="space-y-4">
                                            <div className="flex justify-between text-sm">
                                                <span className="text-gray-600">Billable Employees</span>
                                                <span className="font-medium text-gray-900">{totals.count}</span>
                                            </div>
                                            <div className="h-px bg-gray-200"></div>
                                            <div className="flex justify-between text-sm">
                                                <span className="text-gray-600">Net Total</span>
                                                <span className="font-medium text-gray-900">£{totals.net.toFixed(2)}</span>
                                            </div>
                                            <div className="flex justify-between text-sm">
                                                <span className="text-gray-600">VAT (20%)</span>
                                                <span className="font-medium text-gray-900">£{totals.vat.toFixed(2)}</span>
                                            </div>
                                            <div className="h-px bg-gray-200"></div>
                                            <div className="flex justify-between text-lg font-bold">
                                                <span className="text-gray-900">TOTAL</span>
                                                <span className="text-blue-600">£{totals.total.toFixed(2)}</span>
                                            </div>

                                            {settings ? (
                                                <div className="mt-6 p-3 bg-blue-50 rounded text-sm text-blue-700 border border-blue-100">
                                                    Next Invoice #: <strong>{settings.nextInvoicePrefix}{settings.nextInvoiceNumber}</strong>
                                                </div>
                                            ) : (
                                                <div className="mt-6 p-3 bg-yellow-50 rounded text-sm text-yellow-700 border border-yellow-100">
                                                    Warning: Invoice Settings not configured.
                                                </div>
                                            )}

                                            {/* Retroactive Hours Indicator */}
                                            {retroactiveInfo && retroactiveInfo.totalHours > 0 && (
                                                <div className="mt-4 p-3 bg-sky-50 rounded text-sm text-sky-700 border border-sky-200 flex items-start gap-2">
                                                    <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                                    <div>
                                                        <strong>{retroactiveInfo.totalHours.toFixed(2)} hours</strong> retroactively included from {retroactiveInfo.userCount} employee{retroactiveInfo.userCount > 1 ? 's' : ''}
                                                    </div>
                                                </div>
                                            )}

                                            <button
                                                onClick={handleGenerate}
                                                disabled={generating || totals.count === 0}
                                                className="w-full mt-4 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 flex justify-center items-center gap-2"
                                            >
                                                {generating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                                                Generate Invoice
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </>
                )
            }

            {
                activeTab === 'history' && (
                    <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invoice #</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Client</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Site</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {history.map(inv => (
                                    <tr key={inv.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-blue-600">{inv.invoiceNumber}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {inv.createdAt?.toDate ? format(inv.createdAt.toDate(), 'dd MMM yyyy') : '-'}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{inv.clientName || '-'}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{inv.siteName}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                                            £{inv.totals?.grandTotal?.toFixed(2)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <button
                                                onClick={() => handleDownloadPDF(inv)}
                                                className="text-gray-600 hover:text-blue-600 transition"
                                                title="Download PDF"
                                            >
                                                <Download className="w-5 h-5" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {history.length === 0 && (
                                    <tr>
                                        <td colSpan="6" className="px-6 py-12 text-center text-gray-500">
                                            No invoices generated yet.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )
            }
        </div >
    );
};

export default InvoiceGeneratorPage;
