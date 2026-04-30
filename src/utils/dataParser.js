/**
 * Data parsing and validation utilities for dashboard data
 * Handles safe extraction of IDs from path formats and validates user data
 */

/**
 * Safely parses company ID from various formats
 * @param {string|null|undefined} companyIdPath - The company ID path (e.g., "companies/abc123" or "abc123")
 * @returns {string|null} - The extracted company ID or null if invalid
 */
export function parseCompanyId(companyIdPath) {
  if (!companyIdPath || typeof companyIdPath !== 'string') {
    console.warn('parseCompanyId: Invalid or missing companyIdPath:', companyIdPath);
    return null;
  }

  const trimmed = companyIdPath.trim();
  if (!trimmed) {
    console.warn('parseCompanyId: Empty companyIdPath after trimming');
    return null;
  }

  // Handle path format: "companies/abc123"
  if (trimmed.includes('/')) {
    const parts = trimmed.split('/');
    if (parts.length >= 2 && parts[0] === 'companies') {
      const companyId = parts[1];
      if (companyId && companyId.trim()) {
        return companyId.trim();
      }
    }
    console.warn('parseCompanyId: Invalid path format:', trimmed);
    return null;
  }

  // Handle direct ID format: "abc123"
  return trimmed;
}

/**
 * Safely parses site ID from various formats
 * @param {string|null|undefined} siteIdPath - The site ID path (e.g., "sites/xyz789" or "xyz789")
 * @returns {string|null} - The extracted site ID or null if invalid
 */
export function parseSiteId(siteIdPath) {
  if (!siteIdPath || typeof siteIdPath !== 'string') {
    console.warn('parseSiteId: Invalid or missing siteIdPath:', siteIdPath);
    return null;
  }

  const trimmed = siteIdPath.trim();
  if (!trimmed) {
    console.warn('parseSiteId: Empty siteIdPath after trimming');
    return null;
  }

  // Handle path format: "sites/xyz789"
  if (trimmed.includes('/')) {
    const parts = trimmed.split('/');
    if (parts.length >= 2 && parts[0] === 'sites') {
      const siteId = parts[1];
      if (siteId && siteId.trim()) {
        return siteId.trim();
      }
    }
    console.warn('parseSiteId: Invalid path format:', trimmed);
    return null;
  }

  // Handle direct ID format: "xyz789"
  return trimmed;
}

/**
 * Validates user data for dashboard operations
 * @param {object|null|undefined} user - The user object from auth context
 * @returns {object} - Validation result with isValid flag and details
 */
export function validateUserData(user) {
  const result = {
    isValid: false,
    errors: [],
    warnings: [],
    companyId: null,
    siteId: null
  };

  // Check if user exists
  if (!user || typeof user !== 'object') {
    result.errors.push('User data is missing or invalid');
    return result;
  }

  // Check required fields
  if (!user.userId) {
    result.errors.push('User ID (userId) is missing');
  }

  if (!user.email) {
    result.errors.push('User email is missing');
  }

  if (!user.role) {
    result.warnings.push('User role is missing');
  }

  // Validate and parse company ID
  const companyId = parseCompanyId(user.companyId);
  if (!companyId) {
    result.errors.push('Company ID is missing or invalid');
  } else {
    result.companyId = companyId;
  }

  // Validate and parse site ID (optional for some operations)
  const siteId = parseSiteId(user.siteId);
  if (user.siteId && !siteId) {
    result.warnings.push('Site ID format is invalid');
  } else if (siteId) {
    result.siteId = siteId;
  }

  // Set overall validity
  result.isValid = result.errors.length === 0;

  // Log validation results for debugging
  if (!result.isValid) {
    console.error('User validation failed:', {
      user: { userId: user.userId, email: user.email, companyId: user.companyId, siteId: user.siteId },
      errors: result.errors,
      warnings: result.warnings
    });
  } else if (result.warnings.length > 0) {
    console.warn('User validation passed with warnings:', {
      warnings: result.warnings,
      companyId: result.companyId,
      siteId: result.siteId
    });
  }

  return result;
}

/**
 * Creates a standardized error object for data parsing issues
 * @param {string} type - The error type
 * @param {string} message - The error message
 * @param {object} details - Additional error details
 * @returns {object} - Standardized error object
 */
export function createDataParsingError(type, message, details = {}) {
  return {
    type: `DATA_PARSING_${type}`,
    message,
    details,
    timestamp: new Date().toISOString(),
    retryable: false
  };
}

