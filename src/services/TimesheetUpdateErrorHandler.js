// TimesheetUpdateErrorHandler - Comprehensive error handling for real-time timesheet updates
import { toast } from 'react-toastify';
import optimisticUpdateManager from './OptimisticUpdateManager';
import eventBus, { TIMESHEET_EVENTS } from './EventBus';

// Error type constants
export const ERROR_TYPES = {
  NETWORK_ERROR: 'network_error',
  PERMISSION_DENIED: 'permission_denied',
  VALIDATION_ERROR: 'validation_error',
  CONCURRENT_EDIT: 'concurrent_edit',
  CACHE_INCONSISTENCY: 'cache_inconsistency',
  TIMEOUT_ERROR: 'timeout_error',
  QUOTA_EXCEEDED: 'quota_exceeded',
  UNKNOWN_ERROR: 'unknown_error'
};

// Error severity levels
export const ERROR_SEVERITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};

class TimesheetUpdateErrorHandler {
  constructor() {
    this.retryAttempts = new Map();
    this.maxRetries = 3;
    this.baseRetryDelay = 1000; // 1 second
    this.maxRetryDelay = 10000; // 10 seconds
    this.debugMode = process.env.NODE_ENV === 'development';
    this.errorStats = {
      totalErrors: 0,
      errorsByType: {},
      errorsBySeverity: {},
      recoveredErrors: 0,
      unrecoveredErrors: 0
    };
  }

  /**
   * Handle different types of timesheet update errors
   * @param {Error|string} error - The error object or message
   * @param {Object} context - Context information about the error
   * @param {Object} options - Error handling options
   */
  handleError(error, context = {}, options = {}) {
    const {
      throwError = false,
      showToast = true,
      attemptRecovery = true,
      logError = true
    } = options;

    try {
      // Normalize error information
      const errorInfo = this.normalizeError(error, context);
      
      // Update error statistics
      this.updateErrorStats(errorInfo);

      // Log error if enabled
      if (logError) {
        this.logError(errorInfo);
      }

      // Determine error handling strategy
      const strategy = this.determineErrorStrategy(errorInfo);

      // Execute error handling strategy
      const result = this.executeErrorStrategy(strategy, errorInfo, context);

      // Show user notification if enabled
      if (showToast) {
        this.showUserNotification(errorInfo, result);
      }

      // Broadcast error event
      this.broadcastErrorEvent(errorInfo, result);

      // Throw error if requested
      if (throwError && !result.recovered) {
        throw new Error(errorInfo.userMessage || errorInfo.message);
      }

      return result;

    } catch (handlingError) {
      console.error('[TimesheetUpdateErrorHandler] Error in error handling:', handlingError);
      
      // Fallback error handling
      if (showToast) {
        toast.error('An unexpected error occurred. Please try again.');
      }

      if (throwError) {
        throw handlingError;
      }

      return {
        recovered: false,
        strategy: 'fallback',
        error: handlingError.message
      };
    }
  }

  /**
   * Normalize error information
   */
  normalizeError(error, context) {
    const errorInfo = {
      originalError: error,
      message: '',
      type: ERROR_TYPES.UNKNOWN_ERROR,
      severity: ERROR_SEVERITY.MEDIUM,
      code: null,
      userMessage: '',
      context,
      timestamp: Date.now(),
      recoverable: true
    };

    // Extract error information
    if (error instanceof Error) {
      errorInfo.message = error.message;
      errorInfo.code = error.code;
      errorInfo.stack = error.stack;
    } else if (typeof error === 'string') {
      errorInfo.message = error;
    } else if (error && typeof error === 'object') {
      errorInfo.message = error.message || 'Unknown error';
      errorInfo.code = error.code;
    }

    // Determine error type and severity
    this.classifyError(errorInfo);

    return errorInfo;
  }

