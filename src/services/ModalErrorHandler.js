import { TimesheetErrorHandler, TIMESHEET_ERROR_CODES } from '../utils/timesheetErrorHandler';
import { fastTimesheetLoader } from './FastTimesheetLoader';
import { getCachedWeeklyData } from './timesheetCache';

/**
 * ModalErrorHandler - Specialized error handling for modal operations
 * Provides graceful degradation strategies specific to modal usage patterns
 */
class ModalErrorHandler {
  constructor() {
    this.fallbackStrategies = new Map();
    this.errorMetrics = new Map();
    this.retryAttempts = new Map();
    this.maxRetries = 3;
    
    // Initialize fallback strategies
    this.initializeFallbackStrategies();
  }

  /**
   * Handle cache failure with direct fetch fallback
   */
  async handleCacheFailure(userId, weekStart, options = {}) {
    const { timeout = 2000, skipValidation = true } = options;
    
    console.warn(`ModalErrorHandler: Cache failure for ${userId}, week ${weekStart}, attempting direct fetch`);
    
    try {
      // Record the cache failure
      this.recordError('cache_failure', { userId, weekStart });
      
      // Attempt direct fetch with shorter timeout
      const result = await fastTimesheetLoader.fetchBasicWeekData(userId, weekStart, {
        timeout
      });
      
      console.log(`ModalErrorHandler: Direct fetch successful for ${userId}, week ${weekStart}`);
      
      return {
        ...result,
        recoveryMethod: 'direct_fetch',
        originalError: 'cache_failure',
        fallbackUsed: true
      };
      
    } catch (directFetchError) {
      console.error(`ModalErrorHandler: Direct fetch also failed for ${userId}, week ${weekStart}:`, directFetchError);
      
      // Try alternative cache sources
      return await this.handleDirectFetchFailure(userId, weekStart, directFetchError, options);
    }
  }

  /**
   * Handle validation failure - log but don't block UI
   */
  async handleValidationFailure(error, userId, weekStart, options = {}) {
    const { queueRetry = true, priority = 'medium', weekStartDay } = options;
    
    console.warn(`ModalErrorHandler: Validation failed for ${userId}, week ${weekStart}:`, error.message);
    
    // Record validation failure for monitoring
    this.recordError('validation_failure', { 
      userId, 
      weekStart, 
      errorMessage: error.message,
      errorType: error.constructor.name
    });
    
    // Queue for retry if requested
    if (queueRetry) {
      try {
        const { backgroundIntegrityWorker } = await import('./BackgroundIntegrityWorker');
        
        backgroundIntegrityWorker.queueIntegrityCheck(userId, weekStart, 'validation', {
          priority,
          weekStartDay,
          metadata: {
            triggeredBy: 'validation_failure_recovery',
            originalError: error.message,
            timestamp: Date.now()
          }
        });
        
        console.log(`ModalErrorHandler: Queued validation retry for ${userId}, week ${weekStart}`);
        
      } catch (queueError) {
        console.error(`ModalErrorHandler: Failed to queue validation retry:`, queueError);
      }
    }
    
    // Return success indicator - validation failure shouldn't block modal display
    return {
      handled: true,
      method: 'validation_failure_ignored',
      queuedForRetry: queueRetry,
      message: 'Validation failed but modal display continued'
    };
  }

  /**
   * Handle critical data corruption - block display and show error
   */
  async handleCriticalCorruption(issues, userId, weekStart) {
    console.error(`ModalErrorHandler: Critical corruption detected for ${userId}, week ${weekStart}:`, issues);
    
    // Record critical corruption
    this.recordError('critical_corruption', { 
      userId, 
      weekStart, 
      issueCount: issues.length,
      issues: issues.map(i => ({ type: i.type, severity: i.severity, description: i.description }))
    });
    
    // Attempt to queue immediate high-priority repair
    try {
      const { backgroundIntegrityWorker } = await import('./BackgroundIntegrityWorker');
      
      const result = await backgroundIntegrityWorker.handleCriticalIssues(issues, userId, weekStart);
      
      if (result.handled) {
        console.log(`ModalErrorHandler: Critical issues handled for ${userId}, week ${weekStart}`);
        
        // Try to load data after repair
        try {
          const repairedData = await fastTimesheetLoader.fetchBasicWeekData(userId, weekStart, {
            timeout: 5000
          });
          
          return {
            recovered: true,
            method: 'critical_repair',
            data: repairedData,
            repairResult: result
          };
          
        } catch (postRepairError) {
          console.error(`ModalErrorHandler: Data still corrupted after repair attempt:`, postRepairError);
        }
      }
    } catch (repairError) {
      console.error(`ModalErrorHandler: Failed to handle critical corruption:`, repairError);
    }
    
    // If repair failed or data is still corrupted, throw error to block modal
    const corruptionError = new Error(`Critical timesheet data corruption detected for user ${userId}, week ${weekStart}`);
    corruptionError.code = 'CRITICAL_DATA_CORRUPTION';
    corruptionError.issues = issues;
    corruptionError.userId = userId;
    corruptionError.weekStart = weekStart;
    
    throw corruptionError;
  }

