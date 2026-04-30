import { fastTimesheetLoader } from './FastTimesheetLoader';
import { validationCache } from './ValidationCache';
import { backgroundIntegrityWorker } from './BackgroundIntegrityWorker';
import { measureAsync } from '../hooks/usePerformanceMonitor';
import { TimesheetErrorHandler, TIMESHEET_ERROR_CODES } from '../utils/timesheetErrorHandler';
import { getCachedWeeklyData } from './timesheetCache';

/**
 * Optimized fetchWeekDetailsForModal - Modal-specific timesheet data fetching
 * Prioritizes speed over comprehensive validation for better user experience
 */
export async function fetchWeekDetailsForModal(userId, weekStart, options = {}) {
  const {
    skipValidation = true,
    useCache = true,
    backgroundValidation = true,
    timeout = 5000,
    fallbackToBasic = true,
    errorHandling = 'graceful',
    weekStartDay = null
  } = options;

  return measureAsync(`fetchWeekDetailsForModal-${userId}-${weekStart}`, async () => {
    try {
      console.log(`fetchWeekDetailsForModal: Loading data for ${userId}, week ${weekStart}`);
      
      // Fast path: Use FastTimesheetLoader for optimized loading
      const result = await fastTimesheetLoader.loadForModal(userId, weekStart, {
        useCache,
        backgroundValidation,
        skipValidation,
        timeout,
        weekStartDay: weekStartDay || undefined
      });
      
      // Add modal-specific metadata
      result.loadedBy = 'fetchWeekDetailsForModal';
      result.optimized = true;
      result.validationSkipped = skipValidation;
      
      // Queue background validation if needed and not already queued
      if (backgroundValidation && !skipValidation) {
        const validationNeeded = validationCache.isValidationNeeded(userId, weekStart, {
          maxAge: 3600000 // 1 hour
        });
        
        if (validationNeeded) {
          backgroundIntegrityWorker.queueIntegrityCheck(userId, weekStart, 'validation', {
            priority: 'low',
            weekStartDay: weekStartDay || undefined,
            metadata: {
              triggeredBy: 'fetchWeekDetailsForModal',
              timestamp: Date.now()
            }
          });
        }
      }
      
      console.log(`fetchWeekDetailsForModal: Successfully loaded ${result.entries.length} entries for ${userId}, week ${weekStart}`);
      
      return result;
      
    } catch (error) {
      console.error(`fetchWeekDetailsForModal: Error loading data for ${userId}, week ${weekStart}:`, error);
      
      // Handle errors based on strategy
      if (errorHandling === 'graceful') {
        return await handleModalLoadingError(error, userId, weekStart, options);
      } else {
        throw error;
      }
    }
  });
}

/**
 * Handle loading errors with graceful degradation
 */
async function handleModalLoadingError(error, userId, weekStart, options) {
  const { fallbackToBasic = true, timeout = 5000 } = options;
  
  console.warn(`fetchWeekDetailsForModal: Handling error for ${userId}, week ${weekStart}:`, error.message);
  
  // Try fallback strategies
  if (fallbackToBasic) {
    try {
      console.log(`fetchWeekDetailsForModal: Attempting basic fallback for ${userId}, week ${weekStart}`);
      
      // Use basic data fetching as fallback
      const fallbackResult = await fastTimesheetLoader.fetchBasicWeekData(userId, weekStart, {
        timeout: timeout / 2, // Shorter timeout for fallback
        weekStartDay: weekStartDay || undefined
      });
      
      fallbackResult.loadedBy = 'fetchWeekDetailsForModal-fallback';
      fallbackResult.fallbackUsed = true;
      fallbackResult.originalError = error.message;
      
      console.log(`fetchWeekDetailsForModal: Fallback successful for ${userId}, week ${weekStart}`);
      
      return fallbackResult;
      
    } catch (fallbackError) {
      console.error(`fetchWeekDetailsForModal: Fallback also failed for ${userId}, week ${weekStart}:`, fallbackError);
    }
  }
  
  // Last resort: return empty result with error info
  const emptyResult = createEmptyModalResult(userId, weekStart, error);
  
  // Log error for monitoring
  TimesheetErrorHandler.handleError(TIMESHEET_ERROR_CODES.MODAL_LOADING_FAILED, {
    userId,
    weekStart,
    originalError: error.message,
    fallbackAttempted: fallbackToBasic
  });
  
  return emptyResult;
}

/**
 * Create empty result structure for error cases
 */
function createEmptyModalResult(userId, weekStart, error) {
  const startDate = new Date(weekStart);
  const dates = [];
  
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  
  return {
    dates,
    entries: [],
    loadedAt: Date.now(),
    loadedBy: 'fetchWeekDetailsForModal-error',
    error: {
      message: error.message,
      code: 'MODAL_LOADING_FAILED',
      timestamp: Date.now()
    },
    isEmpty: true,
    fallbackUsed: false
  };
}

/**
 * Batch load multiple weeks for modal (useful for navigation)
 */
