/**
 * Teams Service - Handles team management and manager-employee relationships
 * Provides utilities for checking team membership and managed employees
 */

import { db } from '../firebase/client';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';

/**
 * Get managed employee IDs for a team manager
 * @param {string} managerId - The manager's user ID
 * @param {string} companyId - The company ID
 * @returns {Promise<Set>} Set of managed employee IDs
 */
export async function getManagedEmployeeIdsForManager(managerId, companyId) {
  try {
    // Validate inputs
    if (!managerId || !companyId) {
      console.warn('getManagedEmployeeIdsForManager: Missing managerId or companyId');
      return new Set();
    }

    const managedEmployeeIds = new Set();
    const normalizedCompanyId = companyId.replace('companies/', '');

    // Method 1: Check managedEmployees array in manager's user document
    try {
      const managerRef = doc(db, 'users', managerId);
      const managerSnap = await getDoc(managerRef);

      if (managerSnap.exists()) {
        const managerData = managerSnap.data();
        if (Array.isArray(managerData.managedEmployees)) {
          managerData.managedEmployees.forEach(employeeId => {
            if (employeeId) managedEmployeeIds.add(employeeId);
          });
        }
      }
    } catch (error) {
      console.warn('Error fetching manager document:', error);
    }

    // Method 2: Check assignments collection
    try {
      const assignmentsQuery = query(
        collection(db, 'assignments'),
        where('managerId', '==', managerId),
        where('companyId', '==', `companies/${normalizedCompanyId}`)
      );

      const assignmentsSnap = await getDocs(assignmentsQuery);
      assignmentsSnap.docs.forEach(doc => {
        const assignment = doc.data();
        if (assignment.employeeId) {
          managedEmployeeIds.add(assignment.employeeId);
        }
      });
    } catch (error) {
      console.warn('Error fetching assignments:', error);
    }

    // Method 3: Check users collection for direct manager relationships
    try {
      const usersQuery = query(
        collection(db, 'users'),
        where('companyId', '==', `companies/${normalizedCompanyId}`)
      );

      const usersSnap = await getDocs(usersQuery);
      usersSnap.docs.forEach(doc => {
        const userData = doc.data();
        const userManagerId = userData.managerUserId || userData.reportsTo;

        if (userManagerId === managerId) {
          managedEmployeeIds.add(doc.id);
        }
      });
    } catch (error) {
      console.warn('Error fetching users for manager relationships:', error);
    }

    return managedEmployeeIds;
  } catch (error) {
    console.error('Error getting managed employee IDs:', error);
    return new Set();
  }
}

/**
 * Check if a user is managed by a specific manager
 * @param {string} employeeId - The employee's user ID
 * @param {string} managerId - The manager's user ID
 * @param {string} companyId - The company ID
 * @returns {Promise<boolean>} True if the employee is managed by the manager
 */
export async function isEmployeeManagedByManager(employeeId, managerId, companyId) {
  try {
    const managedEmployeeIds = await getManagedEmployeeIdsForManager(managerId, companyId);
    return managedEmployeeIds.has(employeeId);
  } catch (error) {
    console.error('Error checking employee-manager relationship:', error);
    return false;
  }
}

/**
 * Get team members for a manager
 * @param {string} managerId - The manager's user ID
 * @param {string} companyId - The company ID
 * @returns {Promise<Array>} Array of team member user objects
 */
