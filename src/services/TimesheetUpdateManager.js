// TimesheetUpdateManager - Central service for coordinating real-time timesheet updates
import eventBus, { TIMESHEET_EVENTS } from './EventBus';
import optimisticUpdateManager from './OptimisticUpdateManager';
import { invalidateTimesheetCache } from './timesheetCache';
import { saveWeekEdits } from './timesheets';
import { measureAsync } from '../hooks/usePerformanceMonitor';
import timesheetUpdateErrorHandler from './TimesheetUpdateErrorHandler';
import { formatTimeForDisplay, createDateTimeFromStrings, calculateDuration } from '../utils/timeFormatUtils';

class TimesheetUpdateManager {
  constructor() {
    this.subscribers = new Map();
    this.updateQueue = [];
    this.isProcessingQueue = false;
    this.batchTimeout = 500; // 500ms batch window
    this.maxRetries = 3;
    this.debugMode = process.env.NODE_ENV === 'development';

    // Bind methods to preserve context
    this.processUpdateQueue = this.processUpdateQueue.bind(this);
  }

  /**
   * Update timesheet data with real-time synchronization
   * @param {string} userId - User ID
   * @param {string} weekStart - Week start date (ISO string)
   * @param {Array} dayEdits - Array of day edit objects
   * @param {Object} options - Update options
   */
  async updateTimesheet(userId, weekStart, dayEdits, options = {}) {
    const updateId = `${userId}_${weekStart}_${Date.now()}`;
    const {
      optimistic = true,
      batchUpdates = true,
      invalidateCache = true,
      broadcastEvents = true
    } = options;

    try {
      if (this.debugMode) {
        console.log(`[TimesheetUpdateManager] Starting update: ${updateId}`, {
          userId,
          weekStart,
          dayEdits,
          options
        });
      }

      // 1. Apply optimistic updates if enabled
      if (optimistic) {
        await this.applyOptimisticUpdate(updateId, {
          userId,
          weekStart,
          dayEdits,
          type: 'timesheet_edit'
        });
      }

      // 2. Invalidate relevant caches immediately
      if (invalidateCache) {
        this.invalidateRelevantCaches(userId, weekStart);
      }

      // 3. Queue or immediately process database update
      const updatePromise = batchUpdates
        ? this.queueUpdate(updateId, userId, weekStart, dayEdits, options)
        : this.processUpdate(updateId, userId, weekStart, dayEdits, options);

      // 4. Handle update result
      const result = await updatePromise;

      // 5. Confirm optimistic update on success
      if (optimistic && result.success) {
        optimisticUpdateManager.confirmUpdate(updateId, result.data);
      } else if (optimistic && !result.success) {
        optimisticUpdateManager.rollbackUpdate(updateId, 'database_error', result.error);
      }

      // 6. Broadcast events if enabled
      if (broadcastEvents) {
        this.broadcastUpdateEvents(updateId, userId, weekStart, dayEdits, result);
      }

      return {
        success: result.success,
        updateId,
        data: result.data,
        error: result.error,
        optimistic
      };

    } catch (error) {
      console.error(`[TimesheetUpdateManager] Update failed: ${updateId}`, error);

      // Use comprehensive error handling
      const errorResult = timesheetUpdateErrorHandler.handleError(error, {
        updateId,
        userId,
        weekStart,
        dayEdits,
        operation: 'updateTimesheet',
        originalOperation: () => this.updateTimesheet(userId, weekStart, dayEdits, options)
      }, {
        throwError: false,
        showToast: true,
        attemptRecovery: true
      });

      // Rollback optimistic update if not handled by error handler
      if (optimistic && !errorResult.recovered) {
        optimisticUpdateManager.rollbackUpdate(updateId, 'system_error', error);
      }

      return {
        success: false,
        updateId,
        error: error.message || 'Unknown error occurred',
        optimistic,
        errorHandling: errorResult
      };
    }
  }

  /**
   * Apply optimistic update for immediate UI feedback
   */
  async applyOptimisticUpdate(updateId, updateData) {
    try {
      // Calculate display values for optimistic update
      const optimisticDisplayData = this.calculateOptimisticDisplayData(updateData);

      // Apply optimistic update
      optimisticUpdateManager.applyOptimisticUpdate(
        updateId,
        {
          ...updateData,
          displayData: optimisticDisplayData
        },
        {
          // Store rollback data if needed
          originalData: updateData
        }
      );

      if (this.debugMode) {
        console.log(`[TimesheetUpdateManager] Applied optimistic update: ${updateId}`, optimisticDisplayData);
      }

    } catch (error) {
      console.error('[TimesheetUpdateManager] Failed to apply optimistic update:', error);
      throw error;
    }
  }

