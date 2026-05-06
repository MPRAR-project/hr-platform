import React, { useEffect, useState } from 'react';
import Header from '../../components/layout/Header';
import { useAuth } from '../../hooks/useAuth';
import { db } from '../../firebase/client';
import { doc, getDoc } from 'firebase/firestore';
import {
  Building2, Mail, Globe, MapPin, Phone, Calendar,
  Users, Shield, Briefcase, CheckCircle2, Clock, AlertCircle,
  ExternalLink
} from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────────────────
const cleanId = (id) => (id || '').replace(/^companies\//, '');

const fmtDate = (value) => {
  if (!value) return '—';
  try {
    const d = value?.toDate ? value.toDate() : new Date(value);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return '—'; }
};

// ── Sub-components ────────────────────────────────────────────────────────────
const InfoRow = ({ icon: Icon, label, value, href }) => (
  <div className="flex items-start gap-3 py-3 border-b border-gray-100 last:border-0">
    <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center shrink-0 mt-0.5">
      <Icon size={14} className="text-purple-600" />
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0.5">{label}</p>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer"
          className="text-sm font-semibold text-purple-600 hover:underline flex items-center gap-1 truncate">
          {value} <ExternalLink size={11} />
        </a>
      ) : (
        <p className="text-sm font-semibold text-gray-800 break-words">{value || '—'}</p>
      )}
    </div>
  </div>
);

const StatCard = ({ icon: Icon, label, value, color = 'purple' }) => {
  const colors = {
    purple: 'bg-purple-50 text-purple-600',
    green:  'bg-green-50 text-green-600',
    blue:   'bg-blue-50 text-blue-600',
    orange: 'bg-orange-50 text-orange-600',
  };
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 flex items-center gap-4 shadow-sm hover:shadow-md transition-shadow">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${colors[color]}`}>
        <Icon size={20} />
      </div>
      <div>
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{label}</p>
        <p className="text-xl font-black text-gray-800 mt-0.5 leading-none">{value}</p>
      </div>
    </div>
  );
};