  /**
   * Classify error type and severity
   */
  classifyError(errorInfo) {
    const message = errorInfo.message.toLowerCase();
    const code = (errorInfo.code || '').toLowerCase();

    // Network errors
    if (message.includes('network') || message.includes('fetch') || 
        message.includes('timeout') || code === 'unavailable' ||
        message.includes('connection') || code === 'network-request-failed') {
      errorInfo.type = ERROR_TYPES.NETWORK_ERROR;
      errorInfo.severity = ERROR_SEVERITY.MEDIUM;
      errorInfo.userMessage = 'Network connection issue. Please check your internet connection and try again.';
      errorInfo.recoverable = true;
    }
    // Permission errors
    else if (message.includes('permission') || message.includes('unauthorized') ||
             code === 'permission-denied' || message.includes('forbidden')) {
      errorInfo.type = ERROR_TYPES.PERMISSION_DENIED;
      errorInfo.severity = ERROR_SEVERITY.HIGH;
      errorInfo.userMessage = 'You do not have permission to perform this action. Please contact your manager.';
      errorInfo.recoverable = false;
    }
    // Validation errors
    else if (message.includes('validation') || message.includes('invalid') ||
             message.includes('required') || message.includes('format')) {
      errorInfo.type = ERROR_TYPES.VALIDATION_ERROR;
      errorInfo.severity = ERROR_SEVERITY.LOW;
      errorInfo.userMessage = 'Please check your input and try again.';
      errorInfo.recoverable = true;
    }
    // Concurrent edit errors
    else if (message.includes('concurrent') || message.includes('conflict') ||
             message.includes('version') || code === 'aborted') {
      errorInfo.type = ERROR_TYPES.CONCURRENT_EDIT;
      errorInfo.severity = ERROR_SEVERITY.MEDIUM;
      errorInfo.userMessage = 'This timesheet was modified by another user. Please refresh and try again.';
      errorInfo.recoverable = true;
    }
    // Timeout errors
    else if (message.includes('timeout') || code === 'deadline-exceeded') {
      errorInfo.type = ERROR_TYPES.TIMEOUT_ERROR;
      errorInfo.severity = ERROR_SEVERITY.MEDIUM;
      errorInfo.userMessage = 'The operation timed out. Please try again.';
      errorInfo.recoverable = true;
    }
    // Quota exceeded errors
    else if (message.includes('quota') || message.includes('limit') ||
             code === 'resource-exhausted') {
      errorInfo.type = ERROR_TYPES.QUOTA_EXCEEDED;
      errorInfo.severity = ERROR_SEVERITY.HIGH;
      errorInfo.userMessage = 'Service temporarily unavailable. Please try again later.';
      errorInfo.recoverable = true;
    }
    // Cache inconsistency
    else if (message.includes('cache') || message.includes('stale') ||
             message.includes('inconsistent')) {
      errorInfo.type = ERROR_TYPES.CACHE_INCONSISTENCY;
      errorInfo.severity = ERROR_SEVERITY.LOW;
      errorInfo.userMessage = 'Data synchronization issue. Refreshing...';
      errorInfo.recoverable = true;
    }
    // Unknown errors
    else {
      errorInfo.type = ERROR_TYPES.UNKNOWN_ERROR;
      errorInfo.severity = ERROR_SEVERITY.MEDIUM;
      errorInfo.userMessage = 'An unexpected error occurred. Please try again.';
      errorInfo.recoverable = true;
    }
  }

