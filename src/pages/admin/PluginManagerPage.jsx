import React, { useState, useEffect } from 'react';
import { getAllCompanies, updateCompanyPlugin, getCompanyPlugins } from '../../services/companyManagementService';
import { addSubscriptionAddon, removeSubscriptionAddon, USE_STRIPE } from '../../services/stripe';
import { toast } from 'react-toastify';
import {
    Loader,
    Building2,
    FileText,
    CalendarClock,
    ShieldCheck,
    Calendar,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Header from '../../components/layout/Header';

import { useCache } from '../../contexts/CacheContext';

const PluginManagerPage = () => {
    const { getItem, setItem } = useCache();
    const CACHE_KEY = 'admin_plugin_companies';

    const [companies, setCompanies] = useState(() => getItem(CACHE_KEY) || []);
    const [selectedCompany, setSelectedCompany] = useState(null);
    const [isLoadingCompanies, setIsLoadingCompanies] = useState(!getItem(CACHE_KEY));
    const [isLoadingDetails, setIsLoadingDetails] = useState(false);

    // Plugin State
    const [plugins, setPlugins] = useState({
        payslipAndInvoice: false,
        scheduling: false,
        incidents: false,
        absence: true
    });

    // Fetch all companies on mount
    useEffect(() => {
        const loadCompanies = async () => {
            try {
                const data = await getAllCompanies();
                setCompanies(data);
                setItem(CACHE_KEY, data, 15 * 60 * 1000); // Cache for 15 mins
            } catch (error) {
                console.error('Failed to load companies', error);
                toast.error('Failed to load companies list');
            } finally {
                setIsLoadingCompanies(false);
            }
        };
        loadCompanies();
    }, []);

    // Fetch plugins when company is selected
    useEffect(() => {
        const loadCompanyPlugins = async () => {
            if (!selectedCompany) {
                setPlugins({ payslipAndInvoice: false, scheduling: false, incidents: false });
                return;
            }

            setIsLoadingDetails(true);
            try {
                const currentPlugins = await getCompanyPlugins(selectedCompany.value);
                setPlugins({
                    payslipAndInvoice: !!currentPlugins?.payslipAndInvoice,
                    scheduling: !!currentPlugins?.scheduling,
                    incidents: !!currentPlugins?.incidents,
                    absence: currentPlugins?.absence !== false
                });
            } catch (error) {
                console.error('Failed to load company plugins', error);
                toast.error('Failed to load plugin settings');
            } finally {
                setIsLoadingDetails(false);
            }
        };
        loadCompanyPlugins();
    }, [selectedCompany]);

    const handlePluginChange = async (key, value) => {
        if (!selectedCompany) return;

        const newPlugins = { ...plugins, [key]: value };
        setPlugins(newPlugins); // Optimistic update

        try {
            // Use Stripe for scheduling plugin if enabled
            if (USE_STRIPE && key === 'scheduling') {
                if (value) {
                    await addSubscriptionAddon(selectedCompany.value, key);
                } else {
                    await removeSubscriptionAddon(selectedCompany.value, key);
                }
            } else {
                // Use the new atomic update function for standard plugins
                await updateCompanyPlugin(selectedCompany.value, key, value);
            }

            const nameMap = {
                payslipAndInvoice: 'Payslip & Invoice',
                scheduling: 'Scheduling',
                incidents: 'Incidents',
                absence: 'Absence Tracking'
            };
            toast.success(`${nameMap[key]} plugin ${value ? 'enabled' : 'disabled'}`);
        } catch (error) {
            // If fixing a sync issue where UI says ON but Stripe says OFF (missing),
            // we should allow the "Disable" action to proceed so they match.
            const errString = error ? error.toString() : '';
            const errMsg = error?.message || '';

            if (!value && (errMsg.includes('Add-on not found') || errString.includes('Add-on not found'))) {
                console.warn('Add-on was already missing in Stripe. Syncing UI to match.');
                // We still want to ensure Firestore says FALSE, so we call the direct update as fallback
                try {
                    await updateCompanyPlugin(selectedCompany.value, key, false);
                    toast.success('Sync complete: Plugin marked as disabled.');
                    return; // Exit success
                } catch (innerError) {
                    console.error('Failed to sync Firestore after Stripe error:', innerError);
                    // Fall through to general error handler
                }
            }

            console.error('Plugin toggle error:', error);
            setPlugins(plugins); // Revert
            toast.error(error.message || 'Failed to save changes');
        }
    };

    return (
        <div className="h-screen flex flex-col bg-gray-50/50">
            <Header
                title="Plugin Manager"
                subtitle="Control feature access and manage enabled plugins for client companies."
            />

            <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 pb-20">
                <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-8">
                    {/* Left Column: Selection */}
                    <motion.div
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.1 }}
                        className="lg:col-span-4 space-y-6"
                    >
                        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow sticky top-8">
                            <div className="flex items-center gap-2 mb-6">
                                <span className="p-2 bg-gray-100 rounded-lg text-gray-600">
                                    <Building2 className="w-5 h-5" />
                                </span>
                                <h2 className="text-lg font-bold text-gray-800">Select Client Company</h2>
                            </div>

                            <div className="relative group">
                                <select
                                    className="w-full appearance-none bg-gray-50 border border-gray-200 text-gray-900 text-base font-medium rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500 block p-4 pr-10 outline-none transition-all hover:bg-gray-100 hover:border-gray-300 cursor-pointer"
                                    value={selectedCompany ? selectedCompany.value : ''}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        const company = companies.find(c => c.value === val);
                                        setSelectedCompany(company || null);
                                    }}
                                    disabled={isLoadingCompanies}
                                >
                                    <option value="">Choose a company...</option>
                                    {companies.map(company => (
                                        <option key={company.value} value={company.value}>
                                            {company.label}
                                        </option>
                                    ))}
                                </select>
                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-gray-500 group-hover:text-purple-600 transition-colors">
                                    <svg className="fill-current h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
                                </div>
                            </div>

                            <AnimatePresence>
                                {selectedCompany && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0, marginTop: 0 }}
                                        animate={{ opacity: 1, height: 'auto', marginTop: 24 }}
                                        exit={{ opacity: 0, height: 0, marginTop: 0 }}
                                        className="pt-6 border-t border-dashed border-gray-200 overflow-hidden"
                                    >
                                        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Currently Managing</p>
                                        <div className="text-xl font-bold text-gray-900 break-words leading-tight">{selectedCompany.label}</div>
                                        <div className="mt-2 flex items-center gap-2 text-sm text-green-600 bg-green-50 px-3 py-1 rounded-full w-fit">
                                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                            Active Client
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </motion.div>

                    {/* Right Column: Plugins */}
                    <motion.div
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.2 }}
                        className="lg:col-span-8"
                    >
                        <AnimatePresence mode="wait">
                            {!selectedCompany ? (
                                <motion.div
                                    key="empty"
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    exit={{ opacity: 0, scale: 0.95 }}
                                    className="h-full min-h-[400px] flex flex-col items-center justify-center text-center bg-white rounded-2xl border-2 border-dashed border-gray-200 p-8 md:p-12"
                                >
                                    <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-6 shadow-inner">
                                        <ShieldCheck className="w-10 h-10 text-gray-300" />
                                    </div>
                                    <h3 className="text-2xl font-bold text-gray-900 mb-3">No Company Selected</h3>
                                    <p className="text-gray-500 max-w-sm text-lg">Select a company from the sidebar to view and configure their available plugins.</p>
                                </motion.div>
                            ) : (
                                <motion.div
                                    key="content"
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -10 }}
                                    className="space-y-6"
                                >
                                    {isLoadingDetails ? (
                                        <div className="flex items-center justify-center min-h-[400px] bg-white rounded-2xl shadow-sm border border-gray-100">
                                            <div className="flex flex-col items-center gap-4">
                                                <Loader className="w-10 h-10 text-purple-600 animate-spin" />
                                                <p className="text-gray-500 font-medium">Loading plugin settings...</p>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <PluginCard
                                                title="Payslip & Invoice Management"
                                                description="Automated generation of payslips and invoice management for contractors. Includes detailed financial reporting."
                                                icon={FileText}
                                                isEnabled={plugins.payslipAndInvoice}
                                                onChange={(val) => handlePluginChange('payslipAndInvoice', val)}
                                                color="blue"
                                            />

                                            <PluginCard
                                                title="Shift Scheduling & Roster"
                                                description="Advanced shift planning, Rota management, conflict detection, and Incident & Safety Reporting."
                                                icon={CalendarClock}
                                                isEnabled={plugins.scheduling}
                                                onChange={(val) => handlePluginChange('scheduling', val)}
                                                color="purple"
                                            />

                                            <PluginCard
                                                title="Absence & Leave Tracking"
                                                description="Manage employee absences, annual leave, sick leave, and other categories. Includes allowance tracking."
                                                icon={Calendar}
                                                isEnabled={plugins.absence !== false}
                                                onChange={(val) => handlePluginChange('absence', val)}
                                                color="orange"
                                            />
                                        </>
                                    )}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </motion.div>
                </div >
            </div >
        </div >
    );
};

