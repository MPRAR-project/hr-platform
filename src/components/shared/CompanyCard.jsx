import React, { useState, useRef } from 'react';
import { Building2 } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { useNavigate } from 'react-router-dom';
import ApprovalConfirmationModal from '../modals/ApprovalConfirmationModal';
import DeleteConfirmationModal from '../modals/DeleteConfirmationModal';
import { suspendCompany, activateCompany } from '../../services/companyManagementService';
import { fetchCompanyDetails } from '../../services/companyService';
import { useCache } from '../../contexts/CacheContext';
import { toast } from 'react-toastify';

const COMPANY_DETAIL_TTL = 2 * 60 * 1000; // 2 min

// A small, reusable sub-component for the stat items
const StatItem = ({ label, value }) => (
  <div className="flex flex-col gap-xs flex-1 min-w-[120px]">
    <span className="text-sm font-bold text-text-secondary capitalize">{label}</span>
    <span className="text-md font-bold text-text-primary capitalize">{value}</span>
  </div>
);


const CompanyCard = ({ company, onStatusChange }) => {
  const { name, category, email, status, users, revenue, joinDate, nextBilling, lastPayment, paymentMethod } = company;
  const navigate = useNavigate();
  const { getItem, setItem } = useCache();
  const [isActivateModalOpen, setIsActivateModalOpen] = useState(false);
  const [isSuspendModalOpen, setIsSuspendModalOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const prefetchStarted = useRef(false);

  const handleNavigate = () => {
    navigate(`/company`, { state: { companyId: company.id } });
  };

  const handleViewDetailsHover = () => {
    if (!company?.id || prefetchStarted.current || !setItem) return;
    const cacheKey = `company_${company.id}`;
    if (getItem?.(cacheKey)) return; // already cached
    prefetchStarted.current = true;
    fetchCompanyDetails(company.id)
      .then((data) => {
        setItem?.(cacheKey, data, COMPANY_DETAIL_TTL);
      })
      .catch(() => { })
      .finally(() => {
        prefetchStarted.current = false;
      });
  };

  const handleActivate = async () => {
    try {
      setIsProcessing(true);
      await activateCompany(company.id);
      setIsActivateModalOpen(false);
      // Trigger refresh of company list
      if (onStatusChange) {
        onStatusChange();
      }
      // Also dispatch a custom event for dashboard refresh
      window.dispatchEvent(new CustomEvent('companies:refresh'));
    } catch (error) {
      console.error('Failed to activate company:', error);
      // Error toast is handled in the service
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSuspend = async () => {
    try {
      setIsProcessing(true);
      await suspendCompany(company.id);
      setIsSuspendModalOpen(false);
      // Trigger refresh of company list
      if (onStatusChange) {
        onStatusChange();
      }
      // Also dispatch a custom event for dashboard refresh
      window.dispatchEvent(new CustomEvent('companies:refresh'));
    } catch (error) {
      console.error('Failed to suspend company:', error);
      // Error toast is handled in the service
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      <div className="w-full bg-background-primary border border-border-primary rounded-sm p-lg flex flex-col gap-xl shadow-sm">
        {/* --- Top Section --- */}
        <div className="flex justify-between items-center flex-wrap gap-md">
          <div className="flex items-center gap-3xl">
            <div className="p-lg bg-background-accent-purple-light rounded-full">
              <Building2 className="h-6 w-6 text-text-accent-purple" />
            </div>
            <div className="flex flex-col">
              <h3 className="text-lg font-semibold text-text-primary">{name}</h3>
              <p className="text-sm font-bold text-text-secondary">{category}</p>
              <p className="text-sm font-bold text-text-secondary">{email}</p>
            </div>
            <Badge variant={status?.toLowerCase() === 'active' ? 'success' : 'danger'}>{status}</Badge>
          </div>
          <div className="flex items-center gap-xl">

            <div className="flex items-center gap-md">
              {status?.toLowerCase() === 'active' ? (
                <Button
                  variant="outline-danger"
                  onClick={() => setIsSuspendModalOpen(true)}
                  disabled={isProcessing}
                >
                  {isProcessing ? 'Processing...' : 'Suspend'}
                </Button>
              ) : (
                <Button
                  variant="outline-success"
                  onClick={() => setIsActivateModalOpen(true)}
                  disabled={isProcessing}
                >
                  {isProcessing ? 'Processing...' : 'Activate'}
                </Button>
              )}
              <Button
                variant="primary"
                onClick={handleNavigate}
                onMouseEnter={handleViewDetailsHover}
                disabled={isProcessing}
              >
                View Details
              </Button>
            </div>
          </div>
        </div>

        {/* --- Divider --- */}
        <hr className="border-t border-border-primary" />

        {/* --- Bottom Section --- */}
        <div className="flex justify-between items-center flex-wrap gap-xl">
          <StatItem label="Users" value={users} />
          <StatItem label="Monthly Revenue" value={revenue} />
          <StatItem label="Join Date" value={joinDate} />
          <StatItem label="Next Billing" value={nextBilling} />
          <StatItem label="Last Payment" value={lastPayment} />
          <StatItem label="Payment Method" value={paymentMethod} />
        </div>
      </div>

      {/* Activate Modal */}
      <ApprovalConfirmationModal
        isOpen={isActivateModalOpen}
        onClose={() => setIsActivateModalOpen(false)}
        onConfirm={handleActivate}
        title="Activate Company"
        description={`Are you sure you want to activate ${name}? This will restore their access to the system and resume billing.`}
        confirmButtonText="Activate Company"
        cancelButtonText="Cancel"
      >
        <div className="space-y-4">
          {/* Company Details */}
          <div className="flex items-center justify-between p-3 border border-border-secondary rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-background-accent-purple-light rounded-full">
                <Building2 className="h-5 w-5 text-text-accent-purple" />
              </div>
              <div className="flex flex-col gap-1 flex-1">
                <span className="text-md font-semibold text-text-primary">
                  {name}
                </span>
                <span className="text-xs text-text-secondary">
                  {email}
                </span>
                <span className="text-xs text-text-secondary capitalize">
                  {category}
                </span>
              </div>
            </div>
            <div className="px-3 py-1.5 bg-green-100 rounded-full">
              <span className="text-[13px] font-medium text-green-600">
                {users} Users
              </span>
            </div>
          </div>

          {/* Additional Info */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
            <p className="text-sm text-green-700">
              <strong>Next billing:</strong> {nextBilling} • <strong>Monthly revenue:</strong> {revenue}
            </p>
          </div>
        </div>
      </ApprovalConfirmationModal>

      {/* Suspend Modal */}
      <DeleteConfirmationModal
        isOpen={isSuspendModalOpen}
        onClose={() => setIsSuspendModalOpen(false)}
        onConfirm={handleSuspend}
        title="Suspend Company"
        description={`Are you sure you want to suspend ${name}? All users will lose access to the system.`}
        warningMessage={`Suspending this company will immediately revoke access for all ${users} users. Billing will be paused, but data will be retained. You can reactivate the company at any time.`}
        confirmButtonText="Suspend Company"
        cancelButtonText="Cancel"
        itemDetails={{
          name: name,
          email: email,
          subtitle: category,
          badge: `${users} Users`
        }}
        variant="danger"
      />
    </>
  );
};

export default CompanyCard;