import { prefetchDocumentData } from './documentPrefetch';
import { fetchCompanyDetails } from './companyService';
import { fetchSeatRequests } from './seatRequestService';
import { getOnboardingApplications } from './onboarding';
import { getCompanyOnboardingPolicies } from './onboardingPolicyService';
import { getHROnboardingProfiles } from './hrOnboarding';
import { getBillingSummary } from './billing';
import { getUsersByCompany } from './users';
import { userGroupingService } from './userGroupingService';
import { allowanceService } from './allowanceService';
import { trainingService } from './trainingService';
import hrApiClient from '../lib/hrApiClient';

const CACHE_TTL = 7 * 60 * 1000; // 7 min
const ABSENCES_LIMIT = 500;
const USERS_PAGE_SIZE = 20;

export async function prefetchAll(user, setItem) {
  if (!user?.userId || !user?.companyId || typeof setItem !== 'function') return;
  const cid = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;

  const tasks = [
    () => prefetchDocumentData(cid, user.role, user.userId, setItem),
    () => prefetchBilling(cid, setItem),
    () => prefetchCompanyDetails(cid, setItem),
    () => prefetchSeatRequests(cid, setItem),
    () => prefetchOnboarding(cid, setItem),
    () => prefetchHROnboarding(cid, setItem),
    () => prefetchAbsences(cid, setItem),
    () => prefetchUsersList(cid, setItem),
    () => prefetchAllowances(user.userId, user, setItem),
    () => prefetchTraining(cid, user, setItem),
    () => import('../pages/absence/AbsenceManagementPage').catch(() => { }),
    () => import('../pages/users/UserListPage').catch(() => { }),
    () => import('../pages/timesheets/TimesheetManagementPage').catch(() => { })
  ];

  await Promise.allSettled(tasks.map((t) => t().catch(() => { })));
}

async function prefetchCompanyDetails(companyId, setItem) {
  try {
    const data = await fetchCompanyDetails(companyId);
    setItem(`company_${companyId}`, data, CACHE_TTL);
  } catch (_) { }
}

async function prefetchSeatRequests(companyId, setItem) {
  try {
    const data = await fetchSeatRequests(companyId, { limit: 100 });
    setItem(`seatRequests_${companyId}`, data, CACHE_TTL);
  } catch (_) { }
}

async function prefetchOnboarding(companyId, setItem) {
  try {
    const [appsResult, policies] = await Promise.all([
      getOnboardingApplications({ companyId, limitCount: 100 }),
      getCompanyOnboardingPolicies(companyId).catch(() => [])
    ]);
    const applications = appsResult?.applications ?? [];
    setItem(`onboarding_${companyId}`, { applications, policies }, CACHE_TTL);
  } catch (_) { }
}

async function prefetchHROnboarding(companyId, setItem) {
  try {
    const result = await getHROnboardingProfiles({ companyId, limitCount: 50 });
    const apps = result.applications || result.profiles || (Array.isArray(result) ? result : []);
    const profiles = apps.map(p => ({ ...p, userId: p.employeeId || p.userId }));
    setItem(`hr_onboarding_${companyId}`, { profiles, userDataMap: {} }, CACHE_TTL);
  } catch (_) { }
}

async function prefetchBilling(companyId, setItem) {
  try {
    const summary = await getBillingSummary();
    setItem(`billing_${companyId}`, { summary }, CACHE_TTL);
  } catch (_) { }
}

async function prefetchAbsences(companyId, setItem) {
  try {
    const [users, absencesResult] = await Promise.all([
      getUsersByCompany(companyId),
      hrApiClient.get('/hr/absences', { params: { limit: ABSENCES_LIMIT } })
    ]);
    const absences = absencesResult.data.absences || absencesResult.data || [];
    const absencesData = absences.map((a) => ({ userId: a.userId, status: a.status }));
    setItem(`absences_${companyId}`, { users, absences: absencesData }, CACHE_TTL);
  } catch (_) { }
}

async function prefetchUsersList(companyId, setItem) {
  try {
    const result = await userGroupingService.fetchPaginatedUsers(companyId, USERS_PAGE_SIZE, null);
    const payload = {
      users: result.users,
      lastDoc: result.lastDoc,
      hasMore: result.hasMore
    };
    setItem(`users_list_${companyId}`, payload, CACHE_TTL);
  } catch (_) { }
}

async function prefetchAllowances(userId, user, setItem) {
  if (!userId || !user) return;
  try {
    const year = new Date().getFullYear();
    const list = await allowanceService.getEmployeeAllowances(userId, user, year);
    setItem(`allowances_${userId}_${year}`, list, CACHE_TTL);
  } catch (_) { }
}

async function prefetchTraining(companyId, user, setItem) {
  if (!companyId || !(user?.userId || user?.uid)) return;
  try {
    const [trainingsResult, assignmentsResult, statsResult] = await Promise.all([
      trainingService.getTrainings(companyId, user.role, user.userId),
      trainingService.getTrainingAssignments(companyId, null, user.role, user.userId || user.uid),
      trainingService.getTrainingStatistics(companyId, user.role, user.userId || user.uid)
    ]);
    const payload = {
      trainings: trainingsResult.success ? trainingsResult.data : [],
      assignments: assignmentsResult.success ? assignmentsResult.data : [],
      statistics: statsResult.success ? statsResult.data : {}
    };
    setItem(`training_${companyId}_${user.userId}`, payload, CACHE_TTL);
  } catch (_) { }
}
