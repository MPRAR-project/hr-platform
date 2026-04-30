// ConflictResolver - Handle concurrent timesheet edits and data conflicts
import eventBus, { TIMESHEET_EVENTS } from './EventBus';
import { toast } from 'react-toastify';

class ConflictResolver {
  constructor() {
    this.activeConflicts = new Map();
    this.resolutionStrategies = {
      'last_write_wins': this.lastWriteWins.bind(this),
      'merge_changes': this.mergeChanges.bind(this),
      'user_choice': this.userChoice.bind(this),
      'timestamp_priority': this.timestampPriority.bind(this)
    };
    this.debugMode = process.env.NODE_ENV === 'development';
  }

  /**
   * Detect and resolve conflicts between concurrent edits
   * @param {string} updateId - Current update ID
   * @param {Object} currentUpdate - Current update data
   * @param {Object} conflictingUpdate - Conflicting update data
   * @param {string} strategy - Resolution strategy
   */
  async resolveConflict(updateId, currentUpdate, conflictingUpdate, strategy = 'timestamp_priority') {
    try {
      if (this.debugMode) {
        console.log(`[ConflictResolver] Resolving conflict for update: ${updateId}`, {
          currentUpdate,
          conflictingUpdate,
          strategy
        });
      }

      // Check if this conflict is already being resolved
      if (this.activeConflicts.has(updateId)) {
        console.warn(`[ConflictResolver] Conflict ${updateId} is already being resolved`);
        return this.activeConflicts.get(updateId);
      }

      // Mark conflict as active
      const conflictPromise = this.executeResolution(updateId, currentUpdate, conflictingUpdate, strategy);
      this.activeConflicts.set(updateId, conflictPromise);

      const result = await conflictPromise;

      // Clean up active conflict
      this.activeConflicts.delete(updateId);

      // Broadcast resolution event
      eventBus.emit(TIMESHEET_EVENTS.DATA_UPDATED, {
        type: 'conflict_resolved',
        updateId,
        resolution: result,
        timestamp: Date.now()
      });

      return result;

    } catch (error) {
      console.error('[ConflictResolver] Failed to resolve conflict:', error);
      this.activeConflicts.delete(updateId);
      
      return {
        success: false,
        strategy: 'failed',
        error: error.message,
        fallbackToUserChoice: true
      };
    }
  }

  /**
   * Execute the chosen resolution strategy
   */
  async executeResolution(updateId, currentUpdate, conflictingUpdate, strategy) {
    const resolver = this.resolutionStrategies[strategy];
    
    if (!resolver) {
      console.warn(`[ConflictResolver] Unknown strategy: ${strategy}, falling back to timestamp_priority`);
      return this.timestampPriority(updateId, currentUpdate, conflictingUpdate);
    }

    return resolver(updateId, currentUpdate, conflictingUpdate);
  }

  /**
   * Last write wins strategy - most recent update takes precedence
   */
  async lastWriteWins(updateId, currentUpdate, conflictingUpdate) {
    const currentTime = currentUpdate.timestamp || Date.now();
    const conflictingTime = conflictingUpdate.timestamp || 0;

    const winner = currentTime >= conflictingTime ? currentUpdate : conflictingUpdate;
    const loser = winner === currentUpdate ? conflictingUpdate : currentUpdate;

    if (this.debugMode) {
      console.log(`[ConflictResolver] Last write wins: ${winner === currentUpdate ? 'current' : 'conflicting'} update wins`);
    }

    return {
      success: true,
      strategy: 'last_write_wins',
      resolvedUpdate: winner,
      discardedUpdate: loser,
      message: 'Conflict resolved: Most recent changes were kept.'
    };
  }

