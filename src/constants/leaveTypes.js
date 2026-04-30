// Shared leave/allowance types to ensure consistency across the application

// All leave types available in the system
export const LEAVE_TYPES = [
  { value: 'sick_leave', label: 'Sick Leave' },
  { value: 'annual_leave', label: 'Annual Leave' },
  { value: 'maternity_leave', label: 'Maternity Leave' },
  { value: 'paternity_leave', label: 'Paternity Leave' },
  { value: 'authorised_absence_unpaid', label: 'Authorised Absence (Unpaid)' },
  { value: 'authorised_absence_paid', label: 'Authorised Absence (Paid)' },
  { value: 'personal_leave', label: 'Personal Leave' }
];

// Leave types that employees can request themselves (limited)
export const EMPLOYEE_LEAVE_TYPES = [
  { value: 'annual_leave', label: 'Annual Leave' },
  { value: 'sick_leave', label: 'Sick Leave' }
];

// Leave types that admins/managers can add for employees (full list)
export const ADMIN_LEAVE_TYPES = [
  { value: 'annual_leave', label: 'Annual Leave' },
  { value: 'sick_leave', label: 'Sick Leave' },
  { value: 'maternity_leave', label: 'Maternity Leave' },
  { value: 'paternity_leave', label: 'Paternity Leave' },
  { value: 'authorised_absence_unpaid', label: 'Authorised Absence (Unpaid)' },
  { value: 'authorised_absence_paid', label: 'Authorised Absence (Paid)' }
];

// Leave types that have allowances linked to them
export const ALLOWANCE_LINKED_TYPES = [
  'annual_leave',
  'sick_leave',
  'maternity_leave',
  'paternity_leave'
];

// Default leave type - automatically created for all employees
export const DEFAULT_LEAVE_TYPE = 'sick_leave';
export const DEFAULT_ANNUAL_LEAVE_TYPE = 'annual_leave';

// Default sick leave days per year
export const DEFAULT_SICK_LEAVE_DAYS = 25;
// Default annual leave days per year
export const DEFAULT_ANNUAL_LEAVE_DAYS = 25;