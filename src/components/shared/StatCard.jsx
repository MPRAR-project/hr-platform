import React from 'react';

const StatCard = ({ title, value, subtitle, icon, iconBgColor }) => {
  return (
    // The classes below match the CSS you sent:
    // padding-top/bottom: 16px -> py-2xl
    // padding-left/right: 24px -> px-4xl
    // border-radius: 12px -> rounded-base
    <div className="flex-1 bg-white min-w-56 bg-background-primary py-2xl px-4xl rounded-base shadow-md flex items-center justify-between">
      <div className="flex flex-col gap-base">
        <p className="font-bold text-text-secondary">{title}</p>
        <p className="text-xl font-semibold text-text-primary">{value}</p>
        <p className="text-xs font-bold text-text-secondary">{subtitle}</p>
      </div>
      <div className={`p-lg rounded-full ${iconBgColor}`}>
        {icon}
      </div>
    </div>
  );
};

export default StatCard;