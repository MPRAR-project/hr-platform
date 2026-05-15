import React, { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { getUsersByCompany, updateUserBySiteManager } from '../../services/users';
import { getSites } from '../../services/sites';
import { getClients } from '../../services/clients';
import { Loader2, Save, Search, Users, Menu } from 'lucide-react';
import { useUI } from '../../hooks/useUI';
import { toast } from 'react-toastify';
import Button from '../../components/ui/Button';

const RateAllowancePage = () => {
    const { user } = useAuth();
    const { openSidebar } = useUI();
    const [employees, setEmployees] = useState([]);
    const [sites, setSites] = useState([]);
    const [clients, setClients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState({}); // Track saving state per user
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedSite, setSelectedSite] = useState('all');
    const [selectedClient, setSelectedClient] = useState('all');

    // Local state for edits: { [userId]: { rates: {...}, cisDeduction: '', utrNumber: '' } }
    const [edits, setEdits] = useState({});

    useEffect(() => {
        const loadEmployees = async () => {
            if (!user?.companyId) return;
            try {
                setLoading(true);
                const [allUsers, allSites, allClients] = await Promise.all([
                    getUsersByCompany(user.companyId),
                    getSites(user.companyId),
                    getClients(user.companyId)
                ]);
                setSites(allSites);
                setClients(allClients);
                // Filter for employees/managers, maybe exclude SuperAdmins if needed.
                // Generally we want to set rates for everyone who logs time.
                const staff = allUsers.filter(u => u.role !== 'companyAdmin' && u.primaryRole !== 'siteManager');
                setEmployees(staff);

                // Initialize edits state with existing data
                const initialEdits = {};
                staff.forEach(emp => {
                    initialEdits[emp.id] = {
                        rates: {
                            chargeBackBasic: emp.rates?.chargeBackBasic || '',
                            chargeBackOvertime: emp.rates?.chargeBackOvertime || '',
                            payBasic: emp.rates?.payBasic || '',
                            payOvertime: emp.rates?.payOvertime || '',
                            standardPayRate: emp.rates?.standardPayRate || '', // Legacy/Alias support if needed
                            standardChargeRate: emp.rates?.standardChargeRate || '',
                            overtimePayRate: emp.rates?.overtimePayRate || '',
                            overtimeChargeRate: emp.rates?.overtimeChargeRate || ''
                        },
                        cisDeduction: emp.cisDeduction || 'N/A',
                        utrNumber: emp.utrNumber || ''
                    };
                });
                setEdits(initialEdits);

            } catch (err) {
                console.error("Failed to load employees:", err);
                toast.error("Failed to load employee list");
            } finally {
                setLoading(false);
            }
        };

        loadEmployees();
    }, [user]);

    const handleChange = (userId, field, subField, value) => {
        setEdits(prev => {
            const userEdits = { ...prev[userId] };
            if (field === 'rates') {
                userEdits.rates = { ...userEdits.rates, [subField]: value };
            } else {
                userEdits[field] = value;
            }
            return { ...prev, [userId]: userEdits };
        });
    };

    const handleSave = async (userId) => {
        setSaving(prev => ({ ...prev, [userId]: true }));
        try {
            const dataToSave = edits[userId];
            // Validate numbers?
            // Ensure numeric fields are saved as numbers if valid, or null
            const cleanRates = {};
            Object.keys(dataToSave.rates).forEach(key => {
                const val = dataToSave.rates[key];
                cleanRates[key] = val === '' ? null : Number(val);

                // Sync legacy fields for compatibility with InvoiceSummary logic
                if (key === 'chargeBackBasic') cleanRates.standardChargeRate = Number(val);
                if (key === 'chargeBackOvertime') cleanRates.overtimeChargeRate = Number(val);
                if (key === 'payBasic') cleanRates.standardPayRate = Number(val);
                if (key === 'payOvertime') cleanRates.overtimePayRate = Number(val);
            });

            const payload = {
                rates: cleanRates,
                cisDeduction: dataToSave.cisDeduction,
                utrNumber: dataToSave.utrNumber
            };

            // Step 1: Update user document
            await updateUserBySiteManager(userId, payload);

            // Step 2: Update ALL active assignments for this user with new rates via REST
            const chargeRate = Number(cleanRates.chargeBackBasic) || Number(cleanRates.standardChargeRate) || 0;
            const overtimeChargeRate = Number(cleanRates.chargeBackOvertime) || Number(cleanRates.overtimeChargeRate) || 0;

            if (chargeRate > 0) {
                try {
                    const { updateAssignmentRates } = await import('../../services/assignmentService');
                    await updateAssignmentRates(userId, { chargeRate, overtimeChargeRate });
                    console.log(`✅ Updated active assignments for user ${userId} with rates ${chargeRate}/${overtimeChargeRate} via REST`);
                } catch (assignmentError) {
                    console.error('Error updating assignments via REST:', assignmentError);
                }
            }

            toast.success("Rates updated successfully");
        } catch (err) {
            console.error("Save failed:", err);
            toast.error("Failed to save changes");
        } finally {
            setSaving(prev => ({ ...prev, [userId]: false }));
        }
    };

    const filteredEmployees = employees.filter(emp => {
        // Search filter
        const matchesSearch = emp.displayName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            emp.email?.toLowerCase().includes(searchTerm.toLowerCase());

        // Site filter
        const matchesSite = selectedSite === 'all' ||
            emp.siteId === selectedSite ||
            emp.siteId === `sites/${selectedSite}`;

        // Client filter - need to check site's clientId
        let matchesClient = selectedClient === 'all';
        if (!matchesClient && emp.siteId) {
            // Find the site this user is assigned to
            const userSite = sites.find(s => s.id === emp.siteId || `sites/${s.id}` === emp.siteId);
            if (userSite) {
                matchesClient = userSite.clientId === selectedClient;
            }
        }

        return matchesSearch && matchesSite && matchesClient;
    });

    if (loading) return <div className="flex justify-center p-10"><Loader2 className="animate-spin text-purple-600" /></div>;

    return (
        <div className="p-6 max-w-[1600px] mx-auto space-y-6">
            <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
                <div className="flex items-center gap-3 w-full xl:w-auto">
                    <button
                        onClick={openSidebar}
                        className="lg:hidden p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                    >
                        <Menu className="w-6 h-6" />
                    </button>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <Users className="text-purple-600" />
                            Rate & Allowance Settings
                        </h1>
                        <p className="text-gray-500 text-sm mt-1">Configure pay rates, charge rates, and tax details.</p>
                    </div>
                </div>

                <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3 w-full xl:w-auto">
                    <div className="relative flex-grow md:flex-grow-0">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search employees..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="pl-10 pr-4 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none w-full md:w-64"
                        />
                    </div>

                    <div className="flex gap-3 w-full md:w-auto">
                        <select
                            value={selectedSite}
                            onChange={(e) => setSelectedSite(e.target.value)}
                            aria-label="Filter by Site"
                            className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none flex-1 md:flex-none"
                        >
                            <option value="all">All Sites</option>
                            {sites.map(site => (
                                <option key={site.id} value={site.id}>{site.name}</option>
                            ))}
                        </select>

                        <select
                            value={selectedClient}
                            onChange={(e) => setSelectedClient(e.target.value)}
                            aria-label="Filter by Client"
                            className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none flex-1 md:flex-none"
                        >
                            <option value="all">All Clients</option>
                            {clients.map(client => (
                                <option key={client.id} value={client.id}>{client.name}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            {/* Desktop Table View */}
            <div className="hidden md:block bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-gray-50 text-gray-700 font-medium border-b">
                            <tr>
                                <th className="px-4 py-3 min-w-[200px]">Employee</th>
                                <th className="px-4 py-3 text-center bg-blue-50/50 border-x">Charge Back Rates (£)</th>
                                <th className="px-4 py-3 text-center bg-green-50/50 border-r">Paid Rates (£)</th>
                                <th className="px-4 py-3 w-32">CIS Deduction</th>
                                <th className="px-4 py-3 w-40">UTR Number</th>
                                <th className="px-4 py-3 w-24 text-center">Action</th>
                            </tr>
                            {/* Sub-headers for Rates */}
                            <tr className="text-xs text-gray-500 border-b">
                                <th className="px-4 py-2"></th>
                                <th className="px-2 py-2 bg-blue-50/50 border-x">
                                    <div className="flex gap-2 justify-center">
                                        <span className="w-20 text-center">Basic</span>
                                        <span className="w-20 text-center">Overtime</span>
                                    </div>
                                </th>
                                <th className="px-2 py-2 bg-green-50/50 border-r">
                                    <div className="flex gap-2 justify-center">
                                        <span className="w-20 text-center">Basic</span>
                                        <span className="w-20 text-center">Overtime</span>
                                    </div>
                                </th>
                                <th colSpan={3}></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {filteredEmployees.map(emp => {
                                const edit = edits[emp.id] || {};
                                const rates = edit.rates || {};

                                return (
                                    <tr key={emp.id} className="hover:bg-gray-50">
                                        <td className="px-4 py-3 font-medium text-gray-900">
                                            <div>{emp.displayName}</div>
                                            <div className="text-xs text-gray-400 font-normal">{emp.email}</div>
                                        </td>

                                        {/* Charge Back Inputs */}
                                        <td className="px-4 py-3 bg-blue-50/10 border-x">
                                            <div className="flex gap-2 justify-center">
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    placeholder="0.00"
                                                    value={rates.chargeBackBasic}
                                                    onChange={(e) => handleChange(emp.id, 'rates', 'chargeBackBasic', e.target.value)}
                                                    className="w-24 px-2 py-1 border rounded text-sm text-right focus:border-blue-500 outline-none"
                                                />
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    placeholder="0.00"
                                                    value={rates.chargeBackOvertime}
                                                    onChange={(e) => handleChange(emp.id, 'rates', 'chargeBackOvertime', e.target.value)}
                                                    className="w-24 px-2 py-1 border rounded text-sm text-right focus:border-blue-500 outline-none"
                                                />
                                            </div>
                                        </td>

                                        {/* Pay Rates Inputs */}
                                        <td className="px-4 py-3 bg-green-50/10 border-r">
                                            <div className="flex gap-2 justify-center">
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    placeholder="0.00"
                                                    value={rates.payBasic}
                                                    onChange={(e) => handleChange(emp.id, 'rates', 'payBasic', e.target.value)}
                                                    className="w-24 px-2 py-1 border rounded text-sm text-right focus:border-green-500 outline-none"
                                                />
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    placeholder="0.00"
                                                    value={rates.payOvertime}
                                                    onChange={(e) => handleChange(emp.id, 'rates', 'payOvertime', e.target.value)}
                                                    className="w-24 px-2 py-1 border rounded text-sm text-right focus:border-green-500 outline-none"
                                                />
                                            </div>
                                        </td>

                                        {/* CIS Deduction */}
                                        <td className="px-4 py-3">
                                            <select
                                                value={edit.cisDeduction}
                                                onChange={(e) => handleChange(emp.id, 'cisDeduction', null, e.target.value)}
                                                aria-label="Select CIS Deduction"
                                                className="w-full px-2 py-1 border rounded text-sm outline-none focus:border-purple-500"
                                            >
                                                <option value="N/A">N/A</option>
                                                <option value="20%">20%</option>
                                                <option value="30%">30%</option>
                                            </select>
                                        </td>

                                        {/* UTR Number */}
                                        <td className="px-4 py-3">
                                            <input
                                                type="text"
                                                placeholder="UTR..."
                                                value={edit.utrNumber}
                                                onChange={(e) => handleChange(emp.id, 'utrNumber', null, e.target.value)}
                                                className="w-full px-2 py-1 border rounded text-sm outline-none focus:border-purple-500"
                                            />
                                        </td>

                                        {/* Action */}
                                        <td className="px-4 py-3 text-center">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => handleSave(emp.id)}
                                                disabled={saving[emp.id]}
                                                className={saving[emp.id] ? 'opacity-50' : ''}
                                            >
                                                {saving[emp.id] ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 text-purple-600" />}
                                            </Button>
                                        </td>
                                    </tr>
                                );
                            })}

                            {filteredEmployees.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                                        No employees found.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden space-y-4">
                {filteredEmployees.length === 0 ? (
                    <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-500">
                        No employees found.
                    </div>
                ) : (
                    filteredEmployees.map(emp => {
                        const edit = edits[emp.id] || {};
                        const rates = edit.rates || {};

                        return (
                            <div key={emp.id} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                                <div className="p-4 border-b border-gray-100 bg-gray-50">
                                    <div className="font-semibold text-gray-900">{emp.displayName}</div>
                                    <div className="text-xs text-gray-500">{emp.email}</div>
                                </div>

                                <div className="p-4 space-y-4">
                                    {/* Charge Rates */}
                                    <div className="space-y-2">
                                        <div className="text-xs font-semibold text-blue-700 uppercase tracking-wider mb-1">Charge Back Rates (£)</div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="text-xs text-gray-500 mb-1 block">Basic</label>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    placeholder="0.00"
                                                    value={rates.chargeBackBasic}
                                                    onChange={(e) => handleChange(emp.id, 'rates', 'chargeBackBasic', e.target.value)}
                                                    className="w-full px-3 py-2 border border-blue-200 bg-blue-50/20 rounded-lg text-sm focus:border-blue-500 outline-none"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs text-gray-500 mb-1 block">Overtime</label>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    placeholder="0.00"
                                                    value={rates.chargeBackOvertime}
                                                    onChange={(e) => handleChange(emp.id, 'rates', 'chargeBackOvertime', e.target.value)}
                                                    className="w-full px-3 py-2 border border-blue-200 bg-blue-50/20 rounded-lg text-sm focus:border-blue-500 outline-none"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Pay Rates */}
                                    <div className="space-y-2">
                                        <div className="text-xs font-semibold text-green-700 uppercase tracking-wider mb-1">Pay Rates (£)</div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="text-xs text-gray-500 mb-1 block">Basic</label>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    placeholder="0.00"
                                                    value={rates.payBasic}
                                                    onChange={(e) => handleChange(emp.id, 'rates', 'payBasic', e.target.value)}
                                                    className="w-full px-3 py-2 border border-green-200 bg-green-50/20 rounded-lg text-sm focus:border-green-500 outline-none"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs text-gray-500 mb-1 block">Overtime</label>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    placeholder="0.00"
                                                    value={rates.payOvertime}
                                                    onChange={(e) => handleChange(emp.id, 'rates', 'payOvertime', e.target.value)}
                                                    className="w-full px-3 py-2 border border-green-200 bg-green-50/20 rounded-lg text-sm focus:border-green-500 outline-none"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="h-px bg-gray-100 my-2"></div>

                                    {/* Other Details */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-xs text-gray-500 mb-1 block">CIS Deduction</label>
                                            <select
                                                value={edit.cisDeduction}
                                                onChange={(e) => handleChange(emp.id, 'cisDeduction', null, e.target.value)}
                                                aria-label="Select CIS Deduction"
                                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-purple-500 outline-none"
                                            >
                                                <option value="N/A">N/A</option>
                                                <option value="20%">20%</option>
                                                <option value="30%">30%</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-xs text-gray-500 mb-1 block">UTR Number</label>
                                            <input
                                                type="text"
                                                placeholder="UTR..."
                                                value={edit.utrNumber}
                                                onChange={(e) => handleChange(emp.id, 'utrNumber', null, e.target.value)}
                                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-purple-500 outline-none"
                                            />
                                        </div>
                                    </div>

                                    <Button
                                        size="default"
                                        variant="primary"
                                        onClick={() => handleSave(emp.id)}
                                        disabled={saving[emp.id]}
                                        isLoading={saving[emp.id]}
                                        cn="w-full mt-2"
                                        icon={Save}
                                    >
                                        Save Changes
                                    </Button>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};

export default RateAllowancePage;
