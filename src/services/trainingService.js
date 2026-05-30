/**
 * trainingService.js — Phase 4 Migration (REST Only)
 *
 * Replaces all Firestore reads/writes with HR REST API calls.
 * All exported function signatures are identical to the original.
 * Named export: trainingService (for dataPrefetch.js etc.)
 */

import hrApiClient from '../lib/hrApiClient';
import wsClient from '../lib/wsClient';

// ── Helper: normalize date fields ─────────────────────────────────────────────
function normalizeDates(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map(normalizeDates);
  }
  const out = { ...obj };
  ['createdAt','updatedAt','startDate','endDate','completedAt','dueDate'].forEach((k) => {
    if (out[k]?.toDate)   out[k] = out[k].toDate().toISOString();
    if (out[k]?.seconds)  out[k] = new Date(out[k].seconds * 1000).toISOString();
  });
  return out;
}

// ── Helper: normalize course fields (DB uses `title`, UI uses `name`) ─────────
function normalizeCourse(course) {
  if (!course || typeof course !== 'object') return course;
  return {
    ...normalizeDates(course),
    name:              course.name  || course.title  || '',
    title:             course.title || course.name   || '',
    estimatedDuration: course.estimatedDuration || course.duration || 60,
    category:          course.category || (course.isMandatory ? 'Mandatory' : 'Technical'),
    trainingType:      course.trainingType || course.category || (course.isMandatory ? 'Mandatory on Sign Up' : 'Technical'),
    status:            course.status || 'active',
  };
}

// ── Helper: normalize assignment — maps backend `course` key → `training` key ──
// Backend returns: { ...assignment, course: { title, ... }, employee: { ... } }
// Frontend expects: { ...assignment, training: { name, ... } }
function normalizeAssignment(a) {
  if (!a || typeof a !== 'object') return a;
  const normalized = normalizeDates(a);
  // Build training object from course (backend) or training (already normalized)
  const courseData = a.course || a.training || null;
  const training = courseData ? normalizeCourse(courseData) : null;
  return {
    ...normalized,
    // keep course for backward compat
    course: training,
    // add training alias for frontend components
    training: training,
    // flatten name/title at assignment level as fallback
    name:  training?.name  || a.name  || '',
    title: training?.title || a.title || '',
  };
}

// ── Get All Training Courses ──────────────────────────────────────────────────
export async function getTrainingCourses(companyId) {
  try {
    const { data } = await hrApiClient.get('/hr/training');
    return (data.courses || data || []).map(normalizeCourse);
  } catch (err) {
    if (err.response?.status === 403) return [];
    throw new Error(err.response?.data?.error || 'Failed to fetch training courses');
  }
}

// ── Get Single Course ─────────────────────────────────────────────────────────
export async function getTrainingCourse(courseId) {
  try {
    const { data } = await hrApiClient.get(`/hr/training/${courseId}`);
    return normalizeCourse(data);
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw new Error(err.response?.data?.error || 'Failed to fetch training course');
  }
}

// ── Create Course ─────────────────────────────────────────────────────────────
export async function createTrainingCourse(courseData, companyId, createdBy) {
  const payload = {
    ...courseData,
    companyId: companyId || courseData.companyId,
    createdBy: createdBy || null,
  };
  Object.keys(payload).forEach((k) => { if (payload[k] === undefined) delete payload[k]; });

  try {
    const { data } = await hrApiClient.post('/hr/training', payload);
    return normalizeDates(data);
  } catch (err) {
    throw new Error(err.response?.data?.error || 'Failed to create training course');
  }
}

// ── Update Course ─────────────────────────────────────────────────────────────
export async function updateTrainingCourse(courseId, updateData) {
  try {
    const { data } = await hrApiClient.put(`/hr/training/${courseId}`, updateData);
    return normalizeCourse(data);
  } catch (err) {
    if (err.response?.status === 404) throw new Error('Training course not found');
    if (err.response?.status === 403) throw new Error('Permission denied');
    throw new Error(err.response?.data?.error || 'Failed to update training course');
  }
}

// ── Delete Course ─────────────────────────────────────────────────────────────
export async function deleteTrainingCourse(courseId) {
  try {
    await hrApiClient.delete(`/hr/training/${courseId}`);
    return true;
  } catch (err) {
    if (err.response?.status === 404) throw new Error('Training course not found');
    if (err.response?.status === 403) throw new Error('Permission denied');
    throw new Error(err.response?.data?.error || 'Failed to delete training course');
  }
}

// ── Assign Course to Employee ─────────────────────────────────────────────────
export async function assignCourseToEmployee(courseId, employeeId, assignedBy, ...rest) {
  let dueDate = null;
  let mandatory = false;
  let notes = null;

  if (rest.length > 0) {
    if (typeof rest[0] === 'object' && rest[0] !== null) {
      const options = rest[0];
      dueDate = options.dueDate || null;
      mandatory = options.mandatory || false;
      notes = options.notes || null;
    } else {
      dueDate = rest[2] || null;
      const extraOptions = rest[3] || {};
      mandatory = extraOptions.mandatory || false;
      notes = extraOptions.notes || null;
    }
  }

  try {
    const { data } = await hrApiClient.post(`/hr/training/${courseId}/assign`, {
      employeeId,
      assignedBy:  assignedBy  || null,
      dueDate:     dueDate     || null,
      mandatory:   mandatory   || false,
      notes:       notes       || null,
    });
    return { success: true, data: normalizeDates(data) };
  } catch (err) {
    if (err.response?.status === 409) throw new Error('Employee is already assigned to this course');
    if (err.response?.status === 404) throw new Error('Course or employee not found');
    throw new Error(err.response?.data?.error || 'Failed to assign course');
  }
}

