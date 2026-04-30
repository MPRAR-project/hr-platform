import React from 'react';
import { 
  Database, 
  Users, 
  CreditCard, 
  AlertCircle, 
  Wifi, 
  Shield,
  Plus,
  RefreshCw
} from 'lucide-react';
import Button from './Button';
import { RetryLink } from './RetryButton';

/**
 * Generic data unavailable state component
 */
const DataUnavailableState = ({
  icon: Icon = Database,
  title = 'No Data Available',
  message = 'There is no data to display at this time.',
  actionLabel,
  onAction,
  showRetry = false,
  onRetry,
  variant = 'default',
  className = ''
}) => {
  const variants = {
    default: 'bg-white border border-gray-200 rounded-lg p-8',
    compact: 'bg-gray-50 border border-gray-200 rounded p-6',
    minimal: 'p-6',
    empty: 'py-12'
  };

  return (
    <div className={`${variants[variant]} ${className}`}>
      <div className="text-center max-w-sm mx-auto">
        {/* Icon */}
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
          <Icon className="h-8 w-8 text-gray-400" />
        </div>

        {/* Title and message */}
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          {title}
        </h3>
        <p className="text-sm text-gray-600 mb-6">
          {message}
        </p>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          {actionLabel && onAction && (
            <Button
              variant="primary"
              onClick={onAction}
              icon={Plus}
              iconFirst
            >
              {actionLabel}
            </Button>
          )}
          
          {showRetry && onRetry && (
            <RetryLink onRetry={onRetry} />
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Specific empty states for different dashboard sections
 */
export const EmptyTeamState = ({ onAddUsers, className = '' }) => (
  <DataUnavailableState
    icon={Users}
    title="No Team Members"
    message="You haven't added any team members yet. Start building your team by adding users to your organization."
    actionLabel="Add Users"
    onAction={onAddUsers}
    variant="default"
    className={className}
  />
);

export const EmptyPaymentState = ({ className = '' }) => (
  <DataUnavailableState
    icon={CreditCard}
    title="No Payment History"
    message="No payment information is available. Payment history will appear here once you have active subscriptions."
    variant="compact"
    className={className}
  />
);

export const EmptyStatisticsState = ({ onRetry, className = '' }) => (
  <DataUnavailableState
    icon={Database}
    title="Statistics Unavailable"
    message="Unable to load dashboard statistics. This may be due to a temporary issue or missing data."
    showRetry={true}
    onRetry={onRetry}
    variant="compact"
    className={className}
  />
);

/**
 * Error-specific empty states
 */
export const NetworkErrorState = ({ onRetry, className = '' }) => (
  <DataUnavailableState
    icon={Wifi}
    title="Connection Problem"
    message="Unable to connect to the server. Please check your internet connection and try again."
    showRetry={true}
    onRetry={onRetry}
    variant="default"
    className={className}
  />
);

export const PermissionErrorState = ({ className = '' }) => (
  <DataUnavailableState
    icon={Shield}
    title="Access Denied"
    message="You don't have permission to view this data. Please contact your administrator if you believe this is an error."
    variant="default"
    className={className}
  />
);

export const ConfigurationErrorState = ({ className = '' }) => (
  <DataUnavailableState
    icon={AlertCircle}
    title="Configuration Issue"
    message="Your account is not properly configured. Please contact your administrator to resolve this issue."
    variant="default"
    className={className}
  />
);

/**
 * Search/filter empty states
 */
export const NoSearchResultsState = ({ 
  searchTerm, 
  onClearSearch,
  className = '' 
}) => (
  <DataUnavailableState
    icon={Database}
    title="No Results Found"
    message={`No results found for "${searchTerm}". Try adjusting your search terms or filters.`}
    actionLabel="Clear Search"
    onAction={onClearSearch}
    variant="minimal"
    className={className}
  />
);

/**
 * Maintenance/temporary unavailable states
 */
export const MaintenanceState = ({ className = '' }) => (
  <DataUnavailableState
    icon={AlertCircle}
    title="Temporarily Unavailable"
    message="This feature is temporarily unavailable due to maintenance. Please try again later."
    variant="default"
    className={className}
  />
);

/**
 * Loading failed state with retry option
 */
export const LoadingFailedState = ({ 
  onRetry, 
  error,
  className = '' 
}) => (
  <DataUnavailableState
    icon={AlertCircle}
    title="Loading Failed"
    message={error ? `Failed to load data: ${error}` : "Something went wrong while loading the data."}
    showRetry={true}
    onRetry={onRetry}
    variant="default"
    className={className}
  />
);

/**
 * Compact inline empty state
 */
export const InlineEmptyState = ({ 
  message = 'No data available',
  className = ''
}) => (
  <div className={`flex items-center justify-center py-8 text-gray-500 ${className}`}>
    <div className="text-center">
      <Database className="h-8 w-8 text-gray-300 mx-auto mb-2" />
      <p className="text-sm">{message}</p>
    </div>
  </div>
);

/**
 * Table empty state
 */
export const TableEmptyState = ({ 
  title = 'No Data',
  message = 'No items to display',
  actionLabel,
  onAction,
  className = ''
}) => (
  <div className={`bg-white border border-gray-200 rounded-lg ${className}`}>
    <div className="px-6 py-12">
      <DataUnavailableState
        title={title}
        message={message}
        actionLabel={actionLabel}
        onAction={onAction}
        variant="minimal"
      />
    </div>
  </div>
);

export default DataUnavailableState;