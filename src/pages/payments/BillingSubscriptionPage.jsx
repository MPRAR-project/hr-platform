import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Users, DollarSign, Calendar, Download, X, CreditCard, Plus } from 'lucide-react';
import Header from '../../components/layout/Header';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import DeleteConfirmationModal from '../../components/modals/DeleteConfirmationModal';
import { useAuth } from '../../hooks/useAuth';
import { useCache } from '../../contexts/CacheContext';
import { toast } from 'react-toastify';
import { parseCompanyId } from '../../utils/dataParser';
import { getBillingSummary, recordSeatTopUp, listInvoices } from '../../services/billing';
import { fetchCompanyDashboardData } from '../../services/dataCache';
import { LoadingSkeleton } from '../../components/ui/LoadingSkeleton';
import { createStripeCustomerPortalSession, USE_STRIPE, getStripeInvoicePDF, listStripeInvoices, getStripeInvoiceProxyUrl, downloadLatestInvoice, downloadInvoiceById, syncStripeSubscription, createSeatAdditionCheckoutSession, updateStripeSubscription, createStripeCheckoutSession, createStripeCustomer } from '../../services/stripe';
import { getCompany } from '../../services/companyManagementService';
import { useLocation } from 'react-router-dom';
import hrApiClient from '../../lib/hrApiClient';