  /**
   * Calculate display data for optimistic updates
   */
  calculateOptimisticDisplayData(updateData) {
    const { dayEdits } = updateData;
    let totalEffectiveSec = 0;
    let totalOvertimeSec = 0;

    const processedEdits = dayEdits.map(edit => {
      const { clockIn, clockOut, breakMin = 0 } = edit;

      if (clockIn && clockOut) {
        try {
          // Use utility function to calculate duration
          const grossSec = calculateDuration(clockIn, clockOut, edit.date);
          const breakSec = Math.max(0, (Number(breakMin) || 0) * 60);
          const effectiveSec = Math.max(0, grossSec - breakSec);

          // Simple overtime calculation
          const standardWorkSec = updateData.standardWorkSec || (8 * 60 * 60);
          const overtimeSec = Math.max(0, effectiveSec - standardWorkSec);

          totalEffectiveSec += effectiveSec;
          totalOvertimeSec += overtimeSec;

          return {
            ...edit,
            grossSec,
            effectiveSec,
            overtimeSec,
            displayHours: this.formatSeconds(effectiveSec),
            displayOvertime: this.formatSeconds(overtimeSec),
            // Format times for consistent display
            clockIn: formatTimeForDisplay(clockIn),
            clockOut: formatTimeForDisplay(clockOut)
          };
        } catch (error) {
          console.warn('Error calculating optimistic display data for edit:', edit, error);
          return edit;
        }
      }

      return edit;
    });

    return {
      dayEdits: processedEdits,
      weekTotals: {
        effectiveSec: totalEffectiveSec,
        overtimeSec: totalOvertimeSec,
        displayHours: this.formatSeconds(totalEffectiveSec),
        displayOvertime: this.formatSeconds(totalOvertimeSec)
      }
    };
  }

  /**
   * Format seconds to readable time format
   */
  formatSeconds(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
  }

  /**
   * Queue update for batch processing
   */
  async queueUpdate(updateId, userId, weekStart, dayEdits, options) {
    return new Promise((resolve, reject) => {
      this.updateQueue.push({
        updateId,
        userId,
        weekStart,
        dayEdits,
        options,
        resolve,
        reject,
        timestamp: Date.now()
      });

      // Start processing queue if not already processing
      if (!this.isProcessingQueue) {
        setTimeout(this.processUpdateQueue, this.batchTimeout);
      }
    });
  }

  /**
   * Process queued updates in batches
   */
  async processUpdateQueue() {
    if (this.updateQueue.length === 0 || this.isProcessingQueue) {
      return;
    }

    this.isProcessingQueue = true;

    try {
      // Group updates by user and week for batching
      const updateGroups = this.groupUpdatesByUserWeek(this.updateQueue);
      this.updateQueue = [];

      // Process each group
      for (const group of updateGroups) {
        await this.processBatchedUpdates(group);
      }

    } catch (error) {
      console.error('[TimesheetUpdateManager] Error processing update queue:', error);
    } finally {
      this.isProcessingQueue = false;

      // Process any new updates that arrived while processing
      if (this.updateQueue.length > 0) {
        setTimeout(this.processUpdateQueue, this.batchTimeout);
      }
    }
  }

