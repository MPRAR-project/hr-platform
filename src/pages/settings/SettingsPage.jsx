import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight, Edit2, Loader2, MapPin, Navigation, Plus, Search, Trash2, Users, Wifi, X, Upload } from 'lucide-react';
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
    payrollEmail: '',
    industry: '',
    website: '',
    phone: '',
    address: '',
    contactEmail: '',
  });
  const [isLoading, setIsLoading] = useState(true);
  const { user, refreshWeekStartDay } = useAuth();
  const [activeTab, setActiveTab] = useState('general');
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingLocation, setIsSavingLocation] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saveError, setSaveError] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(null);

  // Company Logo State
  const [companyLogoURL, setCompanyLogoURL] = useState(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);




  useEffect(() => {
    const loadCompany = async () => {
      try {
        setLoadError(null);
        setIsLoading(true);

        const companyPath = user?.companyId || '';
        const companyId = companyPath.includes('/') ? companyPath.split('/')[1] : companyPath;
        if (!companyId) {
          setIsLoading(false);
          return;
        }

        // Load company data
        const company = await getCompany(companyId);

        if (company) {
            const c = company.company || company;
          setCompanyInfo({
            companyName: c.name || '',
            payrollEmail: c.payrollEmail || '',
            industry: c.industry || '',
            website: c.website || '',
            phone: c.phone || '',
            address: c.address || '',
            contactEmail: c.contactEmail || '',
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
          setRemoteEmployeeIds(Array.isArray(c.remoteEmployeeIds) ? c.remoteEmployeeIds : []);

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
        setLoadError('Failed to load company info. Please refresh the page.');
        console.error('Error loading company data:', e);
      } finally {
        setIsLoading(false);
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
    radius: '',      // number string when custom, preset string when preset
    radiusType: 'preset', // 'preset' | 'custom'
    customUnit: 'm'  // 'm' | 'km' — only used when radiusType === 'custom'
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
    // Validate required fields
    const errors = {};
    if (!companyInfo.companyName.trim()) {
      errors.companyName = 'Company name is required';
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (companyInfo.payrollEmail && !emailRegex.test(companyInfo.payrollEmail)) {
      errors.payrollEmail = 'Please enter a valid payroll email address';
    }
    if (companyInfo.contactEmail && !emailRegex.test(companyInfo.contactEmail)) {
      errors.contactEmail = 'Please enter a valid contact email address';
    }
    const perDayHoursNum = Number(timesheetSettings.perDayHours);
    if (!Number.isFinite(perDayHoursNum) || perDayHoursNum < 0 || perDayHoursNum > 24) {
      errors.perDayHours = 'Hours per day must be between 0 and 24';
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      toast.error('Please fix the highlighted errors before saving');
      return;
    }
    setFieldErrors({});

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
      const clampedPerDayHours = Math.max(0, Math.min(24, perDayHoursNum));
      await updateCompanyProfile(companyId, {
        name: companyInfo.companyName.trim(),
        payrollEmail: companyInfo.payrollEmail.trim() || null,
        industry: companyInfo.industry.trim() || null,
        website: companyInfo.website.trim() || null,
        phone: companyInfo.phone.trim() || null,
        address: companyInfo.address.trim() || null,
        contactEmail: companyInfo.contactEmail.trim() || null,
        workSchedule: workSchedule,
        workingDays: timesheetSettings.workingDays,
        roundingRules,
        lunchBreakMinutes,
        // weekStartDay is set once at registration — intentionally excluded
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
        perDayHours: clampedPerDayHours,
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

      toast.success('Settings saved successfully');
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.error || 'Failed to save changes. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  // Removed propagateWeekStartDay as backend handles this via unified profile update

  const handleAddLocation = () => {
    setEditingLocation(null);
    setLocationForm({ name: '', address: '', latitude: '', longitude: '', radius: '', radiusType: 'preset', customUnit: 'm' });
    setShowLocationModal(true);
  };

  const handleEditLocation = (location) => {
    setEditingLocation(location);
    const existingRadius = location.radius || '';
    const isPreset = radiusPresetOptions.includes(existingRadius);
    let customValue = '';
    let customUnit = 'm';
    if (existingRadius && !isPreset) {
      const match = existingRadius.match(/^([\d.]+)\s*(km|m)$/i);
      if (match) {
        customValue = match[1];
        customUnit = match[2].toLowerCase();
      } else {
        customValue = existingRadius;
      }
    }
    setLocationForm({
      name: location.name || '',
      address: location.address || '',
      latitude: location.latitude?.toString() || '',
      longitude: location.longitude?.toString() || '',
      radius: isPreset ? existingRadius : customValue,
      radiusType: isPreset ? 'preset' : (existingRadius ? 'custom' : 'preset'),
      customUnit
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
    if (locationForm.radiusType === 'preset') {
      if (!locationForm.radius.trim()) {
        toast.error('Please select a preset radius.');
        return;
      }
      finalRadius = locationForm.radius.trim();
    } else if (locationForm.radiusType === 'custom') {
      const rawNum = locationForm.radius.trim();
      if (!rawNum) {
        toast.error('Please enter a radius value.');
        return;
      }
      const num = parseFloat(rawNum);
      if (isNaN(num) || num <= 0) {
        toast.error('Radius must be a positive number (e.g., 500 meters or 1.5 km).');
        return;
      }
      finalRadius = `${num}${locationForm.customUnit}`;
    }

    // If radius is provided, coordinates are required
    if (finalRadius && (latitude === null || longitude === null)) {
      toast.error('Latitude and longitude are required when a radius is set.');
      return;
    }

    const companyPath = user?.companyId || '';
    const companyId = companyPath.includes('/') ? companyPath.split('/')[1] : companyPath;
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
      setLocationForm({ name: '', address: '', latitude: '', longitude: '', radius: '', radiusType: 'preset', customUnit: 'm' });
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
    setLocationForm({ name: '', address: '', latitude: '', longitude: '', radius: '', radiusType: 'preset', customUnit: 'm' });
  };

  const handleDeleteClick = (locationId) => {
    setLocationToDelete(locationId);
    setShowDeleteModal(true);
  };

  const handleDeleteLocation = async () => {
    if (!locationToDelete) return;

    const companyPath = user?.companyId || '';
    const companyId = companyPath.includes('/') ? companyPath.split('/')[1] : companyPath;
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
      setLocationForm(prev => ({
        ...prev,
        latitude: location.latitude.toString(),
        longitude: location.longitude.toString()
      }));
      toast.success('Location captured successfully!');
    } catch (error) {
      console.error('Error getting current location:', error);
      toast.error(error.message || 'Failed to get your current location. Please enter coordinates manually.');
    } finally {
      setIsGettingLocation(false);
    }
  };

  const getCompanyId = () => {
    const companyPath = user?.companyId || '';
    return companyPath.includes('/') ? companyPath.split('/')[1] : companyPath;
  };

  // Toggle a single employee in the pending selection
  const togglePendingEmployee = (empId) => {
    setPendingSelectionIds(prev => {
      const next = new Set(prev);
      next.has(empId) ? next.delete(empId) : next.add(empId);
      return next;
    });
  };

  // Toggle-select all employees on the current picker page
  const toggleSelectCurrentPage = () => {
    const allSelected = pagedAvailableEmployees.length > 0 &&
      pagedAvailableEmployees.every(e => pendingSelectionIds.has(e.id));
    setPendingSelectionIds(prev => {
      const next = new Set(prev);
      if (allSelected) {
        pagedAvailableEmployees.forEach(e => next.delete(e.id));
      } else {
        pagedAvailableEmployees.forEach(e => next.add(e.id));
      }
      return next;
    });
  };

  // Batch-add all pending selections to remote work
  const handleAddSelectedRemoteEmployees = async () => {
    if (pendingSelectionIds.size === 0) return;
    const idsToAdd = [...pendingSelectionIds];
    const newIds = [...new Set([...remoteEmployeeIds, ...idsToAdd])].sort();
    const snapshot = [...remoteEmployeeIds];
    setRemoteEmployeeIds(newIds);
    setPendingSelectionIds(new Set());
    setEmployeeBrowsePage(0);
    setShowRemoteDropdown(false);

    const companyId = getCompanyId();
    if (!companyId) return;
    setIsSavingRemote(true);
    try {
      await updateCompanyProfile(companyId, { remoteEmployeeIds: newIds });
      await invalidateCompanyCache(companyId);
      toast.success(`${idsToAdd.length} employee${idsToAdd.length !== 1 ? 's' : ''} added to remote work`);
    } catch (err) {
      setRemoteEmployeeIds(snapshot);
      setShowRemoteDropdown(true);
      toast.error('Failed to add employees. Please try again.');
    } finally {
      setIsSavingRemote(false);
    }
  };

  const handleRemoveRemoteEmployee = async (employeeId) => {
    const newIds = remoteEmployeeIds.filter(id => id !== employeeId);
    setRemoteEmployeeIds(newIds);
    // If removal empties the current page, jump back one page
    const newTotal = Math.max(1, Math.ceil(newIds.length / REMOTE_PAGE_SIZE));
    setRemoteListPage(p => Math.min(p, newTotal - 1));

    const companyId = getCompanyId();
    if (!companyId) return;
    setIsSavingRemote(true);
    try {
      await updateCompanyProfile(companyId, { remoteEmployeeIds: newIds });
      await invalidateCompanyCache(companyId);
      toast.success('Employee removed from remote work');
    } catch (err) {
      // Rollback on failure
      setRemoteEmployeeIds(remoteEmployeeIds);
      toast.error('Failed to update remote work employees. Please try again.');
    } finally {
      setIsSavingRemote(false);
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

  // ── Remote Work Employees ── all new hooks after original isDraggingLogo hook
  const [remoteEmployeeIds, setRemoteEmployeeIds] = useState([]);
  const [allEmployees, setAllEmployees] = useState([]);
  const [isLoadingEmployees, setIsLoadingEmployees] = useState(false);
  const [isSavingRemote, setIsSavingRemote] = useState(false);
  const [remoteSearchQuery, setRemoteSearchQuery] = useState('');
  const [showRemoteDropdown, setShowRemoteDropdown] = useState(false);
  const [employeeBrowsePage, setEmployeeBrowsePage] = useState(0);
  const [remoteListPage, setRemoteListPage] = useState(0);

  // Close remote-work dropdown on outside click
  useEffect(() => {
    if (!showRemoteDropdown) return;
    const handler = () => { setShowRemoteDropdown(false); setPendingSelectionIds(new Set()); };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showRemoteDropdown]);

  // Load all company employees for remote-work assignment
  useEffect(() => {
    if (!user?.companyId) return;
    const fetchEmployees = async () => {
      setIsLoadingEmployees(true);
      try {
        const { data } = await hrApiClient.get('/hr/employees?limit=500');
        setAllEmployees(data.employees || []);
      } catch (err) {
        console.error('Failed to load employees:', err);
      } finally {
        setIsLoadingEmployees(false);
      }
    };
    fetchEmployees();
  }, [user?.companyId]);

  const REMOTE_PAGE_SIZE = 6;

  const remoteEmployeeIdSet = useMemo(() => new Set(remoteEmployeeIds), [remoteEmployeeIds]);

  // Sorted employees not yet remote-authorised, filtered by search query
  const filteredAvailableEmployees = useMemo(() => {
    const q = remoteSearchQuery.trim().toLowerCase();
    return allEmployees
      .filter(emp => !remoteEmployeeIdSet.has(emp.id))
      .filter(emp => {
        if (!q) return true;
        return (
          `${emp.firstName ?? ''} ${emp.lastName ?? ''}`.toLowerCase().includes(q) ||
          (emp.email ?? '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) =>
        `${a.firstName ?? ''} ${a.lastName ?? ''}`.localeCompare(`${b.firstName ?? ''} ${b.lastName ?? ''}`)
      );
  }, [allEmployees, remoteEmployeeIdSet, remoteSearchQuery]);

  const totalAvailablePages = useMemo(
    () => Math.max(1, Math.ceil(filteredAvailableEmployees.length / REMOTE_PAGE_SIZE)),
    [filteredAvailableEmployees.length]
  );

  const pagedAvailableEmployees = useMemo(
    () => filteredAvailableEmployees.slice(
      employeeBrowsePage * REMOTE_PAGE_SIZE,
      (employeeBrowsePage + 1) * REMOTE_PAGE_SIZE
    ),
    [filteredAvailableEmployees, employeeBrowsePage]
  );

  const remoteEmployeeDetails = useMemo(
    () => remoteEmployeeIds
      .map(id => allEmployees.find(e => e.id === id))
      .filter(Boolean)
      .sort((a, b) => `${a.firstName ?? ''} ${a.lastName ?? ''}`.localeCompare(`${b.firstName ?? ''} ${b.lastName ?? ''}`)),
    [remoteEmployeeIds, allEmployees]
  );

  const totalRemotePages = useMemo(
    () => Math.max(1, Math.ceil(remoteEmployeeDetails.length / REMOTE_PAGE_SIZE)),
    [remoteEmployeeDetails.length]
  );

  // IDs checked in the picker but not yet saved
  const [pendingSelectionIds, setPendingSelectionIds] = useState(() => new Set());

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
    const companyId = companyPath.includes('/') ? companyPath.split('/')[1] : companyPath;
    if (!companyId) {
      toast.error('Company ID not found');
      return;
    }

    setIsUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      // Upload file via REST API
      // Content-Type must be undefined here — setting it to 'multipart/form-data'
      // without the boundary breaks multer. Leaving it undefined lets the browser
      // auto-set 'multipart/form-data; boundary=...' correctly for FormData.
      const { data: uploadRes } = await hrApiClient.post('/hr/upload', formData, {
        headers: { 'Content-Type': undefined }
      });

      const downloadURL = uploadRes.url;

      // Update company profile via REST
      await updateCompanyProfile(companyId, {
        logoURL: downloadURL,
        updatedAt: new Date()
      });

      await invalidateCompanyCache(companyId);

      setCompanyLogoURL(downloadURL);
      window.dispatchEvent(new CustomEvent('company:logo:updated', { detail: { logoURL: downloadURL } }));
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
    const companyId = companyPath.includes('/') ? companyPath.split('/')[1] : companyPath;
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
      window.dispatchEvent(new CustomEvent('company:logo:updated', { detail: { logoURL: null } }));
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

          {/* Loading skeleton for General Settings */}
          {activeTab === 'general' && isLoading && (
            <div className="space-y-6 animate-pulse">
              <div className="flex justify-end"><div className="h-12 w-48 bg-gray-200 rounded-lg" /></div>
              <div className="bg-white rounded-base p-6 shadow-lg space-y-6">
                <div className="h-7 w-56 bg-gray-200 rounded" />
                <div className="h-24 w-40 bg-gray-100 rounded-lg" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {[1,2,3,4,5,6].map(i => <div key={i} className="h-12 bg-gray-100 rounded-lg" />)}
                  <div className="md:col-span-2 h-12 bg-gray-100 rounded-lg" />
                </div>
              </div>
              <div className="bg-white rounded-base p-6 shadow-lg space-y-4">
                <div className="h-7 w-48 bg-gray-200 rounded" />
                {[1,2,3,4].map(i => <div key={i} className="h-12 bg-gray-100 rounded-lg" />)}
              </div>
              <div className="bg-white rounded-base p-6 shadow-lg space-y-4">
                <div className="h-7 w-56 bg-gray-200 rounded" />
                <div className="h-12 bg-gray-100 rounded-lg" />
                {[1,2].map(i => <div key={i} className="h-14 bg-gray-100 rounded-lg" />)}
              </div>
            </div>
          )}

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
          ) : isLoading ? null : (
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
              {loadError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between">
                  <p className="text-sm text-red-600">{loadError}</p>
                  <button
                    onClick={() => window.location.reload()}
                    className="text-sm font-medium text-red-700 underline hover:no-underline ml-4 flex-shrink-0"
                  >
                    Reload page
                  </button>
                </div>
              )}
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
                        onClick={(e) => { e.target.value = null; }}
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
                  {/* Company Name */}
                  <div>
                    <label className="text-md font-medium text-text-primary mb-3 block">
                      Company Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={companyInfo.companyName}
                      onChange={(e) => {
                        setCompanyInfo({ ...companyInfo, companyName: e.target.value });
                        if (fieldErrors.companyName) setFieldErrors(prev => ({ ...prev, companyName: undefined }));
                      }}
                      placeholder="e.g., Apex Corporation"
                      className={`w-full h-12 px-4 border rounded-lg text-md text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple ${fieldErrors.companyName ? 'border-red-400 bg-red-50' : 'border-border-secondary'}`}
                    />
                    {fieldErrors.companyName && <p className="text-xs text-red-500 mt-1">{fieldErrors.companyName}</p>}
                  </div>

                  {/* Industry */}
                  <div>
                    <label className="text-md font-medium text-text-primary mb-3 block">
                      Industry
                    </label>
                    <input
                      type="text"
                      value={companyInfo.industry}
                      onChange={(e) => setCompanyInfo({ ...companyInfo, industry: e.target.value })}
                      placeholder="e.g., Professional Services"
                      className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
                    />
                  </div>

                  {/* Website */}
                  <div>
                    <label className="text-md font-medium text-text-primary mb-3 block">
                      Website
                    </label>
                    <input
                      type="url"
                      value={companyInfo.website}
                      onChange={(e) => setCompanyInfo({ ...companyInfo, website: e.target.value })}
                      placeholder="https://www.yourcompany.com"
                      className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
                    />
                  </div>

                  {/* Phone */}
                  <div>
                    <label className="text-md font-medium text-text-primary mb-3 block">
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      value={companyInfo.phone}
                      onChange={(e) => setCompanyInfo({ ...companyInfo, phone: e.target.value })}
                      placeholder="e.g., +44 20 7946 0958"
                      className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
                    />
                  </div>

                  {/* Contact Email — Locked & Disabled */}
                  <div>
                    <label className="text-md font-medium text-text-primary mb-3 block">
                      Contact Email
                    </label>
                    <input
                      type="email"
                      value={companyInfo.contactEmail}
                      disabled
                      placeholder="contact@company.com"
                      className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md bg-gray-50 text-gray-400 cursor-not-allowed italic focus:outline-none"
                    />
                    <p className="text-xs text-green-600 mt-1.5 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                      Email is verified and locked for security.
                    </p>
                  </div>

                  {/* Payroll Email */}
                  <div>
                    <label className="text-md font-medium text-text-primary mb-3 block">
                      Payroll Email
                    </label>
                    <input
                      type="email"
                      value={companyInfo.payrollEmail}
                      onChange={(e) => {
                        setCompanyInfo({ ...companyInfo, payrollEmail: e.target.value });
                        if (fieldErrors.payrollEmail) setFieldErrors(prev => ({ ...prev, payrollEmail: undefined }));
                      }}
                      placeholder="payroll@company.com"
                      className={`w-full h-12 px-4 border rounded-lg text-md text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple ${fieldErrors.payrollEmail ? 'border-red-400 bg-red-50' : 'border-border-secondary'}`}
                    />
                    {fieldErrors.payrollEmail && <p className="text-xs text-red-500 mt-1">{fieldErrors.payrollEmail}</p>}
                  </div>

                  {/* Address — full width */}
                  <div className="md:col-span-2">
                    <label className="text-md font-medium text-text-primary mb-3 block">
                      Address
                    </label>
                    <input
                      type="text"
                      value={companyInfo.address}
                      onChange={(e) => setCompanyInfo({ ...companyInfo, address: e.target.value })}
                      placeholder="e.g., 1 Business Park, Canary Wharf, London, E14 5AB"
                      className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
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
                        onChange={(e) => {
                          setTimesheetSettings({ ...timesheetSettings, perDayHours: e.target.value });
                          if (fieldErrors.perDayHours) setFieldErrors(prev => ({ ...prev, perDayHours: undefined }));
                        }}
                        placeholder="8"
                        min="0"
                        max="24"
                        className={`w-full h-12 px-4 pr-16 border rounded-lg text-md text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${fieldErrors.perDayHours ? 'border-red-400 bg-red-50' : 'border-border-secondary'}`}
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-text-secondary">hours</span>
                    </div>
                    {fieldErrors.perDayHours
                      ? <p className="text-xs text-red-500 mt-1">{fieldErrors.perDayHours}</p>
                      : <p className="text-xs text-text-secondary mt-2">Standard daily hours for full-time employees</p>}
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
                        className="w-full h-12 px-4 pr-10 border border-border-secondary rounded-lg text-md text-text-primary appearance-none focus:outline-none focus:border-border-accent-purple"
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
                          className="w-full h-12 px-4 pr-10 border border-border-secondary rounded-lg text-md text-text-primary appearance-none focus:outline-none focus:border-border-accent-purple"
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
                          className="w-full h-12 px-4 pr-10 border border-border-secondary rounded-lg text-md text-text-primary appearance-none focus:outline-none focus:border-border-accent-purple"
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
                        className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple disabled:bg-gray-100"
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
                              {location.latitude != null && location.longitude != null && (
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

              {/* Remote Work Employees Section */}
              <div className="bg-white rounded-base p-6 shadow-lg">
                {/* Section header */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
                      <Wifi className="h-5 w-5 text-purple-600" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-text-primary">Remote Work Employees</h2>
                      <p className="text-sm text-text-secondary mt-0.5">
                        Employees listed here bypass all location restrictions when clocking in/out.
                      </p>
                    </div>
                  </div>
                  {isSavingRemote && (
                    <div className="flex items-center gap-2 text-sm text-purple-600 flex-shrink-0">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving…
                    </div>
                  )}
                </div>

                {/* Info banner */}
                <div className="mb-6 mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-xs text-amber-800">
                    <strong>How this works:</strong> Use this instead of adding a "No Radius" location — that would affect <em>all</em> employees. Employees added here are individually exempt from location restrictions.
                  </p>
                </div>

                {/* ── Add Employee Picker ── */}
                <div className="mb-6">
                  <label className="text-md font-semibold text-text-primary mb-3 block">
                    Add Employee to Remote Work
                  </label>

                  {/* Search input */}
                  <div className="relative" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
                      <input
                        type="text"
                        value={remoteSearchQuery}
                        onChange={(e) => {
                          setRemoteSearchQuery(e.target.value);
                          setEmployeeBrowsePage(0);
                          setShowRemoteDropdown(true);
                        }}
                        onFocus={() => setShowRemoteDropdown(true)}
                        placeholder={isLoadingEmployees ? 'Loading employees…' : 'Search by name or email, or browse below…'}
                        className="w-full h-12 pl-10 pr-10 border border-border-secondary rounded-lg text-md text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple transition-colors"
                        disabled={isLoadingEmployees}
                        autoComplete="off"
                      />
                      {remoteSearchQuery && (
                        <button
                          type="button"
                          onClick={() => { setRemoteSearchQuery(''); setEmployeeBrowsePage(0); }}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    {/* Paginated dropdown */}
                    {showRemoteDropdown && (
                      <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-border-secondary rounded-xl shadow-xl overflow-hidden">
                        {/* Loading state */}
                        {isLoadingEmployees ? (
                          <div className="flex items-center justify-center gap-2 py-8 text-sm text-text-secondary">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Loading employees…
                          </div>
                        ) : filteredAvailableEmployees.length === 0 ? (
                          /* Empty state */
                          <div className="text-center py-8">
                            <Users className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                            <p className="text-sm text-text-secondary">
                              {remoteSearchQuery.trim()
                                ? `No employees match "${remoteSearchQuery.trim()}"`
                                : allEmployees.length === 0
                                  ? 'No employees found in this company'
                                  : 'All employees are already authorised for remote work'}
                            </p>
                          </div>
                        ) : (() => {
                          const allPageSelected = pagedAvailableEmployees.length > 0 &&
                            pagedAvailableEmployees.every(e => pendingSelectionIds.has(e.id));
                          const somePageSelected = pagedAvailableEmployees.some(e => pendingSelectionIds.has(e.id));
                          return (
                            <>
                              {/* Header: count + select-all checkbox */}
                              <div className="flex items-center gap-3 px-4 pt-3 pb-2 border-b border-border-secondary">
                                <label
                                  onMouseDown={(e) => e.preventDefault()}
                                  className="flex items-center gap-2 cursor-pointer select-none flex-shrink-0"
                                  title={allPageSelected ? 'Deselect all on this page' : 'Select all on this page'}
                                >
                                  <input
                                    type="checkbox"
                                    checked={allPageSelected}
                                    ref={el => { if (el) el.indeterminate = !allPageSelected && somePageSelected; }}
                                    onChange={() => toggleSelectCurrentPage()}
                                    disabled={isSavingRemote}
                                    className="w-4 h-4 rounded accent-purple-600 cursor-pointer"
                                  />
                                  <span className="text-xs text-text-secondary">All on page</span>
                                </label>
                                <p className="text-xs text-text-secondary flex-1">
                                  {remoteSearchQuery.trim()
                                    ? `${filteredAvailableEmployees.length} result${filteredAvailableEmployees.length !== 1 ? 's' : ''} for "${remoteSearchQuery.trim()}"`
                                    : `${filteredAvailableEmployees.length} available`
                                  }
                                  {filteredAvailableEmployees.length > REMOTE_PAGE_SIZE && (
                                    <> · {employeeBrowsePage * REMOTE_PAGE_SIZE + 1}–{Math.min((employeeBrowsePage + 1) * REMOTE_PAGE_SIZE, filteredAvailableEmployees.length)}</>
                                  )}
                                </p>
                              </div>

                              {/* Employee rows — scrollable */}
                              <div className="max-h-56 overflow-y-auto">
                                {pagedAvailableEmployees.map((emp) => {
                                  const isChecked = pendingSelectionIds.has(emp.id);
                                  return (
                                    <label
                                      key={emp.id}
                                      onMouseDown={(e) => e.preventDefault()}
                                      className={`w-full flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-border-secondary last:border-b-0 ${isChecked ? 'bg-purple-50' : 'hover:bg-gray-50'} ${isSavingRemote ? 'opacity-50 pointer-events-none' : ''}`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => togglePendingEmployee(emp.id)}
                                        disabled={isSavingRemote}
                                        className="w-4 h-4 rounded accent-purple-600 cursor-pointer flex-shrink-0"
                                      />
                                      <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
                                        <span className="text-xs font-bold text-purple-700">
                                          {(emp.firstName?.[0] || '?').toUpperCase()}
                                        </span>
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-text-primary truncate">
                                          {emp.firstName} {emp.lastName}
                                        </p>
                                        <p className="text-xs text-text-secondary truncate">{emp.email}</p>
                                      </div>
                                      {isChecked && (
                                        <span className="text-xs font-medium text-purple-600 flex-shrink-0">✓</span>
                                      )}
                                    </label>
                                  );
                                })}
                              </div>

                              {/* Pagination bar */}
                              {totalAvailablePages > 1 && (
                                <div className="flex items-center justify-between px-4 py-2 border-t border-border-secondary bg-gray-50">
                                  <button
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => setEmployeeBrowsePage(p => Math.max(0, p - 1))}
                                    disabled={employeeBrowsePage === 0}
                                    className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed px-2 py-1 rounded hover:bg-gray-100 transition-colors"
                                  >
                                    <ChevronLeft className="h-3.5 w-3.5" />
                                    Prev
                                  </button>
                                  <span className="text-xs text-text-secondary">
                                    Page {employeeBrowsePage + 1} of {totalAvailablePages}
                                  </span>
                                  <button
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => setEmployeeBrowsePage(p => Math.min(totalAvailablePages - 1, p + 1))}
                                    disabled={employeeBrowsePage >= totalAvailablePages - 1}
                                    className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed px-2 py-1 rounded hover:bg-gray-100 transition-colors"
                                  >
                                    Next
                                    <ChevronRight className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              )}

                              {/* Sticky footer — confirm selection */}
                              <div className={`flex items-center justify-between px-4 py-3 border-t-2 ${pendingSelectionIds.size > 0 ? 'border-purple-200 bg-purple-50' : 'border-border-secondary bg-gray-50'}`}>
                                <span className="text-xs text-text-secondary">
                                  {pendingSelectionIds.size > 0
                                    ? <span className="font-semibold text-purple-700">{pendingSelectionIds.size} selected</span>
                                    : 'Select employees above'
                                  }
                                </span>
                                <button
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={handleAddSelectedRemoteEmployees}
                                  disabled={isSavingRemote || pendingSelectionIds.size === 0}
                                  className="flex items-center gap-1.5 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg transition-colors"
                                >
                                  {isSavingRemote ? (
                                    <>
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      Saving…
                                    </>
                                  ) : (
                                    <>
                                      + Add{pendingSelectionIds.size > 0 ? ` (${pendingSelectionIds.size})` : ''}
                                    </>
                                  )}
                                </button>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Authorised Remote Employees List ── */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-md font-semibold text-text-primary">
                      Authorised Employees
                      {remoteEmployeeDetails.length > 0 && (
                        <span className="ml-2 text-xs font-medium text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full">
                          {remoteEmployeeDetails.length}
                        </span>
                      )}
                    </h3>
                    {remoteEmployeeDetails.length > 0 && totalRemotePages > 1 && (
                      <span className="text-xs text-text-secondary">
                        {remoteListPage * REMOTE_PAGE_SIZE + 1}–{Math.min((remoteListPage + 1) * REMOTE_PAGE_SIZE, remoteEmployeeDetails.length)} of {remoteEmployeeDetails.length}
                      </span>
                    )}
                  </div>

                  {isLoadingEmployees && remoteEmployeeIds.length > 0 ? (
                    <div className="flex items-center gap-2 py-6 text-sm text-text-secondary">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading employee details…
                    </div>
                  ) : remoteEmployeeDetails.length === 0 ? (
                    <div className="text-center py-10 rounded-xl border border-dashed border-border-secondary">
                      <Users className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                      <p className="text-sm text-text-secondary font-medium">No remote employees yet</p>
                      <p className="text-xs text-text-secondary mt-1">Search above, tick one or more employees, then click <strong>+ Add</strong>.</p>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2">
                        {remoteEmployeeDetails
                          .slice(remoteListPage * REMOTE_PAGE_SIZE, (remoteListPage + 1) * REMOTE_PAGE_SIZE)
                          .map((emp) => (
                            <div
                              key={emp.id}
                              className="flex items-center justify-between p-3 border border-border-secondary rounded-lg hover:bg-bg-secondary transition-colors"
                            >
                              <div className="flex items-center gap-3 flex-1 min-w-0">
                                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center flex-shrink-0">
                                  <span className="text-sm font-bold text-white">
                                    {(emp.firstName?.[0] || '?').toUpperCase()}
                                  </span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-text-primary truncate">
                                    {emp.firstName} {emp.lastName}
                                  </p>
                                  <p className="text-xs text-text-secondary truncate">{emp.email}</p>
                                </div>
                                <span className="hidden sm:flex items-center gap-1 text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded-full font-medium flex-shrink-0">
                                  <Wifi className="h-3 w-3" />
                                  Remote
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemoveRemoteEmployee(emp.id)}
                                disabled={isSavingRemote}
                                className="ml-3 flex items-center gap-1 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 px-2 py-1.5 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
                              >
                                <X className="h-3.5 w-3.5" />
                                Remove
                              </button>
                            </div>
                          ))}
                      </div>

                      {/* Remote list pagination */}
                      {totalRemotePages > 1 && (
                        <div className="flex items-center justify-between mt-3 pt-3 border-t border-border-secondary">
                          <button
                            type="button"
                            onClick={() => setRemoteListPage(p => Math.max(0, p - 1))}
                            disabled={remoteListPage === 0}
                            className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                          >
                            <ChevronLeft className="h-4 w-4" />
                            Previous
                          </button>
                          <span className="text-sm text-text-secondary">
                            Page {remoteListPage + 1} of {totalRemotePages}
                          </span>
                          <button
                            type="button"
                            onClick={() => setRemoteListPage(p => Math.min(totalRemotePages - 1, p + 1))}
                            disabled={remoteListPage >= totalRemotePages - 1}
                            className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                          >
                            Next
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </>
                  )}
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
                              <div className="flex gap-2">
                                <input
                                  type="number"
                                  min="1"
                                  step="any"
                                  value={locationForm.radius}
                                  onChange={(e) => setLocationForm({ ...locationForm, radius: e.target.value })}
                                  placeholder="e.g. 500"
                                  className="flex-1 h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
                                />
                                <div className="relative w-32 flex-shrink-0">
                                  <select
                                    value={locationForm.customUnit}
                                    onChange={(e) => setLocationForm({ ...locationForm, customUnit: e.target.value })}
                                    className="w-full h-12 px-3 pr-9 border border-border-secondary rounded-lg text-md text-text-primary appearance-none focus:outline-none focus:border-border-accent-purple"
                                  >
                                    <option value="m">meters (m)</option>
                                    <option value="km">kilometers (km)</option>
                                  </select>
                                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
                                </div>
                              </div>
                            )}

                            {/* Preview selected radius */}
                            {locationForm.radius && (() => {
                              const preview = locationForm.radiusType === 'custom'
                                ? (parseFloat(locationForm.radius) > 0 ? `${parseFloat(locationForm.radius)}${locationForm.customUnit}` : null)
                                : locationForm.radius;
                              return preview ? (
                                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                                  <p className="text-sm text-blue-800">
                                    <strong>Radius:</strong> {preview}
                                    {locationForm.radiusType === 'custom' && locationForm.customUnit === 'km' && parseFloat(locationForm.radius) > 0 && (
                                      <span className="ml-2 text-blue-600">({(parseFloat(locationForm.radius) * 1000).toLocaleString()} m)</span>
                                    )}
                                  </p>
                                </div>
                              ) : null;
                            })()}

                            <p className="text-xs text-text-secondary">
                              {locationForm.radiusType === 'preset'
                                ? 'Select a preset radius. Latitude and longitude are required when a radius is set.'
                                : 'Enter a number and select the unit. Latitude and longitude are required when a radius is set.'}
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