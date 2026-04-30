/**
 * Performance Optimizer
 * Advanced optimizations for 1M+ user scalability
 * All optimizations are backward compatible and gracefully degrade
 */

/**
 * Request Debouncer
 * Prevents excessive API calls by debouncing requests
 */
export class RequestDebouncer {
  constructor(delay = 300) {
    this.delay = delay;
    this.timeouts = new Map();
  }

  debounce(key, fn, ...args) {
    // Clear existing timeout
    if (this.timeouts.has(key)) {
      clearTimeout(this.timeouts.get(key));
    }

    // Set new timeout
    const timeoutId = setTimeout(() => {
      fn(...args);
      this.timeouts.delete(key);
    }, this.delay);

    this.timeouts.set(key, timeoutId);
  }

  cancel(key) {
    if (this.timeouts.has(key)) {
      clearTimeout(this.timeouts.get(key));
      this.timeouts.delete(key);
    }
  }

  clear() {
    for (const timeoutId of this.timeouts.values()) {
      clearTimeout(timeoutId);
    }
    this.timeouts.clear();
  }
}

/**
 * Request Batcher
 * Batches multiple requests into single operations
 */
export class RequestBatcher {
  constructor(batchSize = 10, batchDelay = 100) {
    this.batchSize = batchSize;
    this.batchDelay = batchDelay;
    this.queue = [];
    this.timeout = null;
  }

  add(request) {
    return new Promise((resolve, reject) => {
      this.queue.push({ request, resolve, reject });

      // Process if batch is full
      if (this.queue.length >= this.batchSize) {
        this.process();
      } else if (!this.timeout) {
        // Process after delay
        this.timeout = setTimeout(() => this.process(), this.batchDelay);
      }
    });
  }

  async process() {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }

    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.batchSize);

    try {
      // Execute batch in parallel
      const results = await Promise.allSettled(
        batch.map(item => item.request())
      );

      // Resolve/reject each promise
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          batch[index].resolve(result.value);
        } else {
          batch[index].reject(result.reason);
        }
      });
    } catch (error) {
      // Reject all on batch error
      batch.forEach(item => item.reject(error));
    }
  }

  clear() {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    this.queue = [];
  }
}

/**
 * Memory Monitor
 * Tracks memory usage and triggers cleanup when needed
 */
export class MemoryMonitor {
  constructor() {
    this.cleanupCallbacks = [];
    this.threshold = 0.8; // 80% memory usage
    this.checkInterval = 60000; // Check every minute
    this.intervalId = null;
  }

  registerCleanup(callback) {
    this.cleanupCallbacks.push(callback);
  }

  start() {
    if (typeof performance === 'undefined' || !performance.memory) {
      console.warn('[MemoryMonitor] Performance API not available');
      return;
    }

    this.intervalId = setInterval(() => {
      const memory = performance.memory;
      const usage = memory.usedJSHeapSize / memory.jsHeapSizeLimit;

      if (usage > this.threshold) {
        console.warn(`[MemoryMonitor] High memory usage: ${(usage * 100).toFixed(2)}%`);
        this.triggerCleanup();
      }
    }, this.checkInterval);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  triggerCleanup() {
    console.log('[MemoryMonitor] Triggering cleanup callbacks');
    this.cleanupCallbacks.forEach(callback => {
      try {
        callback();
      } catch (error) {
        console.error('[MemoryMonitor] Cleanup callback error:', error);
      }
    });
  }

  getMemoryInfo() {
    if (typeof performance === 'undefined' || !performance.memory) {
      return null;
    }

    const memory = performance.memory;
    return {
      used: Math.round(memory.usedJSHeapSize / 1048576), // MB
      total: Math.round(memory.totalJSHeapSize / 1048576), // MB
      limit: Math.round(memory.jsHeapSizeLimit / 1048576), // MB
      usage: ((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100).toFixed(2) + '%'
    };
  }
}

/**
 * Query Optimizer
 * Optimizes Firestore queries for better performance
 */
export class QueryOptimizer {
  constructor() {
    this.queryCache = new Map();
    this.maxCacheSize = 100;
  }

  /**
   * Add query result to cache
   */
  cacheQuery(key, result, ttl = 30000) {
    if (this.queryCache.size >= this.maxCacheSize) {
      // Remove oldest entry
      const firstKey = this.queryCache.keys().next().value;
      this.queryCache.delete(firstKey);
    }

    this.queryCache.set(key, {
      result,
      timestamp: Date.now(),
      ttl
    });
  }

  /**
   * Get cached query result
   */
  getCachedQuery(key) {
    const cached = this.queryCache.get(key);
    if (!cached) return null;

    if (Date.now() - cached.timestamp > cached.ttl) {
      this.queryCache.delete(key);
      return null;
    }

    return cached.result;
  }

  /**
   * Build optimized query with proper limits and filters
   */
  buildOptimizedQuery(collectionRef, filters = {}, options = {}) {
    let q = collectionRef;

    // Apply filters
    for (const [field, value] of Object.entries(filters)) {
      q = q.where(field, '==', value);
    }

    // Apply limit (required for scalability)
    const limit = options.limit || 1000;
    q = q.limit(limit);

    // Apply orderBy if specified
    if (options.orderBy) {
      q = q.orderBy(options.orderBy.field, options.orderBy.direction || 'asc');
    }

    return q;
  }

  clearCache() {
    this.queryCache.clear();
  }
}

// Create singleton instances
export const requestDebouncer = new RequestDebouncer(300);
export const requestBatcher = new RequestBatcher(10, 100);
export const memoryMonitor = new MemoryMonitor();
export const queryOptimizer = new QueryOptimizer();

// Auto-start memory monitor in production
if (process.env.NODE_ENV === 'production') {
  memoryMonitor.start();
}

// Export convenience functions
export const debounce = (key, fn, ...args) => 
  requestDebouncer.debounce(key, fn, ...args);

export const batchRequest = (request) => 
  requestBatcher.add(request);

export const getMemoryInfo = () => 
  memoryMonitor.getMemoryInfo();

export const registerMemoryCleanup = (callback) => 
  memoryMonitor.registerCleanup(callback);

/**
 * Rate limiter - prevents function from being called more than N times per period
 * @param {Function} func The function to rate limit.
 * @param {number} maxCalls Maximum number of calls allowed.
 * @param {number} period Time period in milliseconds.
 * @returns {Function} A rate-limited function.
 */
export const rateLimit = (func, maxCalls = 10, period = 1000) => {
    const calls = [];
    
    return function executed(...args) {
        const now = Date.now();
        
        // Remove calls outside the period
        while (calls.length > 0 && calls[0] < now - period) {
            calls.shift();
        }
        
        // Check if we've exceeded the limit
        if (calls.length >= maxCalls) {
            console.warn(`[RateLimiter] Function called ${calls.length} times in ${period}ms, limit is ${maxCalls}`);
            return;
        }
        
        // Record this call
        calls.push(now);
        
        // Execute the function
        return func(...args);
    };
};
