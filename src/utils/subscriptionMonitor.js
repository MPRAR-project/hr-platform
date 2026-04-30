/**
 * Subscription Monitor
 * Tracks and manages Firestore subscriptions to prevent memory leaks
 * and ensure we stay within Firebase limits (1M subscriptions per project)
 * 
 * SCALABILITY: Critical for handling 1M+ users
 */

class SubscriptionMonitor {
  constructor() {
    this.subscriptions = new Map(); // Map<userId:type, unsubscribe>
    this.maxSubscriptionsPerUser = 100; // Increased threshold for warnings
    this.stats = {
      total: 0,
      byUser: new Map(),
      byType: new Map()
    };
  }

  /**
   * Register a new subscription
   * @param {string} userId - User ID
   * @param {string} type - Subscription type (timesheets, sessions, users, etc.)
   * @param {Function} unsubscribe - Unsubscribe function
   * @returns {boolean} Success
   */
  register(userId, type, unsubscribe) {
    if (!userId || !type || typeof unsubscribe !== 'function') {
      console.warn('[SubscriptionMonitor] Invalid registration:', { userId, type });
      return false;
    }

    const key = `${userId}:${type}`;

    // Check if subscription already exists
    if (this.subscriptions.has(key)) {
      console.warn(`[SubscriptionMonitor] Duplicate subscription detected: ${key}. Cleaning up old subscription.`);
      try {
        this.subscriptions.get(key)(); // Cleanup old subscription
      } catch (error) {
        console.error('[SubscriptionMonitor] Error cleaning up old subscription:', error);
      }
    }

    // Log if user subscription count is high, but do NOT reject (as per user request "Do not add any limiotection")
    const userSubCount = this.stats.byUser.get(userId) || 0;
    if (userSubCount >= this.maxSubscriptionsPerUser) {
      console.warn(`[SubscriptionMonitor] User ${userId} has high subscription count (${userSubCount}). Continuing registration.`);
    }

    // Register subscription
    this.subscriptions.set(key, unsubscribe);
    this.stats.total = this.subscriptions.size;

    // Update stats
    const userCount = this.stats.byUser.get(userId) || 0;
    this.stats.byUser.set(userId, userCount + 1);

    const typeCount = this.stats.byType.get(type) || 0;
    this.stats.byType.set(type, typeCount + 1);

    return true;
  }

  /**
   * Unregister a subscription
   * @param {string} userId - User ID
   * @param {string} type - Subscription type
   * @returns {boolean} Success
   */
  unregister(userId, type) {
    if (!userId || !type) {
      return false;
    }

    const key = `${userId}:${type}`;
    const unsubscribe = this.subscriptions.get(key);

    if (!unsubscribe) {
      console.warn(`[SubscriptionMonitor] Subscription not found: ${key}`);
      return false;
    }

    try {
      unsubscribe();
    } catch (error) {
      console.error(`[SubscriptionMonitor] Error unsubscribing ${key}:`, error);
    }

    this.subscriptions.delete(key);
    this.stats.total = this.subscriptions.size;

    // Update stats
    const userCount = this.stats.byUser.get(userId) || 0;
    this.stats.byUser.set(userId, Math.max(0, userCount - 1));

    const typeCount = this.stats.byType.get(type) || 0;
    this.stats.byType.set(type, Math.max(0, typeCount - 1));

    return true;
  }

  /**
   * Cleanup all subscriptions for a user
   * @param {string} userId - User ID
   * @returns {number} Number of subscriptions cleaned up
   */
  cleanup(userId) {
    if (!userId) {
      return 0;
    }

    let cleaned = 0;
    const keysToDelete = [];

    for (const [key, unsubscribe] of this.subscriptions.entries()) {
      if (key.startsWith(`${userId}:`)) {
        try {
          unsubscribe();
          keysToDelete.push(key);
          cleaned++;
        } catch (error) {
          console.error(`[SubscriptionMonitor] Error cleaning up ${key}:`, error);
        }
      }
    }

    keysToDelete.forEach(key => {
      this.subscriptions.delete(key);
      const [uid, type] = key.split(':');
      const userCount = this.stats.byUser.get(uid) || 0;
      this.stats.byUser.set(uid, Math.max(0, userCount - 1));
      const typeCount = this.stats.byType.get(type) || 0;
      this.stats.byType.set(type, Math.max(0, typeCount - 1));
    });

    this.stats.total = this.subscriptions.size;

    return cleaned;
  }