  /**
   * Determine error handling strategy
   */
  determineErrorStrategy(errorInfo) {
    const { type, severity, recoverable, context } = errorInfo;
    const updateId = context.updateId;
    const retryCount = this.retryAttempts.get(updateId) || 0;

    // Strategy decision matrix
    if (!recoverable) {
      return {
        type: 'abort',
        showError: true,
        rollback: true,
        retry: false
      };
    }

    if (retryCount >= this.maxRetries) {
      return {
        type: 'abort_after_retries',
        showError: true,
        rollback: true,
        retry: false
      };
    }

    switch (type) {
      case ERROR_TYPES.NETWORK_ERROR:
      case ERROR_TYPES.TIMEOUT_ERROR:
        return {
          type: 'retry_with_backoff',
          showError: retryCount > 0,
          rollback: false,
          retry: true,
          delay: this.calculateRetryDelay(retryCount)
        };

      case ERROR_TYPES.CONCURRENT_EDIT:
        return {
          type: 'refresh_and_retry',
          showError: true,
          rollback: true,
          retry: true,
          refreshData: true,
          delay: 1000
        };

      case ERROR_TYPES.VALIDATION_ERROR:
        return {
          type: 'rollback_and_notify',
          showError: true,
          rollback: true,
          retry: false
        };

      case ERROR_TYPES.CACHE_INCONSISTENCY:
        return {
          type: 'clear_cache_and_retry',
          showError: false,
          rollback: false,
          retry: true,
          clearCache: true,
          delay: 500
        };

      case ERROR_TYPES.QUOTA_EXCEEDED:
        return {
          type: 'exponential_backoff',
          showError: true,
          rollback: false,
          retry: true,
          delay: this.calculateRetryDelay(retryCount, 5000) // Longer delay
        };

      default:
        return {
          type: 'default_retry',
          showError: true,
          rollback: false,
          retry: retryCount < 2,
          delay: this.calculateRetryDelay(retryCount)
        };
    }
  }

