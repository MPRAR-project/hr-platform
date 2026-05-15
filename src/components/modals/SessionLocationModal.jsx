import React, { useEffect, useState } from 'react';
import { X, MapPin, Clock, Calendar, AlertTriangle, CheckCircle, Monitor, Smartphone, UserCheck, RefreshCw } from 'lucide-react';
import { getSessionById } from '../../services/timeClock';
import Button from '../ui/Button';

const SessionLocationModal = ({ isOpen, onClose, session }) => {
    const [fullSession, setFullSession] = useState(session);
    const [loadingLocation, setLoadingLocation] = useState(false);

    useEffect(() => {
        // Reset and sync when session/isOpen changes
        setFullSession(session);

        const fetchMissingLocationData = async () => {
            if (!isOpen || !session?.sessionId) return;

            // Check if we already have location data (latitude check)
            const hasStartLoc = session.location?.lat !== undefined;
            const hasEndLoc = session.clockOutLocation?.lat !== undefined;

            // If we have both (or appropriate for status), we might not need to fetch, 
            // BUT for manual entries from history, we might be missing device info or explicit 'manual' flags 
            // if the timesheet entry was created before the fix.
            // A safe heuristic: If it's a manual source but missing location, definitely fetch.
            // Or if we just want to be robust: Fetch if *any* expected location is missing.

            // For now, let's trigger fetch if we lack start location which is common for valid sessions
            // OR if it's manual and we suspect missing data.

            const needsFetch = !hasStartLoc || (!hasEndLoc && session.clockOut);

            if (needsFetch) {
                setLoadingLocation(true);
                try {
                    console.log('Fetching full session data for:', session.sessionId);
                    const data = await getSessionById(session.sessionId);
                    if (data) {
                        setFullSession(prev => ({
                            ...prev,
                            // Merge missing data, prioritizing the fetched session data for locations
                            location: data.location || prev.location,
                            clockOutLocation: data.clockOutLocation || prev.clockOutLocation,
                            deviceInfo: data.deviceInfo || prev.deviceInfo,
                            clockOutDeviceInfo: data.clockOutDeviceInfo || prev.clockOutDeviceInfo,
                            // Ensure manual flags are captured
                            isManual: prev.isManual || data.isManual,
                            source: prev.source || data.source,
                            notes: prev.notes || data.notes
                        }));
                    }
                } catch (err) {
                    console.error("Failed to fetch background session data", err);
                } finally {
                    setLoadingLocation(false);
                }
            }
        };

        fetchMissingLocationData();
    }, [session, isOpen]);


    if (!isOpen || !fullSession) return null;

    const MapEmbed = ({ lat, lng }) => {
        if (!lat || !lng) return <div className="bg-gray-100 h-40 flex items-center justify-center text-gray-400 text-xs text-center p-4 rounded-lg">Map unavailable<br />(No coordinates)</div>;

        const offset = 0.005;
        const bbox = `${lng - offset},${lat - offset},${lng + offset},${lat + offset}`;
        const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;

        return (
            <div className="rounded-lg overflow-hidden border border-gray-200 h-40 relative bg-gray-50">
                <iframe
                    width="100%"
                    height="100%"
                    src={src}
                    style={{ border: 0 }}
                    title="Session Location"
                ></iframe>
                <div className="absolute bottom-1 right-1 bg-white/80 px-1 text-[10px] text-gray-600 rounded z-10">OpenStreetMap</div>
                {/* Overlay to prevent interactions if desired, currently allows panning which is fine */}
            </div>
        );
    };

    const LocationInfo = ({ title, time, location, deviceInfo, isStart, source, isManual, isLoading }) => {
        // Safe check for valid coordinates
        const hasLoc = location && typeof location.lat === 'number' && typeof location.lng === 'number';
        const isWeb = deviceInfo?.type === 'web';
        const isManualEntry = isManual || source === 'manual';

        return (
            <div className="flex-1 min-w-[300px] border border-gray-200 rounded-xl p-4 bg-white shadow-sm flex flex-col h-full">
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-100">
                    <div className={`p-1.5 rounded-lg ${isStart ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
                        <MapPin size={18} />
                    </div>
                    <div>
                        <h3 className="text-sm font-bold text-gray-800">{title}</h3>
                        <div className="flex items-center gap-1.5 text-xs text-gray-500 font-medium">
                            <Clock size={12} />
                            {time || '--:--'}
                        </div>
                    </div>
                </div>

                <div className="space-y-3 flex-1">

                    {/* Loading State */}
                    {isLoading && !hasLoc && (
                        <div className="rounded-lg border border-gray-200 h-40 bg-gray-50 flex flex-col items-center justify-center text-gray-400 p-4 animate-pulse">
                            <RefreshCw size={24} className="mb-2 animate-spin opacity-50" />
                            <span className="text-xs">Fetching location details...</span>
                        </div>
                    )}

                    {/* Content (only show if not loading or if we have data) */}
                    {(!isLoading || hasLoc) && (
                        <>
                            {/* Web Indicator */}
                            {isWeb && (
                                <div className="rounded-lg border border-gray-200 bg-gray-50 flex flex-col items-center justify-center text-center p-3">
                                    <div className="bg-white p-2 rounded-full shadow-sm mb-1.5 text-purple-600">
                                        {deviceInfo?.platform === 'mobile_web' ? <Smartphone size={20} /> : <Monitor size={20} />}
                                    </div>
                                    <span className="font-semibold text-gray-700 text-sm">Clocked {isStart ? 'in' : 'out'} with Website</span>
                                    <span className="text-[10px] text-gray-400">{deviceInfo?.platform === 'mobile_web' ? 'Mobile Web' : 'Desktop / Laptop'}</span>
                                </div>
                            )}

                            {/* Map - Show if coordinates exist */}
                            {hasLoc && (
                                <MapEmbed lat={location?.lat} lng={location?.lng} />
                            )}

                            {/* Fallback visual if neither (e.g. mobile app with no GPS permission state) */}
                            {!isWeb && !hasLoc && (
                                <div className="rounded-lg border border-gray-200 h-32 bg-gray-50 flex flex-col items-center justify-center text-gray-400 text-xs text-center p-4">
                                    <MapPin size={24} className="mb-2 opacity-50" />
                                    <span>Location not captured</span>
                                    {isManualEntry && <span className="text-[10px] text-blue-500 font-medium mt-1">(Manual Entry)</span>}
                                </div>
                            )}

                            <div className="bg-gray-50 rounded-lg p-2.5 space-y-1.5">
                                {hasLoc ? (
                                    <>
                                        <div className="flex justify-between items-center text-xs">
                                            <span className="text-gray-500">Latitude</span>
                                            <span className="font-mono font-medium text-gray-700">{location.lat.toFixed(6)}</span>
                                        </div>
                                        <div className="flex justify-between items-center text-xs">
                                            <span className="text-gray-500">Longitude</span>
                                            <span className="font-mono font-medium text-gray-700">{location.lng.toFixed(6)}</span>
                                        </div>
                                        <div className="flex justify-between items-center text-xs">
                                            <span className="text-gray-500">Accuracy</span>
                                            <span className="font-mono font-medium text-gray-700">
                                                {location?.accuracy ? `±${Math.round(location.accuracy)}m` : 'N/A'}
                                            </span>
                                        </div>
                                        {isManualEntry && (
                                            <div className="pt-1 border-t border-gray-100 mt-1 flex justify-between items-center text-xs">
                                                <span className="text-gray-500">Source</span>
                                                <span className="font-medium text-blue-600 flex items-center gap-1">
                                                    <UserCheck size={10} /> Manual
                                                </span>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    !location?.error && (
                                        <div className="pt-1 border-t border-gray-100 mt-1">
                                            <span className="text-xs text-gray-400 italic">
                                                No location data provided
                                                {isManualEntry && " (Manual Entry)"}
                                            </span>
                                        </div>
                                    )
                                )}

                                {location?.error && (
                                    <div className="pt-1 border-t border-gray-100 mt-1">
                                        <span className="text-xs text-red-500 flex items-center gap-1 font-medium">
                                            <AlertTriangle size={12} /> {location.error}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        )
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl flex flex-col max-h-[90vh]">
                <div className="p-5 border-b border-gray-100 flex justify-between items-center shrink-0">
                    <div>
                        <h2 className="text-lg font-bold text-gray-900">Session Location Details</h2>
                        <div className="flex items-center gap-3 mt-1">
                            <p className="text-xs text-gray-500 flex items-center gap-1.5">
                                <Calendar size={12} />
                                {fullSession.date}
                            </p>
                            {fullSession.duration && (
                                <span className="text-xs font-mono font-medium bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">
                                    {fullSession.duration}
                                </span>
                            )}
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <LocationInfo
                            title="Clock In"
                            time={fullSession.clockIn}
                            location={fullSession.location}
                            deviceInfo={fullSession.deviceInfo}
                            isStart={true}
                            source={fullSession.source}
                            isManual={fullSession.isManual}
                            isLoading={loadingLocation}
                        />
                        <LocationInfo
                            title="Clock Out"
                            time={fullSession.clockOut || 'Active'}
                            location={fullSession.clockOutLocation}
                            deviceInfo={fullSession.clockOutDeviceInfo}
                            isStart={false}
                            source={fullSession.source}
                            isManual={fullSession.isManual}
                            isLoading={loadingLocation}
                        />
                    </div>

                    {fullSession.notes && (
                        <div className="mt-6 bg-gray-50 p-4 rounded-xl border border-gray-200">
                            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 flex items-center gap-1.5">
                                <FileText size={12} />
                                Session Notes
                            </div>
                            <p className="text-sm text-gray-700 italic">"{fullSession.notes}"</p>
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-gray-100 bg-gray-50/50 rounded-b-2xl flex justify-end shrink-0">
                    <Button onClick={onClose} variant="outline-primary">Close</Button>
                </div>
            </div>
        </div>
    );
};

// Helper for Lucide icon
const FileText = ({ size }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" x2="8" y1="13" y2="13" />
        <line x1="16" x2="8" y1="17" y2="17" />
        <line x1="10" x2="8" y1="9" y2="9" />
    </svg>
);

export default SessionLocationModal;
