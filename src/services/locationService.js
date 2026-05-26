/**
 * Location Service - Free geolocation validation using browser API and Haversine formula
 * No paid APIs required
 */

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param {number} lat1 - Latitude of first point
 * @param {number} lon1 - Longitude of first point
 * @param {number} lat2 - Latitude of second point
 * @param {number} lon2 - Longitude of second point
 * @returns {number} Distance in meters
 */
export const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
    Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c; // Distance in meters

  return Math.round(distance);
};

/**
 * Convert degrees to radians
 */
const toRadians = (degrees) => {
  return degrees * (Math.PI / 180);
};

/**
 * Get user's current location using browser Geolocation API
 * @returns {Promise<{latitude: number, longitude: number, accuracy: number}>}
 */
/**
 * Get user's current location using browser Geolocation API
 * Robust implementation with multiple fallback strategies
 * @returns {Promise<{latitude: number, longitude: number, accuracy: number}>}
 */
/**
 * Get user's current location using browser Geolocation API
 * Robust implementation with multiple fallback strategies and retries
 * @returns {Promise<{latitude: number, longitude: number, accuracy: number}>}
 */
/**
 * Get user's current location using browser Geolocation API
 * @param {Object} opts
 * @param {boolean} [opts.forceFresh=false] When true, skip cached reads (maxAge=0)
 * @param {number} [opts.maxCachedAgeMs=60000] Max age for cached location in ms (used when forceFresh is false)
 * @returns {Promise<{latitude: number, longitude: number, accuracy: number, isFallback?: boolean}>}
 */
export const getUserCurrentLocation = async (opts = {}) => {
  if (!navigator.geolocation) {
    throw new Error('Geolocation is not supported by your browser');
  }

  const forceFresh = !!opts.forceFresh;
  const maxCachedAgeMs = Number.isFinite(opts.maxCachedAgeMs) ? opts.maxCachedAgeMs : 60000;

  // Helper to wrap callback-based API in Promise
  const attemptPosition = (options, retriesLeft = 0) => {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        resolve,
        async (error) => {
          // If error is timeout (3) or unavailable (2), and we have retries
          if (retriesLeft > 0 && (error.code === 3 || error.code === 2)) {
            console.warn(`Location attempt failed (${error.message}), retrying... (${retriesLeft} left)`);
            try {
              const retryResult = await attemptPosition(options, retriesLeft - 1);
              resolve(retryResult);
            } catch (retryError) {
              reject(retryError);
            }
          } else {
            reject(error);
          }
        },
        options
      );
    });
  };

  // Strategy 1: Fast cache check (optional)
  // IMPORTANT: Do NOT accept arbitrarily old cached positions, as that can incorrectly
  // validate "within radius" after the user moves away from an allowed site.
  if (!forceFresh) {
    try {
      const position = await attemptPosition({
        enableHighAccuracy: false,
        timeout: 1000,
        maximumAge: Math.max(0, maxCachedAgeMs)
      }, 0);
      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy
      };
    } catch (e) {
      // Ignore cache error and proceed to fresh fetch
    }
  }

  // Strategy 2: High Accuracy (GPS) with Retry
  // Timeout 15s, 1 Retry allowed (Total max wait: 30s)
  try {
    const position = await attemptPosition({
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: forceFresh ? 0 : 5000 // Only very fresh cache allowed here
    }, 1); // 1 Retry allowed

    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy
    };
  } catch (error) {
    console.warn('[LocationService] High accuracy failed, falling back to Low Accuracy...', error.message);

    // Strategy 3: Fallback to Low Accuracy (Wifi/Cell)
    // Timeout extended to 20s, 1 Retry allowed
    try {
      const position = await attemptPosition({
        enableHighAccuracy: false,
        timeout: 20000,
        maximumAge: forceFresh ? 0 : Math.max(0, maxCachedAgeMs) // Avoid very stale results
      }, 1);

      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        isFallback: true
      };
    } catch (fallbackError) {
      let errorMessage = 'Unable to get your location';
      let errorType = 'UNKNOWN';

      switch (fallbackError.code) {
        case 1: // PERMISSION_DENIED
          errorMessage = 'Location permission denied. Please enable location access in your browser settings.';
          errorType = 'PERMISSION_DENIED';
          break;
        case 2: // POSITION_UNAVAILABLE
          errorMessage = 'Location signal not available. Please check your GPS/Network or move outdoors.';
          errorType = 'POSITION_UNAVAILABLE';
          break;
        case 3: // TIMEOUT
          errorMessage = 'Location request timed out. Please check your signal and try again.';
          errorType = 'TIMEOUT';
          break;
        default:
          errorMessage = fallbackError.message || 'Unknown location error';
      }

      // Enhance error object
      const enhancedError = new Error(errorMessage);
      enhancedError.code = fallbackError.code;
      enhancedError.type = errorType;
      throw enhancedError;
    }
  }
};

