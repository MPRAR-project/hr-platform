/**
 * Employment Details Utility Functions
 * Provides data transformation, validation, and helper functions for employment details
 */

/**
 * Calculate probation end date based on start date and probation period
 * @param {string} startDate - ISO date string (YYYY-MM-DD)
 * @param {string} probationPeriod - '1 Month', '3 Months', or '6 Months'
 * @returns {string} ISO date string for probation end date
 */
export const calculateProbationEndDate = (startDate, probationPeriod) => {
  if (!startDate || !probationPeriod) return '';

  try {
    const start = new Date(startDate);
    if (isNaN(start.getTime())) return '';

    const months = probationPeriod === '1 Month' ? 1 :
      probationPeriod === '3 Months' ? 3 :
        probationPeriod === '6 Months' ? 6 : 3; // default to 3 months

    const endDate = new Date(start);
    endDate.setMonth(start.getMonth() + months);

    return endDate.toISOString().split('T')[0];
  } catch (error) {
    console.error('Error calculating probation end date:', error);
    return '';
  }
};

/**
 * Validate employment data before saving
 * @param {Object} employmentData - Employment details object
 * @returns {Object} { isValid: boolean, errors: string[] }
 */
export const validateEmploymentData = (employmentData) => {
  const errors = [];

  // Required fields validation
  if (!employmentData.jobTitle?.trim()) {
    errors.push('Job Title is required');
  }

  if (!employmentData.employmentType?.trim()) {
    errors.push('Employment Type is required');
  }

  if (!employmentData.startDate?.trim()) {
    errors.push('Start Date is required');
  }

  // Date format validation
  if (employmentData.startDate) {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(employmentData.startDate)) {
      errors.push('Start Date must be in YYYY-MM-DD format');
    } else {
      const date = new Date(employmentData.startDate);
      if (isNaN(date.getTime())) {
        errors.push('Start Date must be a valid date');
      }
    }
  }

  // Employment type validation
  const validEmploymentTypes = ['Full-Time', 'Part-Time', 'Contract', 'Internship'];
  if (employmentData.employmentType && !validEmploymentTypes.includes(employmentData.employmentType)) {
    errors.push('Employment Type must be one of: ' + validEmploymentTypes.join(', '));
  }

  // Work pattern validation
  const validWorkPatterns = ['Office-Based', 'Remote', 'Hybrid'];
  if (employmentData.workPattern && !validWorkPatterns.includes(employmentData.workPattern)) {
    errors.push('Work Pattern must be one of: ' + validWorkPatterns.join(', '));
  }

  // Probation period validation
  const validProbationPeriods = ['1 Month', '3 Months', '6 Months'];
  if (employmentData.probationPeriod && !validProbationPeriods.includes(employmentData.probationPeriod)) {
    errors.push('Probation Period must be one of: ' + validProbationPeriods.join(', '));
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Resolve manager name from manager user ID
 * @param {string} managerId - User ID of the manager
 * @param {Function} getUserDoc - Function to fetch user document
 * @returns {Promise<string>} Manager display name or fallback
 */
export const resolveManagerName = async (managerId, getUserDoc) => {
  if (!managerId || !getUserDoc) return '';

  try {
    const managerDoc = await getUserDoc(managerId);
    if (!managerDoc) return managerId; // fallback to ID

    const manager = managerDoc.data();
    if (!manager) return managerId;

    // Try different name combinations
    if (manager.displayName) return manager.displayName;

    const firstName = manager.firstName?.trim() || '';
    const lastName = manager.lastName?.trim() || '';
    if (firstName || lastName) {
      return `${firstName} ${lastName}`.trim();
    }

    if (manager.email) return manager.email;

    return managerId; // ultimate fallback
  } catch (error) {
    console.error('Error resolving manager name:', error);
    return managerId; // fallback to ID on error
  }
};

/**
 * Transform employment data for storage
 * @param {Object} formData - Raw form data from ViewEmploymentModal
 * @param {string} userId - ID of user making the update
 * @returns {Object} Transformed employment details object
 */
export const transformEmploymentDataForStorage = (formData, userId) => {
  const probationEndDate = calculateProbationEndDate(formData.startDate, formData.probationPeriod);

  return {
    jobTitle: formData.jobTitle?.trim() || '',
    employmentType: formData.employmentType || '',
    department: formData.department?.trim() || formData.primaryWorkLocation || '', // prioritize department field
    primaryWorkLocation: formData.primaryWorkLocation?.trim() || '',
    officeAddress: formData.officeAddress?.trim() || '',
    workPattern: formData.workPattern || 'Office-Based',
    startDate: formData.startDate || '',
    probationPeriod: formData.probationPeriod || '3 Months',
    probationEndDate,
    lastUpdated: new Date(),
    updatedBy: userId,
    source: 'onboarding'
  };
};

/**
 * Transform employment data for display in UI
 * @param {Object} employmentDetails - Employment details from database
 * @param {Object} userDetails - User details from users collection (for manager info)
 * @param {string} managerName - Resolved manager name (optional)
 * @returns {Object} Formatted data for UI display
 */
export const transformEmploymentDataForDisplay = (employmentDetails, userDetails = null, managerName = null, clientName = null) => {
  if (!employmentDetails) {
    return {
      position: {},
      terms: {},
      compensation: {},
      bank: {},
      notes: ''
    };
  }

  // Get direct manager from resolved name, user's reportsTo or managerUserId field
  let directManager = 'Not specified';
  if (managerName) {
    directManager = managerName;
  } else if (userDetails) {
    if (userDetails.reportsTo) {
      directManager = userDetails.reportsTo;
    } else if (userDetails.managerUserId) {
      directManager = userDetails.managerUserId;
    }
  }

  return {
    position: {
      'Position': employmentDetails.jobTitle || 'Not specified',
      'Department': employmentDetails.department || 'Not specified',
      'Direct Manager': directManager,
      'Client': clientName || 'Not specified', // Added Client field
      'Employment Type': employmentDetails.employmentType || 'Not specified',
      'Work Location': employmentDetails.primaryWorkLocation || 'Not specified'
    },
    terms: {
      'Start Date': employmentDetails.startDate ? formatDateForDisplay(employmentDetails.startDate) : 'Not specified',
      'Probation End Date': employmentDetails.probationEndDate ? formatDateForDisplay(employmentDetails.probationEndDate) : 'Not specified',
      'Working Hours': employmentDetails.workingHours || 'Not specified',
      'Notice Period': employmentDetails.noticePeriod || 'Not specified'
    },
    compensation: {
      'Annual Salary': employmentDetails.annualSalary || 'Not specified',
      'Pay Frequency': employmentDetails.payFrequency || 'Not specified',
      'Benefits': employmentDetails.benefits || 'Not specified'
    },
    bank: {
      'Account Name': employmentDetails.bankAccountName || 'Not specified',
      'Account Number': employmentDetails.bankAccountNumber || 'Not specified',
      'Bank Name': employmentDetails.bankName || 'Not specified',
      'Sort Code': employmentDetails.sortCode || 'Not specified',
      'Branch Name': employmentDetails.branchName || 'Not specified',
      'IBAN': employmentDetails.iban || 'Not specified',
      'Additional Details': 'Payroll preferences and tax information collected separately by HR'
    },
    notes: employmentDetails.adminNotes || ''
  };
};

/**
 * Format date for user-friendly display
 * @param {string} dateString - ISO date string (YYYY-MM-DD)
 * @returns {string} Formatted date (e.g., "January 15, 2024")
 */
export const formatDateForDisplay = (dateString) => {
  if (!dateString) return 'Not specified';

  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString; // return original if invalid

    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  } catch (error) {
    console.error('Error formatting date:', error);
    return dateString; // return original on error
  }
};

/**
 * Check if employment data is complete
 * @param {Object} employmentDetails - Employment details object
 * @returns {boolean} True if all required fields are present
 */
export const isEmploymentDataComplete = (employmentDetails) => {
  if (!employmentDetails) return false;

  const requiredFields = ['jobTitle', 'employmentType', 'startDate'];
  return requiredFields.every(field => employmentDetails[field]?.trim());
};

/**
 * Get employment data completeness percentage
 * @param {Object} employmentDetails - Employment details object
 * @returns {number} Percentage of fields completed (0-100)
 */
export const getEmploymentDataCompleteness = (employmentDetails) => {
  if (!employmentDetails) return 0;

  const allFields = [
    'jobTitle', 'employmentType', 'startDate', 'primaryWorkLocation',
    'officeAddress', 'workPattern', 'probationPeriod'
  ];

  const completedFields = allFields.filter(field => employmentDetails[field]?.trim()).length;
  return Math.round((completedFields / allFields.length) * 100);
};