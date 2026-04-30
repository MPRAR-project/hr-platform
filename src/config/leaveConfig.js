// src/config/leaveConfig.js

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

// Default leave type used for new requests
export const DEFAULT_LEAVE_TYPE = 'sick_leave';