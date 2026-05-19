import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, ArrowRight, ChevronDown, Loader2 } from 'lucide-react';
import Header from '../../components/layout/Header';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { getBillingSummary } from '../../services/billing';
import { parseCompanyId } from '../../utils/dataParser';
import { createOfflinePaymentRequest } from '../../services/offlinePaymentService';
import { getCompany } from '../../services/companyManagementService';
import { toast } from 'react-toastify';

const OfflinePaymentSubmissionPage = () => {
  const [formData, setFormData] = useState({
    paymentMethod: 'Bank Transfer',
    paymentEvidence: '',
    additionalNotes: ''
  });
  const [companyInfo, setCompanyInfo] = useState({
    name: 'Loading...',
    amount: '£0.00'
  });
  const [billingSummary, setBillingSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();

  const loadCompanyData = useCallback(async () => {
    if (!user?.companyId) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const companyId = parseCompanyId(user.companyId);
      
      // Fetch company name via REST
      const company = await getCompany(companyId);
      const c = company?.company || company;
      const companyName = c?.name || 'Your Company';

      // Fetch billing summary for amount
      const summary = await getBillingSummary();
      setBillingSummary(summary);
      
      const amount = summary?.monthlyAmount || 0;
      const formattedAmount = new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: 'GBP'
      }).format(amount);

      setCompanyInfo({
        name: companyName,
        amount: formattedAmount
      });
    } catch (error) {
      console.error('Failed to load company data:', error);
      toast.error('Failed to load company information');
    } finally {
      setIsLoading(false);
    }
  }, [user?.companyId]);

  useEffect(() => {
    loadCompanyData();
  }, [loadCompanyData]);

  const handleSubmit = async () => {
    if (!formData.paymentEvidence.trim()) {
      toast.error('Please provide payment evidence (receipt number, transaction ID, etc.)');
      return;
    }

    if (!user?.companyId) {
      toast.error('Company information not available');
      return;
    }

    try {
      setIsSubmitting(true);
      const companyId = parseCompanyId(user.companyId);
      const seatCount = billingSummary?.seatQuota || 0;
      const amount = billingSummary?.monthlyAmount || 0;

      await createOfflinePaymentRequest({
        companyId,
        submittedById: user.id || user.uid,
        submittedByName: user.displayName || user.email || 'Site Manager',
        submittedByEmail: user.email || '',
        paymentMethod: formData.paymentMethod,
        paymentEvidence: formData.paymentEvidence,
        additionalNotes: formData.additionalNotes,
        amount,
        seatCount
      });

      // Navigate back to dashboard
      navigate('/');
    } catch (error) {
      console.error('Failed to submit offline payment:', error);
      // Error toast is handled in the service
    } finally {
      setIsSubmitting(false);
    }
  };

  const pretty = (role) =>
    role.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Header
        title={`${pretty(user.role)} Dashboard`}
        subtitle="Grow your digital workplace and manage your team seamlessly"
      />

      <div className="flex-1 overflow-y-auto p-4 md:p-3xl scrollbar-custom">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* Warning Banner */}
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-red-700 mb-1">Dashboard Deactivated</h3>
              <p className="text-sm text-red-600">
                Your company dashboard has been deactivated due to unpaid subscription. Submit your offline payment details below to reactivate access.
              </p>
            </div>
          </div>

          {/* Main Form Card */}
          <div className="bg-white border border-border-secondary rounded-base shadow-md p-6 md:p-8 space-y-6">
            <div className="space-y-2">
              <h1 className="text-2xl md:text-3xl font-bold text-text-primary">
                Submit Offline Payment
              </h1>
              <p className="text-sm text-text-secondary">
                If you paid via cash or bank transfer, submit your payment details below for verification.
                Alternatively, you can directly contact your Super Admin at{' '}
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    window.location.href = 'mailto:superadmin@email.com';
                  }}
                  className="text-text-accent-purple hover:underline bg-transparent border-none cursor-pointer font-medium"
                  style={{ padding: 0, fontSize: 'inherit' }}
                >
                  superadmin@email.com
                </button>
                {' '}for payment confirmation and faster reactivation.
              </p>
            </div>

          {/* Company and Amount Info */}
          {isLoading ? (
            <div className="bg-bg-accent-purple-light border border-border-accent-purple rounded-lg p-4">
              <div className="flex justify-center items-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-text-accent-purple" />
                <span className="ml-2 text-sm text-text-secondary">Loading company information...</span>
              </div>
            </div>
          ) : (
            <div className="bg-bg-accent-purple-light border border-border-accent-purple rounded-lg p-4">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm text-text-secondary mb-1">Company</p>
                  <p className="text-lg font-semibold text-text-primary">{companyInfo.name}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-text-secondary mb-1">Amount</p>
                  <p className="text-lg font-semibold text-text-primary">{companyInfo.amount}</p>
                </div>
              </div>
            </div>
          )}

            {/* Payment Method */}
            <div>
              <label className="text-md font-semibold text-text-primary mb-3 block">
                Payment Method
              </label>
              <div className="relative">
                <select
                  value={formData.paymentMethod}
                  onChange={(e) => setFormData({ ...formData, paymentMethod: e.target.value })}
                  className="w-full h-12 px-4 pr-10 border border-border-secondary rounded-lg text-md text-text-primary appearance-none focus:outline-none focus:border-border-accent-purple"
                >
                  <option>Bank Transfer</option>
                  <option>Cash</option>
                  <option>Cheque</option>
                </select>
                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
              </div>
            </div>

            {/* Payment Evidence */}
            <div>
              <label className="text-md font-semibold text-text-primary mb-3 block">
                Payment Evidence
              </label>
              <input
                type="text"
                value={formData.paymentEvidence}
                onChange={(e) => setFormData({ ...formData, paymentEvidence: e.target.value })}
                placeholder="Transaction receipt #, Reference number, etc."
                className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
              />
            </div>

            {/* Additional Notes */}
            <div>
              <label className="text-md font-semibold text-text-primary mb-3 block">
                Additional Notes
              </label>
              <textarea
                value={formData.additionalNotes}
                onChange={(e) => setFormData({ ...formData, additionalNotes: e.target.value })}
                placeholder="Any Additional notes about Payment..."
                rows="4"
                className="w-full px-4 py-3 border border-border-secondary rounded-lg text-md text-text-primary placeholder:text-text-secondary resize-none focus:outline-none focus:border-border-accent-purple"
              ></textarea>
            </div>

            {/* Submit Button */}
            <button
              onClick={handleSubmit}
              disabled={isLoading || isSubmitting}
              className="w-full md:w-auto md:min-w-[280px] h-12 bg-[linear-gradient(91.36deg,#AF54DD_4.75%,#7617A7_96.14%)] text-white rounded-base font-semibold text-md flex items-center justify-center gap-2.5 hover:opacity-90 transition-opacity mx-auto disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Submitting...</span>
                </>
              ) : (
                <>
                  <span>Submit for Verification</span>
                  <div className="w-5 h-5 bg-white rounded-full flex items-center justify-center">
                    <ArrowRight className="h-3 w-3 text-[#CB30E0]" />
                  </div>
                </>
              )}
            </button>
          </div>

          {/* Information Box */}
          <div className="bg-bg-accent-purple-light border border-border-accent-purple rounded-lg p-6 space-y-3">
            <h3 className="font-semibold text-text-primary">Payment Information:</h3>
            <ul className="space-y-2 text-sm text-text-secondary list-disc list-inside">
              <li>
                <strong>Automatic Payments:</strong> Stripe, website payments, and cardless transactions are automatically recorded.
              </li>
              <li>
                <strong>Offline Payments:</strong> Cash and bank transfers must be manually verified by submitting this form.
              </li>
              <li>
                <strong>Dashboard Access:</strong> Your company dashboard remains deactivated until payment is verified.
              </li>
            </ul>
          </div>

          {/* Contact Support */}
          <p className="text-center text-sm text-text-secondary">
            Alternatively, you can directly contact your Super Admin at{' '}
            <button
              onClick={(e) => {
                e.preventDefault();
                window.location.href = 'mailto:superadmin@email.com';
              }}
              className="text-text-accent-purple hover:underline bg-transparent border-none cursor-pointer font-medium"
              style={{ padding: 0, fontSize: 'inherit' }}
            >
              superadmin@email.com
            </button>
            {' '}for payment confirmation and faster reactivation.
          </p>
        </div>
      </div>
    </div>
  );
};

export default OfflinePaymentSubmissionPage;