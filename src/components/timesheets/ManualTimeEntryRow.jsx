import { AlertCircle, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { useAuth } from '../../hooks/useAuth';
import { logManualEntryAdded } from '../../services/auditTrail';
import { addManualTimeEntry, getUserWeekContext, getCompanyWorkSchedule, computeTargetSecondsForDay } from '../../services/timesheets';
import { resolveRoundingRules } from '../../services/roundingRules';
import { roundSessionRange } from '../../utils/timeRounding';
import { getTimeEntryOverlapConflict } from '../../utils/timeValidation';
import Button from '../ui/Button';

/**
 * ManualTimeEntryRow Component
 * Allows users to add manual time entries to their timesheet
 * Tracks audit trail for all manual entries
 */
export const ManualTimeEntryRow = ({
    isOpen,
    onClose,
    userId,
    timesheetId,
    date,
    onEntryAdded,
    isLoading = false,
    userRole = 'employee',
    weekDates = [], // Array of week dates for validation
    weekStartDay = 'monday',
    existingIntervalsByDate = {} // { [YYYY-MM-DD]: Array<{startMin,endMin,label?}> }
}) => {
    const { user } = useAuth();
    const [selectedDate, setSelectedDate] = useState(date);
    const [formData, setFormData] = useState({
        description: 'Working',
        workOrder: '',
        timeOn: '',
        timeOff: '',
        breakMin: 0,
        notes: ''
    });

    const [errors, setErrors] = useState({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [standardMins, setStandardMins] = useState(8 * 60);
    const [roundingRules, setRoundingRules] = useState(null);

    useEffect(() => {
        if (!isOpen) return;
        let isMounted = true;
        const fetchContext = async () => {
            try {
                const context = await getUserWeekContext(userId);
                if (context && context.companyIdPath) {
                    const [schedule, rules] = await Promise.all([
                        getCompanyWorkSchedule(context.companyIdPath),
                        resolveRoundingRules(context.companyIdPath)
                    ]);

                    if (isMounted) {
                        setRoundingRules(rules);
                        const targetSec = computeTargetSecondsForDay(selectedDate || date, schedule);
                        if (targetSec > 0) {
                            setStandardMins(Math.floor(targetSec / 60));
                        } else {
                            setStandardMins(0);
                        }
                    }
                }
            } catch (err) {
                console.warn('[ManualTimeEntryRow] Failed to fetch context:', err);
            }
        };
        fetchContext();
        return () => { isMounted = false; };
    }, [userId, selectedDate, date, isOpen]);

    const validateForm = useCallback(() => {
        const newErrors = {};

        if (!selectedDate) {
            newErrors.date = 'Date is required';
        } else if (weekDates.length > 0 && !weekDates.includes(selectedDate)) {
            newErrors.date = 'Date must be within the current week';
        }

        if (!formData.timeOn?.trim()) {
            newErrors.timeOn = 'Time On is required';
        }

        if (!formData.timeOff?.trim()) {
            newErrors.timeOff = 'Time Off is required';
        }

        if (formData.timeOn && formData.timeOff) {
            const [inH, inM] = formData.timeOn.split(':').map(Number);
            const [outH, outM] = formData.timeOff.split(':').map(Number);

            const inMin = (inH || 0) * 60 + (inM || 0);
            const outMin = (outH || 0) * 60 + (outM || 0);

            if (outMin <= inMin) {
                newErrors.timeOff = 'Time Off must be after Time On';
            }

            if (formData.breakMin < 0 || formData.breakMin > 480) {
                newErrors.breakMin = 'Break must be between 0-480 minutes';
            }

            const existing = existingIntervalsByDate?.[selectedDate] || [];
            const conflict = getTimeEntryOverlapConflict({
                candidateStart: formData.timeOn,
                candidateEnd: formData.timeOff,
                existingIntervals: existing,
                nowMin: new Date().getHours() * 60 + new Date().getMinutes()
            });
            if (conflict.hasConflict) {
                newErrors.overlap = conflict.message || 'Time entry conflicts with an existing entry';
            }
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    }, [formData, selectedDate, weekDates, existingIntervalsByDate]);

    const calculateDuration = useCallback(() => {
        if (!formData.timeOn || !formData.timeOff) return null;

        try {
            const [inH, inM] = formData.timeOn.split(':').map(Number);
            const [outH, outM] = formData.timeOff.split(':').map(Number);

            const baseDate = new Date();
            const inDate = new Date(baseDate); inDate.setHours(inH, inM, 0, 0);
            const outDate = new Date(baseDate); outDate.setHours(outH, outM, 0, 0);

            if (outDate <= inDate) return null;

            // Apply Rounding if rules available
            let finalIn = inDate;
            let finalOut = outDate;

            if (roundingRules) {
                const rounded = roundSessionRange(inDate, outDate, roundingRules);
                finalIn = rounded.roundedStart;
                finalOut = rounded.roundedEnd;
            }

            const grossMin = Math.floor((finalOut - finalIn) / 60000);
            const effectiveMin = Math.max(0, grossMin - (formData.breakMin || 0));

            const hours = Math.floor(effectiveMin / 60);
            const minutes = effectiveMin % 60;

            return {
                grossMin,
                effectiveMin,
                display: `${hours}h ${String(minutes).padStart(2, '0')}m`,
                normalMin: Math.min(effectiveMin, standardMins > 0 ? standardMins : (8 * 60)),
                overtimeMin: Math.max(0, effectiveMin - (standardMins > 0 ? standardMins : (8 * 60))),
                roundedIn: `${String(finalIn.getHours()).padStart(2, '0')}:${String(finalIn.getMinutes()).padStart(2, '0')}`,
                roundedOut: `${String(finalOut.getHours()).padStart(2, '0')}:${String(finalOut.getMinutes()).padStart(2, '0')}`
            };
        } catch (error) {
            console.error('Error calculating duration:', error);
            return null;
        }
    }, [formData, roundingRules, standardMins]);

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!validateForm()) {
            toast.error('Please fix the errors before submitting');
            return;
        }

        setIsSubmitting(true);

        try {
            const duration = calculateDuration();
            if (!duration) {
                throw new Error('Failed to calculate duration');
            }

            // Save to Firestore using the service (this enables real-time sync)
            console.log('[ManualTimeEntryRow] Saving manual entry to Firestore:', {
                userId,
                selectedDate,
                timeOn: formData.timeOn,
                timeOff: formData.timeOff
            });

            await addManualTimeEntry(
                userId,
                selectedDate,
                formData.timeOn,
                formData.timeOff,
                weekStartDay, // weekStartDay passed from parent
                timesheetId, // explicitTimesheetId - ensures we update the correct document
                {
                    description: formData.workOrder, // Mapped from UI 'Description' (was Work Order)
                    activityType: formData.description, // Mapped from UI 'Activity Type' (was Description)
                    notes: formData.notes,
                    breakMin: formData.breakMin
                }
            );

            console.log('[ManualTimeEntryRow] ✓ Manual entry saved to Firestore successfully');

            // Create manual entry object for local state update
            const manualEntry = {
                id: `manual_${Date.now()}`,
                date: selectedDate,
                description: formData.description,
                workOrder: formData.workOrder || '',
                timeOn: formData.timeOn,
                timeOff: formData.timeOff,
                breakMin: formData.breakMin,
                notes: formData.notes,
                grossSec: duration.grossMin * 60,
                effectiveSec: duration.effectiveMin * 60,
                normalSec: duration.normalMin * 60,
                overtimeSec: duration.overtimeMin * 60,
                isManual: true,
                createdAt: new Date().toISOString()
            };

            // Log to audit trail
            try {
                await logManualEntryAdded(
                    userId,
                    selectedDate,
                    formData.description,
                    formData.timeOn,
                    formData.timeOff,
                    formData.breakMin,
                    user?.displayName || 'User',
                    selectedDate,
                    user?.companyId || null
                );
            } catch (auditError) {
                console.warn('Failed to log audit trail:', auditError);
                // Don't fail the whole operation if audit trail fails
            }

            // Reset form
            setSelectedDate(date); // Reset to original date
            setFormData({
                description: 'Working',
                workOrder: '',
                timeOn: '',
                timeOff: '',
                breakMin: 0,
                notes: ''
            });
            setErrors({});

            // Call parent callback
            if (onEntryAdded) {
                onEntryAdded(manualEntry);
            }

            toast.success('Manual time entry added successfully');
            onClose();
        } catch (error) {
            console.error('Error submitting manual entry:', error);
            toast.error(error?.message || 'Failed to add manual entry');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    const duration = calculateDuration();

    const overlapConflict = useMemo(() => {
        if (!selectedDate || !formData.timeOn || !formData.timeOff) return { hasConflict: false };
        const existing = existingIntervalsByDate?.[selectedDate] || [];
        return getTimeEntryOverlapConflict({
            candidateStart: formData.timeOn,
            candidateEnd: formData.timeOff,
            existingIntervals: existing,
            nowMin: new Date().getHours() * 60 + new Date().getMinutes()
        });
    }, [existingIntervalsByDate, formData.timeOn, formData.timeOff, selectedDate]);

    return (
        <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-4 mb-4">
            <div className="space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                        <Plus className="w-4 h-4" />
                        Add Manual Time Entry
                    </h3>
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-gray-200 rounded transition"
                        disabled={isSubmitting}
                    >
                        <X className="w-4 h-4 text-gray-500" />
                    </button>
                </div>

                {/* Form Grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                    {/* Activity Type (formerly Description) */}
                    <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                            Activity Type
                        </label>
                        <select
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            className="w-full px-2 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                            disabled={isSubmitting}
                        >
                            <option value="Working">Working</option>
                            <option value="Remote Working">Remote Working</option>
                            <option value="Travel">Travel</option>
                            <option value="Annual Leave">Annual Leave</option>
                            <option value="Bank Holiday (Non-Working)">Bank Holiday</option>
                            <option value="Sick">Sick</option>
                            <option value="Training">Training</option>
                            <option value="Rest Day">Rest Day</option>
                            <option value="Bereavement">Bereavement</option>
                            <option value="Medical Appointment">Medical Appointment</option>
                            <option value="Authorised Absence (Unpaid)">Authorised Absence</option>
                        </select>
                    </div>

                    {/* Description (formerly Work Order) */}
                    <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                            Description
                        </label>
                        <input
                            type="text"
                            value={formData.workOrder}
                            onChange={(e) => setFormData({ ...formData, workOrder: e.target.value })}
                            className="w-full px-2 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                            placeholder="e.g. Worked on pump 3"
                            disabled={isSubmitting}
                        />
                    </div>

                    {/* Date */}
                    <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                            Date
                        </label>
                        <input
                            type="date"
                            value={selectedDate || ''}
                            onChange={(e) => {
                                setSelectedDate(e.target.value);
                                setErrors({ ...errors, date: undefined });
                            }}
                            min={weekDates[0] || ''}
                            max={weekDates[6] || ''}
                            className={`w-full px-2 py-2 text-sm border rounded-lg focus:outline-none focus:ring-1 ${errors.date
                                ? 'border-red-300 bg-red-50 focus:ring-red-500'
                                : 'border-gray-300 focus:ring-blue-500'
                                }`}
                            disabled={isSubmitting}
                        />
                        {errors.date && (
                            <p className="text-xs text-red-600 mt-1">{errors.date}</p>
                        )}
                    </div>

                    {/* Time On */}
                    <div>
                        <label className={`block text-xs font-medium mb-1 ${errors.timeOn ? 'text-red-600' : 'text-gray-700'}`}>
                            Time On *
                        </label>
                        <input
                            type="time"
                            value={formData.timeOn}
                            onChange={(e) => {
                                setFormData({ ...formData, timeOn: e.target.value });
                                setErrors({ ...errors, timeOn: undefined });
                            }}
                            max={(() => {
                                const now = new Date();
                                const todayIso = now.toISOString().split('T')[0];
                                return selectedDate === todayIso ? now.toTimeString().slice(0, 5) : undefined;
                            })()}
                            className={`w-full px-2 py-2 text-sm border rounded-lg focus:outline-none ${errors.timeOn
                                ? 'border-red-300 bg-red-50 focus:ring-1 focus:ring-red-500'
                                : 'border-gray-300 focus:ring-1 focus:ring-blue-500'
                                }`}
                            disabled={isSubmitting}
                        />
                        {errors.timeOn && (
                            <p className="text-xs text-red-600 mt-1">{errors.timeOn}</p>
                        )}
                    </div>

                    {/* Time Off */}
                    <div>
                        <label className={`block text-xs font-medium mb-1 ${errors.timeOff ? 'text-red-600' : 'text-gray-700'}`}>
                            Time Off *
                        </label>
                        <input
                            type="time"
                            value={formData.timeOff}
                            onChange={(e) => {
                                setFormData({ ...formData, timeOff: e.target.value });
                                setErrors({ ...errors, timeOff: undefined });
                            }}
                            max={(() => {
                                const now = new Date();
                                const todayIso = now.toISOString().split('T')[0];
                                return selectedDate === todayIso ? now.toTimeString().slice(0, 5) : undefined;
                            })()}
                            className={`w-full px-2 py-2 text-sm border rounded-lg focus:outline-none ${errors.timeOff
                                ? 'border-red-300 bg-red-50 focus:ring-1 focus:ring-red-500'
                                : 'border-gray-300 focus:ring-1 focus:ring-blue-500'
                                }`}
                            disabled={isSubmitting}
                        />
                        {errors.timeOff && (
                            <p className="text-xs text-red-600 mt-1">{errors.timeOff}</p>
                        )}
                    </div>
                </div>

                {/* Break and Duration */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {/* Break */}
                    <div>
                        <label className={`block text-xs font-medium mb-1 ${errors.breakMin ? 'text-red-600' : 'text-gray-700'}`}>
                            Break (min)
                        </label>
                        <input
                            type="number"
                            min="0"
                            max="480"
                            value={formData.breakMin}
                            onChange={(e) => {
                                setFormData({ ...formData, breakMin: parseInt(e.target.value) || 0 });
                                setErrors({ ...errors, breakMin: undefined });
                            }}
                            className={`w-full px-2 py-2 text-sm border rounded-lg focus:outline-none ${errors.breakMin
                                ? 'border-red-300 bg-red-50'
                                : 'border-gray-300'
                                }`}
                            disabled={isSubmitting}
                        />
                        {errors.breakMin && (
                            <p className="text-xs text-red-600 mt-1">{errors.breakMin}</p>
                        )}
                    </div>

                    {/* Duration Display */}
                    {duration && (
                        <>
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">
                                    Normal
                                </label>
                                <div className="px-2 py-2 text-sm font-semibold text-gray-900 bg-blue-50 rounded-lg">
                                    {Math.floor(duration.normalMin / 60)}h {String(duration.normalMin % 60).padStart(2, '0')}m
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">
                                    Overtime
                                </label>
                                <div className="px-2 py-2 text-sm font-semibold text-gray-900 bg-orange-50 rounded-lg">
                                    {Math.floor(duration.overtimeMin / 60)}h {String(duration.overtimeMin % 60).padStart(2, '0')}m
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">
                                    Total
                                </label>
                                <div className="px-2 py-2 text-sm font-bold text-gray-900 bg-green-50 rounded-lg">
                                    {duration.display}
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* Notes */}
                <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                        Notes
                    </label>
                    <textarea
                        value={formData.notes}
                        onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                        placeholder="Add any notes about this time entry..."
                        rows="2"
                        className="w-full px-2 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                        disabled={isSubmitting}
                    />
                </div>

                {/* Info Box */}
                {(() => {
                    const now = new Date();
                    const todayIso = now.toISOString().split('T')[0];
                    const currentTime = now.toTimeString().slice(0, 5);
                    const isFutureDate = selectedDate && selectedDate > todayIso;
                    const isFutureTime = selectedDate === todayIso && (
                        (formData.timeOn && formData.timeOn > currentTime) || 
                        (formData.timeOff && formData.timeOff > currentTime)
                    );

                    if (overlapConflict?.hasConflict) {
                        return (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex gap-3">
                                <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                                <p className="text-xs text-red-800 font-medium">
                                    {overlapConflict.message || 'Time entry conflicts with an existing entry'}
                                </p>
                            </div>
                        );
                    }

                    if (isFutureDate || isFutureTime) {
                        return (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex gap-3">
                                <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                                <p className="text-xs text-red-800 font-medium">
                                    You cannot select a future date or time for time entry. Please enter a valid past or present time.
                                </p>
                            </div>
                        );
                    }

                    return (
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex gap-3">
                            <AlertCircle className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                            <p className="text-xs text-blue-800">
                                This entry will be recorded to the audit trail and marked as a manual entry. It will appear on your timesheet and be available for manager review.
                            </p>
                        </div>
                    );
                })()}

                {/* Action Buttons */}
                <div className="flex gap-2 justify-end pt-2">
                    <Button
                        onClick={onClose}
                        variant="outline-secondary"
                        disabled={isSubmitting}
                        cn="h-9"
                    >
                        Cancel
                    </Button>
                    {(() => {
                        const now = new Date();
                        const todayIso = now.toISOString().split('T')[0];
                        const currentTime = now.toTimeString().slice(0, 5);
                        const isFutureSelected = (selectedDate && selectedDate > todayIso) || 
                                               (selectedDate === todayIso && ((formData.timeOn && formData.timeOn > currentTime) || (formData.timeOff && formData.timeOff > currentTime)));

                        return (
                            <Button
                                onClick={handleSubmit}
                                variant={isFutureSelected ? "secondary" : "gradient"}
                                disabled={isSubmitting || isFutureSelected || Boolean(overlapConflict?.hasConflict)}
                                cn={`h-9 ${isFutureSelected ? 'bg-gray-100 text-gray-500 border-gray-200' : ''}`}
                            >
                                {isSubmitting ? 'Saving...' : 'Add New'}
                            </Button>
                        );
                    })()}
                </div>
            </div>
        </div>
    );
};

export default ManualTimeEntryRow;
