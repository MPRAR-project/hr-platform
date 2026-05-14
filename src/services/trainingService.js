/**
 * trainingService.js — Phase 4 Migration (REST Only)
 *
 * Replaces all Firestore reads/writes with HR REST API calls.
 * All exported function signatures are identical to the original.
 * Named export: trainingService (for dataPrefetch.js etc.)
 */

import hrApiClient from '../lib/hrApiClient';

// ── Helper: normalize date fields ─────────────────────────────────────────────
function normalizeDates(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  ['createdAt','updatedAt','startDate','endDate','completedAt','dueDate'].forEach((k) => {
    if (out[k]?.toDate)   out[k] = out[k].toDate().toISOString();
    if (out[k]?.seconds)  out[k] = new Date(out[k].seconds * 1000).toISOString();
  });
  return out;
}

// ── Get All Training Courses ──────────────────────────────────────────────────
export async function getTrainingCourses(companyId) {
  try {
    const { data } = await hrApiClient.get('/hr/training');
    return (data.courses || data || []).map(normalizeDates);
  } catch (err) {
    if (err.response?.status === 403) return [];
    throw new Error(err.response?.data?.error || 'Failed to fetch training courses');
  }
}

// ── Get Single Course ─────────────────────────────────────────────────────────
export async function getTrainingCourse(courseId) {
  try {
    const { data } = await hrApiClient.get(`/hr/training/${courseId}`);
    return normalizeDates(data);
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
    return normalizeDates(data);
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
export async function assignCourseToEmployee(courseId, employeeId, assignedBy, options = {}) {
  try {
    const { data } = await hrApiClient.post(`/hr/training/${courseId}/assign`, {
      employeeId,
      assignedBy:  assignedBy  || null,
      dueDate:     options.dueDate     || null,
      mandatory:   options.mandatory   || false,
      notes:       options.notes       || null,
    });
    return normalizeDates(data);
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
    return (data.assignments || data || []).map(normalizeDates);
  } catch (err) {
    if (err.response?.status === 403 || err.response?.status === 404) return [];
    throw new Error(err.response?.data?.error || 'Failed to fetch training assignments');
  }
}

// ── Get Employee Training (manager view) ──────────────────────────────────────
export async function getEmployeeTraining(employeeId) {
  try {
    const { data } = await hrApiClient.get(`/hr/training/employee/${employeeId}`);
    return (data.assignments || data || []).map(normalizeDates);
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
  } catch {
    return false;
  }
}

// ── Get Training Stats for Dashboard ─────────────────────────────────────────
export async function getTrainingStats(companyId) {
  try {
    const courses = await getTrainingCourses(companyId);
    return {
      totalCourses:     courses.length,
      activeCourses:    courses.filter((c) => c.status === 'active' || c.isActive).length,
      mandatoryCourses: courses.filter((c) => c.mandatory || c.isMandatory).length,
    };
  } catch {
    return { totalCourses: 0, activeCourses: 0, mandatoryCourses: 0 };
  }
}

// ── Default export ────────────────────────────────────────────────────────────
const trainingService = {
  getTrainingCourses,
  getTrainingCourse,
  createTrainingCourse,
  updateTrainingCourse,
  deleteTrainingCourse,
  assignCourseToEmployee,
  updateAssignmentProgress,
  markAssignmentComplete,
  getMyTrainingAssignments,
  getEmployeeTraining,
  isTrainingComplete,
  getTrainingStats,
};

export default trainingService;
export { trainingService };
