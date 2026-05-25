import { useEffect, useMemo, useState } from "react";
import { getTimesheetEditPermissions } from "../../../utils/timesheetPermissions";
import ViewTimesheetModal from "../../../components/modals/ViewTimesheetModal";
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from "../../../components/shared/Table";
import Badge from "../../../components/ui/Badge";
import Button from "../../../components/ui/Button";
import EditTimesheetModal from "../../../components/modals/EditTimesheetModal";
import AddTimesheetModal from "../../../components/modals/AddTimesheetModal";
import { useAuth } from "../../../hooks/useAuth";
import { useTimesheetContext } from "../../../contexts/TimesheetContext";
import { toast } from "react-toastify";
import Loader from "../../../components/ui/Loader";
import { fetchApprovedAbsencesForWeek } from "../../../services/timesheetAbsenceIntegration";
import { getUserWeekContext, getCompanyWorkSchedule, submitCurrentWeek, submitWeek } from "../../../services/timesheets";
import { shouldShowSubmitButton } from "../../../utils/timesheetUtils";
import { canSubmitTimesheet, getSubmitBlockedReason } from "../../../utils/timesheetSubmitGate";
import { getWeekRangeForDate, normalizeWeekStartDay, formatWeeklyRange } from "../../../utils/weekStartUtils";


