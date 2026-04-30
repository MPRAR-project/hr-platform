// Test script to verify department filter functionality
// This can be run in the browser console to test the department filter

console.log('Testing department filter functionality...');

// Test the department filter logic
const testDepartmentFilter = () => {
  console.log('Testing department filter logic...');
  
  // Mock employee data
  const mockEmployeeData = [
    {
      userId: '1',
      userInfo: {
        displayName: 'John Doe',
        email: 'john@company.com',
        department: 'Development',
        primaryRole: 'employee'
      },
      stats: { total: 5, approved: 3, pendingUpload: 1, pendingApproval: 1, declined: 0 }
    },
    {
      userId: '2',
      userInfo: {
        displayName: 'Jane Smith',
        email: 'jane@company.com',
        department: 'HR',
        primaryRole: 'employee'
      },
      stats: { total: 3, approved: 2, pendingUpload: 0, pendingApproval: 1, declined: 0 }
    },
    {
      userId: '3',
      userInfo: {
        displayName: 'Bob Johnson',
        email: 'bob@company.com',
        department: 'Finance',
        primaryRole: 'employee'
      },
      stats: { total: 4, approved: 4, pendingUpload: 0, pendingApproval: 0, declined: 0 }
    },
    {
      userId: '4',
      userInfo: {
        displayName: 'Alice Brown',
        email: 'alice@company.com',
        department: 'Development',
        primaryRole: 'teamManager'
      },
      stats: { total: 6, approved: 5, pendingUpload: 1, pendingApproval: 0, declined: 0 }
    }
  ];
  
  // Mock current user
  const mockUser = { uid: 'current-user', role: 'adminManager' };
  
  // Test filter function (simulating the fixed logic)
  const filterEmployees = (employees, filterDepartment, searchQuery, currentUser) => {
    return employees.filter(employee => {
      const role = (employee?.userInfo?.primaryRole || '').toLowerCase();
      if (role === 'sitemanager' || employee.userId === currentUser.uid) {
        return false;
      }
      
      // Department filter
      if (filterDepartment !== 'All Departments') {
        const employeeDepartment = employee.userInfo.department || 'Development';
        if (employeeDepartment !== filterDepartment) {
          return false;
        }
      }
      
      // Search filter
      if (searchQuery) {
        const displayNameMatch = employee.userInfo.displayName?.toLowerCase().includes(searchQuery.toLowerCase());
        const emailMatch = employee.userInfo.email?.toLowerCase().includes(searchQuery.toLowerCase());
        if (!displayNameMatch && !emailMatch) {
          return false;
        }
      }
      return true;
    });
  };
  
  // Test cases
  console.log('All employees:', filterEmployees(mockEmployeeData, 'All Departments', '', mockUser));
  console.log('Development only:', filterEmployees(mockEmployeeData, 'Development', '', mockUser));
  console.log('HR only:', filterEmployees(mockEmployeeData, 'HR', '', mockUser));
  console.log('Finance only:', filterEmployees(mockEmployeeData, 'Finance', '', mockUser));
  console.log('Search "John":', filterEmployees(mockEmployeeData, 'All Departments', 'John', mockUser));
  console.log('Development + Search "Alice":', filterEmployees(mockEmployeeData, 'Development', 'Alice', mockUser));
};

// Test department extraction
const testDepartmentExtraction = () => {
  console.log('Testing department extraction...');
  
  const mockEmployeeData = [
    { userInfo: { department: 'Development' } },
    { userInfo: { department: 'HR' } },
    { userInfo: { department: 'Finance' } },
    { userInfo: { department: 'Development' } }, // Duplicate
    { userInfo: { } }, // Missing department (should default to 'Development')
  ];
  
  const getAvailableDepartments = (employees) => {
    const departments = new Set();
    employees.forEach(employee => {
      const dept = employee.userInfo.department || 'Development';
      departments.add(dept);
    });
    return Array.from(departments).sort();
  };
  
  const availableDepartments = getAvailableDepartments(mockEmployeeData);
  console.log('Available departments:', availableDepartments);
  // Expected: ['Development', 'Finance', 'HR']
};

// Run tests
testDepartmentFilter();
testDepartmentExtraction();

console.log('Department filter tests completed!');
