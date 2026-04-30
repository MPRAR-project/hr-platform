import { db } from '../firebase/client';
import { collection, query, where, getDocs, getDoc, doc } from 'firebase/firestore';
import { getCachedWeeklyData, cacheWeeklyData } from './timesheetCache';
import { getWeekRange, formatISODate } from './timesheets';
import { DEFAULT_WEEK_START_DAY, getOrderedWeekDates } from '../utils/weekStartUtils';
import { measureAsync } from '../hooks/usePerformanceMonitor';

/**
 * FastTimesheetLoader - Optimized timesheet loading service for modal usage
 * Prioritizes speed over comprehensive validation for better user experience
 */
class FastTimesheetLoader {
  constructor() {
    this.validationQueue = new Map();
    this.loadingCache = new Map();
  }

  /**
   * Cache-first loading with background validation
   * Returns cached data immediately if available, queues validation for background
   */
  async loadForModal(userId, weekStart, options = {}) {
    const {
      useCache = true,
      backgroundValidation = true,
      skipValidation = true,
      timeout = 5000,
      weekStartDay = DEFAULT_WEEK_START_DAY
    } = options;

    return measureAsync(`FastTimesheetLoader.loadForModal-${userId}-${weekStart}`, async () => {
      const weekStartStr = typeof weekStart === 'string' ? weekStart : formatISODate(weekStart);

      // Fast path: return cached data immediately
      if (useCache) {
        const cached = getCachedWeeklyData(userId, weekStartStr);
        if (cached) {
          console.log(`FastTimesheetLoader: Using cached data for ${userId}, week ${weekStartStr}`);

          // Queue background validation if needed
          if (backgroundValidation) {
            this.queueValidation(userId, weekStartStr, 'low', { weekStartDay });
          }

          return cached;
        }
      }

      // Check if we're already loading this data to avoid duplicate requests
      const loadingKey = `${userId}-${weekStartStr}`;
      if (this.loadingCache.has(loadingKey)) {
        console.log(`FastTimesheetLoader: Waiting for existing load for ${userId}, week ${weekStartStr}`);
        return await this.loadingCache.get(loadingKey);
      }

      // Create loading promise and cache it
      const loadingPromise = this.fetchBasicWeekData(userId, weekStartStr, { timeout, weekStartDay });
      this.loadingCache.set(loadingKey, loadingPromise);

      try {
        const data = await loadingPromise;

        // Cache the result
        cacheWeeklyData(userId, weekStartStr, data);

        // Queue background validation if needed
        if (backgroundValidation && !skipValidation) {
          this.queueValidation(userId, weekStartStr, 'medium', { weekStartDay });
        }

        return data;
      } finally {
        // Clean up loading cache
        this.loadingCache.delete(loadingKey);
      }
    });
  }

