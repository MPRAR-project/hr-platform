import React, { useEffect, useState } from 'react';
import { X, ArrowRight, Briefcase, Calendar, CreditCard, ChevronDown, Save } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';

import { db } from '../../firebase/client';
import { collection, getDocs, query, where } from 'firebase/firestore';

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
        const companyId = companyIdPath.split('/')[1];
        if (!companyId || !isOpen) return;
        const tq = query(collection(db, 'users'), where('companyId', '==', `companies/${companyId}`), where('primaryRole', 'in', ['teamManager']));
        const aq = query(collection(db, 'users'), where('companyId', '==', `companies/${companyId}`), where('primaryRole', 'in', ['adminManager']));
        const hq = query(collection(db, 'users'), where('companyId', '==', `companies/${companyId}`), where('primaryRole', 'in', ['hrManager']));
        const sq = query(collection(db, 'users'), where('companyId', '==', `companies/${companyId}`), where('primaryRole', 'in', ['seniorManager']));
        const [tSnap, aSnap, hSnap, sSnap] = await Promise.all([getDocs(tq), getDocs(aq), getDocs(hq), getDocs(sq)]);
        setTeamManagers(tSnap.docs.map(d => ({ id: d.id, name: d.data().displayName || d.data().email })));
        setAdmins(aSnap.docs.map(d => ({ id: d.id, name: d.data().displayName || d.data().email })));
        setHrManagers(hSnap.docs.map(d => ({ id: d.id, name: d.data().displayName || d.data().email })));
        setSeniorManagers(sSnap.docs.map(d => ({ id: d.id, name: d.data().displayName || d.data().email })));

        // Load current assignment for this employee
        try {
          const { doc, getDoc } = await import('firebase/firestore');
          const empId = employee?.id || employee?.application?.userId;
          if (empId) {
            const eSnap = await getDoc(doc(db, 'users', empId));
            const empData = eSnap.exists() ? eSnap.data() : {};
            const repId = empData.managerUserId || empData.reportsTo || '';
            if (repId) {
              const mSnap = await getDoc(doc(db, 'users', repId));
              const mName = mSnap.exists() ? (mSnap.data().displayName || mSnap.data().email || repId) : repId;
              setCurrentAssignment({ managerId: repId, managerName: mName });
            } else {
              setCurrentAssignment({ managerId: '', managerName: '' });
            }
          }
        } catch { }
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
      // Persist bi-directional assignment
      // 1) Update employee.reportsTo and manager field based on target role
      const employeeId = employee?.id || employee?.application?.userId;
      const companyIdPath = employee?.application?.companyId || employee?.companyId || '';
      const companyId = companyIdPath.split('/')[1] || '';
      if (!employeeId || !companyId) return onClose();

      // Decide which manager type to use based on employee role
      // employee -> teamManager; hrAdvisor -> hrManager; adminAdvisor -> adminManager
      let targetManagerId = '';
      if (['teamManager', 'adminManager', 'hrManager'].includes(employee?.role)) {
        targetManagerId = formData.seniorManager;
      }
      else if (employee?.role === 'employee') targetManagerId = formData.teamManager;
      else if (employee?.role === 'hrAdvisor') targetManagerId = formData.hrManager || formData.teamManager;
      else if (employee?.role === 'adminAdvisor') targetManagerId = formData.admin || formData.teamManager;
      else targetManagerId = formData.teamManager || formData.admin; // fallback

      if (!targetManagerId) return onClose();

      const { doc, updateDoc, arrayUnion, arrayRemove, collection, setDoc, serverTimestamp, getDoc } = await import('firebase/firestore');
      // Enforce single manager per user:
      // 1) Read current employee.reportsTo; if exists and different, remove from previous manager.managedEmployees
      try {
        const eRef = doc(db, 'users', employeeId);
        const eSnap = await getDoc(eRef);
        if (eSnap.exists()) {
          const prevManager = eSnap.data().reportsTo || eSnap.data().managerUserId;
          if (prevManager && prevManager !== targetManagerId) {
            try { await updateDoc(doc(db, 'users', prevManager), { managedEmployees: arrayRemove(employeeId) }); } catch { }
          }
        }
      } catch { }

      // 2) Update employee -> reportsTo and managerUserId to manager's userId
      await updateDoc(doc(db, 'users', employeeId), {
        reportsTo: targetManagerId,
        teamId: targetManagerId, // Denormalized: Team = Manager
        managerUserId: targetManagerId
      });
      // 3) Update manager -> add this employee to managedEmployees array
      try { await updateDoc(doc(db, 'users', targetManagerId), { managedEmployees: arrayUnion(employeeId) }); } catch { }

      // Create/append assignment record for auditing/reporting
      try {
        const aRef = doc(collection(db, 'assignments'));
        await setDoc(aRef, {
          employeeId,
          managerUserId: targetManagerId,
          companyId: `companies/${companyId}`,
          employeeRole: role,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      } catch { }

      onSave({ employeeId, managerUserId: targetManagerId });
      
      // 4) Sync to Central Platform Postgres
      try {
        const { syncUserToCentral } = await import('../../services/users');
        await syncUserToCentral(employeeId, companyId, {
          reportsTo: targetManagerId
        });
      } catch (syncErr) {
        console.warn('[Assign] Central sync failed:', syncErr.message);
      }

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