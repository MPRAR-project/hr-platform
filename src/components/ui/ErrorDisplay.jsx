import React from 'react';
import { AlertTriangle, Wifi, Shield, Database, Settings, RefreshCw } from 'lucide-react';
import { ERROR_TYPES, getUserErrorMessage, isRetryableError } from '../../utils/errorHandler';
import Button from './Button';

/**
 * Maps error types to appropriate icons and colors
 */
const ERROR_CONFIG = {
  [ERROR_TYPES.NETWORK_ERROR]: {
    icon: Wifi,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200'
  },
  [ERROR_TYPES.PERMISSION_ERROR]: {
    icon: Shield,
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200'
  },
  [ERROR_TYPES.DATA_ERROR]: {
    icon: Database,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200'
  },
  [ERROR_TYPES.CONFIGURATION_ERROR]: {
    icon: Settings,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200'
  },
  [ERROR_TYPES.VALIDATION_ERROR]: {
    icon: AlertTriangle,
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200'
  },
  [ERROR_TYPES.UNKNOWN_ERROR]: {
    icon: AlertTriangle,
    color: 'text-gray-600',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200'
  }
};

/**
 * Error display component with different variants for different error types
 */
const ErrorDisplay = ({ 
  error, 
  onRetry, 
  showRetry = true, 
  variant = 'default',
  className = '',
  showDetails = false 
}) => {
  if (!error) return null;

  const config = ERROR_CONFIG[error.type] || ERROR_CONFIG[ERROR_TYPES.UNKNOWN_ERROR];
  const Icon = config.icon;
  const userMessage = getUserErrorMessage(error);
  const canRetry = isRetryableError(error) && showRetry && onRetry;

  // Different variants for different use cases
  const variants = {
    default: 'p-4 rounded-lg border',
    compact: 'p-3 rounded border',
    inline: 'p-2 rounded text-sm',
    banner: 'p-4 border-l-4'
  };

  const baseClasses = `${variants[variant]} ${config.bgColor} ${config.borderColor} ${className}`;

  return (
    <div className={baseClasses} role="alert">
      <div className="flex items-start gap-3">
        <Icon className={`h-5 w-5 ${config.color} flex-shrink-0 mt-0.5`} />
        
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <p className={`font-medium ${config.color}`}>
                {getErrorTitle(error.type)}
              </p>
              <p className="mt-1 text-sm text-gray-700">
                {userMessage}
              </p>
              
              {showDetails && error.details && Object.keys(error.details).length > 0 && (
                <details className="mt-2">
                  <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">
                    Technical Details
                  </summary>
                  <pre className="mt-1 text-xs text-gray-600 bg-white p-2 rounded border overflow-auto">
                    {JSON.stringify(error.details, null, 2)}
                  </pre>
                </details>
              )}
            </div>
            
            {canRetry && (
              <Button
                variant="outline-primary"
                size="sm"
                icon={RefreshCw}
                onClick={onRetry}
                className="flex-shrink-0"
              >
                Retry
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Gets user-friendly title for error type
 */
function getErrorTitle(errorType) {
  switch (errorType) {
    case ERROR_TYPES.NETWORK_ERROR:
      return 'Connection Problem';
    case ERROR_TYPES.PERMISSION_ERROR:
      return 'Access Denied';
    case ERROR_TYPES.DATA_ERROR:
      return 'Data Unavailable';
    case ERROR_TYPES.CONFIGURATION_ERROR:
      return 'Configuration Issue';
    case ERROR_TYPES.VALIDATION_ERROR:
      return 'Invalid Input';
    case ERROR_TYPES.UNKNOWN_ERROR:
    default:
      return 'Unexpected Error';
  }
}

/**
 * Compact error display for inline use
 */
export const CompactErrorDisplay = ({ error, onRetry, className = '' }) => (
  <ErrorDisplay 
    error={error} 
    onRetry={onRetry} 
    variant="compact" 
    className={className}
    showRetry={true}
  />
);

/**
 * Inline error display for form fields
 */
export const InlineErrorDisplay = ({ error, className = '' }) => (
  <ErrorDisplay 
    error={error} 
    variant="inline" 
    className={className}
    showRetry={false}
  />
);

/**
 * Banner error display for page-level errors
 */
export const BannerErrorDisplay = ({ error, onRetry, className = '' }) => (
  <ErrorDisplay 
    error={error} 
    onRetry={onRetry} 
    variant="banner" 
    className={className}
    showRetry={true}
    showDetails={true}
  />
);

/**
 * Error boundary fallback component
 */
export const ErrorBoundaryFallback = ({ error, resetError }) => (
  <div className="min-h-screen flex items-center justify-center bg-gray-50">
    <div className="max-w-md w-full">
      <ErrorDisplay
        error={{
          type: ERROR_TYPES.UNKNOWN_ERROR,
          userMessage: 'Something went wrong with this page. Please try refreshing or contact support if the problem persists.',
          details: { originalError: error?.message }
        }}
        onRetry={resetError}
        showDetails={true}
        className="shadow-lg"
      />
    </div>
  </div>
);

export default ErrorDisplay;