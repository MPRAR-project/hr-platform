/**
 * ValidationCache - Caches validation results to avoid repeated expensive checks
 * Reduces the need to run consistency checks and deduplication on every modal open
 */
class ValidationCache {
  constructor() {
    this.cache = new Map();
    this.defaultTTL = 3600000; // 1 hour default TTL
    this.maxCacheSize = 1000; // Prevent memory leaks
    this.cleanupInterval = null;
    
    // Start periodic cleanup
    this.startPeriodicCleanup();
  }

  /**
   * Cache validation results with TTL
   */
  cacheValidationResult(userId, weekStart, result, ttl = null) {
    const key = this._generateKey(userId, weekStart);
    const expiresAt = Date.now() + (ttl || this.defaultTTL);
    
    const cacheEntry = {
      userId,
      weekStart,
      result: {
        ...result,
        cachedAt: Date.now()
      },
      expiresAt,
      accessCount: 0,
      lastAccessed: Date.now()
    };
    
    // Enforce cache size limit
    if (this.cache.size >= this.maxCacheSize) {
      this._evictOldestEntries(Math.floor(this.maxCacheSize * 0.1)); // Remove 10%
    }
    
    this.cache.set(key, cacheEntry);
    
    console.log(`ValidationCache: Cached validation result for ${userId}, week ${weekStart}, expires in ${Math.round((ttl || this.defaultTTL) / 1000)}s`);
    
    return cacheEntry;
  }

  /**
   * Check if validation is needed based on cache status
   */
  isValidationNeeded(userId, weekStart, options = {}) {
    const { 
      forceValidation = false,
      maxAge = null,
      requireConsistency = false 
    } = options;
    
    if (forceValidation) {
      return true;
    }
    
    const cached = this.getCachedValidation(userId, weekStart);
    
    if (!cached) {
      return true; // No cache, validation needed
    }
    
    // Check if cache is too old
    if (maxAge && (Date.now() - cached.result.cachedAt) > maxAge) {
      return true;
    }
    
    // Check if consistency is required and cache shows inconsistency
    if (requireConsistency && !cached.result.isConsistent) {
      return true;
    }
    
    // Check if there were critical issues that need re-validation
    if (cached.result.issues && cached.result.issues.some(issue => issue.severity === 'critical')) {
      return true;
    }
    
    return false; // Cache is valid, no validation needed
  }

