/**
 * Allowance Service - Handles employee leave allowance management
 * Provides CRUD operations for allowances and integration with absence management
 */

import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore';
import { DEFAULT_ANNUAL_LEAVE_DAYS, DEFAULT_ANNUAL_LEAVE_TYPE, DEFAULT_LEAVE_TYPE, DEFAULT_SICK_LEAVE_DAYS, ALLOWANCE_LINKED_TYPES, LEAVE_TYPES } from '../constants/leaveTypes';
import { db } from '../firebase/client';

/**
 * Allowance Service Class
 */
class AllowanceService {
  constructor() {
    this.collection = 'allowances';
  }

  /**
   * Normalize leave type for consistent matching
   * Converts both "sick_leave" and "Sick Leave" to same format
   * @param {string} leaveType - The leave type to normalize
   * @returns {string} Normalized leave type
   */
  normalizeLeaveType(leaveType) {
    if (!leaveType) return '';
    // Convert to lowercase and replace spaces/underscores for comparison
    return leaveType.toLowerCase().replace(/[\s_]/g, '');
  }

  /**
   * Get display name for leave type
   * @param {string} leaveType - The leave type
   * @returns {string} Display name
   */
  getLeaveTypeDisplayName(leaveType) {
    if (!leaveType) return 'Unknown';

    // Map of normalized types to display names
    const displayNames = {
      'sickleave': 'Sick Leave',
      'sick_leave': 'Sick Leave',
      'maternityleave': 'Maternity Leave',
      'maternity_leave': 'Maternity Leave',
      'paternityleave': 'Paternity Leave',
      'paternity_leave': 'Paternity Leave',
      'bereavementleave': 'Bereavement Leave',
      'personalleave': 'Personal Leave',
      'personal_leave': 'Personal Leave',
      'authorisedabsenceunpaid': 'Authorised Absence (Unpaid)',
      'authorisedabsencepaid': 'Authorised Absence (Paid)',
      'annualleave': 'Annual Leave',
      'annual_leave': 'Annual Leave',
      'Annual leave': 'Annual Leave',
      'holiday': 'Annual Leave', // Backward compatibility: map old 'holiday' to 'Annual Leave'
    };

    const normalized = this.normalizeLeaveType(leaveType);
    return displayNames[normalized] || leaveType;
  }

  /**
   * Create allowances for an employee
   * @param {string} employeeId - The employee ID
   * @param {Array} allowances - Array of allowance objects
   * @param {Object} currentUser - The current user object
   * @returns {Promise<Array>} The created allowances
   */
  async createAllowances(employeeId, allowances, currentUser) {
    try {
      // Check permissions
      if (!this.canManageAllowances(currentUser)) {
        throw new Error('Permission denied');
      }

      // Get employee data
      const employeeDoc = await getDoc(doc(db, 'users', employeeId));
      if (!employeeDoc.exists()) {
        throw new Error('Employee not found');
      }

      const employeeData = employeeDoc.data();
      const now = Timestamp.now();
      const createdAllowances = [];

      // Fetch ALL current active allowances for this employee to do a robust check
      const qExist = query(
        collection(db, this.collection),
        where('employeeId', '==', employeeId),
        where('isActive', '==', true)
      );
      const existSnapshot = await getDocs(qExist);
      const existingAllowances = existSnapshot.docs.map(d => ({ ...d.data(), id: d.id }));

      for (const allowanceData of allowances) {
        if (!allowanceData.type || !allowanceData.totalDays) {
          continue; // Skip incomplete allowances
        }

        // Determine the year for this allowance
        // Priority: explicit year > validFrom year > current year
        let allowanceYear = allowanceData.year;
        if (!allowanceYear && allowanceData.validFrom) {
          allowanceYear = new Date(allowanceData.validFrom).getFullYear();
        }
        if (!allowanceYear) {
          allowanceYear = new Date().getFullYear();
        }

        // Check for existing allowance using normalization
        const normNew = this.normalizeLeaveType(allowanceData.type);
        const alreadyExists = existingAllowances.some(exist => {
          const normExist = this.normalizeLeaveType(exist.leaveType);
          if (normExist !== normNew) return false;

          let itemYear = exist.year;
          if (!itemYear && exist.validFrom) {
            itemYear = new Date(exist.validFrom).getFullYear();
          }
          return itemYear === allowanceYear;
        });

        if (alreadyExists) {
          console.log(`Allowance for ${allowanceData.type} in ${allowanceYear} already exists for employee ${employeeId}, skipping.`);
          continue;
        }

        // Set year boundaries: Jan 1 to Dec 31 of the allowance year
        const yearStart = `${allowanceYear}-01-01`;
        const yearEnd = `${allowanceYear}-12-31`;

        const allowance = {
          employeeId,
          employeeName: employeeData.displayName || (employeeData.firstName + ' ' + (employeeData.lastName || '')).trim(),
          employeeEmail: employeeData.email,
          // Firestore does not allow `undefined` values.
          companyId: employeeData.companyId ?? null,
          siteId: employeeData.siteId ?? null,
          leaveType: allowanceData.type,
          totalDays: parseInt(allowanceData.totalDays),
          usedDays: 0,
          remainingDays: parseInt(allowanceData.totalDays),
          year: allowanceYear, // Explicit year field for easy filtering
          validFrom: allowanceData.validFrom || yearStart,
          validUntil: allowanceData.validUntil || yearEnd,
          isActive: true,
          createdBy: currentUser.userId || currentUser.uid,
          createdAt: now,
          updatedAt: now,
          auditTrail: [{
            action: 'Initial Allowance Set',
            details: `${allowanceData.totalDays} days added for ${allowanceYear}`,
            date: now.toDate().toISOString(),
            performedBy: currentUser.userId || currentUser.uid,
            performedByName: currentUser.displayName || currentUser.email || 'Unknown',
            performedByRole: currentUser.role || 'Unknown'
          }]
        };

        const docRef = await addDoc(collection(db, this.collection), allowance);
        createdAllowances.push({
          id: docRef.id,
          ...allowance
        });
      }

      return createdAllowances;
    } catch (error) {
      console.error('Error creating allowances:', error);
      throw new Error('Failed to create allowances');
    }
  }

