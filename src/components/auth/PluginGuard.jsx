
import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { getCompanyPlugins } from '../../services/companyManagementService';
import Loader from '../ui/Loader';

const PluginGuard = ({ children, pluginName }) => {
    const { user, isLoading: authLoading } = useAuth();
    const [hasAccess, setHasAccess] = useState(null); // null = loading
    const [checkingPlugin, setCheckingPlugin] = useState(true);

    useEffect(() => {
        const checkAccess = async () => {
            if (!user) {
                setHasAccess(false);
                setCheckingPlugin(false);
                return;
            }

            const isSuperAdmin = ['superadmin', 'superAdmin', 'super_admin', 'superUser'].includes(user.role);

            // 1. Super Admin bypass anywhere
            if (isSuperAdmin) {
                setHasAccess(true);
                setCheckingPlugin(false);
                return;
            }

            // 2. Prioritize company context if available
            if (user.companyId) {
                try {
                    const plugins = await getCompanyPlugins(user.companyId);
                    // For 'absence', default to true if not explicitly set to false
                    const isEnabled = pluginName === 'absence'
                        ? plugins[pluginName] !== false
                        : Boolean(plugins[pluginName]);
                    setHasAccess(isEnabled);
                } catch (error) {
                    console.error('[PluginGuard] Error checking plugins:', error);
                    setHasAccess(false);
                }
                setCheckingPlugin(false);
                return;
            }

            // 3. No access otherwise
            setHasAccess(false);
            setCheckingPlugin(false);
        };

        if (!authLoading) {
            checkAccess();
        }
    }, [user, authLoading, pluginName]);

    if (authLoading || checkingPlugin) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <Loader />
            </div>
        );
    }

    if (!hasAccess) {
        return <Navigate to="/" replace />;
    }

    return children;
};

export default PluginGuard;