/* eslint-disable react/prop-types */
const BillingSubscriptionsPage = ({ isEmbedded }) => {
  const { user } = useAuth();
  const { getItem, setItem } = useCache();
  const companyId = useMemo(() => parseCompanyId(user?.companyId), [user?.companyId]);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [companyData, setCompanyData] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [stripeCustomerId, setStripeCustomerId] = useState(null);
  const [downloadingInvoices, setDownloadingInvoices] = useState(new Set());


  const location = useLocation();

  // Add Seats Modal State
  const [showAddSeatsModal, setShowAddSeatsModal] = useState(false);
  const [seatsToAdd, setSeatsToAdd] = useState(1);
  const [isAddingSeats, setIsAddingSeats] = useState(false);

  // ... existing code ...

  // To avoid modifying the huge file too much, I'll rely on the line numbers for the Header replacement further down or use multi_replace if needed. 
  // Actually, I can just replace the Header rendering part.

  // Wait, I need to update the component signature first.

  // Let's do signature update in one go with Header check if possible, or just update signature first.

  // I will restart this tool call to be cleaner.



  const loadInvoices = async (companyId) => {
    try {
      const data = await listInvoices({ limit: 12 });
      // Invoices from REST API are already structured correctly
      return data.invoices || data || [];
    } catch (error) {
      console.warn('BillingSubscriptionsPage: Failed to load invoices via REST', error);
      return [];
    }
  };

  const loadCompanyData = useCallback(async () => {
    if (!companyId) {
      setCompanyData(null);
      return;
    }
    try {
      const data = await fetchCompanyDashboardData(companyId);
      setCompanyData(data);
    } catch (error) {
      console.error('BillingSubscriptionsPage: Failed to load company data', error);
      // Don't show error toast, just log it - company data is optional
    }
  }, [companyId]);

  // Load billing + company data - run once per companyId to prevent fetch loop
  useEffect(() => {
    if (!companyId) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const loadBilling = async () => {
      const cacheKey = `billing_${companyId}`;
      const cached = getItem?.(cacheKey);
      if (cached?.summary) {
        setSummary(cached.summary);
        setIsLoading(false);
      } else {
        setIsLoading(true);
      }
      try {
        const summaryData = await getBillingSummary();
        if (cancelled) return;
        setSummary(summaryData);
        setItem?.(cacheKey, { summary: summaryData }, 7 * 60 * 1000);

        const invoicesData = await loadInvoices(companyId);
        if (cancelled) return;
        setInvoices(invoicesData);

        if (USE_STRIPE) {
          const company = await getCompany(companyId);
          const c = company?.company || company;
          if (c && !cancelled) {
            setStripeCustomerId(c.stripeCustomerId || null);
          }
        }
      } catch (error) {
        if (!cancelled) {
          console.error('BillingSubscriptionsPage: failed to load billing info', error);
          toast.error(error?.message || 'Failed to load billing data');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    loadBilling();
    loadCompanyData();

    return () => { cancelled = true; };
  }, [companyId]); // Only companyId - avoid loop from getItem/setItem/loadCompanyData deps

  // Handle Stripe Checkout session completion
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const sessionId = params.get('session_id');
    const canceled = params.get('canceled');
    const action = params.get('action');

    if (sessionId) {
      // Handle seat addition checkout
      if (action === 'seat_added') {
        toast.success('Payment successful! Additional seats have been added to your subscription.');
      } else {
        toast.success('Payment successful! Your subscription is now active.');
      }

      // Reload billing data with retry logic for invoices
      const loadBillingWithRetry = async (attempts = 0) => {
        if (companyId) {
          try {
            console.log(`Verifying payment & syncing invoices (Attempt ${attempts + 1}/5)...`);

            // Only show toast on first attempt
            if (attempts === 0) {
              toast.info('Verifying payment and updating subscription...', { autoClose: 2000 });
            }

            // Trigger sync
            const syncResult = await syncStripeSubscription(companyId);
            const invoiceCount = syncResult.data?.invoiceCount || 0;

            // Fetch latest summary to check if it has updated
            const summaryData = await getBillingSummary();

            // Check if the data is "fresh" - i.e., lastPaymentAt is very recent (within 5 mins)
            // or if we have a seat topup history entry from just now.
            const lastPayment = summaryData.lastPaymentAt ? new Date(summaryData.lastPaymentAt) : null;
            const now = new Date();
            const isFresh = lastPayment && (now - lastPayment) < 5 * 60 * 1000; // 5 mins

            console.log('Billing data freshness check:', {
              isFresh,
              lastPayment,
              attempts,
              seatQuota: summaryData.seatQuota
            });

            // If not fresh and we haven't maxed retries, wait and retry
            // We retry up to 5 times (approx 15 seconds)
            if (!isFresh && attempts < 5) {
              console.log('Data not fresh yet, retrying in 3 seconds...');
              setTimeout(() => loadBillingWithRetry(attempts + 1), 3000);
              return;
            }

            // Final update after retries (or success)
            if (isFresh) {
              toast.success(`Payment verified! Seat quota updated to ${summaryData.seatQuota}.`);
            } else {
              // Fallback message if we timed out waiting for sync
              toast.warning(`Payment confirmed. Your seat quota will update momentarily.`);
            }

            setSummary(summaryData);

            const invoicesData = await loadInvoices(companyId);
            setInvoices(invoicesData);

            // Reload company data
            const company = await getCompany(companyId);
            const c = company?.company || company;
            if (c) {
              setStripeCustomerId(c.stripeCustomerId || null);
            }

          } catch (syncErr) {
            console.warn('Failed to force sync with Stripe:', syncErr);
            // Still try to load data even if sync failed
            const summaryData = await getBillingSummary();
            setSummary(summaryData);
          }
        }
      };
      loadBillingWithRetry();
      // Clean URL
      window.history.replaceState({}, '', '/billing');
    } else if (canceled) {
      if (action === 'seat_addition') {
        toast.info('Seat addition was canceled. No charges were made.');
      } else {
        toast.info('Payment was canceled. You can try again anytime.');
      }
      // Clean URL
      window.history.replaceState({}, '', '/billing');
    }
  }, [location.search, companyId]);

  const formattedPricePerSeat = useMemo(() => {
    if (!summary) return '£5.00';
    const price = summary.pricePerSeat ?? 5;
    return `£${Number(price).toFixed(2)}`;
  }, [summary]);

  const formattedMonthlyPrice = useMemo(() => {
    if (!summary) return '£0.00';
    const formatter = new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: summary.currency || 'GBP'
    });
    return formatter.format(summary.monthlyAmount || 0);
  }, [summary]);

  const formattedNextBilling = useMemo(() => {
    if (!summary?.renewalDate) return '—';
    return new Date(summary.renewalDate).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }, [summary?.renewalDate]);

  const normalizeInvoiceAmount = (amount) => {
    if (typeof amount === 'string' && amount.startsWith('£')) {
      return amount;
    }
    const formatter = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
    return formatter.format(Number(amount) || 0);
  };

  const handleCancelSubscription = () => {
    setShowCancelModal(true);
  };

  const handleConfirmCancel = () => {
    console.log('Subscription cancelled');
  };

  const handleDownloadInvoice = async (invoice) => {
    const invoiceData = typeof invoice === 'object' ? invoice : invoices.find(inv => inv.id === invoice);
    if (!invoiceData) {
      toast.error('Invoice not found');
      return;
    }

    const invoiceId = invoiceData.id;
    let stripeInvoiceId = invoiceData.stripeInvoiceId;

    // If downloading, show loading state
    setDownloadingInvoices(prev => new Set(prev).add(invoiceId));

    // CRITICAL: For seat_topup entries, if stripeInvoiceId is missing, try to find it from Stripe first
    if (USE_STRIPE && !stripeInvoiceId && invoiceData.type === 'seat_topup' && companyId) {
      try {
        console.log('Seat topup invoice missing stripeInvoiceId, searching Stripe...');
        const stripeInvoices = await listStripeInvoices(companyId, 50); // Get more invoices to find the match
        const targetAmount = Number(invoiceData.amount) * 100; // Convert to cents
        const invoiceDate = invoiceData.date ? new Date(invoiceData.date).getTime() : Date.now();
        const oneDayAgo = invoiceDate - (24 * 60 * 60 * 1000);
        const oneDayLater = invoiceDate + (24 * 60 * 60 * 1000);

        // Find invoice matching amount and date (within 1 day)
        const matchingInvoice = stripeInvoices.find(inv => {
          const amountMatch = Math.abs(inv.amount_paid - targetAmount) < 1; // Within 1 cent
          const invoiceCreated = inv.created * 1000; // Convert to milliseconds
          const dateMatch = invoiceCreated >= oneDayAgo && invoiceCreated <= oneDayLater;
          // Also check metadata for seat addition
          const metadataMatch = inv.metadata?.action === 'add_seats' || inv.metadata?.action === 'add_seats';
          return amountMatch && (dateMatch || metadataMatch);
        });

        if (matchingInvoice?.id) {
          stripeInvoiceId = matchingInvoice.id;
          console.log('✓ Found Stripe invoice ID for seat_topup from Stripe API:', stripeInvoiceId);
          // Update the invoice data for this session
          invoiceData.stripeInvoiceId = stripeInvoiceId;
          invoiceData.invoicePdfUrl = matchingInvoice.invoice_pdf || null;
        }
      } catch (error) {
        console.warn('Failed to search Stripe for seat_topup invoice:', error);
      }
    }

    // SIMPLE APPROACH: If we have a PDF URL directly, use it (fastest - same as "Download Latest Invoice")
    if (USE_STRIPE && invoiceData.invoicePdfUrl) {
      try {
        window.open(invoiceData.invoicePdfUrl, '_blank');
        toast.success('Invoice opened in new window');
        setDownloadingInvoices(prev => {
          const newSet = new Set(prev);
          newSet.delete(invoiceId);
          return newSet;
        });
        return;
      } catch (error) {
        console.error('Direct PDF URL failed, trying invoice ID:', error);
        // Fall through to invoice ID approach
      }
    }

    // SIMPLE APPROACH: If we have a Stripe invoice ID, use the REST API to get the PDF URL
    if (USE_STRIPE && stripeInvoiceId) {
      try {
        const { data } = await hrApiClient.get(`/hr/billing/invoices/${stripeInvoiceId}/pdf`);
        const pdfUrl = data.pdfUrl;

        if (pdfUrl) {
          window.open(pdfUrl, '_blank');
          toast.success('Invoice opened in new window');
          setDownloadingInvoices(prev => {
            const newSet = new Set(prev);
            newSet.delete(invoiceId);
            return newSet;
          });
          return;
        }
      } catch (error) {
        console.error('REST PDF download failed, trying fallback:', error);
      }
    }

    console.log('=== DOWNLOAD INVOICE DEBUG ===');
    console.log('Invoice data:', invoiceData);
    console.log('Invoice ID:', invoiceId);
    console.log('Stripe Invoice ID:', stripeInvoiceId);
    console.log('Has Stripe ID:', !!stripeInvoiceId);
    console.log('USE_STRIPE:', USE_STRIPE);
    console.log('Company ID:', companyId);
    console.log('Invoice type:', invoiceData.type);

    try {
      // CRITICAL: Check if invoice ID itself is a Stripe invoice ID (starts with 'in_')
      // This handles cases where stripeInvoiceId wasn't preserved but the ID itself is the Stripe ID
      if (!stripeInvoiceId && invoiceId && invoiceId.startsWith('in_')) {
        stripeInvoiceId = invoiceId;
        console.log('✓ Invoice ID is a Stripe invoice ID:', stripeInvoiceId);
      }

      // If no stripeInvoiceId but it's a subscription or seat_topup payment, try to find it
      if (!stripeInvoiceId && (invoiceData.type === 'subscription' || invoiceData.type === 'seat_topup') && USE_STRIPE) {
        // If we have subscription ID, try to get invoice from Stripe
        if (invoiceData.stripeSubscriptionId && stripeCustomerId) {
          try {
            console.log('Fetching invoice for subscription:', invoiceData.stripeSubscriptionId);
            const stripeInvoices = await listStripeInvoices(companyId, 20);
            // Find invoice for this subscription - for seat_topup, match by amount and date
            let matchingInvoice = null;
            if (invoiceData.type === 'seat_topup') {
              // For seat_topup, match by amount and recent date (within last hour)
              const targetAmount = Number(invoiceData.amount) * 100; // Convert to cents
              const oneHourAgo = Date.now() - (60 * 60 * 1000);
              matchingInvoice = stripeInvoices.find(inv => {
                const amountMatch = Math.abs(inv.amount_paid - targetAmount) < 1; // Within 1 cent
                const dateMatch = inv.created * 1000 > oneHourAgo; // Created within last hour
                return amountMatch && dateMatch;
              });
            } else {
              // For subscription, match by subscription ID
              matchingInvoice = stripeInvoices.find(
                inv => inv.subscription === invoiceData.stripeSubscriptionId
              );
            }

            if (matchingInvoice?.id) {
              stripeInvoiceId = matchingInvoice.id;
              console.log(`✓ Found Stripe invoice ID for ${invoiceData.type}:`, stripeInvoiceId);
            }
          } catch (error) {
            console.warn('Failed to fetch invoice from subscription:', error);
          }
        }

        // If still no invoice ID, try matching by amount from all invoices
        if (!stripeInvoiceId && companyId) {
          try {
            const stripeInvoices = await listStripeInvoices(companyId, 20);
            const targetAmount = Number(invoiceData.amount);
            const matchingInvoice = stripeInvoices.find(
              inv => Math.abs((inv.amount_paid / 100) - targetAmount) < 0.01
            );

            if (matchingInvoice?.id) {
              stripeInvoiceId = matchingInvoice.id;
              console.log('✓ Found Stripe invoice ID by matching amount:', stripeInvoiceId);
            }
          } catch (error) {
            console.warn('Failed to fetch invoices:', error);
          }
        }
      }

      // If we found a Stripe invoice ID, use the REST API
      if (USE_STRIPE && stripeInvoiceId) {
        try {
          const { data } = await hrApiClient.get(`/hr/billing/invoices/${stripeInvoiceId}/pdf`);
          const pdfUrl = data.pdfUrl;

          if (pdfUrl) {
            window.open(pdfUrl, '_blank');
            toast.success('Invoice opened in new window');
            setDownloadingInvoices(prev => {
              const newSet = new Set(prev);
              newSet.delete(invoiceId);
              return newSet;
            });
            return;
          }
        } catch (error) {
          console.error('Failed to download invoice via REST:', error);
          toast.error('Failed to download invoice. Please try again.');
          setDownloadingInvoices(prev => {
            const newSet = new Set(prev);
            newSet.delete(invoiceId);
            return newSet;
          });
          return;
        }
      }

      // Only generate HTML for non-Stripe invoices (fallback)
      console.log('>>> GENERATING HTML INVOICE (no Stripe invoice found)');
      await generateLocalInvoicePDF(invoiceData);
    } catch (error) {
      console.error('✗ Failed to download invoice:', error);
      toast.error('Failed to download invoice. Please try again.');
    } finally {
      setDownloadingInvoices(prev => {
        const newSet = new Set(prev);
        newSet.delete(invoiceId);
        return newSet;
      });
    }
  };



  const generateLocalInvoicePDF = async (invoice) => {
    // Generate a simple PDF invoice using browser's print functionality
    // or create a downloadable HTML invoice
    const invoiceData = typeof invoice === 'object' ? invoice : invoices.find(inv => inv.id === invoice);

    if (!invoiceData) {
      throw new Error('Invoice not found');
    }

    // Create invoice HTML
    const invoiceHTML = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Invoice ${invoiceData.id}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
            .header { border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 30px; }
            .company-info { margin-bottom: 30px; }
            .invoice-details { margin-bottom: 30px; }
            .table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
            .table th, .table td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
            .table th { background-color: #f5f5f5; font-weight: bold; }
            .total { text-align: right; font-size: 18px; font-weight: bold; margin-top: 20px; }
            .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>INVOICE</h1>
            <p>Invoice #${invoiceData.id}</p>
          </div>
          
          <div class="company-info">
            <h2>${companyData?.name || summary?.companyName || 'Your Company'}</h2>
            <p>${companyData?.address?.line1 || ''} ${companyData?.address?.raw || ''}</p>
          </div>
          
          <div class="invoice-details">
            <p><strong>Invoice Date:</strong> ${invoiceData.date ? invoiceData.date.toLocaleDateString('en-GB') : 'N/A'}</p>
            <p><strong>Status:</strong> ${invoiceData.status || 'paid'}</p>
          </div>
          
          <table class="table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>${invoiceData.note || 'Subscription Payment'}</td>
                <td>${normalizeInvoiceAmount(invoiceData.amount)}</td>
              </tr>
            </tbody>
          </table>
          
          <div class="total">
            <p>Total: ${normalizeInvoiceAmount(invoiceData.amount)}</p>
          </div>
          
          <div class="footer">
            <p>Thank you for your business!</p>
            <p>This is an automatically generated invoice.</p>
          </div>
        </body>
      </html>
    `;

    // Create blob and download
    const blob = new Blob([invoiceHTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `invoice-${invoiceData.id}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success('Invoice downloaded successfully');
  };

  const handleManagePaymentMethod = async () => {
    if (!USE_STRIPE) {
      toast.info('Payments are managed manually. Please contact support to change your payment method.');
      return;
    }

    // Check if we are in trial without a full subscription
    const isTrialWithoutSubscription = summary?.isTrial && !summary?.stripeSubscriptionId;

    if (isTrialWithoutSubscription) {
      try {
        setIsLoading(true);
        let currentCustomerId = stripeCustomerId;

        // Create customer if missing
        if (!currentCustomerId) {
          console.log('Creating Stripe customer for trial upgrade...');
          currentCustomerId = await createStripeCustomer(
            companyId,
            user?.email,
            companyData?.name || summary?.companyName || 'Company'
          );
          setStripeCustomerId(currentCustomerId);
        }

        // Create checkout session for current quota to start paying
        console.log('Starting Stripe checkout for subscription...', {
          customerId: currentCustomerId,
          quota: summary?.seatQuota
        });

        const baseUrl = window.location.origin;
        const session = await createStripeCheckoutSession(
          currentCustomerId,
          summary?.seatQuota || 1,
          companyId,
          `${baseUrl}/billing?session_id={CHECKOUT_SESSION_ID}`,
          `${baseUrl}/billing?canceled=true`
        );

        if (session && session.url) {
          window.location.href = session.url;
          return;
        } else {
          throw new Error('No checkout URL returned');
        }
      } catch (error) {
        console.error('Failed to start payment flow:', error);
        toast.error('Failed to start payment flow. Please try again.');
        setIsLoading(false);
      }
      return;
    }

    if (!stripeCustomerId) {
      toast.info('Payments are managed manually. Please contact support to change your payment method.');
      return;
    }

    try {
      setIsLoading(true);
      const session = await createStripeCustomerPortalSession(stripeCustomerId, window.location.href);
      if (session && session.url) {
        window.location.href = session.url;
      }
    } catch (error) {
      console.error('Failed to create portal session:', error);
      toast.error('Failed to open payment settings. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Add-on State Management
  const [isProcessingAddon, setIsProcessingAddon] = useState(false);
  const [schedulingPluginEnabled, setSchedulingPluginEnabled] = useState(false);

  // Initialize plugin state from companyData
  useEffect(() => {
    if (companyData?.plugins?.scheduling) {
      setSchedulingPluginEnabled(true);
    } else {
      setSchedulingPluginEnabled(false);
    }
  }, [companyData?.plugins]);

  const handleToggleAddon = async (addonType, enable) => {
    if (addonType !== 'scheduling') return;

    // If enabling and in trial without a subscription, redirect to payment
    if (enable && summary?.isTrial && !summary?.stripeSubscriptionId) {
      toast.info('Please subscribe to a plan to enable Shift Scheduling & Roster.');
      handleManagePaymentMethod();
      return;
    }

    // Optimistic UI Update
    setSchedulingPluginEnabled(enable);
    setIsProcessingAddon(true);

    try {
      // Import dynamically to avoid circular dependencies if any
      const { addPluginService, removePluginService } = await import('../../services/billing');
      const { invalidateCompanyCache } = await import('../../services/cacheInvalidationService');

      if (enable) {
        const result = await addPluginService(companyId, addonType);

        // Handle case where addon addition requires immediate payment/checkout
        if (result && result.checkoutUrl) {
          window.location.href = result.checkoutUrl;
          return;
        }

        toast.success('Shift Scheduling added! Your subscription will be updated.');
      } else {
        await removePluginService(companyId, addonType);
        toast.success('Shift Scheduling removed. Your subscription will be updated.');
      }

      // Invalidate cache so display shows fresh data immediately
      await invalidateCompanyCache(companyId);

      // Refresh company data to confirm state
      await loadCompanyData();

    } catch (error) {
      console.error(`Failed to ${enable ? 'enable' : 'disable'} addon:`, error);

      // If the error suggests we need a subscription, offer to proceed to payment
      const errMsg = error?.message || '';
      if (enable && (errMsg.includes('subscription') || errMsg.includes('active') || errMsg.includes('No payment method'))) {
        toast.error('Active subscription required to purchase add-ons.');
        handleManagePaymentMethod();
      } else {
        toast.error(`Failed to update subscription. Please try again.`);
      }

      // Revert optimistic update
      setSchedulingPluginEnabled(!enable);
    } finally {
      setIsProcessingAddon(false);
    }
  };

  const handleAddSeats = async () => {
    if (!companyId || seatsToAdd < 1) return;

    setIsAddingSeats(true);
    try {
      console.log('Initiating seat top-up:', { companyId, seatsToAdd });

      // Use the centralized service function
      const result = await recordSeatTopUp(companyId, seatsToAdd);

      console.log('Seat top-up result:', result);

      if (result && result.requiresCheckout && result.checkoutUrl) {
        // Active subscription requiring payment
        window.location.href = result.checkoutUrl;
      } else {
        // Immediate success (Trial or non-Stripe)
        toast.success(`Successfully added ${seatsToAdd} seats.`);

        // Reload billing data
        const summaryData = await getBillingSummary();
        setSummary(summaryData);
        setShowAddSeatsModal(false);
      }
    } catch (error) {
      console.error('Failed to add seats:', error);
      toast.error(error.message || 'Failed to add seats. Please try again.');
    } finally {
      setIsAddingSeats(false);
    }
  };

  return (
    <div className={`p-6 max-w-7xl mx-auto space-y-2 ${!isEmbedded ? '' : ''}`}>
      {!isEmbedded && <Header title="Billing & Subscription" />}

      {/* Skeleton when loading and no cache */}
      {isLoading && !summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm p-6 border border-gray-100 animate-pulse">
              <LoadingSkeleton height="h-4" width="w-24" className="mb-2" />
              <LoadingSkeleton height="h-8" width="w-32" className="mb-4" />
              <div className="space-y-3">
                <LoadingSkeleton height="h-4" width="w-full" />
                <LoadingSkeleton height="h-4" width="w-3/4" />
                <LoadingSkeleton height="h-4" width="w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Subscription Status Card */}
      {summary && <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Current Plan */}
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-gray-500 text-sm font-medium">Current Plan</h3>
              <p className="text-2xl font-bold text-gray-900 mt-1">Per User Plan</p>
            </div>
            <div className={`p-2 rounded-lg ${summary?.isTrial ? 'bg-orange-50 text-orange-600' : 'bg-primary-50 text-primary-600'}`}>
              <Users size={20} />
            </div>
          </div>
          <div className="flex items-center space-x-2 mb-4">
            <Badge variant={summary?.isExpired ? 'error' : (summary?.isTrial ? 'warning' : 'success')}>
              {summary?.subscriptionStatus === 'active' ? 'Active Subscription' :
                summary?.subscriptionStatus === 'trial' ? 'Free Trial' :
                  summary?.subscriptionStatus === 'past_due' ? 'Past Due' : 'Inactive'}
            </Badge>
          </div>
          <div className="space-y-2">

            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-500">Seat Quota </span>
              <div className="flex items-center gap-2">
                <span className="font-medium">{summary?.seatQuota || 0} seats</span>
                {['siteManager', 'seniorManager'].includes(user?.role) && (
                  <button
                    onClick={() => setShowAddSeatsModal(true)}
                    className="p-1 hover:bg-gray-100 rounded-full text-purple-600 transition-colors"
                    title="Add more seats"
                  >
                    <Plus size={16} />
                  </button>
                )}
              </div>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Seats Used</span>
              <span className="font-medium">{summary?.currentSeatsInUse || 0} seats</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Price per seat</span>
              <span className="font-medium">{formattedPricePerSeat}/mo</span>
            </div>
            {companyData?.plugins?.scheduling && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Shift Roster</span>
                <span className="font-medium">£2.50/mo</span>
              </div>
            )}
            {companyData?.plugins?.traveller && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Traveller System</span>
                <span className="font-medium">£100.00/mo</span>
              </div>
            )}
            {companyData?.plugins?.timeworks && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">TimeWorks</span>
                <span className="font-medium">£50.00/mo</span>
              </div>
            )}
          </div>
        </div>

        {/* Billing Details */}
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-gray-500 text-sm font-medium">Billing Details</h3>
              <p className="text-2xl font-bold text-gray-900 mt-1">{formattedMonthlyPrice}<span className="text-sm font-normal text-gray-500">/mo</span></p>
            </div>
            <div className="p-2 rounded-lg bg-green-50 text-green-600">
              <DollarSign size={20} />
            </div>
          </div>
          <div className="space-y-2 mt-4">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Next billing date</span>
              <span className="font-medium">{formattedNextBilling}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Payment method</span>
              <span className="font-medium">Card ending ****</span>
            </div>
          </div>
          <div className="mt-6">
            <Button
              variant={summary?.isTrial && !summary?.stripeSubscriptionId ? "gradient" : "outline"}
              className="w-full justify-center"
              onClick={handleManagePaymentMethod}
              disabled={isLoading || !USE_STRIPE}
            >
              {summary?.isTrial && !summary?.stripeSubscriptionId ? 'Proceed to Payment' : 'Manage Payment Method'}
            </Button>
          </div>
        </div>

        {/* Add-ons Section - NEW */}
        <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-100">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-gray-500 text-sm font-medium">Add-ons</h3>
              <p className="text-2xl font-bold text-gray-900 mt-1">Enhance Power</p>
            </div>
            <div className="p-2 rounded-lg bg-purple-50 text-purple-600">
              <CreditCard size={20} />
            </div>
          </div>

          <div className="space-y-4 mt-2">
            {[
              { id: 'scheduling', name: 'Shift Scheduling & Roster', desc: 'Manage shifts, rosters, and schedules.', price: '£2.50', flat: true },
              { id: 'traveller', name: 'Traveller System', desc: 'Complete logistics and employee booking management.', price: '£100.00', flat: true },
              { id: 'timeworks', name: 'TimeWorks', desc: 'Advanced biometric-ready attendance and scheduling.', price: '£50.00', flat: true }
            ].map((addon) => {
              const isEnabled = companyData?.plugins?.[addon.id];
              return (
                <div key={addon.id} className="border border-gray-100 rounded-lg p-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-semibold text-gray-900">{addon.name}</h4>
                      <p className="text-xs text-gray-500 mt-1">{addon.desc}</p>
                      <p className="text-sm font-bold text-purple-600 mt-2">
                        {addon.price}
                        <span className="text-xs font-normal text-gray-500">/mo {addon.flat ? 'flat fee' : 'per user'}</span>
                      </p>
                    </div>
                    <div className="flex items-center">
                      {isEnabled ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 h-8 text-xs"
                          onClick={() => handleToggleAddon(addon.id, false)}
                          disabled={isProcessingAddon}
                        >
                          {isProcessingAddon ? '...' : 'Remove'}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          className="bg-purple-600 px-3 py-1 rounded-md hover:bg-purple-700 text-white h-8 text-xs font-bold"
                          onClick={() => handleToggleAddon(addon.id, true)}
                          disabled={isProcessingAddon}
                        >
                          {isProcessingAddon ? '...' : 'Add'}
                        </Button>
                      )}
                    </div>
                  </div>
                  {isEnabled && (
                    <div className="mt-2 pt-2 border-t border-gray-50 flex items-center">
                      <Badge variant="success" className="text-xs py-0">Active</Badge>
                      <span className="text-xs text-gray-400 ml-2">Included in monthly bill</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>}

      {/* Invoice History - only when we have summary */}
      {summary && (<><div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center">
          <h2 className="text-lg font-bold text-gray-900">Invoice History</h2>
          <Button
            variant="ghost"
            className="text-gray-500"
            icon={Download}
            onClick={() => {
              if (invoices.length > 0) {
                // Download latest invoice
                handleDownloadInvoice(invoices[0]);
              }
            }}
            disabled={invoices.length === 0}
          >
            Download Latest
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {invoices.length > 0 ? (
                invoices.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {invoice.date ? invoice.date.toLocaleDateString('en-GB') : 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {normalizeInvoiceAmount(invoice.amount)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <Badge variant={invoice.status === 'paid' ? 'success' : 'warning'}>
                        {invoice.status}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {invoice.note || (invoice.type === 'seat_topup' ? `Seat Addition` : 'Monthly Subscription')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => handleDownloadInvoice(invoice)}
                        disabled={downloadingInvoices.has(invoice.id)}
                        className={`text-primary-600 hover:text-primary-900 flex items-center justify-end w-full ${downloadingInvoices.has(invoice.id) ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {downloadingInvoices.has(invoice.id) ? (
                          <span className="inline-block animate-spin mr-2">⟳</span>
                        ) : (
                          <Download size={16} className="mr-1" />
                        )}
                        {downloadingInvoices.has(invoice.id) ? 'Downloading...' : 'PDF'}
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="5" className="px-6 py-8 text-center text-sm text-gray-500">
                    No invoices found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

        <div className="flex justify-end pt-4">
          <button
            onClick={handleCancelSubscription}
            className="text-sm text-red-600 hover:text-red-800 font-medium"
          >
            Cancel Subscription
          </button>
        </div></>)}

      {/* Add Seats Modal */}
      {
        showAddSeatsModal && (
          <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
            <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
              <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={() => setShowAddSeatsModal(false)}></div>
              <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
              <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
                <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <div className="sm:flex sm:items-start">
                    <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-purple-100 sm:mx-0 sm:h-10 sm:w-10">
                      <Users className="h-6 w-6 text-purple-600" />
                    </div>
                    <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                      <h3 className="text-lg leading-6 font-medium text-gray-900" id="modal-title">
                        Add Seats to Subscription
                      </h3>
                      <div className="mt-2">
                        <p className="text-sm text-gray-500 mb-4">
                          Increase your seat quota to add more employees.
                          {summary?.subscriptionStatus === 'trial'
                            ? " Since you are on a trial, you won't be charged until the trial ends."
                            : " You will be charged a pro-rated amount for the remainder of this billing cycle immediately."}
                        </p>

                        <div className="bg-gray-50 p-4 rounded-lg mb-4">
                          <div className="flex justify-between items-center mb-2">
                            <label className="text-sm font-medium text-gray-700">Number of Seats</label>
                            <input
                              type="number"
                              min="1"
                              value={seatsToAdd}
                              onChange={(e) => setSeatsToAdd(Math.max(1, parseInt(e.target.value) || 1))}
                              className="w-20 rounded-md border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 sm:text-sm p-1 border text-center"
                            />
                          </div>
                          <div className="flex justify-between items-center text-sm text-gray-600 border-t border-gray-200 pt-2 mt-2">
                            <span>New Total Quota:</span>
                            <span className="font-bold">{(summary?.seatQuota || 0) + seatsToAdd} seats</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="bg-gray-50 gap-2 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                  <Button
                    onClick={handleAddSeats}
                    disabled={isAddingSeats}
                    variant="gradient"
                  >
                    {isAddingSeats ? 'Processing...' : (summary?.subscriptionStatus === 'trial' ? 'Add Seats' : 'Proceed to Payment')}
                  </Button>
                  <Button
                    onClick={() => setShowAddSeatsModal(false)}
                    disabled={isAddingSeats}
                    variant="outline"
                    className="mt-3 w-full sm:mt-0 sm:ml-3 sm:w-auto"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )
      }

      {/* Cancel Confirmation Modal */}
      <DeleteConfirmationModal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        onConfirm={handleConfirmCancel}
        title="Cancel Subscription"
        message="Are you sure you want to cancel your subscription? Your access will continue until the end of your current billing period."
        confirmText="Yes, Cancel Subscription"
      />
    </div >
  );
};

export default BillingSubscriptionsPage;