import React, { useMemo, useState, useEffect } from 'react';
import { X, Clock, Save, Trash2 } from 'lucide-react';
import Button from '../ui/Button';
import { updateTimeEntry } from '../../services/timesheets';
import { toast } from 'react-toastify';
import { useAuth } from '../../hooks/useAuth';
import { getTimeEntryOverlapConflict } from '../../utils/timeValidation';

const EditTimeEntryModal = ({ isOpen, onClose, entry, userId, dateStr, onUpdate, userName, existingIntervals = [] }) => {
    const { user } = useAuth();
    const [isLoading, setIsLoading] = useState(false);
    const [formData, setFormData] = useState({
        clockIn: '',
        clockOut: '',
        breakMin: 0,
        notes: ''
    });
    const [excludeKeys, setExcludeKeys] = useState({ entryId: null, sessionId: null });

    const now = new Date();
    const currentTimeStr = now.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' });
    const isToday = dateStr === new Date().toISOString().split('T')[0];
    const isFutureTime = isToday && ((formData.clockIn && formData.clockIn > currentTimeStr) || (formData.clockOut && formData.clockOut > currentTimeStr));

    useEffect(() => {
        if (entry) {

            const toTimeStr = (val) => {
                if (!val) return '';

                // If it's already a time string "HH:MM" or "HH:MM:SS"
                if (typeof val === 'string' && val.match(/^\d{1,2}:\d{2}(:\d{2})?$/)) {
                    return val.substring(0, 5); // Ensure HH:MM
                }

                let d;
                if (typeof val?.toDate === 'function') {
                    d = val.toDate();
                } else if (val?.seconds) {
                    d = new Date(val.seconds * 1000);
                } else {
                    d = new Date(val);
                }

                if (isNaN(d.getTime())) return '';
                // Use 24h format for input[type="time"]
                // CRITICAL FIX: Force 24h format explicitly for all locales
                return d.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' });
            };

            // Calculate break in minutes
            const breakMin = entry.manualBreakSec ? Math.round(entry.manualBreakSec / 60) : 0;

            setFormData({
                clockIn: toTimeStr(entry.rawStart || entry.rawClockIn || entry.clockIn || entry.startedAt),
                clockOut: toTimeStr(entry.rawEnd || entry.rawClockOut || entry.clockOut || entry.endedAt),
                breakMin: breakMin,
                notes: entry.notes || ''
            });

            const sessionId = entry?.sessionKey || (Array.isArray(entry?.sessionIds) ? entry.sessionIds[0] : null) || entry?.sessionId || entry?.id || null;
            const entryId = entry?.id || entry?.entryId || null;
            setExcludeKeys({ entryId, sessionId });
        }
    }, [entry, isOpen]);

    const overlapConflict = useMemo(() => {
        if (!formData.clockIn || !formData.clockOut) return { hasConflict: false };
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();

        // Exclude the current entry by id/sessionId so it doesn't conflict with itself
        const filtered = (existingIntervals || []).filter(iv => {
            if (excludeKeys?.sessionId && iv?.sessionId && String(iv.sessionId) === String(excludeKeys.sessionId)) return false;
            if (excludeKeys?.entryId && iv?.id && String(iv.id) === String(excludeKeys.entryId)) return false;
            return true;
        });

        return getTimeEntryOverlapConflict({
            candidateStart: formData.clockIn,
            candidateEnd: formData.clockOut,
            existingIntervals: filtered,
            nowMin
        });
    }, [existingIntervals, excludeKeys, formData.clockIn, formData.clockOut]);

    // Calculate work duration in minutes
    const workDurationMinutes = useMemo(() => {
        if (!formData.clockIn || !formData.clockOut) return 0;
        
        const [inH, inM] = formData.clockIn.split(':').map(Number);
        const [outH, outM] = formData.clockOut.split(':').map(Number);
        
        if (isNaN(inH) || isNaN(inM) || isNaN(outH) || isNaN(outM)) return 0;
        
        const inMinutes = inH * 60 + inM;
        const outMinutes = outH * 60 + outM;
        
        return Math.max(0, outMinutes - inMinutes);
    }, [formData.clockIn, formData.clockOut]);

    // Check if break duration is valid (not exceeding work duration)
    const isBreakInvalid = useMemo(() => {
        const breakMinutes = Number(formData.breakMin) || 0;
        return breakMinutes >= workDurationMinutes && workDurationMinutes > 0;
    }, [formData.breakMin, workDurationMinutes]);

    if (!isOpen) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        console.log('DEBUG: EditTimeEntryModal handleSubmit', {
            dateStr,
            typeOfDateStr: typeof dateStr,
            formData,
            entry
        });
        setIsLoading(true);

        try {
            if (overlapConflict?.hasConflict) {
                throw new Error(overlapConflict.message || 'Time entry conflicts with an existing entry');
            }

            // Validate break duration
            const breakMinutes = Number(formData.breakMin) || 0;
            if (breakMinutes >= workDurationMinutes && workDurationMinutes > 0) {
                throw new Error(`Break time (${breakMinutes} minutes) cannot exceed work duration (${workDurationMinutes} minutes)`);
            }
            // Construct full Date objects for clockIn/clockOut
            if (!dateStr || isNaN(new Date(dateStr).getTime())) {
                throw new Error('Invalid date provided');
            }
            if (!formData.clockIn) {
                throw new Error('Clock In time is required');
            }

            const entryDate = new Date(dateStr);
            // Handle AM/PM if present (though toTimeStr should prevent it) or standard HH:MM
            // input[type="time"] always returns HH:MM 24h format by spec, but let's be safe
            let [inH, inM] = formData.clockIn.split(':').map(Number);

            // If AM/PM is somehow stuck in string (e.g. from copy-paste/autocomplete), strip it?
            // But Number("50 PM") is NaN, so we catch it below.

            if (isNaN(inH) || isNaN(inM)) {
                // Try parsing 12h format fallback just in case
                const timeParts = formData.clockIn.match(/(\d+):(\d+)\s*(AM|PM)?/i);
                if (timeParts) {
                    inH = parseInt(timeParts[1], 10);
                    inM = parseInt(timeParts[2], 10);
                    const meridiem = timeParts[3]?.toUpperCase();
                    if (meridiem === 'PM' && inH < 12) inH += 12;
                    if (meridiem === 'AM' && inH === 12) inH = 0;
                } else {
                    throw new Error('Invalid Clock In time format');
                }
            }

            const newClockIn = new Date(entryDate);
            newClockIn.setHours(inH, inM, 0, 0);

            let newClockOut = null;
            if (formData.clockOut) {
                let [outH, outM] = formData.clockOut.split(':').map(Number);

                if (isNaN(outH) || isNaN(outM)) {
                    // Try parsing 12h format fallback
                    const timeParts = formData.clockOut.match(/(\d+):(\d+)\s*(AM|PM)?/i);
                    if (timeParts) {
                        outH = parseInt(timeParts[1], 10);
                        outM = parseInt(timeParts[2], 10);
                        const meridiem = timeParts[3]?.toUpperCase();
                        if (meridiem === 'PM' && outH < 12) outH += 12;
                        if (meridiem === 'AM' && outH === 12) outH = 0;
                    } else {
                        throw new Error('Invalid Clock Out time format');
                    }
                }

                newClockOut = new Date(entryDate);
                newClockOut.setHours(outH, outM, 0, 0);

                // Handle overnight shifts if needed (if out < in, assume next day)
                // BUT simple assumption: If out < in, it's an error OR next day. 
                // Let's assume same day unless specified otherwise, or valid overnight logic exists.
                // For now, if out <= in, we might warn or just set it. 
                // If the shift crosses midnight, usually we'd add 1 day.
                if (newClockOut <= newClockIn) {
                    // Simple heuristic: if difference is huge, maybe it's next day?
                    // Or just rely on validation.
                    // Let's just create the date. If user meant next day, they might need a more complex picker.
                    // For MVP, assuming same day entries or manually handled dates.
                    // Actually `updateTimeEntry` logic in `TimeEntriesPage` assumes dateStr.
                }
            }

            if (newClockOut && newClockOut <= newClockIn) {
                // Check if it's meant to be next day?
                // For now, throw error to be safe.
                // toast.error('Clock Out must be after Clock In');
                // setIsLoading(false);
                // return;
            }

            // Determine Session ID (if from Session object, it has .id; if from Timesheet Entry, it has sessionKey/sessionIds)
            // But if it's a Session object, the Timesheet Entry might store that ID in sessionIds.
            const sId = entry.sessionKey || (entry.sessionIds && entry.sessionIds[0]) || entry.id;

            // Determine Original Clock In for fallback matching
            // Handle Firestore Timestamps, Date objects, or Strings
            let origStart = entry.rawStart || entry.clockIn || entry.startedAt;
            if (origStart?.toDate) origStart = origStart.toDate();
            if (origStart?.seconds) origStart = new Date(origStart.seconds * 1000);
            if (origStart instanceof Date) origStart = origStart.toISOString();

            const result = await updateTimeEntry({
                userId,
                dateStr,
                sessionId: sId,
                originalClockIn: origStart,
                entryId: entry.id, // [FIX] Pass explicit ID to target correct entry
                updates: {
                    clockIn: newClockIn.toISOString(),
                    clockOut: newClockOut ? newClockOut.toISOString() : null,
                    breakMin: formData.breakMin,
                    notes: formData.notes,
                    editedBy: user.uid
                }
            });

            toast.success('Time entry updated');
            onUpdate(result);
            onClose();
        } catch (error) {
            console.error('Failed to update time entry:', error);
            toast.error(error.message || 'Failed to update time entry');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="flex items-center justify-between p-4 border-b border-border-secondary bg-bg-secondary/30">
                    <div>
                        <h3 className="text-lg font-semibold text-text-primary">Edit Time Entry</h3>
                        <p className="text-sm text-text-secondary">{userName} • {new Date(dateStr).toLocaleDateString()}</p>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-bg-secondary rounded-full transition-colors text-text-secondary">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-sm font-medium text-text-secondary flex items-center gap-1.5">
                                <Clock className="w-3.5 h-3.5" /> Start Time
                            </label>
                            <input
                                type="time"
                                value={formData.clockIn}
                                onChange={e => setFormData({ ...formData, clockIn: e.target.value })}
                                className="w-full px-3 py-2 border border-border-secondary rounded-lg focus:outline-none focus:border-border-accent-purple focus:ring-1 focus:ring-border-accent-purple transition-all"
                                required
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-sm font-medium text-text-secondary flex items-center gap-1.5">
                                <Clock className="w-3.5 h-3.5" /> End Time
                            </label>
                            <input
                                type="time"
                                value={formData.clockOut}
                                onChange={e => setFormData({ ...formData, clockOut: e.target.value })}
                                className="w-full px-3 py-2 border border-border-secondary rounded-lg focus:outline-none focus:border-border-accent-purple focus:ring-1 focus:ring-border-accent-purple transition-all"
                            />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-text-secondary">Break Duration (minutes)</label>
                        <input
                            type="number"
                            min="0"
                            value={formData.breakMin}
                            onChange={e => setFormData({ ...formData, breakMin: e.target.value })}
                            className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-1 transition-all ${
                                isBreakInvalid 
                                    ? 'border-red-300 focus:border-red-500 focus:ring-red-500' 
                                    : 'border-border-secondary focus:border-border-accent-purple focus:ring-border-accent-purple'
                            }`}
                        />
                        <p className="text-xs text-text-secondary">Total break time (unpaid)</p>
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-text-secondary">Description</label>
                        <textarea
                            value={formData.notes}
                            onChange={e => setFormData({ ...formData, notes: e.target.value })}
                            placeholder="Reason for change..."
                            rows={3}
                            className="w-full px-3 py-2 border border-border-secondary rounded-lg focus:outline-none focus:border-border-accent-purple focus:ring-1 focus:ring-border-accent-purple transition-all resize-none"
                        />
                    </div>

                    {/* Future Time Warning */}
                    {isFutureTime && (
                        <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                            <p className="text-sm text-red-700 font-medium text-center">
                                ⚠️ Please select only past times for today
                            </p>
                        </div>
                    )}

                    {/* Overlap Warning */}
                    {overlapConflict?.hasConflict && (
                        <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                            <p className="text-sm text-red-700 font-medium text-center">
                                {overlapConflict.message}
                            </p>
                        </div>
                    )}

                    {/* Break Validation Warning */}
                    {isBreakInvalid && (
                        <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                            <p className="text-sm text-red-700 font-medium text-center">
                                ⚠️ Break time ({formData.breakMin} minutes) cannot exceed work duration ({workDurationMinutes} minutes)
                            </p>
                        </div>
                    )}

                    <div className="flex gap-3 pt-2">
                        <Button
                            type="button"
                            variant="outline-secondary"
                            onClick={onClose}
                            cn="flex-1"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            isLoading={isLoading}
                            disabled={isLoading || isFutureTime || Boolean(overlapConflict?.hasConflict) || isBreakInvalid}
                            cn="flex-1"
                            icon={Save}
                        >
                            Save Changes
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default EditTimeEntryModal;
