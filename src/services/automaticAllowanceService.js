import hrApiClient from '../lib/hrApiClient';

/**
 * Automatic Allowance Service (Phase 4 — REST Migration)
 * 
 * Replaces Firestore queries with calls to the HR REST API.
 * The logic for determining if an allowance should be created is now mostly handled by the backend.
 */
class AutomaticAllowanceService {
  constructor() {
    this.isProcessing = false;
    this.lastProcessedDate = null;
    this.processingEmployees = new Set();
  }

  /**
   * Ensure all employees in a company have automatic allowances
   */
  async ensureCompanyAllowances(companyId, currentUser) {
    if (this.isProcessing) return { success: false, reason: 'Already processing' };

    const today = new Date().toDateString();
    if (this.lastProcessedDate === today) {
      return { success: true, reason: 'Already processed today' };
    }

    this.isProcessing = true;
    try {
      // Endpoint to trigger bulk allowance generation on the backend
      const { data } = await hrApiClient.post('/hr/allowances/ensure-bulk');
      this.lastProcessedDate = today;
      return data;
    } catch (error) {
      console.error('[automaticAllowanceService] Bulk ensure failed:', error);
      return { success: false, reason: error.message };
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Create allowances for a new employee
   */
  async ensureEmployeeAllowances(employeeId, employeeData) {
    if (!employeeId) return { created: 0 };
    if (this.processingEmployees.has(employeeId)) return { created: 0, skipped: true };

    this.processingEmployees.add(employeeId);
    try {
      const { data } = await hrApiClient.post(`/hr/allowances/ensure/${employeeId}`);
      return data;
    } catch (error) {
      console.error(`[automaticAllowanceService] Employee ensure failed for ${employeeId}:`, error);
      return { created: 0 };
    } finally {
      this.processingEmployees.delete(employeeId);
    }
  }

  /**
   * Compatibility alias
   */
  async ensureEmployeeSickLeave(employeeId, employeeData) {
    return this.ensureEmployeeAllowances(employeeId, employeeData);
  }

  resetProcessingFlag() {
    this.lastProcessedDate = null;
    this.isProcessing = false;
  }
}

export const automaticAllowanceService = new AutomaticAllowanceService();
export default automaticAllowanceService;