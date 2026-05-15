// Auto Clock-Out Shim for MPRAR HR Frontend
// Mocks auto clock-out functionality to prevent build errors.

export const initializeAutoClockOut = () => {
  console.log('[AutoClockOut] Initialized (Shim)');
};

export const stopAutoClockOut = () => {};

export const checkAndAutoClockOutAll = async () => {};
export const shouldAutoClockOut = () => false;
export const getAutoClockOutTime = () => new Date();
export const performAutoClockOut = async () => {};

export const getCompanyAutoClockOutConfig = async () => ({});
export const getDefaultAutoClockOutTimes = () => ({});

export default {
  initializeAutoClockOut,
  stopAutoClockOut,
  checkAndAutoClockOutAll,
  shouldAutoClockOut,
  getAutoClockOutTime,
  performAutoClockOut,
  getCompanyAutoClockOutConfig,
  getDefaultAutoClockOutTimes
};
