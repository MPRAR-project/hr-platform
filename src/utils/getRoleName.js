export const getRoleName = (role) => {
    if (!role) return 'Employee';

    // Normalize role to lowercase for comparison
    const normalizedRole = role.toLowerCase();

    switch (normalizedRole) {
        case 'teammanager':
            return 'Team Manager';
        case 'employee':
            return 'Employee';
        case 'sitemanager':
            return 'Site Manager';
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
        case 'seniormanager':
            return 'Senior Manager';
        default:
            return 'Employee';
    }
}