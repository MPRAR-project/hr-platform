import React, { useState, useEffect } from 'react';
import { X, ArrowRight, Users, Search } from 'lucide-react';
import Button from '../ui/Button';
import { useAuth } from '../../hooks/useAuth';
import { trainingPermissionService } from '../../services/trainingPermissions';
import { getUsersByCompany } from '../../services/users';

const AssignTrainingModal = ({ isOpen, onClose, training, onAssign }) => {
  const { user } = useAuth();
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [availableUsers, setAvailableUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dueDate, setDueDate] = useState('');

  // Load available users when modal opens
  useEffect(() => {
    if (isOpen && user) {
      // Reset modal state when opening
      setSelectedUsers([]);
      setSearchQuery('');
      setDueDate('');
      loadAvailableUsers();
    }
  }, [isOpen, user]);

  const loadAvailableUsers = async () => {
    try {
      setLoadingUsers(true);
      const companyId = user.companyId.replace('companies/', '');

      // Get all users in the company via REST
      const allUsers = await getUsersByCompany(companyId);

      // Filter users based on permissions
      const accessibleUsers = await trainingPermissionService.filterUsersByPermissions(user, allUsers);

      // Exclude only the current user
      const filteredUsers = accessibleUsers.filter(userData =>
        userData.id !== user.uid
      );

      setAvailableUsers(filteredUsers);
    } catch (error) {
      console.error('Error loading users:', error);
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleUserToggle = (userId) => {
    setSelectedUsers(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const handleSelectAll = () => {
    const filteredUsers = getFilteredUsers();
    if (selectedUsers.length === filteredUsers.length) {
      setSelectedUsers([]);
    } else {
      setSelectedUsers(filteredUsers.map(u => u.id));
    }
  };

  const handleAssign = async () => {
    if (selectedUsers.length === 0) {
      alert('Please select at least one user');
      return;
    }

    if (!dueDate) {
      alert('Please set a due date');
      return;
    }

    setLoading(true);
    try {
      if (onAssign) {
        await onAssign(training.id, selectedUsers, dueDate);
      }
      onClose();
    } catch (error) {
      console.error('Error assigning training:', error);
    } finally {
      setLoading(false);
    }
  };

  const getFilteredUsers = () => {
    if (!searchQuery) return availableUsers;

    return availableUsers.filter(userData =>
      userData.displayName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      userData.firstName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      userData.lastName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      userData.email?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  };

  const getUserDisplayName = (userData) => {
    if (userData.displayName) return userData.displayName;
    if (userData.firstName || userData.lastName) {
      return `${userData.firstName || ''} ${userData.lastName || ''}`.trim();
    }
    return userData.email || 'Unknown User';
  };

  const getRoleDisplayName = (role) => {
    const roleMap = {
      'teamManager': 'Team Manager',
      'adminManager': 'Admin Manager',
      'hrManager': 'HR Manager',
      'adminAdvisor': 'Admin Advisor',
      'hrAdvisor': 'HR Advisor',
      'contractManager': 'Contract Manager',
      'employee': 'Employee'
    };
    return roleMap[role] || role;
  };

  if (!isOpen || !training) return null;

  const filteredUsers = getFilteredUsers();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]" onClick={onClose}></div>

      <div className="relative w-full max-w-[640px] bg-white rounded-[24px] shadow-[0_4px_20px_rgba(0,0,0,0.1)] p-6 max-h-[90vh] overflow-y-auto scrollbar-custom">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-xl font-bold text-text-primary">Assign Training</h2>
              <p className="text-sm text-text-secondary mt-1">
                Assign "{training.name}" to users
              </p>
            </div>
            <button onClick={onClose} className="w-6 h-6 flex items-center justify-center bg-black/10 rounded-full hover:bg-black/20 transition-colors flex-shrink-0">
              <X className="h-4 w-4 text-text-secondary" />
            </button>
          </div>

          {/* Training Info */}
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-bg-accent-purple-light rounded-lg flex items-center justify-center flex-shrink-0">
                <Users className="h-5 w-5 text-text-accent-purple" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-text-primary">{training.name}</h3>
                <p className="text-sm text-text-secondary mt-1">{training.description}</p>
                <div className="flex gap-4 mt-2 text-xs text-text-secondary">
                  <span>Category: {training.category}</span>
                  <span>Duration: {training.estimatedDuration || 60} min</span>
                  <span>Priority: {training.priority}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Due Date */}
          <div>
            <label className="text-md font-medium text-text-primary mb-3 block">
              Due Date *
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
              className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
            />
          </div>

          {/* User Selection */}
          <div>
            <div className="flex justify-between items-center mb-3">
              <label className="text-md font-medium text-text-primary">
                Select Users ({selectedUsers.length} selected)
              </label>
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={handleSelectAll}
                aria-label={selectedUsers.length === filteredUsers.length ? 'Deselect all users' : 'Select all users'}
              >
                {selectedUsers.length === filteredUsers.length ? 'Deselect All' : 'Select All'}
              </Button>
            </div>

            {/* Search */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search users..."
                className="w-full h-10 pl-10 pr-4 border border-border-secondary rounded-lg text-sm focus:outline-none focus:border-border-accent-purple"
              />
            </div>

            {/* User List */}
            <div className="border border-border-secondary rounded-lg max-h-64 overflow-y-auto">
              {loadingUsers ? (
                <div className="p-4 text-center text-text-secondary">
                  Loading users...
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="p-4 text-center text-text-secondary">
                  {searchQuery ? 'No users found matching your search' : 'No users available for assignment'}
                </div>
              ) : (
                filteredUsers.map((userData) => {
                  const checkboxId = `assign-training-user-${userData.id}`;
                  return (
                    <div
                      key={userData.id}
                      className="p-3 border-b border-border-secondary last:border-b-0 hover:bg-gray-50"
                    >
                      <label
                        htmlFor={checkboxId}
                        className="flex items-center gap-3 cursor-pointer"
                      >
                        <input
                          id={checkboxId}
                          type="checkbox"
                          checked={selectedUsers.includes(userData.id)}
                          onChange={() => handleUserToggle(userData.id)}
                          className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                        />
                        <div className="flex-1">
                          <div className="font-medium text-text-primary">
                            {getUserDisplayName(userData)}
                          </div>
                          <div className="text-sm text-text-secondary">
                            {userData.email} • {getRoleDisplayName(userData.primaryRole)}
                          </div>
                        </div>
                      </label>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-3 gap-4">
            <Button
              onClick={onClose}
              variant='outline-secondary'
              className="col-span-1 h-12"
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAssign}
              variant='gradient'
              cn="col-span-2 h-12 flex justify-center"
              icon={ArrowRight}
              disabled={loading || selectedUsers.length === 0 || !dueDate}
            >
              <span>
                {loading
                  ? 'Assigning...'
                  : `Assign to ${selectedUsers.length} user${selectedUsers.length !== 1 ? 's' : ''}`
                }
              </span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AssignTrainingModal;