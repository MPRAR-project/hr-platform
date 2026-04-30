import React, { useState, useMemo, useEffect } from 'react';
import { X, Calendar, AlertCircle } from 'lucide-react';
import { toast } from 'react-toastify';
import Button from '../ui/Button';
import { useAuth } from '../../hooks/useAuth';
import { useTimesheetContext } from '../../contexts/TimesheetContext';
import { getWeekStartIndex, formatISODate, getWeekRangeForDate, WEEKDAY_CODES_LIST } from '../../utils/weekStartUtils';
import { createBlankTimesheet } from '../../services/timesheetCreation';

/**
 * Helper to calculate the week ending day from week start day
 * If week starts Saturday (6), it ends Friday (5)
 * If week starts Monday (1), it ends Sunday (0)
 */
function getWeekEndDayIndex(weekStartDay) {
    const startIndex = getWeekStartIndex(weekStartDay);
    return (startIndex + 6) % 7; // 6 days after start
}

/**
 * Check if a given date falls on the week starting day
 */
function isWeekStartingDate(date, weekStartDay) {
    const startIndex = getWeekStartIndex(weekStartDay);
    return date.getDay() === startIndex;
}

/**
 * Check if a date is in the future (today or after)
 */
function isFutureDate(date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);
    return checkDate >= today;
}

/**
 * Check if a week starting date is in the future
 */
function isFutureWeekStart(date, weekStartDay) {
    if (!isWeekStartingDate(date, weekStartDay)) {
        return false;
    }
    return isFutureDate(date);
}

/**
 * Get week range from a week-starting date
 */
function getWeekRangeFromDate(date, weekStartDay) {
    // The date should be the week starting day
    return getWeekRangeForDate(date, weekStartDay);
}

