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

    const normalize = (r) => String(r || '').toLowerCase().replace(/[_\s-]/g, '');
    const userRoleNormalized = normalize(user.role);
    const normalizedAllowed = allowedRoles.map(normalize);

    if (allowedRoles.length > 0 && !normalizedAllowed.includes(userRoleNormalized)) {
        // Redirect to dashboard if role is not authorized
        return <Navigate to="/" replace />;
    }

    return children;
};

export default RoleGuard;
