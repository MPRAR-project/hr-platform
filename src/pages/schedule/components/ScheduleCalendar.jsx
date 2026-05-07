import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { createSchedule, updateScheduleStatus, deleteSchedule, subscribeToSchedules } from '../../../services/scheduleService';
import { getSites } from '../../../services/sites';
import { getWorkLocations } from '../../../services/workLocations';
import { getUsersByCompany } from '../../../services/users';
import { format, startOfWeek, addDays, isSameDay, addWeeks, subWeeks, startOfDay } from 'date-fns';
import { ChevronLeft, ChevronRight, Plus, MapPin, Clock, Check, X, CalendarDays, Trash2, ArrowLeft } from 'lucide-react';
import { toast } from 'react-toastify';

const ScheduleCalendar = ({ targetUserId, onBack }) => {
    const { user } = useAuth();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [schedules, setSchedules] = useState([]);
    const [sites, setSites] = useState([]);
    const [workLocations, setWorkLocations] = useState([]);
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedSlot, setSelectedSlot] = useState(null); // { userId, date }
    const [formData, setFormData] = useState({
        siteId: '',
        locationId: '',
        startTime: '09:00',
        endTime: '17:00',
        notes: ''
    });
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [updatingScheduleId, setUpdatingScheduleId] = useState(null);

    const isManager = ['siteManager', 'adminManager', 'superUser', 'teamManager', 'seniorManager'].includes(user?.role);

    // Initial Data Loading & Subscription
    useEffect(() => {
        let unsubscribe;

        if (user?.companyId) {
            setLoading(true);

            // 1. Real-time subscription
            unsubscribe = subscribeToSchedules(user.companyId, (data) => {
                setSchedules(data);
                setLoading(false);
            });

            // 2. Load Static Data (Sites for all, Users for Managers or to show name)
            const loadData = async () => {
                try {
                    const { getUserById } = await import('../../../services/users');
                    
                    const promises = [
                        getSites(user.companyId),
                        getWorkLocations(user.companyId)
                    ];

                    // If we have a targetUserId and we are NOT in matrix view, 
                    // we only need that user's data.
                    if (targetUserId && !isManager) {
                        promises.push(getUserById(targetUserId).then(u => u ? [u] : []));
                    } else {
                        promises.push(getUsersByCompany(user.companyId));
                    }

                    const [sitesData, locationsData, usersData] = await Promise.all(promises);
                    setSites(sitesData);
                    setWorkLocations(locationsData);
                    setUsers(usersData);
                } catch (error) {
                    console.error("Error loading reference data:", error);
                }
            };
            loadData();
        }

        return () => {
            if (unsubscribe) unsubscribe();
        };
    }, [user?.companyId]);

    // Helpers
    const { weekStartDay } = useAuth();
    const getWeekStartIndex = (dayName) => {
        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const index = days.indexOf(dayName?.toLowerCase());
        return index === -1 ? 1 : index; // Default to Monday if not found
    };

    const weekStartsOn = useMemo(() => getWeekStartIndex(weekStartDay), [weekStartDay]);
    const weekStart = startOfWeek(currentDate, { weekStartsOn });
    const weekDays = useMemo(() => Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i)), [weekStart]);

    const getShiftsForCell = (userId, date) => {
        return schedules
            .filter(s =>
                s.employeeId === userId &&
                isSameDay(new Date(s.start), date)
            )
            .sort((a, b) => {
                const startA = new Date(a.start).getTime();
                const startB = new Date(b.start).getTime();
                return startA - startB;
            });
    };

    // Filter Users for Display
    const displayUsers = useMemo(() => {
        if (targetUserId) {
            return users.filter(u => u.id === targetUserId);
        }
        // If no targetUserId, show all (Manager Matrix view) or Self (Employee view default)
        // But the parent component determines logic. 
        // If passing null, assumed Matrix view (all users).
        return users;
    }, [users, targetUserId]);

    // Handlers
    const handlePrevWeek = () => setCurrentDate(d => subWeeks(d, 1));
    const handleNextWeek = () => setCurrentDate(d => addWeeks(d, 1));
    const handleToday = () => setCurrentDate(new Date());

    const openAssignModal = (userId, date) => {
        console.log('[ScheduleCalendar] Opening assign modal for:', { userId, date: format(date, 'yyyy-MM-dd') });
        setSelectedSlot({ userId, date });
        setFormData({
            siteId: '', // Default hidden
            locationId: workLocations[0]?.id || '',
            startTime: '09:00',
            endTime: '17:00',
            notes: ''
        });

        setIsSubmitting(false);
        setIsModalOpen(true);
    };

    const handleCreateSchedule = async (e) => {
        e.preventDefault();
        console.log('[ScheduleCalendar] handleCreateSchedule called');

        // Validation
        if (!selectedSlot || !formData.locationId) {
            console.warn('[ScheduleCalendar] Missing required fields:', { selectedSlot, locationId: formData.locationId });
            setValidationError('Please fill in all required fields');
            return;
        }

        // 1. Validate Time Range Construction
        const dateStr = format(selectedSlot.date, 'yyyy-MM-dd');
        const start = new Date(`${dateStr}T${formData.startTime}`);
        const end = new Date(`${dateStr}T${formData.endTime}`);

        // 2. Validate End Time after Start Time
        if (end <= start) {
            console.warn('[ScheduleCalendar] Invalid time range:', { startTime: formData.startTime, endTime: formData.endTime });
            toast.error('End time must be after start time');
            return;
        }

        // 3. Validate Retroactive (Past) Shifts
        const now = new Date();
        if (start < now) {
            console.warn('[ScheduleCalendar] Attempted retroactive shift assignment');
            toast.error('Cannot assign a shift in the past.');
            return;
        }

        // 4. Validate Overlapping Shifts
        const existingShifts = getShiftsForCell(selectedSlot.userId, selectedSlot.date);
        const hasOverlap = existingShifts.some(existingShift => {
            const existingStart = new Date(existingShift.start);
            const existingEnd = new Date(existingShift.end);

            // Check for overlap: (StartA < EndB) and (EndA > StartB)
            return start < existingEnd && end > existingStart;
        });

        if (hasOverlap) {
            console.warn('[ScheduleCalendar] Shift overlap detected');
            toast.error('This shift overlaps with an existing shift.');
            return;
        }


        setIsSubmitting(true);

        // Auto-assign Site ID from Work Location Parent if available
        let finalSiteId = formData.siteId;
        const selectedLocation = workLocations.find(l => l.id === formData.locationId);
        if (selectedLocation && selectedLocation.parentSiteId) {
            finalSiteId = selectedLocation.parentSiteId;
            console.log('[ScheduleCalendar] Auto-assigning Parent Site ID:', finalSiteId, 'from Location:', selectedLocation.name);
        }

        console.log('[ScheduleCalendar] Starting shift assignment...', {
            userId: selectedSlot.userId,
            date: format(selectedSlot.date, 'yyyy-MM-dd'),
            siteId: finalSiteId,
            startTime: formData.startTime,
            endTime: formData.endTime
        });

        try {
            console.log('[ScheduleCalendar] Calling createSchedule service...');
            const result = await createSchedule({
                companyId: user.companyId,
                employeeId: selectedSlot.userId,
                siteId: finalSiteId,
                locationId: formData.locationId || null,
                start: start.toISOString(),
                end: end.toISOString(),
                notes: formData.notes
            }, user.id || user.userId);

            console.log('[ScheduleCalendar] Shift created successfully:', result);
            toast.success('Shift assigned successfully!');

            // Reset form and close modal
            setFormData({
                siteId: '',
                locationId: workLocations[0]?.id || '',
                startTime: '09:00',
                endTime: '17:00',
                notes: ''
            });
            setIsModalOpen(false);
            console.log('[ScheduleCalendar] Modal closed, form reset');
        } catch (error) {
            console.error('[ScheduleCalendar] Error creating schedule:', error);
            console.error('[ScheduleCalendar] Error details:', {
                message: error.message,
                code: error.code,
                stack: error.stack
            });
            toast.error(`Failed to assign shift: ${error.message || 'Unknown error'}`);
            // Keep modal open on error so user can retry
        } finally {
            setIsSubmitting(false);
            console.log('[ScheduleCalendar] Submission complete, isSubmitting set to false');
        }
    };

    const handleStatusUpdate = async (scheduleId, status) => {
        console.log('[ScheduleCalendar] Status update started:', { scheduleId, status });
        setUpdatingScheduleId(scheduleId); // Set loading state

        try {
            await updateScheduleStatus(scheduleId, status, '', user.id || user.userId);
            console.log('[ScheduleCalendar] Status update successful');
            toast.success(`Shift ${status}`);
        } catch (error) {
            console.error('[ScheduleCalendar] Status update failed:', error);
            toast.error(`Failed to update shift: ${error.message || 'Unknown error'}`);
        } finally {
            setUpdatingScheduleId(null); // Clear loading state
            console.log('[ScheduleCalendar] Status update completed');
        }
    };

    const handleDelete = async (scheduleId) => {
        try {
            await deleteSchedule(scheduleId);
            toast.success('Shift deleted');
        } catch (error) {
            console.error(error);
            toast.error('Failed to delete shift');
        }
    };

    const getSiteName = (id) => sites.find(s => s.id === id)?.name || 'Unknown Site';
    const getLocationName = (id) => workLocations.find(l => l.id === id)?.name || null;

    // Status Colors
    const getStatusColor = (status) => {
        switch (status) {
            case 'accepted': return 'bg-green-100 border-green-300 text-green-800';
            case 'declined': return 'bg-red-100 border-red-300 text-red-800';
            default: return 'bg-amber-50 border-amber-200 text-amber-800';
        }
    };

    if (loading && !schedules.length) {
        return <div className="p-8 text-center text-gray-500">Loading calendar...</div>;
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                <div className="flex items-center gap-3 w-full sm:w-auto">
                    {onBack && (
                        <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-full transition-colors mr-2">
                            <ArrowLeft className="h-5 w-5 text-gray-600" />
                        </button>
                    )}
                    <div className="p-2 bg-purple-100 rounded-lg text-purple-600">
                        <CalendarDays className="h-6 w-6" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-gray-900">
                            {targetUserId && targetUserId === (user.id || user.userId)
                                ? 'My Schedule'
                                : targetUserId
                                    ? `${users.find(u => u.id === targetUserId)?.displayName || 'User'}'s Schedule`
                                    : 'Team Schedule'}
                        </h1>
                        <p className="text-sm text-gray-500">
                            {format(weekStart, 'MMM d')} - {format(addDays(weekStart, 6), 'MMM d, yyyy')}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2 bg-gray-50 p-1 rounded-lg border border-gray-200">
                    <button onClick={handlePrevWeek} className="p-2 hover:bg-white hover:shadow-sm rounded-md transition-all text-gray-600">
                        <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button onClick={handleToday} className="px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-white hover:shadow-sm rounded-md transition-all">
                        Today
                    </button>
                    <button onClick={handleNextWeek} className="p-2 hover:bg-white hover:shadow-sm rounded-md transition-all text-gray-600">
                        <ChevronRight className="h-5 w-5" />
                    </button>
                </div>
            </div>

            {/* Calendar Grid */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[1000px]">
                        <thead>
                            <tr className="bg-gray-50 border-b border-gray-200">
                                <th className="p-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-48 sticky left-0 bg-gray-50 z-10">
                                    Employee
                                </th>
                                {weekDays.map(day => (
                                    <th key={day.toISOString()} className={`p-4 text-center border-l border-gray-100 min-w-[140px] ${isSameDay(day, new Date()) ? 'bg-purple-50/50' : ''}`}>
                                        <div className="text-xs font-semibold text-gray-500 uppercase">{format(day, 'EEE')}</div>
                                        <div className={`mt-1 text-sm font-bold ${isSameDay(day, new Date()) ? 'text-purple-600' : 'text-gray-900'}`}>{format(day, 'd')}</div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {displayUsers.map(u => (
                                <tr key={u.id} className="hover:bg-gray-50/50 transition-colors group">
                                    <td className="p-4 sticky left-0 bg-white group-hover:bg-gray-50/50 transition-colors z-10 border-r border-gray-100">
                                        <div className="flex items-center gap-3">
                                            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shadow-sm">
                                                {(u.displayName || u.email || '?').charAt(0).toUpperCase()}
                                            </div>
                                            <div className="truncate max-w-[120px]">
                                                <div className="text-sm font-medium text-gray-900 truncate">{u.displayName || 'User'}</div>
                                                <div className="text-xs text-gray-500 truncate">{u.email}</div>
                                            </div>
                                        </div>
                                    </td>
                                    {weekDays.map(day => {
                                        const shifts = getShiftsForCell(u.id, day);
                                        const isPast = day < startOfDay(new Date());

                                        return (
                                            <td key={day.toISOString()} className="p-2 border-l border-gray-100 align-top h-32 relative">
                                                {/* Add Button (Manager Only) */}
                                                {isManager && !isPast && (
                                                    <button
                                                        onClick={() => openAssignModal(u.id, day)}
                                                        className="w-full mb-2 p-1.5 rounded-lg border border-dashed border-gray-200 text-gray-400 hover:border-purple-300 hover:text-purple-600 hover:bg-purple-50 transition-all text-xs font-medium flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100"
                                                    >
                                                        <Plus className="h-3 w-3" /> Assign
                                                    </button>
                                                )}

                                                {/* Shifts List */}
                                                <div className="space-y-2">
                                                    {shifts.map(shift => (
                                                        <div key={shift.id} className={`p-2.5 rounded-lg border text-xs shadow-sm transition-all hover:shadow-md ${getStatusColor(shift.status)}`}>
                                                            <div className="font-semibold flex items-center justify-between mb-1">
                                                                <span className="flex items-center gap-1">
                                                                    <Clock className="h-3 w-3 opacity-70" />
                                                                    {format(new Date(shift.start), 'HH:mm')} - {format(new Date(shift.end), 'HH:mm')}
                                                                </span>
                                                                {/* Delete Action (Manager) */}
                                                                {isManager && (
                                                                    <button onClick={() => handleDelete(shift.id)} className="text-gray-400 hover:text-red-600 transition-colors p-0.5" title="Delete Shift">
                                                                        <Trash2 className="h-3 w-3" />
                                                                    </button>
                                                                )}
                                                            </div>
                                                            {getSiteName(shift.siteId) !== 'Unknown Site' && (
                                                                <div className="flex items-center gap-1 mb-1.5 truncate">
                                                                    <MapPin className="h-3 w-3 opacity-70 flex-shrink-0" />
                                                                    <span className="truncate" title={getSiteName(shift.siteId)}>{getSiteName(shift.siteId)}</span>
                                                                </div>
                                                            )}
                                                            {shift.locationId && getLocationName(shift.locationId) && (
                                                                <div className="flex items-center gap-1 mb-1.5 truncate text-purple-700">
                                                                    <MapPin className="h-3 w-3 opacity-70 flex-shrink-0" />
                                                                    <span className="truncate text-xs" title={getLocationName(shift.locationId)}>{getLocationName(shift.locationId)}</span>
                                                                </div>
                                                            )}

                                                            {/* Actions (Employee - only if it's their own shift) */}
                                                            {/* Logic: If NOT manager, OR if manager viewing OWN shift, AND pending */}
                                                            {/* Improved: if shift.employeeId === currentUser.id AND pending */}
                                                            {(shift.employeeId === (user.id || user.userId) && shift.status === 'pending') && (
                                                                <div className="flex gap-1 mt-2">
                                                                    <button
                                                                        onClick={() => handleStatusUpdate(shift.id, 'accepted')}
                                                                        disabled={updatingScheduleId === shift.id}
                                                                        className="flex-1 py-1 bg-green-600 text-white rounded hover:bg-green-700 transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                                                                        title="Accept"
                                                                    >
                                                                        {updatingScheduleId === shift.id ? (
                                                                            <div className="animate-spin rounded-full h-3 w-3 border-2 border-white border-t-transparent"></div>
                                                                        ) : (
                                                                            <Check className="h-3 w-3" />
                                                                        )}
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleStatusUpdate(shift.id, 'declined')}
                                                                        disabled={updatingScheduleId === shift.id}
                                                                        className="flex-1 py-1 bg-red-600 text-white rounded hover:bg-red-700 transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                                                                        title="Decline"
                                                                    >
                                                                        {updatingScheduleId === shift.id ? (
                                                                            <div className="animate-spin rounded-full h-3 w-3 border-2 border-white border-t-transparent"></div>
                                                                        ) : (
                                                                            <X className="h-3 w-3" />
                                                                        )}
                                                                    </button>
                                                                </div>
                                                            )}

                                                            {shift.status !== 'pending' && (
                                                                <div className="mt-1 flex items-center gap-1 opacity-75 font-medium italic">
                                                                    {shift.status === 'accepted' ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                                                                    <span className="capitalize">{shift.status}</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modal */}
            {
                isModalOpen && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm p-4">
                        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animation-scale-up">
                            <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                                <h2 className="font-bold text-gray-900 text-lg">Assign Shift</h2>
                                <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 p-1 hover:bg-gray-100 rounded-full transition-colors">
                                    <X className="h-5 w-5" />
                                </button>
                            </div>
                            <form onSubmit={handleCreateSchedule} className="p-6 space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                                    <div className="text-gray-900 font-semibold">{selectedSlot && format(selectedSlot.date, 'EEEE, MMMM d, yyyy')}</div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
                                    <div className="text-gray-900">{users.find(u => u.id === selectedSlot?.userId)?.displayName || 'Unknown'}</div>
                                </div>

                                {/* Client requested to hide Site dropdown */}
                                {/* <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Site (for payslip)</label>
                                    <select
                                        className="w-full rounded-lg border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 transition-colors"
                                        value={formData.siteId}
                                        onChange={e => setFormData({ ...formData, siteId: e.target.value })}
                                        required
                                    >
                                        <option value="" disabled>Select a site</option>
                                        {sites.map(site => (
                                            <option key={site.id} value={site.id}>{site.name}</option>
                                        ))}
                                    </select>
                                </div> */}

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Work Location</label>
                                    <select
                                        className="w-full rounded-lg border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500 transition-colors"
                                        value={formData.locationId}
                                        onChange={e => setFormData({ ...formData, locationId: e.target.value })}
                                        required
                                    >
                                        <option value="" disabled>Select a location</option>
                                        {workLocations.map(location => (
                                            <option key={location.id} value={location.id}>{location.name}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                                        <input
                                            type="time"
                                            className="w-full rounded-lg border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500"
                                            value={formData.startTime}
                                            onChange={e => setFormData({ ...formData, startTime: e.target.value })}
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
                                        <input
                                            type="time"
                                            className="w-full rounded-lg border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500"
                                            value={formData.endTime}
                                            onChange={e => setFormData({ ...formData, endTime: e.target.value })}
                                            required
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Notes (Optional)</label>
                                    <textarea
                                        className="w-full rounded-lg border-gray-300 shadow-sm focus:border-purple-500 focus:ring-purple-500"
                                        rows="2"
                                        value={formData.notes}
                                        onChange={e => setFormData({ ...formData, notes: e.target.value })}
                                        placeholder="Add any instructions..."
                                    />
                                </div>

                                <div className="pt-2 flex gap-3">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            console.log('[ScheduleCalendar] Cancel button clicked, closing modal');
                                            setIsModalOpen(false);
                                        }}
                                        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium transition-colors"
                                        disabled={isSubmitting}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        className={`flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg font-bold shadow-md transition-all flex items-center justify-center gap-2 ${isSubmitting
                                            ? 'opacity-70 cursor-not-allowed'
                                            : 'hover:bg-purple-700 hover:shadow-lg'
                                            }`}
                                        disabled={isSubmitting}
                                    >
                                        {isSubmitting && (
                                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                                        )}
                                        {isSubmitting ? 'Assigning...' : 'Assign Shift'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div >
                )
            }
        </div >
    );
};

export default ScheduleCalendar;