// ── Update Assignment Progress ────────────────────────────────────────────────
export async function updateAssignmentProgress(assignmentId, progressData) {
  try {
    const { data } = await hrApiClient.put(`/hr/training/assignments/${assignmentId}`, progressData);
    return normalizeDates(data);
  } catch (err) {
    if (err.response?.status === 404) throw new Error('Assignment not found');
    if (err.response?.status === 403) throw new Error('Permission denied');
    throw new Error(err.response?.data?.error || 'Failed to update assignment progress');
  }
}

// ── Mark Assignment Complete ──────────────────────────────────────────────────
export async function markAssignmentComplete(assignmentId, completedBy) {
  return updateAssignmentProgress(assignmentId, {
    status:      'completed',
    progress:    100,
    completedAt: new Date().toISOString(),
    completedBy: completedBy || null,
  });
}

// ── Get My Training Assignments ────────────────────────────────────────────────
export async function getMyTrainingAssignments(userId) {
  try {
    const { data } = await hrApiClient.get('/hr/training/my');
    return (data.assignments || data || []).map(normalizeAssignment);
  } catch (err) {
    if (err.response?.status === 403 || err.response?.status === 404) return [];
    throw new Error(err.response?.data?.error || 'Failed to fetch training assignments');
  }
}

// ── Get Employee Training (manager view) ──────────────────────────────────────
export async function getEmployeeTraining(employeeId) {
  try {
    const { data } = await hrApiClient.get(`/hr/training/employee/${employeeId}`);
    return (data.assignments || data || []).map(normalizeAssignment);
  } catch (err) {
    if (err.response?.status === 403) throw new Error('Permission denied');
    if (err.response?.status === 404) return [];
    throw new Error(err.response?.data?.error || 'Failed to fetch employee training');
  }
}

// ── Check Training Completion ──────────────────────────────────────────────────
export async function isTrainingComplete(userId, courseId) {
  try {
    const assignments = await getMyTrainingAssignments(userId);
    const match = assignments.find((a) => a.courseId === courseId || a.course?.id === courseId);
    return match ? match.status === 'completed' || match.progress >= 100 : false;
  } catch (err) {
    return false;
  }
}

// ── Get Training Stats ────────────────────────────────────────────────────────
export async function getTrainingStats(companyId) {
  try {
    const { data } = await hrApiClient.get('/hr/training/stats');
    return data;
  } catch (err) {
    return { totalCourses: 0, activeCourses: 0, mandatoryCourses: 0 };
  }
}

// ── Statistics (Complex) ──────────────────────────────────────────────────────
export async function getTrainingStatistics(companyId, role, userId) {
  try {
    const { data } = await hrApiClient.get('/hr/training/stats');
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── Subscriptions (Phase 6) ───────────────────────────────────────────────────
export function subscribeTrainings(companyId, callback) {
  const fetch = () =>
    getTrainingCourses(companyId)
      .then((data) => callback({ success: true, data }))
      .catch((err) => callback({ success: false, error: err.message }));

  fetch();
  wsClient.on('training:updated', fetch);
  return () => wsClient.off('training:updated', fetch);
}

export async function getTrainingAssignments(companyId, filters, role, userId) {
  try {
    const { data } = await hrApiClient.get('/hr/training/assignments', {
        params: { ...filters, role, userId }
    });
    return { success: true, data: (data.assignments || data || []).map(normalizeAssignment) };
  } catch (err) {
    return { success: false, error: err.response?.data?.error || err.message };
  }
}

export function subscribeAssignments(companyId, userId, callback) {
  const fetch = () => {
    // For managers loading the management page, we need all assignments for the company.
    // getTrainingAssignments will hit /hr/training/assignments. 
    // We pass userId just in case the backend uses it for role-based scoping.
    getTrainingAssignments(companyId, {}, null, userId)
      .then((result) => callback(result))
      .catch((err) => callback({ success: false, error: err.message }));
  };

  fetch();
  wsClient.on('training:updated', fetch);
  return () => wsClient.off('training:updated', fetch);
}

// ── Default export ────────────────────────────────────────────────────────────
const trainingService = {
  getTrainingCourses,
  getTrainingCourse,
  createTrainingCourse,
  createTraining: createTrainingCourse,
  updateTrainingCourse,
  updateTraining: updateTrainingCourse,
  deleteTrainingCourse,
  deleteTraining: deleteTrainingCourse,
  assignCourseToEmployee,
  assignTraining: assignCourseToEmployee,
  updateAssignmentProgress,
  updateAssignment: updateAssignmentProgress,
  markAssignmentComplete,
  getMyTrainingAssignments,
  getEmployeeTraining,
  isTrainingComplete,
  getTrainingStats,
  getTrainingStatistics,
  subscribeTrainings,
  subscribeAssignments,
  getTrainingAssignments,
};

export default trainingService;
export { trainingService };
