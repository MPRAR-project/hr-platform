import React from 'react';
import { Loader2, Users, CreditCard, Calendar, Database } from 'lucide-react';
import Loader from './Loader';

/**
 * Loading skeleton for dashboard statistics cards
 */
const StatCardSkeleton = ({ icon: Icon, title }) => (
  <div className="bg-white rounded-lg border border-gray-200 p-6 animate-pulse">
    <div className="flex items-center justify-between">
      <div className="flex-1">
        <div className="flex items-center gap-3 mb-2">
          {Icon && <Icon className="h-5 w-5 text-gray-300" />}
          <div className="h-4 bg-gray-200 rounded w-20"></div>
        </div>
        <div className="h-8 bg-gray-200 rounded w-16 mb-2"></div>
        <div className="h-3 bg-gray-200 rounded w-32"></div>
      </div>
      <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
        {Icon && <Icon className="h-6 w-6 text-gray-300" />}
      </div>
    </div>
  </div>
);

/**
 * Loading skeleton for team management table
 */
const TeamTableSkeleton = () => (
  <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
    {/* Table header */}
    <div className="bg-gray-50 px-6 py-3 border-b border-gray-200">
      <div className="flex justify-between items-center">
        <div className="h-5 bg-gray-200 rounded w-32 animate-pulse"></div>
        <div className="h-8 bg-gray-200 rounded w-24 animate-pulse"></div>
      </div>
    </div>
    
    {/* Table rows */}
    <div className="divide-y divide-gray-200">
      {[...Array(5)].map((_, index) => (
        <div key={index} className="px-6 py-4 animate-pulse">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1">
              <div className="w-8 h-8 bg-gray-200 rounded-full"></div>
              <div>
                <div className="h-4 bg-gray-200 rounded w-32 mb-1"></div>
                <div className="h-3 bg-gray-200 rounded w-48"></div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="h-6 bg-gray-200 rounded-full w-16"></div>
              <div className="h-6 bg-gray-200 rounded-full w-16"></div>
              <div className="flex gap-2">
                <div className="h-8 bg-gray-200 rounded w-16"></div>
                <div className="h-8 bg-gray-200 rounded w-20"></div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

/**
 * Main dashboard loading state component
 */
const DashboardLoadingState = ({ 
  showStats = true, 
  showTeamTable = true,
  message = 'Loading dashboard...',
  className = ''
}) => (
  <div className={`space-y-6 ${className}`}>
    {/* Loading message */}
    <div className="flex items-center justify-center py-4">
      <Loader variant="pulse" size="md" text={message} />
    </div>

    {/* Statistics cards skeleton */}
    {showStats && (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCardSkeleton icon={Users} title="Total Users" />
        <StatCardSkeleton icon={Users} title="Total Seats" />
        <StatCardSkeleton icon={CreditCard} title="Monthly Bill" />
        <StatCardSkeleton icon={Calendar} title="Last Payment" />
      </div>
    )}

    {/* Team table skeleton */}
    {showTeamTable && (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-6 bg-gray-200 rounded w-40 animate-pulse"></div>
          <div className="h-4 bg-gray-200 rounded w-64 animate-pulse"></div>
        </div>
        <TeamTableSkeleton />
      </div>
    )}
  </div>
);

/**
 * Compact loading state for smaller sections
 */
export const CompactLoadingState = ({ message = 'Loading...', className = '' }) => (
  <div className={`flex items-center justify-center py-8 ${className}`}>
    <Loader variant="pulse" size="sm" text={message} />
  </div>
);

/**
 * Inline loading state for buttons and small components
 */
export const InlineLoadingState = ({ message = 'Loading...', size = 'sm', className = '' }) => {
  const sizeClasses = {
    xs: 'h-3 w-3',
    sm: 'h-4 w-4',
    md: 'h-5 w-5',
    lg: 'h-6 w-6'
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Loader2 className={`${sizeClasses[size]} animate-spin text-gray-500`} />
      <span className="text-sm text-gray-600">{message}</span>
    </div>
  );
};

/**
 * Section-specific loading states
 */
export const StatsLoadingState = ({ className = '' }) => (
  <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 ${className}`}>
    <StatCardSkeleton icon={Users} />
    <StatCardSkeleton icon={Users} />
    <StatCardSkeleton icon={CreditCard} />
    <StatCardSkeleton icon={Calendar} />
  </div>
);

export const TeamLoadingState = ({ className = '' }) => (
  <div className={className}>
    <TeamTableSkeleton />
  </div>
);

/**
 * Loading overlay for existing content
 */
export const LoadingOverlay = ({ 
  isLoading, 
  message = 'Loading...', 
  children,
  className = ''
}) => (
  <div className={`relative ${className}`}>
    {children}
    {isLoading && (
      <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center z-10">
        <div className="flex items-center gap-3 text-gray-600 bg-white px-4 py-2 rounded-lg shadow-sm border">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm font-medium">{message}</span>
        </div>
      </div>
    )}
  </div>
);

export default DashboardLoadingState;