import { useAuth } from './useAuth';

/**
 * Hook to check if the current user can manage/add time entries
 * Only: Admin, HR, Senior Manager, Site Manager can manage entries
 * @returns {boolean} True if user can manage time entries
 */
export const useCanManageTimeEntries = () => {
  const { user } = useAuth();

  if (!user) return false;

  // Check user role - match both role and primaryRole fields
  const userRole = (user?.role || user?.primaryRole || '').toLowerCase();
  
  console.log('DEBUG useCanManageTimeEntries:', {
    role: user?.role,
    primaryRole: user?.primaryRole,
    normalizedRole: userRole
  });
  
  // List of allowed roles (flexible matching)
  const allowedRoles = [
    'admin',
    'adminmanager',
    'adminadvisor',
    'hr',
    'hrmanager',
    'hradvisor',
    'senior manager',
    'seniormanager',
    'site manager',
    'sitemanager',
    'team manager',
    'teammanager',
    'employee'
  ];

  const canManage = allowedRoles.some(role => userRole.includes(role));
  console.log('Can manage result:', canManage);
  return canManage;
};

