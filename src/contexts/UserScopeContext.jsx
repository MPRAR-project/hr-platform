// @refresh reset
import React, { createContext, useState, useContext } from 'react';

// Define a unique ID for the "Demo Scope"
export const ALL_USERS_SCOPE_ID = 'ALL_USERS_SCOPE';

// 1. Create the Context object
const UserScopeContext = createContext();

// 2. Custom hook for easy access
export const useUserScope = () => {
  const context = useContext(UserScopeContext);
  if (!context) {
    throw new Error('useUserScope must be used within a UserScopeProvider');
  }
  return context;
};

// 3. The Provider component
export const UserScopeProvider = ({ children }) => {
  // State holds the ID of the user whose data is currently displayed
  const [scopedUserId, setScopedUserId] = useState(ALL_USERS_SCOPE_ID); 
  
  // Function to update the scope
  const changeUserScope = (userId) => {
    setScopedUserId(userId);
  };

  const value = {
    scopedUserId,
    changeUserScope,
  };

  return (
    <UserScopeContext.Provider value={value}>
      {children}
    </UserScopeContext.Provider>
  );
};