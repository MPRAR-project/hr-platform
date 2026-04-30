import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Users } from 'lucide-react';
import { useUserScope, ALL_USERS_SCOPE_ID } from '../../context/UserScopeContext'; 

/**
 * Renders a dropdown for Site Managers to switch the data scope.
 * Assumes 'users' prop is an array of { id, name, email }.
 */
const UserSwitcher = ({ switchableUsers = [], isLoading }) => {
  const { scopedUserId, changeUserScope } = useUserScope();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Find the currently selected user object for display
  const currentSelection = switchableUsers.find(u => u.id === scopedUserId) || {
    id: ALL_USERS_SCOPE_ID, 
    name: 'Loading...', 
    email: '',
  };

  // Close the dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (user) => {
    changeUserScope(user.id);
    setIsOpen(false);
  };

  if (isLoading) {
    return <div className="text-sm text-text-secondary animate-pulse">Loading Users...</div>;
  }
  
  // Create the 'All Users' option if it's not already in the list
  const allUsersOption = {
    id: ALL_USERS_SCOPE_ID,
    name: 'All Site Users (Demo)',
    email: 'View aggregate data',
  };

  const options = [
    allUsersOption,
    ...switchableUsers.filter(u => u.id !== ALL_USERS_SCOPE_ID)
  ];


  return (
    <div className="relative z-20" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 p-2 px-3 border border-border-primary rounded-base bg-background-primary hover:bg-background-secondary transition-colors"
      >
        <Users className="h-5 w-5 text-text-accent-purple" />
        <span className="text-sm font-medium text-text-primary">
          Scope: {currentSelection.name.split(' ')[0]}
        </span>
        <ChevronDown className={`h-4 w-4 text-text-secondary transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-white border border-border-primary rounded-base shadow-lg max-h-80 overflow-y-auto">
          <div className="p-2 border-b border-border-secondary">
            <p className="text-xs font-semibold text-text-secondary">Switch Data Scope</p>
          </div>
          {options.map((user) => (
            <div
              key={user.id}
              onClick={() => handleSelect(user)}
              className={`flex items-center justify-between p-3 cursor-pointer hover:bg-background-secondary ${
                user.id === scopedUserId ? 'bg-background-secondary font-semibold' : ''
              }`}
            >
              <div>
                <p className="text-sm text-text-primary">{user.name}</p>
                <p className="text-xs text-text-secondary truncate">{user.email || user.role}</p>
              </div>
              {user.id === scopedUserId && (
                <Check className="h-4 w-4 text-text-accent-purple" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default UserSwitcher;