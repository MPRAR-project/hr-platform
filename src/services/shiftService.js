import { db } from '../firebase/client';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';

/**
 * Shift Service - Handles shift detection and updates
 * Supports Day Shift and Night Shift
 */

export const SHIFT_TYPES = {
  DAY: 'day',
  NIGHT: 'night'
};

/**
 * Get user's current shift preference
 * @param {string} userId - User ID
 * @returns {Promise<string>} Shift type ('day' or 'night'), defaults to 'day'
 */
export async function getUserShift(userId) {
  try {
    if (!userId) return SHIFT_TYPES.DAY;
    
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);
    
    if (userSnap.exists()) {
      const userData = userSnap.data();
      return userData.shift || SHIFT_TYPES.DAY; // Default to day shift
    }
    
    return SHIFT_TYPES.DAY;
  } catch (error) {
    console.error('Error getting user shift:', error);
    return SHIFT_TYPES.DAY; // Default to day shift on error
  }
}

/**
 * Update user's shift preference
 * @param {string} userId - User ID
 * @param {string} shift - Shift type ('day' or 'night')
 * @returns {Promise<Object>} Success response
 */
export async function updateUserShift(userId, shift) {
  try {
    if (!userId) throw new Error('User ID is required');
    if (shift !== SHIFT_TYPES.DAY && shift !== SHIFT_TYPES.NIGHT) {
      throw new Error('Invalid shift type. Must be "day" or "night"');
    }
    
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, {
      shift,
      shiftUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    
    console.log(`User ${userId} shift updated to: ${shift}`);
    return { success: true, shift };
  } catch (error) {
    console.error('Error updating user shift:', error);
    throw error;
  }
}

/**
 * Detect if clock-in time suggests a shift change
 * @param {Date} clockInTime - Clock-in time
 * @param {string} currentShift - Current shift ('day' or 'night')
 * @returns {Object} Detection result with shouldPrompt flag and suggested shift
 */
export function detectShiftChange(clockInTime, currentShift) {
  const hour = clockInTime.getHours();
  const minute = clockInTime.getMinutes();
  const timeInMinutes = hour * 60 + minute;
  
  // Day shift typically: 06:00 - 18:00 (360 - 1080 minutes)
  // Night shift typically: 18:00 - 06:00 (1080 - 1440 or 0 - 360 minutes)
  // Evening threshold: 17:00 (1020 minutes) - if day shift user clocks in after this, suggest night shift
  // Morning threshold: 12:00 PM (720 minutes) - if night shift user clocks in before this, suggest day shift
  // This covers morning hours (7:03 AM, 8:00 AM, 9:00 AM, etc.) for night shift users
  
  const EVENING_THRESHOLD = 17 * 60; // 17:00 in minutes (5:00 PM)
  const MORNING_THRESHOLD = 12 * 60; // 12:00 in minutes (12:00 PM / noon)
  
  if (currentShift === SHIFT_TYPES.DAY) {
    // Day shift user clocking in late evening (after 17:00 / 5:00 PM)
    if (timeInMinutes >= EVENING_THRESHOLD) {
      return {
        shouldPrompt: true,
        suggestedShift: SHIFT_TYPES.NIGHT,
        reason: 'You are clocking in during evening hours. Are you starting a night shift?'
      };
    }
  } else if (currentShift === SHIFT_TYPES.NIGHT) {
    // Night shift user clocking in during morning hours (before 12:00 PM / noon)
    // This includes times like 7:03 AM, 8:00 AM, 9:00 AM, 10:30 AM, 11:00 AM, etc.
    if (timeInMinutes < MORNING_THRESHOLD) {
      return {
        shouldPrompt: true,
        suggestedShift: SHIFT_TYPES.DAY,
        reason: 'You are clocking in during morning hours. Are you starting a day shift?'
      };
    }
  }
  
  return {
    shouldPrompt: false,
    suggestedShift: null,
    reason: null
  };
}

/**
 * Format shift name for display
 * @param {string} shift - Shift type ('day' or 'night')
 * @returns {string} Formatted shift name
 */
export function formatShiftName(shift) {
  if (shift === SHIFT_TYPES.DAY) return 'Day Shift';
  if (shift === SHIFT_TYPES.NIGHT) return 'Night Shift';
  return 'Day Shift'; // Default
}

