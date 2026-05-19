import { useState, useEffect, useRef } from 'react';
import hrApiClient from '../lib/hrApiClient';

export function useCompanyDashboard(companyId) {
  const [data, setData] = useState({
    teamMembers: [],
    totalUsers: 0,
    activeUsers: 0,
    totalSeats: 0,
    monthlyBill: 0,
    pricePerSeat: 5,
    seatUsageCount: 0,
    seatDeficit: 0,
    lastPaymentStatus: '—',
    lastPaymentDate: '—',
    lastPaymentAmount: null,
    nextBilling: '—',
    paymentMethod: '—',
    subscriptionStatus: '—',
    trialEndsAt: null,
    renewalDate: null,
    plugins: {},
    recentPayments: [],
    pendingInvites: 0,
    joinDate: '—',
    clockedIn: 0,
    pendingAbsences: 0,
    pendingTimesheets: 0,
    timesheets: {},
    alerts: {},
    hasData: false,
    lastUpdated: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const pollIntervalRef = useRef(null);

  const fetchDashboard = async () => {
    if (!companyId) return;

    try {
      const [dashRes, billingRes] = await Promise.allSettled([
        hrApiClient.get('/hr/dashboard'),
        hrApiClient.get('/hr/billing/summary'),
      ]);

      const dash    = dashRes.status    === 'fulfilled' ? dashRes.value.data    : {};
      const billing = billingRes.status === 'fulfilled' ? billingRes.value.data : {};

      const totalEmployees  = dash.employees?.total  ?? dash.totalEmployees  ?? 0;
      const activeEmployees = dash.employees?.active ?? dash.activeEmployees ?? 0;
      const seatQuota       = billing.seatQuota      ?? 0;
      const activeSeatCount = billing.activeSeatCount ?? activeEmployees;
      const pricePerSeat    = Number(billing.pricePerSeat ?? 5);
      const recentPayments  = billing.recentPayments  ?? [];
      const lastPayment     = recentPayments[0]        ?? null;

      const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-GB') : '—';

      let nextBilling = '—';
      if (billing.renewalDate) {
        nextBilling = formatDate(billing.renewalDate);
      } else if (billing.trialEndsAt) {
        nextBilling = `Trial ends ${formatDate(billing.trialEndsAt)}`;
      }

      setData(prev => ({
        ...prev,
        // Employee counts
        totalUsers:    totalEmployees,
        activeUsers:   activeEmployees,
        totalEmployees,
        activeEmployees,
        seatUsageCount: activeSeatCount,
        teamSize:      activeEmployees,

        // Billing / seats
        totalSeats:         seatQuota,
        seatQuota,
        activeSeatCount,
        pricePerSeat,
        monthlyBill:        seatQuota * pricePerSeat,
        subscriptionStatus: billing.subscriptionStatus ?? '—',
        trialEndsAt:        billing.trialEndsAt  ?? null,
        renewalDate:        billing.renewalDate   ?? null,
        nextBilling,
        plugins:            billing.plugins       ?? {},

        // Payment history
        recentPayments,
        lastPaymentStatus:  lastPayment ? 'Paid'                            : '—',
        lastPaymentDate:    lastPayment ? formatDate(lastPayment.createdAt) : '—',
        lastPaymentAmount:  lastPayment?.amount  ?? null,
        paymentMethod:      lastPayment?.paymentMethod ?? '—',

        // Seat deficit
        seatDeficit: Math.max(0, activeSeatCount - seatQuota),

        // Operational data from dashboard
        clockedIn:         dash.clockedIn              ?? 0,
        pendingAbsences:   dash.pending?.absences      ?? 0,
        pendingTimesheets: dash.pending?.timesheets     ?? 0,
        timesheets:        dash.timesheets              ?? {},
        alerts:            dash.alerts                  ?? {},

        hasData:     true,
        lastUpdated: new Date().toISOString(),
      }));

      setLoading(false);
      setError(null);
    } catch (err) {
      console.error('[useCompanyDashboard] Error:', err);
      setError(err);
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!companyId) {
      setLoading(false);
      return;
    }

    fetchDashboard();
    pollIntervalRef.current = setInterval(fetchDashboard, 30000);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [companyId]);

  return { data, loading, error, refresh: fetchDashboard };
}
