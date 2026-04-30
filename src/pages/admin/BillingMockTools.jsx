import React, { useMemo, useState } from 'react';
import Header from '../../components/layout/Header';
import { useAuth } from '../../hooks/useAuth';
import { doc, getDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase/client';
import { parseCompanyId } from '../../utils/dataParser';
import {
  getBillingSummary,
  recordSeatTopUp,
  recordSubscriptionPayment,
  startTrial,
  BILLING_CONSTANTS
} from '../../services/billing';
import { toast } from 'react-toastify';

const formatDateInputValue = (value) => {
  if (!value) return '';
  const date = value.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const toTimestamp = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Timestamp.fromDate(date);
};

const BillingMockTools = () => {
  const { user } = useAuth();
  const [companyIdInput, setCompanyIdInput] = useState(parseCompanyId(user?.companyId) || '');
  const [billingState, setBillingState] = useState({
    seatQuota: '',
    status: 'trial',
    trialEndsAt: '',
    renewalDate: '',
    currentEmployees: '',
    historyNote: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [summary, setSummary] = useState(null);

  const normalizedCompanyId = useMemo(() => parseCompanyId(companyIdInput), [companyIdInput]);

  const loadCompany = async () => {
    if (!normalizedCompanyId) {
      toast.error('Enter a valid company ID');
      return;
    }
    try {
      setIsLoading(true);
      const companyRef = doc(db, 'companies', normalizedCompanyId);
      const snap = await getDoc(companyRef);
      if (!snap.exists()) {
        toast.error('Company not found');
        return;
      }
      const data = snap.data();
      setBillingState({
        seatQuota: Number(data.billingSeatQuota ?? data.seatCount ?? 0),
        status: data.billingSubscriptionStatus || 'trial',
        trialEndsAt: formatDateInputValue(data.billingTrialEndsAt || data.trialEndsAt),
        renewalDate: formatDateInputValue(data.billingRenewalDate),
        currentEmployees: Number(data.currentEmployeeCount ?? 0),
        historyNote: ''
      });

      const currentSummary = await getBillingSummary(normalizedCompanyId);
      setSummary(currentSummary);
      toast.success('Company loaded');
    } catch (error) {
      console.error('Failed to load company', error);
      toast.error(error?.message || 'Failed to load company');
    } finally {
      setIsLoading(false);
    }
  };

  const saveBillingFields = async () => {
    if (!normalizedCompanyId) {
      toast.error('Enter a valid company ID');
      return;
    }
    try {
      setIsLoading(true);
      const companyRef = doc(db, 'companies', normalizedCompanyId);
      await updateDoc(companyRef, {
        billingSeatQuota: Number(billingState.seatQuota) || 0,
        billingSubscriptionStatus: billingState.status || 'trial',
        billingTrialEndsAt: toTimestamp(billingState.trialEndsAt),
        billingRenewalDate: toTimestamp(billingState.renewalDate),
        currentEmployeeCount: Number(billingState.currentEmployees) || 0,
        updatedAt: Timestamp.now()
      });
      const currentSummary = await getBillingSummary(normalizedCompanyId);
      setSummary(currentSummary);
      toast.success('Billing fields saved');
    } catch (error) {
      console.error('Failed to save billing fields', error);
      toast.error(error?.message || 'Failed to save billing fields');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartTrial = async () => {
    if (!normalizedCompanyId) {
      toast.error('Enter a valid company ID');
      return;
    }
    const seats = Number(billingState.seatQuota) || 1;
    try {
      setIsLoading(true);
      await startTrial(normalizedCompanyId, seats);
      const currentSummary = await getBillingSummary(normalizedCompanyId);
      setSummary(currentSummary);
      toast.success('Trial initialized');
    } catch (error) {
      console.error('Failed to start trial', error);
      toast.error(error?.message || 'Failed to start trial');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRenewSubscription = async () => {
    if (!normalizedCompanyId) {
      toast.error('Enter a valid company ID');
      return;
    }
    const seats = Number(billingState.seatQuota) || undefined;
    try {
      setIsLoading(true);
      await recordSubscriptionPayment(normalizedCompanyId, seats);
      const currentSummary = await getBillingSummary(normalizedCompanyId);
      setSummary(currentSummary);
      toast.success('Subscription renewed (mock)');
    } catch (error) {
      console.error('Failed to renew subscription', error);
      toast.error(error?.message || 'Failed to renew subscription');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSeatTopUp = async () => {
    if (!normalizedCompanyId) {
      toast.error('Enter a valid company ID');
      return;
    }
    const increment = Number(billingState.historyNote) || 1;
    try {
      setIsLoading(true);
      await recordSeatTopUp(normalizedCompanyId, increment);
      const currentSummary = await getBillingSummary(normalizedCompanyId);
      setSummary(currentSummary);
      toast.success(`Added ${increment} seat(s)`);
    } catch (error) {
      console.error('Failed to add seats', error);
      toast.error(error?.message || 'Failed to add seats');
    } finally {
      setIsLoading(false);
    }
  };

  const summaryItems = summary
    ? [
        { label: 'Status', value: summary.subscriptionStatus },
        { label: 'Seat Quota', value: summary.seatQuota },
        { label: 'Current Employees', value: summary.currentSeatsInUse },
        { label: 'Trial Ends', value: summary.trialEndsAt ? new Date(summary.trialEndsAt).toLocaleString() : '—' },
        { label: 'Renewal Date', value: summary.renewalDate ? new Date(summary.renewalDate).toLocaleString() : '—' },
        { label: 'Monthly Amount', value: `${summary.currency || BILLING_CONSTANTS.CURRENCY} ${summary.monthlyAmount}` }
      ]
    : [];

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Header
        title="Billing Mock Tools"
        subtitle="Seed billing metadata for existing companies to test payment flows"
      />
      <div className="flex-1 overflow-y-auto p-4 md:p-3xl scrollbar-custom">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="bg-white border border-border-secondary rounded-base p-6 shadow-sm space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-text-secondary">Company ID</label>
                <input
                  type="text"
                  value={companyIdInput}
                  onChange={(e) => setCompanyIdInput(e.target.value)}
                  className="h-11 border border-border-secondary rounded-lg px-3 text-sm focus:outline-none focus:border-border-accent-purple"
                  placeholder="companies/{id} or {id}"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={loadCompany}
                  disabled={isLoading}
                  className="w-full h-11 bg-[linear-gradient(91.36deg,#AF54DD_4.75%,#7617A7_96.14%)] text-white rounded-lg font-semibold disabled:opacity-60"
                >
                  {isLoading ? 'Loading...' : 'Load Company'}
                </button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-text-secondary">Seat Quota</label>
                <input
                  type="number"
                  min="0"
                  value={billingState.seatQuota}
                  onChange={(e) => setBillingState((prev) => ({ ...prev, seatQuota: e.target.value }))}
                  className="h-11 border border-border-secondary rounded-lg px-3 text-sm focus:outline-none focus:border-border-accent-purple"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-text-secondary">Current Employees</label>
                <input
                  type="number"
                  min="0"
                  value={billingState.currentEmployees}
                  onChange={(e) => setBillingState((prev) => ({ ...prev, currentEmployees: e.target.value }))}
                  className="h-11 border border-border-secondary rounded-lg px-3 text-sm focus:outline-none focus:border-border-accent-purple"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-text-secondary">Subscription Status</label>
                <select
                  value={billingState.status}
                  onChange={(e) => setBillingState((prev) => ({ ...prev, status: e.target.value }))}
                  className="h-11 border border-border-secondary rounded-lg px-3 text-sm focus:outline-none focus:border-border-accent-purple"
                >
                  <option value="trial">Trial</option>
                  <option value="active">Active</option>
                  <option value="past_due">Past Due</option>
                  <option value="expired">Expired</option>
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-text-secondary">Trial Ends</label>
                <input
                  type="date"
                  value={billingState.trialEndsAt}
                  onChange={(e) => setBillingState((prev) => ({ ...prev, trialEndsAt: e.target.value }))}
                  className="h-11 border border-border-secondary rounded-lg px-3 text-sm focus:outline-none focus:border-border-accent-purple"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-text-secondary">Renewal Date</label>
                <input
                  type="date"
                  value={billingState.renewalDate}
                  onChange={(e) => setBillingState((prev) => ({ ...prev, renewalDate: e.target.value }))}
                  className="h-11 border border-border-secondary rounded-lg px-3 text-sm focus:outline-none focus:border-border-accent-purple"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={saveBillingFields}
                disabled={isLoading}
                className="px-5 py-2 rounded-lg border border-border-accent-purple text-text-accent-purple text-sm font-semibold hover:bg-bg-accent-purple-light disabled:opacity-60"
              >
                Save Billing Fields
              </button>
              <button
                onClick={handleStartTrial}
                disabled={isLoading}
                className="px-5 py-2 rounded-lg border border-border-secondary text-text-secondary text-sm font-semibold hover:bg-background-secondary disabled:opacity-60"
              >
                Start Trial
              </button>
              <button
                onClick={handleRenewSubscription}
                disabled={isLoading}
                className="px-5 py-2 rounded-lg border border-border-secondary text-text-secondary text-sm font-semibold hover:bg-background-secondary disabled:opacity-60"
              >
                Renew Subscription
              </button>
              <button
                onClick={handleSeatTopUp}
                disabled={isLoading}
                className="px-5 py-2 rounded-lg border border-border-secondary text-text-secondary text-sm font-semibold hover:bg-background-secondary disabled:opacity-60"
              >
                Seat Top-Up
              </button>
            </div>
          </div>

          {summary && (
            <div className="bg-white border border-border-secondary rounded-base p-6 shadow-sm space-y-4">
              <h3 className="text-lg font-semibold text-text-primary">Current Billing Summary</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                {summaryItems.map((item) => (
                  <div key={item.label} className="flex flex-col gap-1">
                    <span className="text-xs uppercase text-text-secondary">{item.label}</span>
                    <span className="text-md font-semibold text-text-primary break-all">{item.value}</span>
                  </div>
                ))}
              </div>
              {Array.isArray(summary.history) && summary.history.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">Recent History</h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto border border-border-secondary rounded-lg p-3 text-sm">
                    {summary.history.map((entry) => (
                      <div key={entry.id || entry.createdAtIso} className="border-b border-border-secondary pb-2 last:border-b-0 last:pb-0">
                        <div className="flex justify-between text-xs text-text-secondary">
                          <span>{entry.type}</span>
                          <span>{entry.createdAt ? new Date(entry.createdAt).toLocaleString() : '—'}</span>
                        </div>
                        <div className="text-text-primary font-medium">
                          £{entry.amount} for {entry.seats} seat(s)
                        </div>
                        {entry.note && <div className="text-text-secondary">{entry.note}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BillingMockTools;

