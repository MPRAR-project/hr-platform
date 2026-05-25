import React, { useEffect, useState, useCallback } from 'react';
import Header from '../../components/layout/Header';
import { useAuth } from '../../hooks/useAuth';
import {
  Building2, Mail, Globe, MapPin, Phone, Calendar,
  Users, Shield, Briefcase, CheckCircle2, Clock, AlertCircle,
  ExternalLink, Lock, Edit3, Save, X, Loader2
} from 'lucide-react';
import { getCompany, updateCompanyProfile } from '../../services/companyManagementService';
import { toast } from 'react-toastify';
import wsClient from '../../lib/wsClient';

// ── Helpers ───────────────────────────────────────────────────────────────────
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

const BRAND = '#7718A8';

// ── Sub-components ────────────────────────────────────────────────────────────
const InfoRow = ({ icon: Icon, label, value, href }) => (
  <div className="flex items-start gap-3 py-3 border-b border-gray-100 last:border-0">
    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: '#F4EDFB' }}>
      <Icon size={14} style={{ color: BRAND }} />
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-[11px] font-bold text-[#667085] uppercase tracking-wider mb-0.5">{label}</p>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer"
          className="text-[13px] font-semibold hover:underline flex items-center gap-1 truncate" style={{ color: BRAND }}>
          {value} <ExternalLink size={11} />
        </a>
      ) : (
        <p className="text-[13px] font-semibold text-[#101828] break-words">{value || '—'}</p>
      )}
    </div>
  </div>
);

const StatCard = ({ icon: Icon, label, value, color = 'purple' }) => {
  const colors = {
    purple: { bg: '#F4EDFB', fg: BRAND },
    green:  { bg: '#ECFDF3', fg: '#027A48' },
    blue:   { bg: '#EFF8FF', fg: '#175CD3' },
    orange: { bg: '#FFF6ED', fg: '#B93815' },
  };
  const c = colors[color] || colors.purple;
  return (
    <div className="bg-white border border-[#EAECF0] rounded-2xl p-4 flex items-center gap-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: c.bg }}>
        <Icon size={18} style={{ color: c.fg }} />
      </div>
      <div>
        <p className="text-[11px] font-bold text-[#667085] uppercase tracking-wider">{label}</p>
        <p className="text-xl font-black text-[#101828] mt-0.5 leading-none">{value}</p>
      </div>
    </div>
  );
};

