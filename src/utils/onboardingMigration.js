/**
 * Migration utilities for onboarding field name standardization
 * STUBBED: Migration to PostgreSQL makes these Firestore-only helpers obsolete.
 */

export async function migrateCompanyOnboardingFields() {
    return { success: true, migratedCount: 0, skippedCount: 0, totalProcessed: 0, message: 'Obsolete in PostgreSQL architecture' };
}

export async function migrateUserOnboardingFields() {
    return { success: true, migratedCount: 0, skippedCount: 0, totalProcessed: 0, message: 'Obsolete in PostgreSQL architecture' };
}

export async function runCompleteOnboardingMigration() {
    return { success: true, summary: { totalMigrated: 0, totalSkipped: 0, totalProcessed: 0 }, message: 'Obsolete in PostgreSQL architecture' };
}

export async function checkMigrationStatus() {
    return {
        companies: { total: 0, needingMigration: 0, migrated: 0 },
        users: { total: 0, needingMigration: 0, migrated: 0 },
        message: 'Obsolete in PostgreSQL architecture'
    };
}