export async function getTeamMembers(managerId, companyId) {
  try {
    const teamMembers = [];
    const processedIds = new Set();

    // Method 1: Check managedEmployees array in manager's user document
    try {
      const managerRef = doc(db, 'users', managerId);
      const managerSnap = await getDoc(managerRef);

      if (managerSnap.exists()) {
        const managerData = managerSnap.data();
        if (Array.isArray(managerData.managedEmployees)) {
          // Fetch only the specific employees we need
          const employeePromises = managerData.managedEmployees
            .filter(id => !processedIds.has(id))
            .map(async (employeeId) => {
              processedIds.add(employeeId);
              const employeeRef = doc(db, 'users', employeeId);
              const employeeSnap = await getDoc(employeeRef);
              return employeeSnap.exists() ? {
                id: employeeSnap.id,
                ...employeeSnap.data()
              } : null;
            });

          const employees = await Promise.all(employeePromises);
          teamMembers.push(...employees.filter(emp => emp !== null));
        }
      }
    } catch (error) {
      console.warn('Error fetching manager document:', error);
    }

    // Method 2: Check assignments collection
    try {
      const assignmentsQuery = query(
        collection(db, 'assignments'),
        where('managerId', '==', managerId),
        where('companyId', '==', `companies/${companyId.replace('companies/', '')}`)
      );

      const assignmentsSnap = await getDocs(assignmentsQuery);
      const assignmentPromises = assignmentsSnap.docs
        .map(doc => {
          const assignment = doc.data();
          return assignment.employeeId && !processedIds.has(assignment.employeeId) 
            ? assignment.employeeId 
            : null;
        })
        .filter(employeeId => employeeId !== null)
        .map(async (employeeId) => {
          processedIds.add(employeeId);
          const employeeRef = doc(db, 'users', employeeId);
          const employeeSnap = await getDoc(employeeRef);
          return employeeSnap.exists() ? {
            id: employeeSnap.id,
            ...employeeSnap.data()
          } : null;
        });

      const assignmentEmployees = await Promise.all(assignmentPromises);
      teamMembers.push(...assignmentEmployees.filter(emp => emp !== null));
    } catch (error) {
      console.warn('Error fetching assignments:', error);
    }

    // Method 3: Check users collection for direct manager relationships (only as fallback)
    if (teamMembers.length === 0) {
      try {
        const usersQuery = query(
          collection(db, 'users'),
          where('companyId', '==', `companies/${companyId}`),
          where('managerUserId', '==', managerId)
        );

        const usersSnap = await getDocs(usersQuery);
        usersSnap.docs.forEach(doc => {
          if (!processedIds.has(doc.id)) {
            const userData = doc.data();
            teamMembers.push({
              id: doc.id,
              ...userData
            });
          }
        });
      } catch (error) {
        console.warn('Error fetching users for manager relationships:', error);
      }
    }

    console.log(`Found ${teamMembers.length} team members for manager ${managerId}`);
    return teamMembers;
  } catch (error) {
    console.error('Error getting team members:', error);
    return [];
  }
}

/**
 * Get manager information for an employee
 * @param {string} employeeId - The employee's user ID
 * @param {string} companyId - The company ID
 * @returns {Promise<Object|null>} Manager user object or null if not found
 */
export async function getEmployeeManager(employeeId, companyId) {
  try {
    // Get employee data
    const employeeRef = doc(db, 'users', employeeId);
    const employeeSnap = await getDoc(employeeRef);

    if (!employeeSnap.exists()) {
      return null;
    }

    const employeeData = employeeSnap.data();
    const managerId = employeeData.managerUserId || employeeData.reportsTo;

    if (!managerId) {
      // Check assignments collection as fallback
      const assignmentsQuery = query(
        collection(db, 'assignments'),
        where('employeeId', '==', employeeId),
        where('companyId', '==', companyId)
      );

      const assignmentsSnap = await getDocs(assignmentsQuery);
      if (!assignmentsSnap.empty) {
        const assignment = assignmentsSnap.docs[0].data();
        const assignmentManagerId = assignment.managerId;

        if (assignmentManagerId) {
          const managerRef = doc(db, 'users', assignmentManagerId);
          const managerSnap = await getDoc(managerRef);

          if (managerSnap.exists()) {
            return {
              id: managerSnap.id,
              ...managerSnap.data()
            };
          }
        }
      }

      return null;
    }

    // Get manager data
    const managerRef = doc(db, 'users', managerId);
    const managerSnap = await getDoc(managerRef);

    if (managerSnap.exists()) {
      return {
        id: managerSnap.id,
        ...managerSnap.data()
      };
    }

    return null;
  } catch (error) {
    console.error('Error getting employee manager:', error);
    return null;
  }
}

