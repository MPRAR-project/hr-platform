/**
 * Automatic Allowance Service - Handles automatic creation of sick leave and holiday allowances
 * This service ensures all employees have their yearly allowances without manual intervention
 */

import {
  collection,
  getDocs,
  query,
  where
} from 'firebase/firestore';
import { db } from '../firebase/client';
import { DEFAULT_ANNUAL_LEAVE_TYPE, DEFAULT_LEAVE_TYPE } from '../constants/leaveTypes';
import { allowanceService } from './allowanceService';

class AutomaticAllowanceService {
  constructor() {
    this.isProcessing = false;
    this.lastProcessedDate = null;
  }

  /**
   * Ensure all employees in a company have automatic sick leave allowances
   * This is called automatically when managers access allowance-related pages
   * @param {string} companyId - Company ID
   * @param {Object} currentUser - Current user object
   * @returns {Promise<Object>} Result summary
   */
  async ensureCompanySickLeaveAllowances(companyId, currentUser) {
    // Only allow managers to trigger this
    if (!this.canManageAllowances(currentUser)) {
      return { success: false, reason: 'Permission denied' };
    }

    // Prevent multiple simultaneous processes
    if (this.isProcessing) {
      return { success: false, reason: 'Already processing' };
    }

    // Check if we've already processed today (to avoid excessive calls)
    const today = new Date().toDateString();
    if (this.lastProcessedDate === today) {
      return { success: true, reason: 'Already processed today', created: 0, skipped: 0 };
    }

    this.isProcessing = true;

    try {
      console.log(`Auto-ensuring sick leave allowances for company: ${companyId}`);

      const result = await allowanceService.createYearlyAutomaticSickLeave(companyId);

      // Mark as processed for today
      this.lastProcessedDate = today;

      if (result.created > 0) {
        console.log(`Automatically created ${result.created} sick leave allowances`);
      }

      return result;
    } catch (error) {
      console.error('Error in automatic allowance creation:', error);
      return { success: false, reason: error.message, created: 0, skipped: 0 };
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Ensure all employees in a company have automatic annual leave allowances
   * This is called automatically when managers access allowance-related pages
   * @param {string} companyId - Company ID
   * @param {Object} currentUser - Current user object
   * @returns {Promise<Object>} Result summary
   */
  async ensureCompanyAnnualLeaveAllowances(companyId, currentUser) {
    // Only allow managers to trigger this
    if (!this.canManageAllowances(currentUser)) {
      return { success: false, reason: 'Permission denied' };
    }

    // Prevent multiple simultaneous processes
    if (this.isProcessing) {
      return { success: false, reason: 'Already processing' };
    }

    // Check if we've already processed today (to avoid excessive calls)
    const today = new Date().toDateString();
    if (this.lastProcessedDate === today) {
      return { success: true, reason: 'Already processed today', created: 0, skipped: 0 };
    }

    this.isProcessing = true;

    try {
      console.log(`Auto-ensuring annual leave allowances for company: ${companyId}`);

      const result = await allowanceService.createYearlyAutomaticAnnualLeave(companyId);

      // Mark as processed for today
      this.lastProcessedDate = today;

      if (result.created > 0) {
        console.log(`Automatically created ${result.created} annual leave allowances`);
      }

      return result;
    } catch (error) {
      console.error('Error in automatic annual leave allowance creation:', error);
      return { success: false, reason: error.message, created: 0, skipped: 0 };
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Ensure sick leave allowances for a company
   * @param {string} companyId - Company ID
   * @param {Object} currentUser - Current user object
   * @returns {Promise<Object>} Result summary
   */
  async ensureCompanyAllowances(companyId, currentUser) {
    const sickResult = await this.ensureCompanySickLeaveAllowances(companyId, currentUser);

    return {
      success: sickResult.success,
      sickLeave: sickResult,
      totalCreated: (sickResult.created || 0)
    };
  }

  /**
   * Create sick leave allowance for a new employee
   * Called automatically when new employees are created
   * @param {string} employeeId - Employee ID
   * @param {Object} employeeData - Employee data
   * @returns {Promise<Object>} Created allowance or null
   */
  async ensureEmployeeSickLeave(employeeId, employeeData) {
    try {
      // Check if employee already has sick leave for current year
      const hasSickLeave = await allowanceService.hasAutomaticSickLeave(employeeId);

      if (hasSickLeave) {
        console.log(`Employee ${employeeId} already has sick leave allowance`);
        return null;
      }

      // Create automatic sick leave
      const allowance = await allowanceService.createAutomaticSickLeave(employeeId, employeeData);
      console.log(`Created automatic sick leave for new employee: ${employeeId}`);

      return allowance;
    } catch (error) {
      console.error(`Error creating automatic sick leave for employee ${employeeId}:`, error);
      return null;
    }
  }

  /**
   * Create annual leave allowance for a new employee
   * Called automatically when new employees are created
   * @param {string} employeeId - Employee ID
   * @param {Object} employeeData - Employee data
   * @returns {Promise<Object>} Created allowance or null
   */
  async ensureEmployeeAnnualLeave(employeeId, employeeData) {
    try {
      // Check if employee already has annual leave for current year
      const hasAnnualLeave = await allowanceService.hasAutomaticAnnualLeave(employeeId);

      if (hasAnnualLeave) {
        console.log(`Employee ${employeeId} already has annual leave allowance`);
        return null;
      }

      // Create automatic annual leave
      const allowance = await allowanceService.createAutomaticAnnualLeave(employeeId, employeeData);
      console.log(`Created automatic annual leave for new employee: ${employeeId}`);

      return allowance;
    } catch (error) {
      console.error(`Error creating automatic annual leave for employee ${employeeId}:`, error);
      return null;
    }
  }

  /**
   * Ensure sick leave for a new employee
   * @param {string} employeeId - Employee ID
   * @param {Object} employeeData - Employee data
   * @returns {Promise<Object>} Result with allowance
   */
  /**
   * Ensure sick leave and annual leave for an employee in one go
   * @param {string} employeeId - Employee ID
   * @param {Object} employeeData - Employee data
   * @returns {Promise<Object>} Result with allowances
   */
  async ensureEmployeeAllowances(employeeId, employeeData) {
    if (!employeeId) return { created: 0 };

    // Use a per-employee lock to prevent concurrent calls
    if (!this.processingEmployees) {
      this.processingEmployees = new Set();
    }

    if (this.processingEmployees.has(employeeId)) {
      console.log(`Already ensuring allowances for employee ${employeeId}, skipping concurrent call.`);
      return { created: 0, skipped: true };
    }

    this.processingEmployees.add(employeeId);

    try {
      const currentYear = new Date().getFullYear();

      // Batch check for existing allowances for the current year
      const q = query(
        collection(db, 'allowances'),
        where('employeeId', '==', employeeId),
        where('isActive', '==', true)
      );

      const snapshot = await getDocs(q);
      const existingTypes = new Set();

      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.leaveType) {
          const norm = allowanceService.normalizeLeaveType(data.leaveType);

          // Check if it belongs to the current year
          let itemYear = data.year;
          if (!itemYear && data.validFrom) {
            itemYear = new Date(data.validFrom).getFullYear();
          }

          if (itemYear === currentYear) {
            existingTypes.add(norm);
          }
        }
      });

      const normSick = allowanceService.normalizeLeaveType(DEFAULT_LEAVE_TYPE);
      const normAnnual = allowanceService.normalizeLeaveType(DEFAULT_ANNUAL_LEAVE_TYPE);

      let sickLeave = null;
      let annualLeave = null;

      // Double check before creating
      if (!existingTypes.has(normSick)) {
        sickLeave = await allowanceService.createAutomaticSickLeave(employeeId, employeeData);
      }

      if (!existingTypes.has(normAnnual)) {
        annualLeave = await allowanceService.createAutomaticAnnualLeave(employeeId, employeeData);
      }

      return {
        sickLeave,
        annualLeave,
        created: (sickLeave ? 1 : 0) + (annualLeave ? 1 : 0)
      };
    } catch (error) {
      console.error('Error ensuring employee allowances:', error);
      return { created: 0 };
    } finally {
      this.processingEmployees.delete(employeeId);
    }
  }

  /**
   * Check if user can manage allowances
   * @param {Object} currentUser - Current user object
   * @returns {boolean} Whether user can manage allowances
   */
  canManageAllowances(currentUser) {
    return ['siteManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor', 'teamManager'].includes(currentUser?.role);
  }

  /**
   * Reset the daily processing flag (useful for testing or manual reset)
   */
  resetProcessingFlag() {
    this.lastProcessedDate = null;
    this.isProcessing = false;
  }
}

// Export singleton instance
export const automaticAllowanceService = new AutomaticAllowanceService();
export default automaticAllowanceService;