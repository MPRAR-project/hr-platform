import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import Loader from '../ui/Loader';

const RoleGuard = ({ children, allowedRoles = [] }) => {
    const { user, isLoading } = useAuth();

    if (isLoading) {
        return <Loader fullScreen />;
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
        // Redirect to dashboard if role is not authorized
        return <Navigate to="/" replace />;
    }

    return children;
};

export default RoleGuard;
