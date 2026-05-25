import { X } from 'lucide-react';
import Button from '../ui/Button';

/**
 * Manual Time Entry Modal Component
 * Simplified modal for adding manual clock in/out entries
 * Used by Admin, HR, Senior Manager, and Site Manager roles
 */
export const ManualTimeEntryModal = ({
    isOpen,
    onClose,
    userName,
    clockInTime,
    clockOutTime,
    entryDate,
    onClockInChange,
    onClockOutChange,
    onEntryDateChange,
    onNotesChange,
    notes = '',
    onSubmit,
    isLoading,
    errors = {},
    weekDates = [],
    clockInReadOnly = false, // true when pre-filled from an existing open session
    isClosingSession = false, // true when closing an existing open session
}) => {
    if (!isOpen) return null;

    const now = new Date();
    const currentTimeStr = now.toTimeString().slice(0, 5); // HH:MM format
    const isToday = entryDate === new Date().toISOString().split('T')[0];

    // Get max time for time inputs (current time for today, no limit for past dates)
    const getMaxTime = () => {
        return isToday ? currentTimeStr : '23:59';
    };

    const calculateDuration = () => {
        if (!clockInTime || !clockOutTime) return null;

        const [inHours, inMinutes] = clockInTime.split(':').map(Number);
        const [outHours, outMinutes] = clockOutTime.split(':').map(Number);

        const inMin = inHours * 60 + inMinutes;
        const outMin = outHours * 60 + outMinutes;
        const durationMin = outMin - inMin;

        if (durationMin <= 0) return null;

        const hours = Math.floor(durationMin / 60);
        const minutes = durationMin % 60;

        return { hours, minutes };
    };

    const duration = calculateDuration();

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]"
                onClick={onClose}
            ></div>

            {/* Modal Content */}
            <div className="relative w-full max-w-md bg-white rounded-2xl shadow-lg p-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                            <span className="text-xs font-semibold text-blue-600">
                                {userName ? userName.charAt(0).toUpperCase() : 'U'}
                            </span>
                        </div>
                        <div>
                            <p className="text-sm text-gray-500">
                                {isClosingSession ? 'Clock out — active session' : 'Clock in and out'}
                            </p>
                            <p className="text-xs text-gray-400 mt-0.5">
                                {userName || 'User'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-gray-100 rounded-lg transition"
                    >
                        <X className="w-5 h-5 text-gray-400" />
                    </button>
                </div>

                {/* Form */}
                <div className="space-y-4">
                    {/* Entry Date */}
                    <div>
                        <label className="text-sm text-gray-600 mb-2 block font-medium">
                            Date
                        </label>
                        <input
                            type="date"
                            value={entryDate || ''}
                            onChange={(e) => onEntryDateChange && onEntryDateChange(e.target.value)}
                            min={weekDates[0] || ''}
                            max={new Date().toISOString().split('T')[0]}
                            className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none transition ${errors.date
                                ? 'border-red-300 bg-red-50 focus:border-red-400'
                                : 'border-gray-200 focus:border-orange-500 focus:ring-1 focus:ring-orange-500'
                                }`}
                            disabled={isLoading}
                        />
                        {errors.date && (
                            <p className="text-xs text-red-600 mt-1">{errors.date}</p>
                        )}
                    </div>

                    {/* Clock In Time */}
                    <div>
                        <label className="text-sm text-gray-600 mb-2 block font-medium flex justify-between items-center">
                            <span>In</span>
                            {clockInReadOnly && (
                                <span className="text-[10px] text-amber-600 font-normal uppercase tracking-wider">Active session</span>
                            )}
                        </label>
                        <input
                            type="time"
                            value={clockInTime}
                            onChange={(e) => !clockInReadOnly && onClockInChange(e.target.value)}
                            max={getMaxTime()}
                            className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none transition ${errors.clockIn
                                ? 'border-red-300 bg-red-50 focus:border-red-400'
                                : clockInReadOnly
                                    ? 'border-amber-200 bg-amber-50 text-amber-800 cursor-not-allowed'
                                    : 'border-gray-200 focus:border-orange-500 focus:ring-1 focus:ring-orange-500'
                                }`}
                            disabled={isLoading || clockInReadOnly}
                            readOnly={clockInReadOnly}
                        />
                        {errors.clockIn && (
                            <p className="text-xs text-red-600 mt-1 font-medium">{errors.clockIn}</p>
                        )}
                    </div>

                    {/* Clock Out Time */}
                    <div>
                        <label className="text-sm text-gray-600 mb-2 block font-medium flex justify-between items-center">
                            <span>
                                Out
                            </span>
                            {entryDate === new Date().toISOString().split('T')[0] && !clockOutTime && (
                                <span className="text-[10px] text-brand-primary font-normal uppercase tracking-wider animate-pulse">
                                    Now (Auto-Start)
                                </span>
                            )}
                        </label>
                        <input
                            type="time"
                            value={clockOutTime}
                            onChange={(e) => onClockOutChange(e.target.value)}
                            max={getMaxTime()}
                            placeholder="Blank = Now & Start Clock"
                            className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none transition ${errors.clockOut
                                ? 'border-red-300 bg-red-50 focus:border-red-400'
                                : 'border-gray-200 focus:border-orange-500 focus:ring-1 focus:ring-orange-500'
                                }`}
                            disabled={isLoading}
                        />
                        {errors.clockOut && (
                            <p className="text-xs text-red-600 mt-1 font-medium">{errors.clockOut}</p>
                        )}
                    </div>

                    {/* Description / Notes */}
                    <div>
                        <label className="text-sm text-gray-600 mb-2 block font-medium">
                            Description
                        </label>
                        <textarea
                            value={notes}
                            onChange={(e) => onNotesChange && onNotesChange(e.target.value)}
                            placeholder="Optional: Working, Project X..."
                            rows={2}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none transition focus:border-orange-500 focus:ring-1 focus:ring-orange-500 resize-none"
                            disabled={isLoading}
                        />
                    </div>

                    {/* Duration Display / Warning Message */}
                    {(() => {
                        const todayIso = new Date().toISOString().split('T')[0];
                        const isFutureDate = entryDate && entryDate > todayIso;
                        const isFutureTime = entryDate === todayIso && (
                            (clockInTime && clockInTime > currentTimeStr) || 
                            (clockOutTime && clockOutTime > currentTimeStr)
                        );

                        if (errors?.overlap) {
                            return (
                                <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                                    <p className="text-sm text-red-700 font-medium text-center">
                                        {errors.overlap}
                                    </p>
                                </div>
                            );
                        }

                        if (isFutureDate || isFutureTime) {
                            return (
                                <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                                    <p className="text-sm text-red-700 font-medium text-center">
                                        ⚠️ You cannot select a future date or time. Please select a valid past or present time.
                                    </p>
                                </div>
                            );
                        }

                        if (duration && !errors.clockOut) {
                            return (
                                <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                                    <p className="text-sm text-blue-700">
                                        <span className="font-medium">Time: </span>
                                        {duration.hours > 0 && `${duration.hours}h `}
                                        {duration.minutes}m
                                    </p>
                                </div>
                            );
                        }

                        return null;
                    })()}

                    {/* Action Buttons */}
                    <div className="flex gap-3 pt-4">
                        <Button
                            onClick={onSubmit}
                            variant="gradient"
                            disabled={isLoading ||
                                (entryDate !== new Date().toISOString().split('T')[0] && (!clockInTime || !clockOutTime)) ||
                                (entryDate && entryDate > new Date().toISOString().split('T')[0]) ||
                                (isToday && ((clockInTime && clockInTime > currentTimeStr) ||
                                    (clockOutTime && clockOutTime > currentTimeStr))) ||
                                (errors && (errors.clockIn || errors.clockOut || errors.date || errors.overlap))
                            }
                            cn="flex-1 h-10"
                        >
                            {isLoading ? 'Saving...' : 'Save'}
                        </Button>
                        <Button
                            onClick={onClose}
                            variant="outline-secondary"
                            disabled={isLoading}
                            cn="flex-1 h-10"
                        >
                            Cancel
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ManualTimeEntryModal;