  /**
   * Calculate days from start and end dates
   * @param {string} startDate - Start date string
   * @param {string} endDate - End date string
   * @returns {number} Number of days
   */
  calculateDaysFromDates(startDate, endDate) {
    if (!startDate || !endDate) return 0;
    try {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const startMs = start.getTime();
      const endMs = end.getTime();
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) return 0;
      if (endMs < startMs) return 0; // invalid range
      const durationMs = endMs - startMs;
      const days = Math.ceil(durationMs / (1000 * 60 * 60 * 24)) + 1;

      // Validate result is reasonable
      if (days < 0 || days > 365) {
        console.warn(`Unreasonable days calculated: ${days} from ${startDate} to ${endDate}`);
        return Math.max(1, Math.min(365, days));
      }

      return Number.isFinite(days) ? Math.max(0, days) : 0;
    } catch (error) {
      console.error('Error calculating days from dates:', error);
      return 0;
    }
  }

  /**
   * Recalculate used days from approved absences
   * @param {string} employeeId - The employee ID
   * @param {string} leaveType - The leave type
   * @param {number} year - Optional year filter
   * @param {Array} providedAbsences - Optional pre-fetched absences to avoid redundant queries
   * @returns {Promise<number>} Total used days
   */
  async recalculateUsedDaysFromAbsences(employeeId, leaveType, year = null, providedAbsences = null) {
    try {
      let absences;

      if (providedAbsences) {
        absences = providedAbsences;
      } else {
        // Query all approved and pending absences for this employee
        let absencesQuery = query(
          collection(db, 'absences'),
          where('userId', '==', employeeId),
          where('status', '==', 'Approved')
        );

        const absencesSnapshot = await getDocs(absencesQuery);
        absences = [];
        absencesSnapshot.forEach(doc => absences.push(doc.data()));
      }

      let totalUsedDays = 0;
      const normalizedTargetType = this.normalizeLeaveType(leaveType);
      const processedIds = new Set(); // Prevent double counting

      absences.forEach((absenceData) => {
        // Skip if already processed
        if (processedIds.has(absenceData.id)) {
          return;
        }
        processedIds.add(absenceData.id);

        // Check if leave types match (normalized comparison)
        const absenceLeaveType = absenceData.leaveType || '';
        const normalizedAbsenceType = this.normalizeLeaveType(absenceLeaveType);

        if (normalizedAbsenceType !== normalizedTargetType) {
          return; // Skip absences of different leave types
        }

        // Only count Approved or Pending absences
        const status = (absenceData.status || '').toLowerCase();
        if (status !== 'approved') {
          return;
        }

        // Filter by year if provided
        if (year) {
          const absenceYear = absenceData.startDate
            ? new Date(absenceData.startDate).getFullYear()
            : absenceData.createdAt?.toDate?.()?.getFullYear?.() || new Date().getFullYear();

          if (absenceYear !== year) {
            return; // Skip absences not in the requested year
          }
        }

        let daysToAdd = 0;

        // Calculate days from startDate and endDate
        if (absenceData.startDate && absenceData.endDate) {
          daysToAdd = this.calculateDaysFromDates(absenceData.startDate, absenceData.endDate);
        } else if (absenceData.duration) {
          // Fallback: try to extract from duration string
          const durationMatch = absenceData.duration.match(/(\d+)/);
          if (durationMatch) {
            daysToAdd = parseInt(durationMatch[1]);
          }
        }

        // Validate days before adding
        if (daysToAdd > 0 && daysToAdd <= 365) {
          totalUsedDays += daysToAdd;
        } else {
          console.warn(`Invalid days calculated for absence ${absenceData.id}: ${daysToAdd}`);
        }
      });
      return totalUsedDays;
    } catch (error) {
      console.error('Error recalculating used days from absences:', error);
      return 0;
    }
  }

  /**
   * Get allowances for an employee
   * @param {string} employeeId - The employee ID
   * @param {Object} currentUser - The current user object
   * @returns {Promise<Array>} Array of employee allowances
   */
  async getEmployeeAllowances(employeeId, currentUser, year = null) {
    try {
      // Check permissions
      if (!this.canViewAllowances(employeeId, currentUser)) {
        console.log('Permission denied for user:', currentUser?.role, 'viewing employee:', employeeId);
        throw new Error('Permission denied');
      }

      // Build query - filter by employee and active status
      let q = query(
        collection(db, this.collection),
        where('employeeId', '==', employeeId),
        where('isActive', '==', true)
      );

      // Fetch all active allowances
      let querySnapshot;
      try {
        const orderedQ = query(q, orderBy('createdAt', 'desc'));
        querySnapshot = await getDocs(orderedQ);
      } catch (orderByError) {
        querySnapshot = await getDocs(q);
      }

      const rawAllowances = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        let isValidForYear = true;

        if (year) {
          if (data.year) {
            isValidForYear = data.year === year;
          } else if (data.validFrom) {
            isValidForYear = new Date(data.validFrom).getFullYear() === year;
          } else {
            isValidForYear = false; // Filter out legacy data if year is specified
          }
        }

        if (isValidForYear) {
          rawAllowances.push({ id: doc.id, ...data });
        }
      });

      // Sort if needed (Firestore orderBy fallback)
      if (rawAllowances.length > 1) {
        rawAllowances.sort((a, b) => {
          const aTime = a.createdAt?.toMillis?.() || a.createdAt || 0;
          const bTime = b.createdAt?.toMillis?.() || b.createdAt || 0;
          return bTime - aTime;
        });
      }

      // Group by normalized leave type (latest entry wins)
      const groupedMap = new Map();
      rawAllowances.forEach((allowance) => {
        const normalized = this.normalizeLeaveType(allowance.leaveType);
        if (!groupedMap.has(normalized)) {
          groupedMap.set(normalized, {
            ...allowance,
            displayName: this.getLeaveTypeDisplayName(allowance.leaveType),
            ids: [allowance.id]
          });
        } else {
          groupedMap.get(normalized).ids.push(allowance.id);
        }
      });

      const deduplicatedAllowances = Array.from(groupedMap.values());

      // OPTIMIZATION: Fetch ALL approved absences for this user ONCE with year filter
      const targetYear = year || new Date().getFullYear();
      let absencesQuery = query(
        collection(db, 'absences'),
        where('userId', '==', employeeId),
        where('status', '==', 'Approved')
      );

      let absencesSnapshot;
      try {
        absencesSnapshot = await getDocs(absencesQuery);
      } catch (queryError) {
        // Fallback if index doesn't exist yet
        console.warn('Year-filtered absences query failed, using fallback:', queryError);
        absencesQuery = query(
          collection(db, 'absences'),
          where('userId', '==', employeeId),
          where('status', '==', 'Approved')
        );
        absencesSnapshot = await getDocs(absencesQuery);
      }

      // Client-side year filtering to avoid composite index requirement
      const yearFilteredAbsences = absencesSnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(absence => {
          if (!absence.startDate) return false;
          const absenceYear = new Date(absence.startDate).getFullYear();
          return absenceYear === targetYear;
        });

      const allApprovedAbsences = yearFilteredAbsences;

      // OPTIMIZATION: Pre-calculate usage by leave type to avoid repeated calculations
      const usageByLeaveType = new Map();
      const processedAbsenceIds = new Set(); // Prevent double counting

      allApprovedAbsences.forEach((absence) => {
        // Skip if already processed (prevent duplicates)
        if (processedAbsenceIds.has(absence.id)) {
          console.warn(`Skipping duplicate absence ID: ${absence.id}`);
          return;
        }
        processedAbsenceIds.add(absence.id);

        const leaveType = absence.leaveType || '';
        const normalizedType = this.normalizeLeaveType(leaveType);

        if (!usageByLeaveType.has(normalizedType)) {
          usageByLeaveType.set(normalizedType, 0);
        }

        let daysToAdd = 0;

        // Calculate days from startDate and endDate (preferred method)
        if (absence.startDate && absence.endDate) {
          daysToAdd = this.calculateDaysFromDates(absence.startDate, absence.endDate);
        } else if (absence.duration) {
          const durationMatch = absence.duration.match(/(\d+)/);
          if (durationMatch) {
            daysToAdd = parseInt(durationMatch[1]);
          }
        }

        // Validate days before adding
        if (daysToAdd > 0 && daysToAdd <= 365) {
          usageByLeaveType.set(normalizedType, usageByLeaveType.get(normalizedType) + daysToAdd);
        } else {
          console.warn(`Invalid days calculated for absence ${absence.id}: ${daysToAdd}`);
        }
      });

      // OPTIMIZATION: Update allowances in parallel using pre-calculated usage
      const updatedAllowances = await Promise.all(
        deduplicatedAllowances.map(async (allowance) => {
          const normalizedType = this.normalizeLeaveType(allowance.leaveType);
          const actualUsedDays = usageByLeaveType.get(normalizedType) || 0;

          const safeUsed = Number.isFinite(actualUsedDays) ? actualUsedDays : 0;
          const newRemainingDays = Math.max(0, (allowance.totalDays || 0) - safeUsed);

          // ONLY update Firestore if the stored values differ significantly
          const storedUsed = Number(allowance.usedDays) || 0;
          const storedRemaining = Number(allowance.remainingDays) || 0;

          if (Math.abs(storedUsed - safeUsed) > 0.1 || Math.abs(storedRemaining - newRemainingDays) > 0.1) {
            // Update in background to not block the response
            setTimeout(() => {
              allowance.ids.forEach(id => {
                updateDoc(doc(db, this.collection, id), {
                  usedDays: safeUsed,
                  remainingDays: newRemainingDays,
                  updatedAt: Timestamp.now()
                }).catch(e => console.error('Error background syncing allowance:', id, e));
              });
            }, 0);
          }

          return {
            ...allowance,
            usedDays: safeUsed,
            remainingDays: newRemainingDays
          };
        })
      );

      // Handle virtual allowances (types with absences but no allowance doc) using pre-calculated usage
      const absenceLeaveTypes = new Set();
      allApprovedAbsences.forEach(abs => {
        if (abs.leaveType) {
          const absYear = abs.startDate ? new Date(abs.startDate).getFullYear() : (abs.createdAt?.toDate?.()?.getFullYear() || new Date().getFullYear());
          if (absYear === targetYear) {
            absenceLeaveTypes.add(this.normalizeLeaveType(abs.leaveType));
          }
        }
      });

      const existingTypes = new Set(updatedAllowances.map(a => this.normalizeLeaveType(a.leaveType)));

      // Add virtual allowances for types that have absences but no allowance doc
      for (const absTypeNorm of absenceLeaveTypes) {
        if (!existingTypes.has(absTypeNorm)) {
          const displayName = this.getLeaveTypeDisplayName(absTypeNorm);
          const used = usageByLeaveType.get(absTypeNorm) || 0;
          updatedAllowances.push({
            id: `virtual-${absTypeNorm}`,
            employeeId,
            leaveType: displayName,
            totalDays: 0,
            usedDays: used,
            remainingDays: -used, // Negative means overused
            isVirtual: true,
            validFrom: `${targetYear}-01-01`,
            validUntil: `${targetYear}-12-31`
          });
          existingTypes.add(absTypeNorm);
        }
      }

      // Final pass: ensure ALL core ALLOWANCE_LINKED_TYPES are present to maintain UI consistency
      ALLOWANCE_LINKED_TYPES.forEach(typeKey => {
        const norm = this.normalizeLeaveType(typeKey);
        if (!existingTypes.has(norm)) {
          const leaveConfig = LEAVE_TYPES.find(t => t.value === typeKey);
          const displayName = leaveConfig?.label || this.getLeaveTypeDisplayName(typeKey);
          
          updatedAllowances.push({
            id: `default-empty-${norm}`,
            employeeId,
            leaveType: displayName,
            totalDays: 0,
            usedDays: 0,
            remainingDays: 0,
            isEmpty: true,
            validFrom: `${targetYear}-01-01`,
            validUntil: `${targetYear}-12-31`
          });
        }
      });

      return updatedAllowances;
    } catch (error) {
      console.error('Error fetching employee allowances:', error);
      if (error.code === 'failed-precondition' && error.message?.includes('currently building')) {
        throw new Error('Index is currently building. Please wait 5-10 minutes and refresh the page.');
      }
      throw new Error('Failed to fetch allowances');
    }
  }

  /**
   * Subscribe to real-time allowance updates for an employee (FAST, no absences recalculation).
   * Uses client-side year filtering to avoid composite indexes.
   * @param {string} employeeId
   * @param {Object} currentUser
   * @param {number|null} year
   * @param {Function} onUpdate - (allowances:Array) => void
   * @param {Function} onError - (error:Error) => void
   * @returns {Function} unsubscribe
   */
  subscribeToEmployeeAllowances(employeeId, currentUser, year, onUpdate, onError) {
    try {
      if (!this.canViewAllowances(employeeId, currentUser)) {
        const err = new Error('Permission denied');
        if (onError) onError(err);
        onUpdate([]);
        return () => { };
      }

      const q = query(
        collection(db, this.collection),
        where('employeeId', '==', employeeId),
        where('isActive', '==', true)
      );

      return onSnapshot(q, (snapshot) => {
        const rawAllowances = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          let isValidForYear = true;

          if (year) {
            if (data.year) {
              isValidForYear = data.year === year;
            } else if (data.validFrom) {
              isValidForYear = new Date(data.validFrom).getFullYear() === year;
            } else {
              isValidForYear = false;
            }
          }

          if (isValidForYear) rawAllowances.push({ id: docSnap.id, ...data });
        });

        // Deduplicate by normalized leave type (latest wins by createdAt)
        rawAllowances.sort((a, b) => {
          const aT = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
          const bT = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
          return bT - aT;
        });

        const groupedMap = new Map();
        rawAllowances.forEach((allowance) => {
          const normalized = this.normalizeLeaveType(allowance.leaveType);
          if (!groupedMap.has(normalized)) {
            groupedMap.set(normalized, {
              ...allowance,
              displayName: this.getLeaveTypeDisplayName(allowance.leaveType),
              ids: [allowance.id]
            });
          } else {
            groupedMap.get(normalized).ids.push(allowance.id);
          }
        });

        const sortedAllowances = Array.from(groupedMap.values());
        const existingTypes = new Set(sortedAllowances.map(a => this.normalizeLeaveType(a.leaveType)));
        
        // Ensure ALL core ALLOWANCE_LINKED_TYPES are present in real-time snapshot too
        ALLOWANCE_LINKED_TYPES.forEach(typeKey => {
          const norm = this.normalizeLeaveType(typeKey);
          if (!existingTypes.has(norm)) {
            const leaveConfig = LEAVE_TYPES.find(t => t.value === typeKey);
            const displayName = leaveConfig?.label || this.getLeaveTypeDisplayName(typeKey);
            
            sortedAllowances.push({
              id: `default-empty-${norm}`,
              employeeId,
              leaveType: displayName,
              totalDays: 0,
              usedDays: 0,
              remainingDays: 0,
              isEmpty: true,
              validFrom: `${year || new Date().getFullYear()}-01-01`,
              validUntil: `${year || new Date().getFullYear()}-12-31`
            });
            existingTypes.add(norm);
          }
        });

        onUpdate(sortedAllowances);
      }, (err) => {
        console.error('subscribeToEmployeeAllowances error:', err);
        if (onError) onError(err);
        onUpdate([]);
      });
    } catch (err) {
      console.error('subscribeToEmployeeAllowances setup failed:', err);
      if (onError) onError(err);
      onUpdate([]);
      return () => { };
    }
  }

  /**
   * Subscribe to employee list for allowance management (company-wide roles only).
   * TeamManager requires managedEmployees logic, so it should use getEmployeesForAllowances().
   * @param {Object} currentUser
   * @param {Function} onUpdate
   * @param {Function} onError
   * @returns {Function} unsubscribe
   */
  subscribeEmployeesForAllowances(currentUser, onUpdate, onError) {
    try {
      if (!this.canManageAllowances(currentUser)) {
        const err = new Error('Permission denied');
        if (onError) onError(err);
        onUpdate([]);
        return () => { };
      }

      if ((currentUser?.role || currentUser?.primaryRole) === 'teamManager') {
        // Cannot subscribe efficiently for team managers without extra joins
        onUpdate([]);
        return () => { };
      }

      const q = query(
        collection(db, 'users'),
        where('companyId', '==', currentUser.companyId),
        where('status', '==', 'active')
      );

      return onSnapshot(q, (snapshot) => {
        const employees = [];
        snapshot.forEach((docSnap) => {
          const userData = docSnap.data();
          employees.push({
            id: docSnap.id,
            userId: docSnap.id,
            uid: docSnap.id,
            name: userData.displayName,
            email: userData.email,
            phone: userData.phone || 'N/A',
            location: userData.location || 'N/A',
            department: userData.department || 'N/A',
            role: userData.primaryRole,
            primaryRole: userData.primaryRole,
            hireDate: userData.hireDate || userData.createdAt?.toDate?.()?.toISOString?.()?.split('T')[0]
          });
        });
        onUpdate(employees);
      }, (err) => {
        console.error('subscribeEmployeesForAllowances error:', err);
        if (onError) onError(err);
        onUpdate([]);
      });
    } catch (err) {
      console.error('subscribeEmployeesForAllowances setup failed:', err);
      if (onError) onError(err);
      onUpdate([]);
      return () => { };
    }
  }

  /**
   * Get all employees who need allowances based on user role
   * @param {Object} currentUser - The current user object
   * @returns {Promise<Array>} Array of employees
   */
  async getEmployeesForAllowances(currentUser) {
    try {
      let q;

      // Role-based query logic
      if (['siteManager', 'seniorManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor'].includes(currentUser.role)) {
        // These roles can see all employees in their company
        q = query(
          collection(db, 'users'),
          where('companyId', '==', currentUser.companyId),
          where('status', '==', 'active')
        );
      } else if (currentUser.role === 'teamManager') {
        // Team managers can only see their managed employees
        const userDoc = await getDoc(doc(db, 'users', currentUser.userId || currentUser.uid));
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
            collection(db, 'users'),
            where('userId', 'in', batch),
            where('status', '==', 'active')
          );
          batches.push(batchQuery);
        }

        // Execute all batch queries
        const allResults = await Promise.all(
          batches.map(batchQuery => getDocs(batchQuery))
        );

        // Combine results
        const employees = [];
        allResults.forEach(querySnapshot => {
          querySnapshot.forEach((doc) => {
            const userData = doc.data();
            employees.push({
              id: doc.id,
              userId: doc.id,
              uid: doc.id,
              name: userData.displayName,
              email: userData.email,
              phone: userData.phone || 'N/A',
              location: userData.location || 'N/A',
              department: userData.department || 'N/A',
              role: userData.primaryRole,
              hireDate: userData.hireDate || userData.createdAt?.toDate?.()?.toISOString?.()?.split('T')[0]
            });
          });
        });

        return employees;
      } else {
        // Regular employees cannot manage allowances
        throw new Error('Permission denied');
      }

      const querySnapshot = await getDocs(q);
      const employees = [];

      querySnapshot.forEach((doc) => {
        const userData = doc.data();
        employees.push({
          id: doc.id,
          userId: doc.id,
          uid: doc.id,
          name: userData.displayName,
          email: userData.email,
          phone: userData.phone || 'N/A',
          location: userData.location || 'N/A',
          department: userData.department || 'N/A',
          role: userData.primaryRole,
          hireDate: userData.hireDate || userData.createdAt?.toDate?.()?.toISOString?.()?.split('T')[0]
        });
      });

      return employees;
    } catch (error) {
      console.error('Error fetching employees for allowances:', error);
      throw new Error('Failed to fetch employees');
    }
  }

  /**
   * Update allowance usage when an absence is approved
   * @param {string} employeeId - The employee ID
   * @param {string} leaveType - The leave type
   * @param {number} days - Number of days to deduct
   * @returns {Promise<Object>} Updated allowance info
   */
  async updateAllowanceUsage(employeeId, leaveType, days) {
    try {
      const normalizedTargetType = this.normalizeLeaveType(leaveType);
      const q = query(
        collection(db, this.collection),
        where('employeeId', '==', employeeId),
        where('isActive', '==', true)
      );

      const querySnapshot = await getDocs(q);
      const allowanceDoc = querySnapshot.docs.find(d => this.normalizeLeaveType(d.data().leaveType) === normalizedTargetType);

      if (!allowanceDoc) {
        return { hasAllowance: false, remainingDays: 0 };
      }

      const allowanceData = allowanceDoc.data();
      const newUsedDays = (Number(allowanceData.usedDays) || 0) + days;
      const newRemainingDays = (Number(allowanceData.totalDays) || 0) - newUsedDays;

      await updateDoc(allowanceDoc.ref, {
        usedDays: newUsedDays,
        remainingDays: newRemainingDays,
        updatedAt: Timestamp.now()
      });

      return {
        hasAllowance: true,
        totalDays: allowanceData.totalDays,
        usedDays: newUsedDays,
        remainingDays: newRemainingDays,
        canAutoApprove: newRemainingDays >= 0
      };
    } catch (error) {
      console.error('Error updating allowance usage:', error);
      throw new Error('Failed to update allowance usage');
    }
  }

  /**
   * Check if an absence can be auto-approved based on allowances
   * @param {string} employeeId - The employee ID
   * @param {string} leaveType - The leave type
   * @param {number} days - Number of days requested
   * @returns {Promise<Object>} Auto-approval status and allowance info
   */
  async checkAutoApproval(employeeId, leaveType, days) {
    try {
      const normalizedTargetType = this.normalizeLeaveType(leaveType);
      const q = query(
        collection(db, this.collection),
        where('employeeId', '==', employeeId),
        where('isActive', '==', true)
      );

      const querySnapshot = await getDocs(q);
      let allowanceDoc = querySnapshot.docs.find(d => this.normalizeLeaveType(d.data().leaveType) === normalizedTargetType);

      if (!allowanceDoc) {
        // No allowance found - try to create automatic sick leave if it's sick leave
        if (normalizedTargetType === 'sickleave' || normalizedTargetType === 'sick_leave') {
          const userDoc = await getDoc(doc(db, 'users', employeeId));
          if (userDoc.exists()) {
            await this.createAutomaticSickLeave(employeeId, userDoc.data());
            const retrySnapshot = await getDocs(q);
            allowanceDoc = retrySnapshot.docs.find(d => this.normalizeLeaveType(d.data().leaveType) === normalizedTargetType);
          }
        }

        if (!allowanceDoc) {
          return { canAutoApprove: false, hasAllowance: false, reason: 'No allowance configured' };
        }
      }

      const allowanceData = allowanceDoc.data();
      const wouldRemain = (Number(allowanceData.remainingDays) || 0) - days;

      if (wouldRemain >= 0) {
        return {
          canAutoApprove: true,
          hasAllowance: true,
          totalDays: allowanceData.totalDays,
          usedDays: allowanceData.usedDays,
          remainingDays: allowanceData.remainingDays,
          wouldRemain,
          reason: 'Within allowance limits'
        };
      } else {
        return {
          canAutoApprove: false,
          hasAllowance: true,
          totalDays: allowanceData.totalDays,
          usedDays: allowanceData.usedDays,
          remainingDays: allowanceData.remainingDays,
          wouldRemain,
          reason: `Would exceed allowance by ${Math.abs(wouldRemain)} days`
        };
      }
    } catch (error) {
      console.error('Error checking auto-approval:', error);
      return { canAutoApprove: false, hasAllowance: false, reason: 'Error checking allowance' };
    }
  }

  /**
   * Get allowance summary for display in absence approval
   * @param {string} employeeId - The employee ID
   * @param {string} leaveType - The leave type
   * @returns {Promise<Object>} Allowance summary
   */
  async getAllowanceSummary(employeeId, leaveType) {
    try {
      // Get all active allowances for employee to handle normalized type matching
      const allowances = await this.getEmployeeAllowances(employeeId, { userId: employeeId }, new Date().getFullYear());
      const normalizedTargetType = this.normalizeLeaveType(leaveType);

      const match = allowances.find(a => this.normalizeLeaveType(a.leaveType) === normalizedTargetType);

      if (!match) return null;

      return {
        totalDays: match.totalDays,
        usedDays: match.usedDays,
        remainingDays: match.remainingDays,
        validFrom: match.validFrom,
        validUntil: match.validUntil
      };
    } catch (error) {
      console.error('Error fetching allowance summary:', error);
      return null;
    }
  }

  /**
   * Check if employee has automatic sick leave for current year
   * @param {string} employeeId - The employee ID
   * @returns {Promise<boolean>} Whether allowance exists
   */
  async hasAutomaticSickLeave(employeeId) {
    try {
      const currentYear = new Date().getFullYear();
      const q = query(
        collection(db, this.collection),
        where('employeeId', '==', employeeId),
        where('leaveType', '==', DEFAULT_LEAVE_TYPE),
        where('year', '==', currentYear),
        where('isActive', '==', true)
      );
      const snapshot = await getDocs(q);
      return !snapshot.empty;
    } catch (error) {
      console.error('Error checking for automatic sick leave:', error);
      return false;
    }
  }

  /**
   * Check if employee has automatic annual leave for current year
   * @param {string} employeeId - The employee ID
   * @returns {Promise<boolean>} Whether allowance exists
   */
  async hasAutomaticAnnualLeave(employeeId) {
    try {
      const currentYear = new Date().getFullYear();
      const q = query(
        collection(db, this.collection),
        where('employeeId', '==', employeeId),
        where('leaveType', '==', DEFAULT_ANNUAL_LEAVE_TYPE),
        where('year', '==', currentYear),
        where('isActive', '==', true)
      );
      const snapshot = await getDocs(q);
      return !snapshot.empty;
    } catch (error) {
      console.error('Error checking for automatic annual leave:', error);
      return false;
    }
  }

  /**
   * Create automatic sick leave allowance for a new employee
   * @param {string} employeeId - The employee ID
   * @param {Object} employeeData - Employee data object
   * @returns {Promise<Object>} The created allowance
   */
  async createAutomaticSickLeave(employeeId, employeeData) {
    try {
      const currentYear = new Date().getFullYear();
      const allowanceData = [
        {
          type: DEFAULT_LEAVE_TYPE,
          totalDays: DEFAULT_SICK_LEAVE_DAYS,
          year: currentYear,
          validFrom: `${currentYear}-01-01`,
          validUntil: `${currentYear}-12-31`
        }
      ];

      const sysUser = { userId: 'system', displayName: 'System Auto-Creation', role: 'system' };
      const created = await this.createAllowances(employeeId, allowanceData, sysUser);
      return created.length > 0 ? created[0] : null;
    } catch (error) {
      console.error('Error in createAutomaticSickLeave:', error);
      return null;
    }
  }

  /**
   * Create automatic annual leave allowance for a new employee
   * @param {string} employeeId - The employee ID
   * @param {Object} employeeData - Employee data object
   * @returns {Promise<Object>} The created allowance
   */
  async createAutomaticAnnualLeave(employeeId, employeeData) {
    try {
      const currentYear = new Date().getFullYear();
      const allowanceData = [
        {
          type: DEFAULT_ANNUAL_LEAVE_TYPE,
          totalDays: DEFAULT_ANNUAL_LEAVE_DAYS,
          year: currentYear,
          validFrom: `${currentYear}-01-01`,
          validUntil: `${currentYear}-12-31`
        }
      ];

      const sysUser = { userId: 'system', displayName: 'System Auto-Creation', role: 'system' };
      const created = await this.createAllowances(employeeId, allowanceData, sysUser);
      return created.length > 0 ? created[0] : null;
    } catch (error) {
      console.error('Error in createAutomaticAnnualLeave:', error);
      return null;
    }
  }

  /**
   * Create automatic sick leave allowances for all employees
   * @param {string} companyId - Company ID
   * @returns {Promise<Object>} Summary
   */
  async createYearlyAutomaticSickLeave(companyId) {
    try {
      const q = query(
        collection(db, 'users'),
        where('companyId', '==', companyId),
        where('status', '==', 'active')
      );
      const userSnapshot = await getDocs(q);
      let created = 0;
      let skipped = 0;

      for (const userDoc of userSnapshot.docs) {
        const userId = userDoc.id;
        const employeeData = userDoc.data();
        const hasAL = await this.hasAutomaticSickLeave(userId);
        if (!hasAL) {
          await this.createAutomaticSickLeave(userId, employeeData);
          created++;
        } else {
          skipped++;
        }
      }
      return { success: true, created, skipped };
    } catch (error) {
      console.error('Error in createYearlyAutomaticSickLeave:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Create automatic annual leave allowances for all employees
   * @param {string} companyId - Company ID
   * @returns {Promise<Object>} Summary
   */
  async createYearlyAutomaticAnnualLeave(companyId) {
    try {
      const q = query(
        collection(db, 'users'),
        where('companyId', '==', companyId),
        where('status', '==', 'active')
      );
      const userSnapshot = await getDocs(q);
      let created = 0;
      let skipped = 0;

      for (const userDoc of userSnapshot.docs) {
        const userId = userDoc.id;
        const employeeData = userDoc.data();
        const hasAL = await this.hasAutomaticAnnualLeave(userId);
        if (!hasAL) {
          await this.createAutomaticAnnualLeave(userId, employeeData);
          created++;
        } else {
          skipped++;
        }
      }
      return { success: true, created, skipped };
    } catch (error) {
      console.error('Error in createYearlyAutomaticAnnualLeave:', error);
      return { success: false, error: error.message };
    }
  }

  // Permission helper methods
  canManageAllowances(currentUser) {
    const role = currentUser?.role || currentUser?.primaryRole;
    return ['system', 'siteManager', 'seniorManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor', 'teamManager'].includes(role);
  }

  canViewAllowances(employeeId, currentUser) {
    // Users can view their own allowances
    if (currentUser.userId === employeeId) {
      return true;
    }

    // Managers can view allowances they can manage
    return this.canManageAllowances(currentUser);
  }

  /**
   * Update an allowance
   */
  async updateAllowance(allowanceId, updateData, currentUser) {
    try {
      if (!this.canManageAllowances(currentUser)) {
        throw new Error('Permission denied');
      }

      const allowanceRef = doc(db, this.collection, allowanceId);
      const { auditEntry, ...otherUpdateData } = updateData;

      const updatedData = {
        ...otherUpdateData,
        updatedAt: Timestamp.now()
      };

      if (auditEntry) {
        updatedData.auditTrail = arrayUnion(auditEntry);
      }

      await updateDoc(allowanceRef, updatedData);
      const updatedDoc = await getDoc(allowanceRef);
      return { id: allowanceId, ...updatedDoc.data() };
    } catch (error) {
      console.error('Error updating allowance:', error);
      throw new Error('Failed to update allowance');
    }
  }

  /**
   * Delete an allowance
   */
  async deleteAllowance(allowanceId, currentUser) {
    try {
      if (!this.canManageAllowances(currentUser)) {
        throw new Error('Permission denied');
      }

      const allowanceRef = doc(db, this.collection, allowanceId);
      await deleteDoc(allowanceRef);
      return true;
    } catch (error) {
      console.error('Error deleting allowance:', error);
      throw new Error('Failed to delete allowance');
    }
  }
}

// Create singleton instance
const allowanceService = new AllowanceService();

export default allowanceService;
export { allowanceService };