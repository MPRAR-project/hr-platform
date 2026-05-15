import React, { useState, useEffect, useMemo, useRef } from 'react';
import { fetchCompanyDetails } from '../../services/companyService';
import { useAuth } from '../../hooks/useAuth';
import { useInvoiceCalculations } from '../../hooks/useInvoiceCalculations';
import { getInvoiceSettings, updateInvoiceSettings } from '../../services/invoiceSettings';
import { generatePayslipPDF } from '../../utils/payslipPdfExport';
import { getWeekRange, formatISODate } from '../../utils/dateUtils';
import { getWeekStartIndex } from '../../utils/weekStartUtils';
import { sendPayslipEmail } from '../../services/emailService';
import { Loader2, Calendar, Download, Mail, Settings, X, Save, Menu, Send } from 'lucide-react';
import { useUI } from '../../hooks/useUI';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import Button from '../../components/ui/Button';

const WEEK_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const PayslipGeneratorPage = () => {
    const { user } = useAuth();
    const { openSidebar } = useUI();

    // Helper function to get user display name with fallback
    const getUserDisplayName = (userObj) => {
        if (userObj.firstName && userObj.lastName) {
            return `${userObj.firstName} ${userObj.lastName}`;
        }
        if (userObj.name) {
            return userObj.name;
        }
        if (userObj.displayName) {
            return userObj.displayName;
        }
        return '';
    };

    // State
    const [weekStart, setWeekStart] = useState(() => {
        const d = new Date();
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1) - 7; // Last Monday
        d.setDate(diff);
        return formatISODate(d);
    });

    const [settings, setSettings] = useState(null);
    const [logoBase64, setLogoBase64] = useState(null);
    const [emailing, setEmailing] = useState(null); // userId being emailed
    const [companyWeekStartDay, setCompanyWeekStartDay] = useState(1); // Default Monday, fetched from company

    // Batch Send State
    const [batchSending, setBatchSending] = useState(false);
    const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
    const [batchResults, setBatchResults] = useState({ success: [], failed: [], skipped: [] });
    const cancelBatchRef = useRef(false);

    // Settings Modal State
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [settingsForm, setSettingsForm] = useState({ defaultAdminDeduction: 0 });
    const [isSavingSettings, setIsSavingSettings] = useState(false);

    // Date Range
    const dateRange = useMemo(() => {
        return getWeekRange(weekStart, companyWeekStartDay);
    }, [weekStart, companyWeekStartDay]);

    // Data Fetching
    const { data: rawData, loading: calcLoading } = useInvoiceCalculations(
        dateRange,
        user
    );

    // Initial Load Settings
    useEffect(() => {
        const loadData = async () => {
            if (!user?.companyId) return;

            try {
                // Fetch company details to get weekStartDay via REST
                const companyId = user.companyId.replace('companies/', '');
                const { company: companyData } = await fetchCompanyDetails(companyId);

                if (companyData) {
                    const wsIndex = getWeekStartIndex(companyData.weekStartDay || 'monday');
                    setCompanyWeekStartDay(wsIndex);

                    // Recalculate weekStart with the correct start day
                    const { start } = getWeekRange(new Date(), wsIndex);
                    setWeekStart(formatISODate(start));
                }
            } catch (error) {
                console.error('Error loading company weekStartDay:', error);
            }

            // Load invoice settings for other data (logo, etc)
            getInvoiceSettings(user.companyId).then(async (s) => {
                setSettings(s);
                setSettingsForm({ defaultAdminDeduction: s?.defaultAdminDeduction || 0 });

                if (s?.logoUrl) {
                    try {
                        const response = await fetch(s.logoUrl);
                        const blob = await response.blob();
                        const reader = new FileReader();
                        reader.onloadend = () => setLogoBase64(reader.result);
                        reader.readAsDataURL(blob);
                    } catch (e) {
                        console.error("Failed to load logo via fetch", e);
                    }
                }
            });
        };

        loadData();
    }, [user?.companyId]);

    // Process Data for Payslips (Apply Deductions)
    const payslipData = useMemo(() => {
        if (!rawData || !settings) return [];

        return Object.values(rawData).map(item => {
            const { totals, rates, user: u } = item;

            // 1. Calculate Gross
            // We use PAY RATES for payslips, not Charge Rates
            // Note: useInvoiceCalculations returns both.
            // item.totals.pay is already calculated as (basic * payRate) + (overtime * otRate)

            const grossBasic = totals.basicHours * rates.standardPayRate;
            const grossOvertime = totals.overtimeHours * rates.overtimePayRate;
            const grossPay = grossBasic + grossOvertime;

            // 2. CIS Deduction
            let cisAmount = 0;
            const cisRateStr = u.cisDeduction || '20%';
            const cisRate = parseFloat(cisRateStr.replace('%', '')) / 100;

            if (!isNaN(cisRate) && cisRate > 0) {
                cisAmount = grossPay * cisRate;
            }

            // 3. Admin Deduction
            const adminDeduction = settings.defaultAdminDeduction || 0;

            // 4. Net Pay
            const netPay = grossPay - cisAmount - adminDeduction;

            return {
                user: u,
                period: dateRange,
                calculations: {
                    basicHours: totals.basicHours,
                    overtimeHours: totals.overtimeHours,
                    rates: {
                        basic: rates.standardPayRate,
                        overtime: rates.overtimePayRate
                    },
                    grossBasic,
                    grossOvertime,
                    grossPay,
                    cisDeduction: cisAmount,
                    adminDeduction,
                    netPay,
                    utr: u.utrNumber
                }
            };
        }).filter(p => p.calculations.grossPay > 0); // Only show people with pay
    }, [rawData, settings, dateRange]);


    const handleDownload = (item) => {
        if (settings?.logoUrl && !logoBase64) {
            toast.warning("Logo is still loading, please wait...");
            return;
        }

        generatePayslipPDF({
            user: item.user,
            period: { end: dateRange.end },
            // user: item.user, // Duplicate removed
            // period: { end: dateRange.end }, // Duplicate removed
            company: {}, // Pass company object if needed, or rely on settings
            settings: settings,
            logoBase64: logoBase64,
            calculations: item.calculations,
            invoiceNumber: `PAY-${format(new Date(), 'yyyyMMdd')}-${item.user.id.slice(0, 4)}`
        });
        toast.success(`Payslip downloaded for ${item.user.firstName}`);
    };



    const handleEmail = async (item) => {
        if (!item.user.email) {
            toast.error("User does not have an email address.");
            return;
        }

        setEmailing(item.user.id);
        try {
            // 1. Generate PDF as Base64
            const { base64, filename } = generatePayslipPDF({
                user: item.user,
                period: { end: dateRange.end },
                company: {},
                settings: settings,
                logoBase64: logoBase64,
                calculations: item.calculations,
                invoiceNumber: `PAY-${format(new Date(), 'yyyyMMdd')}-${item.user.id.slice(0, 4)}`,
                returnBase64: true
            });

            // 2. Call Email Service via REST
            await sendPayslipEmail({
                email: item.user.email,
                subject: `Payslip - ${format(new Date(dateRange.end), 'dd MMM yyyy')}`,
                body: `Dear ${item.user.firstName},\n\nPlease find attached your payslip/invoice for the week ending ${format(new Date(dateRange.end), 'dd MMM yyyy')}.\n\nRegards,\n${settings.companyName || 'Accounts'}`,
                attachment: base64,
                filename: filename
            });

            toast.success(`Payslip sent to ${item.user.email}`);
        } catch (error) {
            console.error("Failed to email payslip:", error);
            toast.error("Failed to send email. Ensure backend is running.");
        } finally {
            setEmailing(null);
        }
    };

    const handleSendAll = async () => {
        // Filter payslips with valid emails
        const validPayslips = payslipData.filter(item => item.user.email);
        const invalidPayslips = payslipData.filter(item => !item.user.email);

        // Show warning if some don't have emails
        if (invalidPayslips.length > 0) {
            toast.warning(`${invalidPayslips.length} employee(s) will be skipped (no email address)`);
        }

        if (validPayslips.length === 0) {
            toast.error("No employees with email addresses found");
            return;
        }

        // Check if logo is still loading
        if (settings?.logoUrl && !logoBase64) {
            toast.warning("Logo is still loading, please wait...");
            return;
        }

        // Initialize progress tracking
        setBatchSending(true);
        setBatchProgress({ current: 0, total: validPayslips.length });
        setBatchResults({ success: [], failed: [], skipped: invalidPayslips.map(p => p.user.firstName) });
        cancelBatchRef.current = false;

        const results = { success: [], failed: [] };

        // Send emails sequentially
        for (let i = 0; i < validPayslips.length; i++) {
            // Check for cancellation
            if (cancelBatchRef.current) {
                toast.info("Batch send cancelled");
                break;
            }

            const item = validPayslips[i];

            try {
                // Generate PDF
                const { base64, filename } = generatePayslipPDF({
                    user: item.user,
                    period: { end: dateRange.end },
                    company: {},
                    settings: settings,
                    logoBase64: logoBase64,
                    calculations: item.calculations,
                    invoiceNumber: `PAY-${format(new Date(), 'yyyyMMdd')}-${item.user.id.slice(0, 4)}`,
                    returnBase64: true
                });

                // Send email via REST
                await sendPayslipEmail({
                    email: item.user.email,
                    subject: `Payslip - ${format(new Date(dateRange.end), 'dd MMM yyyy')}`,
                    body: `Dear ${item.user.firstName},\n\nPlease find attached your payslip/invoice for the week ending ${format(new Date(dateRange.end), 'dd MMM yyyy')}.\n\nRegards,\n${settings.companyName || 'Accounts'}`,
                    attachment: base64,
                    filename: filename
                });

                results.success.push(getUserDisplayName(item.user));
            } catch (error) {
                console.error(`Failed to send to ${item.user.email}:`, error);
                results.failed.push(getUserDisplayName(item.user));
            }

            // Update progress
            setBatchProgress({ current: i + 1, total: validPayslips.length });
            setBatchResults(prev => ({ ...prev, success: results.success, failed: results.failed }));
        }

        // Show summary
        setBatchSending(false);

        if (results.success.length > 0) {
            toast.success(`Successfully sent ${results.success.length} payslip(s)`);
        }
        if (results.failed.length > 0) {
            toast.error(`Failed to send ${results.failed.length} payslip(s): ${results.failed.join(', ')}`);
        }
    };

    const handleSaveSettings = async () => {
        setIsSavingSettings(true);
        try {
            const updatedSettings = {
                ...settings,
                defaultAdminDeduction: parseFloat(settingsForm.defaultAdminDeduction) || 0
            };
            await updateInvoiceSettings(user.companyId, updatedSettings);
            setSettings(updatedSettings);
            toast.success("Settings updated");
            setShowSettingsModal(false);
        } catch (error) {
            console.error("Failed to save settings:", error);
            toast.error("Failed to save settings");
        } finally {
            setIsSavingSettings(false);
        }
    };

    const isLoading = calcLoading || !settings;

    return (
        <div className="p-6 max-w-6xl mx-auto">
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-6 gap-4">
                <div className="flex items-center gap-3 w-full lg:w-auto">
                    <button
                        onClick={openSidebar}
                        className="lg:hidden p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                    >
                        <Menu className="w-6 h-6" />
                    </button>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Payslip Generator</h1>
                        <p className="text-gray-500 text-sm">Generate self-billing invoices / payslips for staff.</p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
                    {/* Week Picker */}
                    <div className="flex flex-1 lg:flex-none items-center gap-2 bg-white border rounded-lg px-3 py-2 shadow-sm min-w-[200px]">
                        <Calendar className="w-4 h-4 text-gray-400" />
                        <input
                            type="date"
                            value={weekStart}
                            onChange={(e) => {
                                if (!e.target.value) return;
                                const { start } = getWeekRange(e.target.value, companyWeekStartDay);
                                setWeekStart(formatISODate(start));
                            }}
                            className="text-sm outline-none text-gray-600 w-full"
                        />
                    </div>

                    <div className="flex items-center gap-2 ml-auto lg:ml-0">
                        <p className="text-xs text-gray-500 hidden sm:block mr-1">
                            Starts: <span className="font-medium">{WEEK_DAYS[companyWeekStartDay]}</span>
                        </p>
                        <Button
                            variant="primary"
                            size="sm"
                            icon={batchSending ? Loader2 : Send}
                            onClick={handleSendAll}
                            disabled={isLoading || payslipData.length === 0 || batchSending}
                            isLoading={batchSending}
                            cn="whitespace-nowrap"
                        >
                            <span className="hidden sm:inline">Send All</span>
                            <span className="sm:hidden">Send</span>
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            icon={Settings}
                            onClick={() => setShowSettingsModal(true)}
                        >
                            <span className="hidden sm:inline">Config</span>
                        </Button>
                    </div>
                </div>
            </div>

            {isLoading ? (
                <div className="flex justify-center p-12">
                    <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
                </div>
            ) : (
                <>
                    {/* Desktop View */}
                    <div className="hidden md:block bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-gray-50 text-gray-700 font-medium border-b">
                                    <tr>
                                        <th className="px-6 py-3">Employee</th>
                                        <th className="px-6 py-3 text-right">Gross Pay</th>
                                        <th className="px-6 py-3 text-right text-red-600">CIS Ded.</th>
                                        <th className="px-6 py-3 text-right text-red-600">Admin Ded.</th>
                                        <th className="px-6 py-3 text-right font-bold">Net Pay</th>
                                        <th className="px-6 py-3 text-center">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {payslipData.length === 0 ? (
                                        <tr>
                                            <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                                                No billable hours found for this week.
                                            </td>
                                        </tr>
                                    ) : (
                                        payslipData.map((item) => (
                                            <tr key={item.user.id} className="hover:bg-gray-50">
                                                <td className="px-6 py-4 font-medium text-gray-900">
                                                    {getUserDisplayName(item.user)}
                                                    <div className="text-xs text-gray-400 font-normal">{item.user.role}</div>
                                                </td>
                                                <td className="px-6 py-4 text-right">£{item.calculations.grossPay.toFixed(2)}</td>
                                                <td className="px-6 py-4 text-right text-red-600">-£{item.calculations.cisDeduction.toFixed(2)}</td>
                                                <td className="px-6 py-4 text-right text-red-600">-£{item.calculations.adminDeduction.toFixed(2)}</td>
                                                <td className="px-6 py-4 text-right font-bold text-gray-900">£{item.calculations.netPay.toFixed(2)}</td>
                                                <td className="px-6 py-4 flex justify-center gap-2">
                                                    <button
                                                        onClick={() => handleDownload(item)}
                                                        className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                                                        title="Download PDF"
                                                        disabled={batchSending}
                                                    >
                                                        <Download className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleEmail(item)}
                                                        className="p-2 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                                                        title="Email Payslip"
                                                        disabled={batchSending || emailing === item.user.id}
                                                    >
                                                        {emailing === item.user.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Mobile Card View */}
                    <div className="md:hidden space-y-4">
                        {payslipData.length === 0 ? (
                            <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-500">
                                No billable hours found for this week.
                            </div>
                        ) : (
                            payslipData.map((item) => (
                                <div key={item.user.id} className="bg-white border border-gray-200 rounded-lg shadow-sm p-4">
                                    <div className="flex justify-between items-start mb-3 border-b border-gray-100 pb-3">
                                        <div>
                                            <h3 className="font-semibold text-gray-900">{getUserDisplayName(item.user)}</h3>
                                            <p className="text-xs text-gray-500">{item.user.role}</p>
                                        </div>
                                        <div className="flex gap-1">
                                            <button
                                                onClick={() => handleDownload(item)}
                                                className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                                                disabled={batchSending}
                                            >
                                                <Download className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => handleEmail(item)}
                                                className="p-2 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-lg transition"
                                                disabled={batchSending || emailing === item.user.id}
                                            >
                                                {emailing === item.user.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                                            </button>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-y-2 text-sm">
                                        <div className="text-gray-600">Gross Pay:</div>
                                        <div className="text-right font-medium">£{item.calculations.grossPay.toFixed(2)}</div>

                                        {(item.calculations.cisDeduction > 0) && (
                                            <>
                                                <div className="text-gray-600">CIS Ded:</div>
                                                <div className="text-right text-red-600">-£{item.calculations.cisDeduction.toFixed(2)}</div>
                                            </>
                                        )}

                                        {(item.calculations.adminDeduction > 0) && (
                                            <>
                                                <div className="text-gray-600">Admin Ded:</div>
                                                <div className="text-right text-red-600">-£{item.calculations.adminDeduction.toFixed(2)}</div>
                                            </>
                                        )}

                                        <div className="col-span-2 border-t border-gray-100 mt-2 pt-2 flex justify-between items-center">
                                            <span className="font-semibold text-gray-900">Net Pay:</span>
                                            <span className="font-bold text-lg text-gray-900">£{item.calculations.netPay.toFixed(2)}</span>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </>
            )}

            {/* Settings Modal */}
            {showSettingsModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6 m-4">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-lg font-semibold text-gray-900">Payslip Config</h2>
                            <button onClick={() => setShowSettingsModal(false)} className="text-gray-400 hover:text-gray-600">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Default Admin Deduction
                                </label>
                                <div className="relative">
                                    <span className="absolute left-3 top-2 text-gray-500">£</span>
                                    <input
                                        type="number"
                                        step="0.01"
                                        className="w-full border border-gray-300 rounded-lg pl-8 pr-3 py-2 outline-none focus:ring-2 focus:ring-purple-500"
                                        value={settingsForm.defaultAdminDeduction}
                                        onChange={e => setSettingsForm({ ...settingsForm, defaultAdminDeduction: e.target.value })}
                                        placeholder="0.00"
                                    />
                                </div>
                                <p className="text-xs text-text-secondary mt-1">This deduction applies to all generated payslips.</p>
                            </div>
                            <div className="flex justify-end gap-3 pt-2">
                                <Button
                                    variant="secondary"
                                    onClick={() => setShowSettingsModal(false)}
                                    disabled={isSavingSettings}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    onClick={handleSaveSettings}
                                    isLoading={isSavingSettings}
                                    disabled={isSavingSettings}
                                    icon={Save}
                                >
                                    Save Config
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Batch Send Progress Modal */}
            {batchSending && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6 m-4">
                        <div className="mb-4">
                            <h2 className="text-lg font-semibold text-gray-900">Sending Payslips</h2>
                            <p className="text-sm text-gray-500 mt-1">
                                Please wait while we send all payslips...
                            </p>
                        </div>

                        <div className="mb-4">
                            <div className="flex justify-between text-sm text-gray-600 mb-2">
                                <span>Progress</span>
                                <span>{batchProgress.current} of {batchProgress.total}</span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                                <div
                                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                                    style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                                />
                            </div>
                        </div>

                        {/* Status List */}
                        <div className="mb-4 max-h-48 overflow-y-auto">
                            <div className="space-y-2">
                                {batchResults.success.map((name, idx) => (
                                    <div key={`success-${idx}`} className="flex items-center gap-2 text-sm">
                                        <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center">
                                            <span className="text-green-600 text-xs">✓</span>
                                        </div>
                                        <span className="text-gray-700">{name}</span>
                                        <span className="text-green-600 text-xs ml-auto">Sent</span>
                                    </div>
                                ))}
                                {batchResults.failed.map((name, idx) => (
                                    <div key={`failed-${idx}`} className="flex items-center gap-2 text-sm">
                                        <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center">
                                            <span className="text-red-600 text-xs">✗</span>
                                        </div>
                                        <span className="text-gray-700">{name}</span>
                                        <span className="text-red-600 text-xs ml-auto">Failed</span>
                                    </div>
                                ))}
                                {batchResults.skipped.map((name, idx) => (
                                    <div key={`skipped-${idx}`} className="flex items-center gap-2 text-sm">
                                        <div className="w-5 h-5 rounded-full bg-yellow-100 flex items-center justify-center">
                                            <span className="text-yellow-600 text-xs">⊘</span>
                                        </div>
                                        <span className="text-gray-700">{name}</span>
                                        <span className="text-yellow-600 text-xs ml-auto">No Email</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="flex justify-end">
                            <Button
                                variant="secondary"
                                onClick={() => {
                                    cancelBatchRef.current = true;
                                }}
                            >
                                Cancel
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PayslipGeneratorPage;
