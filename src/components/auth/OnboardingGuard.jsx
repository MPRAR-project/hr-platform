import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { getCompanyOnboardingSettings, shouldRequireOnboarding, isRoleExemptFromOnboarding } from '../../utils/onboardingUtils';

/**
 * OnboardingGuard - Protects routes by ensuring users complete onboarding when required
 * This component prevents URL manipulation to bypass onboarding requirements
 */
const OnboardingGuard = ({ children }) => {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  const [onboardingCheck, setOnboardingCheck] = useState({
    isChecking: true,
    requiresOnboarding: false,
    error: null
  });

  useEffect(() => {
    const checkOnboardingRequirement = async () => {
      // Don't check if still loading auth or no user
      if (isLoading || !user) {
        setOnboardingCheck({ isChecking: false, requiresOnboarding: false, error: null });
        return;
      }

      if (!user.role) {
        setOnboardingCheck({ isChecking: true, requiresOnboarding: false, error: null });
        return;
      }

      // Skip onboarding check if already on onboarding page
      if (location.pathname === '/emp/onboarding') {
        setOnboardingCheck({ isChecking: false, requiresOnboarding: false, error: null });
        return;
      }

      // Skip onboarding check for exempt roles
      const userRole = user.role;
      const isExempt = isRoleExemptFromOnboarding(userRole);
      
      if (isExempt) {
        setOnboardingCheck({ isChecking: false, requiresOnboarding: false, error: null });
        return;
      }

      try {
        // NEW: Check user-specific onboarding requirement first
        const requiresOnboarding = shouldRequireOnboarding(user, null);

        setOnboardingCheck({ 
          isChecking: false, 
          requiresOnboarding, 
          error: null 
        });
      } catch (error) {
        console.error('OnboardingGuard: Error checking onboarding requirement:', error);
        
        // On error, allow access to prevent blocking users due to network issues
        // But log the error for monitoring
        setOnboardingCheck({ 
          isChecking: false, 
          requiresOnboarding: false, 
          error: error.message 
        });
      }
    };

    checkOnboardingRequirement();
  }, [user, isLoading, location.pathname]);

  // Only block on auth loading; let onboarding check run in background so app shell + page show (faster on Vercel)
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // While onboarding is checking, show app; redirect only when we know onboarding is required
  if (onboardingCheck.isChecking) {
    return children;
  }

  // Double-check: Always allow access for exempt roles, even if onboarding check failed
  if (user && isRoleExemptFromOnboarding(user.role)) {
    return children;
  }

  if (onboardingCheck.requiresOnboarding) {
    return <Navigate to="/emp/onboarding" replace />;
  }

  // Allow access to the protected route
  return children;
};

export default OnboardingGuard;