  /**
   * Handle network timeout with progressive fallback
   */
  async handleNetworkTimeout(userId, weekStart, originalTimeout, options = {}) {
    const { maxRetries = 2, backoffMultiplier = 1.5 } = options;
    
    console.warn(`ModalErrorHandler: Network timeout for ${userId}, week ${weekStart}, attempting recovery`);
    
    const retryKey = `${userId}-${weekStart}`;
    const currentRetries = this.retryAttempts.get(retryKey) || 0;
    
    if (currentRetries >= maxRetries) {
      console.error(`ModalErrorHandler: Max retries exceeded for ${userId}, week ${weekStart}`);
      return await this.handleMaxRetriesExceeded(userId, weekStart);
    }
    
    // Increment retry count
    this.retryAttempts.set(retryKey, currentRetries + 1);
    
    // Progressive timeout increase
    const newTimeout = Math.min(originalTimeout * Math.pow(backoffMultiplier, currentRetries), 10000);
    
    try {
      console.log(`ModalErrorHandler: Retry ${currentRetries + 1} for ${userId}, week ${weekStart} with ${newTimeout}ms timeout`);
      
      const result = await fastTimesheetLoader.fetchBasicWeekData(userId, weekStart, {
        timeout: newTimeout
      });
      
      // Clear retry count on success
      this.retryAttempts.delete(retryKey);
      
      return {
        ...result,
        recoveryMethod: 'timeout_retry',
        retryAttempt: currentRetries + 1,
        fallbackUsed: true
      };
      
    } catch (retryError) {
      if (retryError.message.includes('Timeout')) {
        // Recursive retry with increased timeout
        return await this.handleNetworkTimeout(userId, weekStart, newTimeout, options);
      } else {
        // Different error type, handle accordingly
        return await this.handleGenericError(retryError, userId, weekStart, options);
      }
    }
  }

  /**
   * Handle direct fetch failure with alternative strategies
   */
  async handleDirectFetchFailure(userId, weekStart, error, options = {}) {
    console.warn(`ModalErrorHandler: Direct fetch failed for ${userId}, week ${weekStart}, trying alternatives`);
    
    // Try to get any cached data, even if stale
    try {
      const staleCache = getCachedWeeklyData(userId, weekStart);
      if (staleCache) {
        console.log(`ModalErrorHandler: Using stale cache for ${userId}, week ${weekStart}`);
        
        return {
          ...staleCache,
          recoveryMethod: 'stale_cache',
          originalError: error.message,
          fallbackUsed: true,
          isStale: true
        };
      }
    } catch (cacheError) {
      console.warn(`ModalErrorHandler: Stale cache access failed:`, cacheError);
    }
    
    // Try to construct minimal data from user schedule
    try {
      const minimalData = await this.constructMinimalWeekData(userId, weekStart);
      
      return {
        ...minimalData,
        recoveryMethod: 'minimal_construction',
        originalError: error.message,
        fallbackUsed: true,
        isMinimal: true
      };
      
    } catch (constructionError) {
      console.error(`ModalErrorHandler: Minimal data construction failed:`, constructionError);
    }
    
    // Last resort: return empty week structure
    return this.createEmptyWeekStructure(userId, weekStart, error);
  }

