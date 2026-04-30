import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { User, X, UserPlus, ArrowRight, UserX } from 'lucide-react';
import Header from '../../components/layout/Header';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import PaymentConfirmationModal from '../../components/modals/PaymentConfirmationModal';
import RenewalPaymentConfirmationModal from '../../components/modals/RenewalPaymentConfirmationModal';
import DeleteConfirmationModal from '../../components/modals/DeleteConfirmationModal';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { fetchCompanyDashboardData } from '../../services/dataCache';
import { getBillingSummary, recordSeatTopUp, recordSubscriptionPayment } from '../../services/billing';
import { parseCompanyId } from '../../utils/dataParser';
import { toast } from 'react-toastify';
import { createStripeCheckoutSession, createStripeCustomer, USE_STRIPE, updateStripeSubscription } from '../../services/stripe';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/client';

/** Roles that can see the payment/renewal flow. Only Senior Manager and Site Manager. All other roles see "Contact administrator". */
const ROLES_CAN_ACCESS_PAYMENT = ['siteManager', 'seniorManager'];

const ManageTeamRenewalPage = ({ onContinuePayment }) => {
  const { user } = useAuth();
  const userRole = user?.role || user?.primaryRole || '';
  const canAccessPayment = ROLES_CAN_ACCESS_PAYMENT.includes(userRole);
  const [teamMembers, setTeamMembers] = useState([]);
  const navigate = useNavigate();
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showSeatPaymentModal, setShowSeatPaymentModal] = useState(false);
  const [showRenewalPaymentModal, setShowRenewalPaymentModal] = useState(false);
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [selectedUserToRemove, setSelectedUserToRemove] = useState(null);
  const [newUsers, setNewUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pricePerSeat, setPricePerSeat] = useState(5);
  const [seatCount, setSeatCount] = useState(0);
  const [billingSummary, setBillingSummary] = useState(null);
  const [isBillingLoading, setIsBillingLoading] = useState(true);
  const [isRenewalProcessing, setIsRenewalProcessing] = useState(false);

  const companyId = parseCompanyId(user?.companyId);

  const loadData = useCallback(async () => {
    if (!companyId) {
      setIsLoading(false);
      return;
    }
    try {
      setIsLoading(true);
      const data = await fetchCompanyDashboardData(companyId);
      const mappedMembers = (data.teamMembers || []).map((member, index) => ({
        id: member.id || index,
        name: member.name || 'Unnamed User',
        email: member.email || 'No email',
        role: member.role || 'Employee',
        joinDate: member.joinDate || member.createdAt || '—',
        status: member.status || 'Inactive',
        selected: member.status === 'Active'
      }));
      setTeamMembers(mappedMembers);
      setPricePerSeat(data.pricePerSeat || 5);
      setSeatCount(data.totalSeats || 0);
    } catch (error) {
      console.error('Failed to load subscription data:', error);
      toast.error('Failed to load subscription data');
    } finally {
      setIsLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const loadBillingSummary = useCallback(async () => {
    if (!companyId) {
      setBillingSummary(null);
      setIsBillingLoading(false);
      return;
    }
    try {
      setIsBillingLoading(true);
      const summary = await getBillingSummary(companyId);
      setBillingSummary(summary);
    } catch (error) {
      console.error('Failed to load billing summary:', error);
      toast.error('Failed to load billing summary');
    } finally {
      setIsBillingLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    loadBillingSummary();
  }, [loadBillingSummary]);

  const selectedCount = teamMembers.filter(m => m.selected).length;
  const planSeatCount = seatCount || 0;
  const totalCost = useMemo(() => {
    let cost = planSeatCount * pricePerSeat;
    if (billingSummary?.plugins?.scheduling) {
      cost += 2.50; // Add scheduling add-on if active
    }
    return cost.toFixed(2);
  }, [planSeatCount, pricePerSeat, billingSummary?.plugins]);
  const formatBillingDate = (date) =>
    date
      ? new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      : '—';
  const formatBillingCurrency = (amount) =>
    new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: billingSummary?.currency || 'GBP'
    }).format(amount || 0);
  const formatStatusLabel = (status = '') =>
    status
      ? status.replace(/[_-]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
      : '—';

  const handleToggleUser = (id) => {
    setTeamMembers(teamMembers.map(member =>
      member.id === id ? { ...member, selected: !member.selected } : member
    ));
  };

  const handleRemoveUser = (id) => {
    const user = teamMembers.find(m => m.id === id);
    setSelectedUserToRemove(user);
    setShowRemoveModal(true);
  };

  const handleConfirmRemove = () => {
    if (!selectedUserToRemove) return;
    setTeamMembers(teamMembers.filter(member => member.id !== selectedUserToRemove.id));
    setShowRemoveModal(false);
    setSelectedUserToRemove(null);
  };

  const handleSeatPaymentConfirm = async (seatQuantity = 1) => {
    if (!companyId) {
      toast.error('Company configuration invalid. Please contact your administrator.');
      return;
    }
    try {
      const result = await recordSeatTopUp(companyId, seatQuantity);

      // Check if checkout is required
      if (result && result.requiresCheckout && result.checkoutUrl) {
        // Redirect to Stripe Checkout
        window.location.href = result.checkoutUrl;
        return;
      }

      // Mock payment or direct update (fallback)
      const seatsToAppend = Array.from({ length: seatQuantity }, (_, idx) => ({
        fullName: 'Additional Seat',
        email: '',
        tempId: `${Date.now()}-${idx}`
      }));
      setNewUsers((prev) => [...prev, ...seatsToAppend]);
      setShowSeatPaymentModal(false);
      toast.success(`${seatQuantity} seat${seatQuantity > 1 ? 's' : ''} added to your subscription.`);
      await Promise.all([loadData(), loadBillingSummary()]);
    } catch (error) {
      console.error('Failed to add seat:', error);
      toast.error(error?.message || 'Failed to add seat');
    }
  };

  const handleBack = () => {
    window.history.back();
  };

  const handleContinuePayment = () => {
    setShowRenewalPaymentModal(true);
  };

  const handleRenewalConfirm = async () => {
    if (!companyId) {
      toast.error('Company configuration invalid. Please contact your administrator.');
      return;
    }
    try {
      setIsRenewalProcessing(true);
      const seatsToBill = seatCount || billingSummary?.seatQuota || teamMembers.filter(m => m.selected).length;

      if (USE_STRIPE) {
        // Use Stripe Checkout for subscription creation
        try {
          // Get company data to check for Stripe customer
          const companyRef = doc(db, 'companies', companyId);
          const companySnap = await getDoc(companyRef);
          const companyData = companySnap.exists() ? companySnap.data() : {};

          let customerId = companyData.stripeCustomerId;

          // Create customer if doesn't exist
          if (!customerId && user?.email) {
            customerId = await createStripeCustomer(
              companyId,
              user.email,
              companyData.name || 'Company'
            );
          }

          if (!customerId) {
            throw new Error('Unable to create or retrieve Stripe customer');
          }

          // Create checkout session
          const baseUrl = window.location.origin;
          const session = await createStripeCheckoutSession(
            customerId,
            seatsToBill,
            companyId,
            `${baseUrl}/billing?session_id={CHECKOUT_SESSION_ID}`,
            `${baseUrl}/manageSubscription?canceled=true`
          );

          // Redirect to Stripe Checkout
          if (session.url) {
            window.location.href = session.url;
            return; // Don't close modal yet - redirect will happen
          } else {
            throw new Error('No checkout URL returned from Stripe');
          }
        } catch (stripeError) {
          console.error('Stripe checkout failed, falling back to mock payment:', stripeError);
          toast.warn('Stripe payment unavailable, using mock payment');
          // Fall through to mock payment
        }
      }

      // Fallback to mock payment if Stripe is disabled or fails
      await recordSubscriptionPayment(companyId, seatsToBill);
      if (onContinuePayment) {
        const selected = teamMembers.filter(m => m.selected);
        onContinuePayment(selected, totalCost, { newUsers, seatCount });
      }
      toast.success('Subscription renewal confirmed');
      setShowRenewalPaymentModal(false);
      await Promise.all([loadData(), loadBillingSummary()]);
    } catch (error) {
      console.error('Failed to renew subscription:', error);
      toast.error(error?.message || 'Failed to renew subscription');
    } finally {
      setIsRenewalProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="h-screen flex flex-col overflow-hidden">
        <Header title="Company Dashboard" subtitle="Grow your digital workplace and manage your team seamlessly" />
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
        </div>
      </div>
    );
  }

  if (!canAccessPayment) {
    return (
      <div className="h-screen flex flex-col overflow-hidden">
        <Header
          title="Company Dashboard"
          subtitle="Grow your digital workplace and manage your team seamlessly"
        />
        <div className="flex-1 overflow-y-auto p-4 md:p-3xl scrollbar-custom flex items-center justify-center">
          <div className="w-full max-w-md bg-amber-50 border border-amber-200 rounded-base p-8 text-center">
            <div className="flex justify-center mb-4">
              <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center">
                <UserX className="h-10 w-10 text-amber-600" />
              </div>
            </div>
            <h2 className="text-xl font-semibold text-text-primary mb-2">
              Contact your administrator
            </h2>
            <p className="text-sm text-text-secondary mb-4">
              Only administrators can renew the subscription. Please contact your Site Manager or Senior Manager to restore access to the platform.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Header
        title="Company Dashboard"
        subtitle="Grow your digital workplace and manage your team seamlessly"
      />

      <div className="flex-1 overflow-y-auto p-4 md:p-3xl scrollbar-custom">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Page Title */}
          <div className="space-y-2">
            <h1 className="text-2xl md:text-3xl font-bold text-text-primary">
              Manage Your Team
            </h1>
            <p className="text-sm md:text-md text-text-secondary">
              Review your existing users and add new team members before renewing your subscription
            </p>

          </div>

          {/* Billing Overview */}
          <div className="bg-white border border-border-secondary rounded-base p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-text-primary">
                Billing Overview
              </h2>
              {isBillingLoading && (
                <span className="text-xs text-text-secondary">Loading...</span>
              )}
            </div>
            {billingSummary ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <span className="text-xs uppercase text-text-secondary">Plan Status</span>
                  <span className="text-lg font-semibold text-text-primary">
                    {formatStatusLabel(billingSummary.subscriptionStatus)}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs uppercase text-text-secondary">Monthly Amount</span>
                  <span className="text-lg font-semibold text-text-primary">
                    £{totalCost}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs uppercase text-text-secondary">Trial Ends</span>
                  <span className="text-md font-semibold text-text-primary">
                    {formatBillingDate(billingSummary.trialEndsAt)}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs uppercase text-text-secondary">Next Renewal</span>
                  <span className="text-md font-semibold text-text-primary">
                    {formatBillingDate(billingSummary.renewalDate)}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs uppercase text-text-secondary">Seats In Use</span>
                  <span className="text-md font-semibold text-text-primary">
                    {billingSummary.currentSeatsInUse} / {billingSummary.seatQuota}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs uppercase text-text-secondary">Seat Shortage</span>
                  <span className="text-md font-semibold text-text-primary">
                    {billingSummary.seatShortage}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-text-secondary">
                Billing information is not available for this company yet.
              </p>
            )}
          </div>

          <div className="bg-white border border-border-secondary rounded-base p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-text-primary mb-4">
              Subscription Summary
            </h2>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 flex-wrap">
              <span className="text-md text-text-accent-purple font-medium">
                Selected Users: {selectedCount}
              </span>
              <span className="text-md text-text-accent-purple font-medium">
                £{pricePerSeat.toFixed(2)} Per User Per Month
              </span>
              <span className="text-md text-text-secondary">
                Current Seats: {planSeatCount}
              </span>
              <span className="text-lg font-bold text-text-accent-purple">
                £{totalCost}/Month
              </span>
            </div>
          </div>

          {/* Existing Team Members Section */}
          <div className="bg-white border border-border-secondary rounded-base shadow-sm">
            <div className="p-6 border-b border-border-secondary">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-text-primary">
                    Existing Team Members
                  </h2>
                  <p className="text-sm text-text-secondary mt-1">
                    Select which users to include in your renewed subscription
                  </p>
                </div>
                <Button variant="gradient" icon={UserPlus} onClick={() => setShowPaymentModal(true)}>
                  Add Seat
                </Button>
              </div>
            </div>

            {/* Table Header - Desktop */}
            <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-4 bg-background-secondary border-b border-border-secondary text-xs font-semibold text-text-secondary uppercase">
              <div className="col-span-4">Name</div>
              <div className="col-span-2">Role</div>
              <div className="col-span-2">Join Date</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Actions</div>
            </div>

            {/* Team Members List */}
            <div className="divide-y divide-border-secondary">
              {teamMembers.length === 0 ? (
                <p className="p-6 text-sm text-text-secondary">No team members found for this company.</p>
              ) : (
                teamMembers.map((member) => (
                  <div key={member.id} className="p-4 md:p-6 hover:bg-background-secondary transition-colors">
                    {/* Desktop View */}
                    <div className="hidden md:grid grid-cols-12 gap-4 items-center">
                      <div className="col-span-4 flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={member.selected}
                          onChange={() => handleToggleUser(member.id)}
                          className="w-5 h-5 rounded border-border-secondary text-purple-600 focus:ring-purple-500"
                        />
                        <div className="w-10 h-10 bg-background-accent-purple-light rounded-full flex items-center justify-center">
                          <User className="h-5 w-5 text-text-accent-purple" />
                        </div>
                        <div>
                          <p className="font-semibold text-text-primary">{member.name}</p>
                          <p className="text-sm text-text-secondary">{member.email}</p>
                        </div>
                      </div>
                      <div className="col-span-2">
                        <Badge variant={member.role === 'Manager' ? 'role' : member.role === 'Admin' ? 'role' : 'info'}>
                          {member.role}
                        </Badge>
                      </div>
                      <div className="col-span-2 text-sm text-text-secondary">
                        {member.joinDate}
                      </div>
                      <div className="col-span-2">
                        <Badge variant={member.status === 'Active' ? 'success' : 'danger'}>
                          {member.status}
                        </Badge>
                      </div>
                      <div className="col-span-2">
                        <button
                          onClick={() => handleRemoveUser(member.id)}
                          className="flex items-center gap-2 px-3 py-2 border border-red-200 text-red-500 rounded-lg hover:bg-red-50 transition-colors"
                        >
                          <X className="h-4 w-4" />
                          Remove
                        </button>
                      </div>
                    </div>

                    {/* Mobile View */}
                    <div className="md:hidden space-y-3">
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={member.selected}
                          onChange={() => handleToggleUser(member.id)}
                          className="mt-1 w-5 h-5 rounded border-border-secondary text-purple-600 focus:ring-purple-500"
                        />
                        <div className="flex-1 space-y-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-background-accent-purple-light rounded-full flex items-center justify-center">
                              <User className="h-5 w-5 text-text-accent-purple" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-text-primary">{member.name}</p>
                              <p className="text-sm text-text-secondary truncate">{member.email}</p>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Badge variant={member.role === 'Manager' ? 'role' : member.role === 'Admin' ? 'role' : 'info'}>
                              {member.role}
                            </Badge>
                            <Badge variant={member.status === 'Active' ? 'success' : 'danger'}>
                              {member.status}
                            </Badge>
                            <span className="text-xs text-text-secondary px-2 py-1 bg-background-secondary rounded">
                              {member.joinDate}
                            </span>
                          </div>

                          <button
                            onClick={() => handleRemoveUser(member.id)}
                            className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-red-200 text-red-500 rounded-lg hover:bg-red-50 transition-colors"
                          >
                            <X className="h-4 w-4" />
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-4">
            <button
              onClick={handleBack}
              className="flex-1 sm:flex-initial px-8 py-3.5 rounded-base text-md text-text-primary hover:bg-background-secondary transition-colors border border-border-secondary"
            >
              Back
            </button>
            {!billingSummary?.renewalDate || new Date(billingSummary.renewalDate) <= new Date() || billingSummary?.isExpired ? (
              <>
                <button
                  onClick={() => navigate('/offlinePayment')}
                  className="flex-1 sm:flex-initial px-8 py-3.5 rounded-base text-md  hover:bg-background-secondary transition-colors border border-border-accent-purple text-text-accent-purple"
                >
                  Submit Offline Payment
                </button>
                <button
                  onClick={handleContinuePayment}
                  className="flex-1 min-h-14 bg-[linear-gradient(91.36deg,#AF54DD_4.75%,#7617A7_96.14%)] text-white rounded-base font-semibold text-md flex items-center justify-center gap-2.5 hover:opacity-90 transition-opacity"
                >
                  <span>Continue to Online Payment (£{totalCost}/month)</span>
                  <div className="w-6 h-6 bg-white rounded-full flex items-center justify-center">
                    <ArrowRight className="h-4 w-4 text-[#CB30E0]" />
                  </div>
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* Modals */}
      <PaymentConfirmationModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        onConfirm={handleSeatPaymentConfirm}
        isSeatPurchase
        pricePerUser={pricePerSeat}
      />
      <DeleteConfirmationModal
        isOpen={showRemoveModal}
        onClose={() => setShowRemoveModal(false)}
        onConfirm={handleConfirmRemove}
        title="Remove Seat"
        description="Are you sure you want to remove this team member's access?"
        warningMessage="This user will lose access immediately. Their seat will be removed from your next billing cycle."
        confirmButtonText="Remove Seat"
        itemDetails={{
          name: selectedUserToRemove?.name,
          email: selectedUserToRemove?.email,
          role: selectedUserToRemove?.role
        }}
      />
      <RenewalPaymentConfirmationModal
        isOpen={showRenewalPaymentModal}
        onClose={() => setShowRenewalPaymentModal(false)}
        onConfirm={handleRenewalConfirm}
        selectedUsers={teamMembers.filter(m => m.selected)}
        newUsers={newUsers}
        isProcessing={isRenewalProcessing}
        seatCountOverride={planSeatCount}
        pricePerSeat={pricePerSeat}
        hasScheduling={!!billingSummary?.plugins?.scheduling}
      />
    </div>
  );
};

export default ManageTeamRenewalPage;