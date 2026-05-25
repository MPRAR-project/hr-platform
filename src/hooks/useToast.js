/**
 * useToast.js
 *
 * Standardized toast notification hook for the entire HR platform.
 * Wraps react-toastify with consistent styles and durations.
 *
 * Usage:
 *   const toast = useToast();
 *   toast.success('Timesheet approved!');
 *   toast.error('Failed to submit timesheet');
 *   toast.info('Week has not ended yet');
 *   toast.warning('This action cannot be undone');
 */
import { toast as _toast } from 'react-toastify';

const DEFAULTS = {
  position: 'top-right',
  autoClose: 4000,
  hideProgressBar: false,
  closeOnClick: true,
  pauseOnHover: true,
  draggable: true,
};

const DURATIONS = {
  success: 3500,
  error: 6000,
  info: 4000,
  warning: 5000,
};

export function useToast() {
  const success = (message, options = {}) => {
    _toast.success(message, { ...DEFAULTS, autoClose: DURATIONS.success, ...options });
  };

  const error = (message, options = {}) => {
    _toast.error(message, { ...DEFAULTS, autoClose: DURATIONS.error, ...options });
  };

  const info = (message, options = {}) => {
    _toast.info(message, { ...DEFAULTS, autoClose: DURATIONS.info, ...options });
  };

  const warning = (message, options = {}) => {
    _toast.warning(message, { ...DEFAULTS, autoClose: DURATIONS.warning, ...options });
  };

  const dismiss = (id) => {
    if (id) _toast.dismiss(id);
    else _toast.dismiss();
  };

  const promise = (promiseFn, { pending, success: successMsg, error: errorMsg } = {}) => {
    return _toast.promise(promiseFn, {
      pending: pending || 'Processing...',
      success: successMsg || 'Done!',
      error: errorMsg || 'Something went wrong',
    }, DEFAULTS);
  };

  return { success, error, info, warning, dismiss, promise };
}

// Static version for use outside React components (e.g. service files)
export const toast = {
  success: (msg, opts) => _toast.success(msg, { ...DEFAULTS, autoClose: DURATIONS.success, ...opts }),
  error: (msg, opts) => _toast.error(msg, { ...DEFAULTS, autoClose: DURATIONS.error, ...opts }),
  info: (msg, opts) => _toast.info(msg, { ...DEFAULTS, autoClose: DURATIONS.info, ...opts }),
  warning: (msg, opts) => _toast.warning(msg, { ...DEFAULTS, autoClose: DURATIONS.warning, ...opts }),
  dismiss: (id) => _toast.dismiss(id),
};

export default useToast;
