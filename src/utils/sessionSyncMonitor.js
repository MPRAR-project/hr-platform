// Session Synchronization Monitoring and Logging Utilities

class SessionSyncMonitor {
  constructor() {
    this.syncAttempts = new Map();
    this.failureCount = 0;
    this.successCount = 0;
  }

  /**
   * Log session synchronization attempt
   * @param {string} userId - User ID
   * @param {string} date - Date being synchronized
   * @param {string} operation - 'create' or 'update'
   * @param {Object} sessionData - Session data being synchronized
   */
  logSyncAttempt(userId, date, operation, sessionData) {
    const attemptId = `${userId}_${date}_${Date.now()}`;
    const attempt = {
      id: attemptId,
      userId,
      date,
      operation,
      sessionData: {
        clockIn: sessionData.clockIn,
        clockOut: sessionData.clockOut,
        breakMin: sessionData.breakMin,
        grossSec: sessionData.grossSec,
        effectiveSec: sessionData.effectiveSec
      },
      timestamp: new Date().toISOString(),
      status: 'pending'
    };

    this.syncAttempts.set(attemptId, attempt);
    
    console.log(`[SessionSyncMonitor] Starting sync attempt ${attemptId}:`, {
      userId,
      date,
      operation,
      clockIn: sessionData.clockIn,
      clockOut: sessionData.clockOut
    });

    return attemptId;
  }

  /**
   * Log successful session synchronization
   * @param {string} attemptId - Attempt ID from logSyncAttempt
   * @param {string} sessionId - Created/updated session ID
   * @param {Object} result - Synchronization result
   */
  logSyncSuccess(attemptId, sessionId, result) {
    const attempt = this.syncAttempts.get(attemptId);
    if (attempt) {
      attempt.status = 'success';
      attempt.sessionId = sessionId;
      attempt.completedAt = new Date().toISOString();
      attempt.result = result;
      
      this.successCount++;
      
      console.log(`[SessionSyncMonitor] Sync success ${attemptId}:`, {
        sessionId,
        operation: attempt.operation,
        duration: new Date(attempt.completedAt) - new Date(attempt.timestamp),
        result
      });

      // Clean up old attempts after success
      this.cleanupOldAttempts();
    }
  }

  /**
   * Log failed session synchronization
   * @param {string} attemptId - Attempt ID from logSyncAttempt
   * @param {Error} error - Error that occurred
   * @param {Object} context - Additional context
   */
  logSyncFailure(attemptId, error, context = {}) {
    const attempt = this.syncAttempts.get(attemptId);
    if (attempt) {
      attempt.status = 'failed';
      attempt.error = {
        message: error.message,
        stack: error.stack,
        code: error.code
      };
      attempt.context = context;
      attempt.completedAt = new Date().toISOString();
      
      this.failureCount++;
      
      console.error(`[SessionSyncMonitor] Sync failure ${attemptId}:`, {
        userId: attempt.userId,
        date: attempt.date,
        operation: attempt.operation,
        error: error.message,
        context,
        duration: new Date(attempt.completedAt) - new Date(attempt.timestamp)
      });

      // Alert on high failure rate
      this.checkFailureRate();
    }
  }

  /**
   * Log time format conversion issues
   * @param {string} originalTime - Original time string
   * @param {string} convertedTime - Converted time string
   * @param {string} operation - Conversion operation
   * @param {Error} error - Error if conversion failed
   */
  logTimeFormatIssue(originalTime, convertedTime, operation, error = null) {
    const logData = {
      originalTime,
      convertedTime,
      operation,
      timestamp: new Date().toISOString()
    };

    if (error) {
      logData.error = {
        message: error.message,
        stack: error.stack
      };
      console.error('[SessionSyncMonitor] Time format conversion failed:', logData);
    } else {
      // Log successful conversions for monitoring
      console.log('[SessionSyncMonitor] Time format conversion:', logData);
    }

    // Special monitoring for the specific issue: 02:52PM -> 02:52AM
    if (originalTime && originalTime.includes('PM') && convertedTime && convertedTime.includes('AM')) {
      console.error('[SessionSyncMonitor] CRITICAL: PM to AM conversion detected!', {
        originalTime,
        convertedTime,
        operation,
        timestamp: new Date().toISOString()
      });
      
      // This should trigger an alert in production
      this.alertCriticalTimeFormatIssue(originalTime, convertedTime);
    }
  }

