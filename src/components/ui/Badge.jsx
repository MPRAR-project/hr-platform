import React from 'react';

const Badge = ({ children, variant = 'success' }) => {
  // Base classes updated to match the new styles
  const baseClasses = 'inline-flex items-center px-lg py-0.5 rounded-full text-base font-medium capitalize';

  // Added new variants for user roles
  const variants = {
    success: 'bg-green-50 text-text-accent-green',
    danger: 'bg-red-50 text-text-accent-red',
    info: 'bg-blue-50 text-text-accent-blue',       // Blue for 'Employee'
    role: 'bg-purple-50 text-text-accent-purple',// Purple for 'Manager'
    warning: 'bg-orange-100 text-orange-500',
  };

  return (
    <span className={`${baseClasses} ${variants[variant] || variants.success}`}>
      {children}
    </span>
  );
};

export default Badge;