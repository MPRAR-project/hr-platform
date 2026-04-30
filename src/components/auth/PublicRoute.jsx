import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

/**
 * PublicRoute - Allows access to public routes (login, signup) and redirects authenticated users
 */
const PublicRoute = ({ children }) => {
  const { user, isLoading } = useAuth();

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  // If user is authenticated, redirect to dashboard
  // The dashboard will handle onboarding redirects if needed
  if (user) {
    return <Navigate to="/" replace />;
  }

  // Allow access to public route
  return children;
};

export default PublicRoute;