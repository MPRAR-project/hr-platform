import React, { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';

// Import Layouts and Critical Components directly
import MainLayout from './components/layout/MainLayout';
import DashboardLoader from './pages/dashboard/DashboardLoader';
import { useAuth } from './hooks/useAuth';

// Route Guards (Keep eager to avoid delays in checking auth)
import OnboardingGuard from './components/auth/OnboardingGuard';
import SubscriptionGuard from './components/auth/SubscriptionGuard';
import PublicRoute from './components/auth/PublicRoute';
import RoleGuard from './components/auth/RoleGuard';
import PluginGuard from './components/auth/PluginGuard';
import MandatoryTrainingGuard from './components/auth/MandatoryTrainingGuard';

// Lazy Import Pages
const CompanyDetailsPage = lazy(() => import('./pages/companies/CompanyDetailsPage'));
const PaymentsPage = lazy(() => import('./pages/payments/PaymentsPage'));
const SignupPage = lazy(() => import('./pages/auth/SignupPage'));
const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const BridgePage = lazy(() => import('./pages/auth/BridgePage'));
const ForgotPasswordPage = lazy(() => import('./pages/auth/ForgotPasswordPage'));
const ComingSoon = lazy(() => import('./pages/ComingSoon'));
const TeamSizeSelection = lazy(() => import('./pages/auth/TeamSizeSelectionPage'));
const UserListPage = lazy(() => import('./pages/users/UserListPage'));
const UserDetailsPage = lazy(() => import('./pages/users/UserDetailsPage'));
const ActivityOversightPage = lazy(() => import('./pages/oversight/ActivityOversightPage'));
const PendingAllowancePage = lazy(() => import('./pages/allowance/PendingAllowance'));
const SubscriptionExpiredPage = lazy(() => import('./pages/payments/SubscriptionExpiredPage'));
const ManageTeamRenewalPage = lazy(() => import('./components/shared/ManageTeamRenewalPage'));
const OfflinePaymentSubmissionPage = lazy(() => import('./pages/payments/OfflinePaymentPage'));
const BillingSubscriptionsPage = lazy(() => import('./pages/payments/BillingSubscriptionPage'));
const BillingMockTools = lazy(() => import('./pages/admin/BillingMockTools'));
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage'));
const ApprovalsPage = lazy(() => import('./pages/timesheets/ApprovalsPage'));
const EmployeeDocumentManagementPage = lazy(() => import('./pages/documents/EmployeeDocumentManagementPage'));
const DocumentManagementPage = lazy(() => import('./pages/documents/DocumentManagementPage'));
const TrainingManagementPage = lazy(() => import('./pages/training/TrainingManagementPage'));
const EmployeeTrainingPage = lazy(() => import('./pages/training/EmployeeTrainingPage'));
const OnboardingManagementPage = lazy(() => import('./pages/onboarding/OnboardingManagementPage'));
const HROnboardingManagementPage = lazy(() => import('./pages/onboarding/HROnboardingManagementPage'));
const EmployeeOnboarding = lazy(() => import('./pages/onboarding/EmployeeOnboardingPage'));
const MyTeamPage = lazy(() => import('./pages/users/MyTeamPage'));
const MyAbsencesPage = lazy(() => import('./pages/absence/MyAbsencePage'));
const ProfilePage = lazy(() => import('./pages/profile/MyProfilePage'));
const MyCompanyPage = lazy(() => import('./pages/companies/MyCompanyPage'));
const SeatRequestPage = lazy(() => import('./pages/users/SeatManagementPage'));
const TimesheetManagementPage = lazy(() => import('./pages/timesheets/TimesheetManagementPage'));
const AbsenceManagementPage = lazy(() => import('./pages/absence/AbsenceManagementPage'));
const EmployeeAbsencesPage = lazy(() => import('./pages/absence/EmployeeAbsencesPage'));

const EmployeeTimesheetsPage = lazy(() => import('./pages/timesheets/EmployeeTimesheetPage'));
const TimeEntriesPage = lazy(() => import('./pages/timesheets/TimeEntriesPage'));
const InviteSignupPage = lazy(() => import('./pages/auth/InviteSignupPage'));
const WeekStartHelper = lazy(() => import('./pages/admin/WeekStartHelper'));
const LoaderTestPage = lazy(() => import('./pages/test/LoaderTestPage'));
const ClientsPage = lazy(() => import('./pages/clients/ClientsPage'));
const SitesPage = lazy(() => import('./pages/admin/SitesPage'));
const TimesheetArchivePage = lazy(() => import('./pages/timesheets/TimesheetArchivePage'));
const InvoiceSummaryPage = lazy(() => import('./pages/financials/InvoiceSummaryPage'));
const InvoiceSettingsPage = lazy(() => import('./pages/financials/InvoiceSettingsPage'));
const InvoiceGeneratorPage = lazy(() => import('./pages/financials/InvoiceGeneratorPage'));
const PayslipGeneratorPage = lazy(() => import('./pages/financials/PayslipGeneratorPage'));
const RateAllowancePage = lazy(() => import('./pages/financials/RateAllowancePage'));
const SchedulePage = lazy(() => import('./pages/schedule/SchedulePage'));
const WorkLocationsPage = lazy(() => import('./pages/scheduling/WorkLocationsPage'));
const IncidentReportsPage = lazy(() => import('./pages/incidents/IncidentReportsPage'));
const TimesheetTestPage = lazy(() => import('./pages/debug/TimesheetTestPage'));
const TimesheetInspectorPage = lazy(() => import('./pages/debug/TimesheetInspectorPage'));
const SessionDebugPage = lazy(() => import('./pages/debug/SessionDebugPage'));
const SuperAdminUserListPage = lazy(() => import('./pages/admin/SuperAdminUserListPage'));
const DummyTimesheetGenerator = lazy(() => import('./pages/ManuralPage'));

import Loader from './components/ui/Loader';

const AppRouter = () => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <Loader fullScreen text="Loading application..." />;
  }

  return (
    <Suspense fallback={<Loader fullScreen text="Loading application..." />}>
      <Routes>
        {/* Protected routes that require authentication and onboarding checks */}
        <Route element={
          <SubscriptionGuard>
            <OnboardingGuard>
              <MandatoryTrainingGuard>
                <MainLayout />
              </MandatoryTrainingGuard>
            </OnboardingGuard>
          </SubscriptionGuard>
        }>
          <Route path="/" element={<DashboardLoader />} />
          <Route path="/company" element={<CompanyDetailsPage />} />
          <Route path="/payments" element={
            <RoleGuard allowedRoles={['superUser']}>
              <PaymentsPage />
            </RoleGuard>
          } />
          <Route path="/users" element={
            <RoleGuard allowedRoles={['siteManager', 'seniorManager', 'teamManager', 'adminManager', 'hrManager', 'hrAdvisor', 'adminAdvisor', 'contractManager']}>
              <UserListPage />
            </RoleGuard>
          } />
          <Route path="/userDetails" element={
            <RoleGuard allowedRoles={['siteManager', 'seniorManager', 'teamManager', 'adminManager', 'hrManager', 'hrAdvisor', 'adminAdvisor', 'contractManager']}>
              <UserDetailsPage />
            </RoleGuard>
          } />
          <Route path="/allowance" element={
            <RoleGuard allowedRoles={['siteManager', 'seniorManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor']}>
              <PendingAllowancePage />
            </RoleGuard>
          } />
          <Route path="/subscription-expired" element={<SubscriptionExpiredPage />} />
          <Route path="/manageSubscription" element={<ManageTeamRenewalPage />} />
          <Route path="/offlinePayment" element={<OfflinePaymentSubmissionPage />} />
          <Route path="/billing" element={<BillingSubscriptionsPage />} />
          <Route path="/settings" element={
            <RoleGuard allowedRoles={['siteManager', 'seniorManager']}>
              <SettingsPage />
            </RoleGuard>
          } />
          <Route path="/debug/timesheet-test" element={
            <RoleGuard allowedRoles={['superUser']}>
              <TimesheetTestPage />
            </RoleGuard>
          } />
          <Route path="/debug/timesheet-inspector" element={
            <RoleGuard allowedRoles={['superUser']}>
              <TimesheetInspectorPage />
            </RoleGuard>
          } />
          <Route path="/debug/sessions" element={
            <RoleGuard allowedRoles={['superUser']}>
              <SessionDebugPage />
            </RoleGuard>
          } />
          <Route path="/approvals" element={
            <PluginGuard pluginName="scheduling">
              <ApprovalsPage />
            </PluginGuard>
          } />
          <Route path="/documents/:id" element={<EmployeeDocumentManagementPage />} />
          <Route path="/training" element={<TrainingManagementPage />} />
          <Route path="/training/:id" element={<EmployeeTrainingPage />} />
          <Route path="/onboardings-management" element={<OnboardingManagementPage />} />
          <Route path="/hr-onboarding" element={
            <RoleGuard allowedRoles={['siteManager', 'seniorManager', 'hrManager', 'adminManager']}>
              <HROnboardingManagementPage />
            </RoleGuard>
          } />
          <Route path="/myteam" element={
            <RoleGuard allowedRoles={['teamManager', 'seniorManager']}>
              <MyTeamPage />
            </RoleGuard>
          } />
          <Route path="/myabsences" element={
            <PluginGuard pluginName="absence">
              <MyAbsencesPage />
            </PluginGuard>
          } />
          <Route path="/myprofile" element={<ProfilePage />} />
          <Route path="/my-company" element={<MyCompanyPage />} />
          <Route path='/seat-management' element={
            <RoleGuard allowedRoles={['siteManager', 'seniorManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor']}>
              <SeatRequestPage />
            </RoleGuard>
          } />
          <Route path="/timesheets" element={
            <PluginGuard pluginName="scheduling">
              <TimesheetManagementPage userRole={user?.role} />
            </PluginGuard>
          } />
          <Route path="/timesheets/:id" element={
            <PluginGuard pluginName="scheduling">
              <EmployeeTimesheetsPage />
            </PluginGuard>
          } />
          <Route path="/timesheet-archives" element={
            <PluginGuard pluginName="scheduling">
              <TimesheetArchivePage />
            </PluginGuard>
          } />
          <Route path="/time-entries" element={
            <PluginGuard pluginName="scheduling">
              <TimeEntriesPage />
            </PluginGuard>
          } />
          <Route path="/documents" element={<DocumentManagementPage />} />
          <Route path="/incidents" element={
            <RoleGuard allowedRoles={['siteManager', 'seniorManager', 'teamManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor', 'contractManager', 'employee']}>
              <PluginGuard pluginName="scheduling">
                <IncidentReportsPage />
              </PluginGuard>
            </RoleGuard>
          } />
          <Route path='/absences' element={
            <PluginGuard pluginName="absence">
              <AbsenceManagementPage />
            </PluginGuard>
          } />
          <Route path='/absences/:id' element={
            <PluginGuard pluginName="absence">
              <EmployeeAbsencesPage />
            </PluginGuard>
          } />
          <Route path="/schedule" element={
            <RoleGuard allowedRoles={['siteManager', 'adminManager', 'employee']}>
              <PluginGuard pluginName="scheduling">
                <SchedulePage />
              </PluginGuard>
            </RoleGuard>
          } />
          <Route path="/locations" element={
            <RoleGuard allowedRoles={['siteManager', 'seniorManager']}>
              <PluginGuard pluginName="scheduling">
                <WorkLocationsPage />
              </PluginGuard>
            </RoleGuard>
          } />

          <Route path="/admin/week-start-helper" element={
            <RoleGuard allowedRoles={['superUser']}>
              <WeekStartHelper />
            </RoleGuard>
          } />
          <Route path="/admin/billing-mock-tools" element={
            <RoleGuard allowedRoles={['superUser']}>
              <BillingMockTools />
            </RoleGuard>
          } />
          <Route path="/loader-test" element={
            <RoleGuard allowedRoles={['superUser']}>
              <LoaderTestPage />
            </RoleGuard>
          } />
          <Route path="/clients" element={
            <RoleGuard allowedRoles={['superUser']}>
              <ClientsPage />
            </RoleGuard>
          } />
          <Route path="/admin/sites-management" element={
            <RoleGuard allowedRoles={['superUser']}>
              <SitesPage />
            </RoleGuard>
          } />

          <Route path="/invoice-summary" element={
            <RoleGuard allowedRoles={['siteManager', 'seniorManager']}>
              <PluginGuard pluginName="payslipAndInvoice">
                <InvoiceSummaryPage />
              </PluginGuard>
            </RoleGuard>
          } />
          <Route path="/admin/invoice-settings" element={
            <RoleGuard allowedRoles={['siteManager', 'seniorManager']}>
              <PluginGuard pluginName="payslipAndInvoice">
                <InvoiceSettingsPage />
              </PluginGuard>
            </RoleGuard>
          } />
          <Route path="/activity-oversight" element={
            <RoleGuard allowedRoles={['siteManager', 'seniorManager']}>
              <PluginGuard pluginName="scheduling">
                <ActivityOversightPage />
              </PluginGuard>
            </RoleGuard>
          } />
          <Route path="/financials/invoice-generator" element={
            <RoleGuard allowedRoles={['siteManager', 'seniorManager']}>
              <PluginGuard pluginName="payslipAndInvoice">
                <InvoiceGeneratorPage />
              </PluginGuard>
            </RoleGuard>
          } />
          <Route path="/financials/payslip-generator" element={
            <RoleGuard allowedRoles={['siteManager', 'seniorManager']}>
              <PluginGuard pluginName="payslipAndInvoice">
                <PayslipGeneratorPage />
              </PluginGuard>
            </RoleGuard>
          } />
          <Route path="/financials/allowances" element={
            <RoleGuard allowedRoles={['siteManager', 'seniorManager']}>
              <PluginGuard pluginName="payslipAndInvoice">
                <RateAllowancePage />
              </PluginGuard>
            </RoleGuard>
          } />
          <Route path="/admin/global-users" element={
            <RoleGuard allowedRoles={['superUser']}>
              <SuperAdminUserListPage />
            </RoleGuard>
          } />
          <Route path="/manual" element={
            <RoleGuard allowedRoles={['superUser']}>
              <DummyTimesheetGenerator />
            </RoleGuard>
          } />
        </Route>

        {/* Onboarding route */}
        <Route path="/emp/onboarding" element={
          <OnboardingGuard>
            <EmployeeOnboarding />
          </OnboardingGuard>
        } />

        {/* Public routes */}
        <Route path="/login" element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        } />
        <Route path="/bridge" element={<BridgePage />} />
        <Route path="/signup" element={
          <PublicRoute>
            <SignupPage />
          </PublicRoute>
        } />
        {/* <Route path="/team-size-selection" element={
          <PublicRoute>
            <TeamSizeSelection />
          </PublicRoute>
        } /> */}
        <Route path="/invite" element={
          <PublicRoute>
            <InviteSignupPage />
          </PublicRoute>
        } />
        <Route path="/forgot-password" element={
          <PublicRoute>
            <ForgotPasswordPage />
          </PublicRoute>
        } />

        {/* Fallback route */}
        <Route path="*" element={<ComingSoon />} />
      </Routes>
    </Suspense>
  );
};

export default AppRouter;