  /**
   * Group updates by user and week for efficient batching
   */
  groupUpdatesByUserWeek(updates) {
    const groups = new Map();

    updates.forEach(update => {
      const key = `${update.userId}_${update.weekStart}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(update);
    });

    return Array.from(groups.values());
  }

  /**
   * Process a batch of updates for the same user/week
   */
  async processBatchedUpdates(updateGroup) {
    if (updateGroup.length === 0) return;

    const { userId, weekStart } = updateGroup[0];

    try {
      // Merge all day edits from the batch
      const mergedDayEdits = this.mergeDayEdits(updateGroup);

      // Process the merged update
      const result = await this.processUpdate(
        `batch_${userId}_${weekStart}_${Date.now()}`,
        userId,
        weekStart,
        mergedDayEdits,
        updateGroup[0].options
      );

      // Resolve all promises in the batch
      updateGroup.forEach(update => {
        update.resolve(result);
      });

    } catch (error) {
      // Reject all promises in the batch
      updateGroup.forEach(update => {
        update.reject(error);
      });
    }
  }

  /**
   * Merge day edits from multiple updates
   */
  mergeDayEdits(updateGroup) {
    const mergedEdits = new Map();

    updateGroup.forEach(update => {
      update.dayEdits.forEach(edit => {
        // Later edits override earlier ones for the same date
        mergedEdits.set(edit.date, edit);
      });
    });

    return Array.from(mergedEdits.values());
  }

  /**
   * Process individual update (database operation)
   */
  async processUpdate(updateId, userId, weekStart, dayEdits, options, retryCount = 0) {
    try {
      const result = await measureAsync(`timesheet-update-${updateId}`, async () => {
        return await saveWeekEdits(userId, weekStart, dayEdits, options);
      });

      if (this.debugMode) {
        console.log(`[TimesheetUpdateManager] Update successful: ${updateId}`, result);
      }

      return {
        success: true,
        data: result,
        retryCount
      };

    } catch (error) {
      console.error(`[TimesheetUpdateManager] Update failed: ${updateId}`, error);

      // Retry logic
      if (retryCount < this.maxRetries && this.shouldRetry(error)) {
        const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);

        if (this.debugMode) {
          console.log(`[TimesheetUpdateManager] Retrying update ${updateId} in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
        }

        await new Promise(resolve => setTimeout(resolve, delay));
        return this.processUpdate(updateId, userId, weekStart, dayEdits, options, retryCount + 1);
      }

      // Use error handler for database errors
      const errorResult = timesheetUpdateErrorHandler.handleError(error, {
        updateId,
        userId,
        weekStart,
        dayEdits,
        operation: 'processUpdate',
        retryCount,
        originalOperation: () => this.processUpdate(updateId, userId, weekStart, dayEdits, options, 0)
      }, {
        throwError: false,
        showToast: retryCount >= this.maxRetries, // Only show toast on final failure
        attemptRecovery: retryCount < this.maxRetries
      });

      return {
        success: false,
        error: error.message || 'Database update failed',
        retryCount,
        errorHandling: errorResult
      };
    }
  }

  /**
   * Determine if an error should trigger a retry
   */
  shouldRetry(error) {
    const retryableErrors = [
      'network',
      'timeout',
      'unavailable',
      'internal',
      'temporary'
    ];

    const errorMessage = (error.message || '').toLowerCase();
    const errorCode = (error.code || '').toLowerCase();

    return retryableErrors.some(retryable =>
      errorMessage.includes(retryable) || errorCode.includes(retryable)
    );
  }

  /**
   * Invalidate relevant caches for the update
   */
  invalidateRelevantCaches(userId, weekStart) {
    try {
      // Invalidate timesheet caches
      invalidateTimesheetCache(userId, weekStart);

      if (this.debugMode) {
        console.log(`[TimesheetUpdateManager] Invalidated caches for user ${userId}, week ${weekStart}`);
      }

    } catch (error) {
      console.error('[TimesheetUpdateManager] Failed to invalidate caches:', error);
    }
  }

  /**
   * Broadcast update events to subscribers
   */
  broadcastUpdateEvents(updateId, userId, weekStart, dayEdits, result) {
    try {
      const eventData = {
        updateId,
        userId,
        weekStart,
        dayEdits,
        success: result.success,
        timestamp: Date.now()
      };

      if (result.success) {
        eventBus.emit(TIMESHEET_EVENTS.DATA_UPDATED, {
          ...eventData,
          data: result.data
        });
      } else {
        eventBus.emit(TIMESHEET_EVENTS.EDIT_FAILED, {
          ...eventData,
          error: result.error
        });
      }

    } catch (error) {
      console.error('[TimesheetUpdateManager] Failed to broadcast events:', error);
    }
  }

  /**
   * Subscribe to timesheet updates
   */
  subscribeToUpdates(componentId, callback) {
    const unsubscribeFunctions = [
      eventBus.on(TIMESHEET_EVENTS.DATA_UPDATED, callback, componentId),
      eventBus.on(TIMESHEET_EVENTS.EDIT_UPDATED, callback, componentId),
      eventBus.on(TIMESHEET_EVENTS.EDIT_SAVED, callback, componentId),
      eventBus.on(TIMESHEET_EVENTS.EDIT_FAILED, callback, componentId)
    ];

    // Store subscription for cleanup
    this.subscribers.set(componentId, unsubscribeFunctions);

    // Return combined unsubscribe function
    return () => {
      unsubscribeFunctions.forEach(unsubscribe => unsubscribe());
      this.subscribers.delete(componentId);
    };
  }

  /**
   * Unsubscribe from updates
   */
  unsubscribeFromUpdates(componentId) {
    const unsubscribeFunctions = this.subscribers.get(componentId);
    if (unsubscribeFunctions) {
      unsubscribeFunctions.forEach(unsubscribe => unsubscribe());
      this.subscribers.delete(componentId);
    }
  }

  /**
   * Get manager statistics
   */
  getStats() {
    return {
      subscribers: this.subscribers.size,
      queueLength: this.updateQueue.length,
      isProcessingQueue: this.isProcessingQueue,
      optimisticUpdates: optimisticUpdateManager.getStats(),
      eventBus: eventBus.getStats()
    };
  }

  /**
   * Clear all data (useful for testing)
   */
  clear() {
    this.updateQueue = [];
    this.isProcessingQueue = false;
    this.subscribers.clear();
    optimisticUpdateManager.clear();
  }
}

// Create and export singleton instance
const timesheetUpdateManager = new TimesheetUpdateManager();

export default timesheetUpdateManager;
export { TimesheetUpdateManager };