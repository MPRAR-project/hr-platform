// Unified timesheet editing component for consistent functionality across all pages
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Clock, Save, X, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import Button from '../ui/Button';
import { saveWeekEdits, invalidateTimesheetCache } from '../../services/timesheets';
import { useOptimisticTimesheetUpdate } from '../../hooks/useTimesheetData';
import { measureAsync } from '../../hooks/usePerformanceMonitor';
import { toast } from 'react-toastify';

const UnifiedTimesheetEditor = ({
    timesheet,
    userId,
    onSave,
    onCancel,
    isOpen = true,
    readOnly = false,
    showValidation = true,
    autoSave = false,
    className = ''
}) => {
    const { addOptimisticUpdate, removeOptimisticUpdate } = useOptimisticTimesheetUpdate();

    // State management
    const [editData, setEditData] = useState({});
    const [originalData, setOriginalData] = useState({});
    const [isDirty, setIsDirty] = useState(false);
    const [isSaving, setSaving] = useState(false);
    const [validationErrors, setValidationErrors] = useState({});
    const [lastSaved, setLastSaved] = useState(null);

    // Initialize edit data from timesheet
    useEffect(() => {
        if (!timesheet || !isOpen) return;

        const initData = {};
        const weekStart = timesheet.weekStart || timesheet.start;

        if (weekStart) {
            // Generate 7 days from week start
            const startDate = new Date(weekStart);
            for (let i = 0; i < 7; i++) {
                const date = new Date(startDate);
                date.setDate(startDate.getDate() + i);
                const dateStr = date.toISOString().slice(0, 10);

                // Find existing entry for this date
                const existingEntry = timesheet.entries?.find(e => e.date === dateStr);

                initData[dateStr] = {
                    date: dateStr,
                    clockIn: existingEntry?.clockIn || '',
                    clockOut: existingEntry?.clockOut || '',
                    breakMin: existingEntry?.breakMin || 0,
                    notes: existingEntry?.notes || '',
                    grossSec: existingEntry?.grossSec || 0,
                    effectiveSec: existingEntry?.effectiveSec || 0,
                    overtimeSec: existingEntry?.overtimeSec || 0
                };
            }
        }

        setEditData(initData);
        setOriginalData(JSON.parse(JSON.stringify(initData)));
        setIsDirty(false);
        setValidationErrors({});
    }, [timesheet, isOpen]);

    // Validation logic
    const validateEntry = useCallback((date, entry) => {
        const errors = {};

        if (entry.clockIn && entry.clockOut) {
            const clockInTime = new Date(`${date}T${entry.clockIn}:00`);
            const clockOutTime = new Date(`${date}T${entry.clockOut}:00`);

            if (clockOutTime <= clockInTime) {
                errors.clockOut = 'Clock out time must be after clock in time';
            }

            const totalHours = (clockOutTime - clockInTime) / (1000 * 60 * 60);
            if (totalHours > 24) {
                errors.clockOut = 'Total hours cannot exceed 24 hours';
            }
        }

        if (entry.clockIn && !entry.clockOut) {
            errors.clockOut = 'Clock out time is required when clock in is set';
        }

        if (!entry.clockIn && entry.clockOut) {
            errors.clockIn = 'Clock in time is required when clock out is set';
        }

        if (entry.breakMin < 0 || entry.breakMin > 480) { // Max 8 hours break
            errors.breakMin = 'Break time must be between 0 and 480 minutes';
        }

        return errors;
    }, []);

    // Calculate totals for a day entry
    const calculateDayTotals = useCallback((entry) => {
        if (!entry.clockIn || !entry.clockOut) {
            return { grossSec: 0, effectiveSec: 0, overtimeSec: 0 };
        }

        const clockInTime = new Date(`${entry.date}T${entry.clockIn}:00`);
        const clockOutTime = new Date(`${entry.date}T${entry.clockOut}:00`);

        const grossSec = Math.max(0, Math.floor((clockOutTime - clockInTime) / 1000));
        const breakSec = Math.max(0, (entry.breakMin || 0) * 60);
        const effectiveSec = Math.max(0, grossSec - breakSec);

        // Simple overtime calculation (over 8 hours)
        const standardWorkSec = 8 * 60 * 60; // 8 hours
        const overtimeSec = Math.max(0, effectiveSec - standardWorkSec);

        return { grossSec, effectiveSec, overtimeSec };
    }, []);

    // Handle input changes
    const handleInputChange = useCallback((date, field, value) => {
        if (readOnly) return;

        setEditData(prev => {
            const newData = { ...prev };
            if (!newData[date]) {
                newData[date] = { date, clockIn: '', clockOut: '', breakMin: 0, notes: '' };
            }

            newData[date] = { ...newData[date], [field]: value };

            // Recalculate totals
            const totals = calculateDayTotals(newData[date]);
            newData[date] = { ...newData[date], ...totals };

            return newData;
        });

        // Validate the entry
        if (showValidation) {
            const entry = { ...editData[date], [field]: value };
            const errors = validateEntry(date, entry);

            setValidationErrors(prev => ({
                ...prev,
                [date]: errors
            }));
        }

        setIsDirty(true);
    }, [readOnly, showValidation, editData, validateEntry, calculateDayTotals]);

    // Check if there are any validation errors
    const hasValidationErrors = useMemo(() => {
        return Object.values(validationErrors).some(errors =>
            Object.keys(errors).length > 0
        );
    }, [validationErrors]);

    // Calculate week totals
    const weekTotals = useMemo(() => {
        const totals = { grossSec: 0, effectiveSec: 0, overtimeSec: 0 };

        Object.values(editData).forEach(entry => {
            totals.grossSec += entry.grossSec || 0;
            totals.effectiveSec += entry.effectiveSec || 0;
            totals.overtimeSec += entry.overtimeSec || 0;
        });

        return totals;
    }, [editData]);

    // Format seconds to hours and minutes
    const formatTime = useCallback((seconds) => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
    }, []);

    // Auto-save functionality
    useEffect(() => {
        if (!autoSave || !isDirty || hasValidationErrors || isSaving) return;

        const autoSaveTimer = setTimeout(() => {
            handleSave(true); // Silent auto-save
        }, 2000); // Auto-save after 2 seconds of inactivity

        return () => clearTimeout(autoSaveTimer);
    }, [autoSave, isDirty, hasValidationErrors, isSaving, editData]);

    // Save changes
    const handleSave = useCallback(async (silent = false) => {
        if (readOnly || isSaving || hasValidationErrors) return;

        setSaving(true);

        try {
            // Add optimistic update
            if (timesheet?.id) {
                addOptimisticUpdate(timesheet.id, {
                    status: 'saving',
                    data: editData
                });
            }

            // Prepare day edits for the service
            const dayEdits = Object.values(editData)
                .filter(entry => entry.clockIn && entry.clockOut)
                .map(entry => ({
                    date: entry.date,
                    clockIn: entry.clockIn,
                    clockOut: entry.clockOut,
                    breakMin: entry.breakMin || 0,
                    notes: entry.notes || ''
                }));

            if (dayEdits.length === 0) {
                if (!silent) {
                    toast.warning('No valid entries to save');
                }
                return;
            }

            const weekStart = timesheet.weekStart || timesheet.start;

            await measureAsync('UnifiedTimesheetEditor-save', async () => {
                await saveWeekEdits(userId, weekStart, dayEdits);
            });

            // Invalidate cache to ensure fresh data
            invalidateTimesheetCache(userId, weekStart);

            // Update state
            setOriginalData(JSON.parse(JSON.stringify(editData)));
            setIsDirty(false);
            setLastSaved(new Date());

            // Remove optimistic update
            if (timesheet?.id) {
                removeOptimisticUpdate(timesheet.id);
            }

            // Call parent save handler
            if (onSave) {
                onSave({
                    ...timesheet,
                    entries: dayEdits,
                    totals: weekTotals
                });
            }

            if (!silent) {
                toast.success('Timesheet saved successfully');
            }

            console.log(`UnifiedTimesheetEditor: Saved ${dayEdits.length} entries for week ${weekStart}`);
        } catch (error) {
            console.error('UnifiedTimesheetEditor: Failed to save timesheet:', error);

            // Remove optimistic update on error
            if (timesheet?.id) {
                removeOptimisticUpdate(timesheet.id);
            }

            if (!silent) {
                toast.error(error.message || 'Failed to save timesheet');
            }
        } finally {
            setSaving(false);
        }
    }, [
        readOnly, isSaving, hasValidationErrors, editData, timesheet, userId,
        weekTotals, onSave, addOptimisticUpdate, removeOptimisticUpdate
    ]);

    // Cancel changes
    const handleCancel = useCallback(() => {
        setEditData(JSON.parse(JSON.stringify(originalData)));
        setIsDirty(false);
        setValidationErrors({});

        if (onCancel) {
            onCancel();
        }
    }, [originalData, onCancel]);

    // Get sorted dates for display
    const sortedDates = useMemo(() => {
        return Object.keys(editData).sort();
    }, [editData]);

    if (!isOpen || !timesheet) {
        return null;
    }

    return (
        <div className={`unified-timesheet-editor ${className}`}>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <Clock className="h-5 w-5 text-blue-500" />
                    <h3 className="text-lg font-semibold text-text-primary">
                        Edit Timesheet
                    </h3>
                    {lastSaved && (
                        <span className="text-xs text-text-secondary">
                            Last saved: {lastSaved.toLocaleTimeString()}
                        </span>
                    )}
                </div>

                {/* Week totals */}
                <div className="flex items-center gap-4 text-sm">
                    <span className="text-text-secondary">
                        Total: <strong className="text-text-primary">{formatTime(weekTotals.effectiveSec)}</strong>
                    </span>
                    {weekTotals.overtimeSec > 0 && (
                        <span className="text-orange-600">
                            Overtime: <strong>{formatTime(weekTotals.overtimeSec)}</strong>
                        </span>
                    )}
                </div>
            </div>

            {/* Daily entries */}
            <div className="space-y-4">
                {sortedDates.map(date => {
                    const entry = editData[date];
                    const errors = validationErrors[date] || {};
                    const dayName = new Date(date).toLocaleDateString('en-US', { weekday: 'long' });

                    return (
                        <div key={date} className="border border-border-secondary rounded-lg p-4">
                            <div className="flex items-center justify-between mb-3">
                                <h4 className="font-medium text-text-primary">
                                    {dayName}, {new Date(date).toLocaleDateString()}
                                </h4>
                                {entry.effectiveSec > 0 && (
                                    <span className="text-sm text-text-secondary">
                                        {formatTime(entry.effectiveSec)}
                                        {entry.overtimeSec > 0 && (
                                            <span className="text-orange-600 ml-2">
                                                (+{formatTime(entry.overtimeSec)} OT)
                                            </span>
                                        )}
                                    </span>
                                )}
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                {/* Clock In */}
                                <div>
                                    <label className="block text-sm font-medium text-text-secondary mb-1">
                                        Clock In
                                    </label>
                                    <input
                                        type="time"
                                        value={entry.clockIn || ''}
                                        onChange={(e) => handleInputChange(date, 'clockIn', e.target.value)}
                                        disabled={readOnly}
                                        className={`w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.clockIn
                                                ? 'border-red-300 bg-red-50'
                                                : 'border-border-secondary'
                                            } ${readOnly ? 'bg-gray-50 cursor-not-allowed' : ''}`}
                                    />
                                    {errors.clockIn && (
                                        <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                                            <AlertTriangle className="h-3 w-3" />
                                            {errors.clockIn}
                                        </p>
                                    )}
                                </div>

                                {/* Clock Out */}
                                <div>
                                    <label className="block text-sm font-medium text-text-secondary mb-1">
                                        Clock Out
                                    </label>
                                    <input
                                        type="time"
                                        value={entry.clockOut || ''}
                                        onChange={(e) => handleInputChange(date, 'clockOut', e.target.value)}
                                        disabled={readOnly}
                                        className={`w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.clockOut
                                                ? 'border-red-300 bg-red-50'
                                                : 'border-border-secondary'
                                            } ${readOnly ? 'bg-gray-50 cursor-not-allowed' : ''}`}
                                    />
                                    {errors.clockOut && (
                                        <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                                            <AlertTriangle className="h-3 w-3" />
                                            {errors.clockOut}
                                        </p>
                                    )}
                                </div>

                                {/* Break Time */}
                                <div>
                                    <label className="block text-sm font-medium text-text-secondary mb-1">
                                        Break (minutes)
                                    </label>
                                    <input
                                        type="number"
                                        min="0"
                                        max="480"
                                        value={entry.breakMin || 0}
                                        onChange={(e) => handleInputChange(date, 'breakMin', parseInt(e.target.value) || 0)}
                                        disabled={readOnly}
                                        className={`w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.breakMin
                                                ? 'border-red-300 bg-red-50'
                                                : 'border-border-secondary'
                                            } ${readOnly ? 'bg-gray-50 cursor-not-allowed' : ''}`}
                                    />
                                    {errors.breakMin && (
                                        <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                                            <AlertTriangle className="h-3 w-3" />
                                            {errors.breakMin}
                                        </p>
                                    )}
                                </div>

                                {/* Notes */}
                                <div>
                                    <label className="block text-sm font-medium text-text-secondary mb-1">
                                        Notes
                                    </label>
                                    <input
                                        type="text"
                                        value={entry.notes || ''}
                                        onChange={(e) => handleInputChange(date, 'notes', e.target.value)}
                                        disabled={readOnly}
                                        placeholder="Optional notes..."
                                        className={`w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${readOnly
                                                ? 'bg-gray-50 cursor-not-allowed border-border-secondary'
                                                : 'border-border-secondary'
                                            }`}
                                    />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Actions */}
            {!readOnly && (
                <div className="flex items-center justify-between mt-6 pt-4 border-t border-border-secondary">
                    <div className="flex items-center gap-2 text-sm text-text-secondary">
                        {isSaving && (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span>Saving...</span>
                            </>
                        )}
                        {isDirty && !isSaving && (
                            <>
                                <AlertTriangle className="h-4 w-4 text-orange-500" />
                                <span>You have unsaved changes</span>
                            </>
                        )}
                        {!isDirty && !isSaving && lastSaved && (
                            <>
                                <CheckCircle className="h-4 w-4 text-green-500" />
                                <span>All changes saved</span>
                            </>
                        )}
                    </div>

                    <div className="flex items-center gap-3">
                        <Button
                            variant="outline-secondary"
                            onClick={handleCancel}
                            disabled={isSaving || !isDirty}
                            icon={X}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="solid-primary"
                            onClick={() => handleSave(false)}
                            disabled={isSaving || hasValidationErrors || !isDirty}
                            icon={isSaving ? Loader2 : Save}
                            className={isSaving ? 'animate-pulse' : ''}
                        >
                            {isSaving ? 'Saving...' : 'Save Changes'}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default UnifiedTimesheetEditor;