import React from 'react';
import { Building2 } from 'lucide-react';
import Badge from '../../../components/ui/Badge';

const InfoItem = ({ label, value }) => (
  <div>
    <p className="text-sm font-bold text-text-secondary">{label}</p>
    <p className="text-md font-bold text-text-primary mt-xs">{value}</p>
  </div>
);

const fallbackCompany = {
  status: 'Active',
  industry: '—',
  joinDate: '—',
  contactEmail: '—',
  billingEmail: '—',
  website: '—',
  phone: '—',
  address: '—',
  paymentMethod: '—'
};

const CompanyInformation = ({ company }) => {
  const data = company || fallbackCompany;
  const statusVariant = data.status?.toLowerCase?.() === 'active' ? 'success' : 'danger';

  return (
    <div className="w-full bg-bg-primary border border-border-primary rounded-sm p-lg flex flex-col gap-xl shadow-sm">
      <div className="flex justify-between items-start">
        <div className="flex gap-md">
          <Building2 className="h-5 w-5 text-text-accent-purple mt-xs" />
          <div>
            <h3 className="font-bold text-lg text-text-primary">Company Information</h3>
            <p className="text-sm text-text-secondary">Basic company details and contact information</p>
          </div>
        </div>
        <Badge variant={statusVariant}>{data.status || '—'}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-xl">
        <InfoItem label="Industry" value={data.industry || '—'} />
        <InfoItem label="Join Date" value={data.joinDate || '—'} />
        <InfoItem label="Contact Email" value={data.contactEmail || '—'} />
        <InfoItem label="Billing Email" value={data.billingEmail || '—'} />
        <InfoItem label="Website" value={data.website || '—'} />
        <InfoItem label="Phone" value={data.phone || '—'} />
        <InfoItem label="Address" value={data.address || '—'} />
        <InfoItem label="Payment Method" value={data.paymentMethod || '—'} />
      </div>
    </div>
  );
};

export default CompanyInformation;
