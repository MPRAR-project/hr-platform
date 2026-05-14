/**
 * Training Permissions Service - Role-based access control for training features
 * Handles permission validation, scope checking, and access logging (REST Migration)
 */

import hrApiClient from '../lib/hrApiClient';
import { getManagedEmployeeIdsForManager } from './teams';

/**
 * Training Permission Service Class
 */
class TrainingPermissionService {
  constructor() {
    this.roleHierarchy = {
      'superUser': 100,
      'siteManager': 90,
      'seniorManager': 85,
      'adminManager': 80,
      'hrManager': 75,
      'adminAdvisor': 70,
      'hrAdvisor': 65,
      'teamManager': 60,
      'contractManager': 50,
      'employee': 10
    };

    this.permissions = {
      // Training management permissions
      createTraining: ['siteManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor', 'teamManager'],
      editTraining: ['siteManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor', 'teamManager'],
      deleteTraining: ['siteManager', 'adminManager', 'hrManager', 'adminAdvisor'],
      viewAllTrainings: ['siteManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor', 'seniorManager'],

      // Assignment permissions
      assignTraining: ['siteManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor', 'teamManager'],
      viewAllAssignments: ['siteManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor', 'seniorManager'],

      // Approval permissions
      approveTraining: ['siteManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor', 'teamManager', 'seniorManager'],
      declineTraining: ['siteManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor', 'teamManager', 'seniorManager'],

      // Certificate permissions
      approveCertificate: ['siteManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor', 'teamManager', 'seniorManager'],
      declineCertificate: ['siteManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor', 'teamManager', 'seniorManager'],

      // Analytics permissions
      viewAnalytics: ['siteManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor', 'teamManager', 'seniorManager']
    };
  }

  /**
   * Check if user has specific permission
   */
  hasPermission(userRole, permission) {
    if (!userRole || !permission) {
      return false;
    }

    const allowedRoles = this.permissions[permission];
    return allowedRoles ? allowedRoles.includes(userRole) : false;
  }

  /**
   * Check if user can view training
   */
  async canViewTraining(user, trainingId, trainingData = null) {
    try {
      // Elevated roles can view all trainings in their company
      const elevatedRoles = ['siteManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor'];
      if (elevatedRoles.includes(user.role)) {
        return { allowed: true, scope: 'company' };
      }

      // Team managers can view trainings they created or relevant to team
      if (user.role === 'teamManager') {
        if (trainingData && trainingData.createdBy === user.userId) {
          return { allowed: true, scope: 'created' };
        }
        
        // Check if training has assignments for their team
        const { data } = await hrApiClient.get(`/hr/training/${trainingId}`);
        const managedIds = await getManagedEmployeeIdsForManager(user.userId, user.companyId);
        const managedSet = new Set(managedIds);

        const hasRelevantAssignments = (data.assignments || []).some(a => managedSet.has(a.employeeId));
        if (hasRelevantAssignments) return { allowed: true, scope: 'team' };
        
        return { allowed: false, reason: 'Training not relevant to your team' };
      }

      // Employees see their own
      if (user.role === 'employee') {
        const { data } = await hrApiClient.get('/hr/training/my');
        if (data.some(a => a.courseId === trainingId || a.id === trainingId)) {
          return { allowed: true, scope: 'personal' };
        }
        return { allowed: false, reason: 'Training not assigned to you' };
      }

      return { allowed: false, reason: 'Insufficient permissions' };
    } catch (error) {
      console.error('Error checking training view permission:', error);
      return { allowed: false, reason: 'Permission check failed' };
    }
  }

  /**
   * Check if user can approve training assignments
   */
  async canApproveTraining(user, assignmentData) {
    try {
      if (!this.hasPermission(user.role, 'approveTraining')) {
        return { allowed: false, reason: 'Insufficient permissions' };
      }

      const elevatedRoles = ['siteManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor'];
      if (elevatedRoles.includes(user.role)) {
        return { allowed: true, scope: 'company' };
      }

      if (user.role === 'teamManager') {
        const managedIds = await getManagedEmployeeIdsForManager(user.userId, user.companyId);
        if (managedIds.includes(assignmentData.employeeId || assignmentData.userId)) {
          return { allowed: true, scope: 'team' };
        }
        return { allowed: false, reason: 'User not in your team' };
      }

      return { allowed: false, reason: 'Cannot determine approval permissions' };
    } catch (error) {
      return { allowed: false, reason: 'Permission check failed' };
    }
  }

  /**
   * Get accessible user IDs for assignment
   */
  async getAccessibleUserIds(user) {
    try {
      const elevatedRoles = ['siteManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor'];
      if (elevatedRoles.includes(user.role)) {
        const { data } = await hrApiClient.get('/hr/employees');
        return (data.employees || []).map(e => e.id);
      }

      if (user.role === 'teamManager') {
        return await getManagedEmployeeIdsForManager(user.userId, user.companyId);
      }

      return [user.userId];
    } catch {
      return [];
    }
  }

  /**
   * Filter trainings based on user permissions
   */
  async filterTrainingsByPermissions(user, trainings) {
    if (!user || !Array.isArray(trainings)) return [];

    const elevatedRoles = ['siteManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor'];
    if (elevatedRoles.includes(user.role)) return trainings;

    if (user.role === 'teamManager') {
      const managedIds = await getManagedEmployeeIdsForManager(user.userId, user.companyId);
      const managedSet = new Set(managedIds);

      return trainings.filter(t => 
        t.createdBy === user.userId || 
        (t.assignments || []).some(a => managedSet.has(a.employeeId))
      );
    }

    return [];
  }

  /**
   * Validate assignment permissions
   */
  async validateAssignmentPermissions(user, trainingId, targetUserIds) {
    try {
      if (!this.hasPermission(user.role, 'assignTraining')) {
        return { isValid: false, error: 'Insufficient permissions' };
      }

      const accessibleIds = await this.getAccessibleUserIds(user);
      const accessibleSet = new Set(accessibleIds);

      const unauthorized = targetUserIds.filter(id => !accessibleSet.has(id));
      if (unauthorized.length > 0) {
        return { isValid: false, error: 'Unauthorized users included' };
      }

      return { isValid: true };
    } catch {
      return { isValid: false, error: 'Validation failed' };
    }
  }
}

export const trainingPermissionService = new TrainingPermissionService();
export default trainingPermissionService;