  /**
   * Execute error handling strategy
   */
  executeErrorStrategy(strategy, errorInfo, context) {
    const { updateId, userId, weekStart, dayEdits, originalOperation } = context;

    try {
      // Rollback optimistic update if needed
      if (strategy.rollback && updateId) {
        optimisticUpdateManager.rollbackUpdate(
          updateId, 
          errorInfo.type, 
          errorInfo
        );
      }

      // Clear cache if needed
      if (strategy.clearCache) {
        this.clearRelevantCache(userId, weekStart);
      }

      // Schedule retry if needed
      if (strategy.retry) {
        this.scheduleRetry(updateId, originalOperation, strategy.delay || 0);
      }

      // Refresh data if needed
      if (strategy.refreshData) {
        this.triggerDataRefresh(userId, weekStart);
      }

      return {
        recovered: strategy.retry,
        strategy: strategy.type,
        willRetry: strategy.retry,
        retryDelay: strategy.delay
      };

    } catch (strategyError) {
      console.error('[TimesheetUpdateErrorHandler] Error executing strategy:', strategyError);
      return {
        recovered: false,
        strategy: 'failed',
        error: strategyError.message
      };
    }
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  calculateRetryDelay(retryCount, baseDelay = this.baseRetryDelay) {
    const delay = Math.min(
      baseDelay * Math.pow(2, retryCount),
      this.maxRetryDelay
    );
    
    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 0.1 * delay;
    return Math.floor(delay + jitter);
  }

  /**
   * Schedule retry operation
   */
  scheduleRetry(updateId, originalOperation, delay) {
    if (!updateId || !originalOperation) return;

    // Increment retry count
    const currentRetries = this.retryAttempts.get(updateId) || 0;
    this.retryAttempts.set(updateId, currentRetries + 1);

    // Schedule retry
    setTimeout(() => {
      try {
        if (this.debugMode) {
          console.log(`[TimesheetUpdateErrorHandler] Retrying operation: ${updateId} (attempt ${currentRetries + 1})`);
        }

        // Execute original operation
        originalOperation();

      } catch (retryError) {
        console.error('[TimesheetUpdateErrorHandler] Retry failed:', retryError);
      }
    }, delay);
  }

  /**
   * Clear relevant cache data
   */
  clearRelevantCache(userId, weekStart) {
    try {
      // Import and use cache invalidation
      import('./timesheetCache').then(({ invalidateTimesheetCache }) => {
        invalidateTimesheetCache(userId, weekStart);
      });
    } catch (error) {
      console.warn('[TimesheetUpdateErrorHandler] Failed to clear cache:', error);
    }
  }

  /**
   * Trigger data refresh
   */
  triggerDataRefresh(userId, weekStart) {
    eventBus.emit(TIMESHEET_EVENTS.DATA_INVALIDATED, {
      userId,
      weekStart,
      reason: 'error_recovery',
      timestamp: Date.now()
    });
  }

  /**
   * Show user notification
   */
  showUserNotification(errorInfo, result) {
    const { userMessage, severity } = errorInfo;
    const { willRetry, retryDelay } = result;

    let message = userMessage;
    if (willRetry && retryDelay) {
      message += ` Retrying in ${Math.ceil(retryDelay / 1000)} seconds...`;
    }

    switch (severity) {
      case ERROR_SEVERITY.LOW:
        if (!willRetry) {
          toast.info(message);
        }
        break;
      case ERROR_SEVERITY.MEDIUM:
        toast.warning(message);
        break;
      case ERROR_SEVERITY.HIGH:
      case ERROR_SEVERITY.CRITICAL:
        toast.error(message);
        break;
      default:
        toast.error(message);
    }
  }

  /**
   * Broadcast error event
   */
  broadcastErrorEvent(errorInfo, result) {
    eventBus.emit(TIMESHEET_EVENTS.EDIT_FAILED, {
      error: errorInfo,
      recovery: result,
      timestamp: Date.now()
    });
  }

  /**
   * Log error information
   */
  logError(errorInfo) {
    const logLevel = this.getLogLevel(errorInfo.severity);
    const logMessage = `[TimesheetUpdateErrorHandler] ${errorInfo.type}: ${errorInfo.message}`;
    
    if (this.debugMode || errorInfo.severity === ERROR_SEVERITY.CRITICAL) {
      console[logLevel](logMessage, {
        type: errorInfo.type,
        severity: errorInfo.severity,
        context: errorInfo.context,
        stack: errorInfo.stack
      });
    }
  }

  /**
   * Get appropriate log level for error severity
   */
  getLogLevel(severity) {
    switch (severity) {
      case ERROR_SEVERITY.LOW:
        return 'info';
      case ERROR_SEVERITY.MEDIUM:
        return 'warn';
      case ERROR_SEVERITY.HIGH:
      case ERROR_SEVERITY.CRITICAL:
        return 'error';
      default:
        return 'warn';
    }
  }

  /**
   * Update error statistics
   */
  updateErrorStats(errorInfo) {
    this.errorStats.totalErrors++;
    this.errorStats.errorsByType[errorInfo.type] = (this.errorStats.errorsByType[errorInfo.type] || 0) + 1;
    this.errorStats.errorsBySeverity[errorInfo.severity] = (this.errorStats.errorsBySeverity[errorInfo.severity] || 0) + 1;
  }

  /**
   * Mark error as recovered
   */
  markRecovered(updateId) {
    this.errorStats.recoveredErrors++;
    this.retryAttempts.delete(updateId);
  }

  /**
   * Mark error as unrecovered
   */
  markUnrecovered(updateId) {
    this.errorStats.unrecoveredErrors++;
    this.retryAttempts.delete(updateId);
  }

  /**
   * Get error statistics
   */
  getErrorStats() {
    return {
      ...this.errorStats,
      activeRetries: this.retryAttempts.size,
      retryAttempts: Object.fromEntries(this.retryAttempts)
    };
  }

  /**
   * Clear error statistics
   */
  clearErrorStats() {
    this.errorStats = {
      totalErrors: 0,
      errorsByType: {},
      errorsBySeverity: {},
      recoveredErrors: 0,
      unrecoveredErrors: 0
    };
    this.retryAttempts.clear();
  }

  /**
   * Clean up expired retry attempts
   */
  cleanupExpiredRetries() {
    // This would be called periodically to clean up old retry attempts
    // Implementation depends on how you want to track retry expiration
  }
}

// Create and export singleton instance
const timesheetUpdateErrorHandler = new TimesheetUpdateErrorHandler();

export default timesheetUpdateErrorHandler;
export { TimesheetUpdateErrorHandler };