/**
 * ModalPerformanceMonitor - Performance monitoring specifically for modal operations
 * Tracks load times, cache effectiveness, and user experience metrics
 */
class ModalPerformanceMonitor {
  constructor() {
    this.metrics = new Map();
    this.loadTimes = [];
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.errorCounts = new Map();
    this.maxMetricsAge = 3600000; // 1 hour
    this.maxMetricsCount = 1000;
    
    // Performance targets
    this.targets = {
      modalLoadTime: 500, // ms
      cacheHitRate: 0.8, // 80%
      errorRate: 0.01 // 1%
    };
    
    // Start periodic cleanup
    this.startPeriodicCleanup();
  }

  /**
   * Record modal load time measurement
   */
  recordModalLoadTime(userId, weekStart, loadTime, metadata = {}) {
    const metric = {
      userId,
      weekStart,
      loadTime,
      timestamp: Date.now(),
      metadata: {
        ...metadata,
        target: this.targets.modalLoadTime,
        withinTarget: loadTime <= this.targets.modalLoadTime
      }
    };
    
    this.loadTimes.push(metric);
    this.metrics.set(`load-${Date.now()}-${Math.random()}`, metric);
    
    // Log performance issues
    if (loadTime > this.targets.modalLoadTime) {
      console.warn(`ModalPerformanceMonitor: Slow load detected - ${loadTime}ms for ${userId}, week ${weekStart}`);
    }
    
    // Cleanup old metrics
    this.cleanupOldMetrics();
    
    return metric;
  }

  /**
   * Record cache hit
   */
  recordCacheHit(userId, weekStart, cacheType = 'unknown') {
    this.cacheHits++;
    
    const metric = {
      type: 'cache_hit',
      userId,
      weekStart,
      cacheType,
      timestamp: Date.now()
    };
    
    this.metrics.set(`cache-hit-${Date.now()}-${Math.random()}`, metric);
    
    console.log(`ModalPerformanceMonitor: Cache hit for ${userId}, week ${weekStart}, type: ${cacheType}`);
    
    return metric;
  }

  /**
   * Record cache miss
   */
  recordCacheMiss(userId, weekStart, reason = 'unknown') {
    this.cacheMisses++;
    
    const metric = {
      type: 'cache_miss',
      userId,
      weekStart,
      reason,
      timestamp: Date.now()
    };
    
    this.metrics.set(`cache-miss-${Date.now()}-${Math.random()}`, metric);
    
    console.log(`ModalPerformanceMonitor: Cache miss for ${userId}, week ${weekStart}, reason: ${reason}`);
    
    return metric;
  }

  /**
   * Record error occurrence
   */
  recordError(errorType, userId, weekStart, errorDetails = {}) {
    const currentCount = this.errorCounts.get(errorType) || 0;
    this.errorCounts.set(errorType, currentCount + 1);
    
    const metric = {
      type: 'error',
      errorType,
      userId,
      weekStart,
      errorDetails,
      timestamp: Date.now()
    };
    
    this.metrics.set(`error-${Date.now()}-${Math.random()}`, metric);
    
    console.error(`ModalPerformanceMonitor: Error recorded - ${errorType} for ${userId}, week ${weekStart}`);
    
    return metric;
  }

  /**
   * Record background task completion
   */
  recordBackgroundTask(taskType, userId, weekStart, duration, success = true) {
    const metric = {
      type: 'background_task',
      taskType,
      userId,
      weekStart,
      duration,
      success,
      timestamp: Date.now()
    };
    
    this.metrics.set(`bg-task-${Date.now()}-${Math.random()}`, metric);
    
    if (!success) {
      console.warn(`ModalPerformanceMonitor: Background task failed - ${taskType} for ${userId}, week ${weekStart}`);
    }
    
    return metric;
  }

