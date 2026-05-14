import hrApiClient from '../lib/hrApiClient';

/**
 * Shift Service (Phase 4 — REST Migration)
 * 
 * Handles shift preference updates via the HR REST API.
 * Supports Day Shift and Night Shift.
 */

export const SHIFT_TYPES = {
  DAY: 'day',
  NIGHT: 'night'
};

/**
 * Get user's current shift preference
 */
export async function getUserShift(userId) {
  try {
    const { data } = await hrApiClient.get('/hr/employees/me');
    return data.shift || SHIFT_TYPES.DAY;
  } catch (error) {
    console.error('[shiftService] Error getting user shift:', error);
    return SHIFT_TYPES.DAY;
  }
}

/**
 * Update user's shift preference
 */
export async function updateUserShift(userId, shift) {
  try {
    if (shift !== SHIFT_TYPES.DAY && shift !== SHIFT_TYPES.NIGHT) {
      throw new Error('Invalid shift type. Must be "day" or "night"');
    }
    
    const { data } = await hrApiClient.put('/hr/employees/me/shift', { shift });
    return data;
  } catch (error) {
    console.error('[shiftService] Error updating user shift:', error);
    throw error;
  }
}

/**
 * Detect if clock-in time suggests a shift change
 */
export function detectShiftChange(clockInTime, currentShift) {
  const hour = clockInTime.getHours();
  const minute = clockInTime.getMinutes();
  const timeInMinutes = hour * 60 + minute;
  
  const EVENING_THRESHOLD = 17 * 60; // 5:00 PM
  const MORNING_THRESHOLD = 12 * 60; // 12:00 PM
  
  if (currentShift === SHIFT_TYPES.DAY) {
    if (timeInMinutes >= EVENING_THRESHOLD) {
      return {
        shouldPrompt: true,
        suggestedShift: SHIFT_TYPES.NIGHT,
        reason: 'You are clocking in during evening hours. Are you starting a night shift?'
      };
    }
  } else if (currentShift === SHIFT_TYPES.NIGHT) {
    if (timeInMinutes < MORNING_THRESHOLD) {
      return {
        shouldPrompt: true,
        suggestedShift: SHIFT_TYPES.DAY,
        reason: 'You are clocking in during morning hours. Are you starting a day shift?'
      };
    }
  }
  
  return { shouldPrompt: false, suggestedShift: null, reason: null };
}

/**
 * Format shift name for display
 */
export function formatShiftName(shift) {
  if (shift === SHIFT_TYPES.DAY) return 'Day Shift';
  if (shift === SHIFT_TYPES.NIGHT) return 'Night Shift';
  return 'Day Shift';
}