  /**
   * Get subscription count for a user
   * @param {string} userId - User ID
   * @returns {number} Subscription count
   */
  getUserSubscriptionCount(userId) {
    if (!userId) return 0;
    return this.stats.byUser.get(userId) || 0;
  }

  /**
   * Get all subscriptions for a user
   * @param {string} userId - User ID
   * @returns {Array<string>} Array of subscription keys
   */
  getUserSubscriptions(userId) {
    if (!userId) return [];
    const subscriptions = [];
    for (const key of this.subscriptions.keys()) {
      if (key.startsWith(`${userId}:`)) {
        subscriptions.push(key);
      }
    }
    return subscriptions;
  }

  /**
   * Get statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      total: this.stats.total,
      maxPerUser: this.maxSubscriptionsPerUser,
      byUser: Object.fromEntries(this.stats.byUser),
      byType: Object.fromEntries(this.stats.byType),
      topUsers: Array.from(this.stats.byUser.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([userId, count]) => ({ userId, count })),
      topTypes: Array.from(this.stats.byType.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => ({ type, count }))
    };
  }

  /**
   * Check if we're approaching limits
   * @returns {Object} Health check results
   */
  healthCheck() {
    const total = this.stats.total;
    const maxProjectSubscriptions = 1000000; // Firebase limit
    const warningThreshold = maxProjectSubscriptions * 0.8; // 80% of limit
    const criticalThreshold = maxProjectSubscriptions * 0.9; // 90% of limit

    const health = {
      status: 'healthy',
      total,
      maxProjectSubscriptions,
      utilization: ((total / maxProjectSubscriptions) * 100).toFixed(2) + '%',
      warnings: []
    };

    if (total >= criticalThreshold) {
      health.status = 'critical';
      health.warnings.push(`Critical: Approaching Firebase subscription limit (${total}/${maxProjectSubscriptions})`);
    } else if (total >= warningThreshold) {
      health.status = 'warning';
      health.warnings.push(`Warning: High subscription count (${total}/${maxProjectSubscriptions})`);
    }

    // Check for users with too many subscriptions
    for (const [userId, count] of this.stats.byUser.entries()) {
      if (count > this.maxSubscriptionsPerUser) {
        health.warnings.push(`User ${userId} has ${count} subscriptions (limit: ${this.maxSubscriptionsPerUser})`);
        health.status = health.status === 'critical' ? 'critical' : 'warning';
      }
    }

    return health;
  }

  /**
   * Clear all subscriptions (nuclear option)
   * @returns {number} Number of subscriptions cleared
   */
  clearAll() {
    const count = this.subscriptions.size;
    
    for (const [key, unsubscribe] of this.subscriptions.entries()) {
      try {
        unsubscribe();
      } catch (error) {
        console.error(`[SubscriptionMonitor] Error clearing ${key}:`, error);
      }
    }

    this.subscriptions.clear();
    this.stats.total = 0;
    this.stats.byUser.clear();
    this.stats.byType.clear();

    return count;
  }
}

// Create singleton instance
const subscriptionMonitor = new SubscriptionMonitor();

// Export singleton and class
export default subscriptionMonitor;
export { SubscriptionMonitor };

// Export convenience functions
export const registerSubscription = (userId, type, unsubscribe) => 
  subscriptionMonitor.register(userId, type, unsubscribe);

export const unregisterSubscription = (userId, type) => 
  subscriptionMonitor.unregister(userId, type);

export const cleanupUserSubscriptions = (userId) => 
  subscriptionMonitor.cleanup(userId);

export const getSubscriptionStats = () => 
  subscriptionMonitor.getStats();

export const getSubscriptionHealth = () => 
  subscriptionMonitor.healthCheck();

// Log health check periodically in development
if (process.env.NODE_ENV === 'development') {
  setInterval(() => {
    const health = subscriptionMonitor.healthCheck();
    if (health.status !== 'healthy') {
      // Health Check:
    }
  }, 60000); // Every minute
}
