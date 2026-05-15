import { useState, useEffect, useCallback, useMemo } from 'react';
import { getUserCurrentLocation, checkUserLocation } from '../services/locationService';
import { useAuth } from './useAuth';
import hrApiClient from '../lib/hrApiClient';

/**
 * Hook to validate user location for clock in/out
 * Checks location periodically and on demand
 */
export const useLocationValidation = (checkInterval = 30000) => {
  const { user } = useAuth();
  const [isLocationValid, setIsLocationValid] = useState(false); // Default to false until verified (more secure)
  const [isCheckingLocation, setIsCheckingLocation] = useState(true); // Start as checking
  const [locationError, setLocationError] = useState(null);
  const [locationMessage, setLocationMessage] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [companyLocations, setCompanyLocations] = useState([]);
  const [locationsLoaded, setLocationsLoaded] = useState(false);

  // Load company locations from REST
  useEffect(() => {
    const fetchLocations = async () => {
      if (!user?.companyId) {
        setCompanyLocations([]);
        setLocationsLoaded(true);
        return;
      }

      const companyId = user.companyId.replace('companies/', '');
      
      try {
        const { data } = await hrApiClient.get(`/hr/companies/${companyId}`);
        const locations = data.locations || [];
        setCompanyLocations(locations);
        setLocationsLoaded(true);
      } catch (error) {
        console.error('Error fetching company locations:', error);
        setCompanyLocations([]);
        setLocationsLoaded(true);
      }
    };

    fetchLocations();
  }, [user?.companyId]);

  // Check user location
  // When validating a clock-in/out action, call `checkLocation({ forceFresh: true })`
  // to avoid using stale cached geolocation results.
  const checkLocation = useCallback(async (opts = {}) => {
    if (!user?.companyId) {
      setIsLocationValid(true);
      setIsCheckingLocation(false);
      setLocationError(null);
      setLocationMessage('No location restrictions configured');
      return { isValid: true, message: 'No location restrictions configured', error: null, userLocation: null };
    }

    // Wait for locations to load first
    if (!locationsLoaded) return null;

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

      // Use the structured error message from service
      setLocationError(error.message);

      // If it's a permission denied, we might want to stop checking
      if (error.type === 'PERMISSION_DENIED') {
        setIsCheckingLocation(false);
      }

      // On error, disable actions for security
      setIsLocationValid(false);
      return { isValid: false, message: null, error: error.message || 'Unable to get your location', userLocation: null };
    } finally {
      // Only set checking to false if we haven't already disabled it
      setIsCheckingLocation(false);
    }
  }, [user?.companyId, companyLocations, locationsLoaded]);

  // Create a stable reference for location comparison
  const locationsKey = useMemo(() => {
    return JSON.stringify(companyLocations.map(loc => ({
      id: loc.id,
      latitude: loc.latitude,
      longitude: loc.longitude,
      radius: loc.radius
    })).sort((a, b) => (a.id || '').localeCompare(b.id || '')));
  }, [companyLocations]);

  // Check location when locations change or periodically
  useEffect(() => {
    if (!locationsLoaded) return;

    if (companyLocations.length === 0) {
      setIsLocationValid(true);
      setLocationError(null);
      setLocationMessage('No location restrictions configured');
      setIsCheckingLocation(false);
      return;
    }

    checkLocation();
    const interval = setInterval(() => checkLocation(), checkInterval);

    return () => {
      clearInterval(interval);
    };
  }, [checkLocation, locationsKey, checkInterval, locationsLoaded]);

  // Manual reload function (for compatibility)
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
    checkLocation, // Manual refresh function
    loadCompanyLocations
  };
};