const AddTimesheetModal = ({ isOpen, onClose }) => {
    const { user, weekStartDay } = useAuth();
    const { weeklySummaries, refresh } = useTimesheetContext();
    const [selectedDate, setSelectedDate] = useState(null);
    const [isCreating, setIsCreating] = useState(false);
    const [currentMonth, setCurrentMonth] = useState(new Date());

    // Debug: Log weeklySummaries structure
    console.log('[AddTimesheetModal] weeklySummaries:', weeklySummaries?.map(w => ({
        start: w.start,
        end: w.end,
        period: w.period,
        weekKey: w.weekKey
    })));

    // Week start must follow the company configuration chosen at signup.
    // If for some reason it is missing on the client, we fall back to
    // DEFAULT_WEEK_START_DAY purely as a safety net.
    const effectiveWeekStartDay = weekStartDay || DEFAULT_WEEK_START_DAY;
    const weekStartDayIndex = getWeekStartIndex(effectiveWeekStartDay);
    const weekStartDayName = WEEKDAY_CODES_LIST[weekStartDayIndex];

    // Create a Set of existing week start dates for quick lookup
    const existingWeekStarts = useMemo(() => {
        const set = new Set();
        weeklySummaries.forEach(week => {
            const startDate = week.start instanceof Date ? week.start : new Date(week.start);
            set.add(formatISODate(startDate));
        });
        return set;
    }, [weeklySummaries]);

    // Check if a week-starting date has an existing timesheet
    const hasExistingTimesheet = (weekStartDate) => {
        try {
            if (!weekStartDate || !weeklySummaries || weeklySummaries.length === 0) {
                return false;
            }

            const weekStartStr = formatISODate(weekStartDate);

            // Check if any weekly summary matches this week start date
            const existingWeek = weeklySummaries.find(week => {
                // Direct string match
                if (week.start === weekStartStr || week.period === weekStartStr) {
                    return true;
                }

                // Try Date object comparison (handle different formats)
                try {
                    const weekDate = new Date(week.start || week.period);
                    const checkDate = new Date(weekStartStr);
                    if (!isNaN(weekDate.getTime()) && !isNaN(checkDate.getTime())) {
                        return formatISODate(weekDate) === weekStartStr;
                    }
                } catch (e) {
                    // Ignore date parsing errors
                }

                return false;
            });

            return !!existingWeek;
        } catch (error) {
            console.error('Error checking existing timesheet:', error);
            return false;
        }
    };

    // Generate calendar days for current month view
    const calendarDays = useMemo(() => {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();

        // Get first day of month and calculate offset
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startOffset = firstDay.getDay();

        const days = [];

        // Add previous month's trailing days
        for (let i = startOffset - 1; i >= 0; i--) {
            const date = new Date(year, month, -i);
            days.push({ date, isCurrentMonth: false });
        }

        // Add current month's days
        for (let i = 1; i <= lastDay.getDate(); i++) {
            const date = new Date(year, month, i);
            days.push({ date, isCurrentMonth: true });
        }

        // Add next month's leading days to complete the grid
        const remainingDays = 42 - days.length; // 6 rows * 7 days
        for (let i = 1; i <= remainingDays; i++) {
            const date = new Date(year, month + 1, i);
            days.push({ date, isCurrentMonth: false });
        }

        return days;
    }, [currentMonth]);

    const handleDateClick = (date) => {
        // Check if it's a week-starting date
        if (!isWeekStartingDate(date, effectiveWeekStartDay)) {
            toast.warning(`Please select a ${weekStartDayName} (week starting day)`);
            return;
        }

        // Check if it's a future date
        if (isFutureWeekStart(date, effectiveWeekStartDay)) {
            toast.warning('Future timesheets cannot be created. Please select a past date.');
            return;
        }

        // Check if timesheet already exists
        if (hasExistingTimesheet(date)) {
            toast.warning('A timesheet already exists for this week');
            return;
        }

        setSelectedDate(date);
    };

    const handleCreate = async () => {
        if (!selectedDate) {
            toast.error('Please select a date');
            return;
        }

        // Double-check that it's not a future date
        if (isFutureWeekStart(selectedDate, effectiveWeekStartDay)) {
            toast.error('Cannot create future timesheets. Please select a past date.');
            return;
        }

        setIsCreating(true);
        try {
            const { start } = getWeekRangeFromDate(selectedDate, effectiveWeekStartDay);
            await createBlankTimesheet(user.uid, start, effectiveWeekStartDay);

            toast.success('Blank timesheet created successfully');

            // Refresh context to show new timesheet
            if (refresh) {
                await refresh();
                // Add a small delay to ensure Firestore real-time updates propagate
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            // Close modal
            onClose();
            setSelectedDate(null);
        } catch (error) {
            console.error('Error creating blank timesheet:', error);
            toast.error(error.message || 'Failed to create timesheet');
        } finally {
            setIsCreating(false);
        }
    };

    const getWeekRangePreview = (date) => {
        if (!date) return null;
        try {
            const { start, end } = getWeekRangeFromDate(date, effectiveWeekStartDay);
            return {
                start: start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                end: end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            };
        } catch (error) {
            return null;
        }
    };

    const selectedWeekRange = selectedDate ? getWeekRangePreview(selectedDate) : null;

    const previousMonth = () => {
        setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
    };

    const nextMonth = () => {
        setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]" onClick={onClose}></div>

            <div className="relative w-full max-w-md bg-white rounded-[24px] shadow-[0_4px_20px_rgba(0,0,0,0.1)] max-h-[90vh] flex flex-col">
                <div className="overflow-y-auto p-6 space-y-6">
                    {/* Header */}
                    <div className="flex justify-between items-start">
                        <div>
                            <h2 className="text-2xl font-bold text-text-primary">Add Timesheet</h2>
                            <p className="text-sm text-text-secondary mt-1">
                                Select a {weekStartDayName} to create a blank timesheet
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            className="w-6 h-6 flex items-center justify-center bg-black/10 rounded-full hover:bg-black/20 transition-colors"
                        >
                            <X className="h-4 w-4 text-text-secondary" />
                        </button>
                    </div>

                    {/* Info Alert */}
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-blue-800">
                            Only {weekStartDayName}s (week starting days) can be selected. Weeks with existing timesheets are disabled.
                        </p>
                    </div>

                    {/* Month Navigation */}
                    <div className="flex items-center justify-between">
                        <button
                            onClick={previousMonth}
                            className="px-3 py-1 text-sm font-medium text-purple-600 hover:bg-purple-50 rounded-lg transition"
                        >
                            ← Previous
                        </button>
                        <h3 className="text-lg font-semibold text-text-primary">
                            {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                        </h3>
                        <button
                            onClick={nextMonth}
                            className="px-3 py-1 text-sm font-medium text-purple-600 hover:bg-purple-50 rounded-lg transition"
                        >
                            Next →
                        </button>
                    </div>

                    {/* Calendar Grid */}
                    <div>
                        {/* Day Headers */}
                        <div className="grid grid-cols-7 gap-1 mb-2">
                            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                                <div key={day} className="text-center text-xs font-semibold text-gray-600 py-1">
                                    {day}
                                </div>
                            ))}
                        </div>

                        {/* Calendar Days */}
                        <div className="grid grid-cols-7 gap-1">
                            {calendarDays.map(({ date, isCurrentMonth }, index) => {
                                const isWeekStart = isWeekStartingDate(date, effectiveWeekStartDay);
                                const hasTimesheet = hasExistingTimesheet(date);
                                const isFuture = isFutureWeekStart(date, effectiveWeekStartDay);
                                const isDisabled = !isWeekStart || hasTimesheet || isFuture;
                                const isSelected = selectedDate && formatISODate(selectedDate) === formatISODate(date);
                                const weekRange = isWeekStart ? getWeekRangePreview(date) : null;

                                return (
                                    <button
                                        key={index}
                                        onClick={() => !isDisabled && handleDateClick(date)}
                                        disabled={isDisabled}
                                        title={weekRange ? `Week: ${weekRange.start} - ${weekRange.end}` : ''}
                                        className={`
                      aspect-square p-1 text-sm rounded-lg transition-all relative
                      ${!isCurrentMonth ? 'text-gray-300' : ''}
                      ${isDisabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}
                      ${isWeekStart && !hasTimesheet && !isFuture && !isSelected ? 'bg-purple-50 text-purple-600 hover:bg-purple-100 font-semibold' : ''}
                      ${isSelected ? 'bg-purple-600 text-white font-bold ring-2 ring-purple-300' : ''}
                      ${hasTimesheet && isWeekStart ? 'bg-gray-200 text-gray-500 line-through' : ''}
                      ${isFuture && isWeekStart ? 'bg-red-50 text-red-400 line-through' : ''}
                      ${!isWeekStart ? 'text-gray-400' : ''}
                    `}
                                    >
                                        {date.getDate()}
                                        {hasTimesheet && isWeekStart && (
                                            <span className="absolute top-0 right-0 text-xs">✓</span>
                                        )}
                                        {isFuture && isWeekStart && (
                                            <span className="absolute top-0 right-0 text-xs">🚫</span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Selected Week Preview */}
                    {selectedWeekRange && (
                        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                            <div className="flex items-center gap-2">
                                <Calendar className="h-4 w-4 text-purple-600" />
                                <div>
                                    <p className="text-xs text-purple-600 font-medium">Selected Week</p>
                                    <p className="text-sm text-purple-800 font-semibold">
                                        {selectedWeekRange.start} - {selectedWeekRange.end}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-3">
                        <Button
                            onClick={onClose}
                            variant="outline-secondary"
                            cn="flex-1"
                            disabled={isCreating}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleCreate}
                            variant="gradient"
                            cn="flex-1"
                            disabled={!selectedDate || isCreating}
                        >
                            {isCreating ? 'Creating...' : 'Create Timesheet'}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AddTimesheetModal;
