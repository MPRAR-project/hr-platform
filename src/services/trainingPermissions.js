/**
 * Training Permissions Service - Role-based access control for training features
 * Handles permission validation, scope checking, and access logging
 */

import { db } from '../firebase/client';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
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
   * Core method to validate company access boundaries
   */
  enforceCompanyBoundary(user, targetCompanyId) {
    if (!user || !user.companyId || !targetCompanyId) {
      return false;
    }

    const userCompanyId = user.companyId.includes('/')
      ? user.companyId.split('/')[1]
      : user.companyId;

    const targetId = targetCompanyId.includes('/')
      ? targetCompanyId.split('/')[1]
      : targetCompanyId;

    return userCompanyId === targetId;
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
   * Get role hierarchy level
   */
  getRoleLevel(role) {
    return this.roleHierarchy[role] || 0;
  }

  /**
   * Check if user can view training
   */
  async canViewTraining(user, trainingId, trainingData = null) {
    try {
      // Enforce company boundary
      if (trainingData && !this.enforceCompanyBoundary(user, trainingData.companyId)) {
        this.logAccessAttempt(user.userId, 'viewTraining', trainingId, false, 'Company boundary violation');
        return { allowed: false, reason: 'Training not in your company' };
      }

      // Elevated roles can view all trainings in their company
      const elevatedRoles = ['siteManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor'];
      if (elevatedRoles.includes(user.role)) {
        this.logAccessAttempt(user.userId, 'viewTraining', trainingId, true, 'Elevated role access');
        return { allowed: true, scope: 'company' };
      }

      // Team managers can view trainings they created or that are relevant to their team
      if (user.role === 'teamManager') {
        if (trainingData && trainingData.createdBy === user.userId) {
          this.logAccessAttempt(user.userId, 'viewTraining', trainingId, true, 'Creator access');
          return { allowed: true, scope: 'created' };
        }

        // Check if training is assigned to any of their managed employees
        const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
        const managedEmployeeIds = await getManagedEmployeeIdsForManager(user.userId, companyId);

        const assignmentsQuery = query(
          collection(db, 'trainingAssignments'),
          where('trainingId', '==', trainingId)
        );
        const assignmentsSnap = await getDocs(assignmentsQuery);

        const hasRelevantAssignments = assignmentsSnap.docs.some(doc =>
          managedEmployeeIds.has(doc.data().userId)
        );

        if (hasRelevantAssignments) {
          this.logAccessAttempt(user.userId, 'viewTraining', trainingId, true, 'Team relevance');
          return { allowed: true, scope: 'team' };
        }

        this.logAccessAttempt(user.userId, 'viewTraining', trainingId, false, 'Not relevant to team');
        return { allowed: false, reason: 'Training not relevant to your team' };
      }

      // Employees can only view trainings assigned to them
      if (user.role === 'employee') {
        const assignmentsQuery = query(
          collection(db, 'trainingAssignments'),
          where('trainingId', '==', trainingId),
          where('userId', '==', user.userId)
        );
        const assignmentsSnap = await getDocs(assignmentsQuery);

        if (!assignmentsSnap.empty) {
          this.logAccessAttempt(user.userId, 'viewTraining', trainingId, true, 'Personal assignment');
          return { allowed: true, scope: 'personal' };
        }

        this.logAccessAttempt(user.userId, 'viewTraining', trainingId, false, 'Not assigned');
        return { allowed: false, reason: 'Training not assigned to you' };
      }

      this.logAccessAttempt(user.userId, 'viewTraining', trainingId, false, 'Unknown role');
      return { allowed: false, reason: 'Insufficient permissions' };
    } catch (error) {
      console.error('Error checking training view permission:', error);
      this.logAccessAttempt(user.userId, 'viewTraining', trainingId, false, `Error: ${error.message}`);
      return { allowed: false, reason: 'Permission check failed' };
    }
  }

  /**
   * Check if user can approve training assignments
   */
  async canApproveTraining(user, assignmentData) {
    try {
      // Enforce company boundary
      if (!this.enforceCompanyBoundary(user, assignmentData.companyId)) {
        this.logAccessAttempt(user.userId, 'approveTraining', assignmentData.id, false, 'Company boundary violation');
        return { allowed: false, reason: 'Assignment not in your company' };
      }

      // Check basic permission
      if (!this.hasPermission(user.role, 'approveTraining')) {
        this.logAccessAttempt(user.userId, 'approveTraining', assignmentData.id, false, 'Insufficient role permissions');
        return { allowed: false, reason: 'Insufficient permissions to approve training' };
      }

      // Elevated roles can approve any assignment in their company
      const elevatedRoles = ['siteManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor'];
      if (elevatedRoles.includes(user.role)) {
        this.logAccessAttempt(user.userId, 'approveTraining', assignmentData.id, true, 'Elevated role approval');
        return { allowed: true, scope: 'company' };
      }

      // Team managers can only approve assignments for their managed employees
      if (user.role === 'teamManager') {
        const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
        const managedEmployeeIds = await getManagedEmployeeIdsForManager(user.userId, companyId);

        if (managedEmployeeIds.has(assignmentData.userId)) {
          this.logAccessAttempt(user.userId, 'approveTraining', assignmentData.id, true, 'Team member approval');
          return { allowed: true, scope: 'team' };
        }

        this.logAccessAttempt(user.userId, 'approveTraining', assignmentData.id, false, 'User not in team');
        return { allowed: false, reason: 'User not in your team' };
      }

      this.logAccessAttempt(user.userId, 'approveTraining', assignmentData.id, false, 'Unknown approval scenario');
      return { allowed: false, reason: 'Cannot determine approval permissions' };
    } catch (error) {
      console.error('Error checking training approval permission:', error);
      this.logAccessAttempt(user.userId, 'approveTraining', assignmentData.id, false, `Error: ${error.message}`);
      return { allowed: false, reason: 'Permission check failed' };
    }
  }

  /**
   * Get accessible user IDs for the current user (for assignment purposes)
   */
  async getAccessibleUserIds(user) {
    try {
      const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;

      // Get all users in the company first
      const companyScopedUserIds = await this.getCompanyScopedUserIds(companyId);

      // Elevated roles can access all users in their company
      const elevatedRoles = ['siteManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor'];
      if (elevatedRoles.includes(user.role)) {
        return await this.validateCompanyMembership(companyScopedUserIds, companyId);
      }

      // Team managers can only access their managed employees
      if (user.role === 'teamManager') {
        const managedEmployeeIds = await getManagedEmployeeIdsForManager(user.userId, companyId);
        const accessibleIds = companyScopedUserIds.filter(userId => managedEmployeeIds.has(userId));
        return await this.validateCompanyMembership(accessibleIds, companyId);
      }

      // Employees can only access themselves
      if (user.role === 'employee') {
        return [user.userId];
      }

      return [];
    } catch (error) {
      console.error('Error getting accessible user IDs:', error);
      return [];
    }
  }

  /**
   * Get company-scoped user IDs
   */
  async getCompanyScopedUserIds(companyId) {
    try {
      const usersQuery = query(
        collection(db, 'users'),
        where('companyId', '==', `companies/${companyId}`)
      );

      const snapshot = await getDocs(usersQuery);
      return snapshot.docs.map(doc => doc.id);
    } catch (error) {
      console.error('Error fetching company-scoped users:', error);
      return [];
    }
  }

  /**
   * Validate that user IDs belong to the expected company
   */
  async validateCompanyMembership(userIds, expectedCompanyId) {
    try {
      const validatedIds = [];

      for (const userId of userIds) {
        try {
          const userDoc = await getDoc(doc(db, 'users', userId));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            const userCompanyId = userData.companyId?.includes('/')
              ? userData.companyId.split('/')[1]
              : userData.companyId;

            if (userCompanyId === expectedCompanyId) {
              validatedIds.push(userId);
            } else {
              this.logAccessAttempt('system', 'validateCompanyMembership', userId, false, 'Company mismatch');
            }
          }
        } catch (error) {
          console.warn(`Failed to validate user ${userId}:`, error);
        }
      }

      return validatedIds;
    } catch (error) {
      console.error('Error validating company membership:', error);
      return [];
    }
  }

  /**
   * Apply company-scoped filtering to data arrays
   */
  applyCompanyScopedFiltering(user, dataArray, companyIdField = 'companyId') {
    if (!user || !user.companyId || !Array.isArray(dataArray)) {
      return [];
    }

    const userCompanyId = user.companyId.includes('/')
      ? user.companyId.split('/')[1]
      : user.companyId;

    return dataArray.filter(item => {
      if (!item || !item[companyIdField]) return false;

      const itemCompanyId = item[companyIdField].includes('/')
        ? item[companyIdField].split('/')[1]
        : item[companyIdField];

      return itemCompanyId === userCompanyId;
    });
  }

  /**
   * Comprehensive validation for cross-company access attempts
   */
  validateCrossCompanyAccess(user, targetCompanyId, operation) {
    const isValid = this.enforceCompanyBoundary(user, targetCompanyId);

    if (!isValid) {
      const error = {
        isValid: false,
        error: 'Cross-company access denied',
        code: 'CROSS_COMPANY_ACCESS_DENIED'
      };

      this.logAccessAttempt(
        user?.userId || 'unknown',
        operation || 'unknown',
        targetCompanyId,
        false,
        'Cross-company access attempt'
      );

      return error;
    }

    return { isValid: true };
  }

  /**
   * Filter trainings based on user permissions
   */
  async filterTrainingsByPermissions(user, trainings) {
    if (!user || !Array.isArray(trainings)) {
      return [];
    }

    // Apply company-scoped filtering first
    const companyScopedTrainings = this.applyCompanyScopedFiltering(user, trainings);

    // Elevated roles see all company trainings
    const elevatedRoles = ['siteManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor'];
    if (elevatedRoles.includes(user.role)) {
      return companyScopedTrainings;
    }

    // Team managers see trainings they created or are relevant to their team
    if (user.role === 'teamManager') {
      const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
      const managedEmployeeIds = await getManagedEmployeeIdsForManager(user.userId, companyId);

      const relevantTrainings = [];
      for (const training of companyScopedTrainings) {
        if (training.createdBy === user.userId) {
          relevantTrainings.push(training);
          continue;
        }

        // Check if training has assignments to managed employees
        try {
          const assignmentsQuery = query(
            collection(db, 'trainingAssignments'),
            where('trainingId', '==', training.id)
          );
          const assignmentsSnap = await getDocs(assignmentsQuery);

          const hasRelevantAssignments = assignmentsSnap.docs.some(doc =>
            managedEmployeeIds.has(doc.data().userId)
          );

          if (hasRelevantAssignments) {
            relevantTrainings.push(training);
          }
        } catch (error) {
          console.warn(`Error checking training relevance for ${training.id}:`, error);
        }
      }

      return relevantTrainings;
    }

    // Employees see no trainings in the main list (they see assignments instead)
    return [];
  }

  /**
   * Filter users based on permissions (for assignment purposes)
   */
  async filterUsersByPermissions(user, users) {
    if (!user || !Array.isArray(users)) {
      return [];
    }

    // Apply company-scoped filtering first
    const companyScopedUsers = this.applyCompanyScopedFiltering(user, users);

    // Elevated roles can access all users in their company
    const elevatedRoles = ['siteManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor'];
    if (elevatedRoles.includes(user.role)) {
      return companyScopedUsers;
    }

    // Team managers can only access their managed employees
    if (user.role === 'teamManager') {
      const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;
      const managedEmployeeIds = await getManagedEmployeeIdsForManager(user.userId, companyId);
      return companyScopedUsers.filter(userData => managedEmployeeIds.has(userData.id || userData.userId));
    }

    // Employees can only access themselves
    if (user.role === 'employee') {
      return companyScopedUsers.filter(userData => (userData.id || userData.userId) === user.userId);
    }

    return [];
  }

  /**
   * Validate assignment permissions
   */
  async validateAssignmentPermissions(user, trainingId, targetUserIds) {
    try {
      // Check basic assignment permission
      if (!this.hasPermission(user.role, 'assignTraining')) {
        return {
          isValid: false,
          error: 'Insufficient permissions to assign training',
          code: 'INSUFFICIENT_PERMISSIONS'
        };
      }

      // Get accessible user IDs
      const accessibleUserIds = await this.getAccessibleUserIds(user);

      // Check if all target users are accessible
      const unauthorizedUsers = targetUserIds.filter(userId =>
        !accessibleUserIds.includes(userId)
      );

      if (unauthorizedUsers.length > 0) {
        this.logAccessAttempt(
          user.userId,
          'assignTraining',
          trainingId,
          false,
          `Unauthorized users: ${unauthorizedUsers.join(', ')}`
        );

        return {
          isValid: false,
          error: 'Cannot assign training to users outside your scope',
          code: 'UNAUTHORIZED_USERS',
          unauthorizedUsers
        };
      }

      // Validate that target users belong to the same company
      const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;

      for (const userId of targetUserIds) {
        try {
          const userDoc = await getDoc(doc(db, 'users', userId));
          if (!userDoc.exists()) {
            return {
              isValid: false,
              error: `User ${userId} not found`,
              code: 'USER_NOT_FOUND'
            };
          }

          const userData = userDoc.data();
          const validation = this.validateCrossCompanyAccess(user, userData.companyId, 'assignTraining');

          if (!validation.isValid) {
            return {
              isValid: false,
              error: `User ${userId} not in your company`,
              code: 'CROSS_COMPANY_USER'
            };
          }
        } catch (error) {
          console.error(`Error validating user ${userId}:`, error);
          return {
            isValid: false,
            error: `Failed to validate user ${userId}`,
            code: 'VALIDATION_ERROR'
          };
        }
      }

      return { isValid: true };
    } catch (error) {
      console.error('Error validating assignment permissions:', error);
      return {
        isValid: false,
        error: 'Permission validation failed',
        code: 'VALIDATION_ERROR'
      };
    }
  }

  /**
   * Log access attempts for security monitoring
   */
  logAccessAttempt(userId, operation, resourceId, success, reason) {
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        userId,
        operation,
        resourceId,
        success,
        reason,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'server'
      };

      console.log('Access attempt:', logEntry);

      // In a production environment, you might want to store these logs
      // in a separate collection or send them to a logging service
    } catch (error) {
      console.error('Error logging access attempt:', error);
    }
  }
}

// Export singleton instance
export const trainingPermissionService = new TrainingPermissionService();
export default trainingPermissionService;