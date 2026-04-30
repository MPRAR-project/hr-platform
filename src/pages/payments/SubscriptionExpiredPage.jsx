import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, Clock, ArrowRight, Loader2, ChevronDown, UserX } from 'lucide-react';
import Header from '../../components/layout/Header';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { getBillingSummary } from '../../services/billing';
import { fetchCompanyDashboardData } from '../../services/dataCache';
import { parseCompanyId } from '../../utils/dataParser';
import { toast } from 'react-toastify';

/** Roles that can see the payment dialog to restore access after trial. Only Senior Manager and Site Manager. All other roles see "Contact administrator". */
const ROLES_CAN_ACCESS_PAYMENT = ['siteManager', 'seniorManager'];

const SubscriptionExpiredPage = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const userRole = user?.role || user?.primaryRole || '';
    const canAccessPayment = ROLES_CAN_ACCESS_PAYMENT.includes(userRole);
    const [billingSummary, setBillingSummary] = useState(null);
    const [companyData, setCompanyData] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isUsersDropdownOpen, setIsUsersDropdownOpen] = useState(false);

    const pretty = (role = '') =>
        role.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
    const formatStatus = (status = '') =>
        status
            .replace(/[_-]/g, ' ')
            .replace(/\b\w/g, (char) => char.toUpperCase()) || 'Expired';

    const companyName = useMemo(() => {
        return billingSummary?.companyName || companyData?.companyName || 'Your company';
    }, [billingSummary?.companyName, companyData?.companyName]);

    const isPaymentDue = useMemo(() => {
        if (!billingSummary) return true;
        if (billingSummary.isExpired) return true;
        const renewalDate = billingSummary.renewalDate ? new Date(billingSummary.renewalDate) : null;
        if (!renewalDate) return true;
        const today = new Date();
        return renewalDate <= today;
    }, [billingSummary]);

    const getStatusVisual = () => {
        if (isLoading) {
            return {
                icon: Loader2,
                iconBg: 'bg-gray-50',
                iconColor: 'text-gray-500 animate-spin',
                title: 'Checking Status',
                description: 'Verifying your subscription details...'
            };
        }
        const status = (billingSummary?.subscriptionStatus || 'expired').toLowerCase();
        if (billingSummary?.isExpired || status.includes('expired')) {
            return {
                icon: AlertTriangle,
                iconBg: 'bg-red-50',
                iconColor: 'text-red-500',
                title: 'Subscription Expired',
                description: `Your subscription for ${companyName} has expired`
            };
        }
        if (status.includes('past') || isPaymentDue) {
            return {
                icon: Clock,
                iconBg: 'bg-yellow-50',
                iconColor: 'text-yellow-500',
                title: 'Payment Due Soon',
                description: `Your subscription for ${companyName} needs to be renewed`
            };
        }
        return {
            icon: CheckCircle,
            iconBg: 'bg-green-50',
            iconColor: 'text-green-500',
            title: 'Subscription Active',
            description: `Your subscription for ${companyName} is active`
        };
    };
    const formatDate = (date) =>
        date
            ? new Date(date).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            })
            : '—';

    const loadBillingSummary = useCallback(async () => {
        if (!user?.companyId) {
            setBillingSummary(null);
            setIsLoading(false);
            return;
        }
        try {
            setIsLoading(true);
            const summary = await getBillingSummary(user.companyId);
            setBillingSummary(summary);
        } catch (error) {
            console.error('Failed to load billing summary', error);
            toast.error('Unable to load billing data. Please try again.');
        } finally {
            setIsLoading(false);
        }
    }, [user?.companyId]);

    const loadCompanyData = useCallback(async () => {
        if (!user?.companyId) {
            setCompanyData(null);
            return;
        }
        try {
            const companyId = parseCompanyId(user.companyId);
            const data = await fetchCompanyDashboardData(companyId);
            setCompanyData(data);
        } catch (error) {
            console.error('Failed to load company data', error);
            // Don't show error toast, just log it - company data is optional
        }
    }, [user?.companyId]);

    useEffect(() => {
        loadBillingSummary();
        loadCompanyData();
    }, [loadBillingSummary, loadCompanyData]);

    const handleUpgrade = () => {
        if (!user?.companyId) {
            toast.error('Missing company configuration. Please contact support.');
            return;
        }
        navigate('/manageSubscription');
    };

    const expiryDate = billingSummary?.isTrial ? billingSummary?.trialEndsAt : billingSummary?.renewalDate;
    const statusLabel = isLoading
        ? 'Checking...'
        : formatStatus(billingSummary?.subscriptionStatus || 'expired');

    // Get real user count from company data or billing summary
    const totalUsers = companyData?.totalUsers || companyData?.teamMembers?.length || billingSummary?.currentSeatsInUse || 0;
    const teamMembersCount = companyData?.teamMembers?.length || 0;
    const seatsLabel = totalUsers > 0
        ? `${totalUsers} Team Member${totalUsers === 1 ? '' : 's'}`
        : '0 Team Members';

    const monthlyCost = billingSummary?.monthlyAmount
        ? new Intl.NumberFormat('en-GB', { style: 'currency', currency: billingSummary.currency || 'GBP' }).format(billingSummary.monthlyAmount)
        : '£0.00';


    const isSubscriptionActive = useMemo(() => {
        if (!billingSummary) return false;
        return !billingSummary.isExpired && billingSummary.subscriptionStatus === 'active';
    }, [billingSummary]);

    useEffect(() => {
        if (isSubscriptionActive && !isLoading) {
            // Auto-redirect to dashboard if active
            const timer = setTimeout(() => navigate('/'), 2000);
            return () => clearTimeout(timer);
        }
    }, [isSubscriptionActive, isLoading, navigate]);

    const showContactAdminOnly = !canAccessPayment && isPaymentDue && !isLoading;

    return (
        <div className={`min-h-screen flex flex-col overflow-hidden ${showContactAdminOnly ? '' : 'justify-center'}`}>
            <Header
                title={showContactAdminOnly ? 'Subscription' : `${pretty(user?.role || '')} Dashboard`}
                subtitle={showContactAdminOnly ? 'Your access requires an active subscription' : 'Grow your digital workplace and manage your team seamlessly'}
            />

            <div className={`flex-1 overflow-y-auto p-4 md:p-3xl scrollbar-custom flex ${showContactAdminOnly ? 'items-start justify-center pt-6' : 'items-center justify-center'}`}>
                <div className={`w-full max-w-2xl text-center space-y-6 ${showContactAdminOnly ? 'pt-4' : 'pt-24'}`}>
                    {/* Contact administrator: single focused view with proper card */}
                    {showContactAdminOnly ? (
                        <div className="bg-amber-50 border border-amber-200 rounded-base p-6 md:p-8 max-w-md mx-auto text-center shadow-sm">
                            <div className="flex justify-center mb-4">
                                <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center ring-4 ring-amber-100 border border-amber-200">
                                    <UserX className="h-8 w-8 text-amber-600" />
                                </div>
                            </div>
                            <h2 className="text-xl font-semibold text-text-primary mb-2">
                                Contact your administrator
                            </h2>
                            <p className="text-sm text-text-secondary leading-relaxed">
                                Your subscription has expired. Only administrators can renew the subscription. Please contact your Site Manager or Senior Manager to restore access.
                            </p>
                            <p className="text-sm text-text-secondary mt-6">
                                Questions about your subscription? Contact support at{' '}
                                <button
                                    onClick={(e) => {
                                        e.preventDefault();
                                        window.location.href = 'mailto:support@platform.com';
                                    }}
                                    className="text-text-accent-purple hover:underline bg-transparent border-none cursor-pointer font-medium"
                                    style={{ padding: 0, fontSize: 'inherit' }}
                                >
                                    support@platform.com
                                </button>
                            </p>
                        </div>
                    ) : (
                    <>
                    {/* Alert Icon */}
                    <div className="flex mt-14 justify-center">
                        <div className={`w-24 h-24 ${getStatusVisual().iconBg} rounded-full flex items-center justify-center`}>
                            {React.createElement(getStatusVisual().icon, { className: `h-12 w-12 ${getStatusVisual().iconColor}` })}
                        </div>
                    </div>

                    {/* Title */}
                    <div className="space-y-3">
                        <h1 className="text-3xl md:text-4xl font-bold text-text-primary">
                            {getStatusVisual().title}
                        </h1>
                        <p className="text-lg text-text-secondary">
                            {getStatusVisual().description}
                        </p>
                    </div>

                    {/* Subscription Details Card — only for roles that can access payment */}
                    {canAccessPayment && (
                    <div className="bg-white shadow-lg rounded-base p-6 md:p-8  text-left space-y-6">
                        <div className="space-y-4">
                            <h2 className="text-xl font-semibold text-text-primary">
                                Subscription Details
                            </h2>
                            <p className="text-sm text-text-secondary">
                                {isLoading
                                    ? 'Verifying your subscription...'
                                    : isSubscriptionActive
                                        ? 'Your subscription is currently active and you have full access.'
                                        : 'Your access has been temporarily suspended due to subscription expiry'}
                            </p>
                        </div>

                        <div className="space-y-4">
                            <div className="flex justify-between items-center py-3 border-b border-border-secondary">
                                <span className="text-sm text-text-secondary">Company</span>
                                <span className="text-md font-semibold text-text-primary">{companyName}</span>
                            </div>

                            <div className="flex justify-between items-center py-3 border-b border-border-secondary">
                                <span className="text-sm text-text-secondary">Subscription Status</span>
                                <span className={`text-md font-semibold ${isLoading ? 'text-text-secondary' :
                                        isSubscriptionActive ? 'text-green-500' : 'text-red-500'
                                    }`}>
                                    {statusLabel}
                                </span>
                            </div>

                            <div className="py-3 border-b border-border-secondary">
                                <button
                                    type="button"
                                    onClick={() => setIsUsersDropdownOpen(!isUsersDropdownOpen)}
                                    className="w-full flex justify-between items-center hover:opacity-80 transition-opacity"
                                >
                                    <span className="text-sm text-text-secondary">Team Members</span>
                                    <div className="flex items-center gap-2">
                                        <span className="text-md font-semibold text-text-primary">
                                            {isLoading ? (
                                                <Loader2 className="h-4 w-4 animate-spin inline-block" />
                                            ) : (
                                                seatsLabel
                                            )}
                                        </span>
                                        {companyData && companyData.teamMembers && companyData.teamMembers.length > 0 && (
                                            <ChevronDown
                                                className={`h-4 w-4 text-text-secondary transition-transform ${isUsersDropdownOpen ? 'rotate-180' : ''}`}
                                            />
                                        )}
                                    </div>
                                </button>

                                {isUsersDropdownOpen && companyData && companyData.teamMembers && companyData.teamMembers.length > 0 && (
                                    <div className="mt-3 pt-3 border-t border-border-secondary">
                                        <div className="max-h-64 overflow-y-auto space-y-2 scrollbar-custom">
                                            {companyData.teamMembers.map((member) => (
                                                <div key={member.id} className="flex items-center justify-between text-sm py-1.5 px-2 rounded hover:bg-gray-50 transition-colors">
                                                    <span className="text-text-primary font-medium">{member.name || member.email}</span>
                                                    <span className="text-text-secondary text-xs bg-gray-100 px-2 py-1 rounded-full">{member.role}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>


                            <div className="flex justify-between items-center py-3 border-b border-border-secondary">
                                <span className="text-sm text-text-secondary">Expiry Date</span>
                                <span className="text-md font-semibold text-text-primary">{formatDate(expiryDate)}</span>
                            </div>

                            {billingSummary?.plugins?.scheduling && (
                                <div className="flex justify-between items-center py-3 border-b border-border-secondary">
                                    <span className="text-sm text-text-secondary">Active Add-ons</span>
                                    <div className="text-right">
                                        <div className="text-md font-semibold text-text-primary">Shift Scheduling</div>
                                        <div className="text-xs text-text-secondary">£2.50/mo</div>
                                    </div>
                                </div>
                            )}

                            <div className="flex justify-between items-center py-3">
                                <span className="text-sm text-text-secondary">Monthly Cost</span>
                                <span className="text-md font-semibold text-text-primary">{monthlyCost}</span>
                            </div>
                        </div>

                        {/* Info Box */}
                        {!isSubscriptionActive && (
                            <div className="bg-bg-accent-purple-light border border-border-accent-purple rounded-lg p-4">
                                <p className="text-sm text-text-secondary leading-relaxed">
                                    To restore access to your Digital Workforce Management platform, please confirm the payment below.
                                </p>
                            </div>
                        )}
                    </div>
                    )}

                    {/* Action Button */}
                    {isSubscriptionActive ? (
                        <div className="space-y-4">
                            <p className="text-sm text-text-secondary">
                                Redirecting to dashboard...
                            </p>
                            <button
                                onClick={() => navigate('/')}
                                className="w-full max-w-md mx-auto h-14 bg-green-600 text-white rounded-base font-semibold text-lg flex items-center justify-center gap-2.5 hover:opacity-90 transition-opacity"
                            >
                                <span>Go to Dashboard</span>
                                <ArrowRight className="h-4 w-4" />
                            </button>
                        </div>
                    ) : isPaymentDue && canAccessPayment ? (
                        <button
                            onClick={handleUpgrade}
                            disabled={isLoading}
                            className="w-full max-w-md mx-auto h-14 bg-[linear-gradient(91.36deg,#AF54DD_4.75%,#7617A7_96.14%)] text-white rounded-base font-semibold text-lg flex items-center justify-center gap-2.5 hover:opacity-90 transition-opacity"
                        >
                            <span>Confirm Payment & Continue</span>
                            <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center">
                                <ArrowRight className="h-4 w-4 text-[#CB30E0]" />
                            </div>
                        </button>
                    ) : !isPaymentDue ? (
                        <p className="text-sm text-text-secondary">
                            Your subscription is already settled for the current cycle.
                        </p>
                    ) : null}

                    {/* Support Link */}
                    <p className="text-sm text-text-secondary">
                        Questions about your subscription? Contact support at{' '}
                        <button
                            onClick={(e) => {
                                e.preventDefault();
                                window.location.href = 'mailto:support@platform.com';
                            }}
                            className="text-text-accent-purple hover:underline bg-transparent border-none cursor-pointer font-medium"
                            style={{ padding: 0, fontSize: 'inherit' }}
                        >
                            support@platform.com
                        </button>
                    </p>
                    </>
                    )}

                </div>
            </div>
        </div>
    );
};

export default SubscriptionExpiredPage;