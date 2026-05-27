import React, { useState, useEffect, useMemo } from 'react';
import { X, Save, ChevronDown, Loader2 } from 'lucide-react';
import Button from '../ui/Button';
import { getUsersByCompany } from '../../services/users';
import { useAuth } from '../../hooks/useAuth';
import { toast } from 'react-toastify';

const normalizeRoleKeyValue = (value) =>
  String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const getCanonicalRole = (value) => {
  const normalized = normalizeRoleKeyValue(value);
  switch (normalized) {
    case 'sitemanager':     return 'siteManager';
    case 'teammanager':     return 'teamManager';
    case 'seniormanager':   return 'seniorManager';
    case 'adminmanager':    return 'adminManager';
    case 'hrmanager':       return 'hrManager';
    case 'adminadvisor':    return 'adminAdvisor';
    case 'hradvisor':       return 'hrAdvisor';
    case 'contractmanager': return 'contractManager';
    case 'superuser':       return 'superUser';
    case 'owner':           return 'owner';
    default:                return 'employee';
  }
};

const getRoleLabel = (role) => {
  switch (getCanonicalRole(role)) {
    case 'siteManager':     return 'Site Manager';
    case 'teamManager':     return 'Team Manager';
    case 'seniorManager':   return 'Senior Manager';
    case 'adminManager':    return 'Admin Manager';
    case 'hrManager':       return 'HR Manager';
    case 'adminAdvisor':    return 'Admin Advisor';
    case 'hrAdvisor':       return 'HR Advisor';
    case 'contractManager': return 'Contract Manager';
    case 'superUser':       return 'Super User';
    case 'owner':           return 'Owner';
    default:                return 'Employee';
  }
};

// Roles that can be a line manager for someone
const MANAGER_ROLES = new Set([
  'siteManager', 'seniorManager', 'teamManager',
  'adminManager', 'hrManager', 'contractManager',
]);