  /**
   * Merge changes strategy - attempt to merge non-conflicting changes
   */
  async mergeChanges(updateId, currentUpdate, conflictingUpdate) {
    try {
      const mergedUpdate = this.performMerge(currentUpdate, conflictingUpdate);
      
      if (mergedUpdate.hasConflicts) {
        // Fall back to user choice if merge has conflicts
        return this.userChoice(updateId, currentUpdate, conflictingUpdate, mergedUpdate);
      }

      return {
        success: true,
        strategy: 'merge_changes',
        resolvedUpdate: mergedUpdate.data,
        mergedFields: mergedUpdate.mergedFields,
        message: 'Conflict resolved: Changes were merged successfully.'
      };

    } catch (error) {
      console.error('[ConflictResolver] Merge failed:', error);
      
      // Fall back to timestamp priority
      return this.timestampPriority(updateId, currentUpdate, conflictingUpdate);
    }
  }

  /**
   * User choice strategy - let user decide which changes to keep
   */
  async userChoice(updateId, currentUpdate, conflictingUpdate, mergeAttempt = null) {
    return new Promise((resolve) => {
      // Create conflict resolution modal data
      const conflictData = {
        updateId,
        currentUpdate,
        conflictingUpdate,
        mergeAttempt,
        onResolve: (resolution) => {
          resolve({
            success: true,
            strategy: 'user_choice',
            resolvedUpdate: resolution.selectedUpdate,
            userChoice: resolution.choice,
            message: `Conflict resolved: ${resolution.choice === 'current' ? 'Your changes' : 'Other changes'} were kept.`
          });
        },
        onCancel: () => {
          resolve({
            success: false,
            strategy: 'user_choice',
            cancelled: true,
            message: 'Conflict resolution was cancelled.'
          });
        }
      };

      // Emit event for UI to show conflict resolution modal
      eventBus.emit('CONFLICT_RESOLUTION_REQUIRED', conflictData);

      // Show toast notification
      toast.warning('Timesheet conflict detected. Please choose which changes to keep.', {
        autoClose: false,
        closeOnClick: false
      });
    });
  }

  /**
   * Timestamp priority strategy - prioritize based on creation time
   */
  async timestampPriority(updateId, currentUpdate, conflictingUpdate) {
    const currentTime = currentUpdate.metadata?.timestamp || currentUpdate.timestamp || Date.now();
    const conflictingTime = conflictingUpdate.metadata?.timestamp || conflictingUpdate.timestamp || 0;

    // If timestamps are very close (within 1 second), use last write wins
    if (Math.abs(currentTime - conflictingTime) < 1000) {
      return this.lastWriteWins(updateId, currentUpdate, conflictingUpdate);
    }

    const winner = currentTime > conflictingTime ? currentUpdate : conflictingUpdate;
    const loser = winner === currentUpdate ? conflictingUpdate : currentUpdate;

    return {
      success: true,
      strategy: 'timestamp_priority',
      resolvedUpdate: winner,
      discardedUpdate: loser,
      message: 'Conflict resolved: Earlier changes were preserved.'
    };
  }

  /**
   * Perform intelligent merge of two updates
   */
  performMerge(currentUpdate, conflictingUpdate) {
    const merged = {
      data: { ...currentUpdate },
      mergedFields: [],
      hasConflicts: false,
      conflicts: []
    };

    try {
      // Merge day edits
      if (currentUpdate.dayEdits && conflictingUpdate.dayEdits) {
        const mergedDayEdits = this.mergeDayEdits(
          currentUpdate.dayEdits,
          conflictingUpdate.dayEdits
        );
        
        merged.data.dayEdits = mergedDayEdits.data;
        merged.mergedFields.push(...mergedDayEdits.mergedFields);
        
        if (mergedDayEdits.hasConflicts) {
          merged.hasConflicts = true;
          merged.conflicts.push(...mergedDayEdits.conflicts);
        }
      }

      // Merge metadata
      merged.data.metadata = {
        ...currentUpdate.metadata,
        ...conflictingUpdate.metadata,
        mergedAt: Date.now(),
        mergeStrategy: 'intelligent_merge'
      };

      return merged;

    } catch (error) {
      console.error('[ConflictResolver] Merge operation failed:', error);
      return {
        data: currentUpdate,
        mergedFields: [],
        hasConflicts: true,
        conflicts: [{ type: 'merge_error', error: error.message }]
      };
    }
  }

