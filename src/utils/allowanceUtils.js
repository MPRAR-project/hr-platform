/**
 * Utility functions for allowance management
 */

import { allowanceService } from '../services/allowanceService';

/**
 * Initialize automatic sick leave allowances for all employees in a company
 * This is useful for setting up the system for the first time or for a new year
 * @param {string} companyId - Company ID
 * @param {number} sickLeaveDays - Number of sick leave days (default: 25)
 * @returns {Promise<Object>} Result summary
 */
export async function initializeCompanySickLeaveAllowances(companyId, sickLeaveDays = 25) {
  try {
    console.log(`Initializing sick leave allowances for company: ${companyId}`);
    
    const result = await allowanceService.createYearlyAutomaticSickLeave(companyId, sickLeaveDays);
    
    console.log('Initialization result:', result);
    return result;
  } catch (error) {
    console.error('Error initializing sick leave allowances:', error);
    throw error;
  }
}

/**
 * Check and create missing sick leave allowances for employees
 * @param {string} companyId - Company ID
 * @returns {Promise<Object>} Result summary
 */
export async function ensureAllEmployeesHaveSickLeave(companyId) {
  return await initializeCompanySickLeaveAllowances(companyId);
}

/**
 * Create sick leave allowance for a specific employee
 * @param {string} employeeId - Employee ID
 * @param {Object} employeeData - Employee data
 * @param {number} sickLeaveDays - Number of sick leave days (default: 25)
 * @returns {Promise<Object>} Created allowance
 */
export async function createEmployeeSickLeave(employeeId, employeeData, sickLeaveDays = 25) {
  try {
    const result = await allowanceService.createAutomaticSickLeave(employeeId, employeeData, sickLeaveDays);
    console.log(`Created sick leave allowance for employee ${employeeId}:`, result);
    return result;
  } catch (error) {
    console.error(`Error creating sick leave for employee ${employeeId}:`, error);
    throw error;
  }
}

/**
 * Yearly maintenance function to ensure all companies have proper allowances
 * This could be called by a scheduled job at the beginning of each year
 * @param {Array} companyIds - Array of company IDs to process
 * @returns {Promise<Object>} Summary of all processed companies
 */
export async function yearlyAllowanceMaintenance(companyIds = []) {
  const results = [];
  
  for (const companyId of companyIds) {
    try {
      console.log(`Processing yearly allowances for company: ${companyId}`);
      const result = await initializeCompanySickLeaveAllowances(companyId);
      results.push({
        companyId,
        success: true,
        ...result
      });
    } catch (error) {
      console.error(`Error processing company ${companyId}:`, error);
      results.push({
        companyId,
        success: false,
        error: error.message
      });
    }
  }
  
  const totalCreated = results.reduce((sum, r) => sum + (r.created || 0), 0);
  const totalSkipped = results.reduce((sum, r) => sum + (r.skipped || 0), 0);
  const successfulCompanies = results.filter(r => r.success).length;
  
  console.log(`Yearly maintenance complete: ${successfulCompanies}/${companyIds.length} companies processed, ${totalCreated} allowances created, ${totalSkipped} skipped`);
  
  return {
    totalCompanies: companyIds.length,
    successfulCompanies,
    totalCreated,
    totalSkipped,
    results
  };
}