const AddonBadge = ({ name, active }) => (
  <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-[13px] font-semibold ${
    active
      ? 'bg-[#ECFDF3] border-[#ABEFC6] text-[#027A48]'
      : 'bg-[#F9FAFB] border-[#EAECF0] text-[#98A2B3]'
  }`}>
    {active ? <CheckCircle2 size={14} className="shrink-0" /> : <Clock size={14} className="shrink-0" />}
    <span>{name}</span>
    <span className={`ml-auto text-[11px] font-bold ${active ? 'text-[#027A48]' : 'text-[#98A2B3]'}`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  </div>
);

const LoadingState = () => (
  <div className="space-y-4 animate-pulse">
    <div className="bg-white border border-[#EAECF0] rounded-2xl overflow-hidden shadow-sm">
      <div className="h-20 bg-gradient-to-br from-purple-200 to-indigo-200" />
      <div className="p-5 space-y-3">
        {[1,2,3,4].map(i => <div key={i} className="h-9 bg-[#F2F2F7] rounded-xl" />)}
      </div>
    </div>
    <div className="grid grid-cols-2 gap-3">
      {[1,2].map(i => <div key={i} className="h-16 bg-[#F2F2F7] rounded-xl" />)}
    </div>
  </div>
);

const MyCompanyPage = () => {
  const { user } = useAuth();
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const isManager = MANAGER_ROLES.includes(user?.role);
  const canEdit   = ['siteManager', 'superUser'].includes(user?.role);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const companyId = user?.companyId || user?.primaryCompanyId;
      if (!companyId) {
        setError('No company assigned to your account.');
        return;
      }
      const data = await getCompany(companyId);
      if (!data) {
        setError('Company details could not be loaded.');
      } else {
        setCompany(data.company || data);
      }
    } catch (err) {
      setError(err.message || 'Failed to load company details.');
    } finally {
      setLoading(false);
    }
  }, [user?.companyId, user?.primaryCompanyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    wsClient.on('company:updated', loadData);
    return () => wsClient.off('company:updated', loadData);
  }, [loadData]);

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
    const companyId = user?.companyId || user?.primaryCompanyId;
    if (!companyId) return;
    setSaving(true);
    try {
      const updated = await updateCompanyProfile(companyId, editData);
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

  // Backend always returns `plugins` (Prisma field); normalise to the array shape the UI expects
  const rawAddons = company?.plugins;
  let addons = [];
  if (Array.isArray(rawAddons)) {
    addons = rawAddons;
  } else if (rawAddons && typeof rawAddons === 'object') {
    addons = Object.entries(rawAddons).map(([k, v]) => ({
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
      <Header title="My Company" subtitle="Your company profile — synced with MPRAR Central" />

      <div className="space-y-4 sm:space-y-5">

        {loading && <LoadingState />}

        {!loading && error && (
          <div className="bg-[#FEF3F2] border border-[#FECDCA] rounded-2xl p-5 flex items-start gap-3">
            <AlertCircle size={18} className="shrink-0 mt-0.5 text-[#F04438]" />
            <div>
              <p className="font-bold text-[13px] text-[#B42318]">Could not load company details</p>
              <p className="text-[13px] mt-1 text-[#F04438]">{error}</p>
            </div>
          </div>
        )}

        {!loading && !error && company && (
          <>
            {/* ── Identity Header Card ── */}
            <div className="bg-white border border-[#EAECF0] rounded-2xl shadow-sm overflow-hidden">
              {/* Header banner */}
              <div className="px-6 py-5 flex items-center gap-4" style={{ background: `linear-gradient(135deg, ${BRAND}, #5B21B6, #4338CA)` }}>
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
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                      isActive ? 'bg-green-400/25 text-green-100' : 'bg-red-400/25 text-red-200'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-green-300' : 'bg-red-300'}`} />
                      {isActive ? 'Active' : status.charAt(0).toUpperCase() + status.slice(1)}
                    </span>
                    {industry !== '—' && !isEditing && (
                      <span className="text-purple-200 text-[11px] font-medium">{industry}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Detail rows */}
              <div className="px-6 py-1">
                {isEditing ? (
                  <div className="py-5 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[11px] font-bold text-[#667085] uppercase tracking-wider mb-1.5">Company Name</label>
                        <input 
                          type="text" 
                          value={editData.name} 
                          onChange={(e) => setEditData({...editData, name: e.target.value})}
                          className="w-full bg-[#F9FAFB] border border-[#EAECF0] rounded-xl px-3.5 py-2.5 text-[13px] focus:ring-4 focus:ring-[#7718A8]/10 focus:border-[#7718A8] outline-none transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-[#667085] uppercase tracking-wider mb-1.5">Industry</label>
                        <input 
                          type="text" 
                          value={editData.industry} 
                          onChange={(e) => setEditData({...editData, industry: e.target.value})}
                          className="w-full bg-[#F9FAFB] border border-[#EAECF0] rounded-xl px-3.5 py-2.5 text-[13px] focus:ring-4 focus:ring-[#7718A8]/10 focus:border-[#7718A8] outline-none transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-[#667085] uppercase tracking-wider mb-1.5">Website</label>
                        <input 
                          type="text" 
                          value={editData.website} 
                          onChange={(e) => setEditData({...editData, website: e.target.value})}
                          className="w-full bg-[#F9FAFB] border border-[#EAECF0] rounded-xl px-3.5 py-2.5 text-[13px] focus:ring-4 focus:ring-[#7718A8]/10 focus:border-[#7718A8] outline-none transition-all"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-[#667085] uppercase tracking-wider mb-1.5">Phone</label>
                        <input 
                          type="text" 
                          value={editData.phone} 
                          onChange={(e) => setEditData({...editData, phone: e.target.value})}
                          className="w-full bg-[#F9FAFB] border border-[#EAECF0] rounded-xl px-3.5 py-2.5 text-[13px] focus:ring-4 focus:ring-[#7718A8]/10 focus:border-[#7718A8] outline-none transition-all"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-[#667085] uppercase tracking-wider mb-1.5">Address</label>
                      <textarea 
                        rows={2}
                        value={editData.address} 
                        onChange={(e) => setEditData({...editData, address: e.target.value})}
                        className="w-full bg-[#F9FAFB] border border-[#EAECF0] rounded-xl px-3.5 py-2.5 text-[13px] focus:ring-4 focus:ring-[#7718A8]/10 focus:border-[#7718A8] outline-none transition-all resize-none"
                      />
                    </div>
                    <div className="flex items-center gap-3 pt-2">
                      <button 
                        onClick={handleSave}
                        disabled={saving}
                        className="flex-1 text-white py-2.5 rounded-xl text-[13px] font-bold shadow-lg hover:opacity-90 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                        style={{ background: BRAND, boxShadow: '0 4px 14px rgba(119,24,168,0.25)' }}
                      >
                        {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                        Save Changes
                      </button>
                      <button 
                        onClick={() => setIsEditing(false)}
                        disabled={saving}
                        className="px-5 py-2.5 bg-[#F2F4F7] text-[#344054] rounded-xl text-[13px] font-bold hover:bg-[#E4E7EC] transition-all flex items-center gap-2"
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
                        {canEdit && (
                          <div className="py-4">
                             <button 
                               onClick={() => setIsEditing(true)}
                               className="flex items-center gap-2 text-[13px] font-bold transition-colors hover:opacity-80"
                               style={{ color: BRAND }}
                             >
                               <Edit3 size={14} />
                               Edit Company Profile
                             </button>
                          </div>
                        )}
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
              <div className="bg-white border border-[#EAECF0] rounded-2xl shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-[#EAECF0] bg-[#FAFAFA] flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#F4EDFB' }}>
                    <Shield size={15} style={{ color: BRAND }} />
                  </div>
                  <div>
                    <h3 className="text-[14px] font-bold text-[#101828]">Platform Add-ons</h3>
                    <p className="text-[12px] text-[#667085] mt-0.5">Modules activated for your company</p>
                  </div>
                </div>
                <div className="px-6 py-4 space-y-2">
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
              <div className="bg-[#F9F5FF] border border-[#F4EBFF] rounded-xl p-4 flex items-start gap-3">
                <Lock size={16} style={{ color: '#9E77ED' }} className="shrink-0 mt-0.5" />
                <p className="text-[12px] font-medium" style={{ color: BRAND }}>
                  Some company details are visible to managers only. Contact your site manager for further information.
                </p>
              </div>
            )}

            {/* ── Company reference ID — managers only ── */}
            {isManager && (
              <div className="bg-[#F9FAFB] border border-[#EAECF0] rounded-xl p-4">
                <p className="text-[11px] font-bold text-[#667085] uppercase tracking-wider mb-1">Company Reference ID</p>
                <p className="text-[12px] font-mono font-semibold text-[#344054] break-all select-all">{company.id || user?.companyId}</p>
                <p className="text-[11px] text-[#98A2B3] mt-1">Quote this ID when contacting MPRAR support.</p>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
};

export default MyCompanyPage;