/**
 * Get team statistics for a manager
 * @param {string} managerId - The manager's user ID
 * @param {string} companyId - The company ID
 * @returns {Promise<Object>} Team statistics object
 */
export async function getTeamStatistics(managerId, companyId) {
  try {
    const teamMembers = await getTeamMembers(managerId, companyId);

    const stats = {
      totalMembers: teamMembers.length,
      activeMembers: teamMembers.filter(member => member.status === 'active').length,
      inactiveMembers: teamMembers.filter(member => member.status !== 'active').length,
      membersByRole: {}
    };

    // Count members by role
    teamMembers.forEach(member => {
      const role = member.primaryRole || 'employee';
      stats.membersByRole[role] = (stats.membersByRole[role] || 0) + 1;
    });

    return stats;
  } catch (error) {
    console.error('Error getting team statistics:', error);
    return {
      totalMembers: 0,
      activeMembers: 0,
      inactiveMembers: 0,
      membersByRole: {}
    };
  }
}

/**
 * Check if a user has team management permissions
 * @param {string} userId - The user's ID
 * @param {string} companyId - The company ID
 * @returns {Promise<boolean>} True if user has team management permissions
 */
export async function hasTeamManagementPermissions(userId, companyId) {
  try {
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      return false;
    }

    const userData = userSnap.data();
    const role = userData.primaryRole;

    // Roles that have team management permissions
    const managerRoles = [
      'siteManager',
      'adminManager',
      'hrManager',
      'adminAdvisor',
      'hrAdvisor',
      'hrAdvisor',
      'teamManager',
      'seniorManager'
    ];

    return managerRoles.includes(role);
  } catch (error) {
    console.error('Error checking team management permissions:', error);
    return false;
  }
}

/**
 * Get all managers in a company
 * @param {string} companyId - The company ID
 * @returns {Promise<Array>} Array of manager user objects
 */
export async function getCompanyManagers(companyId) {
  try {
    const usersQuery = query(
      collection(db, 'users'),
      where('companyId', '==', `companies/${companyId}`)
    );

    const usersSnap = await getDocs(usersQuery);
    const managers = [];

    const managerRoles = [
      'siteManager',
      'adminManager',
      'hrManager',
      'adminAdvisor',
      'hrAdvisor',
      'hrAdvisor',
      'teamManager',
      'seniorManager'
    ];

    usersSnap.docs.forEach(doc => {
      const userData = doc.data();
      if (managerRoles.includes(userData.primaryRole)) {
        managers.push({
          id: doc.id,
          ...userData
        });
      }
    });

    console.log(`Found ${managers.length} managers in company ${companyId}`);
    return managers;
  } catch (error) {
    console.error('Error getting company managers:', error);
    return [];
  }
}

/**
 * Check if an approver role can approve timesheets for an employee role
 * This function maintains the existing timesheet approval hierarchy
 * @param {string} approverRole - The role of the person approving
 * @param {string} employeeRole - The role of the employee whose timesheet is being approved
 * @returns {boolean} True if the approver can approve for this employee role
 */
export function approverEmployeeRoleMatch(approverRole, employeeRole) {
  // Define the role hierarchy and approval permissions
  const roleHierarchy = {
    'superUser': ['employee', 'teamManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor', 'contractManager', 'siteManager', 'seniorManager'],
    'siteManager': ['employee', 'teamManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor', 'contractManager', 'seniorManager'],
    'seniorManager': ['employee', 'teamManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor', 'contractManager'],
    'adminManager': ['employee', 'teamManager', 'adminAdvisor'],
    'hrManager': ['employee', 'teamManager', 'hrAdvisor'],
    'adminAdvisor': ['employee'],
    'hrAdvisor': ['employee'],
    'teamManager': ['employee'],
    'contractManager': ['employee']
  };

  // Get the roles that this approver can approve for
  const canApproveFor = roleHierarchy[approverRole] || [];

  // Check if the employee role is in the list of roles this approver can approve for
  return canApproveFor.includes(employeeRole);
}