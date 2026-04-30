import { useContext } from 'react';
import { AuthContext } from '../contexts/AuthContext';

/**
 * Custom hook to access the authentication context.
 * @returns {{
 * user: {role: string, name: string, email: string, avatarUrl: string},
 * switchRole: (newRole: string) => void,
 * allRoles: string[]
 * }}
 */
export const useAuth = () => {
  // 1. Consume the context
  const context = useContext(AuthContext);

  // 2. Add a safety check to ensure it's used within a provider
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  // 3. Return the context value
  return context;
};