  /**
   * Get current performance statistics
   */
  getPerformanceStats() {
    const now = Date.now();
    const recentMetrics = Array.from(this.metrics.values())
      .filter(m => now - m.timestamp <= this.maxMetricsAge);
    
    // Calculate load time statistics
    const recentLoadTimes = this.loadTimes
      .filter(lt => now - lt.timestamp <= this.maxMetricsAge)
      .map(lt => lt.loadTime);
    
    const avgLoadTime = recentLoadTimes.length > 0 ? 
      recentLoadTimes.reduce((sum, time) => sum + time, 0) / recentLoadTimes.length : 0;
    
    const medianLoadTime = this.calculateMedian(recentLoadTimes);
    const p95LoadTime = this.calculatePercentile(recentLoadTimes, 95);
    
    // Calculate cache hit rate
    const totalCacheOperations = this.cacheHits + this.cacheMisses;
    const cacheHitRate = totalCacheOperations > 0 ? this.cacheHits / totalCacheOperations : 0;
    
    // Calculate error rate
    const totalOperations = recentLoadTimes.length;
    const totalErrors = Array.from(this.errorCounts.values()).reduce((sum, count) => sum + count, 0);
    const errorRate = totalOperations > 0 ? totalErrors / totalOperations : 0;
    
    // Performance health indicators
    const health = {
      loadTime: avgLoadTime <= this.targets.modalLoadTime ? 'good' : 'poor',
      cacheHitRate: cacheHitRate >= this.targets.cacheHitRate ? 'good' : 'poor',
      errorRate: errorRate <= this.targets.errorRate ? 'good' : 'poor'
    };
    
    return {
      loadTimes: {
        average: Math.round(avgLoadTime),
        median: Math.round(medianLoadTime),
        p95: Math.round(p95LoadTime),
        target: this.targets.modalLoadTime,
        withinTarget: recentLoadTimes.filter(lt => lt <= this.targets.modalLoadTime).length,
        total: recentLoadTimes.length
      },
      cache: {
        hitRate: Math.round(cacheHitRate * 100) / 100,
        hits: this.cacheHits,
        misses: this.cacheMisses,
        total: totalCacheOperations,
        target: this.targets.cacheHitRate
      },
      errors: {
        rate: Math.round(errorRate * 100) / 100,
        total: totalErrors,
        byType: Object.fromEntries(this.errorCounts),
        target: this.targets.errorRate
      },
      health,
      overallHealth: Object.values(health).every(h => h === 'good') ? 'good' : 'poor',
      metricsCount: recentMetrics.length,
      timestamp: now
    };
  }

  /**
   * Get detailed metrics for analysis
   */
  getDetailedMetrics(options = {}) {
    const { 
      maxAge = this.maxMetricsAge,
      userId = null,
      weekStart = null,
      metricType = null
    } = options;
    
    const now = Date.now();
    let metrics = Array.from(this.metrics.values())
      .filter(m => now - m.timestamp <= maxAge);
    
    // Apply filters
    if (userId) {
      metrics = metrics.filter(m => m.userId === userId);
    }
    
    if (weekStart) {
      metrics = metrics.filter(m => m.weekStart === weekStart);
    }
    
    if (metricType) {
      metrics = metrics.filter(m => m.type === metricType);
    }
    
    return {
      metrics: metrics.sort((a, b) => b.timestamp - a.timestamp),
      count: metrics.length,
      timeRange: {
        start: Math.min(...metrics.map(m => m.timestamp)),
        end: Math.max(...metrics.map(m => m.timestamp))
      }
    };
  }

  /**
   * Get performance alerts
   */
  getPerformanceAlerts() {
    const stats = this.getPerformanceStats();
    const alerts = [];
    
    // Load time alerts
    if (stats.loadTimes.average > this.targets.modalLoadTime) {
      alerts.push({
        type: 'performance',
        severity: stats.loadTimes.average > this.targets.modalLoadTime * 2 ? 'high' : 'medium',
        message: `Average modal load time (${stats.loadTimes.average}ms) exceeds target (${this.targets.modalLoadTime}ms)`,
        metric: 'load_time',
        value: stats.loadTimes.average,
        target: this.targets.modalLoadTime
      });
    }
    
    // Cache hit rate alerts
    if (stats.cache.hitRate < this.targets.cacheHitRate) {
      alerts.push({
        type: 'cache',
        severity: stats.cache.hitRate < this.targets.cacheHitRate * 0.5 ? 'high' : 'medium',
        message: `Cache hit rate (${Math.round(stats.cache.hitRate * 100)}%) below target (${Math.round(this.targets.cacheHitRate * 100)}%)`,
        metric: 'cache_hit_rate',
        value: stats.cache.hitRate,
        target: this.targets.cacheHitRate
      });
    }
    
    // Error rate alerts
    if (stats.errors.rate > this.targets.errorRate) {
      alerts.push({
        type: 'errors',
        severity: stats.errors.rate > this.targets.errorRate * 5 ? 'high' : 'medium',
        message: `Error rate (${Math.round(stats.errors.rate * 100)}%) exceeds target (${Math.round(this.targets.errorRate * 100)}%)`,
        metric: 'error_rate',
        value: stats.errors.rate,
        target: this.targets.errorRate
      });
    }
    
    return alerts.sort((a, b) => {
      const severityOrder = { high: 3, medium: 2, low: 1 };
      return severityOrder[b.severity] - severityOrder[a.severity];
    });
  }

