import React, { useRef, useState, useEffect } from 'react';
import { User, Mail, Phone, MapPin, Search, Eye, Plus } from 'lucide-react';
import Header from '../../components/layout/Header';
import Button from '../../components/ui/Button';
import Tabs from '../../components/ui/Tabs';
import CreateAllowanceModal from '../../components/modals/CreateAllowanceModal';
import { useAuth } from '../../hooks/useAuth';
import { allowanceService } from '../../services/allowanceService';
import { automaticAllowanceService } from '../../services/automaticAllowanceService';
import { toast } from 'react-toastify';
import { useCache } from '../../contexts/CacheContext';

// Reusable Employee Card Component
const EmployeeAllowanceCard = ({ employee, onAddAllowance, onViewAllowances }) => {
  return (
    <div className=" bg-white shadow-sm border border-border-accent-purple rounded-lg p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:bg-bg-secondary transition-colors">
      <div className="flex items-center gap-4 flex-1">
        <div className="w-12 h-12 bg-bg-accent-purple-light rounded-full flex items-center justify-center flex-shrink-0">
          <User className="h-6 w-6 text-text-accent-purple" />
        </div>

        <div className="flex flex-col gap-2 min-w-0">
          <h3 className="text-lg font-semibold text-text-primary">{employee.name}</h3>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="flex items-center gap-1 text-blue-500">
              <Mail className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{employee.email}</span>
            </span>
            <span className="flex items-center gap-1 text-orange-500">
              <Phone className="h-3 w-3 flex-shrink-0" />
              {employee.phone}
            </span>
            <span className="flex items-center gap-1 text-green-500">
              <MapPin className="h-3 w-3 flex-shrink-0" />
              {employee.location}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline-primary"
          onClick={() => onViewAllowances(employee)}
          icon={Eye}
          iconFirst={true}
        >
          View Allowances
        </Button>
        <Button
          variant="outline-primary"
          onClick={() => onAddAllowance(employee)}
          icon={Plus}
          iconFirst={true}
        >
          Add Allowance
        </Button>
      </div>
    </div>
  );
};

// Main Pending Allowance Page
const TAB_ALL = 'All Employees';
const TAB_PENDING = 'Pending Users';

