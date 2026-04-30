/**
 * Comprehensive logging and monitoring utilities for dashboard operations
 */

/**
 * Log levels for different types of messages
 */
export const LOG_LEVELS = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  CRITICAL: 'CRITICAL'
};

/**
 * Creates a structured log entry
 */
function createLogEntry(level, message, context = {}, error = null) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    context,
    sessionId: getSessionId(),
    userId: getCurrentUserId(),
    url: window.location.href,
    userAgent: navigator.userAgent
  };

  if (error) {
    entry.error = {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: error.code
    };
  }

  return entry;
}

/**
 * Gets or creates a session ID for tracking user sessions
 */
function getSessionId() {
  let sessionId = sessionStorage.getItem('dashboard_session_id');
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    sessionStorage.setItem('dashboard_session_id', sessionId);
  }
  return sessionId;
}

/**
 * Gets current user ID from auth context (if available)
 */
function getCurrentUserId() {
  try {
    // Try to get user ID from various possible sources
    const authUser = window.__DASHBOARD_USER__;
    if (authUser?.userId) return authUser.userId;
    
    // Fallback to localStorage or other sources
    const storedUser = localStorage.getItem('dashboard_user');
    if (storedUser) {
      const parsed = JSON.parse(storedUser);
      return parsed.userId || 'unknown';
    }
    
    return 'anonymous';
  } catch (error) {
    return 'unknown';
  }
}

/**
 * Dashboard-specific logger with structured logging
 */
export class DashboardLogger {
  constructor(component = 'Dashboard') {
    this.component = component;
    this.logs = [];
    this.maxLogs = 1000; // Keep last 1000 logs in memory
  }

  /**
   * Logs a message with the specified level
   */
  log(level, message, context = {}, error = null) {
    const entry = createLogEntry(level, message, { 
      ...context, 
      component: this.component 
    }, error);

    // Add to in-memory logs
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift(); // Remove oldest log
    }

    // Console logging with appropriate level
    this.logToConsole(entry);

    // Send to external logging service if configured
    this.sendToExternalLogger(entry);

    return entry;
  }

  /**
   * Logs to browser console with appropriate styling
   */
  logToConsole(entry) {
    const { level, message, context, error } = entry;
    const prefix = `[${entry.timestamp}] [${this.component}]`;
    
    switch (level) {
      case LOG_LEVELS.DEBUG:
        console.debug(`${prefix} ${message}`, context, error);
        break;
      case LOG_LEVELS.INFO:
        console.info(`${prefix} ${message}`, context);
        break;
      case LOG_LEVELS.WARN:
        console.warn(`${prefix} ${message}`, context, error);
        break;
      case LOG_LEVELS.ERROR:
        console.error(`${prefix} ${message}`, context, error);
        break;
      case LOG_LEVELS.CRITICAL:
        console.error(`🚨 ${prefix} CRITICAL: ${message}`, context, error);
        break;
      default:
        console.log(`${prefix} ${message}`, context);
    }
  }

  /**
   * Sends logs to external logging service (placeholder for future implementation)
   */
  sendToExternalLogger(entry) {
    // TODO: Implement external logging service integration
    // This could send to services like LogRocket, Sentry, or custom analytics
    
    // For now, only log critical errors to external service
    if (entry.level === LOG_LEVELS.CRITICAL) {
      try {
        // Example: Send to analytics or error tracking service
        // analytics.track('critical_error', entry);
      } catch (error) {
        console.warn('Failed to send log to external service:', error);
      }
    }
  }

  // Convenience methods for different log levels
  debug(message, context = {}) {
    return this.log(LOG_LEVELS.DEBUG, message, context);
  }

  info(message, context = {}) {
    return this.log(LOG_LEVELS.INFO, message, context);
  }

  warn(message, context = {}, error = null) {
    return this.log(LOG_LEVELS.WARN, message, context, error);
  }

  error(message, context = {}, error = null) {
    return this.log(LOG_LEVELS.ERROR, message, context, error);
  }

  critical(message, context = {}, error = null) {
    return this.log(LOG_LEVELS.CRITICAL, message, context, error);
  }

  /**
   * Gets recent logs for debugging
   */
  getRecentLogs(count = 50) {
    return this.logs.slice(-count);
  }

  /**
   * Gets logs filtered by level
   */
  getLogsByLevel(level) {
    return this.logs.filter(log => log.level === level);
  }

  /**
   * Clears in-memory logs
   */
  clearLogs() {
    const count = this.logs.length;
    this.logs = [];
    this.info(`Cleared ${count} logs from memory`);
  }

  /**
   * Gets logging statistics
   */
  getStats() {
    const stats = {
      totalLogs: this.logs.length,
      byLevel: {}
    };

    Object.values(LOG_LEVELS).forEach(level => {
      stats.byLevel[level] = this.logs.filter(log => log.level === level).length;
    });

    return stats;
  }
}

