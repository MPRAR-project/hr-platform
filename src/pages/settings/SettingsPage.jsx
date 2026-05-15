import { ArrowRight, ChevronDown, Edit2, Loader2, MapPin, Navigation, Plus, Trash2, X, Building, Image, Upload, Calendar } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import Header from '../../components/layout/Header';
import DeleteConfirmationModal from '../../components/modals/DeleteConfirmationModal';
import AutoClockOutSettings from '../../components/settings/AutoClockOutSettings';
import Button from '../../components/ui/Button';
import { useAuth } from '../../hooks/useAuth';
import { getCompany, updateCompanyProfile } from '../../services/companyManagementService';
import hrApiClient from '../../lib/hrApiClient';
import { invalidateCompanyCache } from '../../services/cacheInvalidationService';
import { getDefaultAutoLunchConfig, invalidateAutoLunchCaches } from '../../services/autoLunch';
import { getUserCurrentLocation } from '../../services/locationService';
import { invalidateRoundingCaches } from '../../services/roundingRules';
import eventBus, { WEEK_START_UPDATED } from '../../services/EventBus';
import { invalidateUserWeekContext, recomputeTimesheetsSafe } from '../../services/timesheets';
import { invalidateWeekStartCaches } from '../../services/weekStartConfig';
import { getDefaultRoundingRules, normalizeRoundingRules, RoundingConst, applyRoundingToTimeString } from '../../utils/timeRounding';
import { DEFAULT_WEEK_START_DAY, WEEKDAY_CODES_LIST, getOrderedWeekDays } from '../../utils/weekStartUtils';
import SeatSettingsTab from '../../components/settings/SeatSettingsTab';
import ClientsPage from '../clients/ClientsPage';
import SitesPage from '../admin/SitesPage';
import BillingSubscriptionsPage from '../payments/BillingSubscriptionPage';


