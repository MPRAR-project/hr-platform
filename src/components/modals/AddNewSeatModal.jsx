import React, { useEffect, useState } from 'react';
import { X, Plus, ArrowRight, ChevronDown, Loader2 } from 'lucide-react';
import Button from '../ui/Button';
import { useAuth } from '../../hooks/useAuth';
import { getUsersByCompany } from '../../services/users';
import { toast } from 'react-toastify';

const pricePerSeat = 5.0;

const managerRoles = ['teamManager', 'adminManager', 'hrManager'];

const AddNewSeatModal = ({ isOpen, onClose, onSubmit }) => {
  const { user: authed } = useAuth();
  const [users, setUsers] = useState([
    {
      id: 1,
      fullName: '',
      email: '',
      role: 'employee',
      reportsTo: '',
      isOnboardingMandatory: false
    }
  ]);
  const [managerOptions, setManagerOptions] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const loadManagers = async () => {
      try {
        if (!authed?.companyId) return;
        
        // Use REST API
        const allUsers = await getUsersByCompany(authed.companyId);
        
        const opts = allUsers
          .filter((u) => managerRoles.includes(u.primaryRole))
          .map((u) => ({
            id: u.id,
            name: u.displayName || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email,
            role: u.primaryRole
          }));
        setManagerOptions(opts);
      } catch (error) {
        console.error('Failed to load managers', error);
      }
    };
    loadManagers();
  }, [authed?.companyId]);

  const isManagerRole = (role) => managerRoles.includes(role);

  const handleAddMore = () => {
    setUsers([
      ...users,
      {
        id: users.length + 1,
        fullName: '',
        email: '',
        role: 'employee',
        reportsTo: '',
        isOnboardingMandatory: false
      }
    ]);
  };

  const handleUserChange = (id, field, value) => {
    setUsers((prev) =>
      prev.map((user) => {
        if (user.id !== id) return user;
        const updated = { ...user, [field]: value };
        if (field === 'role' && isManagerRole(value)) {
          updated.reportsTo = '';
        }
        return updated;
      })
    );
  };

  const shouldShowReportsTo = (role) => !isManagerRole(role);

  const handleSubmit = async () => {
    if (isSubmitting) return;
    try {
      for (const u of users) {
        if (!u.fullName?.trim() || !u.email?.trim()) {
          toast.error('Full name and email are required for all users');
          return;
        }
      }
      setIsSubmitting(true);
      await onSubmit(users);
    } catch (error) {
      console.error('Failed to stage users:', error);
      toast.error(error?.message || 'Failed to add seats');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]" onClick={onClose}></div>

      <div className="relative w-full max-h-[90vh] max-w-[520px] bg-white rounded-[24px] shadow-[0_4px_20px_rgba(0,0,0,0.1)] p-6 overflow-y-auto modal-scroll">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex justify-between items-start gap-5">
            <div>
              <h2 className="text-xl font-semibold text-text-primary">Add New Seat</h2>
              <p className="text-[13px] text-text-secondary mt-1">
                Enter details for each new user. You'll be charged immediately for each seat.
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-6 h-6 flex items-center justify-center bg-black/10 rounded-full hover:bg-black/20 transition-colors"
            >
              <X className="h-4 w-4 text-text-secondary" />
            </button>
          </div>

          {/* Users Form */}
          {users.map((user, index) => (
            <div key={user.id} className="flex flex-col gap-6 border border-border-secondary/50 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-text-primary">User {index + 1}</h3>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div className="flex flex-col gap-2">
                  <label className="text-sm text-text-primary">
                    Full name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={user.fullName}
                    onChange={(e) => handleUserChange(user.id, 'fullName', e.target.value)}
                    placeholder="John Thomas"
                    className="h-12 px-4 border border-border-secondary rounded-lg text-sm placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm text-text-primary">
                    Email <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="email"
                    value={user.email}
                    onChange={(e) => handleUserChange(user.id, 'email', e.target.value)}
                    placeholder="john@email.com"
                    className="h-12 px-4 border border-border-secondary rounded-lg text-sm placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
                  />
                </div>
              </div>

              <div className={`grid gap-4 ${shouldShowReportsTo(user.role) ? 'grid-cols-2' : 'grid-cols-1'}`}>
                <div className="flex flex-col gap-2">
                  <label className="text-sm text-text-primary">
                    Role <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <select
                      value={user.role}
                      onChange={(e) => handleUserChange(user.id, 'role', e.target.value)}
                      className="w-full h-12 px-4 pr-10 border border-border-secondary rounded-lg text-sm appearance-none focus:outline-none focus:border-border-accent-purple"
                    >
                      <option value="teamManager">Team Manager</option>
                      <option value="adminManager">Admin Manager</option>
                      <option value="hrManager">HR Manager</option>
                      <option value="employee">Employee</option>
                      <option value="adminAdvisor">Admin Advisor</option>
                      <option value="hrAdvisor">HR Advisor</option>
                      <option value="contractManager">Contract Manager</option>
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
                  </div>
                </div>

                {shouldShowReportsTo(user.role) && (
                  <div className="flex flex-col gap-2">
                    <label className="text-sm text-text-primary">
                      {/* Reports To (optional) */}
                      Line Manage (optional)
                    </label>
                    <div className="relative">
                      <select
                        value={user.reportsTo}
                        onChange={(e) => handleUserChange(user.id, 'reportsTo', e.target.value)}
                        className="w-full h-12 px-4 pr-10 border border-border-secondary rounded-lg text-sm appearance-none focus:outline-none focus:border-border-accent-purple"
                      >
                        <option value="">Select Manager</option>
                        {managerOptions.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({m.role})
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
                    </div>
                    {managerOptions.length === 0 && (
                      <p className="text-xs text-orange-600">No managers available for this role.</p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={user.isOnboardingMandatory}
                  onChange={(e) => handleUserChange(user.id, 'isOnboardingMandatory', e.target.checked)}
                  className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-2 focus:ring-purple-200"
                />
                <span className="text-sm text-gray-700">Onboarding mandatory for this user</span>
              </div>
            </div>
          ))}

          <Button
            onClick={handleAddMore}
            variant="outline-primary"
            cn="w-full h-12 flex justify-center items-center mt-2"
            icon={Plus}
            iconFirst={true}
            disabled={isSubmitting}
          >
            <span className="text-sm">Add More</span>
          </Button>

          {/* Immediate Charge Info */}
          <div className="bg-background-accent-purple-light border border-border-accent-purple rounded-lg p-4">
            <div className="flex justify-between items-center">
              <span className="text-sm text-text-accent-purple">Immediate charge:</span>
              <span className="text-xl font-bold text-text-primary">
                £{(users.length * pricePerSeat).toFixed(2)}
              </span>
            </div>
            <p className="text-xs text-text-accent-purple mt-2">
              These seats will be added to your monthly billing immediately
            </p>
          </div>

          {/* Actions */}
          <div className="grid sm:grid-cols-3 grid-cols-1 gap-4">
            <Button onClick={onClose} variant="outline-secondary" className="col-span-1 h-12" disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              variant="gradient"
              cn="col-span-2 h-12 flex justify-center"
              icon={ArrowRight}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Processing...
                </span>
              ) : (
                `Add ${users.length} seat${users.length > 1 ? 's' : ''}`
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddNewSeatModal;