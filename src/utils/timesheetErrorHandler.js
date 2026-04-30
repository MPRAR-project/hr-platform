import { toast } from 'react-toastify';

/**
 * Centralized error handling for timesheet operations
 */
export class TimesheetErrorHandler {
  /**
   * Error codes for different timesheet scenarios
   */
  static ERROR_CODES = {
    // Validation errors
    DUPLICATE_WEEK_SUBMISSION: 'DUPLICATE_WEEK_SUBMISSION',
    APPROVED_TIMESHEET_READONLY: 'APPROVED_TIMESHEET_READONLY',
    INVALID_WEEK_DATE: 'INVALID_WEEK_DATE',
    MISSING_USER_ID: 'MISSING_USER_ID',
    FUTURE_WEEK_SUBMISSION: 'FUTURE_WEEK_SUBMISSION',
    
    // Deduplication errors
    DUPLICATE_DETECTION_FAILED: 'DUPLICATE_DETECTION_FAILED',
    MERGE_OPERATION_FAILED: 'MERGE_OPERATION_FAILED',
    CLEANUP_OPERATION_FAILED: 'CLEANUP_OPERATION_FAILED',
    INSUFFICIENT_ENTRIES_FOR_MERGE: 'INSUFFICIENT_ENTRIES_FOR_MERGE',
    
    // Consistency errors
    DATA_INCONSISTENCY_DETECTED: 'DATA_INCONSISTENCY_DETECTED',
    CONSISTENCY_REPAIR_FAILED: 'CONSISTENCY_REPAIR_FAILED',
    METADATA_CORRUPTION: 'METADATA_CORRUPTION',
    AUDIT_TRAIL_MISSING: 'AUDIT_TRAIL_MISSING',
    
    // Database errors
    FIRESTORE_PERMISSION_DENIED: 'FIRESTORE_PERMISSION_DENIED',
    FIRESTORE_NETWORK_ERROR: 'FIRESTORE_NETWORK_ERROR',
    FIRESTORE_QUOTA_EXCEEDED: 'FIRESTORE_QUOTA_EXCEEDED',
    DOCUMENT_NOT_FOUND: 'DOCUMENT_NOT_FOUND',
    BATCH_OPERATION_FAILED: 'BATCH_OPERATION_FAILED',
    
    // System errors
    CACHE_INVALIDATION_FAILED: 'CACHE_INVALIDATION_FAILED',
    PERFORMANCE_MONITORING_FAILED: 'PERFORMANCE_MONITORING_FAILED',
    UNKNOWN_ERROR: 'UNKNOWN_ERROR'
  };

  /**
   * Error messages for user-friendly display
   */
  static ERROR_MESSAGES = {
    [this.ERROR_CODES.DUPLICATE_WEEK_SUBMISSION]: {
      title: 'Duplicate Submission',
      message: 'A timesheet for this week has already been submitted. You can update the existing submission instead.',
      severity: 'warning',
      actionable: true,
      suggestedActions: ['Update existing submission', 'Contact administrator']
    },
    [this.ERROR_CODES.APPROVED_TIMESHEET_READONLY]: {
      title: 'Cannot Modify Approved Timesheet',
      message: 'This timesheet has been approved and cannot be modified. Contact your manager if changes are needed.',
      severity: 'error',
      actionable: false,
      suggestedActions: ['Contact manager', 'Submit new timesheet for next period']
    },
    [this.ERROR_CODES.INVALID_WEEK_DATE]: {
      title: 'Invalid Date',
      message: 'The provided week date is invalid. Please select a valid Monday date.',
      severity: 'error',
      actionable: true,
      suggestedActions: ['Select valid date', 'Use date picker']
    },
    [this.ERROR_CODES.MISSING_USER_ID]: {
      title: 'User Not Identified',
      message: 'Unable to identify the user for this timesheet operation. Please log in again.',
      severity: 'error',
      actionable: true,
      suggestedActions: ['Log in again', 'Refresh page', 'Contact support']
    },
    [this.ERROR_CODES.DUPLICATE_DETECTION_FAILED]: {
      title: 'Duplicate Detection Failed',
      message: 'Unable to check for duplicate entries. The operation will continue, but duplicates may not be resolved.',
      severity: 'warning',
      actionable: false,
      suggestedActions: ['Try again later', 'Contact administrator']
    },
    [this.ERROR_CODES.DATA_INCONSISTENCY_DETECTED]: {
      title: 'Data Inconsistency Detected',
      message: 'Inconsistent timesheet data was found and has been automatically repaired.',
      severity: 'info',
      actionable: false,
      suggestedActions: ['Review timesheet data', 'Contact support if issues persist']
    },
    [this.ERROR_CODES.FIRESTORE_PERMISSION_DENIED]: {
      title: 'Permission Denied',
      message: 'You do not have permission to perform this operation. Contact your administrator.',
      severity: 'error',
      actionable: false,
      suggestedActions: ['Contact administrator', 'Check user permissions']
    },
    [this.ERROR_CODES.FIRESTORE_NETWORK_ERROR]: {
      title: 'Network Error',
      message: 'Unable to connect to the server. Please check your internet connection and try again.',
      severity: 'error',
      actionable: true,
      suggestedActions: ['Check internet connection', 'Try again', 'Refresh page']
    },
    [this.ERROR_CODES.UNKNOWN_ERROR]: {
      title: 'Unexpected Error',
      message: 'An unexpected error occurred. Please try again or contact support if the problem persists.',
      severity: 'error',
      actionable: true,
      suggestedActions: ['Try again', 'Refresh page', 'Contact support']
    }
  };

  /**
   * Handle and display error to user
   * @param {Error|string} error - Error object or error code
   * @param {Object} context - Additional context for error handling
   * @param {Object} options - Display options
   */
  static handleError(error, context = {}, options = {}) {
    const {
      showToast = true,
      logError = true,
      throwError = false,
      customMessage = null,
      onError = null
    } = options;

    let errorCode;
    let errorMessage;
    let originalError = error;

    // Determine error code and message
    if (typeof error === 'string') {
      errorCode = error;
      errorMessage = this.ERROR_MESSAGES[errorCode]?.message || error;
    } else if (error instanceof Error) {
      errorCode = this.mapErrorToCode(error);
      errorMessage = customMessage || error.message;
      originalError = error;
    } else {
      errorCode = this.ERROR_CODES.UNKNOWN_ERROR;
      errorMessage = customMessage || 'An unknown error occurred';
    }

    const errorInfo = this.ERROR_MESSAGES[errorCode] || this.ERROR_MESSAGES[this.ERROR_CODES.UNKNOWN_ERROR];

    // Log error for debugging
    if (logError) {
      console.error('[TimesheetErrorHandler]', {
        code: errorCode,
        message: errorMessage,
        context,
        originalError,
        timestamp: new Date().toISOString()
      });
    }

    // Show user notification
    if (showToast) {
      this.showErrorToast(errorInfo, customMessage || errorMessage);
    }

    // Call custom error handler if provided
    if (onError && typeof onError === 'function') {
      try {
        onError({
          code: errorCode,
          message: errorMessage,
          severity: errorInfo.severity,
          context,
          originalError
        });
      } catch (handlerError) {
        console.error('[TimesheetErrorHandler] Custom error handler failed:', handlerError);
      }
    }

    // Throw error if requested (for error boundaries)
    if (throwError) {
      const enhancedError = new Error(errorMessage);
      enhancedError.code = errorCode;
      enhancedError.context = context;
      enhancedError.originalError = originalError;
      throw enhancedError;
    }

    return {
      code: errorCode,
      message: errorMessage,
      severity: errorInfo.severity,
      actionable: errorInfo.actionable,
      suggestedActions: errorInfo.suggestedActions
    };
  }

  /**
   * Map generic errors to specific error codes
   * @param {Error} error - Error object
   * @returns {string} Error code
   */
  static mapErrorToCode(error) {
    const message = error.message?.toLowerCase() || '';
    const code = error.code?.toLowerCase() || '';

    // Firebase/Firestore errors
    if (code.includes('permission-denied') || message.includes('permission denied')) {
      return this.ERROR_CODES.FIRESTORE_PERMISSION_DENIED;
    }
    if (code.includes('unavailable') || message.includes('network') || message.includes('connection')) {
      return this.ERROR_CODES.FIRESTORE_NETWORK_ERROR;
    }
    if (code.includes('resource-exhausted') || message.includes('quota')) {
      return this.ERROR_CODES.FIRESTORE_QUOTA_EXCEEDED;
    }
    if (code.includes('not-found') || message.includes('not found')) {
      return this.ERROR_CODES.DOCUMENT_NOT_FOUND;
    }

    // Timesheet-specific errors
    if (message.includes('duplicate') && message.includes('week')) {
      return this.ERROR_CODES.DUPLICATE_WEEK_SUBMISSION;
    }
    if (message.includes('approved') && message.includes('readonly')) {
      return this.ERROR_CODES.APPROVED_TIMESHEET_READONLY;
    }
    if (message.includes('invalid') && message.includes('date')) {
      return this.ERROR_CODES.INVALID_WEEK_DATE;
    }
    if (message.includes('user') && (message.includes('missing') || message.includes('not found'))) {
      return this.ERROR_CODES.MISSING_USER_ID;
    }
    if (message.includes('duplicate') && message.includes('detection')) {
      return this.ERROR_CODES.DUPLICATE_DETECTION_FAILED;
    }
    if (message.includes('inconsistency') || message.includes('inconsistent')) {
      return this.ERROR_CODES.DATA_INCONSISTENCY_DETECTED;
    }

    return this.ERROR_CODES.UNKNOWN_ERROR;
  }