const AddonBadge = ({ name, active }) => (
  <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-semibold ${
    active
      ? 'bg-green-50 border-green-100 text-green-700'
      : 'bg-gray-50 border-gray-100 text-gray-400'
  }`}>
    {active ? <CheckCircle2 size={14} className="shrink-0" /> : <Clock size={14} className="shrink-0" />}
    <span>{name}</span>
    <span className={`ml-auto text-xs font-bold ${active ? 'text-green-600' : 'text-gray-400'}`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  </div>
);

const LoadingState = () => (
  <div className="space-y-4 animate-pulse">
    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
      <div className="h-24 bg-purple-200" />
      <div className="p-5 space-y-3">
        {[1,2,3,4,5].map(i => <div key={i} className="h-9 bg-gray-100 rounded-lg" />)}
      </div>
    </div>
    <div className="grid grid-cols-2 gap-3">
      {[1,2,3,4].map(i => <div key={i} className="h-16 bg-gray-100 rounded-xl" />)}
    </div>
  </div>
);

// ── Main Page ─────────────────────────────────────────────────────────────────
const MyCompanyPage = () => {
  const { user } = useAuth();
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const companyId = cleanId(user?.companyId);

  useEffect(() => {
    if (!companyId) {
      setLoading(false);
      setError('No company assigned to your account. Please contact your site manager.');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getDoc(doc(db, 'companies', companyId))
      .then((snap) => {
        if (cancelled) return;
        if (!snap.exists()) {
          setError('Company record not found in the system.');
        } else {
          setCompany({ id: snap.id, ...snap.data() });
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load company details.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [companyId]);

  // ── Data normalisation (handles both camelCase & snake_case from Firestore) ──
  const name         = company?.name || '—';
  const status       = (company?.status || 'unknown').toLowerCase();
  const industry     = company?.industry || '—';
  const website      = company?.website || null;
  const contactEmail = company?.contactEmail || company?.contact_email || company?.ownerEmail || '—';
  const phone        = company?.phone || '—';
  const joinDate     = fmtDate(company?.createdAt || company?.created_at);
  const ownerName    = company?.ownerName || '—';
  const seatCount    = company?.seatCount  ?? company?.seat_count  ?? '—';
  const userCount    = company?.currentEmployeeCount ?? company?.user_count ?? '—';
  const weekStart    = company?.weekStartDay || company?.week_start_day || 'monday';
  const logoSrc      = company?.logo_url || company?.logoUrl || null;
  const initials     = name.trim().split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  const isActive     = status === 'active';

  // Normalise addons: could be array of {addon_key, active} OR object {hr: true, traveller: false}
  let addons = [];
  if (Array.isArray(company?.addons)) {
    addons = company.addons;
  } else if (company?.addons && typeof company.addons === 'object') {
    addons = Object.entries(company.addons).map(([k, v]) => ({
      addon_key: k,
      active: v === true || v?.active === true,
    }));
  }

  const ADDON_LABELS = {
    hr:           'HR Platform',
    traveller:    'Traveller System',
    timeworks:    'TimeWorks',
    shift_roster: 'Shift Roster',
  };

  const rawAddress = company?.address;
  const addressStr = typeof rawAddress === 'string'
    ? rawAddress
    : rawAddress?.raw || rawAddress?.line1 || null;

  return (
    <>
      <Header
        title="My Company"
        subtitle="Your company profile and platform details"
      />

      <div className="sm:px-8 px-4 py-6 max-w-3xl mx-auto space-y-5">

        {/* ── Loading ── */}
        {loading && <LoadingState />}

        {/* ── Error ── */}
        {!loading && error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-start gap-3 text-red-700">
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-sm">Could not load company details</p>
              <p className="text-sm mt-1 text-red-600">{error}</p>
            </div>
          </div>
        )}

        {/* ── Company data ── */}
        {!loading && !error && company && (
          <>
            {/* Identity Card */}
            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
              {/* Purple header with logo */}
              <div className="px-6 py-5 bg-gradient-to-br from-purple-600 via-purple-700 to-indigo-700 flex items-center gap-4">
                {logoSrc ? (
                  <img src={logoSrc} alt={name}
                    className="w-14 h-14 rounded-xl object-contain bg-white p-1 shadow-md"
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                ) : (
                  <div className="w-14 h-14 rounded-xl bg-white/20 backdrop-blur-sm border border-white/30 flex items-center justify-center text-white text-xl font-black shadow">
                    {initials}
                  </div>
                )}
                <div>
                  <h2 className="text-xl font-black text-white leading-tight">{name}</h2>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                      isActive ? 'bg-green-400/25 text-green-100' : 'bg-red-400/25 text-red-200'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-green-300' : 'bg-red-300'}`} />
                      {isActive ? 'Active' : status.charAt(0).toUpperCase() + status.slice(1)}
                    </span>
                    {industry !== '—' && (
                      <span className="text-purple-200 text-xs font-medium">{industry}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Detail rows */}
              <div className="px-6 py-1">
                <InfoRow icon={Mail}      label="Contact Email"   value={contactEmail} />
                {phone !== '—' && <InfoRow icon={Phone} label="Phone" value={phone} />}
                {website && (
                  <InfoRow icon={Globe} label="Website" value={website}
                    href={website.startsWith('http') ? website : `https://${website}`}
                  />
                )}
                {addressStr && <InfoRow icon={MapPin} label="Address" value={addressStr} />}
                <InfoRow icon={Calendar}  label="Member Since"    value={joinDate} />
                <InfoRow icon={Shield}    label="Company Owner"   value={ownerName} />
                <InfoRow icon={Clock}     label="Week Starts On"  value={weekStart.charAt(0).toUpperCase() + weekStart.slice(1)} />
              </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 gap-3">
              <StatCard icon={Users}     label="Total Employees" value={String(userCount)} color="purple" />
              <StatCard icon={Briefcase} label="Seat Limit"      value={String(seatCount)} color="blue" />
              <StatCard icon={Building2} label="Industry"        value={industry !== '—' ? industry : 'Not Set'} color="green" />
              <StatCard icon={Calendar}  label="Year Joined"
                value={joinDate !== '—' ? new Date(joinDate.replace(/(\d+)\s(\w+)\s(\d+)/, '$2 $1 $3')).getFullYear() || '—' : '—'}
                color="orange"
              />
            </div>

            {/* Platform Add-ons */}
            {addons.length > 0 && (
              <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded-xl bg-purple-50 flex items-center justify-center">
                    <Shield size={16} className="text-purple-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-gray-800">Platform Add-ons</h3>
                    <p className="text-xs text-gray-400">Modules activated for your company</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {addons.map((a) => (
                    <AddonBadge
                      key={a.addon_key}
                      name={ADDON_LABELS[a.addon_key] || a.addon_key}
                      active={a.active === true}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Company ID */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Company Reference ID</p>
              <p className="text-xs font-mono text-gray-600 break-all select-all">{company.id}</p>
              <p className="text-xs text-gray-400 mt-1">
                Quote this ID when contacting MPRAR support.
              </p>
            </div>
          </>
        )}
      </div>
    </>
  );
};

export default MyCompanyPage;
