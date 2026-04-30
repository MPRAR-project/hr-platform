// Utility functions for consistent time format handling

/**
 * Convert time string to 24-hour format
 * @param {string} timeStr - Time string in various formats (e.g., "02:52PM", "14:52", "2:52 PM")
 * @returns {string} - Time in 24-hour format (e.g., "14:52")
 */
export function convertTo24Hour(timeStr) {
  if (!timeStr) return '';
  
  try {
    // Clean up the input string
    const cleanTime = timeStr.trim().toUpperCase();
    
    // Check if it's already in 24-hour format (no AM/PM)
    if (!cleanTime.includes('AM') && !cleanTime.includes('PM')) {
      // Validate 24-hour format
      const [hours, minutes] = cleanTime.split(':');
      const h = parseInt(hours);
      const m = parseInt(minutes);
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      }
    }
    
    // Handle 12-hour format with flexible spacing
    const match = cleanTime.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/);
    if (!match) {
      throw new Error(`Invalid time format: ${timeStr}`);
    }
    
    const [, hours, minutes, period] = match;
    let hour24 = parseInt(hours);
    
    if (period === 'PM' && hour24 !== 12) {
      hour24 += 12;
    } else if (period === 'AM' && hour24 === 12) {
      hour24 = 0;
    }
    
    const result = `${hour24.toString().padStart(2, '0')}:${minutes}`;
    
    // Critical check: Ensure PM times don't become AM
    if (period === 'PM' && hour24 < 12 && hour24 !== 0) {
      console.error('[TimeFormatUtils] CRITICAL: PM time incorrectly converted!', {
        original: timeStr,
        converted: result,
        period,
        hour24,
        timestamp: new Date().toISOString()
      });
    }
    
    return result;
  } catch (error) {
    // Error converting time to 24-hour format
    return timeStr; // Return original if conversion fails
  }
}

/**
 * Convert time string to 12-hour format
 * @param {string} timeStr - Time string in various formats
 * @returns {string} - Time in 12-hour format (e.g., "02:52 PM")
 */
export function convertTo12Hour(timeStr) {
  if (!timeStr) return '';
  
  try {
    // First convert to 24-hour format to normalize
    const time24 = convertTo24Hour(timeStr);
    if (!time24) return timeStr;
    
    const [hours, minutes] = time24.split(':');
    const h = parseInt(hours);
    let hour12 = h;
    let period = 'AM';
    
    if (h === 0) {
      hour12 = 12;
    } else if (h === 12) {
      period = 'PM';
    } else if (h > 12) {
      hour12 = h - 12;
      period = 'PM';
    }
    
    return `${hour12.toString().padStart(2, '0')}:${minutes} ${period}`;
  } catch (error) {
    // Error converting time to 12-hour format
    return timeStr; // Return original if conversion fails
  }
}

/**
 * Format time for display in components
 * @param {string} timeStr - Time string in any format
 * @param {boolean} use12Hour - Whether to use 12-hour format (default: true)
 * @returns {string} - Formatted time string
 */
export function formatTimeForDisplay(timeStr, use12Hour = true) {
  if (!timeStr) return '';
  return use12Hour ? convertTo12Hour(timeStr) : convertTo24Hour(timeStr);
}

/**
 * Create a Date object from date and time strings
 * @param {string} dateStr - Date string (e.g., "2025-01-13")
 * @param {string} timeStr - Time string in any format
 * @returns {Date} - Date object
 */
export function createDateTimeFromStrings(dateStr, timeStr) {
  if (!dateStr || !timeStr) {
    throw new Error('Both date and time are required');
  }
  
  const time24 = convertTo24Hour(timeStr);
  return new Date(`${dateStr}T${time24}:00`);
}

/**
 * Validate time string format
 * @param {string} timeStr - Time string to validate
 * @returns {boolean} - Whether the time string is valid
 */
export function isValidTimeFormat(timeStr) {
  if (!timeStr) return false;
  
  try {
    const time24 = convertTo24Hour(timeStr);
    const [hours, minutes] = time24.split(':');
    const h = parseInt(hours);
    const m = parseInt(minutes);
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
  } catch (error) {
    return false;
  }
}

/**
 * Calculate duration between two time strings
 * @param {string} startTime - Start time string
 * @param {string} endTime - End time string
 * @param {string} date - Date string (optional, defaults to today)
 * @returns {number} - Duration in seconds
 */
export function calculateDuration(startTime, endTime, date = null) {
  if (!startTime || !endTime) return 0;
  
  try {
    const dateStr = date || new Date().toISOString().split('T')[0];
    const startDateTime = createDateTimeFromStrings(dateStr, startTime);
    const endDateTime = createDateTimeFromStrings(dateStr, endTime);
    
    if (endDateTime <= startDateTime) {
      return 0; // Invalid time range
    }
    
    return Math.floor((endDateTime - startDateTime) / 1000);
  } catch (error) {
    // Error calculating duration:
    return 0;
  }
}

/**
 * Format seconds into human-readable time duration
 * @param {number} seconds - Duration in seconds
 * @returns {string} - Formatted duration (e.g., "8h 30m")
 */
export function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '0h 0m';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  return `${hours}h ${minutes}m`;
}

/**
 * Parse time string and return hours and minutes as numbers
 * @param {string} timeStr - Time string in any format
 * @returns {Object} - Object with hours and minutes properties
 */
export function parseTime(timeStr) {
  if (!timeStr) return { hours: 0, minutes: 0 };
  
  try {
    const time24 = convertTo24Hour(timeStr);
    const [hours, minutes] = time24.split(':');
    return {
      hours: parseInt(hours),
      minutes: parseInt(minutes)
    };
  } catch (error) {
    // Error parsing time:
    return { hours: 0, minutes: 0 };
  }
}