  /**
   * Merge day edits from two updates
   */
  mergeDayEdits(currentEdits, conflictingEdits) {
    const merged = {
      data: [...currentEdits],
      mergedFields: [],
      hasConflicts: false,
      conflicts: []
    };

    const currentEditsByDate = new Map(currentEdits.map(edit => [edit.date, edit]));
    const conflictingEditsByDate = new Map(conflictingEdits.map(edit => [edit.date, edit]));

    // Process conflicting edits
    for (const [date, conflictingEdit] of conflictingEditsByDate) {
      const currentEdit = currentEditsByDate.get(date);

      if (!currentEdit) {
        // No conflict - add the conflicting edit
        merged.data.push(conflictingEdit);
        merged.mergedFields.push(`${date}: added new entry`);
      } else {
        // Potential conflict - merge individual fields
        const fieldMerge = this.mergeEditFields(currentEdit, conflictingEdit, date);
        
        if (fieldMerge.hasConflicts) {
          merged.hasConflicts = true;
          merged.conflicts.push(...fieldMerge.conflicts);
        } else {
          // Update the merged edit
          const editIndex = merged.data.findIndex(edit => edit.date === date);
          if (editIndex >= 0) {
            merged.data[editIndex] = fieldMerge.mergedEdit;
            merged.mergedFields.push(...fieldMerge.mergedFields);
          }
        }
      }
    }

    return merged;
  }

  /**
   * Merge individual fields of day edits
   */
  mergeEditFields(currentEdit, conflictingEdit, date) {
    const merged = {
      mergedEdit: { ...currentEdit },
      mergedFields: [],
      hasConflicts: false,
      conflicts: []
    };

    const fields = ['clockIn', 'clockOut', 'breakMin', 'notes'];

    for (const field of fields) {
      const currentValue = currentEdit[field];
      const conflictingValue = conflictingEdit[field];

      // Skip if values are the same
      if (currentValue === conflictingValue) {
        continue;
      }

      // Handle empty values
      if (!currentValue && conflictingValue) {
        merged.mergedEdit[field] = conflictingValue;
        merged.mergedFields.push(`${date}.${field}: added value`);
        continue;
      }

      if (currentValue && !conflictingValue) {
        // Keep current value
        continue;
      }

      // Both have values - this is a conflict
      if (currentValue && conflictingValue) {
        merged.hasConflicts = true;
        merged.conflicts.push({
          type: 'field_conflict',
          date,
          field,
          currentValue,
          conflictingValue
        });
      }
    }

    return merged;
  }

  /**
   * Check if two updates conflict
   */
  hasConflict(update1, update2) {
    // Check if updates affect the same user and week
    if (update1.userId !== update2.userId || update1.weekStart !== update2.weekStart) {
      return false;
    }

    // Check if updates affect the same days
    const dates1 = new Set(update1.dayEdits?.map(edit => edit.date) || []);
    const dates2 = new Set(update2.dayEdits?.map(edit => edit.date) || []);

    // Find overlapping dates
    const overlappingDates = [...dates1].filter(date => dates2.has(date));

    return overlappingDates.length > 0;
  }

  /**
   * Get active conflicts
   */
  getActiveConflicts() {
    return Array.from(this.activeConflicts.keys());
  }

  /**
   * Clear all active conflicts
   */
  clearActiveConflicts() {
    this.activeConflicts.clear();
  }

  /**
   * Get conflict resolution statistics
   */
  getStats() {
    return {
      activeConflicts: this.activeConflicts.size,
      availableStrategies: Object.keys(this.resolutionStrategies)
    };
  }
}

// Create and export singleton instance
const conflictResolver = new ConflictResolver();

export default conflictResolver;
export { ConflictResolver };