  /**
   * Handle max retries exceeded
   */
  async handleMaxRetriesExceeded(userId, weekStart) {
    console.error(`ModalErrorHandler: Max retries exceeded for ${userId}, week ${weekStart}`);
    
    this.recordError('max_retries_exceeded', { userId, weekStart });
    
    // Clear retry count
    this.retryAttempts.delete(`${userId}-${weekStart}`);
    
    // Try one last fallback to any available data
    try {
      const lastResortData = await this.getLastResortData(userId, weekStart);
      if (lastResortData) {
        return {
          ...lastResortData,
          recoveryMethod: 'last_resort',
          fallbackUsed: true,
          maxRetriesExceeded: true
        };
      }
    } catch (lastResortError) {
      console.warn(`ModalErrorHandler: Last resort data fetch failed:`, lastResortError);
    }
    
    // Return empty structure with error info
    return this.createEmptyWeekStructure(userId, weekStart, new Error('Max retries exceeded'));
  }

  /**
   * Handle generic errors with appropriate strategy
   */
  async handleGenericError(error, userId, weekStart, options = {}) {
    console.warn(`ModalErrorHandler: Generic error for ${userId}, week ${weekStart}:`, error.message);
    
    this.recordError('generic_error', { 
      userId, 
      weekStart, 
      errorMessage: error.message,
      errorType: error.constructor.name
    });
    
    // Determine appropriate fallback strategy based on error type
    if (error.message.includes('timeout') || error.message.includes('Timeout')) {
      return await this.handleNetworkTimeout(userId, weekStart, 3000, options);
    }
    
    if (error.message.includes('permission') || error.message.includes('unauthorized')) {
      return await this.handlePermissionError(userId, weekStart, error);
    }
    
    if (error.message.includes('not found') || error.message.includes('404')) {
      return await this.handleNotFoundError(userId, weekStart, error);
    }
    
    // Default fallback
    return await this.handleDirectFetchFailure(userId, weekStart, error, options);
  }

  /**
   * Handle permission errors
   */
  async handlePermissionError(userId, weekStart, error) {
    console.error(`ModalErrorHandler: Permission error for ${userId}, week ${weekStart}:`, error.message);
    
    this.recordError('permission_error', { userId, weekStart, errorMessage: error.message });
    
    // Log to TimesheetErrorHandler for proper error tracking
    TimesheetErrorHandler.handleError(TIMESHEET_ERROR_CODES.UNAUTHORIZED_ACCESS, {
      userId,
      weekStart,
      operation: 'modal_loading',
      originalError: error.message
    });
    
    // Return empty structure with permission error
    const emptyStructure = this.createEmptyWeekStructure(userId, weekStart, error);
    emptyStructure.permissionError = true;
    emptyStructure.errorMessage = 'You do not have permission to view this timesheet data';
    
    return emptyStructure;
  }

  /**
   * Handle not found errors
   */
  async handleNotFoundError(userId, weekStart, error) {
    console.warn(`ModalErrorHandler: Data not found for ${userId}, week ${weekStart}:`, error.message);
    
    this.recordError('not_found_error', { userId, weekStart });
    
    // Return empty structure for new/empty weeks
    const emptyStructure = this.createEmptyWeekStructure(userId, weekStart, error);
    emptyStructure.isNewWeek = true;
    emptyStructure.errorMessage = 'No timesheet data found for this week';
    
    return emptyStructure;
  }

