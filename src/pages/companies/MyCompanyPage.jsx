import React, { useEffect, useState } from 'react';
import Header from '../../components/layout/Header';
import { useAuth } from '../../hooks/useAuth';
import { db } from '../../firebase/client';
import { doc, getDoc } from 'firebase/firestore';
import {
  Building2, Mail, Globe, MapPin, Phone, Calendar,
  Users, Shield, Briefcase, CheckCircle2, Clock, AlertCircle,
  ExternalLink, Lock, Edit3, Save, X, Loader2
} from 'lucide-react';
import { updateCompanyProfile } from '../../services/companyManagementService';
import { toast } from 'react-toastify';

// ── Helpers ───────────────────────────────────────────────────────────────────
const cleanId = (id) => (id || '').replace(/^companies\//, '').trim();

const fmtDate = (value) => {
  if (!value) return '—';
  try {
    const d = value?.toDate ? value.toDate() : new Date(value);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return '—'; }
};

// Roles that are considered "managers" — see more company details
const MANAGER_ROLES = ['siteManager', 'seniorManager', 'teamManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor', 'superUser', 'contractManager'];

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
        {[1,2,3,4].map(i => <div key={i} className="h-9 bg-gray-100 rounded-lg" />)}
      </div>
    </div>
    <div className="grid grid-cols-2 gap-3">
      {[1,2].map(i => <div key={i} className="h-16 bg-gray-100 rounded-xl" />)}
    </div>
  </div>
);

// ── Fetch helpers ─────────────────────────────────────────────────────────────

/**
 * 1. Try Firestore companies/{id} first (instant, no token needed)
 * 2. Fall back to Central API /companies/:id (needs central token)
 * 3. Fall back to user's own Firestore doc (basic company info embedded)
 */
