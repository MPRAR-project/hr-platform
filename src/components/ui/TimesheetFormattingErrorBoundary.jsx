import React from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Error boundary specifically for timesheet formatting errors
 * Provides graceful fallbacks when number formatting fails
 */
class TimesheetFormattingErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log the error for debugging
    console.error('Timesheet formatting error:', error, errorInfo);
    
    // You could also log this to an error reporting service
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', 'exception', {
        description: `Timesheet formatting error: ${error.message}`,
        fatal: false
      });
    }
  }

  render() {
    if (this.state.hasError) {
      // Render fallback UI
      const { fallbackValue = '0', fallbackLabel = 'Value' } = this.props;
      
      return (
        <div className="flex items-center gap-2 text-text-secondary">
          <AlertTriangle className="h-4 w-4 text-orange-500" />
          <span className="text-sm">
            {fallbackLabel}: {fallbackValue}
          </span>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Higher-order component to wrap timesheet values with error handling
 * @param {React.Component} WrappedComponent - Component to wrap
 * @returns {React.Component} - Wrapped component with error boundary
 */
export const withTimesheetFormatting = (WrappedComponent) => {
  return function TimesheetFormattedComponent(props) {
    return (
      <TimesheetFormattingErrorBoundary 
        fallbackValue={props.fallbackValue || '0'}
        fallbackLabel={props.fallbackLabel || 'Value'}
      >
        <WrappedComponent {...props} />
      </TimesheetFormattingErrorBoundary>
    );
  };
};

/**
 * Hook for safe timesheet formatting with error handling
 * @param {Function} formatFn - Formatting function to use
 * @param {*} value - Value to format
 * @param {string} fallback - Fallback value on error
 * @returns {string} - Formatted value or fallback
 */
export const useTimesheetFormatting = (formatFn, value, fallback = '0') => {
  try {
    return formatFn(value);
  } catch (error) {
    console.warn('Timesheet formatting hook error:', error);
    return fallback;
  }
};

export default TimesheetFormattingErrorBoundary;