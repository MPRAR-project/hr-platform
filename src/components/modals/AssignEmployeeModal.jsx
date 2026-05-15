import React, { useEffect, useState } from 'react';
import { X, ArrowRight, Briefcase, Calendar, CreditCard, ChevronDown, Save } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';

import { getUsersByCompany, getUserById, updateUserBySiteManager } from '../../services/users';

const AssignEmployeeModal = ({ isOpen, onClose, onSave, employee }) => {
  const [formData, setFormData] = useState({
    teamManager: '',
    admin: '',
    hrManager: '',
    seniorManager: ''
  });
  const [teamManagers, setTeamManagers] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [hrManagers, setHrManagers] = useState([]);
  const [seniorManagers, setSeniorManagers] = useState([]);
  const [currentAssignment, setCurrentAssignment] = useState({ managerId: '', managerName: '' });

  // Load real managers for this employee's company
  useEffect(() => {
    const load = async () => {
      try {
        const companyIdPath = employee?.companyId || employee?.application?.companyId || '';
        const companyId = companyIdPath.replace('companies/', '');
        if (!companyId || !isOpen) return;

        // Use REST API to get all users and filter by role
        const allUsers = await getUsersByCompany(companyId);
        
        setTeamManagers(allUsers.filter(u => u.primaryRole === 'teamManager').map(u => ({ id: u.id, name: u.displayName || u.email })));
        setAdmins(allUsers.filter(u => u.primaryRole === 'adminManager').map(u => ({ id: u.id, name: u.displayName || u.email })));
        setHrManagers(allUsers.filter(u => u.primaryRole === 'hrManager').map(u => ({ id: u.id, name: u.displayName || u.email })));
        setSeniorManagers(allUsers.filter(u => u.primaryRole === 'seniorManager').map(u => ({ id: u.id, name: u.displayName || u.email })));

        // Load current assignment for this employee via REST
        const empId = employee?.id || employee?.application?.userId;
        if (empId) {
          const empData = await getUserById(empId);
          const repId = empData?.managerUserId || empData?.reportsTo || '';
          if (repId) {
            const manager = await getUserById(repId);
            const mName = manager ? (manager.displayName || manager.email || repId) : repId;
            setCurrentAssignment({ managerId: repId, managerName: mName });
          } else {
            setCurrentAssignment({ managerId: '', managerName: '' });
          }
        }
      } catch (e) { console.error('Failed to load assignees', e); }
    };
    load();
  }, [isOpen, employee?.application?.companyId, employee?.companyId]);

  const role = (employee?.role || '').trim();
  const isEmployee = role === 'employee';
  const isHrAdvisor = role === 'hrAdvisor';
  const isAdminAdvisor = role === 'adminAdvisor';
  const isManagerRole = ['teamManager', 'adminManager', 'hrManager'].includes(role);

  const showTeamManager = isEmployee || (!isHrAdvisor && !isAdminAdvisor && !isManagerRole);
  const showHrManager = isHrAdvisor;
  const showAdminManager = isAdminAdvisor;
  const showSeniorManager = isManagerRole;

  const handleSave = async () => {
    try {
      const employeeId = employee?.id || employee?.application?.userId;
      const companyIdPath = employee?.application?.companyId || employee?.companyId || '';
      const companyId = companyIdPath.replace('companies/', '');
      if (!employeeId || !companyId) return onClose();

      let targetManagerId = '';
      if (['teamManager', 'adminManager', 'hrManager'].includes(employee?.role)) {
        targetManagerId = formData.seniorManager;
      }
      else if (employee?.role === 'employee') targetManagerId = formData.teamManager;
      else if (employee?.role === 'hrAdvisor') targetManagerId = formData.hrManager || formData.teamManager;
      else if (employee?.role === 'adminAdvisor') targetManagerId = formData.admin || formData.teamManager;
      else targetManagerId = formData.teamManager || formData.admin; // fallback

      if (!targetManagerId) return onClose();

      // Update via REST API
      // The backend should handle managedEmployees array sync and assignment audit records
      await updateUserBySiteManager(employeeId, {
        reportsTo: targetManagerId,
        managerUserId: targetManagerId,
        siteId: employee?.siteId || undefined
      }, companyId);

      onSave({ employeeId, managerUserId: targetManagerId });
      onClose();
    } catch (e) { console.error('Assign save failed', e); onClose(); }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]" onClick={onClose}></div>

      <div className="relative w-full max-w-[620px] bg-white rounded-[24px] shadow-[0_4px_20px_rgba(0,0,0,0.1)] p-6">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex justify-between items-start">
            <h2 className="text-2xl font-bold text-text-primary">Assigning Employees</h2>
            <button onClick={onClose} className="w-6 h-6 flex items-center justify-center bg-black/10 rounded-full hover:bg-black/20 transition-colors">
              <X className="h-4 w-4 text-text-secondary" />
            </button>
          </div>

          {/* (moved HR Manager dropdown below the employee card for consistent layout) */}

          {/* Employee Info Card */}
          <div className="bg-background-accent-purple-light border-2 border-border-accent-purple rounded-base p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <img
                  src={employee?.avatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=Emma'}
                  alt={employee?.name}
                  className="w-12 h-12 rounded-full"
                />
                <div className="flex flex-col gap-2">
                  <h3 className="text-lg font-bold text-text-primary">{employee?.name || 'Emma Taylor'}</h3>
                  <div className="flex flex-wrap items-center gap-4 text-xs">
                    <span className="flex items-center gap-1 text-orange-500">
                      <Briefcase className="h-3 w-3" />
                      {employee?.department || 'Development'}
                    </span>
                    <span className="flex items-center gap-1 text-blue-500">
                      <Calendar className="h-3 w-3" />
                      Hired: {employee?.hireDate || '2022-03-15'}
                    </span>
                    <span className="flex items-center gap-1 text-green-500">
                      <CreditCard className="h-3 w-3" />
                      Employee ID: {employee?.employeeId || 'EMP-2024-001'}
                    </span>
                  </div>
                </div>
              </div>
              <Badge variant="info">{employee?.role || 'Employee'}</Badge>
            </div>
          </div>

          {currentAssignment.managerId && (
            <div className="p-3 border border-border-secondary rounded-lg bg-bg-secondary">
              <span className="text-sm text-text-secondary">Currently assigned to:</span>
              <span className="ml-2 text-sm font-semibold text-text-primary">{currentAssignment.managerName}</span>
            </div>
          )}

          {showSeniorManager && (
            <div>
              <label className="text-md font-semibold text-text-primary mb-3 block">
                Assign Senior Manager <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <select
                  value={formData.seniorManager}
                  onChange={(e) => setFormData({ ...formData, seniorManager: e.target.value })}
                  className="w-full h-12 px-4 pr-10 border border-border-secondary rounded-lg text-md text-text-primary appearance-none focus:outline-none focus:border-border-accent-purple"
                >
                  <option value="">Select Senior Manager</option>
                  {seniorManagers.map(sm => (
                    <option key={sm.id} value={sm.id}>{sm.name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
              </div>
            </div>
          )}

          {showHrManager && (
            <div>
              <label className="text-md font-semibold text-text-primary mb-3 block">
                Assign HR Manager <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <select
                  value={formData.hrManager}
                  onChange={(e) => setFormData({ ...formData, hrManager: e.target.value })}
                  className="w-full h-12 px-4 pr-10 border border-border-secondary rounded-lg text-md text-text-primary appearance-none focus:outline-none focus:border-border-accent-purple"
                >
                  <option value="">Select HR Manager</option>
                  {hrManagers.map(hm => (
                    <option key={hm.id} value={hm.id}>{hm.name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
              </div>
            </div>
          )}

          {showTeamManager && (
            <div>
              <label className="text-md font-semibold text-text-primary mb-3 block">
                Assign Team Manager <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <select
                  value={formData.teamManager}
                  onChange={(e) => setFormData({ ...formData, teamManager: e.target.value })}
                  className="w-full h-12 px-4 pr-10 border border-border-secondary rounded-lg text-md text-text-primary appearance-none focus:outline-none focus:border-border-accent-purple"
                >
                  <option value="">Select Team Manager</option>
                  {teamManagers.map(tm => (
                    <option key={tm.id} value={tm.id}>{tm.name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
              </div>
            </div>
          )}

          {showAdminManager && (
            <div>
              <label className="text-md font-semibold text-text-primary mb-3 block">
                Assign Admin Manager <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <select
                  value={formData.admin}
                  onChange={(e) => setFormData({ ...formData, admin: e.target.value })}
                  className="w-full h-12 px-4 pr-10 border border-border-secondary rounded-lg text-md text-text-primary appearance-none focus:outline-none focus:border-border-accent-purple"
                >
                  <option value="">Select Admin Manager</option>
                  {admins.map(ad => (
                    <option key={ad.id} value={ad.id}>{ad.name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
              </div>
            </div>
          )}

          {/* Action Button */}
          <Button
            onClick={handleSave}
            variant='gradient'
            cn="w-full h-12 flex justify-center"
            icon={Save}
          >
            <span>Save</span>

          </Button>
        </div>
      </div>
    </div>
  );
};

export default AssignEmployeeModal;