  /**
   * Log data consistency issues between timesheet and session
   * @param {string} userId - User ID
   * @param {string} date - Date
   * @param {Object} timesheetData - Timesheet entry data
   * @param {Object} sessionData - Session data
   */
  logDataInconsistency(userId, date, timesheetData, sessionData) {
    const inconsistency = {
      userId,
      date,
      timestamp: new Date().toISOString(),
      timesheet: {
        grossSec: timesheetData.grossSec,
        effectiveSec: timesheetData.effectiveSec,
        overtimeSec: timesheetData.overtimeSec
      },
      session: {
        durationGrossSec: sessionData.durationGrossSec,
        durationEffectiveSec: sessionData.durationEffectiveSec,
        breakSec: sessionData.breakSec
      }
    };

    // Calculate discrepancies
    const grossDiscrepancy = Math.abs((timesheetData.grossSec || 0) - (sessionData.durationGrossSec || 0));
    const effectiveDiscrepancy = Math.abs((timesheetData.effectiveSec || 0) - (sessionData.durationEffectiveSec || 0));

    if (grossDiscrepancy > 60 || effectiveDiscrepancy > 60) { // More than 1 minute difference
      console.error('[SessionSyncMonitor] Data inconsistency detected:', {
        ...inconsistency,
        discrepancies: {
          grossSec: grossDiscrepancy,
          effectiveSec: effectiveDiscrepancy
        }
      });
    } else {
      console.log('[SessionSyncMonitor] Data consistency verified:', inconsistency);
    }
  }

  /**
   * Get synchronization statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    const totalAttempts = this.successCount + this.failureCount;
    const successRate = totalAttempts > 0 ? (this.successCount / totalAttempts) * 100 : 0;
    
    return {
      totalAttempts,
      successCount: this.successCount,
      failureCount: this.failureCount,
      successRate: Math.round(successRate * 100) / 100,
      pendingAttempts: Array.from(this.syncAttempts.values()).filter(a => a.status === 'pending').length,
      recentFailures: this.getRecentFailures()
    };
  }

  /**
   * Get recent failures for debugging
   * @param {number} limit - Number of recent failures to return
   * @returns {Array} Recent failure attempts
   */
  getRecentFailures(limit = 10) {
    return Array.from(this.syncAttempts.values())
      .filter(attempt => attempt.status === 'failed')
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
  }

  /**
   * Check failure rate and alert if too high
   */
  checkFailureRate() {
    const stats = this.getStats();
    
    if (stats.totalAttempts >= 10 && stats.successRate < 80) {
      console.error('[SessionSyncMonitor] HIGH FAILURE RATE ALERT:', {
        successRate: stats.successRate,
        totalAttempts: stats.totalAttempts,
        recentFailures: stats.recentFailures.slice(0, 3)
      });
    }
  }

  /**
   * Alert for critical time format issues
   * @param {string} originalTime - Original time
   * @param {string} convertedTime - Incorrectly converted time
   */
  alertCriticalTimeFormatIssue(originalTime, convertedTime) {
    // In production, this would send alerts to monitoring systems
    console.error('[SessionSyncMonitor] CRITICAL ALERT: Time format conversion error', {
      originalTime,
      convertedTime,
      message: 'PM time incorrectly converted to AM',
      timestamp: new Date().toISOString(),
      severity: 'CRITICAL'
    });
  }

  /**
   * Clean up old sync attempts to prevent memory leaks
   */
  cleanupOldAttempts() {
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
    
    for (const [attemptId, attempt] of this.syncAttempts.entries()) {
      if (new Date(attempt.timestamp) < cutoffTime) {
        this.syncAttempts.delete(attemptId);
      }
    }
  }

  /**
   * Generate debugging report
   * @returns {Object} Comprehensive debugging report
   */
  generateDebugReport() {
    const stats = this.getStats();
    const recentAttempts = Array.from(this.syncAttempts.values())
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 20);

    return {
      timestamp: new Date().toISOString(),
      statistics: stats,
      recentAttempts: recentAttempts.map(attempt => ({
        id: attempt.id,
        userId: attempt.userId,
        date: attempt.date,
        operation: attempt.operation,
        status: attempt.status,
        timestamp: attempt.timestamp,
        completedAt: attempt.completedAt,
        error: attempt.error?.message,
        sessionId: attempt.sessionId
      })),
      systemInfo: {
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A',
        timestamp: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      }
    };
  }

  /**
   * Reset statistics (useful for testing)
   */
  reset() {
    this.syncAttempts.clear();
    this.failureCount = 0;
    this.successCount = 0;
  }
}

// Create singleton instance
const sessionSyncMonitor = new SessionSyncMonitor();

export default sessionSyncMonitor;