import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { getCompanyPlugins } from '../../services/companyManagementService';
import { ShieldOff } from 'lucide-react';
import Loader from '../ui/Loader';

// Per-company cache; entries bust after 60s
const _cache = new Map();

function fetchPlugins(companyId) {
  const hit = _cache.get(companyId);
  if (hit) return hit;

  const promise = getCompanyPlugins(companyId)
    .then(plugins => {
      setTimeout(() => _cache.delete(companyId), 60000);
      return plugins;
    })
    .catch(() => {
      _cache.delete(companyId);
      return {};
    });

  _cache.set(companyId, promise);
  return promise;
}

const PluginGuard = ({ children, pluginName }) => {
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const [status, setStatus] = useState('loading'); // 'loading' | 'allowed' | 'denied'

  useEffect(() => {
    if (authLoading) return;

    if (!user) { setStatus('denied'); return; }

    const isSuperAdmin = ['superadmin', 'superAdmin', 'super_admin', 'superUser'].includes(user.role);
    if (isSuperAdmin) { setStatus('allowed'); return; }

    if (!user.companyId) { setStatus('denied'); return; }

    fetchPlugins(user.companyId).then(plugins => {
      const allowed = pluginName === 'absence'
        ? plugins[pluginName] !== false
        : Boolean(plugins[pluginName]);
      setStatus(allowed ? 'allowed' : 'denied');
    });
  }, [user, authLoading, pluginName]);

  if (authLoading || status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader />
      </div>
    );
  }

  if (status === 'denied') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
          <ShieldOff className="w-8 h-8 text-gray-400" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Feature Not Enabled</h2>
        <p className="text-gray-500 max-w-sm mb-6">
          This feature is not included in your current plan. Contact your administrator to enable it.
        </p>
        <button
          onClick={() => navigate('/', { replace: true })}
          className="px-5 py-2.5 text-sm font-semibold rounded-xl text-white"
          style={{ background: '#7718A8' }}
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  return children;
};

export default PluginGuard;
