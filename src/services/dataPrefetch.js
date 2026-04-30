/**
 * Central prefetch for key pages so data loads in <500ms when user navigates.
 * Run from MainLayout when user is ready; each prefetch is best-effort (errors ignored).
 */
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
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { db } from '../firebase/client';

const CACHE_TTL = 7 * 60 * 1000; // 7 min
const ABSENCES_LIMIT = 500;
const USERS_PAGE_SIZE = 20;

export async function prefetchAll(user, setItem) {
  if (!user?.userId || !user?.companyId || typeof setItem !== 'function') return;
  const cid = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
  const companyPath = user.companyId.includes('/') ? user.companyId : `companies/${cid}`;

  // Documents + billing first so /documents and guard resolve fast when opening link directly (e.g. Vercel)
  const tasks = [
    () => prefetchDocumentData(cid, user.role, user.userId, setItem),
    () => prefetchBilling(cid, setItem),
    () => prefetchCompanyDetails(cid, setItem),
    () => prefetchSeatRequests(cid, setItem),
    () => prefetchOnboarding(cid, companyPath, setItem),
    () => prefetchHROnboarding(companyPath, cid, setItem),
    () => prefetchAbsences(companyPath, setItem),
    () => prefetchUsersList(cid, setItem),
    () => prefetchAllowances(user.userId, user, setItem),
    () => prefetchTraining(cid, user, setItem),
    // Background Bundle Prefetch: Start downloading the React chunks so navigation feels instant
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

async function prefetchOnboarding(companyId, companyPath, setItem) {
  try {
    const [appsResult, policies] = await Promise.all([
      getOnboardingApplications({ companyId: companyPath, limitCount: 100 }),
      getCompanyOnboardingPolicies(companyPath).catch(() => [])
    ]);
    const applications = appsResult?.applications ?? [];
    setItem(`onboarding_${companyId}`, { applications, policies }, CACHE_TTL);
  } catch (_) { }
}

async function prefetchHROnboarding(companyPath, rawCompanyId, setItem) {
  try {
    const result = await getHROnboardingProfiles({ companyId: companyPath, limitCount: 50 });
    setItem(`hr_onboarding_${rawCompanyId}`, { profiles: result.profiles || [], userDataMap: {} }, CACHE_TTL);
  } catch (_) { }
}

async function prefetchBilling(companyId, setItem) {
  try {
    const summary = await getBillingSummary(companyId);
    setItem(`billing_${companyId}`, { summary }, CACHE_TTL);
  } catch (_) { }
}

async function prefetchAbsences(companyPath, setItem) {
  try {
    const [users, absencesSnap] = await Promise.all([
      getUsersByCompany(companyPath),
      getDocs(
        query(
          collection(db, 'absences'),
          where('companyId', '==', companyPath),
          limit(ABSENCES_LIMIT)
        )
      ).catch((e) => (e?.docs ? e : { docs: [] }))
    ]);
    const docs = absencesSnap?.docs ?? [];
    const absencesData = docs.map((d) => ({ userId: d.data().userId, status: d.data().status }));
    const cid = companyPath.replace('companies/', '');
    setItem(`absences_${cid}`, { users, absences: absencesData }, CACHE_TTL);
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