/**
 * Safely parses date string in various formats
 * @param {string|Date|object} dateString - Date string to parse
 * @returns {Date|null} - Parsed date or null if invalid
 */
export function safeParseDate(dateString) {
    if (!dateString) return null;
    
    // If it's already a Date object, return it
    if (dateString instanceof Date) {
        return isNaN(dateString.getTime()) ? null : dateString;
    }
    
    // Handle Firestore Timestamp
    if (dateString && typeof dateString.toDate === 'function') {
        try {
            return dateString.toDate();
        } catch (e) {
            return null;
        }
    }
    
    if (typeof dateString !== 'string') {
        return null;
    }
    
    // Try ISO format first (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)
    if (dateString.match(/^\d{4}-\d{2}-\d{2}/)) {
        const date = new Date(dateString);
        return isNaN(date.getTime()) ? null : date;
    }
    
    // Handle DD/MM/YYYY format - this is the key fix
    const dmyMatch = dateString.match(/^(\d{1,2})[\/](\d{1,2})[\/](\d{4})$/);
    if (dmyMatch) {
        const [_, day, month, year] = dmyMatch;
        const date = new Date(year, month - 1, day); // month is 0-indexed
        return isNaN(date.getTime()) ? null : date;
    }
    
    // Handle DD-MM-YYYY format
    const dmyDashMatch = dateString.match(/^(\d{1,2})[-](\d{1,2})[-](\d{4})$/);
    if (dmyDashMatch) {
        const [_, day, month, year] = dmyDashMatch;
        const date = new Date(year, month - 1, day);
        return isNaN(date.getTime()) ? null : date;
    }
    
    // Fallback to standard Date constructor (last resort)
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? null : date;
}

/**
 * Validates that required IDs are present and valid
 * @param {object} ids - Object containing companyId and optionally siteId
 * @returns {object} - Validation result
 */
export function validateRequiredIds(ids) {
  const result = {
    isValid: false,
    errors: []
  };

  if (!ids || typeof ids !== 'object') {
    result.errors.push('IDs object is missing or invalid');
    return result;
  }

  if (!ids.companyId || typeof ids.companyId !== 'string' || !ids.companyId.trim()) {
    result.errors.push('Company ID is required and must be a non-empty string');
  }

  // Site ID is optional for some operations, but if provided, must be valid
  if (ids.siteId !== undefined && ids.siteId !== null) {
    if (typeof ids.siteId !== 'string' || !ids.siteId.trim()) {
      result.errors.push('Site ID must be a non-empty string when provided');
    }
  }

  result.isValid = result.errors.length === 0;
  return result;
}

/**
 * Safely extracts user display name from user data
 * @param {object} user - User object
 * @returns {string} - Display name or fallback
 */
export function getUserDisplayName(user) {
  if (!user || typeof user !== 'object') {
    return 'Unknown User';
  }

  // Try displayName first
  if (user.displayName && typeof user.displayName === 'string' && user.displayName.trim()) {
    return user.displayName.trim();
  }

  // Try combining first and last name
  const firstName = user.firstName && typeof user.firstName === 'string' ? user.firstName.trim() : '';
  const lastName = user.lastName && typeof user.lastName === 'string' ? user.lastName.trim() : '';
  
  if (firstName || lastName) {
    return `${firstName} ${lastName}`.trim();
  }

  // Fallback to email
  if (user.email && typeof user.email === 'string' && user.email.trim()) {
    return user.email.trim();
  }

  return 'Unknown User';
}

/**
 * Maps a camelCase role to a human-readable job title
 * @param {string|null|undefined} role - The role key
 * @returns {string} - The human-readable job title
 */
export function getRoleJobTitle(role) {
  if (!role || typeof role !== 'string') return 'Employee';
  
  const norm = role.toLowerCase().replace(/[\s_-]+/g, '');
  const mapping = {
    'sitemanager': 'Site Manager',
    'teammanager': 'Team Manager',
    'seniormanager': 'Senior Manager',
    'adminmanager': 'Admin Manager',
    'hrmanager': 'HR Manager',
    'adminadvisor': 'Admin Advisor',
    'hradvisor': 'HR Advisor',
    'contractmanager': 'Contract Manager',
    'employee': 'Employee'
  };
  
  return mapping[norm] || 'Employee';
}