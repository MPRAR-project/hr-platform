import React, { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { getInvoiceSettings, updateInvoiceSettings } from '../../services/invoiceSettings';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Loader2, Save, Upload, Receipt, Building, Menu } from 'lucide-react';
import { useUI } from '../../hooks/useUI';
import { toast } from 'react-toastify';

const InvoiceSettingsPage = () => {
    const { user } = useAuth();
    const { openSidebar } = useUI();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [errors, setErrors] = useState({});

    // Form State
    const [settings, setSettings] = useState({
        companyName: '',
        address: '',
        bankDetails: '',
        utrNumber: '',
        vatNumber: '',
        nextInvoicePrefix: 'INV-',
        nextInvoiceNumber: 1,
        logoUrl: '',
    });

    const validateBankDetails = (text) => {
        const newErrors = {};
        const value = (text || '').trim();

        if (!value) {
            newErrors.bankDetails = 'Add bank name, sort code and account number.';
            return newErrors;
        }

        const bankNameMatch = value.match(/Bank\s*Name:\s*(.+)/i);
        const sortCodeMatch = value.match(/Sort\s*Code:\s*([0-9-]+)/i);
        const accountNoMatch = value.match(/Account\s*No:\s*([0-9\s]+)/i);

        if (!bankNameMatch || !bankNameMatch[1].trim()) {
            newErrors.bankDetails = 'Please include "Bank Name: ..." with the real bank name.';
        } else if (!sortCodeMatch || !/^(\d{2}-\d{2}-\d{2}|\d{6})$/.test(sortCodeMatch[1].replace(/\s/g, ''))) {
            newErrors.bankDetails = 'Please include a valid sort code, e.g. "Sort Code: 12-34-56".';
        } else if (!accountNoMatch || accountNoMatch[1].replace(/\s/g, '').length < 6) {
            newErrors.bankDetails = 'Please include an account number after "Account No:".';
        }

        return newErrors;
    };

    useEffect(() => {
        if (user?.companyId) {
            loadSettings();
        }
    }, [user?.companyId]);

    const loadSettings = async () => {
        try {
            const data = await getInvoiceSettings(user.companyId);
            setSettings(prev => ({ ...prev, ...data }));
        } catch (error) {
            toast.error('Failed to load settings');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (e) => {
        e.preventDefault();

        // Only validate Bank Payment Details for now
        const bankErrors = validateBankDetails(settings.bankDetails);
        if (Object.keys(bankErrors).length > 0) {
            setErrors(bankErrors);
            toast.error('Please fill Bank Payment Details using Bank Name, Sort Code and Account No.');
            return;
        }

        setSaving(true);
        try {
            await updateInvoiceSettings(user.companyId, settings);
            toast.success('Settings saved successfully');
        } catch (error) {
            toast.error('Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    const handleLogoUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Validation
        if (file.size > 2 * 1024 * 1024) {
            toast.error('Image must be under 2MB');
            return;
        }

        setUploading(true);
        try {
            const storage = getStorage();
            const storageRef = ref(storage, `companies/${user.companyId}/invoice_logo_${Date.now()}`);
            await uploadBytes(storageRef, file);
            const url = await getDownloadURL(storageRef);

            setSettings(prev => ({ ...prev, logoUrl: url }));
            toast.success('Logo uploaded');
        } catch (error) {
            console.error(error);
            toast.error('Upload failed');
        } finally {
            setUploading(false);
        }
    };

    if (loading) return <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>;

    return (
        <div className="p-6 max-w-4xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-3">
                    <button
                        onClick={openSidebar}
                        className="lg:hidden p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                    >
                        <Menu className="w-6 h-6" />
                    </button>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Invoice Settings</h1>
                        <p className="text-gray-500">Configure your company details for PDF invoices.</p>
                    </div>
                </div>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save Changes
                </button>
            </div>

            <form onSubmit={handleSave} className="space-y-6">
                {/* Branding Section */}
                <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                        <Upload className="w-5 h-5 text-gray-400" />
                        Company Branding
                    </h2>

                    <div className="flex items-start gap-6">
                        <div className="w-40 h-40 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center bg-gray-50 overflow-hidden relative">
                            {settings.logoUrl ? (
                                <img src={settings.logoUrl} alt="Logo" className="w-full h-full object-contain" />
                            ) : (
                                <span className="text-gray-400 text-sm">No Logo</span>
                            )}
                            {uploading && (
                                <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center">
                                    <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                                </div>
                            )}
                        </div>

                        <div className="flex-1">
                            <label className="block text-sm font-medium text-gray-700 mb-2">Upload Logo</label>
                            <input
                                type="file"
                                accept="image/*"
                                onChange={handleLogoUpload}
                                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                            />
                            <p className="mt-2 text-sm text-gray-500">
                                Recommended: PNG or JPG, clear background. Max 2MB.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Company Details */}
                <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                        <Building className="w-5 h-5 text-gray-400" />
                        Company Details
                    </h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Company Legal Name</label>
                            <input
                                type="text"
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                                value={settings.companyName}
                                onChange={e => setSettings({ ...settings, companyName: e.target.value })}
                                placeholder="Your Company Ltd"
                            />
                        </div>

                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Address (Multi-line)</label>
                            <textarea
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                                rows="3"
                                value={settings.address}
                                onChange={e => setSettings({ ...settings, address: e.target.value })}
                                placeholder="123 Business St&#10;City, Postcode"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">VAT Number</label>
                            <input
                                type="text"
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                                value={settings.vatNumber}
                                onChange={e => setSettings({ ...settings, vatNumber: e.target.value })}
                                placeholder="GB..."
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">UTR Number</label>
                            <input
                                type="text"
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                                value={settings.utrNumber}
                                onChange={e => setSettings({ ...settings, utrNumber: e.target.value })}
                                placeholder="Unique Taxpayer Reference"
                            />
                        </div>
                    </div>
                </div>

                {/* Financial & Sequence */}
                <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                        <Receipt className="w-5 h-5 text-gray-400" />
                        Financial & Sync
                    </h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Bank Payment Details</label>
                            <textarea
                                className={`w-full border rounded-lg px-3 py-2 outline-none focus:ring-2 ${errors.bankDetails ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-blue-500'}`}
                                rows="3"
                                value={settings.bankDetails}
                                onChange={e => {
                                    setSettings({ ...settings, bankDetails: e.target.value });
                                    if (errors.bankDetails) {
                                        setErrors(prev => ({ ...prev, bankDetails: undefined }));
                                    }
                                }}
                                onFocus={() => {
                                    setSettings(prev => {
                                        if ((prev.bankDetails || '').trim()) return prev;
                                        return {
                                            ...prev,
                                            bankDetails: 'Bank Name: \nSort Code: \nAccount No: ',
                                        };
                                    });
                                }}
                                placeholder="Bank Name: ...&#10;Sort Code: ...&#10;Account No: ..."
                            />
                            <p className="text-xs text-gray-500 mt-1">These details will appear in the footer of every invoice.</p>
                            {errors.bankDetails && (
                                <p className="text-xs text-red-600 mt-1">{errors.bankDetails}</p>
                            )}
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Inv Prefix</label>
                            <input
                                type="text"
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                                value={settings.nextInvoicePrefix}
                                onChange={e => setSettings({ ...settings, nextInvoicePrefix: e.target.value })}
                                placeholder="e.g. INV-"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Next Sequence Number</label>
                            <input
                                type="number"
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                                value={settings.nextInvoiceNumber}
                                onChange={e => setSettings({ ...settings, nextInvoiceNumber: parseInt(e.target.value) || 1 })}
                            />
                            <p className="text-xs text-gray-500 mt-1">Current auto-increment value.</p>
                        </div>


                    </div>
                </div>


            </form >
        </div >
    );
};

export default InvoiceSettingsPage;
