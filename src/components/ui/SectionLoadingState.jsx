import React from 'react';
import { Loader2, AlertCircle, Database, Users, CreditCard } from 'lucide-react';

/**
 * Generic section loading state with customizable content
 */
const SectionLoadingState = ({ 
  title,
  subtitle,
  icon: Icon = Database,
  message = 'Loading...',
  showProgress = false,
  progress = 0,
  className = '',
  variant = 'default'
}) => {
  const variants = {
    default: 'bg-white border border-gray-200 rounded-lg p-6',
    compact: 'bg-gray-50 border border-gray-200 rounded p-4',
    minimal: 'p-4',
    card: 'bg-white shadow-sm border border-gray-200 rounded-lg p-6'
  };

  return (
    <div className={`${variants[variant]} ${className}`}>
      <div className="flex items-center justify-center">
        <div className="text-center max-w-sm">
          {/* Icon and spinner */}
          <div className="relative inline-flex items-center justify-center mb-4">
            {Icon && (
              <Icon className="h-12 w-12 text-gray-300" />
            )}
            <Loader2 className="h-6 w-6 text-blue-500 animate-spin absolute" />
          </div>

          {/* Title and subtitle */}
          {title && (
            <h3 className="text-lg font-medium text-gray-900 mb-1">
              {title}
            </h3>
          )}
          {subtitle && (
            <p className="text-sm text-gray-600 mb-3">
              {subtitle}
            </p>
          )}

          {/* Loading message */}
          <p className="text-sm text-gray-500 mb-4">
            {message}
          </p>

          {/* Progress bar */}
          {showProgress && (
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Specific loading states for different dashboard sections
 */
export const TeamMembersLoadingState = ({ className = '' }) => (
  <SectionLoadingState
    title="Loading Team Members"
    subtitle="Fetching your team data..."
    icon={Users}
    message="This may take a few moments"
    className={className}
    variant="card"
  />
);

export const StatisticsLoadingState = ({ className = '' }) => (
  <SectionLoadingState
    title="Loading Statistics"
    subtitle="Calculating your dashboard metrics..."
    icon={CreditCard}
    message="Gathering billing and usage data"
    className={className}
    variant="card"
  />
);

export const PaymentLoadingState = ({ className = '' }) => (
  <SectionLoadingState
    title="Loading Payment Information"
    subtitle="Retrieving billing history..."
    icon={CreditCard}
    message="Fetching payment data"
    className={className}
    variant="compact"
  />
);

/**
 * List loading state with skeleton items
 */
export const ListLoadingState = ({ 
  itemCount = 5, 
  showHeader = true,
  className = '' 
}) => (
  <div className={`space-y-3 ${className}`}>
    {showHeader && (
      <div className="flex items-center justify-between mb-4">
        <div className="h-6 bg-gray-200 rounded w-32 animate-pulse"></div>
        <div className="h-8 bg-gray-200 rounded w-24 animate-pulse"></div>
      </div>
    )}
    
    {[...Array(itemCount)].map((_, index) => (
      <div key={index} className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded animate-pulse">
        <div className="w-10 h-10 bg-gray-200 rounded-full flex-shrink-0"></div>
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          <div className="h-3 bg-gray-200 rounded w-1/2"></div>
        </div>
        <div className="flex gap-2">
          <div className="h-8 bg-gray-200 rounded w-16"></div>
          <div className="h-8 bg-gray-200 rounded w-16"></div>
        </div>
      </div>
    ))}
  </div>
);

/**
 * Table loading state with skeleton rows
 */
export const TableLoadingState = ({ 
  columns = ['Name', 'Role', 'Status', 'Actions'],
  rowCount = 5,
  className = ''
}) => (
  <div className={`bg-white border border-gray-200 rounded-lg overflow-hidden ${className}`}>
    {/* Table header */}
    <div className="bg-gray-50 px-6 py-3 border-b border-gray-200">
      <div className="grid grid-cols-4 gap-4">
        {columns.map((column, index) => (
          <div key={index} className="h-4 bg-gray-200 rounded animate-pulse"></div>
        ))}
      </div>
    </div>
    
    {/* Table rows */}
    <div className="divide-y divide-gray-200">
      {[...Array(rowCount)].map((_, index) => (
        <div key={index} className="px-6 py-4">
          <div className="grid grid-cols-4 gap-4 items-center">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gray-200 rounded-full animate-pulse"></div>
              <div className="space-y-1">
                <div className="h-4 bg-gray-200 rounded w-24 animate-pulse"></div>
                <div className="h-3 bg-gray-200 rounded w-32 animate-pulse"></div>
              </div>
            </div>
            <div className="h-6 bg-gray-200 rounded-full w-16 animate-pulse"></div>
            <div className="h-6 bg-gray-200 rounded-full w-16 animate-pulse"></div>
            <div className="flex gap-2">
              <div className="h-8 bg-gray-200 rounded w-16 animate-pulse"></div>
              <div className="h-8 bg-gray-200 rounded w-20 animate-pulse"></div>
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

/**
 * Card grid loading state
 */
export const CardGridLoadingState = ({ 
  cardCount = 4, 
  columns = 4,
  className = ''
}) => (
  <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-${columns} gap-6 ${className}`}>
    {[...Array(cardCount)].map((_, index) => (
      <div key={index} className="bg-white border border-gray-200 rounded-lg p-6 animate-pulse">
        <div className="flex items-center justify-between mb-4">
          <div className="h-5 bg-gray-200 rounded w-20"></div>
          <div className="w-10 h-10 bg-gray-100 rounded-lg"></div>
        </div>
        <div className="h-8 bg-gray-200 rounded w-16 mb-2"></div>
        <div className="h-4 bg-gray-200 rounded w-32"></div>
      </div>
    ))}
  </div>
);

/**
 * Progressive loading state that shows different stages
 */
export const ProgressiveLoadingState = ({ 
  stages = [],
  currentStage = 0,
  className = ''
}) => (
  <div className={`bg-white border border-gray-200 rounded-lg p-6 ${className}`}>
    <div className="text-center">
      <Loader2 className="h-8 w-8 text-blue-500 animate-spin mx-auto mb-4" />
      
      <div className="space-y-3">
        {stages.map((stage, index) => (
          <div key={index} className="flex items-center justify-center gap-3">
            <div className={`
              w-2 h-2 rounded-full
              ${index < currentStage ? 'bg-green-500' : 
                index === currentStage ? 'bg-blue-500 animate-pulse' : 'bg-gray-300'}
            `} />
            <span className={`
              text-sm
              ${index <= currentStage ? 'text-gray-900' : 'text-gray-500'}
            `}>
              {stage}
            </span>
          </div>
        ))}
      </div>
    </div>
  </div>
);

export default SectionLoadingState;