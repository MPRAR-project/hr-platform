/**
 * Utility functions for generating standardized IDs across the application.
 * ensuring consistency between different modules and potential future microservices.
 */

/**
 * Generates a unique ID for a timesheet entry.
 * Format: entry_{UUID}
 * @returns {string} A unique ID string.
 */
export const generateEntryId = () => {
    // Use crypto.randomUUID if available (modern browsers & Node 14.17+)
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return `entry_${crypto.randomUUID()}`;
    }

    // Fallback for older environments
    const fallbackUuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });

    return `entry_${fallbackUuid}`;
};
