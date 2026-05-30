import React, { Fragment, memo, useCallback } from 'react';
import Button from '../../../components/ui/Button';
import { formatISODate } from '../../../utils/weekStartUtils';
import { canEditTargetTimesheet } from '../../../utils/timesheetPermissions';
import { applyRoundingToDate, applyRoundingToTimeString } from '../../../utils/timeRounding';
import { detectAndConvertToLocal } from '../../../utils/timeDisplayUtils';

// Add CSS for auto clock-out styling
const autoClockOutStyles = `
    .auto-clock-out-badge {
        background-color: #faf5ff !important;
        color: #7c3aed !important;
        border-color: #e9d5ff !important;
        border-width: 1px !important;
        border-style: solid !important;
    }
`;

const TimeEntryRow = ({
    userId,
    user,
    userEntries,
    weekDates,
    roundingRules = null,
    showActualTime = false,
    canManageTimeEntries,
    canModifyTimeEntries,
    currentUser,
    deletingEntryId,
    onSubmitWeek,
    timesheetStatus,
    isSubmitting,
    onEditEntry,
    onDeleteEntry,
    onAddEntry,
    formatTime,
    getUserDisplayName
}) => {
    // Helper function to check for auto clock-out based on notes only
    const isAutoClockOutSession = (session) => {
        return (session.notes && session.notes.toLowerCase().includes('system clock out')) ||
            (session.notes && session.notes.toLowerCase().includes('automatically clocked out')) ||
            (session.notes && session.notes.toLowerCase().includes('auto clock out')) ||
            (session.notes && session.notes.toLowerCase().includes('auto-clock-out')) ||
            (session.notes && session.notes.toLowerCase().includes('system-clock-out')) ||
            (session.notes && session.notes.toLowerCase().includes('clocked out due to shift end'));
    };
    const userData = user || {};
    const displayName = getUserDisplayName(userId);
    const userEmail = userData.email || '';

    const toDateSafe = (val) => {
        if (!val) return null;
        try {
            if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val;
            if (val?.toDate) {
                const d = val.toDate();
                return Number.isNaN(d.getTime()) ? null : d;
            }
            if (typeof val === 'string') {
                const d = new Date(val);
                return Number.isNaN(d.getTime()) ? null : d;
            }
            if (typeof val === 'object' && 'seconds' in val) {
                const d = new Date(val.seconds * 1000);
                return Number.isNaN(d.getTime()) ? null : d;
            }
        } catch { /* ignore */ }
        return null;
    };

    const dateFromHHMM = (timeStr, dateStr) => {
        if (!timeStr || typeof timeStr !== 'string') return null;
        const parts = timeStr.split(':');
        if (parts.length < 2) return null;
        const h = Number(parts[0]);
        const m = Number(String(parts[1]).slice(0, 2));
        if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
        const d = new Date(dateStr);
        d.setHours(h, m, 0, 0);
        return Number.isNaN(d.getTime()) ? null : d;
    };

    const getRoundedSessionStart = (session) => {
        const raw = toDateSafe(session?.startedAt);
        if (!raw) return null;
        if (showActualTime) return raw;
        return roundingRules ? applyRoundingToDate(raw, roundingRules.clockIn) : raw;
    };

    const getRoundedSessionEnd = (session) => {
        if (session?.status === 'open') return null;
        const raw = toDateSafe(session?.endedAt);
        if (!raw) return null;
        if (showActualTime) return raw;
        return roundingRules ? applyRoundingToDate(raw, roundingRules.clockOut) : raw;
    };

    const getSavedRoundedTime = (saved, dateStr, kind) => {
        const rawStr = kind === 'in'
            ? (saved?.rawClockIn || saved?.clockIn || null)
            : (saved?.rawClockOut || saved?.clockOut || null);

        const iso = kind === 'in'
            ? (saved?.rawStart || saved?.startedAt || null)
            : (saved?.rawEnd || saved?.endedAt || null);

        const parsedRaw = toDateSafe(rawStr);
        if (parsedRaw && !isNaN(parsedRaw.getTime()) && (rawStr instanceof Date || (typeof rawStr === 'string' && rawStr.includes('-') && rawStr.includes('T')))) {
            if (showActualTime) return parsedRaw;
            return roundingRules ? applyRoundingToDate(parsedRaw, kind === 'in' ? roundingRules.clockIn : roundingRules.clockOut) : parsedRaw;
        }

        const isManualSavedEntry = saved?.isManual === true || saved?.source === 'manual' || saved?.manual === true;

        if (typeof rawStr === 'string' && rawStr.includes(':')) {
            const displayStr = showActualTime
                ? rawStr
                : (roundingRules ? applyRoundingToTimeString(rawStr, kind === 'in' ? roundingRules.clockIn : roundingRules.clockOut) : rawStr);
            const isoSource = iso || (kind === 'in' ? saved?.startedAt : saved?.endedAt) || null;
            const localStr = isManualSavedEntry ? displayStr : detectAndConvertToLocal(displayStr, isoSource);
            return dateFromHHMM(localStr, dateStr) || dateFromHHMM(displayStr, dateStr);
        }

        const isoDate = toDateSafe(iso);
        if (isoDate) {
            if (showActualTime) return isoDate;
            return roundingRules ? applyRoundingToDate(isoDate, kind === 'in' ? roundingRules.clockIn : roundingRules.clockOut) : isoDate;
        }

        return null;
    };

    return (
        <>
            <style>{autoClockOutStyles}</style>
            <tr className="group hover:bg-bg-secondary/30 transition-colors">
                <td className="sticky left-0 z-10 bg-white group-hover:bg-bg-secondary/30 border-r border-border-secondary p-4 transition-colors">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-primary/10 to-brand-primary/20 flex items-center justify-center text-brand-primary font-bold text-xs ring-2 ring-white shadow-sm">
                                {(displayName && displayName.charAt(0)) || '?'}
                            </div>
                            <div className="flex flex-col min-w-0">
                                <span className="font-medium text-sm text-text-primary truncate" title={displayName}>
                                    {displayName}
                                </span>
                                <span className="text-xs text-text-tertiary truncate max-w-[140px]" title={userEmail}>
                                    {userEmail.split('@')[0]}
                                </span>
                            </div>
                        </div>
                    </div>
                </td>
                {weekDates.map((date, idx) => {
                    const dateStr = formatISODate(date);
                    const entry = userEntries[dateStr];
                    const sessions = entry?.sessions || [];
                    const isToday = new Date().toDateString() === date.toDateString();
                    const cellBgClass = isToday ? 'bg-brand-primary/[0.02]' : '';

                    const sortedSessions = [...sessions].sort((a, b) => {
                        const aTime = a.startedAt?.toDate ? a.startedAt.toDate().getTime() : 0;
                        const bTime = b.startedAt?.toDate ? b.startedAt.toDate().getTime() : 0;
                        return aTime - bTime;
                    });

                    let clockInTimes = [];
                    let clockOutTimes = [];
                    const coveredSessionIds = new Set();
                    const renderedEntrySignatures = new Set();
                    const renderedInTimes = new Set();
                    const renderedOutTimes = new Map(); // Use Map to track metadata per time string

                    // Helper to parse time string back to sortable value (minutes since midnight)
                    const timeToMinutes = (timeStr) => {
                        if (!timeStr || timeStr === 'Open') return Infinity;
                        const [time, period] = timeStr.split(' ');
                        const [hours, minutes] = time.split(':').map(Number);
                        let totalMinutes = hours * 60 + minutes;
                        if (period === 'PM' && hours !== 12) totalMinutes += 12 * 60;
                        if (period === 'AM' && hours === 12) totalMinutes = 0; // 12 AM is 0
                        return totalMinutes;
                    };

                    if (entry?.savedEntries) {
                        entry.savedEntries.forEach(e => {
                            const startDt = toDateSafe(e.rawStart) || toDateSafe(e.clockIn) || dateFromHHMM(e.clockIn, dateStr);
                            const endDt = toDateSafe(e.rawEnd) || toDateSafe(e.clockOut) || dateFromHHMM(e.clockOut, dateStr);
                            const startVal = startDt ? startDt.getTime() : (e.clockIn || 'NONE');
                            const endVal = endDt ? endDt.getTime() : (e.clockOut || 'NONE');

                            const sig = `${startVal}-${endVal}-${e.activityType || ''}-${(e.description || e.notes || '').trim()}`;

                            if (renderedEntrySignatures.has(sig)) {
                                e._isDuplicateRender = true;
                                return;
                            }
                            renderedEntrySignatures.add(sig);

                            const hasClockOutValue = Boolean(
                                e.rawEnd || e.rawClockOut || e.roundedEnd || e.clockOut
                            );

                            if (hasClockOutValue) {
                                if (e.sessionIds) e.sessionIds.forEach(id => coveredSessionIds.add(id));
                                if (e.sessionKey) coveredSessionIds.add(e.sessionKey);
                                if (e.sessionId) coveredSessionIds.add(e.sessionId);
                            }
                        });
                    }

                    let hasRenderableSession = false;

                    sortedSessions.forEach(session => {
                        const isOpenSession = session.status === 'open';

                        if (coveredSessionIds.has(session.id)) return;

                        // FIX: Allow rendering manual sessions if they are NOT yet covered by a consolidated timesheet entry.
                        // Previously, we skipped all manual sessions assuming they'd be in savedEntries, 
                        // but if the timesheet isn't consolidated yet, they would be invisible.
                        // if (session.isManual === true) return;
                        // if (session.source === 'manual' || session.source === 'migration') return;


                        const startedAt = getRoundedSessionStart(session);
                        const endedAt = getRoundedSessionEnd(session);

                        if (startedAt && endedAt && endedAt.getTime() <= startedAt.getTime()) {
                            return;
                        }

                        if (startedAt && (endedAt || isOpenSession)) {
                            const formattedIn = formatTime(startedAt);
                            const normalizedIn = formattedIn.trim().toLowerCase();

                            const existingIdx = clockInTimes.findIndex(t => t.time.trim().toLowerCase() === normalizedIn);
                            if (existingIdx === -1) {
                                clockInTimes.push({ time: formattedIn, entry: session });
                                renderedInTimes.add(normalizedIn);
                                hasRenderableSession = true;
                            } else if (isOpenSession && clockInTimes[existingIdx].entry?.status !== 'open') {
                                clockInTimes[existingIdx] = { time: formattedIn, entry: session };
                            }
                        }

                        if (endedAt) {
                            const formattedOut = formatTime(endedAt);
                            const normalizedOut = formattedOut.trim().toLowerCase();
                            const isAuto = isAutoClockOutSession(session);

                            if (!renderedOutTimes.has(normalizedOut)) {
                                renderedOutTimes.set(normalizedOut, {
                                    time: formattedOut,
                                    entry: session,
                                    isAutoClockOut: isAuto,
                                    startMatch: formatTime(startedAt)
                                });
                                hasRenderableSession = true;
                            } else if (isAuto) {
                                const existing = renderedOutTimes.get(normalizedOut);
                                existing.isAutoClockOut = true;
                            }
                        } else if (isOpenSession && startedAt) {
                            const normalizedOut = `open-${session.id}`;
                            const startTimeStr = formatTime(startedAt);
                            if (!renderedOutTimes.has(normalizedOut)) {
                                renderedOutTimes.set(normalizedOut, {
                                    time: 'Open',
                                    entry: session,
                                    isAutoClockOut: false,
                                    isOpen: true,
                                    startMatch: startTimeStr
                                });
                                hasRenderableSession = true;
                            }
                        }
                    });

                    if (entry?.savedEntries && entry.savedEntries.length > 0) {
                        entry.savedEntries.forEach(saved => {
                            if (saved.isDescriptionOnly) return;
                            if (saved._isDuplicateRender) return;
                            const outDt = getSavedRoundedTime(saved, dateStr, 'out');
                            const inDt = getSavedRoundedTime(saved, dateStr, 'in');

                            const hasAnyOutValue = Boolean(
                                saved?.rawEnd ||
                                saved?.rawClockOut ||
                                saved?.clockOut ||
                                saved?.endedAt
                            );

                            if (!outDt && inDt && (saved?.status === 'open' || !hasAnyOutValue)) {
                                const formattedIn = formatTime(inDt);
                                const normalizedIn = formattedIn.trim().toLowerCase();

                                const existingIdx = clockInTimes.findIndex(t => t.time.trim().toLowerCase() === normalizedIn);
                                if (existingIdx === -1) {
                                    clockInTimes.push({ time: formattedIn, entry: saved });
                                    renderedInTimes.add(normalizedIn);
                                } else if (saved.status === 'open' && clockInTimes[existingIdx].entry?.status !== 'open') {
                                    clockInTimes[existingIdx] = { time: formattedIn, entry: saved };
                                }

                                const normalizedOut = `open-saved-${saved.id || saved.sessionId || saved.sessionKey || normalizedIn}`;
                                if (!renderedOutTimes.has(normalizedOut)) {
                                    renderedOutTimes.set(normalizedOut, {
                                        time: 'Open',
                                        entry: saved,
                                        isAutoClockOut: false,
                                        isOpen: true,
                                        startMatch: formattedIn
                                    });
                                }
                                return;
                            }

                            if (outDt) {
                                if (inDt && outDt.getTime() <= inDt.getTime()) return;

                                if (inDt) {
                                    const formattedIn = formatTime(inDt);
                                    const normalizedIn = formattedIn.trim().toLowerCase();

                                    const existingIdx = clockInTimes.findIndex(t => t.time.trim().toLowerCase() === normalizedIn);
                                    if (existingIdx === -1) {
                                        clockInTimes.push({ time: formattedIn, entry: saved });
                                        renderedInTimes.add(normalizedIn);
                                    }
                                }

                                const formattedOut = formatTime(outDt);
                                const normalizedOut = formattedOut.trim().toLowerCase();

                                const notesNorm = (saved.notes || '').toLowerCase();
                                const descNorm = (saved.description || '').toLowerCase();
                                const isAuto = notesNorm.includes('system clock out') ||
                                    notesNorm.includes('automatically clocked out') ||
                                    notesNorm.includes('auto clock out') ||
                                    notesNorm.includes('auto-clock-out') ||
                                    notesNorm.includes('system-clock-out') ||
                                    notesNorm.includes('clocked out due to shift end') ||
                                    descNorm.includes('system clock out') ||
                                    descNorm.includes('automatically clocked out') ||
                                    descNorm.includes('auto clock out') ||
                                    descNorm.includes('auto-clock-out') ||
                                    descNorm.includes('system-clock-out') ||
                                    descNorm.includes('clocked out due to shift end');

                                if (!renderedOutTimes.has(normalizedOut)) {
                                    renderedOutTimes.set(normalizedOut, {
                                        time: formattedOut,
                                        entry: saved,
                                        isAutoClockOut: isAuto,
                                        startMatch: inDt ? formatTime(inDt) : null
                                    });
                                } else if (isAuto) {
                                    const existing = renderedOutTimes.get(normalizedOut);
                                    existing.isAutoClockOut = true;
                                }
                            }
                        });
                    }

                    // Sort clock-in times chronologically
                    clockInTimes.sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));

                    // Sort clock-out times chronologically
                    clockOutTimes.sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));

                    // [FINAL SMART DEDUPLICATION]
                    // Group clock-outs by their start match time. If multiple outs exist for one start time,
                    // pick the "most relevant" one (Open sessions win).
                    const deduplicatedOutsMap = new Map();
                    Array.from(renderedOutTimes.values()).forEach(out => {
                        const key = out.startMatch || out.time; // Use start time as key if possible
                        if (!deduplicatedOutsMap.has(key)) {
                            deduplicatedOutsMap.set(key, out);
                        } else {
                            const existing = deduplicatedOutsMap.get(key);
                            // If this one is Open and existing is not, this one wins
                            if (out.isOpen && !existing.isOpen) {
                                deduplicatedOutsMap.set(key, out);
                            }
                            // Otherwise keep existing (first one found)
                        }
                    });
                    clockOutTimes = Array.from(deduplicatedOutsMap.values());

                    // Safety net: if we had sessions for the day but everything got filtered out
                    // (e.g. overly-aggressive duplicate detection), make sure at least one
                    // clock-in/clock-out pair is rendered so the UI never shows an empty day.
                    if (hasRenderableSession && clockInTimes.length === 0) {
                        sortedSessions.forEach(session => {
                            const startedAt = getRoundedSessionStart(session);
                            const endedAt = getRoundedSessionEnd(session);
                            if (startedAt && endedAt && endedAt.getTime() > startedAt.getTime()) {
                                const formattedIn = formatTime(startedAt);
                                if (!renderedInTimes.has(formattedIn)) {
                                    clockInTimes.push({ time: formattedIn, entry: session });
                                    renderedInTimes.add(formattedIn);
                                }
                            }
                        });
                    }

                    if (hasRenderableSession && clockOutTimes.length === 0) {
                        sortedSessions.forEach(session => {
                            const endedAt = getRoundedSessionEnd(session);
                            if (!endedAt) return;

                            const startedAt = getRoundedSessionStart(session);
                            if (startedAt && endedAt.getTime() <= startedAt.getTime()) return;

                            // Check if this is an auto clock-out entry
                            const isAutoClockOut = isAutoClockOutSession(session);

                            clockOutTimes.push({
                                time: formatTime(endedAt),
                                entry: session,
                                isAutoClockOut
                            });
                        });
                    }


                    const canEditCell = canManageTimeEntries && canEditTargetTimesheet(currentUser?.role, currentUser?.uid, userId);
                    const hasEntries = clockInTimes.length > 0;

                    // Check if date is in the future
                    const isFutureDate = date > new Date();

                    const handleAddClick = (e) => {
                        if (canManageTimeEntries && canModifyTimeEntries && !isFutureDate) {
                            e?.stopPropagation();
                            onAddEntry(dateStr, userId);
                        }
                    };

                    const handleEditEntry = (entryToEdit) => {
                        if (!canModifyTimeEntries) return;
                        // Clicking a specific time should open the edit dialog for that exact entry/session.
                        // Deletion is handled explicitly via the red "×" button.
                        onEditEntry(entryToEdit, dateStr, userId);
                    };

                    return (
                        <Fragment key={idx}>
                            <td
                                className={`relative border-r border-border-secondary p-2 align-top text-center transition-all h-[72px] ${cellBgClass}
                                ${(!hasEntries && canManageTimeEntries && canModifyTimeEntries && !isFutureDate) ? 'cursor-pointer hover:bg-black/5' : ''}
                                group/entry
                            `}
                                onClick={() => {
                                    if (!hasEntries && canManageTimeEntries && canModifyTimeEntries && !isFutureDate) handleAddClick();
                                }}
                            >
                                <div className="flex flex-col gap-1.5 items-center w-full min-h-full justify-start pt-1">
                                    {clockInTimes.length > 0 ? (
                                        <div className="flex flex-col gap-1.5 items-center w-full">
                                            {clockInTimes.map((item, idx) => {
                                                const isDeleting = deletingEntryId === (item.entry?.id || item.entry?.sessionId);
                                                const uniqueKey = `${item.time}-${item.entry?.id || item.entry?.sessionId || idx}`;
                                                return (
                                                    <div key={uniqueKey} className="relative group/badge inline-flex items-center gap-1">
                                                        <span
                                                            onClick={(e) => {
                                                                if (canManageTimeEntries && canModifyTimeEntries && item.entry) {
                                                                    e.stopPropagation();
                                                                    // Show remove/cancel icon instead of edit dialog
                                                                    handleEditEntry(item.entry);
                                                                }
                                                            }}
                                                            className={`
                            inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold
                            ${canManageTimeEntries && canModifyTimeEntries ? 'hover:scale-105 active:scale-95 cursor-pointer shadow-sm' : ''}
                            bg-emerald-50 text-emerald-700 border border-emerald-100
                            transition-all
                            ${isDeleting ? 'opacity-50' : ''}
                        `}
                                                        >
                                                            {item.time}
                                                        </span>
                                                        {(canManageTimeEntries && canModifyTimeEntries && item.entry && item.entry.status !== 'open') && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    onDeleteEntry(item.entry, dateStr, userId);
                                                                }}
                                                                disabled={isDeleting}
                                                                className="w-4 h-4 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center transition-all shadow-sm disabled:opacity-50 md:opacity-0 group-hover/badge:opacity-100 flex-shrink-0 ml-1"
                                                                title="Remove/Cancel entry"
                                                            >
                                                                {isDeleting ? (
                                                                    <div className="animate-spin rounded-full h-2 w-2 border border-white border-t-transparent"></div>
                                                                ) : (
                                                                    <span className="text-[10px] font-bold leading-none">×</span>
                                                                )}
                                                            </button>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <span className="text-text-quaternary text-lg font-light select-none pt-2">—</span>
                                    )}
                                </div>
                                {canManageTimeEntries && canModifyTimeEntries && !isFutureDate && (
                                    <div
                                        onClick={handleAddClick}
                                        className={`
                                        absolute top-1 right-1 w-5 h-5 rounded flex items-center justify-center
                                        bg-[linear-gradient(91.36deg,#AF54DD_4.75%,#7617A7_96.14%)] text-white text-xs font-bold shadow-sm
                                        opacity-0 group-hover/entry:opacity-100 transition-opacity cursor-pointer z-10
                                    `}
                                        title="Add entry"
                                    >
                                        +
                                    </div>
                                )}
                            </td>
                            <td
                                className={`relative border-r border-border-secondary p-2 align-top text-center transition-all h-[72px] ${cellBgClass}
                                ${(!hasEntries && canManageTimeEntries && canModifyTimeEntries && !isFutureDate) ? 'cursor-pointer hover:bg-black/5' : ''}
                                group/entry
                            `}
                                onClick={() => {
                                    if (!hasEntries && canManageTimeEntries && canModifyTimeEntries && !isFutureDate) handleAddClick();
                                }}
                            >
                                <div className="flex flex-col gap-1.5 items-center w-full min-h-full justify-start pt-1">
                                    {clockOutTimes.length > 0 ? (
                                        <div className="flex flex-col gap-1.5 items-center w-full">
                                            {clockOutTimes.map((item, idx) => {
                                                const isDeleting = deletingEntryId === (item.entry?.id || item.entry?.sessionId);
                                                const uniqueKey = `${item.time}-${item.entry?.id || item.entry?.sessionId || idx}-${item.isAutoClockOut ? 'auto' : 'manual'}`;
                                                return (
                                                    <div key={uniqueKey} className="relative group/badge inline-flex items-center gap-1">
                                                        <span
                                                            onClick={(e) => {
                                                                if (canEditCell && item.entry) {
                                                                    e.stopPropagation();
                                                                    // Show remove/cancel icon instead of edit dialog
                                                                    handleEditEntry(item.entry);
                                                                }
                                                            }}
                                                            className={`
                                    inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold
                                    ${canEditCell ? 'hover:scale-105 active:scale-95 cursor-pointer shadow-sm' : ''}
                                    ${item.isOpen
                                                                    ? 'bg-amber-50 text-amber-700 border border-amber-100'
                                                                    : item.isAutoClockOut
                                                                        ? 'auto-clock-out-badge'
                                                                        : 'bg-slate-100 text-slate-700 border border-slate-200'
                                                                }
                                    ${isDeleting ? 'opacity-50' : ''}
                                `}
                                                        >
                                                            {item.time}
                                                            {item.isAutoClockOut && (
                                                                <span className="ml-1 text-xs font-medium">🤖</span>
                                                            )}
                                                        </span>
                                                        {(canManageTimeEntries && canModifyTimeEntries && item.entry && item.entry.status !== 'open') && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    onDeleteEntry(item.entry, dateStr, userId);
                                                                }}
                                                                disabled={isDeleting}
                                                                className="w-4 h-4 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center transition-all shadow-sm disabled:opacity-50 md:opacity-0 group-hover/badge:opacity-100 flex-shrink-0 ml-1"
                                                                title="Remove/Cancel entry"
                                                            >
                                                                {isDeleting ? (
                                                                    <div className="animate-spin rounded-full h-2 w-2 border border-white border-t-transparent"></div>
                                                                ) : (
                                                                    <span className="text-[10px] font-bold leading-none">×</span>
                                                                )}
                                                            </button>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <span className="text-text-quaternary text-lg font-light select-none pt-2">—</span>
                                    )}
                                </div>
                                {canManageTimeEntries && canModifyTimeEntries && !isFutureDate && (
                                    <div
                                        onClick={handleAddClick}
                                        className={`
                                        absolute top-1 right-1 w-5 h-5 rounded flex items-center justify-center
                                        bg-[linear-gradient(91.36deg,#AF54DD_4.75%,#7617A7_96.14%)] text-white text-xs font-bold shadow-sm
                                        opacity-0 group-hover/entry:opacity-100 transition-opacity cursor-pointer z-10
                                    `}
                                        title="Add entry"
                                    >
                                        +
                                    </div>
                                )}
                            </td>
                        </Fragment>
                    );
                })}
            </tr>
        </>
    );
};

export default memo(TimeEntryRow);