export async function batchFetchWeekDetailsForModal(userId, weekStarts, options = {}) {
  const { concurrency = 3, ...fetchOptions } = options;
  
  return measureAsync(`batchFetchWeekDetailsForModal-${userId}-${weekStarts.length}weeks`, async () => {
    console.log(`batchFetchWeekDetailsForModal: Loading ${weekStarts.length} weeks for ${userId}`);
    
    // Process in batches to avoid overwhelming the system
    const results = new Map();
    const batches = [];
    
    for (let i = 0; i < weekStarts.length; i += concurrency) {
      batches.push(weekStarts.slice(i, i + concurrency));
    }
    
    for (const batch of batches) {
      const batchPromises = batch.map(weekStart => 
        fetchWeekDetailsForModal(userId, weekStart, fetchOptions)
          .then(result => ({ weekStart, result, success: true }))
          .catch(error => ({ weekStart, error, success: false }))
      );
      
      const batchResults = await Promise.all(batchPromises);
      
      for (const { weekStart, result, error, success } of batchResults) {
        if (success) {
          results.set(weekStart, result);
        } else {
          console.error(`batchFetchWeekDetailsForModal: Failed to load week ${weekStart}:`, error);
          results.set(weekStart, createEmptyModalResult(userId, weekStart, error));
        }
      }
    }
    
    console.log(`batchFetchWeekDetailsForModal: Loaded ${results.size} weeks for ${userId}`);
    
    return {
      userId,
      results: Object.fromEntries(results),
      totalWeeks: weekStarts.length,
      successfulWeeks: Array.from(results.values()).filter(r => !r.error).length,
      loadedAt: Date.now()
    };
  });
}

/**
 * Preload adjacent weeks for better navigation experience
 */
export async function preloadAdjacentWeeks(userId, currentWeek, options = {}) {
  const { weeksBefore = 1, weeksAfter = 1, ...fetchOptions } = options;
  
  const currentDate = new Date(currentWeek);
  const weeksToPreload = [];
  
  // Add previous weeks
  for (let i = 1; i <= weeksBefore; i++) {
    const prevDate = new Date(currentDate);
    prevDate.setDate(currentDate.getDate() - (i * 7));
    weeksToPreload.push(prevDate.toISOString().slice(0, 10));
  }
  
  // Add next weeks
  for (let i = 1; i <= weeksAfter; i++) {
    const nextDate = new Date(currentDate);
    nextDate.setDate(currentDate.getDate() + (i * 7));
    weeksToPreload.push(nextDate.toISOString().slice(0, 10));
  }
  
  console.log(`preloadAdjacentWeeks: Preloading ${weeksToPreload.length} weeks around ${currentWeek} for ${userId}`);
  
  // Preload in background with low priority
  const preloadOptions = {
    ...fetchOptions,
    backgroundValidation: false, // Skip validation for preloaded data
    skipValidation: true,
    errorHandling: 'silent' // Don't show errors for preloading
  };
  
  // Fire and forget - don't wait for completion
  batchFetchWeekDetailsForModal(userId, weeksToPreload, preloadOptions)
    .then(results => {
      console.log(`preloadAdjacentWeeks: Successfully preloaded ${results.successfulWeeks}/${results.totalWeeks} weeks for ${userId}`);
    })
    .catch(error => {
      console.warn(`preloadAdjacentWeeks: Failed to preload weeks for ${userId}:`, error);
    });
  
  return {
    preloadedWeeks: weeksToPreload,
    currentWeek,
    userId
  };
}

/**
 * Get cached week data if available (synchronous)
 */
export function getCachedWeekDetailsForModal(userId, weekStart) {
  try {
    const cached = getCachedWeeklyData(userId, weekStart);
    
    if (cached) {
      return {
        ...cached,
        loadedBy: 'getCachedWeekDetailsForModal',
        fromCache: true
      };
    }
    
    return null;
  } catch (error) {
    console.warn(`getCachedWeekDetailsForModal: Error accessing cache for ${userId}, week ${weekStart}:`, error);
    return null;
  }
}

/**
 * Invalidate modal cache for specific user/week
 */
export async function invalidateModalCache(userId, weekStart) {
  try {
    // Import dynamically to avoid circular dependencies
    const { invalidateTimesheetCache } = await import('./timesheets');
    invalidateTimesheetCache(userId);
    
    // Also clear validation cache
    validationCache.invalidateValidation(userId, weekStart);
    
    console.log(`invalidateModalCache: Cleared cache for ${userId}, week ${weekStart}`);
    
    return true;
  } catch (error) {
    console.error(`invalidateModalCache: Error clearing cache for ${userId}, week ${weekStart}:`, error);
    return false;
  }
}

/**
 * Get modal loading performance metrics
 */
export function getModalLoadingMetrics() {
  const queueStatus = backgroundIntegrityWorker.getQueueStatus();
  const cacheStats = validationCache.getCacheStats();
  const loaderStatus = fastTimesheetLoader.getQueueStatus();
  
  return {
    backgroundTasks: {
      total: queueStatus.totalTasks,
      processing: queueStatus.processingTasks,
      byType: queueStatus.typeCounts,
      byPriority: queueStatus.priorityCounts
    },
    validationCache: {
      entries: cacheStats.totalEntries,
      hitRate: cacheStats.totalEntries > 0 ? 
        (cacheStats.totalEntries - cacheStats.expiredEntries) / cacheStats.totalEntries : 0,
      memoryUsage: cacheStats.memoryUsage
    },
    fastLoader: {
      validationQueue: loaderStatus.validationQueueSize,
      loadingCache: loaderStatus.loadingCacheSize
    },
    timestamp: Date.now()
  };
}

// Export default function for convenience
export default fetchWeekDetailsForModal;