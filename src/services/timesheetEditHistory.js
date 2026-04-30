import { db } from '../firebase/client';
import { collection, doc, addDoc, query, where, getDocs, orderBy, serverTimestamp, getDoc } from 'firebase/firestore';

/**
 * Timesheet Edit History Service
 * Stores and retrieves edit history for timesheet entries
 */

/**
 * Store edit history for a timesheet entry
 * @param {string} userId - User ID whose timesheet was edited
 * @param {string} weekStart - Week start date (ISO string)
 * @param {string} date - Date of the entry (ISO string)
 * @param {Object} previousValues - Previous values before edit
 * @param {Object} newValues - New values after edit
 * @param {string} editedBy - User ID who made the edit
 * @param {string} editedByName - Display name of user who made the edit
 * @returns {Promise<Object>} Created edit history record
 */
export async function storeEditHistory(userId, weekStart, date, previousValues, newValues, editedBy, editedByName) {
  try {
    const editHistoryRef = collection(db, 'timesheetEditHistory');
    
    const editRecord = {
      userId,
      weekStart,
      date,
      previousValues: {
        clockIn: previousValues.clockIn || '',
        clockOut: previousValues.clockOut || '',
        breakMin: previousValues.breakMin || 0,
        notes: previousValues.notes || previousValues.description || ''
      },
      newValues: {
        clockIn: newValues.clockIn || '',
        clockOut: newValues.clockOut || '',
        breakMin: newValues.breakMin || 0,
        notes: newValues.notes || newValues.description || ''
      },
      editedBy,
      editedByName: editedByName || 'Unknown',
      editedAt: serverTimestamp(),
      createdAt: serverTimestamp()
    };

    const docRef = await addDoc(editHistoryRef, editRecord);
    console.log('[timesheetEditHistory] Stored edit history:', docRef.id);
    
    return {
      id: docRef.id,
      ...editRecord
    };
  } catch (error) {
    console.error('[timesheetEditHistory] Error storing edit history:', error);
    throw error;
  }
}

/**
 * Fetch edit history for a timesheet week
 * @param {string} userId - User ID
 * @param {string} weekStart - Week start date (ISO string or Date)
 * @returns {Promise<Array>} Array of edit history records
 */
