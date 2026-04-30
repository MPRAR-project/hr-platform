import React from 'react';

const SummaryCard = ({ title, value, subtitle, icon, iconBgColor }) => {
  return (
    <div className="flex-1 bg-background-primary p-4xl rounded-base shadow-lg flex items-center justify-between">
      <div>
        <p className="text-md font-bold text-text-secondary">{title}</p>
        <p className="text-xl font-semibold text-text-primary mt-xs">{value}</p>
        <p className="text-xs font-bold text-text-secondary mt-xs">{subtitle}</p>
      </div>
      <div className={`p-lg rounded-full ${iconBgColor}`}>
        {icon}
      </div>
    </div>
  );
};

export default SummaryCard;