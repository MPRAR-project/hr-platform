/**
 * Enhanced error handling system for dashboard operations
 * Provides structured error types, user-friendly messages, and retry logic
 */

/**
 * Error types for different failure scenarios
 */
export const ERROR_TYPES = {
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR', 
  PERMISSION_ERROR: 'PERMISSION_ERROR',
  DATA_ERROR: 'DATA_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

/**
 * Creates a structured error object
 * @param {string} type - Error type from ERROR_TYPES
 * @param {string} message - Technical error message
 * @param {string} userMessage - User-friendly error message
 * @param {object} details - Additional error details
 * @param {boolean} retryable - Whether the error can be retried
 * @returns {object} Structured error object
 */
export function createError(type, message, userMessage, details = {}, retryable = false) {
  return {
    type,
    message,
    userMessage,
    details,
    retryable,
    timestamp: new Date().toISOString(),
    id: generateErrorId()
  };
}

/**
 * Generates a unique error ID for tracking
 * @returns {string} Unique error ID
 */
function generateErrorId() {
  return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Classifies Firebase/Firestore errors into our error types
 * @param {Error} error - The original error
 * @returns {object} Classified error object
 */
export function classifyFirebaseError(error) {
  const errorCode = error?.code || '';
  const errorMessage = error?.message || 'Unknown error occurred';

  // Network-related errors
  if (errorCode.includes('unavailable') || 
      errorCode.includes('timeout') || 
      errorCode.includes('network') ||
      errorMessage.toLowerCase().includes('network')) {
    return createError(
      ERROR_TYPES.NETWORK_ERROR,
      errorMessage,
      'Unable to connect to the server. Please check your internet connection and try again.',
      { originalCode: errorCode, originalMessage: errorMessage },
      true
    );
  }

  // Permission-related errors
  if (errorCode.includes('permission-denied') || 
      errorCode.includes('unauthenticated') ||
      errorCode.includes('unauthorized')) {
    return createError(
      ERROR_TYPES.PERMISSION_ERROR,
      errorMessage,
      'You do not have permission to access this data. Please contact your administrator.',
      { originalCode: errorCode, originalMessage: errorMessage },
      false
    );
  }

  // Data-related errors
  if (errorCode.includes('not-found') || 
      errorCode.includes('invalid-argument') ||
      errorCode.includes('failed-precondition')) {
    return createError(
      ERROR_TYPES.DATA_ERROR,
      errorMessage,
      'The requested data could not be found or is invalid. Please refresh the page and try again.',
      { originalCode: errorCode, originalMessage: errorMessage },
      true
    );
  }

  // Rate limiting
  if (errorCode.includes('resource-exhausted') || 
      errorCode.includes('quota-exceeded')) {
    return createError(
      ERROR_TYPES.NETWORK_ERROR,
      errorMessage,
      'Too many requests. Please wait a moment and try again.',
      { originalCode: errorCode, originalMessage: errorMessage },
      true
    );
  }

  // Default to unknown error
  return createError(
    ERROR_TYPES.UNKNOWN_ERROR,
    errorMessage,
    'An unexpected error occurred. Please try again or contact support if the problem persists.',
    { originalCode: errorCode, originalMessage: errorMessage },
    true
  );
}

/**
 * Creates configuration errors for missing or invalid data
 * @param {string} field - The missing/invalid field
 * @param {string} value - The invalid value (optional)
 * @returns {object} Configuration error object
 */
export function createConfigurationError(field, value = null) {
  const details = { field };
  if (value !== null) {
    details.value = value;
  }

  let userMessage;
  switch (field) {
    case 'companyId':
      userMessage = 'Your account is not properly configured with a company. Please contact your administrator.';
      break;
    case 'siteId':
      userMessage = 'Your account is not properly configured with a site. Please contact your administrator.';
      break;
    case 'user':
      userMessage = 'Your user account information is incomplete. Please log out and log back in.';
      break;
    default:
      userMessage = `Configuration error: ${field} is missing or invalid. Please contact your administrator.`;
  }

  return createError(
    ERROR_TYPES.CONFIGURATION_ERROR,
    `Configuration error: ${field} is missing or invalid`,
    userMessage,
    details,
    false
  );
}

/**
 * Creates validation errors for invalid input data
 * @param {string} field - The field that failed validation
 * @param {string} reason - The reason for validation failure
 * @param {any} value - The invalid value
 * @returns {object} Validation error object
 */
export function createValidationError(field, reason, value = null) {
  const details = { field, reason };
  if (value !== null) {
    details.value = value;
  }

  return createError(
    ERROR_TYPES.VALIDATION_ERROR,
    `Validation failed for ${field}: ${reason}`,
    `Invalid ${field}: ${reason}. Please check your input and try again.`,
    details,
    false
  );
}

/**
 * Retry configuration for different error types
 */
const RETRY_CONFIG = {
  [ERROR_TYPES.NETWORK_ERROR]: {
    maxAttempts: 3,
    baseDelay: 1000, // 1 second
    maxDelay: 10000, // 10 seconds
    backoffMultiplier: 2
  },
  [ERROR_TYPES.DATA_ERROR]: {
    maxAttempts: 2,
    baseDelay: 500,
    maxDelay: 2000,
    backoffMultiplier: 2
  },
  [ERROR_TYPES.UNKNOWN_ERROR]: {
    maxAttempts: 2,
    baseDelay: 1000,
    maxDelay: 5000,
    backoffMultiplier: 2
  }
};

/**
 * Implements retry logic with exponential backoff
 * @param {Function} operation - The operation to retry
 * @param {string} errorType - The error type to determine retry config
 * @param {object} context - Additional context for logging
 * @returns {Promise} The result of the operation or final error
 */
export async function retryOperation(operation, errorType = ERROR_TYPES.UNKNOWN_ERROR, context = {}) {
  const config = RETRY_CONFIG[errorType] || RETRY_CONFIG[ERROR_TYPES.UNKNOWN_ERROR];
  let lastError = null;
  
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      const result = await operation();
      return result;
    } catch (error) {
      lastError = error;
      console.warn(`Operation failed on attempt ${attempt}:`, error.message, context);
      
      // Don't retry on the last attempt
      if (attempt === config.maxAttempts) {
        break;
      }
      
      // Calculate delay with exponential backoff
      const delay = Math.min(
        config.baseDelay * Math.pow(config.backoffMultiplier, attempt - 1),
        config.maxDelay
      );
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // All attempts failed, throw the last error
  console.error(`Operation failed after ${config.maxAttempts} attempts`, lastError, context);
  throw lastError;
}

/**
 * Wraps an async operation with error classification and retry logic
 * @param {Function} operation - The async operation to wrap
 * @param {string} operationName - Name of the operation for logging
 * @param {object} context - Additional context for logging
 * @returns {Promise} The result or classified error
 */
export async function executeWithErrorHandling(operation, operationName, context = {}) {
  try {
    const result = await operation();
    return result;
  } catch (error) {
    console.error(`Operation failed: ${operationName}`, error, context);
    
    // Classify the error
    const classifiedError = classifyFirebaseError(error);
    
    // Add operation context to error details
    classifiedError.details = {
      ...classifiedError.details,
      operationName,
      context
    };
    
    // Log the classified error
    logError(classifiedError);
    
    throw classifiedError;
  }
}

/**
 * Logs errors with appropriate level based on error type
 * @param {object} error - The structured error object
 */
export function logError(error) {
  const logData = {
    id: error.id,
    type: error.type,
    message: error.message,
    userMessage: error.userMessage,
    retryable: error.retryable,
    timestamp: error.timestamp,
    details: error.details
  };

  switch (error.type) {
    case ERROR_TYPES.CONFIGURATION_ERROR:
    case ERROR_TYPES.PERMISSION_ERROR:
      console.error('Critical Error:', logData);
      break;
    case ERROR_TYPES.NETWORK_ERROR:
      console.warn('Network Error:', logData);
      break;
    case ERROR_TYPES.DATA_ERROR:
    case ERROR_TYPES.VALIDATION_ERROR:
      console.warn('Data Error:', logData);
      break;
    default:
      console.error('Unknown Error:', logData);
  }
}

/**
 * Determines if an error should trigger a retry
 * @param {object} error - The structured error object
 * @returns {boolean} Whether the error is retryable
 */
export function isRetryableError(error) {
  return error && error.retryable === true;
}

/**
 * Gets user-friendly error message from error object
 * @param {object|Error} error - The error object
 * @returns {string} User-friendly error message
 */
export function getUserErrorMessage(error) {
  if (error && error.userMessage) {
    return error.userMessage;
  }
  
  if (error && error.message) {
    return 'An error occurred. Please try again or contact support if the problem persists.';
  }
  
  return 'An unexpected error occurred. Please try again.';
}

/**
 * Creates a partial failure error when some operations succeed and others fail
 * @param {Array} successes - Array of successful operations
 * @param {Array} failures - Array of failed operations
 * @returns {object} Partial failure error object
 */
export function createPartialFailureError(successes, failures) {
  const totalOperations = successes.length + failures.length;
  const successCount = successes.length;
  const failureCount = failures.length;
  
  return createError(
    ERROR_TYPES.DATA_ERROR,
    `Partial failure: ${successCount}/${totalOperations} operations succeeded`,
    `Some data could not be loaded (${failureCount} of ${totalOperations} sections failed). The available data is shown below.`,
    {
      successes,
      failures,
      successCount,
      failureCount,
      totalOperations
    },
    true
  );
}