const SettingsPage = () => {
  const [companyInfo, setCompanyInfo] = useState({
    companyName: '',
    payrollEmail: ''
  });
  const { user, refreshWeekStartDay } = useAuth();
  const [activeTab, setActiveTab] = useState('general');
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingLocation, setIsSavingLocation] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(null);

  // Company Logo State
  const [companyLogoURL, setCompanyLogoURL] = useState(null);
  const [selectedLogoFile, setSelectedLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);



  // For site managers and senior managers, default to general settings now that they both have access
  useEffect(() => {
    if (['siteManager', 'seniorManager'].includes(user?.role) && activeTab === 'general') {
      setActiveTab('general');
    }
  }, [user?.role, activeTab]);

  useEffect(() => {
    const loadCompany = async () => {
      try {
        setLoadError(null);

        const companyPath = user?.companyId || '';
        const companyId = companyPath.includes('/') ? companyPath.split('/')[1] : companyPath;
        if (!companyId) {
          return;
        }

        // Load company data
        const company = await getCompany(companyId);

        if (company) {
            const c = company.company || company;
          setCompanyInfo({
            companyName: c.name || '',
            payrollEmail: c.payrollEmail || ''
          });

          if (c.workSchedule && typeof c.workSchedule === 'object') {
            const merged = { ...defaultWorkSchedule };
            Object.keys(merged).forEach(day => {
              if (c.workSchedule[day]) merged[day] = { ...merged[day], ...c.workSchedule[day] };
            });
            setWorkSchedule(merged);
            const enabledDays = Object.entries(merged).filter(([, v]) => v.enabled).map(([d]) => d);
            setTimesheetSettings(prev => ({ ...prev, workingDays: enabledDays }));
          }

          setRoundingRules(c.roundingRules ? normalizeRoundingRules(c.roundingRules) : getDefaultRoundingRules());

          const lunchMinutes = Number.isFinite(Number(c.lunchBreakMinutes))
            ? Math.max(0, Number(c.lunchBreakMinutes))
            : 60;
          setTimesheetSettings(prev => ({
            ...prev,
            defaultLunchTime: lunchMinutesToOption(lunchMinutes)
          }));
          setAutoLunchSettings({
            enabled: Boolean(c.autoLunch?.enabled),
            thresholdHours: Number.isFinite(Number(c.autoLunch?.thresholdHours))
              ? Math.max(0, Number(c.autoLunch.thresholdHours))
              : getDefaultAutoLunchConfig().thresholdHours,
            lunchBreakMinutes: lunchMinutes
          });
          setWeekStartDay(c.weekStartDay || DEFAULT_WEEK_START_DAY);
          setTimesheetSettings(prev => ({
            ...prev,
            perDayHours: c.perDayHours?.toString() || '8'
          }));

          // Load locations
          setLocations(c.locations || []);

          // Load auto clock-out config
          setAutoClockOutConfig({
            dayShiftTime: c.autoClockOutConfig?.dayShiftTime || '23:59',
            nightShiftTime: c.autoClockOutConfig?.nightShiftTime || '11:59'
          });

          // Load company logo
          setCompanyLogoURL(c.logoURL || null);

          // Load plugins
          setPlugins(c.plugins || {});
        }
      } catch (e) {
        setLoadError('Failed to load company info');
        console.error('Error loading company data:', e);
      }
    };
    loadCompany();
  }, [user?.companyId]);

  const [timesheetSettings, setTimesheetSettings] = useState({
    perDayHours: '8',
    defaultLunchTime: '60 mins',
    workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
  });
  const defaultWorkSchedule = {
    Monday: { enabled: true, start: '09:00', end: '17:00', durationMin: 480 },
    Tuesday: { enabled: true, start: '09:00', end: '17:00', durationMin: 480 },
    Wednesday: { enabled: true, start: '09:00', end: '17:00', durationMin: 480 },
    Thursday: { enabled: true, start: '09:00', end: '17:00', durationMin: 480 },
    Friday: { enabled: true, start: '09:00', end: '17:00', durationMin: 480 },
    Saturday: { enabled: false, start: '09:00', end: '13:00', durationMin: 240 },
    Sunday: { enabled: false, start: '09:00', end: '13:00', durationMin: 240 },
  };
  const [workSchedule, setWorkSchedule] = useState(defaultWorkSchedule);
  const [roundingRules, setRoundingRules] = useState(getDefaultRoundingRules());
  const [autoLunchSettings, setAutoLunchSettings] = useState(getDefaultAutoLunchConfig());
  const [weekStartDay, setWeekStartDay] = useState(DEFAULT_WEEK_START_DAY);
  const [autoClockOutConfig, setAutoClockOutConfig] = useState({
    dayShiftTime: '23:59',
    nightShiftTime: '11:59'
  });
  const [plugins, setPlugins] = useState({});

  const [locations, setLocations] = useState([]);

  const [showLocationModal, setShowLocationModal] = useState(false);
  const [editingLocation, setEditingLocation] = useState(null);
  const [locationForm, setLocationForm] = useState({
    name: '',
    address: '',
    latitude: '',
    longitude: '',
    radius: '',
    radiusType: 'preset' // 'preset' or 'custom'
  });
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [locationToDelete, setLocationToDelete] = useState(null);



  // Load Work Locations


  const radiusPresetOptions = ['100m', '250m', '500m', '1km'];

  const weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const orderedWeekDays = useMemo(() => getOrderedWeekDays(weekStartDay), [weekStartDay]);
  const roundingIncrementOptions = useMemo(() => [1, 5, 10, 15, 30, 60], []);
  const roundingDirectionOptions = [
    { label: 'Round Down', value: RoundingConst.DIRECTIONS.DOWN },
    { label: 'Round Up', value: RoundingConst.DIRECTIONS.UP }
  ];

  const formatIncrementLabel = (value) => `${value} min${value === 1 ? '' : 's'}`;
  const lunchBreakOptions = useMemo(() => [30, 45, 60, 90], []);

  const lunchMinutesToOption = (minutes) => {
    const closest = lunchBreakOptions.includes(minutes) ? minutes : 60;
    return `${closest} mins`;
  };

  const optionToLunchMinutes = (option) => {
    const parsed = parseInt(String(option).replace(/\D/g, ''), 10);
    return Number.isFinite(parsed) ? parsed : 60;
  };

  const computeEndFrom = (startHHMM, durationMin) => {
    try {
      const [h, m] = (startHHMM || '09:00').split(':').map(Number);
      const base = new Date();
      base.setHours(h || 0, m || 0, 0, 0);
      const end = new Date(base.getTime() + Math.max(0, Number(durationMin || 0)) * 60000);
      const eh = String(end.getHours()).padStart(2, '0');
      const em = String(end.getMinutes()).padStart(2, '0');
      return `${eh}:${em}`;
    } catch {
      return '17:00';
    }
  };

  const handleSaveChanges = async () => {
    try {
      setIsSaving(true);
      setSaveError(null);
      setSaveSuccess(null);
      const companyPath = user?.companyId || '';
      const companyId = companyPath.includes('/') ? companyPath.split('/')[1] : companyPath;
      if (!companyId) {
        toast.error('Company ID not found');
        return;
      }
      const lunchBreakMinutes = autoLunchSettings.lunchBreakMinutes;
      await updateCompanyProfile(companyId, {
        name: companyInfo.companyName || '',
        payrollEmail: companyInfo.payrollEmail || '',
        workSchedule: workSchedule,
        workingDays: timesheetSettings.workingDays,
        roundingRules,
        lunchBreakMinutes,
        weekStartDay,
        autoLunch: {
          enabled: Boolean(autoLunchSettings.enabled),
          thresholdHours: Number.isFinite(Number(autoLunchSettings.thresholdHours))
            ? Math.max(0, Number(autoLunchSettings.thresholdHours))
            : getDefaultAutoLunchConfig().thresholdHours
        },
        autoClockOutConfig: {
          dayShiftTime: autoClockOutConfig.dayShiftTime || '23:59',
          nightShiftTime: autoClockOutConfig.nightShiftTime || '11:59'
        },
        perDayHours: timesheetSettings.perDayHours || '8',
        plugins: plugins,
        // locations are now saved immediately, so we don't need to save them here
      });
      invalidateRoundingCaches(companyPath);
      invalidateAutoLunchCaches(companyPath);
      invalidateWeekStartCaches(companyPath);
      await invalidateCompanyCache(companyId);
      // Await so Auth and any open Time Entries see new week start immediately (no DB keyword change)
      await refreshWeekStartDay?.(user?.companyId || '', user?.siteId || null);
      invalidateUserWeekContext(user?.uid);
      eventBus.emit(WEEK_START_UPDATED, { weekStartDay });
      try {
        localStorage.setItem('mprar_weekStart_updated', String(Date.now()));
      } catch (_) { }

      toast.success('Changes saved successfully');
    } catch (err) {
      console.error(err);
      //  setSaveError('Failed to save changes');
      toast.error('Failed to save changes');
    } finally {
      setIsSaving(false);
    }
  };

  // Removed propagateWeekStartDay as backend handles this via unified profile update

  const handleAddLocation = () => {
    setEditingLocation(null);
    setLocationForm({ name: '', address: '', latitude: '', longitude: '', radius: '', radiusType: 'preset' });
    setShowLocationModal(true);
  };

  const handleEditLocation = (location) => {
    setEditingLocation(location);
    const existingRadius = location.radius || '';
    const isPreset = radiusPresetOptions.includes(existingRadius);
    setLocationForm({
      name: location.name || '',
      address: location.address || '',
      latitude: location.latitude?.toString() || '',
      longitude: location.longitude?.toString() || '',
      radius: existingRadius,
      radiusType: isPreset ? 'preset' : (existingRadius ? 'custom' : 'preset')
    });
    setShowLocationModal(true);
  };

  const handleSaveLocation = async () => {
    if (!locationForm.name.trim()) {
      toast.error('Please enter a location name');
      return;
    }

    // Parse coordinates
    const latitude = locationForm.latitude.trim() ? parseFloat(locationForm.latitude.trim()) : null;
    const longitude = locationForm.longitude.trim() ? parseFloat(locationForm.longitude.trim()) : null;

    // Validate coordinates if provided
    if (latitude !== null && (isNaN(latitude) || latitude < -90 || latitude > 90)) {
      toast.error('Invalid latitude. Must be between -90 and 90.');
      return;
    }

    if (longitude !== null && (isNaN(longitude) || longitude < -180 || longitude > 180)) {
      toast.error('Invalid longitude. Must be between -180 and 180.');
      return;
    }

    // Determine final radius value
    let finalRadius = null;
    if (locationForm.radiusType === 'none') {
      finalRadius = null;
    } else if (locationForm.radiusType === 'preset' || locationForm.radiusType === 'custom') {
      finalRadius = locationForm.radius.trim() || null;
    }

    // If radius is provided, coordinates are required
    if (finalRadius && (latitude === null || longitude === null)) {
      toast.error('Latitude and longitude are required when radius is set.');
      return;
    }

    const companyPath = user?.companyId || '';
    const companyId = companyPath.split('/')[1];
    if (!companyId) {
      toast.error('Company ID not found');
      return;
    }

    setIsSavingLocation(true);

    try {
      const newLocation = {
        id: editingLocation?.id || `loc_${Date.now()}`,
        name: locationForm.name.trim(),
        address: locationForm.address.trim() || null,
        latitude: latitude,
        longitude: longitude,
        radius: finalRadius, // null = no restriction (e.g., Remote Work)
        createdAt: editingLocation?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      let updatedLocations;
      if (editingLocation) {
        // Update existing location
        updatedLocations = locations.map(loc =>
          loc.id === editingLocation.id ? newLocation : loc
        );
      } else {
        // Add new location
        updatedLocations = [...locations, newLocation];
      }

      // Save to REST immediately
      await updateCompanyProfile(companyId, {
        locations: updatedLocations
      });

      await invalidateCompanyCache(companyId);

      // Update local state
      setLocations(updatedLocations);

      setShowLocationModal(false);
      setEditingLocation(null);
      setLocationForm({ name: '', address: '', latitude: '', longitude: '', radius: '' });
      toast.success(editingLocation ? 'Location updated successfully' : 'Location added successfully');
    } catch (error) {
      console.error('Error saving location:', error);
      toast.error('Failed to save location. Please try again.');
    } finally {
      setIsSavingLocation(false);
    }
  };

  const handleCloseLocationModal = () => {
    if (isSavingLocation) {
      return; // Prevent closing while saving
    }
    setShowLocationModal(false);
    setEditingLocation(null);
    setLocationForm({ name: '', address: '', latitude: '', longitude: '', radius: '', radiusType: 'preset' });
  };

  const handleDeleteClick = (locationId) => {
    const location = locations.find(loc => loc.id === locationId);
    setLocationToDelete(locationId);
    setShowDeleteModal(true);
  };

  const handleDeleteLocation = async () => {
    if (!locationToDelete) return;

    const companyPath = user?.companyId || '';
    const companyId = companyPath.split('/')[1];
    if (!companyId) {
      toast.error('Company ID not found');
      setShowDeleteModal(false);
      setLocationToDelete(null);
      return;
    }

    setIsSavingLocation(true);

    try {
      const updatedLocations = locations.filter(loc => loc.id !== locationToDelete);

      // Save to REST immediately
      await updateCompanyProfile(companyId, {
        locations: updatedLocations
      });

      await invalidateCompanyCache(companyId);

      // Update local state
      setLocations(updatedLocations);
      toast.success('Location deleted successfully');
    } catch (error) {
      console.error('Error deleting location:', error);
      toast.error('Failed to delete location. Please try again.');
    } finally {
      setIsSavingLocation(false);
      setShowDeleteModal(false);
      setLocationToDelete(null);
    }
  };

  const handleUseCurrentLocation = async () => {
    setIsGettingLocation(true);
    try {
      const location = await getUserCurrentLocation();
      setLocationForm({
        ...locationForm,
        latitude: location.latitude.toString(),
        longitude: location.longitude.toString()
      });
      toast.success('Location captured successfully!');
    } catch (error) {
      console.error('Error getting current location:', error);
      toast.error(error.message || 'Failed to get your current location. Please enter coordinates manually.');
    } finally {
      setIsGettingLocation(false);
    }
  };

  const toggleWorkingDay = (day) => {
    const enabled = !workSchedule[day]?.enabled;
    const updated = { ...workSchedule, [day]: { ...(workSchedule[day] || {}), enabled } };
    setWorkSchedule(updated);
    const newWorkingDays = Object.entries(updated).filter(([, v]) => v.enabled).map(([d]) => d);
    setTimesheetSettings({ ...timesheetSettings, workingDays: newWorkingDays });
  };




  // Work Location Handlers


  // Logo Upload Handlers
  const [isDraggingLogo, setIsDraggingLogo] = useState(false);

  const processLogoFile = async (file) => {
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file (PNG, JPG, SVG)');
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Logo image must be less than 2MB');
      return;
    }

    const companyPath = user?.companyId || '';
    const companyId = companyPath.split('/')[1];
    if (!companyId) {
      toast.error('Company ID not found');
      return;
    }

    setIsUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      // Upload file via REST API
      const { data: uploadRes } = await hrApiClient.post('/hr/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      const downloadURL = uploadRes.url;

      // Update company profile via REST
      await updateCompanyProfile(companyId, {
        logoURL: downloadURL,
        updatedAt: new Date()
      });

      await invalidateCompanyCache(companyId);

      setCompanyLogoURL(downloadURL);
      toast.success('Company logo uploaded successfully!');
    } catch (error) {
      console.error('Error uploading logo:', error);
      toast.error('Failed to upload logo. Please try again.');
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const handleLogoFileSelect = (event) => {
    const file = event.target.files[0];
    processLogoFile(file);
  };

  const handleLogoDrop = (event) => {
    event.preventDefault();
    setIsDraggingLogo(false);
    const file = event.dataTransfer.files[0];
    processLogoFile(file);
  };

  const handleLogoDragOver = (event) => {
    event.preventDefault();
    setIsDraggingLogo(true);
  };

  const handleLogoDragLeave = () => {
    setIsDraggingLogo(false);
  };

  const handleLogoRemove = async () => {
    const companyPath = user?.companyId || '';
    const companyId = companyPath.split('/')[1];
    if (!companyId) {
      toast.error('Company ID not found');
      return;
    }

    setIsUploadingLogo(true);
    try {
      // Update company profile via REST to remove logo URL
      await updateCompanyProfile(companyId, {
        logoURL: null,
        updatedAt: new Date()
      });

      await invalidateCompanyCache(companyId);

      setCompanyLogoURL(null);
      toast.success('Company logo removed successfully!');
    } catch (error) {
      console.error('Error removing logo:', error);
      toast.error('Failed to remove logo. Please try again.');
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const pretty = (role = '') =>
    role.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Header
        title={`${pretty(user?.role || 'employee')} Dashboard`}
        subtitle="Manage your company information and settings"
      />

      <div className="flex-1 overflow-y-auto p-4 md:p-3xl scrollbar-custom">
        <div className="max-w-7xl mx-auto space-y-6">

          {/* Tab Navigation */}
          <div className="flex items-center space-x-1 mb-6 border-b border-gray-200">
            {(['siteManager', 'seniorManager'].includes(user?.role)) && (
              <button
                onClick={() => setActiveTab('general')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'general'
                  ? 'border-purple-600 text-purple-600'
                  : 'border-transparent text-text-secondary hover:text-text-primary hover:border-gray-300'
                  }`}
              >
                General Settings
              </button>
            )}
            {user?.role === 'siteManager' && (
              <button
                onClick={() => setActiveTab('seats')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'seats'
                  ? 'border-purple-600 text-purple-600'
                  : 'border-transparent text-text-secondary hover:text-text-primary hover:border-gray-300'
                  }`}
              >
                Seat Requests

              </button>
            )}
            {['siteManager', 'seniorManager'].includes(user?.role) && (
              <>
                <button
                  onClick={() => setActiveTab('clients')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'clients'
                    ? 'border-purple-600 text-purple-600'
                    : 'border-transparent text-text-secondary hover:text-text-primary hover:border-gray-300'
                    }`}
                >
                  Clients
                </button>
                <button
                  onClick={() => setActiveTab('sites')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'sites'
                    ? 'border-purple-600 text-purple-600'
                    : 'border-transparent text-text-secondary hover:text-text-primary hover:border-gray-300'
                    }`}
                >
                  Sites Management
                </button>
              </>
            )}

            {(['siteManager', 'seniorManager'].includes(user?.role)) && (
              <button
                onClick={() => setActiveTab('subscriptions')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'subscriptions'
                  ? 'border-purple-600 text-purple-600'
                  : 'border-transparent text-text-secondary hover:text-text-primary hover:border-gray-300'
                  }`}
              >
                Subscriptions
              </button>
            )}
            {/* <button
              onClick={() => setActiveTab('migrations')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'migrations'
                ? 'border-purple-600 text-purple-600'
                : 'border-transparent text-text-secondary hover:text-text-primary hover:border-gray-300'
                }`}
            >
              Data Migration
            </button> */}
          </div>

          {activeTab === 'clients' ? (
            <div className="h-[calc(100vh-200px)]">
              <ClientsPage isEmbedded={true} />
            </div>
          ) : activeTab === 'sites' ? (
            <div className="h-[calc(100vh-200px)]">
              <SitesPage />
            </div>
          ) : activeTab === 'subscriptions' ? (
            <div className="h-[calc(100vh-200px)]">
              <BillingSubscriptionsPage isEmbedded={true} />
            </div>
          ) : activeTab === 'seats' ? (
            <SeatSettingsTab />
          ) : activeTab === 'migrations' ? (
            <div className="space-y-6">
              <div className="bg-white rounded-base p-6 shadow-lg">
                <h2 className="text-2xl font-bold text-text-primary mb-4">Data Migrations</h2>
                <p className="text-text-secondary mb-6">
                  Run database maintenance scripts to update data structures and improve performance.
                </p>

                <div className="border border-border-secondary rounded-lg p-4">
                  <h3 className="text-lg font-semibold text-text-primary mb-2">Phase 3: Denormalize User Hierarchy</h3>
                  <p className="text-sm text-text-secondary mb-4">
                    Backfills <code>reportsTo</code> and <code>teamId</code> on User documents based on existing Assignments.
                    This enables faster "Team View" queries.
                  </p>
                  <button
                    onClick={async () => {
                      if (!window.confirm('Are you sure you want to run this migration? It will update user documents.')) return;
                      try {
                        toast.info('Migration started...');
                        const { migrateHierarchyDenormalization } = await import('../../services/migrations/hierarchyResponse');
                        const res = await migrateHierarchyDenormalization();
                        if (res.success) {
                          toast.success(`Migration Complete! Updated ${res.usersUpdated} users.`);
                        } else {
                          toast.error('Migration failed. Check console.');
                        }
                      } catch (e) {
                        console.error(e);
                        toast.error('Failed to run migration module.');
                      }
                    }}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium text-sm transition-colors"
                  >
                    Run Backfill Script
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Save Changes Button */}
              <div className="flex justify-end">
                <button
                  onClick={handleSaveChanges}
                  disabled={isSaving}
                  className="w-full sm:w-auto h-12 px-8 bg-[linear-gradient(91.36deg,#AF54DD_4.75%,#7617A7_96.14%)] text-white rounded-base font-semibold text-md flex items-center justify-center gap-2.5 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span>{isSaving ? 'Saving...' : 'Save all Changes'}</span>
                  <div className="w-5 h-5 bg-white rounded-full flex items-center justify-center">
                    <ArrowRight className="h-3 w-3 text-[#CB30E0]" />
                  </div>
                </button>
              </div>
              {loadError && <p className="text-sm text-red-500">{loadError}</p>}
              {saveError && <p className="text-sm text-red-500">{saveError}</p>}
              {saveSuccess && <p className="text-sm text-green-600">{saveSuccess}</p>}

              {/* Company Information Section */}
              <div className="bg-white rounded-base p-6 shadow-lg">
                <h2 className="text-2xl font-bold text-text-primary mb-6">Company Information</h2>

                {/* Company Logo Section */}
                <div className="mb-6 pb-6 border-b border-gray-200">
                  <label className="text-md font-medium text-text-primary mb-3 block">
                    Company Logo
                  </label>
                  <p className="text-sm text-text-secondary mb-4">
                    Click or drag an image to upload your company logo.
                  </p>

                  <div className="flex items-center gap-4">
                    {/* Clickable/Droppable Logo Area */}
                    <label
                      className={`relative w-[180px] h-[80px] rounded-lg border-2 transition-all cursor-pointer flex items-center justify-center overflow-hidden group
                        ${isDraggingLogo
                          ? 'border-purple-500 bg-purple-50 border-solid'
                          : companyLogoURL
                            ? 'border-gray-200 bg-white hover:border-purple-400'
                            : 'border-dashed border-gray-300 bg-gray-50 hover:border-purple-400 hover:bg-purple-50'
                        }
                        ${isUploadingLogo ? 'opacity-70 pointer-events-none' : ''}
                      `}
                      onDrop={handleLogoDrop}
                      onDragOver={handleLogoDragOver}
                      onDragLeave={handleLogoDragLeave}
                    >
                      {isUploadingLogo ? (
                        <div className="flex flex-col items-center">
                          <Loader2 className="w-6 h-6 text-purple-500 animate-spin" />
                          <span className="text-xs text-purple-500 mt-1">Uploading...</span>
                        </div>
                      ) : companyLogoURL ? (
                        <>
                          <img src={companyLogoURL} alt="Company Logo" className="max-h-[70px] max-w-[170px] object-contain" />
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <span className="text-white text-xs font-medium">Click to change</span>
                          </div>
                        </>
                      ) : (
                        <div className="text-center px-2">
                          <Upload className="w-6 h-6 text-gray-400 mx-auto mb-1 group-hover:text-purple-500" />
                          <span className="text-[10px] text-gray-400 group-hover:text-purple-500 block leading-tight">
                            Click or drop image
                          </span>
                        </div>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleLogoFileSelect}
                        className="hidden"
                        disabled={isUploadingLogo}
                      />
                    </label>

                    {/* Remove button (only shown when logo exists) */}
                    {companyLogoURL && !isUploadingLogo && (
                      <button
                        type="button"
                        onClick={handleLogoRemove}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-red-600 text-sm hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                        Remove
                      </button>
                    )}
                  </div>

                  <p className="text-xs text-gray-500 mt-3">
                    Recommended: 200×60px • Max 2MB • PNG, JPG, SVG
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="text-md font-medium text-text-primary mb-3 block">
                      Company Name
                    </label>
                    <input
                      type="text"
                      value={companyInfo.companyName}
                      onChange={(e) => setCompanyInfo({ ...companyInfo, companyName: e.target.value })}
                      placeholder="Company Name"
                      className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-secondary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
                    />
                  </div>

                  <div>
                    <label className="text-md font-medium text-text-primary mb-3 block">
                      Payroll Email
                    </label>
                    <input
                      type="email"
                      value={companyInfo.payrollEmail}
                      onChange={(e) => setCompanyInfo({ ...companyInfo, payrollEmail: e.target.value })}
                      placeholder="payroll@company.com"
                      className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-secondary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
                    />
                  </div>
                </div>
              </div>

              {/* Timesheet Settings Section */}
              <div className="bg-white shadow-lg rounded-base p-6">
                <h2 className="text-2xl font-bold text-text-primary mb-6">Timesheet Settings</h2>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                  <p className="text-sm text-blue-700">
                    <strong>Week Starting Day:</strong> {weekStartDay ? weekStartDay.charAt(0).toUpperCase() + weekStartDay.slice(1) : 'Monday'}
                  </p>
                  <p className="text-sm text-blue-600 mt-1">
                    This setting was configured during company creation and cannot be changed here. Contact support if you need to modify your company's week starting day.
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-6">
                  <div>
                    <label className="text-md font-medium text-text-primary mb-3 block">
                      Full Time Hours (per day)
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        value={timesheetSettings.perDayHours}
                        onChange={(e) => setTimesheetSettings({ ...timesheetSettings, perDayHours: e.target.value })}
                        placeholder="8"
                        min="1"
                        max="24"
                        className="w-full h-12 px-4 pr-16 border border-border-secondary rounded-lg text-md text-text-secondary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-text-secondary">hours</span>
                    </div>
                    <p className="text-xs text-text-secondary mt-2">Standard daily hours for full-time employees</p>
                  </div>

                  <div>
                    <label className="text-md font-medium text-text-primary mb-3 block">
                      Lunch Break
                    </label>
                    <div className="relative">
                      <select
                        value={timesheetSettings.defaultLunchTime}
                        onChange={(e) => {
                          const value = e.target.value;
                          setTimesheetSettings({ ...timesheetSettings, defaultLunchTime: value });
                          setAutoLunchSettings(prev => ({
                            ...prev,
                            lunchBreakMinutes: optionToLunchMinutes(value)
                          }));
                        }}
                        className="w-full h-12 px-4 pr-10 border border-border-secondary rounded-lg text-md text-text-secondary appearance-none focus:outline-none focus:border-border-accent-purple"
                      >
                        {lunchBreakOptions.map((minutes) => (
                          <option key={`lunch-${minutes}`} value={`${minutes} mins`}>
                            {minutes} mins
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
                    </div>
                    <p className="text-xs text-text-secondary mt-2">Standard lunch break duration</p>
                  </div>

                  <div>
                    <label className="text-md font-medium text-text-primary mb-3 block">
                      Clock-in Rounding
                    </label>
                    <div className="flex flex-col gap-3">
                      <div className="relative">
                        <select
                          value={roundingRules.clockIn.incrementMinutes}
                          onChange={(e) => setRoundingRules({
                            ...roundingRules,
                            clockIn: {
                              ...roundingRules.clockIn,
                              incrementMinutes: Number(e.target.value)
                            }
                          })}
                          className="w-full h-12 px-4 pr-10 border border-border-secondary rounded-lg text-md text-text-secondary appearance-none focus:outline-none focus:border-border-accent-purple"
                        >
                          {roundingIncrementOptions.map((option) => (
                            <option key={`clock-in-${option}`} value={option}>
                              {formatIncrementLabel(option)}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
                      </div>
                      <div className="flex gap-3">
                        {roundingDirectionOptions.map(({ label, value }) => {
                          const isActive = roundingRules.clockIn.direction === value;
                          return (
                            <button
                              key={`clock-in-direction-${value}`}
                              type="button"
                              onClick={() => setRoundingRules({
                                ...roundingRules,
                                clockIn: {
                                  ...roundingRules.clockIn,
                                  direction: value
                                }
                              })}
                              className={`flex-1 h-10 rounded-lg border text-sm font-medium transition-colors ${isActive
                                ? 'border-border-accent-purple bg-purple-50 text-text-accent-purple'
                                : 'border-border-secondary bg-white text-text-secondary hover:border-border-accent-purple'
                                }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <p className="text-xs text-text-secondary mt-2">
                      Configure how employee clock-in times are rounded.
                    </p>
                  </div>

                  <div>
                    <label className="text-md font-medium text-text-primary mb-3 block">
                      Clock-out Rounding
                    </label>
                    <div className="flex flex-col gap-3">
                      <div className="relative">
                        <select
                          value={roundingRules.clockOut.incrementMinutes}
                          onChange={(e) => setRoundingRules({
                            ...roundingRules,
                            clockOut: {
                              ...roundingRules.clockOut,
                              incrementMinutes: Number(e.target.value)
                            }
                          })}
                          className="w-full h-12 px-4 pr-10 border border-border-secondary rounded-lg text-md text-text-secondary appearance-none focus:outline-none focus:border-border-accent-purple"
                        >
                          {roundingIncrementOptions.map((option) => (
                            <option key={`clock-out-${option}`} value={option}>
                              {formatIncrementLabel(option)}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
                      </div>
                      <div className="flex gap-3">
                        {roundingDirectionOptions.map(({ label, value }) => {
                          const isActive = roundingRules.clockOut.direction === value;
                          return (
                            <button
                              key={`clock-out-direction-${value}`}
                              type="button"
                              onClick={() => setRoundingRules({
                                ...roundingRules,
                                clockOut: {
                                  ...roundingRules.clockOut,
                                  direction: value
                                }
                              })}
                              className={`flex-1 h-10 rounded-lg border text-sm font-medium transition-colors ${isActive
                                ? 'border-border-accent-purple bg-purple-50 text-text-accent-purple'
                                : 'border-border-secondary bg-white text-text-secondary hover:border-border-accent-purple'
                                }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <p className="text-xs text-text-secondary mt-2">
                      Configure how employee clock-out times are rounded.
                    </p>
                  </div>
                </div>

                {/* Automatic Lunch Settings */}
                <div className="mb-6 border border-border-secondary rounded-lg p-4 sm:p-6 bg-white">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                    <div>
                      <h3 className="text-xl font-semibold text-text-primary">Automatic Lunch Deduction</h3>
                      <p className="text-sm text-text-secondary mt-1">
                        Automatically deduct a lunch break when an employee’s shift exceeds the configured threshold.
                      </p>
                    </div>
                    <label className="inline-flex items-center gap-3 cursor-pointer">
                      <span className="text-sm font-medium text-text-primary">Enable auto lunch</span>
                      <input
                        type="checkbox"
                        checked={autoLunchSettings.enabled}
                        onChange={(e) => setAutoLunchSettings(prev => ({ ...prev, enabled: e.target.checked }))}
                        className="w-5 h-5 rounded border border-border-secondary text-purple-600 focus:ring-2 focus:ring-purple-200"
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="text-md font-medium text-text-primary mb-3 block">
                        Threshold (hours)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={autoLunchSettings.thresholdHours}
                        disabled={!autoLunchSettings.enabled}
                        onChange={(e) => setAutoLunchSettings(prev => ({
                          ...prev,
                          thresholdHours: Math.max(0, Number(e.target.value) || 0)
                        }))}
                        className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-secondary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple disabled:bg-gray-100"
                      />
                      <p className="text-xs text-text-secondary mt-2">
                        Auto-deduct lunch once a shift exceeds this many hours.
                      </p>
                    </div>
                    <div>
                      <label className="text-md font-medium text-text-primary mb-3 block">
                        Lunch duration applied
                      </label>
                      <div className="h-12 px-4 border border-border-secondary rounded-lg flex items-center text-md text-text-secondary bg-gray-50">
                        {autoLunchSettings.lunchBreakMinutes} mins
                      </div>
                      <p className="text-xs text-text-secondary mt-2">
                        Matches the standard “Lunch Break” duration above.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Auto Clock-Out Settings */}
                <div className="mb-6 border border-border-secondary rounded-lg p-4 sm:p-6 bg-white">
                  <h3 className="text-xl font-semibold text-text-primary mb-6">Auto Clock-Out Settings</h3>
                  <AutoClockOutSettings
                    companyId={user?.companyId}
                    autoClockOutConfig={autoClockOutConfig}
                    setAutoClockOutConfig={setAutoClockOutConfig}
                    userRole={user?.role}
                  />
                </div>

                {/* Working Schedule (per-day hours) */}
                <div className="mb-6">
                  <label className="text-md font-medium text-text-primary mb-3 block">
                    Working Schedule (Basic Hours)
                  </label>

                  {/* Explanatory Box for Overtime Logic */}
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                    <h4 className="text-sm font-semibold text-red-800 mb-2">Defining a Basic Working Day</h4>
                    <p className="text-sm text-red-700 mb-2">
                      Set the number of hours that constitute a "Basic" working day. This setting determines your overtime calculations:
                    </p>
                    <ul className="list-disc list-inside text-sm text-red-700 space-y-1 ml-1">
                      <li><strong>Basic Hours:</strong> The first X hours worked (e.g., if set to 8 hours).</li>
                      <li><strong>Overtime:</strong> Any time booked <em>after</em> these basic hours.</li>
                      <li><strong>All Overtime:</strong> If set to 0, <em>all</em> hours worked will be calculated as overtime.</li>
                    </ul>
                  </div>

                  <div className="space-y-2">
                    {orderedWeekDays.map((day) => (
                      <div key={day} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 border border-border-secondary rounded-lg">
                        <label className="flex items-center gap-2 min-w-[140px]">
                          <input
                            type="checkbox"
                            checked={Boolean(workSchedule[day]?.enabled)}
                            onChange={() => toggleWorkingDay(day)}
                            className="w-4 h-4 text-purple-600 border-border-secondary rounded focus:ring-2 focus:ring-purple-200"
                          />
                          <span className="text-sm text-text-primary font-medium">{day}</span>
                        </label>
                        <div className="flex items-center gap-3 flex-wrap">
                          {/* Start time input removed per request */}
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-text-secondary">Duration</span>
                            <input
                              type="number"
                              min="0"
                              max="24"
                              value={Math.floor((workSchedule[day]?.durationMin || 0) / 60)}
                              disabled={!workSchedule[day]?.enabled}
                              onChange={(e) => {
                                const hours = Math.max(0, Number(e.target.value || 0));
                                const minutes = (workSchedule[day]?.durationMin || 0) % 60;
                                const durationMin = hours * 60 + minutes;
                                const next = { ...(workSchedule[day] || {}), durationMin };
                                next.end = computeEndFrom(next.start || '09:00', durationMin);
                                setWorkSchedule({ ...workSchedule, [day]: next });
                              }}
                              className="w-16 h-10 px-2 border border-border-secondary rounded-lg text-sm text-text-primary disabled:bg-gray-100 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            <span className="text-xs text-text-secondary">h</span>
                            <input
                              type="number"
                              min="0"
                              max="59"
                              value={(workSchedule[day]?.durationMin || 0) % 60}
                              disabled={!workSchedule[day]?.enabled}
                              onChange={(e) => {
                                const minutes = Math.max(0, Math.min(59, Number(e.target.value || 0)));
                                const hours = Math.floor((workSchedule[day]?.durationMin || 0) / 60);
                                const durationMin = hours * 60 + minutes;
                                const next = { ...(workSchedule[day] || {}), durationMin };
                                next.end = computeEndFrom(next.start || '09:00', durationMin);
                                setWorkSchedule({ ...workSchedule, [day]: next });
                              }}
                              className="w-16 h-10 px-2 border border-border-secondary rounded-lg text-sm text-text-primary disabled:bg-gray-100 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            <span className="text-xs text-text-secondary">min</span>
                          </div>
                          {/* End time display removed per request */}
                        </div>

                        {/* Explanatory Text */}
                        <div className="text-xs text-text-secondary italic min-w-[180px]">
                          {(() => {
                            const min = workSchedule[day]?.durationMin || 0;
                            const h = Math.floor(min / 60);
                            const m = min % 60;
                            const timeStr = m > 0 ? `${h}h ${m}m` : `${h}h`;

                            if (!workSchedule[day]?.enabled) return 'Day off';
                            if (min === 0) return '0h Basic Day (All Overtime)';
                            return `${timeStr} Basic Day (Excess is Overtime)`;
                          })()}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-text-secondary mt-2">
                    Configure different hours for each day. These will be used across timesheets.
                  </p>

                  <div className='mt-4 flex flex-col sm:flex-row sm:items-center gap-3 p-3 border border-border-secondary rounded-lg bg-blue-50'>
                    <div className="flex flex-col gap-2">
                      <span className="text-sm text-blue-800 font-medium">
                        Onboarding Management
                      </span>
                      <p className="text-xs text-blue-600">
                        Onboarding requirements are now managed per user when adding new users. Check the "Onboarding mandatory" option in the Add User modal to require specific users to complete onboarding.
                      </p>
                    </div>
                  </div>

                </div>

                {/* Rounding Explanation Box */}
                <div className="bg-purple-50 flex flex-col gap-4 border border-border-accent-purple rounded-lg sm:p-6 p-4">
                  <div>
                    <h3 className="text-lg font-semibold text-text-accent-purple mb-2">Rounding Summary</h3>
                    <p className="text-sm text-text-accent-purple">
                      Clock-in times are {roundingRules.clockIn.direction === RoundingConst.DIRECTIONS.DOWN ? 'rounded down' : 'rounded up'} to the nearest {formatIncrementLabel(roundingRules.clockIn.incrementMinutes)}.
                    </p>
                    <p className="text-sm text-text-accent-purple">
                      Clock-out times are {roundingRules.clockOut.direction === RoundingConst.DIRECTIONS.DOWN ? 'rounded down' : 'rounded up'} to the nearest {formatIncrementLabel(roundingRules.clockOut.incrementMinutes)}.
                    </p>
                    <p className="text-sm text-text-accent-purple">
                      Automatic lunch deduction is {autoLunchSettings.enabled ? `enabled after ${autoLunchSettings.thresholdHours} hours with a ${autoLunchSettings.lunchBreakMinutes}-minute break` : 'disabled'}.
                    </p>
                  </div>

                  <div className="p-4 bg-purple-50 rounded-lg border border-border-accent-purple">
                    <p className="text-md font-semibold text-text-accent-purple mb-2">
                      Example
                    </p>
                    <div className="space-y-1 text-base text-text-accent-purple">
                      <p>
                        Clock In: 08:47 → {
                          applyRoundingToTimeString('08:47', roundingRules.clockIn)
                        } (nearest {formatIncrementLabel(roundingRules.clockIn.incrementMinutes)})
                      </p>
                      <p>
                        Clock Out: 17:23 → {
                          applyRoundingToTimeString('17:23', roundingRules.clockOut)
                        } (nearest {formatIncrementLabel(roundingRules.clockOut.incrementMinutes)})
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Location Settings Section */}
              <div className="bg-white rounded-base p-6 shadow-lg">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                  <h2 className="text-2xl font-bold text-text-primary">Location Settings</h2>
                  <Button
                    variant="outline-primary"
                    icon={Plus}
                    onClick={handleAddLocation}
                  >
                    Add Location
                  </Button>
                </div>

                <div className="space-y-4">
                  <h3 className="text-md font-medium text-text-primary">Allowed Clock-IN Locations</h3>

                  {/* Locations List */}
                  <div className="space-y-3">
                    {locations.length === 0 ? (
                      <div className="text-center py-8 text-text-secondary">
                        <p>No locations configured. Add a location to enable location-based clock in/out restrictions.</p>
                      </div>
                    ) : (
                      locations.map((location) => (
                        <div
                          key={location.id}
                          className="flex items-center justify-between p-4 border border-border-secondary rounded-lg hover:bg-bg-secondary transition-colors"
                        >
                          <div className="flex items-center gap-3 flex-1">
                            <MapPin className="h-5 w-5 text-text-secondary flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-text-primary">{location.name}</p>
                              {location.address && (
                                <p className="text-sm text-text-secondary truncate">{location.address}</p>
                              )}
                              {location.latitude !== null && location.longitude !== null && (
                                <p className="text-xs text-text-secondary">
                                  {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
                                </p>
                              )}
                              {location.radius ? (
                                <p className="text-sm text-text-secondary">Radius: {location.radius}</p>
                              ) : (
                                <p className="text-sm text-green-600">No radius restriction</p>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="outline-primary"
                              icon={Edit2}
                              onClick={() => handleEditLocation(location)}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => handleDeleteClick(location.id)}
                              disabled={isSavingLocation}
                              className="flex items-center gap-2 text-red-600 hover:text-red-700 hover:bg-red-50 border-2 border-red-500 rounded-md p-1"
                            >
                              <Trash2 size={16} />
                              <span>Delete</span>
                            </Button>

                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>






              {/* Add/Edit Location Modal */}
              {showLocationModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
                  <div
                    className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]"
                    onClick={isSavingLocation ? undefined : handleCloseLocationModal}
                    style={{ cursor: isSavingLocation ? 'not-allowed' : 'pointer' }}
                  ></div>

                  <div className="relative w-full max-w-[540px] bg-white rounded-[24px] shadow-[0_4px_20px_rgba(0,0,0,0.1)] my-4 max-h-[90vh] flex flex-col">
                    {/* Header - Sticky */}
                    <div className="flex justify-between items-start p-6 pb-4 border-b border-border-secondary flex-shrink-0">
                      <h2 className="text-xl font-bold text-text-primary">
                        {editingLocation ? 'Edit Location' : 'Add New Location'}
                      </h2>
                      <button
                        onClick={handleCloseLocationModal}
                        className="w-6 h-6 flex items-center justify-center bg-black/10 rounded-full hover:bg-black/20 transition-colors flex-shrink-0 ml-4"
                      >
                        <X className="h-4 w-4 text-text-secondary" />
                      </button>
                    </div>

                    {/* Form Fields - Scrollable */}
                    <div className="flex-1 overflow-y-auto px-6 py-4">
                      <div className="space-y-4">
                        <div>
                          <label className="text-md font-semibold text-text-primary mb-3 block">
                            Location Name <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={locationForm.name}
                            onChange={(e) => setLocationForm({ ...locationForm, name: e.target.value })}
                            placeholder="e.g., Main Office, Branch Office"
                            className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
                          />
                        </div>

                        <div>
                          <label className="text-md font-semibold text-text-primary mb-3 block">
                            Address (Optional)
                          </label>
                          <input
                            type="text"
                            value={locationForm.address}
                            onChange={(e) => setLocationForm({ ...locationForm, address: e.target.value })}
                            placeholder="e.g., 123 Business St, New York, NY"
                            className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
                          />
                          <p className="text-xs text-text-secondary mt-2">
                            Display address for reference (not used for validation)
                          </p>
                        </div>

                        <div className="space-y-3">
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ">
                            <label className="text-md font-semibold text-text-primary">
                              Coordinates {locationForm.radius.trim() && <span className="text-red-500">*</span>}
                            </label>
                            <Button
                              variant="outline-primary"
                              icon={isGettingLocation ? Loader2 : Navigation}
                              onClick={handleUseCurrentLocation}
                              disabled={isGettingLocation}
                              className="flex items-center justify-center gap-2 h-10 w-full sm:w-auto shadow-sm hover:shadow-md transition-shadow border-2 border-purple-600 rounded-lg p-1"
                              iconFirst={true}
                            >
                              {isGettingLocation ? 'Getting Location...' : 'Use My Current Location'}
                            </Button>

                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label className="text-xs font-medium text-text-secondary mb-2 block">
                                Latitude
                              </label>
                              <input
                                type="number"
                                step="any"
                                value={locationForm.latitude}
                                onChange={(e) => setLocationForm({ ...locationForm, latitude: e.target.value })}
                                placeholder="e.g., 40.7589"
                                className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
                              />
                            </div>

                            <div>
                              <label className="text-xs font-medium text-text-secondary mb-2 block">
                                Longitude
                              </label>
                              <input
                                type="number"
                                step="any"
                                value={locationForm.longitude}
                                onChange={(e) => setLocationForm({ ...locationForm, longitude: e.target.value })}
                                placeholder="e.g., -73.9851"
                                className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
                              />
                            </div>
                          </div>

                          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                            <p className="text-xs text-blue-800">
                              <strong>Tip:</strong> Click "Use My Current Location" when you're at the company location, or manually enter coordinates from Google Maps (Right-click → "What's here?").
                            </p>
                          </div>
                        </div>

                        <div>
                          <label className="text-md font-semibold text-text-primary mb-3 block">
                            Radius (Optional)
                          </label>
                          <div className="space-y-3">
                            <div className="relative">
                              <select
                                value={locationForm.radiusType}
                                onChange={(e) => {
                                  const newType = e.target.value;
                                  setLocationForm({
                                    ...locationForm,
                                    radiusType: newType,
                                    radius: newType === 'preset' ? '' : locationForm.radius
                                  });
                                }}
                                className="w-full h-12 px-4 pr-10 border border-border-secondary rounded-lg text-md text-text-primary appearance-none focus:outline-none focus:border-border-accent-purple"
                              >
                                <option value="preset">Select Preset Radius</option>
                                <option value="custom">Custom Value</option>
                                <option value="none">No Radius (Remote Work)</option>
                              </select>
                              <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
                            </div>

                            {locationForm.radiusType === 'preset' && (
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                {radiusPresetOptions.map((preset) => (
                                  <button
                                    key={preset}
                                    type="button"
                                    onClick={() => setLocationForm({ ...locationForm, radius: preset })}
                                    className={`h-12 px-4 border rounded-lg text-md font-medium transition-colors ${locationForm.radius === preset
                                      ? 'border-border-accent-purple bg-purple-50 text-text-accent-purple'
                                      : 'border-border-secondary bg-white text-text-secondary hover:border-border-accent-purple'
                                      }`}
                                  >
                                    {preset}
                                  </button>
                                ))}
                              </div>
                            )}

                            {locationForm.radiusType === 'custom' && (
                              <input
                                type="text"
                                value={locationForm.radius}
                                onChange={(e) => setLocationForm({ ...locationForm, radius: e.target.value })}
                                placeholder="e.g., 750m, 0.5km, 2km, 500 meters"
                                className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
                              />
                            )}

                            {locationForm.radiusType === 'none' && (
                              <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                                <p className="text-sm text-green-800">
                                  This location will have no radius restrictions. Users can clock in/out from anywhere.
                                </p>
                              </div>
                            )}

                            {locationForm.radius && (
                              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                                <p className="text-sm text-blue-800">
                                  <strong>Selected:</strong> {locationForm.radius} radius
                                </p>
                              </div>
                            )}

                            <p className="text-xs text-text-secondary">
                              {locationForm.radiusType === 'preset'
                                ? 'Select a preset radius or choose custom value. If radius is set, latitude and longitude are required.'
                                : locationForm.radiusType === 'custom'
                                  ? 'Enter custom radius value (e.g., "750m", "0.5km", "2km"). If radius is set, latitude and longitude are required.'
                                  : 'No radius restriction - users can clock in/out from anywhere. Latitude and longitude are optional.'}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons - Sticky */}
                    <div className="border-t border-border-secondary p-6 pt-4 flex-shrink-0 bg-white rounded-b-[24px]">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <Button
                          onClick={handleCloseLocationModal}
                          variant='outline-secondary'
                          cn='h-12 w-full sm:col-span-1'
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={handleSaveLocation}
                          variant='gradient'
                          cn="h-12 w-full sm:col-span-2 flex justify-center"
                          icon={editingLocation ? Edit2 : Plus}
                          iconFirst={true}
                          disabled={isSavingLocation}
                        >
                          <span>{isSavingLocation ? 'Saving...' : (editingLocation ? 'Update Location' : 'Add Location')}</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Delete Confirmation Modal */}
              <DeleteConfirmationModal
                isOpen={showDeleteModal}
                onClose={() => {
                  setShowDeleteModal(false);
                  setLocationToDelete(null);
                }}
                onConfirm={handleDeleteLocation}
                title="Delete Location"
                description="Are you sure you want to delete this location? This action cannot be undone."
                confirmButtonText="Delete Location"
                cancelButtonText="Cancel"
                itemDetails={locationToDelete ? {
                  name: locations.find(loc => loc.id === locationToDelete)?.name || 'Location',
                  subtitle: locations.find(loc => loc.id === locationToDelete)?.address || null
                } : null}
                variant="danger"
              />
            </>
          )}
        </div>
      </div >
    </div >
  );
};

export default SettingsPage;