  /**
   * Show error toast notification
   * @param {Object} errorInfo - Error information
   * @param {string} message - Error message
   */
  static showErrorToast(errorInfo, message) {
    const toastOptions = {
      position: 'top-right',
      autoClose: errorInfo.severity === 'error' ? 8000 : 5000,
      hideProgressBar: false,
      closeOnClick: true,
      pauseOnHover: true,
      draggable: true
    };

    switch (errorInfo.severity) {
      case 'error':
        toast.error(message, toastOptions);
        break;
      case 'warning':
        toast.warning(message, toastOptions);
        break;
      case 'info':
        toast.info(message, toastOptions);
        break;
      default:
        toast(message, toastOptions);
    }
  }

  /**
   * Create a user-friendly error message with suggested actions
   * @param {string} errorCode - Error code
   * @param {Object} context - Additional context
   * @returns {Object} Formatted error information
   */
  static formatErrorForUser(errorCode, context = {}) {
    const errorInfo = this.ERROR_MESSAGES[errorCode] || this.ERROR_MESSAGES[this.ERROR_CODES.UNKNOWN_ERROR];
    
    return {
      title: errorInfo.title,
      message: errorInfo.message,
      severity: errorInfo.severity,
      actionable: errorInfo.actionable,
      suggestedActions: errorInfo.suggestedActions,
      context,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Wrap async operations with error handling
   * @param {Function} operation - Async operation to wrap
   * @param {Object} context - Context for error handling
   * @param {Object} options - Error handling options
   * @returns {Promise} Wrapped operation result
   */
  static async wrapOperation(operation, context = {}, options = {}) {
    try {
      return await operation();
    } catch (error) {
      return this.handleError(error, context, options);
    }
  }

  /**
   * Create a retry mechanism for failed operations
   * @param {Function} operation - Operation to retry
   * @param {Object} options - Retry options
   * @returns {Promise} Operation result
   */
  static async withRetry(operation, options = {}) {
    const {
      maxRetries = 3,
      baseDelay = 1000,
      maxDelay = 5000,
      backoffFactor = 2,
      retryCondition = (error) => true,
      onRetry = null
    } = options;

    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        if (attempt === maxRetries || !retryCondition(error)) {
          throw error;
        }
        
        const delay = Math.min(baseDelay * Math.pow(backoffFactor, attempt), maxDelay);
        
        if (onRetry) {
          onRetry(error, attempt + 1, delay);
        }
        
        console.warn(`[TimesheetErrorHandler] Operation failed, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1}):`, error);
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError;
  }

  /**
   * Validate operation context and throw appropriate errors
   * @param {Object} context - Operation context to validate
   * @param {Array} requiredFields - Required fields in context
   */
  static validateContext(context, requiredFields = []) {
    for (const field of requiredFields) {
      if (!context[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate user ID format
    if (context.userId && typeof context.userId !== 'string') {
      throw new Error('Invalid user ID format');
    }

    // Validate date format
    if (context.weekStart && !/^\d{4}-\d{2}-\d{2}$/.test(context.weekStart)) {
      throw new Error('Invalid week start date format');
    }
  }
}

// Export convenience functions
export const handleTimesheetError = (error, context, options) => 
  TimesheetErrorHandler.handleError(error, context, options);

export const wrapTimesheetOperation = (operation, context, options) => 
  TimesheetErrorHandler.wrapOperation(operation, context, options);

export const withTimesheetRetry = (operation, options) => 
  TimesheetErrorHandler.withRetry(operation, options);

export const validateTimesheetContext = (context, requiredFields) => 
  TimesheetErrorHandler.validateContext(context, requiredFields);

// Export error codes for use in other modules
export const TIMESHEET_ERROR_CODES = TimesheetErrorHandler.ERROR_CODES;