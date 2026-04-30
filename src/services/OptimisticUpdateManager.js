// OptimisticUpdateManager for managing temporary UI updates before database confirmation
import eventBus, { TIMESHEET_EVENTS } from './EventBus';

class OptimisticUpdateManager {
  constructor() {
    this.pendingUpdates = new Map();
    this.rollbackQueue = [];
    this.maxPendingUpdates = 50; // Prevent memory leaks
    this.updateTimeout = 60000; // 60 seconds timeout for updates
    this.debugMode = process.env.NODE_ENV === 'development';

    // Auto-cleanup old updates
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredUpdates();
    }, 10000); // Check every 10 seconds
  }

  /**
   * Apply an optimistic update immediately to the UI
   * @param {string} updateId - Unique identifier for the update
   * @param {Object} update - The update data
   * @param {Object} rollbackData - Data needed to rollback the update
   */
  applyOptimisticUpdate(updateId, update, rollbackData = null) {
    try {
      if (this.pendingUpdates.size >= this.maxPendingUpdates) {
        console.warn('[OptimisticUpdateManager] Max pending updates reached, cleaning up old ones');
        this.cleanupOldestUpdates(10);
      }

      const optimisticUpdate = {
        id: updateId,
        update,
        rollbackData,
        timestamp: Date.now(),
        status: 'pending',
        retryCount: 0
      };

      this.pendingUpdates.set(updateId, optimisticUpdate);

      if (this.debugMode) {
        console.log(`[OptimisticUpdateManager] Applied optimistic update: ${updateId}`, update);
      }

      // Emit event for components to update their UI
      eventBus.emit(TIMESHEET_EVENTS.EDIT_UPDATED, {
        updateId,
        update,
        optimistic: true,
        timestamp: Date.now()
      });

      // Set timeout for automatic rollback if not confirmed
      setTimeout(() => {
        if (this.pendingUpdates.has(updateId)) {
          const pendingUpdate = this.pendingUpdates.get(updateId);
          if (pendingUpdate.status === 'pending') {
            console.warn(`[OptimisticUpdateManager] Update ${updateId} timed out, rolling back`);
            this.rollbackUpdate(updateId, 'timeout');
          }
        }
      }, this.updateTimeout);

      return true;
    } catch (error) {
      console.error('[OptimisticUpdateManager] Failed to apply optimistic update:', error);
      return false;
    }
  }

  /**
   * Confirm an optimistic update when database operation succeeds
   * @param {string} updateId - The update identifier
   * @param {Object} confirmedData - The confirmed data from the database
   */
  confirmUpdate(updateId, confirmedData = null) {
    try {
      const pendingUpdate = this.pendingUpdates.get(updateId);
      if (!pendingUpdate) {
        if (this.debugMode) {
          console.log(`[OptimisticUpdateManager] Update ${updateId} not found for confirmation`);
        }
        return false;
      }

      pendingUpdate.status = 'confirmed';
      pendingUpdate.confirmedData = confirmedData;
      pendingUpdate.confirmedAt = Date.now();

      if (this.debugMode) {
        console.log(`[OptimisticUpdateManager] Confirmed update: ${updateId}`, confirmedData);
      }

      // Emit confirmation event
      eventBus.emit(TIMESHEET_EVENTS.EDIT_SAVED, {
        updateId,
        originalUpdate: pendingUpdate.update,
        confirmedData,
        optimistic: false,
        timestamp: Date.now()
      });

      // Remove from pending updates after a short delay to allow components to process
      setTimeout(() => {
        this.pendingUpdates.delete(updateId);
      }, 1000);

      return true;
    } catch (error) {
      console.error('[OptimisticUpdateManager] Failed to confirm update:', error);
      return false;
    }
  }

  /**
   * Rollback an optimistic update when database operation fails
   * @param {string} updateId - The update identifier
   * @param {string} reason - Reason for rollback
   * @param {Object} errorData - Error information
   */
  rollbackUpdate(updateId, reason = 'error', errorData = null) {
    try {
      const pendingUpdate = this.pendingUpdates.get(updateId);
      if (!pendingUpdate) {
        if (this.debugMode) {
          console.log(`[OptimisticUpdateManager] Update ${updateId} not found for rollback`);
        }
        return false;
      }

      pendingUpdate.status = 'rolled_back';
      pendingUpdate.rollbackReason = reason;
      pendingUpdate.rollbackAt = Date.now();

      // Add to rollback queue for potential retry
      this.rollbackQueue.push({
        updateId,
        originalUpdate: pendingUpdate.update,
        rollbackData: pendingUpdate.rollbackData,
        reason,
        errorData,
        timestamp: Date.now()
      });

      if (this.debugMode) {
        console.log(`[OptimisticUpdateManager] Rolled back update: ${updateId}, reason: ${reason}`, errorData);
      }

      // Emit rollback event
      eventBus.emit(TIMESHEET_EVENTS.EDIT_FAILED, {
        updateId,
        originalUpdate: pendingUpdate.update,
        rollbackData: pendingUpdate.rollbackData,
        reason,
        errorData,
        timestamp: Date.now()
      });

      // Remove from pending updates
      this.pendingUpdates.delete(updateId);

      return true;
    } catch (error) {
      console.error('[OptimisticUpdateManager] Failed to rollback update:', error);
      return false;
    }
  }

  /**
   * Get the current status of an optimistic update
   * @param {string} updateId - The update identifier
   */
  getUpdateStatus(updateId) {
    const update = this.pendingUpdates.get(updateId);
    return update ? update.status : null;
  }

  /**
   * Get all pending updates
   */
  getPendingUpdates() {
    return Array.from(this.pendingUpdates.values()).filter(
      update => update.status === 'pending'
    );
  }

  /**
   * Get rollback queue (for retry mechanisms)
   */
  getRollbackQueue() {
    return [...this.rollbackQueue];
  }

  /**
   * Clear rollback queue
   */
  clearRollbackQueue() {
    this.rollbackQueue = [];
  }

  /**
   * Retry a failed update
   * @param {string} updateId - The update identifier from rollback queue
   */
  retryUpdate(updateId) {
    const rollbackItem = this.rollbackQueue.find(item => item.updateId === updateId);
    if (!rollbackItem) {
      console.warn(`[OptimisticUpdateManager] Rollback item ${updateId} not found for retry`);
      return false;
    }

    // Generate new update ID for retry
    const retryUpdateId = `${updateId}_retry_${Date.now()}`;

    // Apply optimistic update again
    return this.applyOptimisticUpdate(
      retryUpdateId,
      rollbackItem.originalUpdate,
      rollbackItem.rollbackData
    );
  }

  /**
   * Clean up expired updates
   */
  cleanupExpiredUpdates() {
    const now = Date.now();
    const expiredUpdates = [];

    for (const [updateId, update] of this.pendingUpdates.entries()) {
      if (now - update.timestamp > this.updateTimeout) {
        expiredUpdates.push(updateId);
      }
    }

    expiredUpdates.forEach(updateId => {
      if (this.debugMode) {
        console.log(`[OptimisticUpdateManager] Cleaning up expired update: ${updateId}`);
      }
      this.rollbackUpdate(updateId, 'expired');
    });

    // Clean up old rollback queue items (older than 5 minutes)
    const fiveMinutesAgo = now - (5 * 60 * 1000);
    this.rollbackQueue = this.rollbackQueue.filter(item => item.timestamp > fiveMinutesAgo);
  }

  /**
   * Clean up oldest updates to prevent memory leaks
   * @param {number} count - Number of updates to clean up
   */
  cleanupOldestUpdates(count = 10) {
    const sortedUpdates = Array.from(this.pendingUpdates.entries())
      .sort(([, a], [, b]) => a.timestamp - b.timestamp)
      .slice(0, count);

    sortedUpdates.forEach(([updateId]) => {
      this.rollbackUpdate(updateId, 'cleanup');
    });
  }

  /**
   * Get statistics about optimistic updates
   */
  getStats() {
    const now = Date.now();
    const stats = {
      totalPending: this.pendingUpdates.size,
      rollbackQueueSize: this.rollbackQueue.length,
      updatesByStatus: {},
      averageAge: 0
    };

    let totalAge = 0;
    for (const update of this.pendingUpdates.values()) {
      const status = update.status;
      stats.updatesByStatus[status] = (stats.updatesByStatus[status] || 0) + 1;
      totalAge += now - update.timestamp;
    }

    if (this.pendingUpdates.size > 0) {
      stats.averageAge = Math.round(totalAge / this.pendingUpdates.size);
    }

    return stats;
  }

  /**
   * Clear all pending updates (useful for testing or reset)
   */
  clear() {
    this.pendingUpdates.clear();
    this.rollbackQueue = [];
    if (this.debugMode) {
      console.log('[OptimisticUpdateManager] Cleared all updates');
    }
  }

  /**
   * Destroy the manager and clean up resources
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clear();
  }
}

// Create and export singleton instance
const optimisticUpdateManager = new OptimisticUpdateManager();

export default optimisticUpdateManager;
export { OptimisticUpdateManager };