export const TimesheetTab = () => {
    const [viewModalOpen, setViewModalOpen] = useState(false)
    const [editModalOpen, setEditModalOpen] = useState(false)
    const [addModalOpen, setAddModalOpen] = useState(false)
    const [selectedTimesheet, setSelectedTimesheet] = useState(null)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const { user, weekStartDay: userWeekStartDay } = useAuth()
    const [selectedMonth, setSelectedMonth] = useState('all')
    const [selectedYear, setSelectedYear] = useState('all')

    // Use real-time context instead of fetching
    const {
        weeklySummaries,
        currentWeekData,
        weeksByKey,
        currentSchedule,
        absencesMap: contextAbsencesMap,
        isLoading,
        refresh
    } = useTimesheetContext()

    const companySettings = useMemo(() => ({
        schedule: currentSchedule, // Keep it null while loading (prevents flip)
        roundingRules: null
    }), [currentSchedule]);

    const absencesMap = contextAbsencesMap || new Map();

    // Internal fetching removed - now handled by TimesheetContext for zero-flip consistency

    const formatReadable = (seconds) => {
        const s = Math.max(0, Math.floor(seconds || 0));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        return `${String(h)}h ${String(m).padStart(2, '0')}m`;
    };

    // Optimistic UI state
    const [optimisticStatusMap, setOptimisticStatusMap] = useState({});

    // Transform weekly summaries for display (real-time updates automatically)
    const timesheets = useMemo(() => {
        if (!weeklySummaries || weeklySummaries.length === 0) return [];

        const displayName = user?.displayName || user?.email || 'User';
        return weeklySummaries.map(w => {
            // ✅ FIXED: Use user's week start day to calculate correct week range
            const baseDate = w.start instanceof Date ? w.start : new Date(w.start);
            const effectiveWeekStartDay = normalizeWeekStartDay(userWeekStartDay);
            const { start: weekStart, end: weekEnd } = getWeekRangeForDate(baseDate, effectiveWeekStartDay);
            const periodLabel = formatWeeklyRange(weekStart, weekEnd);

            const normalizeStatusLabel = (s) => {
                const v = String(s || '').trim().toLowerCase();
                if (!v) return 'Draft';
                if (v === 'approved-by-team') return 'Pending';
                return v.charAt(0).toUpperCase() + v.slice(1);
            };

            // Check for optimistic override
            const optimisticStatus = optimisticStatusMap[w.weekKey];

            return {
                id: w.weekKey,
                week: periodLabel,
                hours: formatReadable(w.totals.effectiveSec || 0),
                overtime: formatReadable(w.totals.overtimeSec || 0),
                status: normalizeStatusLabel(optimisticStatus || w.status), // Use optimistic status if present
                submitted: w.submitted,
                name: displayName,
                approvedByName: w.approvedByName || null,
                approvedAt: w.approvedAt || null,
                approvedBy: w.approvedBy || null,
                raw: { ...w, userId: user?.uid },
                weekEndDate: weekEnd,
                weekStartDate: weekStart // ✅ Add weekStartDate for modal use
            };
        });
    }, [weeklySummaries, user, optimisticStatusMap, userWeekStartDay]);

    const handleSubmitCurrentWeek = async () => {
        try {
            setIsSubmitting(true)
            await submitCurrentWeek(user?.uid)
            toast.success("Current week timesheet submitted successfully");
            // No need to refresh - context will update automatically via Firestore listener
        } catch (e) {
            console.error('Submit current week failed', e)
            toast.error(`Submission failed: ${e.message || 'Unknown error'}`);
        } finally {
            setIsSubmitting(false)
        }
    }



    const handleOpenViewTimesheetModal = (timesheet) => {
        setSelectedTimesheet(timesheet);
        setViewModalOpen(true)
    }

    const handleCloseViewTimesheetModal = () => {
        setSelectedTimesheet(null);
        setViewModalOpen(false)
    }
    const canEditOwnTimesheet = true;

    const handleOpenEditTimesheetModal = (timesheet) => {
        if (!getTimesheetEditPermissions(timesheet, user)) {
            console.warn('Cannot edit submitted timesheet');
            return;
        }
        setSelectedTimesheet(timesheet);
        setViewModalOpen(false);
        setEditModalOpen(true);
    }


    const handleSave = async (newTimesheet) => {
        console.log("Saving new timesheet:", newTimesheet)

        try {
            // Here you would typically save the timesheet data
            // For now, we'll just close the modal and refresh the data

            // Close the edit modal
            setEditModalOpen(false);

            // Clear selected timesheet
            setSelectedTimesheet(null);

            // EditTimesheetModal already toasts on save

            // Refresh timesheet data to reflect changes
            // You might need to call a refresh function here
            // refreshTimesheets(); 

        } catch (error) {
            console.error('Error saving timesheet:', error);
            toast.error('Failed to save timesheet. Please try again.');
        }
    }

    const handleSubmitWeek = async (timesheet) => {
        const weekKey = timesheet.raw.weekKey;
        const submissionStartTime = Date.now();

        // ── Frontend-side week-end gate ──────────────────────────────────────
        const weekEndDate = timesheet.weekEndDate || timesheet.raw?.end || timesheet.raw?.weekEnd;
        if (!canSubmitTimesheet(weekEndDate)) {
            const reason = getSubmitBlockedReason(weekEndDate);
            toast.warning(reason || 'Submit is not available until the week ends.');
            return;
        }

        try {
            setIsSubmitting(true);

            // OPTIMISTIC UPDATE: specific week only
            setOptimisticStatusMap(prev => ({ ...prev, [weekKey]: 'Pending' }));

            const weekStart = timesheet.raw.start;

            Promise.resolve()
                .then(() => submitWeek(user?.uid, weekStart))
                .then(() => {
                    const duration = Date.now() - submissionStartTime;
                    toast.success(`✅ Timesheet for ${timesheet.week} submitted for approval!`);
                })
                .catch((e) => {
                    // Revert optimistic update on failure
                    setOptimisticStatusMap(prev => {
                        const next = { ...prev };
                        delete next[weekKey];
                        return next;
                    });

                    let errorMessage = 'Submission failed';
                    if (e?.message?.includes('WEEK_NOT_ENDED') || e?.message?.includes('week ends')) {
                        errorMessage = e.message;
                    } else if (e?.message?.includes('timeout')) {
                        errorMessage = 'Submission timed out — please check your connection and try again';
                    } else if (e?.message?.includes('permission')) {
                        errorMessage = 'You do not have permission to submit this timesheet';
                    } else if (e?.message) {
                        errorMessage = `Submission failed: ${e.message}`;
                    }
                    toast.error(errorMessage);
                });

            // Background cache invalidation
            setTimeout(() => {
                import('../../../services/timesheetCache').then(({ invalidateTimesheetCache }) => {
                    invalidateTimesheetCache(user?.uid, weekStart);
                }).catch(() => {});
            }, 100);

        } catch (e) {
            setOptimisticStatusMap(prev => {
                const next = { ...prev };
                delete next[weekKey];
                return next;
            });

            let errorMessage = 'Submission failed';
            if (e.message?.includes('WEEK_NOT_ENDED') || e.message?.includes('week ends')) {
                errorMessage = e.message;
            } else if (e.message?.includes('timeout')) {
                errorMessage = 'Submission timed out — please check your connection and try again';
            } else if (e.message?.includes('permission')) {
                errorMessage = 'You do not have permission to submit this timesheet';
            } else if (e.message) {
                errorMessage = `Submission failed: ${e.message}`;
            }
            toast.error(errorMessage);
        } finally {
            setIsSubmitting(false);
        }
    }

    const handleCloseEditTimesheetModal = () => {
        setSelectedTimesheet(null);
        setEditModalOpen(false)
    }

    const monthYearOptions = useMemo(() => {
        const months = new Map();
        const years = new Set();
        timesheets.forEach(ts => {
            if (!(ts.weekEndDate instanceof Date)) return;
            const monthIndex = ts.weekEndDate.getMonth();
            const monthLabel = ts.weekEndDate.toLocaleString('en-US', { month: 'long' });
            months.set(monthIndex, monthLabel);
            years.add(ts.weekEndDate.getFullYear());
        });
        return {
            months: Array.from(months.entries())
                .sort((a, b) => a[0] - b[0])
                .map(([value, label]) => ({ value: String(value), label })),
            years: Array.from(years.values())
                .sort((a, b) => b - a)
                .map((value) => ({ value: String(value), label: String(value) }))
        };
    }, [timesheets]);

    const filteredTimesheets = useMemo(() => {
        return timesheets.filter(ts => {
            if (!(ts.weekEndDate instanceof Date)) return true;
            const matchYear = selectedYear === 'all' || ts.weekEndDate.getFullYear() === Number(selectedYear);
            const matchMonth = selectedMonth === 'all' || ts.weekEndDate.getMonth() === Number(selectedMonth);
            return matchYear && matchMonth;
        });
    }, [timesheets, selectedMonth, selectedYear]);

    const sortedTimesheets = useMemo(() => {
        return [...filteredTimesheets].sort((a, b) => {
            // Get week start dates for week-based sorting
            const weekStartA = a.raw?.start || a.weekStartDate;
            const weekStartB = b.raw?.start || b.weekStartDate;

            const dateA = weekStartA instanceof Date ? weekStartA : new Date(weekStartA || 0);
            const dateB = weekStartB instanceof Date ? weekStartB : new Date(weekStartB || 0);

            // Sort by week start date (newest weeks first - bigger weeks first)
            return dateB.getTime() - dateA.getTime();
        });
    }, [filteredTimesheets]);


    return (
        <div className="bg-white p-4 rounded-base shadow-lg">

            <div className="space-y-4xl ">
                <h2 className="text-2xl  font-bold text-text-primary">My Timesheet History</h2>

                {/* Current Week Summary removed per request */}

                <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
                    <Button
                        onClick={() => setAddModalOpen(true)}
                        variant="gradient"
                        cn="w-full md:w-auto"
                    >
                        + Add Timesheet
                    </Button>

                    <div className="flex flex-col sm:flex-row gap-3">
                        <div className="flex items-center gap-2">
                            <label htmlFor="month-select" className="text-sm text-text-secondary">Month</label>
                            <select
                                id="month-select"
                                value={selectedMonth}
                                onChange={(e) => setSelectedMonth(e.target.value)}
                                className="h-10 px-3 border border-border-secondary rounded-lg text-sm focus:outline-none focus:border-border-accent-purple"
                            >
                                <option value="all">All</option>
                                {monthYearOptions.months.map(option => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="flex items-center gap-2">
                            <label htmlFor="year-select" className="text-sm text-text-secondary">Year</label>
                            <select
                                id="year-select"
                                value={selectedYear}
                                onChange={(e) => setSelectedYear(e.target.value)}
                                className="h-10 px-3 border border-border-secondary rounded-lg text-sm focus:outline-none focus:border-border-accent-purple"
                            >
                                <option value="all">All</option>
                                {monthYearOptions.years.map(option => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                <div className="bg-white border border-border-primary rounded-base">
                    {isLoading ? (
                        <div className="flex items-center justify-center h-40">
                            <Loader variant="pulse" size="md" text="Loading timesheet data..." />
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableHeaderCell>Week Ending</TableHeaderCell>
                                <TableHeaderCell>Paid Hours</TableHeaderCell>
                                <TableHeaderCell>Overtime</TableHeaderCell>
                                <TableHeaderCell>Status</TableHeaderCell>
                                <TableHeaderCell>Submitted</TableHeaderCell>
                                <TableHeaderCell>Actions</TableHeaderCell>
                            </TableHeader>
                            <TableBody>
                                {sortedTimesheets.map((timesheet, index) => (
                                    <TableRow key={index}>
                                        <TableCell>
                                            <span className="font-medium text-text-primary">{timesheet.week}</span>
                                        </TableCell>
                                        <TableCell>
                                            <span className="text-text-secondary">{timesheet.hours}</span>
                                        </TableCell>
                                        <TableCell>
                                            <span className="text-orange-600 font-medium">{timesheet.overtime}</span>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={timesheet.status === 'Approved' ? 'success' : timesheet.status === 'Pending' ? 'warning' : timesheet.status === 'Rejected' ? 'danger' : 'info'}>
                                                {timesheet.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <span className="text-text-secondary">{timesheet.submitted}</span>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col sm:flex-row gap-md">
                                                {/* {canEditOwnTimesheet && timesheet.status !== 'Approved' && (
                                                    <>
                                                        <Button
                                                            onClick={() => handleOpenEditTimesheetModal(timesheet)}
                                                            variant="outline-primary">Edit</Button>

                                                    </>
                                                )} */}

                                                {(() => {
                                                    const weekData = weeksByKey?.[timesheet.id];
                                                    const today = new Date();
                                                    const weekEnd = new Date(timesheet.weekEndDate);
                                                    const canSubmit = shouldShowSubmitButton(
                                                        timesheet,
                                                        companySettings,
                                                        absencesMap,
                                                        {
                                                            weekData,
                                                            checkTodayCompletion: true,
                                                            isCurrentlyActive: today <= weekEnd
                                                        }
                                                    );
                                                    return canSubmit;
                                                })() && (
                                                        <>
                                                            <Button
                                                                onClick={() => handleSubmitWeek(timesheet)}
                                                                variant="gradient"
                                                                disabled={isSubmitting}>
                                                                Submit for Approval
                                                            </Button>
                                                        </>
                                                    )}
                                                <Button
                                                    onClick={() => handleOpenViewTimesheetModal(timesheet)}
                                                    variant="outline-primary">View</Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                    <p className="text-xs py-4 text-text-secondary text-center md:hidden">
                        ← Scroll horizontally to view all columns →
                    </p>
                </div>

            </div>
            <ViewTimesheetModal
                isOpen={viewModalOpen}
                onClose={handleCloseViewTimesheetModal}
                timesheet={selectedTimesheet}
                onEdit={handleOpenEditTimesheetModal}
                onApprove={handleSubmitWeek}
                isOwnTimesheet={true}  // ← Set to true for user's own timesheet
                canEdit={getTimesheetEditPermissions(selectedTimesheet, user)}
                companySettings={companySettings}
                absencesMap={absencesMap}
            />
            <EditTimesheetModal
                isOpen={editModalOpen}
                onClose={handleCloseEditTimesheetModal}
                onSave={handleSave}
                timesheet={selectedTimesheet}
            />
            <AddTimesheetModal
                isOpen={addModalOpen}
                onClose={() => setAddModalOpen(false)}
            />
        </div>

    );
};