/**
 * Check if user is within any allowed location
 * @param {number} userLat - User's latitude
 * @param {number} userLon - User's longitude
 * @param {Array} locations - Array of company locations
 * @returns {Object} {isValid: boolean, nearestLocation: Object|null, distance: number|null, message: string}
 */
export const checkUserLocation = (userLat, userLon, locations) => {
  if (!locations || locations.length === 0) {
    // No locations configured - allow clock in/out (backward compatible)
    return {
      isValid: true,
      nearestLocation: null,
      distance: null,
      message: 'No location restrictions configured'
    };
  }

  let nearestLocation = null;
  let minDistance = Infinity;

  // Check each location
  for (const location of locations) {
    // If location has no radius restriction (e.g., "Remote Work"), always allow
    if (!location.radius || location.radius === null) {
      return {
        isValid: true,
        nearestLocation: location,
        distance: null,
        message: `Within allowed location: ${location.name}`
      };
    }

    // If location has no coordinates, skip it
    if (location.latitude === null || location.latitude === undefined ||
      location.longitude === null || location.longitude === undefined) {
      continue;
    }

    // Calculate distance to this location
    const distance = calculateDistance(
      userLat,
      userLon,
      location.latitude,
      location.longitude
    );

    // Check if within radius (convert radius to meters if needed)
    const radiusInMeters = parseRadiusToMeters(location.radius);

    if (distance <= radiusInMeters) {
      // User is within this location's radius
      return {
        isValid: true,
        nearestLocation: location,
        distance: distance,
        message: `Within ${location.name} (${distance}m away)`
      };
    }

    // Track nearest location for error message
    if (distance < minDistance) {
      minDistance = distance;
      nearestLocation = location;
    }
  }

  // User is not within any location
  return {
    isValid: false,
    nearestLocation: nearestLocation,
    distance: minDistance,
    message: nearestLocation
      ? `You are ${minDistance}m away from ${nearestLocation.name}. Please move within ${parseRadiusToMeters(nearestLocation.radius)}m to clock in/out.`
      : 'You are not within any allowed location.'
  };
};

/**
 * Parse radius string to meters
 * Handles formats like "100m", "100m Radius", "0.5km", "500 meters"
 * @param {string|number} radius - Radius value
 * @returns {number} Radius in meters
 */
const parseRadiusToMeters = (radius) => {
  if (typeof radius === 'number') {
    return radius;
  }

  if (typeof radius !== 'string') {
    return 0;
  }

  // Extract number and unit — longer alternatives must come before shorter ones
  // to avoid 'm' matching the start of 'mile' or 'meter' before the full word is tried
  const match = radius.match(/([\d.]+)\s*(kilometers?|meters?|miles?|km|mi|m)?/i);

  if (!match) {
    return 0;
  }

  const value = parseFloat(match[1]);
  const unit = (match[2] || 'm').toLowerCase();

  // Convert to meters
  if (unit.startsWith('km') || unit.startsWith('kilo')) {
    return value * 1000;
  } else if (unit.startsWith('mi')) {
    return value * 1609.34;
  } else {
    return value;
  }
};

