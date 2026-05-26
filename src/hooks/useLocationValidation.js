import { useState, useEffect, useCallback, useMemo } from 'react';
import { getUserCurrentLocation, checkUserLocation } from '../services/locationService';
import { useAuth } from './useAuth';
import hrApiClient from '../lib/hrApiClient';

/**
 * Hook to validate user location for clock in/out.
 * If the current user is in the company's remoteEmployeeIds list, location
 * restrictions are bypassed entirely (O(1) Set lookup).
 */
export const useLocationValidation = (checkInterval = 30000) => {
  const { user } = useAuth();
  const [isLocationValid, setIsLocationValid] = useState(false);
  const [isCheckingLocation, setIsCheckingLocation] = useState(true);
  const [locationError, setLocationError] = useState(null);
  const [locationMessage, setLocationMessage] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [companyLocations, setCompanyLocations] = useState([]);
  const [locationsLoaded, setLocationsLoaded] = useState(false);
  const [remoteEmployeeIdSet, setRemoteEmployeeIdSet] = useState(new Set());

  // Derived: is current user authorized for remote work?
  const isRemoteEmployee = useMemo(
    () => remoteEmployeeIdSet.has(user?.id || ''),
    [remoteEmployeeIdSet, user?.id]
  );

  // Load company locations + remoteEmployeeIds in one request
  useEffect(() => {
    const fetchLocations = async () => {
      if (!user?.companyId) {
        setCompanyLocations([]);
        setRemoteEmployeeIdSet(new Set());
        setLocationsLoaded(true);
        return;
      }

      try {
        const { data } = await hrApiClient.get('/hr/company');
        const locations = data.company?.locations || [];
        const remoteIds = new Set(data.company?.remoteEmployeeIds || []);
        setCompanyLocations(locations);
        setRemoteEmployeeIdSet(remoteIds);
        setLocationsLoaded(true);
      } catch (error) {
        console.error('Error fetching company data:', error);
        setCompanyLocations([]);
        setRemoteEmployeeIdSet(new Set());
        setLocationsLoaded(true);
      }
    };

    fetchLocations();
  }, [user?.companyId]);

  const checkLocation = useCallback(async (opts = {}) => {
    if (!user?.companyId) {
      setIsLocationValid(true);
      setIsCheckingLocation(false);
      setLocationError(null);
      setLocationMessage('No location restrictions configured');
      return { isValid: true, message: 'No location restrictions configured', error: null, userLocation: null };
    }

    if (!locationsLoaded) return null;

    // Remote employee bypass — O(1) Set lookup
    if (remoteEmployeeIdSet.has(user.id)) {
      setIsLocationValid(true);
      setIsCheckingLocation(false);
      setLocationError(null);
      setLocationMessage('Remote work authorized');
      return { isValid: true, message: 'Remote work authorized', isRemote: true, error: null, userLocation: null };
    }

    if (companyLocations.length === 0) {
      setIsLocationValid(true);
      setLocationError(null);
      setLocationMessage('No location restrictions configured');
      setIsCheckingLocation(false);
      return { isValid: true, message: 'No location restrictions configured', error: null, userLocation: null };
    }

    setIsCheckingLocation(true);
    setLocationError(null);

    try {
      const currentLocation = await getUserCurrentLocation({ forceFresh: !!opts.forceFresh });
      setUserLocation(currentLocation);
      const result = checkUserLocation(
        currentLocation.latitude,
        currentLocation.longitude,
        companyLocations
      );
      setIsLocationValid(result.isValid);
      setLocationMessage(result.message);
      setLocationError(result.isValid ? null : result.message);
      return {
        isValid: result.isValid,
        message: result.message || null,
        error: result.isValid ? null : (result.message || null),
        userLocation: currentLocation,
        nearestLocation: result.nearestLocation || null,
        distance: typeof result.distance === 'number' ? result.distance : null
      };
    } catch (error) {
      console.error('[useLocationValidation] Location check error:', error);
      setLocationError(error.message);
      if (error.type === 'PERMISSION_DENIED') {
        setIsCheckingLocation(false);
      }
      setIsLocationValid(false);
      return { isValid: false, message: null, error: error.message || 'Unable to get your location', userLocation: null };
    } finally {
      setIsCheckingLocation(false);
    }
  }, [user?.companyId, user?.id, companyLocations, locationsLoaded, remoteEmployeeIdSet]);

  const locationsKey = useMemo(() => {
    return JSON.stringify(companyLocations.map(loc => ({
      id: loc.id,
      latitude: loc.latitude,
      longitude: loc.longitude,
      radius: loc.radius
    })).sort((a, b) => (a.id || '').localeCompare(b.id || '')));
  }, [companyLocations]);

  // Run check when locations or remote set changes, and on interval
  useEffect(() => {
    if (!locationsLoaded) return;

    // Remote bypass: no need to poll GPS
    if (isRemoteEmployee) {
      setIsLocationValid(true);
      setLocationError(null);
      setLocationMessage('Remote work authorized');
      setIsCheckingLocation(false);
      return;
    }

    if (companyLocations.length === 0) {
      setIsLocationValid(true);
      setLocationError(null);
      setLocationMessage('No location restrictions configured');
      setIsCheckingLocation(false);
      return;
    }

    checkLocation();
    const interval = setInterval(() => checkLocation(), checkInterval);
    return () => clearInterval(interval);
  }, [checkLocation, locationsKey, checkInterval, locationsLoaded, isRemoteEmployee]);

  const loadCompanyLocations = useCallback(async () => {
    checkLocation();
  }, [checkLocation]);

  return {
    isLocationValid,
    isCheckingLocation,
    locationError,
    locationMessage,
    userLocation,
    companyLocations,
    checkLocation,
    loadCompanyLocations,
    isRemoteEmployee
  };
};