async function fetchCompanyData(companyId, centralToken) {
  const errors = [];

  // Strategy 1: Firestore companies collection
  try {
    const snap = await getDoc(doc(db, 'companies', companyId));
    if (snap.exists()) {
      return { source: 'firestore', data: { id: snap.id, ...snap.data() } };
    }
  } catch (e) {
    errors.push(`Firestore: ${e.message}`);
  }

  // Strategy 2: Central API
  const centralApiUrl = import.meta.env.VITE_CENTRAL_API_URL || 'http://localhost:5000';
  const token = centralToken || localStorage.getItem('mprar_central_token');
  if (token) {
    try {
      const res = await fetch(`${centralApiUrl}/companies/${companyId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        return { source: 'central_api', data: { id: companyId, ...data } };
      }
    } catch (e) {
      errors.push(`Central API: ${e.message}`);
    }
  }

  console.warn('[MyCompanyPage] All fetch strategies failed:', errors);
  return null;
}

// ── Main Page ─────────────────────────────────────────────────────────────────
const MyCompanyPage = () => {
  const { user } = useAuth();
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const isManager = MANAGER_ROLES.includes(user?.role);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [saving, setSaving] = useState(false);

  // Try every possible source for the companyId
  const rawCompanyId =
    user?.companyId ||
    user?.primaryCompanyId ||
    user?.firebaseUser?.reloadUserInfo?.customAttributes
      ? null
      : null;

  const companyId = cleanId(rawCompanyId);

  // Also try to get companyId from Firebase token claims if not in user object
  const [resolvedCompanyId, setResolvedCompanyId] = useState(companyId);

  useEffect(() => {
    // If companyId is already resolved, skip
    if (companyId) {
      setResolvedCompanyId(companyId);
      return;
    }

    // Fallback: read companyId from Firebase ID token claims
    const tryClaimsFallback = async () => {
      try {
        const { auth: fbAuth } = await import('../../firebase/client');
        const currentUser = fbAuth.currentUser;
        if (!currentUser) return;
        const result = await currentUser.getIdTokenResult();
        const claimCompanyId = result.claims?.company_id;
        if (claimCompanyId) {
          setResolvedCompanyId(cleanId(String(claimCompanyId)));
        }
      } catch (e) {
        console.warn('[MyCompanyPage] Could not read claims:', e);
      }
    };

    tryClaimsFallback();
  }, [companyId]);

  useEffect(() => {
    if (!resolvedCompanyId) {
      setLoading(false);
      setError('No company assigned to your account. Please contact your site manager.');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchCompanyData(resolvedCompanyId, localStorage.getItem('mprar_central_token'))
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setError('Company details could not be loaded. Please try again later.');
        } else {
          setCompany(result.data);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load company details.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [resolvedCompanyId]);

  useEffect(() => {
    if (company) {
      setEditData({
        name: company.name || '',
        industry: company.industry || '',
        website: company.website || '',
        phone: company.phone || '',
        address: typeof company.address === 'string' 
          ? company.address 
          : (company.address?.raw || company.address?.line1 || ''),
        contactEmail: company.contactEmail || company.contact_email || ''
      });
    }
  }, [company]);

  const handleSave = async () => {
    if (!resolvedCompanyId) return;
    setSaving(true);
    try {
      const updated = await updateCompanyProfile(resolvedCompanyId, editData);
      setCompany(prev => ({ ...prev, ...updated }));
      setIsEditing(false);
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  // ── Data normalisation ───────────────────────────────────────────────────────
  const name         = company?.name || '—';
  const status       = (company?.status || 'active').toLowerCase();
  const industry     = company?.industry || '—';
  const website      = company?.website || null;
  const contactEmail = company?.contactEmail || company?.contact_email || '—';
  const phone        = company?.phone || '—';
  const joinDate     = fmtDate(company?.createdAt || company?.created_at);
  const ownerName    = company?.ownerName || company?.owner_name || '—';
  const seatCount    = company?.seatCount ?? company?.seat_count ?? '—';
  const userCount    = company?.currentEmployeeCount ?? company?.user_count ?? '—';
  const weekStart    = company?.weekStartDay || company?.week_start_day || 'monday';
  const logoSrc      = company?.logo_url || company?.logoUrl || null;
  const initials     = name.trim().split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  const isActive     = status === 'active';

  // Normalise addons
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
    hr: 'HR Platform', traveller: 'Traveller System',
    timeworks: 'TimeWorks', shift_roster: 'Shift Roster',
  };

  const rawAddress = company?.address;
  const addressStr = typeof rawAddress === 'string'
    ? rawAddress
    : rawAddress?.raw || rawAddress?.line1 || null;

  return (
    <>
      <Header title="My Company" subtitle="Your company profile and platform details" />

      <div className="sm:px-8 px-4 py-6 max-w-3xl mx-auto space-y-5">

        {loading && <LoadingState />}

        {!loading && error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-start gap-3 text-red-700">
            <AlertCircle size={18} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-sm">Could not load company details</p>
              <p className="text-sm mt-1 text-red-600">{error}</p>
            </div>
          </div>
        )}

        {!loading && !error && company && (
          <>
            {/* ── Identity Header Card ── */}
            <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
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
                    {industry !== '—' && !isEditing && (
                      <span className="text-purple-200 text-xs font-medium">{industry}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Detail rows */}
              <div className="px-6 py-1">
                {isEditing ? (
                  <div className="py-4 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Company Name</label>
                        <input 
                          type="text" 
                          value={editData.name} 
                          onChange={(e) => setEditData({...editData, name: e.target.value})}
                          className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Industry</label>
                        <input 
                          type="text" 
                          value={editData.industry} 
                          onChange={(e) => setEditData({...editData, industry: e.target.value})}
                          className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Website</label>
                        <input 
                          type="text" 
                          value={editData.website} 
                          onChange={(e) => setEditData({...editData, website: e.target.value})}
                          className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Phone</label>
                        <input 
                          type="text" 
                          value={editData.phone} 
                          onChange={(e) => setEditData({...editData, phone: e.target.value})}
                          className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none transition-all"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Address</label>
                      <textarea 
                        rows={2}
                        value={editData.address} 
                        onChange={(e) => setEditData({...editData, address: e.target.value})}
                        className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500 outline-none transition-all resize-none"
                      />
                    </div>
                    <div className="flex items-center gap-3 pt-2">
                      <button 
                        onClick={handleSave}
                        disabled={saving}
                        className="flex-1 bg-purple-600 text-white py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-purple-200 hover:bg-purple-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                        Save Changes
                      </button>
                      <button 
                        onClick={() => setIsEditing(false)}
                        disabled={saving}
                        className="px-4 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm font-bold hover:bg-gray-50 transition-all flex items-center gap-2"
                      >
                        <X size={16} />
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <InfoRow icon={Building2} label="Company Name"   value={name} />
                    {industry !== '—' && <InfoRow icon={Briefcase} label="Industry" value={industry} />}
                    {website && (
                      <InfoRow icon={Globe} label="Website" value={website}
                        href={website.startsWith('http') ? website : `https://${website}`}
                      />
                    )}
                    {addressStr && <InfoRow icon={MapPin} label="Address" value={addressStr} />}
                    <InfoRow icon={Clock}    label="Week Starts On"  value={weekStart.charAt(0).toUpperCase() + weekStart.slice(1)} />
                    <InfoRow icon={Calendar} label="Member Since"    value={joinDate} />

                    {/* Manager-only fields */}
                    {isManager && (
                      <>
                        <InfoRow icon={Mail}   label="Contact Email"  value={contactEmail} />
                        {phone !== '—' && <InfoRow icon={Phone} label="Phone" value={phone} />}
                        <InfoRow icon={Shield} label="Company Owner"  value={ownerName} />
                        <div className="py-4">
                           <button 
                             onClick={() => setIsEditing(true)}
                             className="flex items-center gap-2 text-sm font-bold text-purple-600 hover:text-purple-700 transition-colors"
                           >
                             <Edit3 size={14} />
                             Edit Company Profile
                           </button>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* ── Stats — managers only ── */}
            {isManager && (
              <div className="grid grid-cols-2 gap-3">
                <StatCard icon={Users}     label="Total Employees" value={String(userCount)} color="purple" />
                <StatCard icon={Briefcase} label="Seat Limit"      value={String(seatCount)} color="blue"   />
                <StatCard icon={Building2} label="Industry"        value={industry !== '—' ? industry : 'Not Set'} color="green" />
                <StatCard icon={Calendar}  label="Year Joined"
                  value={joinDate !== '—' ? (() => { try { return new Date(joinDate).getFullYear() || '—'; } catch { return '—'; } })() : '—'}
                  color="orange"
                />
              </div>
            )}

            {/* ── Platform Add-ons — managers only ── */}
            {isManager && addons.length > 0 && (
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

            {/* ── Employee privacy notice ── */}
            {!isManager && (
              <div className="bg-purple-50 border border-purple-100 rounded-xl p-4 flex items-start gap-3">
                <Lock size={16} className="text-purple-400 shrink-0 mt-0.5" />
                <p className="text-xs text-purple-600 font-medium">
                  Some company details are visible to managers only. Contact your site manager for further information.
                </p>
              </div>
            )}

            {/* ── Company reference ID — managers only ── */}
            {isManager && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Company Reference ID</p>
                <p className="text-xs font-mono text-gray-600 break-all select-all">{company.id || resolvedCompanyId}</p>
                <p className="text-xs text-gray-400 mt-1">Quote this ID when contacting MPRAR support.</p>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
};

export default MyCompanyPage;
