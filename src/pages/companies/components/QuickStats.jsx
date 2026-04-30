import React from 'react';
import { Zap } from 'lucide-react';

const StatRow = ({ label, value }) => (
  <div className="flex justify-between items-center text-md">
    <span className="text-text-secondary">{label}</span>
    <span className="font-bold text-text-primary">{value}</span>
  </div>
);

const fallbackStats = {
  currentUsers: '—',
  pricePerSeat: '—',
  monthlyRevenue: '—',
  totalRevenue: '—'
};

const QuickStats = ({ stats }) => {
  const data = stats || fallbackStats;

  return (
    <div className="w-full bg-bg-primary border border-border-primary rounded-sm p-lg flex flex-col gap-xl shadow-sm">
      <div className="flex items-center gap-md">
        <Zap className="h-5 w-5 text-text-accent-purple" />
        <h3 className="font-bold text-lg text-text-primary">Quick Stats</h3>
      </div>

      <div className="space-y-lg">
        <StatRow label="Current Users" value={data.currentUsers ?? '—'} />
        <StatRow label="Price Per Seat" value={data.pricePerSeat ?? '—'} />
        <StatRow label="Monthly Revenue" value={data.monthlyRevenue ?? '—'} />
        <StatRow label="Total Revenue" value={data.totalRevenue ?? '—'} />
      </div>
    </div>
  );
};

export default QuickStats;
