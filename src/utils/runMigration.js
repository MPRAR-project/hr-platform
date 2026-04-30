import { 
  runCompleteOnboardingMigration, 
  checkMigrationStatus,
  migrateCompanyOnboardingFields,
  migrateUserOnboardingFields 
} from './onboardingMigration';

/**
 * Helper functions to run migration from browser console
 * Open browser console and run: window.runOnboardingMigration()
 */

// Make migration functions available globally for console access
window.runOnboardingMigration = runCompleteOnboardingMigration;
window.checkOnboardingMigrationStatus = checkMigrationStatus;
window.migrateCompanies = migrateCompanyOnboardingFields;
window.migrateUsers = migrateUserOnboardingFields;

// NOTE: Do NOT auto-run checkMigrationStatus on app load - it fetches ALL companies + ALL users
// and was causing 200+ Firestore requests on every dashboard refresh.
// Run manually from console: window.checkOnboardingMigrationStatus()
// Or run from MigrationPage when user navigates there.

export {
  runCompleteOnboardingMigration,
  checkMigrationStatus,
  migrateCompanyOnboardingFields,
  migrateUserOnboardingFields
};