export async function fetchEditHistory(userId, weekStart) {
  try {
    if (!userId || !weekStart) {
      console.warn('[timesheetEditHistory] Missing userId or weekStart:', { userId, weekStart });
      return [];
    }
    
    // Normalize weekStart to ISO string format (YYYY-MM-DD)
    let weekStartStr = weekStart;
    if (weekStart instanceof Date) {
      weekStartStr = weekStart.toISOString().slice(0, 10);
    } else if (typeof weekStart === 'string') {
      // Ensure it's in YYYY-MM-DD format
      const date = new Date(weekStart);
      if (!isNaN(date.getTime())) {
        weekStartStr = date.toISOString().slice(0, 10);
      }
    }
    
    console.log('[timesheetEditHistory] Fetching edit history for:', { userId, weekStart: weekStartStr });
    
    const editHistoryRef = collection(db, 'timesheetEditHistory');
    
    // Try query with orderBy first
    let q;
    try {
      q = query(
        editHistoryRef,
        where('userId', '==', userId),
        where('weekStart', '==', weekStartStr),
        orderBy('editedAt', 'desc')
      );
    } catch (error) {
      // If orderBy fails, try without it (in case index doesn't exist)
      console.warn('[timesheetEditHistory] Query with orderBy failed, trying without orderBy:', error);
      q = query(
        editHistoryRef,
        where('userId', '==', userId),
        where('weekStart', '==', weekStartStr)
      );
    }
    
    const snapshot = await getDocs(q);
    const editHistory = [];
    
    snapshot.forEach((doc) => {
      const data = doc.data();
      editHistory.push({
        id: doc.id,
        userId: data.userId,
        weekStart: data.weekStart,
        date: data.date,
        previousValues: data.previousValues || {},
        newValues: data.newValues || {},
        editedBy: data.editedBy,
        editedByName: data.editedByName || 'Unknown',
        editedAt: data.editedAt?.toDate ? data.editedAt.toDate() : (data.editedAt ? new Date(data.editedAt) : new Date()),
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt ? new Date(data.createdAt) : new Date())
      });
    });
    
    // Sort by editedAt descending if we didn't use orderBy
    if (editHistory.length > 0 && !q._queryConstraints?.some(c => c.type === 'orderBy')) {
      editHistory.sort((a, b) => {
        const aTime = a.editedAt instanceof Date ? a.editedAt.getTime() : new Date(a.editedAt).getTime();
        const bTime = b.editedAt instanceof Date ? b.editedAt.getTime() : new Date(b.editedAt).getTime();
        return bTime - aTime; // Descending
      });
    }
    
    console.log(`[timesheetEditHistory] Fetched ${editHistory.length} edit history records for user ${userId}, week ${weekStartStr}`);
    return editHistory;
  } catch (error) {
    console.error('[timesheetEditHistory] Error fetching edit history:', error);
    // If query fails (e.g., no index), try fallback query
    if (error.code === 'failed-precondition' || error.code === 9) {
      console.warn('[timesheetEditHistory] Index may not exist, trying fallback query');
      try {
        // Fallback: query by userId only, then filter client-side
        const editHistoryRef = collection(db, 'timesheetEditHistory');
        const fallbackQ = query(
          editHistoryRef,
          where('userId', '==', userId)
        );
        const fallbackSnapshot = await getDocs(fallbackQ);
        const editHistory = [];
        
        // Normalize weekStart for comparison
        let weekStartStr = weekStart;
        if (weekStart instanceof Date) {
          weekStartStr = weekStart.toISOString().slice(0, 10);
        } else if (typeof weekStart === 'string') {
          const date = new Date(weekStart);
          if (!isNaN(date.getTime())) {
            weekStartStr = date.toISOString().slice(0, 10);
          }
        }
        
        fallbackSnapshot.forEach((doc) => {
          const data = doc.data();
          // Filter by weekStart client-side
          const dataWeekStart = data.weekStart instanceof Date 
            ? data.weekStart.toISOString().slice(0, 10)
            : (typeof data.weekStart === 'string' ? data.weekStart.slice(0, 10) : String(data.weekStart));
          
          if (dataWeekStart === weekStartStr) {
            editHistory.push({
              id: doc.id,
              userId: data.userId,
              weekStart: data.weekStart,
              date: data.date,
              previousValues: data.previousValues || {},
              newValues: data.newValues || {},
              editedBy: data.editedBy,
              editedByName: data.editedByName || 'Unknown',
              editedAt: data.editedAt?.toDate ? data.editedAt.toDate() : (data.editedAt ? new Date(data.editedAt) : new Date()),
              createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt ? new Date(data.createdAt) : new Date())
            });
          }
        });
        
        // Sort by editedAt descending
        editHistory.sort((a, b) => {
          const aTime = a.editedAt instanceof Date ? a.editedAt.getTime() : new Date(a.editedAt).getTime();
          const bTime = b.editedAt instanceof Date ? b.editedAt.getTime() : new Date(b.editedAt).getTime();
          return bTime - aTime; // Descending
        });
        
        console.log(`[timesheetEditHistory] Fallback query returned ${editHistory.length} records`);
        return editHistory;
      } catch (fallbackError) {
        console.error('[timesheetEditHistory] Fallback query also failed:', fallbackError);
        return [];
      }
    }
    return [];
  }
}

/**
 * Fetch edit history for a specific date
 * @param {string} userId - User ID
 * @param {string} date - Date (ISO string)
 * @returns {Promise<Array>} Array of edit history records for that date
 */
export async function fetchEditHistoryForDate(userId, date) {
  try {
    const editHistoryRef = collection(db, 'timesheetEditHistory');
    const q = query(
      editHistoryRef,
      where('userId', '==', userId),
      where('date', '==', date),
      orderBy('editedAt', 'desc')
    );
    
    const snapshot = await getDocs(q);
    const editHistory = [];
    
    snapshot.forEach((doc) => {
      const data = doc.data();
      editHistory.push({
        id: doc.id,
        userId: data.userId,
        weekStart: data.weekStart,
        date: data.date,
        previousValues: data.previousValues || {},
        newValues: data.newValues || {},
        editedBy: data.editedBy,
        editedByName: data.editedByName || 'Unknown',
        editedAt: data.editedAt?.toDate ? data.editedAt.toDate() : (data.editedAt ? new Date(data.editedAt) : new Date()),
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt ? new Date(data.createdAt) : new Date())
      });
    });
    
    return editHistory;
  } catch (error) {
    console.error('[timesheetEditHistory] Error fetching edit history for date:', error);
    if (error.code === 'failed-precondition') {
      return [];
    }
    throw error;
  }
}

/**
 * Get user display name from user ID
 * @param {string} userId - User ID
 * @returns {Promise<string>} User display name
 */
export async function getUserDisplayName(userId) {
  try {
    if (!userId) return 'Unknown';
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      const userData = userSnap.data();
      return userData.displayName || userData.name || userData.email || 'Unknown';
    }
    return 'Unknown';
  } catch (error) {
    console.error('[timesheetEditHistory] Error getting user display name:', error);
    return 'Unknown';
  }
}