const PendingAllowancePage = () => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [modalMode, setModalMode] = useState('add'); // 'add' or 'view'
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [selectedEmployeeAllowances, setSelectedEmployeeAllowances] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState(TAB_PENDING);
  const [pendingEmployeeIds, setPendingEmployeeIds] = useState(new Set());
  const [allowancesLoaded, setAllowancesLoaded] = useState(false);
  const [allowanceRefreshKey, setAllowanceRefreshKey] = useState(0);
  const [isFetchingAllowances, setIsFetchingAllowances] = useState(false);
  const { user } = useAuth();
  const { getItem, setItem } = useCache();
  const unsubRef = useRef(null);
  const unsubscribeAllowancesRef = useRef(null);

  // Load employees and ensure automatic sick leave allowances exist
  useEffect(() => {
    if (user) {
      loadEmployeesAndEnsureAllowances();
    }
    return () => {
      if (typeof unsubRef.current === 'function') {
        unsubRef.current();
        unsubRef.current = null;
      }
      if (typeof unsubscribeAllowancesRef.current === 'function') {
        unsubscribeAllowancesRef.current();
        unsubscribeAllowancesRef.current = null;
      }
    };
  }, [user]);

  const loadEmployeesAndEnsureAllowances = async () => {
    if (!user) return;

    const companyId = user.companyId;
    const cacheKey = `allowance_employees_${companyId}`;
    const ensuredKey = `allowance_company_ensured_${companyId}_${new Date().toDateString()}`;

    // Fast paint from cache
    try {
      const cached = getItem?.(cacheKey);
      if (Array.isArray(cached) && cached.length > 0) {
        setEmployees(cached);
        setLoading(false);
      } else {
        setLoading(true);
      }
    } catch (_) {
      setLoading(true);
    }

    setError(null);

    try {
      // Real-time subscription for company-wide roles (fast, keeps list live)
      if ((user?.role || user?.primaryRole) !== 'teamManager') {
        if (typeof unsubRef.current === 'function') {
          unsubRef.current();
          unsubRef.current = null;
        }

        unsubRef.current = allowanceService.subscribeEmployeesForAllowances(
          user,
          (liveEmployees) => {
            if (Array.isArray(liveEmployees) && liveEmployees.length > 0) {
              setEmployees(liveEmployees);
              setItem?.(cacheKey, liveEmployees, 10 * 60 * 1000);
              setLoading(false);
            }
          },
          (err) => {
            console.warn('Employees subscription failed:', err);
          }
        );
      }

      // Always do a one-time fetch as a fallback (also covers teamManager)
      const employeeData = await allowanceService.getEmployeesForAllowances(user);
      setEmployees(employeeData || []);
      setItem?.(cacheKey, employeeData || [], 10 * 60 * 1000);
      setLoading(false);

      // Ensure sick leave allowances in background (once per day), do not block UI
      if (companyId && !getItem?.(ensuredKey)) {
        setItem?.(ensuredKey, true, 24 * 60 * 60 * 1000);
        automaticAllowanceService.ensureCompanySickLeaveAllowances(companyId, user).catch(() => null);
      }
    } catch (err) {
      console.error('Error loading employees:', err);
      setError(err.message);
      toast.error('Failed to load employees');
    } finally {
      setLoading(false);
    }
  };

  const loadEmployees = async () => {
    if (!user) return;

    setLoading(true);
    setError(null);

    try {
      const employeeData = await allowanceService.getEmployeesForAllowances(user);
      setEmployees(employeeData);
    } catch (err) {
      console.error('Error loading employees:', err);
      setError(err.message);
      toast.error('Failed to load employees');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    return () => {
      if (typeof unsubRef.current === 'function') {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, []);

  const handleAddAllowance = async (employee) => {
    setSelectedEmployee(employee);
    setModalMode('add');
    setSelectedEmployeeAllowances([]);
    setShowCreateModal(true);
    setIsFetchingAllowances(true);

    if (!user) {
      setIsFetchingAllowances(false);
      return;
    }

    try {
      const currentYear = new Date().getFullYear();
      const existing = await allowanceService.getEmployeeAllowances(employee.id, user, currentYear);
      setSelectedEmployeeAllowances(existing || []);
    } catch (err) {
      console.error('Error loading existing allowances for employee:', err);
      setSelectedEmployeeAllowances([]);
    } finally {
      setIsFetchingAllowances(false);
    }
  };

  const handleViewAllowances = async (employee) => {
    setSelectedEmployee(employee);
    setModalMode('view');
    setSelectedEmployeeAllowances([]);
    setShowCreateModal(true);
    setIsFetchingAllowances(true);

    if (!user) {
      setIsFetchingAllowances(false);
      return;
    }

    try {
      const currentYear = new Date().getFullYear();
      const existing = await allowanceService.getEmployeeAllowances(employee.id, user, currentYear);
      setSelectedEmployeeAllowances(existing || []);
    } catch (err) {
      console.error('Error loading existing allowances for employee:', err);
      setSelectedEmployeeAllowances([]);
    } finally {
      setIsFetchingAllowances(false);
    }
  };

  const handleSaveAllowance = async (newAllowances = [], updatedAllowances = []) => {
    try {
      if (!user || !selectedEmployee) return;

      // First update existing allowances
      for (const allowance of updatedAllowances) {
        const totalDays = parseInt(allowance.totalDays, 10) || 0;
        const usedDays = Number(allowance.usedDays) || 0;
        const remainingDays = Math.max(0, totalDays - usedDays);

        const auditEntry = {
          action: 'Manual Adjustment',
          details: 'Updated via Employee Allowance Management page',
          date: new Date().toISOString(),
          performedBy: user.userId || user.uid,
          performedByName: user.displayName || user.email || 'Unknown',
          performedByRole: user.role || 'Unknown'
        };

        await allowanceService.updateAllowance(
          allowance.allowanceId,
          {
            totalDays,
            remainingDays,
            validFrom: allowance.validFrom || null,
            validUntil: allowance.validUntil || null,
            auditEntry
          },
          user
        );
      }

      // Then create any brand new allowances
      if (Array.isArray(newAllowances) && newAllowances.length > 0) {
        await allowanceService.createAllowances(selectedEmployee.id, newAllowances, user);
      }

      toast.success('Allowances saved successfully!');
      setShowCreateModal(false);
      setSelectedEmployee(null);
      setSelectedEmployeeAllowances([]);
      setAllowanceRefreshKey(prev => prev + 1); // Re-check pending status
    } catch (err) {
      console.error('Error saving allowances:', err);
      toast.error('Failed to save allowances');
    }
  };

  const handleDeleteAllowance = async (allowanceId, allowanceType) => {
    try {
      if (!user) return;
      await allowanceService.deleteAllowance(allowanceId, user);
      // Remove from local selected allowances so dropdown updates
      setSelectedEmployeeAllowances(prev => prev.filter(a => a.id !== allowanceId));
      setAllowanceRefreshKey(prev => prev + 1);
      toast.success(`${allowanceType || 'Allowance'} deleted successfully`);
    } catch (err) {
      console.error('Error deleting allowance:', err);
      toast.error('Failed to delete allowance');
    }
  };

  // Fetch all active allowances for the company to determine pending employees
  useEffect(() => {
    if (!user?.companyId || employees.length === 0) return;

    const fetchCompanyAllowances = async () => {
      try {
        const { collection: firestoreCollection, query: firestoreQuery, where, getDocs } = await import('firebase/firestore');
        const { db } = await import('../../firebase/client');
        const currentYear = new Date().getFullYear();

        if (unsubscribeAllowancesRef.current) {
          unsubscribeAllowancesRef.current();
        }

        unsubscribeAllowancesRef.current = allowanceService.subscribeToCompanyAllowances(
          user.companyId,
          user,
          currentYear,
          (allowancesData) => {
            // Build a map: employeeId -> Set of normalized leave types
            const employeeAllowanceMap = new Map();
            allowancesData.forEach((data) => {
              const empId = data.employeeId;
              if (!employeeAllowanceMap.has(empId)) {
                employeeAllowanceMap.set(empId, new Set());
              }
              const normalized = allowanceService.normalizeLeaveType(data.leaveType);
              employeeAllowanceMap.get(empId).add(normalized);
            });

            // Determine pending: employees with NO allowances, or ONLY sick leave
            const pending = new Set();
            const sickLeaveNormalized = allowanceService.normalizeLeaveType('sick_leave');

            employees.forEach((emp) => {
              const role = (emp?.primaryRole || emp?.role || '').toString().toLowerCase();
              if (role === 'sitemanager') return; // skip site managers

              const types = employeeAllowanceMap.get(emp.id);
              if (!types || types.size === 0) {
                // No allowances at all
                pending.add(emp.id);
              } else {
                // Check if they ONLY have sick leave
                const nonSickTypes = [...types].filter(t => t !== sickLeaveNormalized);
                if (nonSickTypes.length === 0) {
                  pending.add(emp.id);
                }
              }
            });

            setPendingEmployeeIds(pending);
            setAllowancesLoaded(true);
          },
          (err) => {
            console.error('Error in company allowances subscription:', err);
            setAllowancesLoaded(true);
          }
        );
      } catch (err) {
        console.error('Error fetching company allowances for pending check:', err);
        setAllowancesLoaded(true);
      }
    };

    fetchCompanyAllowances();
  }, [user?.companyId, employees, allowanceRefreshKey]);

  // Filter employees based on search query and active tab
  const filteredEmployees = employees.filter(employee => {
    const role =
      (employee?.primaryRole || employee?.role || '').toString().toLowerCase();
    if (role === 'sitemanager') return false;

    // Tab filter
    if (activeTab === TAB_PENDING && !pendingEmployeeIds.has(employee.id)) {
      return false;
    }

    if (!searchQuery) return true;

    const query = searchQuery.toLowerCase();
    return (
      employee.name?.toLowerCase().includes(query) ||
      employee.email?.toLowerCase().includes(query) ||
      employee.department?.toLowerCase().includes(query) ||
      employee.role?.toLowerCase().includes(query)
    );
  });

  // Count for tab labels
  const allCount = employees.filter(e => {
    const r = (e?.primaryRole || e?.role || '').toString().toLowerCase();
    return r !== 'sitemanager';
  }).length;
  const pendingCount = pendingEmployeeIds.size;

  const tabs = [
    { label: TAB_PENDING, count: pendingCount },
    { label: TAB_ALL, count: allCount }
  ];

  const pretty = (role) =>
    role.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Header
        title={`${pretty(user.role)} Dashboard`}
        subtitle="Grow your digital workplace and manage your team seamlessly"
      />

      <div className="flex-1 overflow-y-auto p-4 md:p-3xl scrollbar-custom">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
            <div>
              <h2 className="text-2xl font-bold text-text-primary">Employee Allowance Management</h2>
              <p className="text-sm text-text-secondary mt-1">Manage leave allowances for your team members</p>
            </div>

            {/* Search Bar */}
            <div className="relative w-full sm:w-96">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-text-secondary" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search employees..."
                className="w-full h-12 pl-12 pr-4 border border-border-secondary rounded-full text-sm placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
              />
            </div>
          </div>

          {/* Tabs */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <Tabs
              tabs={tabs.map(t => ({ label: t.label }))}
              activeTab={activeTab}
              onTabChange={setActiveTab}
            />
            {allowancesLoaded && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-secondary">
                  Showing <strong className="text-text-primary">{filteredEmployees.length}</strong> of {allCount} employees
                </span>
                {activeTab === TAB_PENDING && pendingCount > 0 && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
                    {pendingCount} pending
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Loading State */}
          {loading && (
            <div className="bg-white shadow-md rounded-base p-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500 mx-auto mb-4"></div>
              <p className="text-text-secondary">Loading employees...</p>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-base p-4">
              <p className="text-red-600">Error: {error}</p>
              <button
                onClick={loadEmployees}
                className="mt-2 text-red-700 underline hover:no-underline"
              >
                Try again
              </button>
            </div>
          )}

          {/* Employees List */}
          {!loading && !error && (
            <div className="space-y-4">
              {filteredEmployees.length === 0 ? (
                <div className="bg-white shadow-md rounded-base p-8 text-center">
                  <User className="h-12 w-12 text-text-secondary mx-auto mb-4" />
                  <p className="text-text-secondary">
                    {employees.length === 0
                      ? "No employees found. You may not have permission to manage allowances or there are no employees in your scope."
                      : activeTab === TAB_PENDING
                      ? "All employees have been assigned allowances. No pending users!"
                      : "No employees match your search criteria."
                    }
                  </p>
                </div>
              ) : (
                filteredEmployees.map((employee) => (
                  <EmployeeAllowanceCard
                    key={employee.id}
                    employee={employee}
                    onAddAllowance={handleAddAllowance}
                    onViewAllowances={handleViewAllowances}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Create Allowance Modal */}
      <CreateAllowanceModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSave={handleSaveAllowance}
        onDelete={handleDeleteAllowance}
        employee={selectedEmployee}
        existingAllowances={selectedEmployeeAllowances}
        mode={modalMode}
        isFetchingData={isFetchingAllowances}
      />
    </div>
  );
};

export default PendingAllowancePage;