/**
 * Format distance for display
 */
export const formatDistance = (distanceInMeters) => {
  if (distanceInMeters < 1000) {
    return `${distanceInMeters}m`;
  } else {
    return `${(distanceInMeters / 1000).toFixed(2)}km`;
  }
};

/**
 * Get verification status for GPS location vs assigned location
 * @param {Object} actualGPS - { lat, lng }
 * @param {Object} assignedLocation - Work location with latitude, longitude, radius
 * @returns {Object} { status: 'success'|'warning'|'error'|'none', label, color, icon, distance }
 */
export const getVerificationStatus = (actualGPS, assignedLocation) => {
  // No assigned location
  if (!assignedLocation || !assignedLocation.latitude || !assignedLocation.longitude) {
    return {
      status: 'none',
      label: 'No Location',
      color: 'gray',
      icon: '📍',
      distance: null
    };
  }

  // No GPS data captured
  if (!actualGPS || !actualGPS.lat || !actualGPS.lng) {
    return {
      status: 'error',
      label: 'No GPS',
      color: 'red',
      icon: '🚫',
      distance: null
    };
  }

  // Calculate distance
  const distance = calculateDistance(
    actualGPS.lat,
    actualGPS.lng,
    assignedLocation.latitude,
    assignedLocation.longitude
  );

  // Parse radius (e.g., "100m" -> 100, "1km" -> 1000)
  let radiusMeters = null;
  if (assignedLocation.radius && assignedLocation.radius !== 'No Restriction') {
    const radiusStr = assignedLocation.radius.toLowerCase();
    if (radiusStr.includes('km')) {
      radiusMeters = parseFloat(radiusStr) * 1000;
    } else {
      radiusMeters = parseFloat(radiusStr);
    }
  }

  // No radius restriction
  if (!radiusMeters) {
    return {
      status: 'success',
      label: 'Verified',
      color: 'green',
      icon: '✅',
      distance: distance
    };
  }

  // Within radius
  if (distance <= radiusMeters) {
    return {
      status: 'success',
      label: 'Within Radius',
      color: 'green',
      icon: '✅',
      distance: distance
    };
  }

  // Close but outside radius (within 100m of boundary)
  if (distance <= radiusMeters + 100) {
    return {
      status: 'warning',
      label: 'Near Location',
      color: 'yellow',
      icon: '⚠️',
      distance: distance
    };
  }

  // Far from location
  return {
    status: 'error',
    label: 'Outside Radius',
    color: 'red',
    icon: '❌',
    distance: distance
  };
};

/**
 * Check if GPS coordinates are within radius of assigned location
 * @param {Object} actualGPS - { lat, lng }
 * @param {Object} assignedLocation - Work location with latitude, longitude, radius
 * @returns {boolean}
 */
export const isWithinRadius = (actualGPS, assignedLocation) => {
  if (!actualGPS || !assignedLocation || !assignedLocation.latitude || !assignedLocation.longitude) {
    return false;
  }

  const distance = calculateDistance(
    actualGPS.lat,
    actualGPS.lng,
    assignedLocation.latitude,
    assignedLocation.longitude
  );

  // Parse radius
  let radiusMeters = null;
  if (assignedLocation.radius && assignedLocation.radius !== 'No Restriction') {
    const radiusStr = assignedLocation.radius.toLowerCase();
    if (radiusStr.includes('km')) {
      radiusMeters = parseFloat(radiusStr) * 1000;
    } else {
      radiusMeters = parseFloat(radiusStr);
    }
  }

  // No radius restriction means always within
  if (!radiusMeters) {
    return true;
  }

  return distance <= radiusMeters;
};