const PluginCard = ({ title, description, icon: Icon, isEnabled, onChange, color }) => {
    // Dynamic color classes based on prop
    const colors = {
        blue: {
            activeBg: 'bg-blue-600',
            activeRing: 'ring-blue-500',
            activeCheckText: 'text-blue-700',
            activeCheckBg: 'bg-blue-100',
            borderHover: 'hover:border-blue-200'
        },
        purple: {
            activeBg: 'bg-purple-600',
            activeRing: 'ring-purple-500',
            activeCheckText: 'text-purple-700',
            activeCheckBg: 'bg-purple-100',
            borderHover: 'hover:border-purple-200'
        },
        orange: {
            activeBg: 'bg-orange-600',
            activeRing: 'ring-orange-500',
            activeCheckText: 'text-orange-700',
            activeCheckBg: 'bg-orange-100',
            borderHover: 'hover:border-orange-200'
        }
    };

    const theme = colors[color] || colors.purple;

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={`group relative bg-white rounded-2xl p-6 md:p-8 border transition-all duration-300 ${isEnabled
                ? `border-transparent ring-2 ${theme.activeRing} shadow-lg shadow-${color}-500/10`
                : `border-gray-200 shadow-sm ${theme.borderHover} hover:shadow-md`
                }`}
        >
            <div className="flex flex-col sm:flex-row items-start gap-4 md:gap-6">
                <div className={`p-4 rounded-2xl transition-all duration-300 flex-shrink-0 ${isEnabled ? theme.activeCheckBg : 'bg-gray-100 group-hover:bg-gray-200'
                    }`}>
                    <Icon className={`w-8 h-8 transition-colors ${isEnabled ? theme.activeCheckText : 'text-gray-500'
                        }`} />
                </div>

                <div className="flex-1 w-full pt-1">
                    <div className="flex items-center justify-between mb-3">
                        <h3 className={`text-lg md:text-xl font-bold transition-colors ${isEnabled ? 'text-gray-900' : 'text-gray-700'
                            }`}>{title}</h3>

                        <motion.span
                            initial={false}
                            animate={{ opacity: isEnabled ? 1 : 0, scale: isEnabled ? 1 : 0.8 }}
                            className={`text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide hidden sm:inline-block ${theme.activeCheckBg} ${theme.activeCheckText}`}
                        >
                            Active
                        </motion.span>
                    </div>

                    <p className="text-gray-500 leading-relaxed text-sm md:text-base mb-4 sm:mb-0">{description}</p>
                </div>

                <div className="flex items-center justify-between w-full sm:w-auto sm:self-center sm:pl-6 sm:border-l border-gray-100 sm:h-16 mt-2 sm:mt-0">
                    <span className="text-sm font-medium text-gray-500 sm:hidden">
                        {isEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                    <button
                        onClick={() => onChange(!isEnabled)}
                        className={`relative inline-flex h-9 w-16 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 flex-shrink-0 ${theme.activeRing} ${isEnabled ? theme.activeBg : 'bg-gray-200 hover:bg-gray-300'
                            }`}
                    >
                        <span className="sr-only">Enable plugin</span>
                        <span
                            className={`inline-block h-7 w-7 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out ${isEnabled ? 'translate-x-8' : 'translate-x-1'
                                }`}
                        />
                    </button>
                </div>
            </div>
        </motion.div>
    );
};

export default PluginManagerPage;
