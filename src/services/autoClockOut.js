import { collection, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase/client';
import { getUserShift, SHIFT_TYPES } from './shiftService';
import { stopClock } from './timeClock';
import { resolveRoundingRules } from './roundingRules';
import { roundSessionRange } from '../utils/timeRounding';

/**
 * Auto Clock-Out Service
 * Automatically clocks out users who forgot to clock out based on their shift
 * Uses company-configured auto clock-out times (or defaults if not configured)
 * 
 * Default Day Shift: Auto clock-out at 18:00 (6:00 PM) on the same day
 * Default Night Shift: Auto clock-out at 06:00 (6:00 AM) on the same day
 */

/**
 * Get default auto clock-out times (fallback if not configured)
 * @returns {Object} Object with dayShiftTime and nightShiftTime
 */
export function getDefaultAutoClockOutTimes() {
  return {
    dayShiftTime: '18:00',
    nightShiftTime: '06:00'
  };
}

/**
 * Get auto clock-out times for a company
 * @param {string} companyId - Company ID
 * @returns {Promise<Object>} Object with dayShiftTime and nightShiftTime
 */
export async function getCompanyAutoClockOutConfig(companyId) {
  try {
    if (!companyId) return getDefaultAutoClockOutTimes();

    const compId = companyId.includes('/') ? companyId.split('/')[1] : companyId;
    const compRef = doc(db, 'companies', compId);
    const compSnap = await getDoc(compRef);

    if (compSnap.exists()) {
      const config = compSnap.data().autoClockOutConfig || {};
      const result = {
        dayShiftTime: config.dayShiftTime || getDefaultAutoClockOutTimes().dayShiftTime,
        nightShiftTime: config.nightShiftTime || getDefaultAutoClockOutTimes().nightShiftTime
      };
      console.log(`[AutoClockOut] Config for ${compId}:`, result);
      return result;
    }

    console.warn(`[AutoClockOut] No config found for ${compId}, using defaults.`);
    return getDefaultAutoClockOutTimes();
  } catch (error) {
    console.error('Error getting company auto clock-out config:', error);
    return getDefaultAutoClockOutTimes();
  }
}

/**
 * Get the auto clock-out time for a given shift (with company config)
 * @param {string} shift - Shift type ('day' or 'night')
 * @param {string} companyId - Company ID (for fetching config)
 * @param {Date} baseDate - Base date to calculate from (defaults to current date)
 * @param {Object} options - { siteId, skipRounding }
 * @returns {Promise<Date>} Date object set to the auto clock-out time for the specified date
 */
export async function getAutoClockOutTime(shift, companyId, baseDate = null, options = {}) {
  const { siteId, skipRounding = false } = options;
  const date = baseDate || new Date();
  const autoClockOut = new Date(date);

  const config = await getCompanyAutoClockOutConfig(companyId);

  if (shift === SHIFT_TYPES.DAY) {
    const [hours, minutes] = config.dayShiftTime.split(':').map(Number);
    autoClockOut.setHours(hours || 18, minutes || 0, 0, 0);
  } else if (shift === SHIFT_TYPES.NIGHT) {
    const [hours, minutes] = config.nightShiftTime.split(':').map(Number);
    autoClockOut.setHours(hours || 6, minutes || 0, 0, 0);
  } else {
    const [hours, minutes] = config.dayShiftTime.split(':').map(Number);
    autoClockOut.setHours(hours || 18, minutes || 0, 0, 0);
  }

  // If the calculated auto-clock-out time is before or equal to the start time (baseDate),
  // it means the shift end belongs to the next calendar day.
  if (autoClockOut <= date) {
    autoClockOut.setDate(autoClockOut.getDate() + 1);
  }

  // Skip rounding if requested (essential for trigger checks)
  if (skipRounding) {
    /* console.log(`[AutoClockOut] Target Time (Unrounded): ${autoClockOut.toLocaleTimeString()} for shift ${shift}`); */
    return autoClockOut;
  }

  // Apply rounding rules to the auto clock-out time (for stored/display values)
  try {
    const roundingRules = await resolveRoundingRules(companyId, siteId);
    const { roundedEnd } = roundSessionRange(date, autoClockOut, roundingRules);
    return roundedEnd;
  } catch (error) {
    console.warn('[autoClockOut] Failed to apply rounding rules, using unrounded time:', error);
    return autoClockOut;
  }
}

/**
 * Check if a session should be auto clocked out
 * @param {Object} session - Session data from Firestore
 * @param {Date} startedAt - Session start time
 * @param {string} userShift - User's shift preference
 * @param {string} companyId - Company ID (for fetching config)
 * @returns {Promise<boolean>} True if session should be auto clocked out
 */
export async function shouldAutoClockOut(session, startedAt, userShift, companyId) {
  if (!startedAt) return false;

  const now = new Date();
  const sessionDate = new Date(startedAt);

  // Calculate auto clock-out time based on session start date (not current date)
  // CRITICAL: We skip rounding here to ensure it triggers at the EXACT configured time
  const autoClockOutTime = await getAutoClockOutTime(userShift, companyId, sessionDate, { skipRounding: true });

  // The session should be auto clocked out if current time has passed the auto clock-out time
  if (now >= autoClockOutTime) {
    return true;
  }

  return false;
}

/**
 * Automatically clock out a user's open session
 * @param {string} userId - User ID
 * @param {string} sessionId - Session document ID
 * @param {Object} sessionData - Session data
 * @param {Date} startedAt - Session start time
 * @param {number} breakSec - Break time in seconds
 * @returns {Promise<Object>} Result of the auto clock-out
 */
export async function performAutoClockOut(userId, sessionId, sessionData, startedAt, breakSec = 0, targetClockOutTime = null) {
  try {
    // Calculate break time if not provided
    let finalBreakSec = breakSec || 0;
    if (sessionData.breakSec !== undefined) {
      finalBreakSec = Math.max(0, sessionData.breakSec || 0);
    }

    // First, update the session with system clock-out note before closing
    const sessionDocRef = doc(db, 'timeClockSessions', sessionId);

    // [PRE-CHECK] Verify session is still open to prevent race conditions
    const preCheckSnap = await getDoc(sessionDocRef);
    if (!preCheckSnap.exists() || preCheckSnap.data().status !== 'open') {
      console.log(`[AutoClockOut] Session ${sessionId} is already closed or missing. Skipping performAutoClockOut.`);
      return { success: true, alreadyClosed: true };
    }

    // Update with system note (remove autoClockOut fields)
    await updateDoc(sessionDocRef, {
      notes: 'System Clock Out - Automatically clocked out due to shift end time',
      updatedAt: serverTimestamp()
    });

    // Use the existing stopClock function to properly close the session
    // Pass the specific sessionId to ensure the CORRECT session is closed in case of multiple open sessions
    const result = await stopClock({ userId, sessionId, breakSec: finalBreakSec, endedAt: targetClockOutTime });

    // Verify the session was properly closed
    const verifySnap = await getDoc(sessionDocRef);
    const verifyData = verifySnap.data();

    // Log only if there's an issue with the session
    if (!verifyData.endedAt || verifyData.status !== 'closed') {
      console.error(`[AutoClockOut] Session not properly closed after auto clock-out:`, {
        sessionId,
        status: verifyData.status,
        endedAt: verifyData.endedAt?.toDate?.()?.toISOString()
      });
    }

    return {
      success: true,
      sessionId,
      userId,
      ...result
    };
  } catch (error) {
    console.error(`[AutoClockOut] Error auto clocking out user ${userId}:`, error);
    throw error;
  }
}

/**
 * Check and auto clock-out all users with open sessions that have exceeded shift end time
 * This function should be called periodically (e.g., every minute or every 5 minutes)
 * @returns {Promise<Object>} Summary of auto clock-outs performed
 */
/**
 * Repair sessions that have auto clock-out flags but are missing endedAt
 * This fixes the issue where auto clock-out notes exist but no clock-out time is recorded
 * @param {string} userId - User ID to repair sessions for
 * @returns {Promise<Object>} Repair results
 */
export async function repairAutoClockOutSessions(userId = null) {
  try {
    const { collection, doc, getDocs, query, where, updateDoc, getDoc } = await import('firebase/firestore');

    // Find sessions with auto clock-out flags but missing endedAt
    const sessionsRef = collection(db, 'timeClockSessions');
    let repairQuery;

    if (userId) {
      repairQuery = query(
        sessionsRef,
        where('userId', '==', userId),
        where('endedAt', '==', null)
      );
    } else {
      repairQuery = query(
        sessionsRef,
        where('endedAt', '==', null)
      );
    }

    const repairSnap = await getDocs(repairQuery);
    const results = {
      found: repairSnap.size,
      repaired: 0,
      errors: 0
    };

    if (repairSnap.size === 0) {
      console.log('[AutoClockOut] No sessions need repair');
      return results;
    }

    console.log(`[AutoClockOut] Found ${repairSnap.size} sessions to repair`);

    for (const sessionDoc of repairSnap.docs) {
      try {
        const sessionData = sessionDoc.data();
        const sessionId = sessionDoc.id;
        const sessionUserId = sessionData.userId;
        const startedAt = sessionData.startedAt?.toDate ? sessionData.startedAt.toDate() : null;

        if (!startedAt) {
          console.warn(`[AutoClockOut] Session ${sessionId} has no start time, skipping`);
          continue;
        }

        // Get user's shift to calculate proper clock-out time
        const userShift = await getUserShift(sessionUserId);
        const autoClockOutTime = await getAutoClockOutTime(userShift, sessionData.companyId, startedAt);

        // Update the session with the missing endedAt and close it
        await updateDoc(sessionDoc.ref, {
          endedAt: autoClockOutTime,
          status: 'closed',
          updatedAt: serverTimestamp()
        });

        results.repaired++;

      } catch (error) {
        console.error(`[AutoClockOut] Error repairing session ${sessionDoc.id}:`, error);
        results.errors++;
      }
    }

    console.log(`[AutoClockOut] Repair completed: ${results.repaired} repaired, ${results.errors} errors`);
    return results;

  } catch (error) {
    console.error('[AutoClockOut] Error during repair process:', error);
    throw error;
  }
}


export async function checkAndAutoClockOutAll() {
  try {
    // Get all open sessions
    const sessionsRef = collection(db, 'timeClockSessions');
    const openSessionsQuery = query(sessionsRef, where('status', '==', 'open'));
    const openSessionsSnap = await getDocs(openSessionsQuery);

    if (openSessionsSnap.empty) return { checked: 0, clockedOut: 0, errors: 0 };

    const results = {
      checked: openSessionsSnap.docs.length,
      clockedOut: 0,
      errors: 0,
      details: []
    };

    // Group sessions by user to track multiple sessions per user
    const sessionsByUser = {};

    // Process each open session
    for (const sessionDoc of openSessionsSnap.docs) {
      try {
        const sessionData = sessionDoc.data();
        const userId = sessionData.userId;
        const sessionId = sessionDoc.id;
        const companyId = sessionData.companyId;

        if (!userId) {
          console.warn(`[AutoClockOut] Session ${sessionId} has no userId, skipping`);
          continue;
        }

        // Track sessions per user
        if (!sessionsByUser[userId]) {
          sessionsByUser[userId] = [];
        }
        sessionsByUser[userId].push({
          sessionId,
          startedAt: sessionData.startedAt?.toDate ? sessionData.startedAt.toDate() : null
        });

        // Get session start time
        const startedAt = sessionData.startedAt?.toDate ? sessionData.startedAt.toDate() : null;
        if (!startedAt) {
          console.warn(`[AutoClockOut] Session ${sessionId} has no start time, skipping`);
          continue;
        }

        // Get user's shift preference
        const userShift = await getUserShift(userId);

        // Check if this session should be auto clocked out (pass companyId for config lookup)
        // Re-calculate the target time inside the loop since shouldAutoClockOut just returns bool
        // CRITICAL: Use skipRounding: true for the trigger check to fire exactly at the configured time
        const autoClockOutTime = await getAutoClockOutTime(userShift, companyId, new Date(startedAt), { skipRounding: true });
        const now = new Date();

        if (now >= autoClockOutTime) {
          // Perform auto clock-out
          await performAutoClockOut(
            userId,
            sessionId,
            sessionData,
            startedAt,
            sessionData.breakSec || 0,
            autoClockOutTime
          );

          results.clockedOut++;
          results.details.push({
            userId,
            sessionId,
            shift: userShift,
            startedAt: startedAt.toISOString()
          });
        }
      } catch (error) {
        console.error(`[AutoClockOut] Error processing session ${sessionDoc.id}:`, error);
        results.errors++;
      }
    }

    // Log users with multiple sessions for debugging
    Object.keys(sessionsByUser).forEach(userId => {
      if (sessionsByUser[userId].length > 1) {
        console.log(`[AutoClockOut] User ${userId} has ${sessionsByUser[userId].length} open sessions:`, sessionsByUser[userId]);
      }
    });

    return results;
  } catch (error) {
    console.error('[AutoClockOut] Error checking for auto clock-out:', error);
    throw error;
  }
}