/**
 * Performance monitoring utilities
 */
export class PerformanceMonitor {
  constructor(logger) {
    this.logger = logger;
    this.timers = new Map();
    this.metrics = [];
  }

  /**
   * Starts a performance timer
   */
  startTimer(name, context = {}) {
    const startTime = performance.now();
    this.timers.set(name, { startTime, context });
    
    this.logger.debug(`Performance timer started: ${name}`, context);
    return name;
  }

  /**
   * Ends a performance timer and logs the duration
   */
  endTimer(name) {
    const timer = this.timers.get(name);
    if (!timer) {
      this.logger.warn(`Performance timer not found: ${name}`);
      return null;
    }

    const endTime = performance.now();
    const duration = endTime - timer.startTime;
    
    const metric = {
      name,
      duration,
      startTime: timer.startTime,
      endTime,
      context: timer.context,
      timestamp: new Date().toISOString()
    };

    this.metrics.push(metric);
    this.timers.delete(name);

    // Log performance metric
    const level = duration > 5000 ? LOG_LEVELS.WARN : LOG_LEVELS.INFO;
    this.logger.log(level, `Performance: ${name} completed in ${duration.toFixed(2)}ms`, {
      duration,
      ...timer.context
    });

    return metric;
  }

  /**
   * Measures an async operation
   */
  async measureAsync(name, operation, context = {}) {
    this.startTimer(name, context);
    try {
      const result = await operation();
      this.endTimer(name);
      return result;
    } catch (error) {
      this.endTimer(name);
      this.logger.error(`Performance: ${name} failed`, { ...context, error });
      throw error;
    }
  }

  /**
   * Gets performance metrics
   */
  getMetrics(count = 100) {
    return this.metrics.slice(-count);
  }

  /**
   * Gets performance statistics
   */
  getStats() {
    if (this.metrics.length === 0) {
      return { count: 0, averageDuration: 0, slowestOperation: null };
    }

    const durations = this.metrics.map(m => m.duration);
    const averageDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
    const slowestOperation = this.metrics.reduce((prev, current) => 
      prev.duration > current.duration ? prev : current
    );

    return {
      count: this.metrics.length,
      averageDuration: averageDuration.toFixed(2),
      slowestOperation: {
        name: slowestOperation.name,
        duration: slowestOperation.duration.toFixed(2)
      }
    };
  }
}

/**
 * User action tracking for debugging user flows
 */
export class UserActionTracker {
  constructor(logger) {
    this.logger = logger;
    this.actions = [];
    this.maxActions = 500;
  }

  /**
   * Tracks a user action
   */
  trackAction(action, details = {}) {
    const actionEntry = {
      action,
      details,
      timestamp: new Date().toISOString(),
      url: window.location.href,
      sessionId: getSessionId()
    };

    this.actions.push(actionEntry);
    if (this.actions.length > this.maxActions) {
      this.actions.shift();
    }

    this.logger.debug(`User action: ${action}`, details);
    return actionEntry;
  }

  /**
   * Gets recent user actions
   */
  getRecentActions(count = 50) {
    return this.actions.slice(-count);
  }

  /**
   * Gets actions for current session
   */
  getSessionActions() {
    const currentSessionId = getSessionId();
    return this.actions.filter(action => action.sessionId === currentSessionId);
  }
}

// Create default instances
export const dashboardLogger = new DashboardLogger('Dashboard');
export const performanceMonitor = new PerformanceMonitor(dashboardLogger);
export const userActionTracker = new UserActionTracker(dashboardLogger);

// Export convenience functions
export const logInfo = (message, context) => dashboardLogger.info(message, context);
export const logWarn = (message, context, error) => dashboardLogger.warn(message, context, error);
export const logError = (message, context, error) => dashboardLogger.error(message, context, error);
export const logCritical = (message, context, error) => dashboardLogger.critical(message, context, error);

export const measurePerformance = (name, operation, context) => 
  performanceMonitor.measureAsync(name, operation, context);

export const trackUserAction = (action, details) => 
  userActionTracker.trackAction(action, details);

// Make logger available globally for debugging
if (typeof window !== 'undefined') {
  window.__DASHBOARD_LOGGER__ = {
    logger: dashboardLogger,
    performance: performanceMonitor,
    userActions: userActionTracker,
    getLogs: () => dashboardLogger.getRecentLogs(),
    getStats: () => ({
      logs: dashboardLogger.getStats(),
      performance: performanceMonitor.getStats(),
      actions: userActionTracker.getRecentActions(10)
    })
  };
}