export function getDefaultAutoLunchConfig() {
  return {
    enabled: false,
    thresholdHours: 6,
    lunchBreakMinutes: 30,
  };
}

export function invalidateAutoLunchCaches() {
  // No-op — moved to direct API calls
}
