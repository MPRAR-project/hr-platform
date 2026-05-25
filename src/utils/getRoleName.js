export const getRoleName = (role) => {
    if (!role) return 'Employee';

    // Normalize role to lowercase for comparison (handles camelCase, snake_case, spaces)
    const normalizedRole = role.toLowerCase().replace(/[_\s]/g, '');

    switch (normalizedRole) {
        case 'sitemanager':
        case 'siteowner':
            return 'Site Manager';
        case 'seniormanager':
            return 'Senior Manager';
        case 'teammanager':
            return 'Team Manager';
        case 'hrmanager':
            return 'HR Manager';
        case 'adminmanager':
            return 'Admin Manager';
        case 'hradvisor':
        case 'hradviser':
            return 'HR Advisor';
        case 'adminadvisor':
        case 'adminadviser':
            return 'Admin Advisor';
        case 'contractmanager':
            return 'Contract Manager';
        case 'superuser':
        case 'superadmin':
        case 'supradmin':
            return 'Super Admin';
        case 'owner':
            return 'Owner';
        case 'employee':
            return 'Employee';
        default:
            return 'Employee';
    }
};