  /**
   * Get cached validation status
   */
  getCachedValidation(userId, weekStart) {
    const key = this._generateKey(userId, weekStart);
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }
    
    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      console.log(`ValidationCache: Expired cache entry removed for ${userId}, week ${weekStart}`);
      return null;
    }
    
    // Update access statistics
    entry.accessCount++;
    entry.lastAccessed = Date.now();
    
    console.log(`ValidationCache: Cache hit for ${userId}, week ${weekStart} (accessed ${entry.accessCount} times)`);
    
    return entry;
  }

  /**
   * Update existing cache entry with new validation results
   */
  updateValidationResult(userId, weekStart, updates) {
    const key = this._generateKey(userId, weekStart);
    const entry = this.cache.get(key);
    
    if (!entry) {
      console.warn(`ValidationCache: Attempted to update non-existent cache entry for ${userId}, week ${weekStart}`);
      return null;
    }
    
    // Merge updates with existing result
    entry.result = {
      ...entry.result,
      ...updates,
      updatedAt: Date.now()
    };
    
    console.log(`ValidationCache: Updated cache entry for ${userId}, week ${weekStart}`);
    
    return entry;
  }

  /**
   * Invalidate cache entry for specific user and week
   */
  invalidateValidation(userId, weekStart) {
    const key = this._generateKey(userId, weekStart);
    const deleted = this.cache.delete(key);
    
    if (deleted) {
      console.log(`ValidationCache: Invalidated cache entry for ${userId}, week ${weekStart}`);
    }
    
    return deleted;
  }

  /**
   * Invalidate all cache entries for a specific user
   */
  invalidateUserValidations(userId) {
    let deletedCount = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.userId === userId) {
        this.cache.delete(key);
        deletedCount++;
      }
    }
    
    console.log(`ValidationCache: Invalidated ${deletedCount} cache entries for user ${userId}`);
    
    return deletedCount;
  }

  /**
   * Get validation summary for a user across all weeks
   */
  getUserValidationSummary(userId) {
    const userEntries = [];
    
    for (const entry of this.cache.values()) {
      if (entry.userId === userId) {
        userEntries.push({
          weekStart: entry.weekStart,
          isConsistent: entry.result.isConsistent,
          hasDuplicates: entry.result.hasDuplicates,
          issueCount: entry.result.issues ? entry.result.issues.length : 0,
          cachedAt: entry.result.cachedAt,
          accessCount: entry.accessCount
        });
      }
    }
    
    return {
      userId,
      totalWeeks: userEntries.length,
      consistentWeeks: userEntries.filter(e => e.isConsistent).length,
      weeksWithDuplicates: userEntries.filter(e => e.hasDuplicates).length,
      totalIssues: userEntries.reduce((sum, e) => sum + e.issueCount, 0),
      entries: userEntries.sort((a, b) => b.cachedAt - a.cachedAt)
    };
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats() {
    const now = Date.now();
    let totalEntries = 0;
    let expiredEntries = 0;
    let consistentEntries = 0;
    let entriesWithDuplicates = 0;
    let totalAccessCount = 0;
    let oldestEntry = now;
    let newestEntry = 0;
    
    for (const entry of this.cache.values()) {
      totalEntries++;
      totalAccessCount += entry.accessCount;
      
      if (now > entry.expiresAt) {
        expiredEntries++;
      }
      
      if (entry.result.isConsistent) {
        consistentEntries++;
      }
      
      if (entry.result.hasDuplicates) {
        entriesWithDuplicates++;
      }
      
      if (entry.result.cachedAt < oldestEntry) {
        oldestEntry = entry.result.cachedAt;
      }
      
      if (entry.result.cachedAt > newestEntry) {
        newestEntry = entry.result.cachedAt;
      }
    }
    
    return {
      totalEntries,
      expiredEntries,
      consistentEntries,
      entriesWithDuplicates,
      totalAccessCount,
      averageAccessCount: totalEntries > 0 ? totalAccessCount / totalEntries : 0,
      oldestEntryAge: totalEntries > 0 ? now - oldestEntry : 0,
      newestEntryAge: totalEntries > 0 ? now - newestEntry : 0,
      memoryUsage: this._estimateMemoryUsage()
    };
  }

  /**
   * Clean up expired entries
   */
  cleanup() {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`ValidationCache: Cleaned up ${cleanedCount} expired entries`);
    }
    
    return cleanedCount;
  }

  /**
   * Start periodic cleanup of expired entries
   */
  startPeriodicCleanup(intervalMs = 300000) { // 5 minutes default
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, intervalMs);
    
    console.log(`ValidationCache: Started periodic cleanup every ${intervalMs / 1000}s`);
  }

  /**
   * Stop periodic cleanup
   */
  stopPeriodicCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('ValidationCache: Stopped periodic cleanup');
    }
  }

  /**
   * Clear all cache entries
   */
  clear() {
    const size = this.cache.size;
    this.cache.clear();
    console.log(`ValidationCache: Cleared ${size} cache entries`);
    return size;
  }

  /**
   * Generate cache key for user and week
   */
  _generateKey(userId, weekStart) {
    return `validation:${userId}:${weekStart}`;
  }

  /**
   * Evict oldest entries based on last access time
   */
  _evictOldestEntries(count) {
    const entries = Array.from(this.cache.entries())
      .sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed);
    
    let evictedCount = 0;
    for (let i = 0; i < Math.min(count, entries.length); i++) {
      const [key] = entries[i];
      this.cache.delete(key);
      evictedCount++;
    }
    
    console.log(`ValidationCache: Evicted ${evictedCount} oldest entries to manage cache size`);
    return evictedCount;
  }

  /**
   * Estimate memory usage of cache
   */
  _estimateMemoryUsage() {
    let totalSize = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      // Rough estimation: key + entry object
      totalSize += key.length * 2; // UTF-16 characters
      totalSize += JSON.stringify(entry).length * 2; // Rough object size
    }
    
    return totalSize; // Bytes
  }

  /**
   * Export cache data for backup/analysis
   */
  exportCacheData() {
    const data = [];
    
    for (const entry of this.cache.values()) {
      data.push({
        userId: entry.userId,
        weekStart: entry.weekStart,
        result: entry.result,
        expiresAt: entry.expiresAt,
        accessCount: entry.accessCount,
        lastAccessed: entry.lastAccessed
      });
    }
    
    return {
      exportedAt: Date.now(),
      totalEntries: data.length,
      data
    };
  }

  /**
   * Import cache data from backup
   */
  importCacheData(exportData) {
    if (!exportData || !exportData.data) {
      throw new Error('Invalid export data format');
    }
    
    let importedCount = 0;
    const now = Date.now();
    
    for (const entry of exportData.data) {
      // Skip expired entries
      if (now > entry.expiresAt) {
        continue;
      }
      
      const key = this._generateKey(entry.userId, entry.weekStart);
      this.cache.set(key, entry);
      importedCount++;
    }
    
    console.log(`ValidationCache: Imported ${importedCount} cache entries`);
    return importedCount;
  }
}

// Export singleton instance
export const validationCache = new ValidationCache();
export default ValidationCache;