const EditUserModal = ({ isOpen, onClose, user, onSave }) => {
  const { user: authed } = useAuth();
  const [isLoading, setIsLoading]       = useState(false);
  const [allUsers, setAllUsers]         = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const [formData, setFormData] = useState({
    name:      '',
    role:      '',
    reportsTo: '',
  });

  // Populate form whenever the user prop or allUsers changes
  useEffect(() => {
    if (user) {
      let initialReportsTo = user.reportsTo || user.managerUserId || '';

      // Defensive pre-fill fallback: if reportsTo is a centralUserId, match it to the local employee ID in allUsers
      if (initialReportsTo && allUsers.length > 0) {
        const matchingEmployee = allUsers.find(
          u => u.centralUserId === initialReportsTo || u.id === initialReportsTo || u.userId === initialReportsTo
        );
        if (matchingEmployee) {
          initialReportsTo = matchingEmployee.id || matchingEmployee.userId;
        }
      }

      setFormData({
        name:      user.displayName
                     || `${user.firstName || ''} ${user.lastName || ''}`.trim()
                     || user.name || '',
        role:      getCanonicalRole(user.primaryRole || user.hrRole || user.role),
        reportsTo: initialReportsTo,
      });
    }
  }, [user, isOpen, allUsers]);

  // Load all company users for "Reports To" dropdown
  useEffect(() => {
    if (!authed?.companyId || !isOpen) return;
    let cancelled = false;
    const load = async () => {
      setLoadingUsers(true);
      try {
        const cid = authed.companyId.replace('companies/', '');
        const employees = await getUsersByCompany(cid);
        if (!cancelled) setAllUsers(employees);
      } catch (e) {
        console.error('[EditUserModal] Failed to load users:', e);
      } finally {
        if (!cancelled) setLoadingUsers(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [authed?.companyId, isOpen]);

  // Managers = anyone whose role is in MANAGER_ROLES, excluding the user being edited
  const managerOptions = useMemo(() =>
    allUsers
      .filter(u => {
        if (u.id === user?.id || u.userId === user?.id) return false;
        const r = getCanonicalRole(u.primaryRole || u.hrRole || u.role);
        return MANAGER_ROLES.has(r);
      })
      .map(u => ({
        id:   u.id || u.userId,
        name: u.displayName || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email,
        role: getCanonicalRole(u.primaryRole || u.hrRole || u.role),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  [allUsers, user?.id]);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();

    if (!formData.name.trim()) {
      toast.error('Name is required');
      return;
    }

    setIsLoading(true);
    try {
      await onSave({
        ...formData,
        userId:    user?.id || user?.userId,
        role:      getCanonicalRole(formData.role),
        reportsTo: formData.reportsTo || null,
      });
      // onSave is responsible for closing; but close defensively here too
      onClose();
    } catch (error) {
      console.error('[EditUserModal] Save failed:', error);
      toast.error(error.message || 'Failed to save changes');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-[500px] bg-white rounded-base shadow-[0_4px_20px_rgba(0,0,0,0.1)] p-6 overflow-hidden">
        <div className="flex flex-col gap-6">

          {/* Header */}
          <div className="flex justify-between items-start">
            <div className="flex flex-col gap-1">
              <h2 className="text-xl font-semibold text-text-primary">Edit User</h2>
              <p className="text-sm text-text-secondary">{user?.email}</p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center bg-black/5 rounded-full hover:bg-black/10 transition-colors"
            >
              <X className="h-4 w-4 text-text-secondary" />
            </button>
          </div>

          {/* Form */}
          <div className="flex flex-col gap-4">

            {/* Full Name */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-text-primary">
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={e => handleChange('name', e.target.value)}
                placeholder="Enter full name"
                className="w-full h-11 px-4 border border-border-secondary rounded-lg text-sm focus:outline-none focus:border-border-accent-purple"
              />
            </div>

            {/* Role */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-text-primary">
                Role <span className="text-red-500">*</span>
              </label>
              <p className="text-xs text-text-secondary -mt-1">
                Changes role in both HR portal and Central platform
              </p>
              <div className="relative">
                <select
                  value={formData.role}
                  onChange={e => handleChange('role', e.target.value)}
                  className="w-full h-11 px-4 pr-10 border border-border-secondary rounded-lg text-sm appearance-none focus:outline-none focus:border-border-accent-purple"
                >
                  <option value="seniorManager">Senior Manager</option>
                  <option value="teamManager">Team Manager</option>
                  <option value="adminManager">Admin Manager</option>
                  <option value="hrManager">HR Manager</option>
                  <option value="adminAdvisor">Admin Advisor</option>
                  <option value="hrAdvisor">HR Advisor</option>
                  <option value="contractManager">Contract Manager</option>
                  <option value="employee">Employee</option>
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
              </div>
            </div>

            {/* Line Manager (Reports To) — shown for all roles */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-text-primary">
                Line Manager <span className="text-text-secondary font-normal">(optional)</span>
              </label>
              <div className="relative">
                <select
                  value={formData.reportsTo}
                  onChange={e => handleChange('reportsTo', e.target.value)}
                  disabled={loadingUsers}
                  className="w-full h-11 px-4 pr-10 border border-border-secondary rounded-lg text-sm appearance-none focus:outline-none focus:border-border-accent-purple disabled:opacity-50"
                >
                  <option value="">— No line manager —</option>
                  {managerOptions.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({getRoleLabel(m.role)})
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
              </div>
              {loadingUsers && (
                <p className="text-xs text-text-secondary">Loading managers…</p>
              )}
              {!loadingUsers && managerOptions.length === 0 && (
                <p className="text-xs text-orange-500">No managers found in the company yet.</p>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 mt-2">
            <Button
              onClick={onClose}
              variant="outline-secondary"
              cn="flex-1 h-11"
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              variant="gradient"
              cn="flex-1 h-11"
              disabled={isLoading}
              icon={isLoading ? Loader2 : Save}
            >
              {isLoading ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>

        </div>
      </div>
    </div>
  );
};

export default EditUserModal;
