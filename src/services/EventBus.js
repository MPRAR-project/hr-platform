// EventBus system for inter-component communication
class EventBus {
  constructor() {
    this.listeners = new Map();
    this.debugMode = process.env.NODE_ENV === 'development';
  }

  /**
   * Emit an event to all registered listeners
   * @param {string} eventType - The type of event to emit
   * @param {any} data - The data to send with the event
   */
  emit(eventType, data) {
    if (this.debugMode) {
      console.log(`[EventBus] Emitting event: ${eventType}`, data);
    }

    const eventListeners = this.listeners.get(eventType);
    if (!eventListeners || eventListeners.size === 0) {
      if (this.debugMode) {
        console.log(`[EventBus] No listeners for event: ${eventType}`);
      }
      return;
    }

    // Create a copy of listeners to avoid issues if listeners are modified during emission
    const listenersArray = Array.from(eventListeners);
    
    listenersArray.forEach(({ callback, componentId }) => {
      try {
        callback(data, eventType);
      } catch (error) {
        console.error(`[EventBus] Error in listener for ${eventType} (component: ${componentId}):`, error);
      }
    });
  }

  /**
   * Register an event listener
   * @param {string} eventType - The type of event to listen for
   * @param {Function} callback - The callback function to execute
   * @param {string} componentId - Unique identifier for the component
   */
  on(eventType, callback, componentId = 'unknown') {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }

    const listener = { callback, componentId };
    this.listeners.get(eventType).add(listener);

    if (this.debugMode) {
      console.log(`[EventBus] Registered listener for ${eventType} (component: ${componentId})`);
    }

    // Return unsubscribe function
    return () => this.off(eventType, callback, componentId);
  }

  /**
   * Unregister an event listener
   * @param {string} eventType - The type of event to stop listening for
   * @param {Function} callback - The callback function to remove
   * @param {string} componentId - Component identifier
   */
  off(eventType, callback, componentId = 'unknown') {
    const eventListeners = this.listeners.get(eventType);
    if (!eventListeners) return;

    // Find and remove the specific listener
    for (const listener of eventListeners) {
      if (listener.callback === callback && listener.componentId === componentId) {
        eventListeners.delete(listener);
        if (this.debugMode) {
          console.log(`[EventBus] Unregistered listener for ${eventType} (component: ${componentId})`);
        }
        break;
      }
    }

    // Clean up empty event type
    if (eventListeners.size === 0) {
      this.listeners.delete(eventType);
    }
  }

  /**
   * Remove all listeners for a specific component
   * @param {string} componentId - Component identifier
   */
  removeAllListeners(componentId) {
    let removedCount = 0;
    
    for (const [eventType, listeners] of this.listeners.entries()) {
      const listenersToRemove = Array.from(listeners).filter(
        listener => listener.componentId === componentId
      );
      
      listenersToRemove.forEach(listener => {
        listeners.delete(listener);
        removedCount++;
      });

      // Clean up empty event types
      if (listeners.size === 0) {
        this.listeners.delete(eventType);
      }
    }

    if (this.debugMode && removedCount > 0) {
      console.log(`[EventBus] Removed ${removedCount} listeners for component: ${componentId}`);
    }
  }

  /**
   * Get statistics about current listeners
   */
  getStats() {
    const stats = {
      totalEventTypes: this.listeners.size,
      totalListeners: 0,
      eventTypes: {}
    };

    for (const [eventType, listeners] of this.listeners.entries()) {
      stats.totalListeners += listeners.size;
      stats.eventTypes[eventType] = {
        listenerCount: listeners.size,
        components: Array.from(listeners).map(l => l.componentId)
      };
    }

    return stats;
  }

  /**
   * Clear all listeners (useful for testing)
   */
  clear() {
    this.listeners.clear();
    if (this.debugMode) {
      console.log('[EventBus] Cleared all listeners');
    }
  }
}

// Event type constants for timesheet operations
export const TIMESHEET_EVENTS = {
  // Edit events
  EDIT_STARTED: 'timesheet:edit:started',
  EDIT_UPDATED: 'timesheet:edit:updated',
  EDIT_SAVED: 'timesheet:edit:saved',
  EDIT_FAILED: 'timesheet:edit:failed',
  EDIT_CANCELLED: 'timesheet:edit:cancelled',

  // Data events
  DATA_UPDATED: 'timesheet:data:updated',
  DATA_INVALIDATED: 'timesheet:data:invalidated',
  DATA_REFRESHED: 'timesheet:data:refreshed',

  // Status events
  STATUS_CHANGED: 'timesheet:status:changed',
  SUBMISSION_COMPLETED: 'timesheet:submission:completed',
  APPROVAL_UPDATED: 'timesheet:approval:updated',

  // Cache events
  CACHE_INVALIDATED: 'timesheet:cache:invalidated',
  CACHE_UPDATED: 'timesheet:cache:updated'
};

// Emitted when Settings saves a new Week Starting day so Time Entries can update without refresh
export const WEEK_START_UPDATED = 'settings:weekStart:updated';

// Create and export singleton instance
const eventBus = new EventBus();

export default eventBus;
export { EventBus };