  /**
   * Construct minimal week data from user schedule
   */
  async constructMinimalWeekData(userId, weekStart) {
    console.log(`ModalErrorHandler: Constructing minimal data for ${userId}, week ${weekStart}`);
    
    try {
      // Try to get user's work schedule via REST
      const { data: userData } = await hrApiClient.get('/hr/employees/me');
      const companyId = userData.companyId;
      
      let schedule = {};
      if (companyId) {
        const compId = typeof companyId === 'string' ? 
          (companyId.includes('/') ? companyId.split('/')[1] : companyId) : companyId;
        
        if (compId) {
          const { data: scheduleData } = await hrApiClient.get(`/hr/companies/${compId}/schedule`);
          schedule = scheduleData.workSchedule || scheduleData || {};
        }
      }
      
      // Generate week dates
      const startDate = new Date(weekStart);
      const dates = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        dates.push(d.toISOString().slice(0, 10));
      }
      
      return {
        dates,
        entries: [], // Empty entries but with proper structure
        loadedAt: Date.now(),
        source: 'minimal_construction',
        schedule,
        isMinimal: true
      };
      
    } catch (constructionError) {
      console.error(`ModalErrorHandler: Failed to construct minimal data:`, constructionError);
      throw constructionError;
    }
  }

  /**
   * Get last resort data from any available source
   */
  async getLastResortData(userId, weekStart) {
    // Try different cache keys or related weeks
    const adjacentWeeks = this.getAdjacentWeeks(weekStart);
    
    for (const week of adjacentWeeks) {
      try {
        const adjacentData = getCachedWeeklyData(userId, week);
        if (adjacentData) {
          console.log(`ModalErrorHandler: Found adjacent week data for ${week}`);
          
          // Adapt the adjacent data structure for current week
          return {
            ...adjacentData,
            dates: this.generateWeekDates(weekStart),
            entries: [], // Clear entries as they're for different week
            adaptedFrom: week,
            isAdapted: true
          };
        }
      } catch (adjacentError) {
        console.warn(`ModalErrorHandler: Failed to get adjacent week ${week}:`, adjacentError);
      }
    }
    
    return null;
  }

  /**
   * Create empty week structure for error cases
   */
  createEmptyWeekStructure(userId, weekStart, error) {
    const dates = this.generateWeekDates(weekStart);
    
    return {
      dates,
      entries: [],
      loadedAt: Date.now(),
      loadedBy: 'ModalErrorHandler',
      error: {
        message: error.message,
        type: error.constructor.name,
        timestamp: Date.now()
      },
      isEmpty: true,
      fallbackUsed: true,
      userId,
      weekStart
    };
  }

  /**
   * Generate week dates array
   */
  generateWeekDates(weekStart) {
    const startDate = new Date(weekStart);
    const dates = [];
    
    for (let i = 0; i < 7; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      dates.push(d.toISOString().slice(0, 10));
    }
    
    return dates;
  }

  /**
   * Get adjacent weeks for fallback data
   */
  getAdjacentWeeks(weekStart) {
    const startDate = new Date(weekStart);
    const weeks = [];
    
    // Previous week
    const prevWeek = new Date(startDate);
    prevWeek.setDate(startDate.getDate() - 7);
    weeks.push(prevWeek.toISOString().slice(0, 10));
    
    // Next week
    const nextWeek = new Date(startDate);
    nextWeek.setDate(startDate.getDate() + 7);
    weeks.push(nextWeek.toISOString().slice(0, 10));
    
    return weeks;
  }

  /**
   * Record error for monitoring and metrics
   */
  recordError(errorType, metadata = {}) {
    const key = `${errorType}-${Date.now()}`;
    
    this.errorMetrics.set(key, {
      type: errorType,
      timestamp: Date.now(),
      metadata
    });
    
    // Keep only recent errors (last hour)
    const oneHourAgo = Date.now() - 3600000;
    for (const [metricKey, metric] of this.errorMetrics.entries()) {
      if (metric.timestamp < oneHourAgo) {
        this.errorMetrics.delete(metricKey);
      }
    }
  }

  /**
   * Get error statistics for monitoring
   */
  getErrorStats() {
    const stats = {};
    const recentErrors = Array.from(this.errorMetrics.values());
    
    // Count by error type
    for (const error of recentErrors) {
      stats[error.type] = (stats[error.type] || 0) + 1;
    }
    
    return {
      totalErrors: recentErrors.length,
      errorTypes: stats,
      recentErrors: recentErrors.slice(-10), // Last 10 errors
      activeRetries: this.retryAttempts.size
    };
  }

  /**
   * Clear error metrics and retry attempts
   */
  clearMetrics() {
    this.errorMetrics.clear();
    this.retryAttempts.clear();
  }

  /**
   * Initialize fallback strategies
   */
  initializeFallbackStrategies() {
    this.fallbackStrategies.set('cache_failure', this.handleCacheFailure.bind(this));
    this.fallbackStrategies.set('validation_failure', this.handleValidationFailure.bind(this));
    this.fallbackStrategies.set('critical_corruption', this.handleCriticalCorruption.bind(this));
    this.fallbackStrategies.set('network_timeout', this.handleNetworkTimeout.bind(this));
    this.fallbackStrategies.set('permission_error', this.handlePermissionError.bind(this));
    this.fallbackStrategies.set('not_found_error', this.handleNotFoundError.bind(this));
  }
}

// Export singleton instance
export const modalErrorHandler = new ModalErrorHandler();
export default ModalErrorHandler;