  /**
   * Skip expensive validations for modal display
   * Fetches only essential data needed for timesheet display
   */
  async fetchBasicWeekData(userId, weekStart, options = {}) {
    const { timeout = 5000, weekStartDay = DEFAULT_WEEK_START_DAY } = options;

    return measureAsync(`FastTimesheetLoader.fetchBasicWeekData-${userId}-${weekStart}`, async () => {
      const weekStartStr = typeof weekStart === 'string' ? weekStart : formatISODate(weekStart);
      const startDate = new Date(weekStartStr);
      const { start } = getWeekRange(startDate, weekStartDay);

      // Generate week dates
      const dates = getOrderedWeekDates(start, weekStartDay);

      const endDate = new Date(start);
      endDate.setDate(start.getDate() + 6);
      const endDateStr = formatISODate(endDate);

      // Create timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout);
      });

      // Fetch timesheet data with timeout
      const fetchPromise = this._fetchTimesheetData(userId, weekStartStr, endDateStr);

      try {
        const entries = await Promise.race([fetchPromise, timeoutPromise]);

        // Process entries for the specific week range
        const weekEntries = entries.filter(entry => {
          const period = entry.period;
          return period >= weekStartStr && period <= endDateStr;
        });

        // Transform to expected format
        const result = {
          dates,
          entries: weekEntries.map(entry => ({
            period: entry.period,
            totals: entry.totals || {
              grossSec: 0,
              effectiveSec: 0,
              overtimeSec: 0
            },
            entries: entry.entries || [],
            status: entry.status || 'draft',
            id: entry.id
          })),
          loadedAt: Date.now(),
          source: 'FastTimesheetLoader',
          weekStart: weekStartStr,
          weekEnd: endDateStr,
          weekStartDay
        };

        console.log(`FastTimesheetLoader: Fetched ${result.entries.length} entries for ${userId}, week ${weekStartStr}`);
        return result;

      } catch (error) {
        if (error.message.includes('Timeout')) {
          console.warn(`FastTimesheetLoader: Timeout fetching data for ${userId}, week ${weekStartStr}`);
          // Return empty result on timeout to avoid blocking UI
          return {
            dates,
            entries: [],
            loadedAt: Date.now(),
            source: 'FastTimesheetLoader-timeout',
            error: 'timeout',
            weekStart: weekStartStr,
            weekEnd: endDateStr,
            weekStartDay
          };
        }
        throw error;
      }
    });
  }

  /**
   * Internal method to fetch timesheet data from Firestore
   */
  async _fetchTimesheetData(userId, weekStartStr, weekEndStr) {
    const tsCol = collection(db, 'timesheets');

    // Use simple query to avoid index requirements
    const q = query(tsCol, where('userId', '==', userId));

    const snap = await getDocs(q);
    const entries = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Client-side filtering for the week range
    return entries.filter(entry => {
      const period = entry.period;
      return period && period >= weekStartStr && period <= weekEndStr;
    });
  }

  /**
   * Background validation queue
   * Queues validation tasks to run later without blocking UI
   */
  queueValidation(userId, weekStart, priority = 'low', options = {}) {
    const key = `${userId}-${weekStart}`;
    const existingTask = this.validationQueue.get(key);
    const weekStartDay = options.weekStartDay || DEFAULT_WEEK_START_DAY;

    // Only queue if not already queued or if higher priority
    if (!existingTask || this._getPriorityValue(priority) > this._getPriorityValue(existingTask.priority)) {
      this.validationQueue.set(key, {
        userId,
        weekStart,
        priority,
        queuedAt: Date.now(),
        attempts: 0,
        weekStartDay
      });

      console.log(`FastTimesheetLoader: Queued validation for ${userId}, week ${weekStart}, priority: ${priority}`);

      // Process queue in next tick to avoid blocking current operation
      setTimeout(() => this._processValidationQueue(), 0);
    }
  }

  /**
   * Process queued validation tasks
   */
  async _processValidationQueue() {
    if (this.validationQueue.size === 0) return;

    // Sort by priority and age
    const tasks = Array.from(this.validationQueue.values())
      .sort((a, b) => {
        const priorityDiff = this._getPriorityValue(b.priority) - this._getPriorityValue(a.priority);
        if (priorityDiff !== 0) return priorityDiff;
        return a.queuedAt - b.queuedAt; // Older tasks first for same priority
      });

    // Process one task at a time to avoid overwhelming the system
    const task = tasks[0];
    if (task) {
      const key = `${task.userId}-${task.weekStart}`;
      this.validationQueue.delete(key);

      try {
        await this._runBackgroundValidation(task);
      } catch (error) {
        console.warn(`FastTimesheetLoader: Background validation failed for ${task.userId}, week ${task.weekStart}:`, error);

        // Retry with exponential backoff for failed tasks
        if (task.attempts < 3) {
          task.attempts++;
          const delay = Math.pow(2, task.attempts) * 1000; // 2s, 4s, 8s
          setTimeout(() => {
            this.validationQueue.set(key, task);
            this._processValidationQueue();
          }, delay);
        }
      }
    }
  }

  /**
   * Run background validation for a specific task
   */
  async _runBackgroundValidation(task) {
    console.log(`FastTimesheetLoader: Running background validation for ${task.userId}, week ${task.weekStart}`);

    // Import validation modules dynamically to avoid blocking initial load
    const [
      { timesheetDeduplication },
      { TimesheetConsistencyManager }
    ] = await Promise.all([
      import('./timesheetDeduplication'),
      import('../utils/timesheetConsistency')
    ]);

    const consistency = new TimesheetConsistencyManager();

    // Run validation checks
    const weekStartDay = task.weekStartDay || DEFAULT_WEEK_START_DAY;
    const [duplicates, consistencyCheck] = await Promise.all([
      timesheetDeduplication.detectDuplicateEntries(task.userId, task.weekStart, { weekStartDay }),
      consistency.validateDataConsistency(task.userId, task.weekStart, { weekStartDay })
    ]);

    // Handle issues found
    if (duplicates.hasDuplicates) {
      console.log(`FastTimesheetLoader: Found duplicates for ${task.userId}, week ${task.weekStart}, scheduling cleanup`);
      // Schedule cleanup for later
      setTimeout(() => {
        timesheetDeduplication.cleanupDuplicates(task.userId, task.weekStart, {
          strategy: 'latest',
          dryRun: false,
          weekStartDay
        }).catch(error => {
          console.warn(`FastTimesheetLoader: Duplicate cleanup failed for ${task.userId}, week ${task.weekStart}:`, error);
        });
      }, 5000); // 5 second delay
    }

    if (!consistencyCheck.isConsistent) {
      console.log(`FastTimesheetLoader: Found consistency issues for ${task.userId}, week ${task.weekStart}, scheduling repair`);
      // Schedule repair for later
      setTimeout(() => {
        consistency.repairInconsistentData(task.userId, task.weekStart, {
          dryRun: false,
          autoApprove: false,
          weekStartDay
        }).catch(error => {
          console.warn(`FastTimesheetLoader: Consistency repair failed for ${task.userId}, week ${task.weekStart}:`, error);
        });
      }, 10000); // 10 second delay
    }
  }

  /**
   * Get numeric priority value for sorting
   */
  _getPriorityValue(priority) {
    const priorities = { low: 1, medium: 2, high: 3, critical: 4 };
    return priorities[priority] || 1;
  }

  /**
   * Clear validation queue (useful for testing)
   */
  clearValidationQueue() {
    this.validationQueue.clear();
    this.loadingCache.clear();
  }

  /**
   * Get queue status (useful for monitoring)
   */
  getQueueStatus() {
    return {
      validationQueueSize: this.validationQueue.size,
      loadingCacheSize: this.loadingCache.size,
      queuedTasks: Array.from(this.validationQueue.values())
    };
  }
}

// Export singleton instance
export const fastTimesheetLoader = new FastTimesheetLoader();
export default FastTimesheetLoader;