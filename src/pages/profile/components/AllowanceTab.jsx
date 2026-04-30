import { Briefcase, Calendar, ChevronDown, Heart, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from 'react-toastify';
import { LEAVE_TYPES } from "../../../constants/leaveTypes";
import { useAuth } from "../../../hooks/useAuth";
import { useCache } from "../../../contexts/CacheContext";
import { allowanceService } from "../../../services/allowanceService";
import { automaticAllowanceService } from "../../../services/automaticAllowanceService";

const ALLOWANCES_CACHE_TTL = 5 * 60 * 1000; // Reduced to 5 minutes for fresher data

export const AllowancesTab = ({ refreshToken = 0, selectedLeaveType: externalSelectedLeaveType, onLeaveTypeChange, absences } = {}) => {
  const { user, isLoading: authLoading } = useAuth();
  const { getItem, setItem } = useCache();
  const [loading, setLoading] = useState(true);
  const [allowances, setAllowances] = useState([]);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState(null);
  const unsubscribeRef = useRef(null);
  
  // Use external state if provided, otherwise use internal state for backward compatibility
  const selectedLeaveType = externalSelectedLeaveType || 'all';
  const handleLeaveTypeChange = onLeaveTypeChange || (() => {});

  useEffect(() => {
    if (authLoading) return;

    if (user?.userId) {
      // Only set loading if we have no data at all
      if (allowances.length === 0) setLoading(true);
      loadUserAllowances({ forceRefresh: Boolean(refreshToken) });
    } else {
      setLoading(false);
    }
  }, [user?.userId, authLoading, selectedYear, user?.companyId, refreshToken]);

  const loadUserAllowances = async ({ forceRefresh = false } = {}) => {
    if (!user?.userId) return;

    const cacheKey = `allowances_${user.userId}_${selectedYear}`;
    const ensuredKey = `allowances_ensured_${user.userId}_${selectedYear}_${new Date().toDateString()}`;

    // Only re-subscribe if userId or year changed, or if we have no active listener
    if (!unsubscribeRef.current || forceRefresh) {
      if (typeof unsubscribeRef.current === 'function') {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }

      unsubscribeRef.current = allowanceService.subscribeToEmployeeAllowances(
        user.userId,
        user,
        selectedYear,
        (live) => {
          if (live && live.length > 0) {
            setAllowances(live);
            setItem?.(cacheKey, live, ALLOWANCES_CACHE_TTL);
          }
          setError(null);
          setLoading(false);
        },
        (err) => {
          // Only show error if we have no data
          if (allowances.length === 0) {
            setError(err?.message || 'Failed to load allowances');
          }
          setLoading(false);
        }
      );
    }

    // Show cached data immediately if available and not already set
    if (!forceRefresh && allowances.length === 0) {
      const cached = getItem?.(cacheKey);
      if (Array.isArray(cached) && cached.length > 0) {
        setAllowances(cached);
        setLoading(false);
      }
    }

    // If it's a forced refresh (nonce changed), we definitely want to trigger the recalculation service
    // but without clearing the current UI.
    if (forceRefresh || !getItem?.(ensuredKey)) {
      try {
        // One-time fetch that also triggers internal recalculation/sync
        const userAllowances = await allowanceService.getEmployeeAllowances(user.userId, user, selectedYear);
        if (userAllowances && userAllowances.length > 0) {
          setAllowances(userAllowances);
          setItem?.(cacheKey, userAllowances, ALLOWANCES_CACHE_TTL);
        }
        if (user.companyId) {
          setItem?.(ensuredKey, true, 24 * 60 * 60 * 1000);
          automaticAllowanceService.ensureEmployeeAllowances(user.userId, user).catch(() => null);
        }
        setError(null);
      } catch (e) {
        console.error('Error refreshing allowances:', e);
        // Don't show toast for background refreshes if we have data
        if (allowances.length === 0) {
          setError(e?.message || 'Failed to load allowances');
          toast.error('Failed to load allowances');
        }
      } finally {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    return () => {
      if (typeof unsubscribeRef.current === 'function') {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, []);



  const safeNum = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);

  const getUsagePercentage = (used, total) => {
    const u = safeNum(used);
    const t = safeNum(total);
    if (t === 0) return 0;
    return Math.round((u / t) * 100);
  };

  const isOverused = (used, total) => safeNum(used) > safeNum(total);

  const getOveruseAmount = (used, total) => {
    const u = safeNum(used);
    const t = safeNum(total);
    return u > t ? u - t : 0;
  };

  // Get available years for filter
  const getAvailableYears = () => {
    const currentYear = new Date().getFullYear();
    return [currentYear, currentYear - 1, currentYear - 2];
  };

  // Get icon for leave type
  const getLeaveTypeIcon = (leaveType) => {
    switch (leaveType?.toLowerCase()) {
      case 'annual leave':
      case 'holiday':
        return Calendar;
      case 'maternity leave':
      case 'paternity leave':
      case 'maternity/paternity':
        return Heart;
      case 'sick leave':
        return Users;
      default:
        return Briefcase;
    }
  };

  // Get color scheme for leave type
  const getLeaveTypeColors = (leaveType, isOverused = false) => {
    if (isOverused) {
      return {
        bg: 'bg-red-50',
        icon: 'text-red-600',
        progress: 'bg-red-500'
      };
    }

    switch (leaveType?.toLowerCase()) {
      case 'annual leave':
      case 'holiday':
        return {
          bg: 'bg-blue-50',
          icon: 'text-blue-600',
          progress: 'bg-blue-500'
        };
      case 'maternity leave':
      case 'paternity leave':
      case 'maternity/paternity':
        return {
          bg: 'bg-pink-50',
          icon: 'text-pink-600',
          progress: 'bg-pink-500'
        };
      case 'sick leave':
        return {
          bg: 'bg-green-50',
          icon: 'text-green-600',
          progress: 'bg-green-500'
        };
      default:
        return {
          bg: 'bg-purple-50',
          icon: 'text-purple-600',
          progress: 'bg-purple-500'
        };
    }
  };

  const displayAllowances = useMemo(() => {
    const raw = allowances || [];
    if (!absences) return raw;

    // Enhance allowances with real-time usage from provided absences
    return raw.map(allowance => {
      const norm = allowanceService.normalizeLeaveType(allowance.leaveType);
      
      // Calculate actual usage from the provided absences array
      const actualUsed = absences
        .filter(abs => {
          const absNorm = allowanceService.normalizeLeaveType(abs.leaveType);
          const status = (abs.status || '').toLowerCase();
          return absNorm === norm && status === 'approved';
        })
        .reduce((sum, abs) => {
          const days = allowanceService.calculateDaysFromDates(abs.startDate, abs.endDate);
          return sum + (Number.isFinite(days) ? days : 0);
        }, 0);

      return {
        ...allowance,
        usedDays: actualUsed,
        remainingDays: (Number(allowance.totalDays) || 0) - actualUsed
      };
    });
  }, [allowances, absences]);

  // Get all available leave types from constants
  const allLeaveTypeLabels = LEAVE_TYPES.map(type => type.label);

  // Dropdown order: other types, then "All Leave Types" at bottom
  const primaryLeaveTypes = [];
  const otherLeaveTypes = allLeaveTypeLabels.filter(type => !primaryLeaveTypes.includes(type));
  const allLeaveTypesForDropdown = [...otherLeaveTypes, 'all'];
  const filteredAllowances = selectedLeaveType === 'all'
    ? displayAllowances.filter(a => safeNum(a.totalDays) > 0 || safeNum(a.usedDays) > 0)
    : displayAllowances.filter(a => allowanceService.getLeaveTypeDisplayName(a.leaveType) === selectedLeaveType);

  // Show all allowances by default initially to see what leave types exist
  const visibleAllowances = showAll ? filteredAllowances : filteredAllowances.slice(0, 4);
  const hasMore = filteredAllowances.length > 4;

  return (
    <div className="bg-white p-4 shadow-lg rounded-base space-y-4xl">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-2xl font-bold text-text-primary">Allowances</h2>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-md w-full sm:w-auto">
          <div className="flex items-center gap-2">
            <label htmlFor="leave-type-select" className="text-text-secondary w-24 sm:w-auto">Leave Type:</label>
            <div className="relative flex-1 sm:flex-none">
              <select
                id="leave-type-select"
                value={selectedLeaveType}
                onChange={(e) => handleLeaveTypeChange(e.target.value)}
                aria-label="Filter by leave type"
                className="h-10 w-full sm:w-auto px-base pr-10 border border-border-secondary rounded-lg text-md appearance-none focus:outline-none focus:border-border-accent-purple"
              >
                {allLeaveTypesForDropdown.map(type => (
                  <option key={type} value={type}>
                    {type === 'all' ? 'All Leave Types' : type}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-base top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="year-select" className="text-text-secondary w-24 sm:w-auto">Year:</label>
            <div className="relative flex-1 sm:flex-none">
              <select
                id="year-select"
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                aria-label="Filter by year"
                className="h-10 w-full sm:w-auto px-base pr-10 border border-border-secondary rounded-lg text-md appearance-none focus:outline-none focus:border-border-accent-purple"
              >
                {getAvailableYears().map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-base top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
            </div>
          </div>
        </div>
      </div>

      {loading && allowances.length === 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4xl">
          {[1, 2].map((index) => (
            <div key={index} className="bg-white border border-border-primary rounded-base p-4 sm:p-4xl animate-pulse">
              <div className="flex items-center gap-md mb-3xl">
                <div className="w-10 h-10 bg-gray-200 rounded-full"></div>
                <div className="h-6 bg-gray-200 rounded w-48"></div>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4">
                {[1, 2, 3].map((col) => (
                  <div key={col} className="text-center">
                    <div className="h-4 bg-gray-200 rounded mb-2"></div>
                    <div className="h-10 bg-gray-200 rounded mb-1"></div>
                    <div className="h-3 bg-gray-200 rounded"></div>
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <div className="h-4 bg-gray-200 rounded mb-2"></div>
                <div className="h-2 bg-gray-200 rounded"></div>
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="text-center py-12">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-md mx-auto">
            <h3 className="text-lg font-medium text-red-900 mb-2">Error Loading Allowances</h3>
            <p className="text-red-600 mb-4">{error}</p>
            <button
              onClick={() => loadUserAllowances({ forceRefresh: true })}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      ) : allowances.length === 0 ? (
        <div className="text-center py-12">
          <Briefcase className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No allowances configured</h3>
          <p className="text-gray-600">Your allowances will appear here once they are set up by your manager.</p>
        </div>
      ) : (
        <>
          {/* Show subtle loading indicator when refreshing data */}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-4xl">
            {visibleAllowances.map((allowance, index) => {
              const usedDays = safeNum(allowance.usedDays);
              const totalDays = safeNum(allowance.totalDays);
              const remainingDays = safeNum(allowance.remainingDays);
              const IconComponent = getLeaveTypeIcon(allowance.leaveType);
              const overused = isOverused(usedDays, totalDays);
              const overuseAmount = getOveruseAmount(usedDays, totalDays);
              const colors = getLeaveTypeColors(allowance.leaveType, overused);
              const usagePercentage = getUsagePercentage(usedDays, totalDays);
              const progressWidth = Math.min(usagePercentage, 100);

              return (
                <div key={allowance.id || `${allowance.leaveType}-${index}`} className={`bg-white border rounded-base p-4 sm:p-4xl ${overused ? 'border-red-200 bg-red-50/30' : 'border-border-primary'}`}>
                  <div className="flex items-center gap-md mb-6">
                    <div className={`w-10 h-10 ${colors.bg} rounded-full flex items-center justify-center shrink-0`}>
                      <IconComponent className={`h-5 w-5 ${colors.icon}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-semibold text-text-primary truncate">
                        {allowanceService.getLeaveTypeDisplayName(allowance.leaveType)}
                      </h3>
                      {overused && (
                        <div className="text-sm text-red-600 font-medium">
                          Overused by {overuseAmount} days
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4">
                    <div className="text-center">
                      <div className="text-text-secondary text-xs sm:text-sm mb-1 truncate">Total</div>
                      <div className="text-2xl sm:text-4xl font-bold text-text-primary">{totalDays}</div>
                      <div className="text-text-secondary text-xs sm:text-sm">Days</div>
                    </div>
                    <div className="text-center">
                      <div className="text-text-secondary text-xs sm:text-sm mb-1 truncate">Used</div>
                      <div className={`text-2xl sm:text-4xl font-bold ${overused ? 'text-red-600' : 'text-text-accent-red'}`}>
                        {usedDays}
                      </div>
                      <div className="text-text-secondary text-xs sm:text-sm">Days</div>
                    </div>
                    <div className="text-center">
                      <div className="text-text-secondary text-xs sm:text-sm mb-1 truncate">
                        {overused ? 'Overused' : 'Left'}
                      </div>
                      <div className={`text-2xl sm:text-4xl font-bold ${overused ? 'text-red-600' : 'text-text-accent-green'}`}>
                        {overused ? overuseAmount : remainingDays}
                      </div>
                      <div className="text-text-secondary text-xs sm:text-sm">Days</div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-text-secondary">
                        {overused ? 'Overuse Progress' : 'Usage Progress'}
                      </span>
                      <span className={`font-semibold ${overused ? 'text-red-600' : 'text-text-primary'}`}>
                        {usagePercentage}%
                      </span>
                    </div>
                    <div className="w-full h-2 bg-bg-secondary rounded-full overflow-hidden">
                      <div
                        className={`h-full ${colors.progress} rounded-full transition-all duration-300 ${overused ? 'animate-pulse' : ''}`}
                        style={{ width: `${progressWidth}%` }}
                      ></div>
                    </div>
                    {overused && (
                      <div className="text-xs text-red-600 mt-1 text-center">
                        Exceeded allowance limit
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Show More/Less Button */}
          {hasMore && (
            <div className="flex justify-center mt-4">
              <button
                onClick={() => setShowAll(!showAll)}
                className="px-6 py-2 text-sm font-medium text-purple-600 border border-purple-600 rounded-lg hover:bg-purple-50 transition-colors"
              >
                {showAll ? 'Show Less' : `Show ${filteredAllowances.length - 4} More`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};