  /**
   * Export performance data for analysis
   */
  exportPerformanceData() {
    const stats = this.getPerformanceStats();
    const alerts = this.getPerformanceAlerts();
    const recentMetrics = this.getDetailedMetrics({ maxAge: this.maxMetricsAge });
    
    return {
      exportedAt: Date.now(),
      summary: stats,
      alerts,
      detailedMetrics: recentMetrics,
      targets: this.targets,
      configuration: {
        maxMetricsAge: this.maxMetricsAge,
        maxMetricsCount: this.maxMetricsCount
      }
    };
  }

  /**
   * Reset all metrics
   */
  resetMetrics() {
    this.metrics.clear();
    this.loadTimes = [];
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.errorCounts.clear();
    
    console.log('ModalPerformanceMonitor: All metrics reset');
  }

  /**
   * Update performance targets
   */
  updateTargets(newTargets) {
    this.targets = { ...this.targets, ...newTargets };
    
    console.log('ModalPerformanceMonitor: Updated targets:', this.targets);
  }

  /**
   * Calculate median of array
   */
  calculateMedian(values) {
    if (values.length === 0) return 0;
    
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    
    return sorted.length % 2 === 0 ? 
      (sorted[mid - 1] + sorted[mid]) / 2 : 
      sorted[mid];
  }

  /**
   * Calculate percentile of array
   */
  calculatePercentile(values, percentile) {
    if (values.length === 0) return 0;
    
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    
    return sorted[Math.max(0, index)];
  }

  /**
   * Clean up old metrics
   */
  cleanupOldMetrics() {
    const now = Date.now();
    const cutoff = now - this.maxMetricsAge;
    
    // Clean up main metrics map
    let cleanedCount = 0;
    for (const [key, metric] of this.metrics.entries()) {
      if (metric.timestamp < cutoff) {
        this.metrics.delete(key);
        cleanedCount++;
      }
    }
    
    // Clean up load times array
    this.loadTimes = this.loadTimes.filter(lt => lt.timestamp >= cutoff);
    
    // Enforce max count limit
    if (this.metrics.size > this.maxMetricsCount) {
      const sortedEntries = Array.from(this.metrics.entries())
        .sort(([, a], [, b]) => b.timestamp - a.timestamp);
      
      // Keep only the most recent entries
      this.metrics.clear();
      for (let i = 0; i < this.maxMetricsCount; i++) {
        const [key, value] = sortedEntries[i];
        this.metrics.set(key, value);
      }
      
      cleanedCount += sortedEntries.length - this.maxMetricsCount;
    }
    
    if (cleanedCount > 0) {
      console.log(`ModalPerformanceMonitor: Cleaned up ${cleanedCount} old metrics`);
    }
  }

  /**
   * Start periodic cleanup
   */
  startPeriodicCleanup(intervalMs = 300000) { // 5 minutes
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldMetrics();
    }, intervalMs);
    
    console.log(`ModalPerformanceMonitor: Started periodic cleanup every ${intervalMs / 1000}s`);
  }

  /**
   * Stop periodic cleanup
   */
  stopPeriodicCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('ModalPerformanceMonitor: Stopped periodic cleanup');
    }
  }
}

// Export singleton instance
export const modalPerformanceMonitor = new ModalPerformanceMonitor();
export default ModalPerformanceMonitor;