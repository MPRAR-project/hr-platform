/**
 * Absence Service - Handles absence management operations
 * Provides CRUD operations, role-based permissions, and automatic approval logic
 */

import { db } from '../firebase/client';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  Timestamp,
  onSnapshot
} from 'firebase/firestore';
import { allowanceService } from './allowanceService';
import { safeParseDate } from '../utils/safeDateParse';

/**
 * Absence Service Class
 */
class AbsenceService {
  constructor() {
    this.collection = 'absences';
  }

  /**
   * Create a new absence request
   * @param {Object} absenceData - The absence data
   * @param {string} userId - The user ID making the request
   * @returns {Promise<Object>} The created absence
   */
  async createAbsence(absenceData, userId) {
    try {
      const now = Timestamp.now();

      // Calculate duration in days
      const startDate = safeParseDate(absenceData.startingDate);
      const endDate = safeParseDate(absenceData.endingDate);
      const durationMs = endDate.getTime() - startDate.getTime();
      let durationDays = Math.ceil(durationMs / (1000 * 60 * 60 * 24)) + 1;

      // Validate and ensure duration is reasonable
      if (durationDays < 0 || durationDays > 365) {
        console.warn(`Invalid duration calculated: ${durationDays} days from ${absenceData.startingDate} to ${absenceData.endingDate}`);
        // Recalculate with safer method
        const safeDuration = Math.max(1, Math.min(365, durationDays));
        durationDays = safeDuration;
      }

      // Identify Sick Leave by value key (consistent with updated leave types)
      const normalizedLeaveType = allowanceService.normalizeLeaveType(absenceData.leaveType);
      const isSickLeave = normalizedLeaveType === 'sickleave' || normalizedLeaveType === 'sick_leave';

      // Check allowance-based auto-approval
      let allowanceCheck = { canAutoApprove: false, hasAllowance: false, reason: 'No allowance configured' };
      try {
        console.log(`Checking auto-approval for user ${userId}, leave type: ${absenceData.leaveType}, days: ${durationDays}`);
        allowanceCheck = await allowanceService.checkAutoApproval(userId, absenceData.leaveType, durationDays);
        console.log('Auto-approval check result:', allowanceCheck);
      } catch (error) {
        console.error('Error checking allowance auto-approval:', error);
      }

      // Business rule: only Sick Leave can be auto-approved.
      // Annual Leave (and all other leave types) must go through manual approval.
      const isAutoApproved = isSickLeave;

      const status = isAutoApproved ? 'Approved' : 'Pending';
      let approvalReason = allowanceCheck.reason || 'Manual approval required';

      if (isSickLeave) {
        approvalReason = 'Automatic approval: Sick Leave Policy';
      } else if (allowanceCheck?.hasAllowance) {
        // Keep allowance context for display/debugging, but do not auto-approve.
        approvalReason = `Manual approval required: ${allowanceCheck.reason}`;
      }


      const absence = {
        ...absenceData,
        userId,
        startDate: absenceData.startingDate,
        endDate: absenceData.endingDate,
        duration: `${durationDays} days`,
        status: status,
        submittedDate: now,
        createdAt: now,
        updatedAt: now,

        // Store allowance information for display
        allowanceInfo: allowanceCheck.hasAllowance ? {
          totalDays: allowanceCheck.totalDays,
          usedDays: allowanceCheck.usedDays,
          remainingDays: allowanceCheck.remainingDays,
          autoApprovalReason: approvalReason // Use the updated reason
        } : null,

        ...(isAutoApproved && {
          approvedBy: 'System',
          approvedDate: now,
          approvalReason: approvalReason // Use the updated reason
        })
      };

      // Get user data to add company and site info
      const userDoc = await getDoc(doc(db, 'users', userId));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        // Firestore does not allow `undefined` values.
        // Some user profiles may not have siteId/companyId populated yet.
        if (userData.companyId !== undefined) absence.companyId = userData.companyId ?? null;
        if (userData.siteId !== undefined) absence.siteId = userData.siteId ?? null;
        if (userData.displayName !== undefined) absence.employeeName = userData.displayName ?? null;
        if (userData.email !== undefined) absence.employeeEmail = userData.email ?? null;
      }

      // Clean undefined fields to prevent Firestore errors
      Object.keys(absence).forEach(key => {
        if (absence[key] === undefined) {
          delete absence[key];
        }
      });
      if (absence.allowanceInfo) {
        Object.keys(absence.allowanceInfo).forEach(key => {
          if (absence.allowanceInfo[key] === undefined) {
            delete absence.allowanceInfo[key];
          }
        });
      }

      const docRef = await addDoc(collection(db, this.collection), absence);

      // If auto-approved, update the allowance usage (Sick Leave debits allowance if one exists)
      // DISABLED: Auto-allowances turned off - now handled manually by HR/Admin
      if (isAutoApproved && allowanceCheck.hasAllowance) {
        console.log('Auto-allowance usage update disabled - please manage allowances manually via HR/Admin interface');
      }

      return {
        id: docRef.id,
        ...absence
      };
    } catch (error) {
      console.error('Error creating absence:', error);
      throw new Error('Failed to create absence request');
    }
  }

  /**
   * Delete an absence request
   * @param {string} absenceId - The absence ID
   * @param {Object} currentUser - The current user object
   * @returns {Promise<boolean>} Success status
   */
  async deleteAbsence(absenceId, currentUser) {
    try {
      const absenceRef = doc(db, this.collection, absenceId);
      const absenceSnap = await getDoc(absenceRef);

      if (!absenceSnap.exists()) {
        throw new Error('Absence not found');
      }

      const absenceData = { id: absenceId, ...absenceSnap.data() };

      // Check permission
      if (!this.canDeleteAbsence(absenceData, currentUser)) {
        throw new Error('You do not have permission to delete this absence request');
      }

      await deleteDoc(absenceRef);
      return true;
    } catch (error) {
      console.error('Error deleting absence:', error);
      throw error;
    }
  }

  // --- (Other existing methods: getUserAbsences, getEmployeeAbsences, etc. remain unchanged) ---

  /**
   * Get absences for a specific user (My Absences)
   * @param {string} userId - The user ID
   * @returns {Promise<Array>} Array of user's absences
   */
  async getUserAbsences(userId) {
    try {
      const q = query(
        collection(db, this.collection),
        where('userId', '==', userId),
        orderBy('createdAt', 'desc')
      );

      const querySnapshot = await getDocs(q);
      const absences = [];

      querySnapshot.forEach((doc) => {
        absences.push({
          id: doc.id,
          ...doc.data()
        });
      });

      return absences;
    } catch (error) {
      console.error('Error fetching user absences:', error);
      throw new Error('Failed to fetch absences');
    }
  }

  /**
   * Get absences for employees based on user role and permissions
   * @param {Object} currentUser - The current user object
   * @returns {Promise<Array>} Array of employee absences
   */
  async getEmployeeAbsences(currentUser) {
    try {
      let q;

      // Role-based query logic
      if (['siteManager', 'seniorManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor'].includes(currentUser.role)) {
        // These roles can see all absences in their company
        q = query(
          collection(db, this.collection),
          where('companyId', '==', currentUser.companyId),
          orderBy('createdAt', 'desc')
        );
      } else if (currentUser.role === 'teamManager') {
        // Team managers can only see absences of their managed employees
        // First get the list of managed employees
        const userDoc = await getDoc(doc(db, 'users', currentUser.userId));
        const userData = userDoc.data();
        const managedEmployees = userData.managedEmployees || [];

        if (managedEmployees.length === 0) {
          return [];
        }

        // Firestore 'in' queries are limited to 10 items, so we need to batch if more
        const batchSize = 10;
        const batches = [];

        for (let i = 0; i < managedEmployees.length; i += batchSize) {
          const batch = managedEmployees.slice(i, i + batchSize);
          const batchQuery = query(
            collection(db, this.collection),
            where('userId', 'in', batch),
            orderBy('createdAt', 'desc')
          );
          batches.push(batchQuery);
        }

        // Execute all batch queries
        const allResults = await Promise.all(
          batches.map(batchQuery => getDocs(batchQuery))
        );

        // Combine results
        const absences = [];
        allResults.forEach(querySnapshot => {
          querySnapshot.forEach((doc) => {
            absences.push({
              id: doc.id,
              ...doc.data()
            });
          });
        });

        // Sort by creation date (newest first)
        absences.sort((a, b) => {
          const aTime = a.createdAt?.toMillis?.() || 0;
          const bTime = b.createdAt?.toMillis?.() || 0;
          return bTime - aTime;
        });

        return absences;
      } else {
        // Regular employees can only see their own absences
        return this.getUserAbsences(currentUser.userId);
      }

      const querySnapshot = await getDocs(q);
      const absences = [];

      querySnapshot.forEach((doc) => {
        absences.push({
          id: doc.id,
          ...doc.data()
        });
      });

      // Enrich absences with current allowance information for managers
      if (['siteManager', 'seniorManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor', 'teamManager'].includes(currentUser.role)) {
        for (const absence of absences) {
          if (absence.leaveType) {
            try {
              // Always fetch fresh allowance data to show current usage
              const allowanceSummary = await allowanceService.getAllowanceSummary(absence.userId, absence.leaveType);
              if (allowanceSummary) {
                absence.allowanceInfo = allowanceSummary;
              }
            } catch (error) {
              console.error('Error fetching allowance summary for absence:', absence.id, error);
            }
          }
        }
      }

      return absences;
    } catch (error) {
      console.error('Error fetching employee absences:', error);
      throw new Error('Failed to fetch employee absences');
    }
  }

  /**
   * Get employee absences with pagination and time-windowing (OPTIMIZED)
   * @param {Object} currentUser - The current user object
   * @param {Object} options - Query options
   * @param {number} options.limitCount - Number of items per page (default: 50)
   * @param {Object} options.startAfterDoc - Last document from previous page (for cursor pagination)
   * @param {Date} options.startDate - Filter absences after this date (default: 6 months ago)
   * @param {boolean} options.enrichWithAllowances - Whether to fetch allowance data (default: false for performance)
   * @returns {Promise<{absences: Array, lastDoc: Object}>} Paginated absences and cursor
   */
  async getEmployeeAbsencesPaginated(currentUser, options = {}) {
    try {
      const {
        limitCount = 50,
        startAfterDoc = null,
        startDate = null,
        enrichWithAllowances = false
      } = options;

      // Default to last 6 months if no startDate provided
      const defaultStartDate = new Date();
      defaultStartDate.setMonth(defaultStartDate.getMonth() - 6);
      const queryStartDate = startDate || defaultStartDate;

      let q;

      // Role-based query logic (same as getEmployeeAbsences)
      if (['siteManager', 'seniorManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor'].includes(currentUser.role)) {
        // Company-wide query with time window and pagination
        const constraints = [
          where('companyId', '==', currentUser.companyId),
          where('createdAt', '>=', Timestamp.fromDate(queryStartDate)),
          orderBy('createdAt', 'desc'),
          limit(limitCount)
        ];

        if (startAfterDoc) {
          constraints.push(startAfter(startAfterDoc));
        }

        q = query(collection(db, this.collection), ...constraints);
      } else if (currentUser.role === 'teamManager') {
        // Team managers - batch query for managed employees
        const userDoc = await getDoc(doc(db, 'users', currentUser.userId));
        const userData = userDoc.data();
        const managedEmployees = userData.managedEmployees || [];

        if (managedEmployees.length === 0) {
          return { absences: [], lastDoc: null };
        }

        // Batch queries for team managers (maintain existing logic)
        const batchSize = 10;
        const batches = [];

        for (let i = 0; i < managedEmployees.length; i += batchSize) {
          const batch = managedEmployees.slice(i, i + batchSize);
          const batchQuery = query(
            collection(db, this.collection),
            where('userId', 'in', batch),
            where('createdAt', '>=', Timestamp.fromDate(queryStartDate)),
            orderBy('createdAt', 'desc')
          );
          batches.push(batchQuery);
        }

        const allResults = await Promise.all(batches.map(batchQuery => getDocs(batchQuery)));

        const absences = [];
        allResults.forEach(querySnapshot => {
          querySnapshot.forEach((doc) => {
            absences.push({
              id: doc.id,
              ...doc.data()
            });
          });
        });

        // Sort combined results
        absences.sort((a, b) => {
          const aTime = a.createdAt?.toMillis?.() || 0;
          const bTime = b.createdAt?.toMillis?.() || 0;
          return bTime - aTime;
        });

        // Apply pagination to combined results
        const paginatedAbsences = absences.slice(0, limitCount);

        // Optionally enrich with allowances using batch fetching
        if (enrichWithAllowances && paginatedAbsences.length > 0) {
          await this._batchEnrichAllowances(paginatedAbsences);
        }

        return { absences: paginatedAbsences, lastDoc: null };
      } else {
        // Regular employees - redirect to user absences
        const userAbsences = await this.getUserAbsences(currentUser.userId);
        return { absences: userAbsences.slice(0, limitCount), lastDoc: null };
      }

      const querySnapshot = await getDocs(q);
      const absences = [];
      let lastDoc = null;

      querySnapshot.forEach((docSnapshot) => {
        absences.push({
          id: docSnapshot.id,
          ...docSnapshot.data()
        });
        lastDoc = docSnapshot; // Keep track of last document for pagination
      });

      // Optionally enrich with allowances using batch fetching (eliminates N+1)
      if (enrichWithAllowances && absences.length > 0) {
        await this._batchEnrichAllowances(absences);
      }

      return { absences, lastDoc };
    } catch (error) {
      console.error('Error fetching paginated employee absences:', error);
      throw new Error('Failed to fetch employee absences');
    }
  }

  /**
   * Batch enrich absences with allowance data (OPTIMIZED - eliminates N+1)
   * @param {Array} absences - Array of absence objects to enrich
   * @private
   */
  async _batchEnrichAllowances(absences) {
    try {
      // Step 1: Collect unique (userId, leaveType) pairs
      const uniquePairs = new Map();
      absences.forEach(absence => {
        if (absence.leaveType && absence.userId) {
          const key = `${absence.userId}:${absence.leaveType}`;
          if (!uniquePairs.has(key)) {
            uniquePairs.set(key, { userId: absence.userId, leaveType: absence.leaveType });
          }
        }
      });

      if (uniquePairs.size === 0) return;

      // Step 2: Batch query allowances (Firestore 'in' limited to 10, so batch in chunks)
      const allowanceMap = new Map();
      const pairsArray = Array.from(uniquePairs.values());

      // Group by leaveType to optimize queries
      const leaveTypeGroups = new Map();
      pairsArray.forEach(pair => {
        if (!leaveTypeGroups.has(pair.leaveType)) {
          leaveTypeGroups.set(pair.leaveType, []);
        }
        leaveTypeGroups.get(pair.leaveType).push(pair.userId);
      });

      // Query each leaveType group in batches of 10 userIds
      for (const [leaveType, userIds] of leaveTypeGroups) {
        for (let i = 0; i < userIds.length; i += 10) {
          const chunk = userIds.slice(i, i + 10);

          const allowanceQuery = query(
            collection(db, 'allowances'),
            where('employeeId', 'in', chunk),
            where('leaveType', '==', leaveType),
            where('isActive', '==', true)
          );

          const results = await getDocs(allowanceQuery);
          results.forEach(docSnapshot => {
            const data = docSnapshot.data();
            const key = `${data.employeeId}:${data.leaveType}`;
            allowanceMap.set(key, {
              totalDays: data.totalDays,
              usedDays: data.usedDays,
              remainingDays: data.remainingDays
            });
          });
        }
      }

      // Step 3: Join allowances to absences in memory (O(N) complexity)
      absences.forEach(absence => {
        if (absence.leaveType && absence.userId) {
          const key = `${absence.userId}:${absence.leaveType}`;
          const allowanceInfo = allowanceMap.get(key);
          if (allowanceInfo) {
            absence.allowanceInfo = allowanceInfo;
          }
        }
      });
    } catch (error) {
      console.error('Error batch enriching allowances:', error);
      // Don't throw - allowance enrichment is optional
    }
  }

  /**
   * Get absences for a specific employee (for the employee detail page)
   * @param {string} employeeId - The employee ID
   * @param {Object} currentUser - The current user object
   * @returns {Promise<Array>} Array of employee's absences
   */
  async getEmployeeAbsencesById(employeeId, currentUser, options = {}) {
    try {
      console.log('getEmployeeAbsencesById called for:', employeeId);
      const { enrichWithAllowances = false } = options;

      // Check if current user has permission to view this employee's absences
      console.log('Checking permissions...');
      const canView = await this.canViewEmployeeAbsences(employeeId, currentUser);
      console.log('Permission check result:', canView);

      if (!canView) {
        throw new Error('Permission denied');
      }

      console.log('Creating query for absences...');
      const q = query(
        collection(db, this.collection),
        where('userId', '==', employeeId)
      );

      console.log('Executing query...');
      const querySnapshot = await getDocs(q);
      console.log('Query completed, processing results...');

      const absences = [];

      querySnapshot.forEach((doc) => {
        absences.push({
          id: doc.id,
          ...doc.data()
        });
      });

      // If no absences found, return empty array (don't throw error)
      if (absences.length === 0) {
        console.log('No absences found for employee:', employeeId);
        return [];
      }

      // NOTE: Allowance enrichment is expensive (N+1 network calls).
      // Only do it when explicitly requested (e.g. detail modal), not for list views.
      if (
        enrichWithAllowances &&
        ['siteManager', 'seniorManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor', 'teamManager'].includes(currentUser.role)
      ) {
        for (const absence of absences) {
          if (!absence.leaveType) continue;
          try {
            const allowanceSummary = await allowanceService.getAllowanceSummary(absence.userId, absence.leaveType);
            if (allowanceSummary) absence.allowanceInfo = allowanceSummary;
          } catch (error) {
            console.error('Error fetching allowance summary for absence:', absence.id, error);
          }
        }
      }

      console.log('Found absences:', absences.length);
      return absences;
    } catch (error) {
      console.error('Error fetching employee absences by ID:', error);
      throw new Error('Failed to fetch employee absences');
    }
  }

  /**
   * Get a single absence with fresh allowance data
   * @param {string} absenceId - The absence ID
   * @param {Object} currentUser - The current user object
   * @returns {Promise<Object>} The absence with fresh allowance data
   */
  async getAbsenceById(absenceId, currentUser) {
    try {
      const absenceRef = doc(db, this.collection, absenceId);
      const absenceDoc = await getDoc(absenceRef);

      if (!absenceDoc.exists()) {
        throw new Error('Absence not found');
      }

      const absence = {
        id: absenceId,
        ...absenceDoc.data()
      };

      // Enrich with fresh allowance information for managers
      if (['siteManager', 'seniorManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor', 'teamManager'].includes(currentUser.role)) {
        if (absence.leaveType) {
          try {
            const allowanceSummary = await allowanceService.getAllowanceSummary(absence.userId, absence.leaveType);
            if (allowanceSummary) {
              absence.allowanceInfo = allowanceSummary;
            }
          } catch (error) {
            console.error('Error fetching allowance summary for absence:', absenceId, error);
          }
        }
      }

      return absence;
    } catch (error) {
      console.error('Error fetching absence by ID:', error);
      throw new Error('Failed to fetch absence');
    }
  }

  /**
   * Update an absence request
   * @param {string} absenceId - The absence ID
   * @param {Object} updateData - The data to update
   * @param {Object} currentUser - The current user object
   * @returns {Promise<Object>} The updated absence
   */
  async updateAbsence(absenceId, updateData, currentUser) {
    try {
      // Validate currentUser
      if (!currentUser || !currentUser.userId) {
        throw new Error('Invalid user: User not authenticated or missing user ID');
      }

      const absenceRef = doc(db, this.collection, absenceId);
      const absenceDoc = await getDoc(absenceRef);

      if (!absenceDoc.exists()) {
        throw new Error('Absence not found');
      }

      const absenceData = absenceDoc.data();

      // Check permissions
      if (!this.canEditAbsence(absenceData, currentUser)) {
        throw new Error('Permission denied');
      }

      // Calculate new duration if dates are being updated
      if (updateData.startingDate || updateData.endingDate) {
        const startDate = safeParseDate(updateData.startingDate || absenceData.startDate);
        const endDate = safeParseDate(updateData.endingDate || absenceData.endDate);
        const durationMs = endDate.getTime() - startDate.getTime();
        let durationDays = Math.ceil(durationMs / (1000 * 60 * 60 * 24)) + 1;

        // Validate and ensure duration is reasonable
        if (durationDays < 0 || durationDays > 365) {
          console.warn(`Invalid duration calculated in update: ${durationDays} days from ${startDate} to ${endDate}`);
          const safeDuration = Math.max(1, Math.min(365, durationDays));
          durationDays = safeDuration;
        }

        updateData.duration = `${durationDays} days`;

        if (updateData.startingDate) {
          updateData.startDate = updateData.startingDate;
          delete updateData.startingDate;
        }
        if (updateData.endingDate) {
          updateData.endDate = updateData.endingDate;
          delete updateData.endingDate;
        }
      }

      const updatedData = {
        ...updateData,
        updatedAt: Timestamp.now()
      };

      await updateDoc(absenceRef, updatedData);

      return {
        id: absenceId,
        ...absenceData,
        ...updatedData
      };
    } catch (error) {
      console.error('Error updating absence:', error);
      throw new Error('Failed to update absence');
    }
  }

  /**
   * Approve an absence request
   * @param {string} absenceId - The absence ID
   * @param {Object} currentUser - The current user object
   * @returns {Promise<Object>} The approved absence
   */
  async approveAbsence(absenceId, currentUser) {
    try {
      const absenceRef = doc(db, this.collection, absenceId);
      const absenceDoc = await getDoc(absenceRef);

      if (!absenceDoc.exists()) {
        throw new Error('Absence not found');
      }

      const absenceData = absenceDoc.data();

      // Check permissions
      if (!this.canApproveAbsence(absenceData, currentUser)) {
        throw new Error('Permission denied');
      }

      const updateData = {
        status: 'Approved',
        approvedBy: currentUser.userId,
        approvedDate: Timestamp.now(),
        updatedAt: Timestamp.now()
      };

      await updateDoc(absenceRef, updateData);

      // Update allowance usage when manually approved
      // DISABLED: Auto-allowances turned off - now handled manually by HR/Admin
      if (absenceData.leaveType && absenceData.duration) {
        console.log('Auto-allowance usage update disabled - please manage allowances manually via HR/Admin interface');
      }

      return {
        id: absenceId,
        ...absenceData,
        ...updateData
      };
    } catch (error) {
      console.error('Error approving absence:', error);
      throw new Error('Failed to approve absence');
    }
  }

  /**
   * Decline an absence request
   * @param {string} absenceId - The absence ID
   * @param {string} reason - The decline reason
   * @param {Object} currentUser - The current user object
   * @returns {Promise<Object>} The declined absence
   */
  async declineAbsence(absenceId, reason, currentUser) {
    try {
      const absenceRef = doc(db, this.collection, absenceId);
      const absenceDoc = await getDoc(absenceRef);

      if (!absenceDoc.exists()) {
        throw new Error('Absence not found');
      }

      const absenceData = absenceDoc.data();

      // Check permissions
      if (!this.canApproveAbsence(absenceData, currentUser)) {
        throw new Error('Permission denied');
      }

      const updateData = {
        status: 'Rejected',
        declinedBy: currentUser.userId,
        declinedDate: Timestamp.now(),
        declineReason: reason,
        updatedAt: Timestamp.now()
      };

      await updateDoc(absenceRef, updateData);

      return {
        id: absenceId,
        ...absenceData,
        ...updateData
      };
    } catch (error) {
      console.error('Error declining absence:', error);
      throw new Error('Failed to decline absence');
    }
  }

  /**
   * Delete an absence request
   * @param {string} absenceId - The absence ID
   * @param {Object} currentUser - The current user object
   * @returns {Promise<boolean>} Success status
   */
  async deleteAbsence(absenceId, currentUser) {
    try {
      const absenceRef = doc(db, this.collection, absenceId);
      const absenceDoc = await getDoc(absenceRef);

      if (!absenceDoc.exists()) {
        throw new Error('Absence not found');
      }

      const absenceData = absenceDoc.data();

      // Check permissions - only elevated roles can delete
      if (!this.canDeleteAbsence(absenceData, currentUser)) {
        throw new Error('Permission denied');
      }

      await deleteDoc(absenceRef);
      return true;
    } catch (error) {
      console.error('Error deleting absence:', error);
      throw new Error('Failed to delete absence');
    }
  }

  async cancelAbsence(absenceId, cancellationData, currentUser) {
    try {
      const absenceRef = doc(db, this.collection, absenceId);
      const absenceDoc = await getDoc(absenceRef);

      if (!absenceDoc.exists()) {
        throw new Error('Absence not found');
      }

      const absenceData = absenceDoc.data();

      // Check if absence is approved (can only cancel approved absences)
      if (absenceData.status !== 'Approved') {
        throw new Error('Only approved absences can be cancelled');
      }

      // Check permissions - only managers can cancel absences
      if (!this.canCancelAbsence(absenceData, currentUser)) {
        throw new Error('Permission denied: Only managers can cancel approved absences');
      }

      // Update absence status to Cancelled
      const updateData = {
        status: 'Cancelled',
        cancellationReason: cancellationData.cancellationReason,
        cancelledBy: cancellationData.cancelledBy,
        cancelledByName: cancellationData.cancelledByName,
        cancelledAt: Timestamp.fromDate(new Date(cancellationData.cancelledAt)),
        updatedAt: Timestamp.now()
      };

      await updateDoc(absenceRef, updateData);

      // Restore allowance if applicable
      if (absenceData.leaveType && absenceData.duration) {
        try {
          const durationMatch = absenceData.duration.match(/(\d+)/);
          const days = durationMatch ? parseInt(durationMatch[1]) : 0;

          if (days > 0) {
            // Restore days to allowance by subtracting from used days
            await this.restoreAllowanceUsage(absenceData.userId, absenceData.leaveType, days);
          }
        } catch (allowanceError) {
          console.error('Error restoring allowance usage on cancellation:', allowanceError);
          // Don't fail the cancellation if allowance restore fails
        }
      }

      return {
        id: absenceId,
        ...absenceData,
        ...updateData
      };
    } catch (error) {
      console.error('Error cancelling absence:', error);
      throw error;
    }
  }

  async restoreAllowanceUsage(userId, leaveType, days) {
    try {
      // Find the allowance for this user and leave type
      const q = query(
        collection(db, 'allowances'),
        where('employeeId', '==', userId),
        where('leaveType', '==', leaveType),
        where('isActive', '==', true)
      );

      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        console.warn(`No allowance found for user ${userId} and leave type ${leaveType}`);
        return;
      }

      const allowanceDoc = querySnapshot.docs[0];
      const allowanceData = allowanceDoc.data();
      const newUsedDays = Math.max(0, allowanceData.usedDays - days); // Ensure not negative
      const newRemainingDays = allowanceData.totalDays - newUsedDays;

      // Update the allowance
      await updateDoc(allowanceDoc.ref, {
        usedDays: newUsedDays,
        remainingDays: newRemainingDays,
        updatedAt: Timestamp.now()
      });

      console.log(`Restored ${days} days to allowance for user ${userId}, leave type ${leaveType}`);
    } catch (error) {
      console.error('Error restoring allowance usage:', error);
      throw error;
    }
  }

  canCancelAbsence(absenceData, currentUser) {
    // Only managers can cancel approved absences (not employees)
    const managerRoles = [
      'siteManager',
      'hrManager',
      'adminManager',
      'hrAdvisor',
      'adminAdvisor',
      'teamManager'
    ];

    if (!managerRoles.includes(currentUser.role)) {
      return false;
    }

    // Managers cannot cancel their own absences
    if (absenceData.userId === currentUser.userId) {
      return false;
    }

    // Check if in same company
    return currentUser.companyId === absenceData.companyId;
  }

  // Permission helper methods
  async canViewEmployeeAbsences(employeeId, currentUser) {
    // Users can always view their own absences
    if (currentUser.userId === employeeId) {
      return true;
    }

    // Elevated roles can view all absences in their company
    if (['siteManager', 'seniorManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor'].includes(currentUser.role)) {
      return true;
    }

    // Team managers can view absences of their managed employees
    if (currentUser.role === 'teamManager') {
      try {
        const companyId = currentUser.companyId?.includes('/')
          ? currentUser.companyId.split('/')[1]
          : currentUser.companyId;

        if (!companyId) {
          console.warn('Team manager has no companyId');
          return false;
        }

        // Use the comprehensive getManagedEmployeeIdsForManager function
        // NOTE: This assumes a getManagedEmployeeIdsForManager function exists in './teams'
        const { getManagedEmployeeIdsForManager } = await import('./teams');

        // Handle both userId and uid for backward compatibility
        const managerId = currentUser.userId || currentUser.uid;
        if (!managerId) {
          console.warn('Team manager has no userId or uid');
          return false;
        }

        const managedEmployeeIds = await getManagedEmployeeIdsForManager(managerId, companyId);

        // Normalize employeeId for comparison (handle both formats: uid and users/uid)
        const normalizedEmployeeId = employeeId.includes('/') ? employeeId.split('/').pop() : employeeId;

        return managedEmployeeIds.has(normalizedEmployeeId) || managedEmployeeIds.has(employeeId);
      } catch (error) {
        console.error('Error checking team manager permissions:', error);
        return false;
      }
    }

    return false;
  }

  canEditAbsence(absenceData, currentUser) {
    // Validate currentUser object
    if (!currentUser || !currentUser.userId) {
      return false;
    }

    // Users can edit their own pending absences
    if (absenceData.userId === currentUser.userId && absenceData.status === 'Pending') {
      return true;
    }

    // Elevated roles can edit absences in their company
    if (['siteManager', 'seniorManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor', 'teamManager'].includes(currentUser.role)) {
      return currentUser.companyId === absenceData.companyId;
    }

    return false;
  }

  canApproveAbsence(absenceData, currentUser) {
    // Only managers and above can approve absences
    if (['siteManager', 'seniorManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor', 'teamManager'].includes(currentUser.role)) {
      return currentUser.companyId === absenceData.companyId;
    }

    return false;
  }

  canDeleteAbsence(absenceData, currentUser) {
    // Only elevated roles can delete absences
    if (['siteManager', 'seniorManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor', 'teamManager'].includes(currentUser.role)) {
      return currentUser.companyId === absenceData.companyId;
    }

    // Users can delete their own pending absences
    if (absenceData.userId === currentUser.userId && (absenceData.status === 'Pending' || absenceData.status === 'Draft')) {
      return true;
    }

    return false;
  }

  /**
   * Get absence statistics for a user or company
   * @param {string} userId - Optional user ID for individual stats
   * @param {Object} currentUser - The current user object
   * @returns {Promise<Object>} Absence statistics
   */
  async getAbsenceStats(userId = null, currentUser) {
    try {
      console.log('getAbsenceStats called for userId:', userId);
      let q;

      if (userId) {
        console.log('Creating query for specific user:', userId);
        q = query(
          collection(db, this.collection),
          where('userId', '==', userId)
        );
      } else {
        // Company-wide stats for elevated roles
        if (['siteManager', 'seniorManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor'].includes(currentUser.role)) {
          console.log('Creating company-wide query for role:', currentUser.role);
          q = query(
            collection(db, this.collection),
            where('companyId', '==', currentUser.companyId)
          );
        } else {
          console.log('Creating user-specific query for:', currentUser.userId);
          // Regular users get their own stats
          q = query(
            collection(db, this.collection),
            where('userId', '==', currentUser.userId)
          );
        }
      }

      console.log('Executing stats query...');
      const querySnapshot = await getDocs(q);
      console.log('Stats query completed');

      const stats = {
        total: 0,
        approved: 0,
        pending: 0,
        rejected: 0,
        byLeaveType: {}
      };

      querySnapshot.forEach((doc) => {
        const data = doc.data();
        stats.total++;

        switch (data.status) {
          case 'Approved':
            stats.approved++;
            break;
          case 'Pending':
            stats.pending++;
            break;
          case 'Rejected':
            stats.rejected++;
            break;
          case 'Cancelled': // Include cancelled in total, but separately
            break;
        }

        // Count by leave type
        const leaveType = data.leaveType || 'Unknown';
        stats.byLeaveType[leaveType] = (stats.byLeaveType[leaveType] || 0) + 1;
      });

      return stats;
    } catch (error) {
      console.error('Error fetching absence stats:', error);
      throw new Error('Failed to fetch absence statistics');
    }
  }

  /**
   * Subscribe to real-time updates for user absences (OPTIMIZED with 30-day window)
   * @param {string} userId - The user ID
   * @param {Function} callback - Callback function to handle updates
   * @param {Object} options - Optional configuration
   * @param {number} options.dayWindow - Number of days to listen (default: 30)
   * @returns {Function} Unsubscribe function
   */
  subscribeToUserAbsences(userId, callback, options = {}) {
    const { dayWindow = 365 } = options;

    // Calculate time threshold (default: last 30 days)
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - dayWindow);

    const q = query(
      collection(db, this.collection),
      where('userId', '==', userId),
      where('createdAt', '>=', Timestamp.fromDate(threshold)),
      orderBy('createdAt', 'desc')
    );

    return onSnapshot(q, (querySnapshot) => {
      const absences = [];
      querySnapshot.forEach((doc) => {
        absences.push({
          id: doc.id,
          ...doc.data()
        });
      });
      callback(absences);
    }, (error) => {
      console.error('Error in user absences subscription:', error);
      // Return empty array on index building errors to prevent UI crashes
      if (error.code === 'failed-precondition') {
        console.warn('[subscribeToUserAbsences] Index is still building. This is expected during deployment.');
        callback([], error);
      } else {
        callback(null, error);
      }
    });
  }

  /**
   * Subscribe to real-time updates for employee absences based on user role (OPTIMIZED with 30-day window)
   * @param {Object} currentUser - The current user object
   * @param {Function} callback - Callback function to handle updates
   * @param {Object} options - Optional configuration
   * @param {number} options.dayWindow - Number of days to listen (default: 30)
   * @returns {Function} Unsubscribe function
   */
  subscribeToEmployeeAbsences(currentUser, callback, options = {}) {
    const { dayWindow = 365 } = options;

    // Calculate time threshold (default: last 30 days)
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - dayWindow);

    let q;

    // Role-based query logic (same as getEmployeeAbsences)
    if (['siteManager', 'seniorManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor'].includes(currentUser.role)) {
      // Company-wide query with 30-day window (OPTIMIZED)
      q = query(
        collection(db, this.collection),
        where('companyId', '==', currentUser.companyId),
        where('createdAt', '>=', Timestamp.fromDate(threshold)),
        orderBy('createdAt', 'desc')
      );
    } else if (currentUser.role === 'teamManager') {
      // For team managers, we listen to the whole company but the callback will be responsible 
      // for filtering or we enrich here. For real-time stability, we'll listen company-wide.
      q = query(
        collection(db, this.collection),
        where('companyId', '==', currentUser.companyId),
        where('createdAt', '>=', Timestamp.fromDate(threshold)),
        orderBy('createdAt', 'desc')
      );
    } else {
      // Regular users get their own absences
      return this.subscribeToUserAbsences(currentUser.userId, callback, options);
    }

    return onSnapshot(q, (querySnapshot) => {
      const absences = [];
      querySnapshot.forEach((doc) => {
        absences.push({
          id: doc.id,
          ...doc.data()
        });
      });
      callback(absences);
    }, (error) => {
      console.error('Error in employee absences subscription:', error);
      callback(null, error);
    });
  }

  /**
   * Subscribe to real-time updates for a single employee's absences (detail page).
   * IMPORTANT: keep query index-light (no orderBy) to avoid slow index builds.
   * @param {string} employeeId - Employee userId
   * @param {Object} currentUser - The current user object (for permission checks)
   * @param {Function} callback - Callback with (absences)
   * @param {Function} onError - Callback with (error)
   * @returns {Promise<Function>} Unsubscribe function
   */
  async subscribeToEmployeeAbsencesById(employeeId, currentUser, callback, onError) {
    if (!employeeId || !currentUser) return () => { };

    try {
      const canView = await this.canViewEmployeeAbsences(employeeId, currentUser);
      if (!canView) {
        const err = new Error('Permission denied');
        if (onError) onError(err);
        callback([]);
        return () => { };
      }

      const q = query(
        collection(db, this.collection),
        where('userId', '==', employeeId)
      );

      return onSnapshot(q, (querySnapshot) => {
        const absences = [];
        querySnapshot.forEach((docSnap) => {
          absences.push({
            id: docSnap.id,
            ...docSnap.data()
          });
        });
        callback(absences);
      }, (error) => {
        console.error('Error in employee absences-by-id subscription:', error);
        if (onError) onError(error);
        callback([]);
      });
    } catch (error) {
      console.error('Failed to set up employee absences-by-id subscription:', error);
      if (onError) onError(error);
      callback([]);
      return () => { };
    }
  }
}

// Export singleton instance
export const absenceService = new AbsenceService();
export default absenceService;