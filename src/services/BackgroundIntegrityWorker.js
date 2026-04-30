import { validationCache } from './ValidationCache';
import { DEFAULT_WEEK_START_DAY } from '../utils/weekStartUtils';

/**
 * BackgroundIntegrityWorker - Handles data integrity operations without blocking UI
 * Processes validation, deduplication, and repair tasks in the background
 */
class BackgroundIntegrityWorker {
  constructor() {
    this.taskQueue = new Map();
    this.processingQueue = new Set();
    this.isProcessing = false;
    this.maxConcurrentTasks = 3;
    this.processingInterval = null;
    this.retryDelays = [1000, 2000, 5000, 10000]; // Exponential backoff delays
    this.maxRetries = 3;
    
    // Task type priorities (higher number = higher priority)
    this.taskPriorities = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1
    };
    
    // Start processing queue
    this.startProcessing();
  }

  /**
   * Queue integrity check for background processing
   */
  queueIntegrityCheck(userId, weekStart, type, options = {}) {
    const {
      priority = 'low',
      metadata = {},
      maxRetries = this.maxRetries,
      delay = 0,
      weekStartDay = DEFAULT_WEEK_START_DAY
    } = options;
    
    const taskId = this._generateTaskId(userId, weekStart, type);
    const existingTask = this.taskQueue.get(taskId);
    
    // Update priority if higher priority task is queued
    if (existingTask && this.taskPriorities[priority] <= this.taskPriorities[existingTask.priority]) {
      console.log(`BackgroundIntegrityWorker: Task ${taskId} already queued with higher/equal priority`);
      return taskId;
    }
    
    const task = {
      id: taskId,
      userId,
      weekStart,
      type, // 'validation', 'deduplication', 'repair'
      priority,
      status: 'queued',
      queuedAt: Date.now(),
      scheduledFor: Date.now() + delay,
      attempts: 0,
      maxRetries,
      metadata,
      weekStartDay,
      lastError: null,
      processingStartedAt: null,
      completedAt: null
    };
    
    this.taskQueue.set(taskId, task);
    
    console.log(`BackgroundIntegrityWorker: Queued ${type} task for ${userId}, week ${weekStart}, priority: ${priority}`);
    
    // Trigger immediate processing if high/critical priority
    if (priority === 'high' || priority === 'critical') {
      setTimeout(() => this.processQueue(), 100);
    }
    
    return taskId;
  }

  /**
   * Process queued tasks with priority and concurrency management
   */
  async processQueue() {
    if (this.isProcessing || this.processingQueue.size >= this.maxConcurrentTasks) {
      return;
    }
    
    const readyTasks = this._getReadyTasks();
    if (readyTasks.length === 0) {
      return;
    }
    
    // Process tasks up to concurrency limit
    const tasksToProcess = readyTasks.slice(0, this.maxConcurrentTasks - this.processingQueue.size);
    
    for (const task of tasksToProcess) {
      this._processTask(task);
    }
  }

  /**
   * Handle critical issues that need immediate attention
   */
  async handleCriticalIssues(issues, userId, weekStart) {
    console.warn(`BackgroundIntegrityWorker: Handling ${issues.length} critical issues for ${userId}, week ${weekStart}`);
    
    const criticalIssues = issues.filter(issue => issue.severity === 'critical');
    
    if (criticalIssues.length === 0) {
      return { handled: false, reason: 'No critical issues found' };
    }
    
    // Queue immediate high-priority tasks for critical issues
    const taskIds = [];
    
    for (const issue of criticalIssues) {
      let taskType = 'validation';
      
      if (issue.type === 'duplicate') {
        taskType = 'deduplication';
      } else if (issue.type === 'inconsistency' || issue.type === 'corruption') {
        taskType = 'repair';
      }
      
      const taskId = this.queueIntegrityCheck(userId, weekStart, taskType, {
        priority: 'critical',
        metadata: { 
          issue,
          triggeredBy: 'critical_issue_handler',
          timestamp: Date.now()
        }
      });
      
      taskIds.push(taskId);
    }
    
    // Wait for critical tasks to complete (with timeout)
    try {
      await this._waitForTasks(taskIds, 30000); // 30 second timeout
      return { handled: true, taskIds, completedTasks: taskIds.length };
    } catch (error) {
      console.error(`BackgroundIntegrityWorker: Failed to handle critical issues within timeout:`, error);
      return { handled: false, error: error.message, taskIds };
    }
  }

  /**
   * Get current queue status for monitoring
   */
  getQueueStatus() {
    const tasks = Array.from(this.taskQueue.values());
    
    const statusCounts = tasks.reduce((counts, task) => {
      counts[task.status] = (counts[task.status] || 0) + 1;
      return counts;
    }, {});
    
    const priorityCounts = tasks.reduce((counts, task) => {
      counts[task.priority] = (counts[task.priority] || 0) + 1;
      return counts;
    }, {});
    
    const typeCounts = tasks.reduce((counts, task) => {
      counts[task.type] = (counts[task.type] || 0) + 1;
      return counts;
    }, {});
    
    return {
      totalTasks: tasks.length,
      processingTasks: this.processingQueue.size,
      isProcessing: this.isProcessing,
      statusCounts,
      priorityCounts,
      typeCounts,
      oldestQueuedTask: tasks.length > 0 ? Math.min(...tasks.map(t => t.queuedAt)) : null,
      averageQueueTime: this._calculateAverageQueueTime(tasks)
    };
  }

  /**
   * Get task details by ID
   */
  getTask(taskId) {
    return this.taskQueue.get(taskId);
  }

  /**
   * Cancel a queued task
   */
  cancelTask(taskId) {
    const task = this.taskQueue.get(taskId);
    
    if (!task) {
      return false;
    }
    
    if (task.status === 'processing') {
      console.warn(`BackgroundIntegrityWorker: Cannot cancel task ${taskId} - already processing`);
      return false;
    }
    
    this.taskQueue.delete(taskId);
    console.log(`BackgroundIntegrityWorker: Cancelled task ${taskId}`);
    
    return true;
  }

  /**
   * Clear completed tasks from queue
   */
  clearCompletedTasks(olderThanMs = 3600000) { // 1 hour default
    const cutoff = Date.now() - olderThanMs;
    let clearedCount = 0;
    
    for (const [taskId, task] of this.taskQueue.entries()) {
      if ((task.status === 'completed' || task.status === 'failed') && 
          task.completedAt && task.completedAt < cutoff) {
        this.taskQueue.delete(taskId);
        clearedCount++;
      }
    }
    
    if (clearedCount > 0) {
      console.log(`BackgroundIntegrityWorker: Cleared ${clearedCount} completed tasks`);
    }
    
    return clearedCount;
  }

  /**
   * Start automatic queue processing
   */
  startProcessing(intervalMs = 5000) { // 5 seconds default
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
    
    this.processingInterval = setInterval(() => {
      this.processQueue();
      this.clearCompletedTasks();
    }, intervalMs);
    
    console.log(`BackgroundIntegrityWorker: Started processing with ${intervalMs}ms interval`);
  }

  /**
   * Stop automatic queue processing
   */
  stopProcessing() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
      console.log('BackgroundIntegrityWorker: Stopped processing');
    }
  }

  /**
   * Process individual task
   */
  async _processTask(task) {
    const taskId = task.id;
    
    if (this.processingQueue.has(taskId)) {
      return; // Already processing
    }
    
    this.processingQueue.add(taskId);
    task.status = 'processing';
    task.processingStartedAt = Date.now();
    task.attempts++;
    
    console.log(`BackgroundIntegrityWorker: Processing task ${taskId} (attempt ${task.attempts})`);
    
    try {
      let result;
      
      switch (task.type) {
        case 'validation':
          result = await this._runValidationTask(task);
          break;
        case 'deduplication':
          result = await this._runDeduplicationTask(task);
          break;
        case 'repair':
          result = await this._runRepairTask(task);
          break;
        default:
          throw new Error(`Unknown task type: ${task.type}`);
      }
      
      task.status = 'completed';
      task.completedAt = Date.now();
      task.result = result;
      
      console.log(`BackgroundIntegrityWorker: Completed task ${taskId} in ${task.completedAt - task.processingStartedAt}ms`);
      
    } catch (error) {
      console.error(`BackgroundIntegrityWorker: Task ${taskId} failed:`, error);
      
      task.lastError = {
        message: error.message,
        stack: error.stack,
        timestamp: Date.now()
      };
      
      // Retry logic
      if (task.attempts < task.maxRetries) {
        task.status = 'queued';
        task.scheduledFor = Date.now() + this.retryDelays[Math.min(task.attempts - 1, this.retryDelays.length - 1)];
        console.log(`BackgroundIntegrityWorker: Retrying task ${taskId} in ${task.scheduledFor - Date.now()}ms`);
      } else {
        task.status = 'failed';
        task.completedAt = Date.now();
        console.error(`BackgroundIntegrityWorker: Task ${taskId} failed permanently after ${task.attempts} attempts`);
      }
    } finally {
      this.processingQueue.delete(taskId);
    }
  }

  /**
   * Run validation task
   */
  async _runValidationTask(task) {
    // Check if validation is still needed
    if (!validationCache.isValidationNeeded(task.userId, task.weekStart)) {
      return { skipped: true, reason: 'Validation not needed based on cache' };
    }
    
    // Import validation modules dynamically
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
    
    const result = {
      isConsistent: consistencyCheck.isConsistent && !duplicates.hasDuplicates,
      hasDuplicates: duplicates.hasDuplicates,
      issues: [
        ...(duplicates.hasDuplicates ? [{ type: 'duplicate', severity: 'medium', description: 'Duplicate entries detected' }] : []),
        ...(consistencyCheck.issues || [])
      ],
      duplicateDetails: duplicates,
      consistencyDetails: consistencyCheck,
      validatedAt: Date.now()
    };
    
    // Cache the validation result
    validationCache.cacheValidationResult(task.userId, task.weekStart, result);
    
    return result;
  }

  /**
   * Run deduplication task
   */
  async _runDeduplicationTask(task) {
    const { timesheetDeduplication } = await import('./timesheetDeduplication');
    
    const weekStartDay = task.weekStartDay || DEFAULT_WEEK_START_DAY;
    const cleanupResult = await timesheetDeduplication.cleanupDuplicates(task.userId, task.weekStart, {
      strategy: 'latest',
      dryRun: false,
      weekStartDay
    });
    
    // Update validation cache if cleanup was successful
    if (cleanupResult.success) {
      validationCache.updateValidationResult(task.userId, task.weekStart, {
        hasDuplicates: false,
        lastDeduplication: Date.now()
      });
    }
    
    return cleanupResult;
  }

  /**
   * Run repair task
   */
  async _runRepairTask(task) {
    const { TimesheetConsistencyManager } = await import('../utils/timesheetConsistency');
    const consistency = new TimesheetConsistencyManager();
    
    const weekStartDay = task.weekStartDay || DEFAULT_WEEK_START_DAY;
    const repairResult = await consistency.repairInconsistentData(task.userId, task.weekStart, {
      dryRun: false,
      autoApprove: false,
      weekStartDay
    });
    
    // Update validation cache if repair was successful
    if (repairResult.success && repairResult.successfulRepairs > 0) {
      validationCache.updateValidationResult(task.userId, task.weekStart, {
        isConsistent: true,
        lastRepair: Date.now()
      });
    }
    
    return repairResult;
  }

  /**
   * Get tasks ready for processing (not scheduled for future, not already processing)
   */
  _getReadyTasks() {
    const now = Date.now();
    
    return Array.from(this.taskQueue.values())
      .filter(task => 
        task.status === 'queued' && 
        task.scheduledFor <= now &&
        !this.processingQueue.has(task.id)
      )
      .sort((a, b) => {
        // Sort by priority first, then by queue time
        const priorityDiff = this.taskPriorities[b.priority] - this.taskPriorities[a.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return a.queuedAt - b.queuedAt;
      });
  }

  /**
   * Generate unique task ID
   */
  _generateTaskId(userId, weekStart, type) {
    return `${type}:${userId}:${weekStart}:${Date.now()}`;
  }

  /**
   * Wait for specific tasks to complete
   */
  async _waitForTasks(taskIds, timeoutMs) {
    const startTime = Date.now();
    
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        const allCompleted = taskIds.every(taskId => {
          const task = this.taskQueue.get(taskId);
          return task && (task.status === 'completed' || task.status === 'failed');
        });
        
        if (allCompleted) {
          clearInterval(checkInterval);
          resolve();
        } else if (Date.now() - startTime > timeoutMs) {
          clearInterval(checkInterval);
          reject(new Error(`Timeout waiting for tasks: ${taskIds.join(', ')}`));
        }
      }, 500); // Check every 500ms
    });
  }

  /**
   * Calculate average queue time for tasks
   */
  _calculateAverageQueueTime(tasks) {
    const completedTasks = tasks.filter(t => t.completedAt && t.queuedAt);
    
    if (completedTasks.length === 0) {
      return 0;
    }
    
    const totalQueueTime = completedTasks.reduce((sum, task) => {
      return sum + (task.processingStartedAt - task.queuedAt);
    }, 0);
    
    return totalQueueTime / completedTasks.length;
  }
}

// Export singleton instance
export const backgroundIntegrityWorker = new BackgroundIntegrityWorker();
export default BackgroundIntegrityWorker;