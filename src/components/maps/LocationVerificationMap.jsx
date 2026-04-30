import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Circle, Popup } from 'react-leaflet';
import { X, MapPin, Navigation, Clock } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { formatDistance } from '../../services/locationService';

// Fix for default marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Custom marker icons
const assignedIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

const clockInIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

const clockOutIcon = new L.Icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

const LocationVerificationMap = ({ isOpen, onClose, session, assignedLocation, employeeName }) => {
    const [center, setCenter] = useState([20.5937, 78.9629]); // Default center of India
    const [zoom, setZoom] = useState(13);

    useEffect(() => {
        if (assignedLocation?.latitude && assignedLocation?.longitude) {
            setCenter([assignedLocation.latitude, assignedLocation.longitude]);
        } else if (session?.location?.clockIn?.lat && session?.location?.clockIn?.lng) {
            setCenter([session.location.clockIn.lat, session.location.clockIn.lng]);
        }
    }, [assignedLocation, session]);

    if (!isOpen) return null;

    const hasAssignedLocation = assignedLocation?.latitude && assignedLocation?.longitude;
    const hasClockIn = session?.location?.clockIn?.lat && session?.location?.clockIn?.lng;
    const hasClockOut = session?.location?.clockOut?.lat && session?.location?.clockOut?.lng;

    // Parse radius
    let radiusMeters = null;
    if (assignedLocation?.radius && assignedLocation.radius !== 'No Restriction') {
        const radiusStr = assignedLocation.radius.toLowerCase();
        if (radiusStr.includes('km')) {
            radiusMeters = parseFloat(radiusStr) * 1000;
        } else {
            radiusMeters = parseFloat(radiusStr);
        }
    }

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={onClose}></div>

            <div className="relative w-full max-w-5xl max-h-[90vh] bg-white rounded-2xl shadow-xl overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-200">
                    <div>
                        <h3 className="text-xl font-bold text-gray-900">Location Verification</h3>
                        <p className="text-sm text-gray-600 mt-1">
                            {employeeName} - {new Date(session?.clockInTime?.seconds * 1000 || session?.clockInTime).toLocaleDateString()}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <X className="h-5 w-5 text-gray-500" />
                    </button>
                </div>

                {/* Map Container */}
                <div className="h-[500px] relative">
                    {(hasAssignedLocation || hasClockIn) ? (
                        <MapContainer
                            center={center}
                            zoom={zoom}
                            style={{ height: '100%', width: '100%' }}
                        >
                            <TileLayer
                                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            />

                            {/* Assigned Location Marker */}
                            {hasAssignedLocation && (
                                <>
                                    <Marker
                                        position={[assignedLocation.latitude, assignedLocation.longitude]}
                                        icon={assignedIcon}
                                    >
                                        <Popup>
                                            <div className="text-sm">
                                                <p className="font-semibold text-blue-600">Assigned Location</p>
                                                <p>{assignedLocation.name}</p>
                                                {assignedLocation.address && <p className="text-gray-600">{assignedLocation.address}</p>}
                                            </div>
                                        </Popup>
                                    </Marker>

                                    {/* Radius Circle */}
                                    {radiusMeters && (
                                        <Circle
                                            center={[assignedLocation.latitude, assignedLocation.longitude]}
                                            radius={radiusMeters}
                                            pathOptions={{ color: 'blue', fillColor: 'blue', fillOpacity: 0.1 }}
                                        />
                                    )}
                                </>
                            )}

                            {/* Clock In Marker */}
                            {hasClockIn && (
                                <Marker
                                    position={[session.location.clockIn.lat, session.location.clockIn.lng]}
                                    icon={clockInIcon}
                                >
                                    <Popup>
                                        <div className="text-sm">
                                            <p className="font-semibold text-green-600">Clock In</p>
                                            <p>{new Date(session.location.clockIn.capturedAt?.seconds * 1000 || session.location.clockIn.capturedAt).toLocaleTimeString()}</p>
                                            <p className="text-gray-600">Accuracy: {session.location.clockIn.accuracy}m</p>
                                        </div>
                                    </Popup>
                                </Marker>
                            )}

                            {/* Clock Out Marker */}
                            {hasClockOut && (
                                <Marker
                                    position={[session.location.clockOut.lat, session.location.clockOut.lng]}
                                    icon={clockOutIcon}
                                >
                                    <Popup>
                                        <div className="text-sm">
                                            <p className="font-semibold text-red-600">Clock Out</p>
                                            <p>{new Date(session.location.clockOut.capturedAt?.seconds * 1000 || session.location.clockOut.capturedAt).toLocaleTimeString()}</p>
                                            <p className="text-gray-600">Accuracy: {session.location.clockOut.accuracy}m</p>
                                        </div>
                                    </Popup>
                                </Marker>
                            )}
                        </MapContainer>
                    ) : (
                        <div className="flex items-center justify-center h-full bg-gray-50">
                            <div className="text-center text-gray-500">
                                <MapPin className="h-12 w-12 mx-auto mb-2 opacity-50" />
                                <p>No location data available</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Info Panel */}
                <div className="p-6 border-t border-gray-200 bg-gray-50">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Assigned Location Info */}
                        <div className="bg-white p-4 rounded-lg border border-gray-200">
                            <div className="flex items-center gap-2 mb-2">
                                <MapPin className="h-5 w-5 text-blue-600" />
                                <h4 className="font-semibold text-gray-900">Assigned Location</h4>
                            </div>
                            {hasAssignedLocation ? (
                                <>
                                    <p className="text-sm text-gray-700">{assignedLocation.name}</p>
                                    {assignedLocation.radius && (
                                        <p className="text-xs text-gray-500 mt-1">
                                            Radius: {assignedLocation.radius === 'No Restriction' ? 'No Restriction' : assignedLocation.radius}
                                        </p>
                                    )}
                                </>
                            ) : (
                                <p className="text-sm text-gray-500">Not assigned</p>
                            )}
                        </div>

                        {/* Clock In Info */}
                        <div className="bg-white p-4 rounded-lg border border-gray-200">
                            <div className="flex items-center gap-2 mb-2">
                                <Navigation className="h-5 w-5 text-green-600" />
                                <h4 className="font-semibold text-gray-900">Clock In</h4>
                            </div>
                            {hasClockIn ? (
                                <>
                                    <p className="text-sm text-gray-700">
                                        {new Date(session.location.clockIn.capturedAt?.seconds * 1000 || session.location.clockIn.capturedAt).toLocaleTimeString()}
                                    </p>
                                    <p className="text-xs text-gray-500 mt-1">
                                        Accuracy: {session.location.clockIn.accuracy}m
                                    </p>
                                    {session.location.clockIn.assignedLocationName && (
                                        <p className="text-xs text-gray-500">
                                            At: {session.location.clockIn.assignedLocationName}
                                        </p>
                                    )}
                                </>
                            ) : (
                                <p className="text-sm text-gray-500">No GPS data</p>
                            )}
                        </div>

                        {/* Clock Out Info */}
                        <div className="bg-white p-4 rounded-lg border border-gray-200">
                            <div className="flex items-center gap-2 mb-2">
                                <Clock className="h-5 w-5 text-red-600" />
                                <h4 className="font-semibold text-gray-900">Clock Out</h4>
                            </div>
                            {hasClockOut ? (
                                <>
                                    <p className="text-sm text-gray-700">
                                        {new Date(session.location.clockOut.capturedAt?.seconds * 1000 || session.location.clockOut.capturedAt).toLocaleTimeString()}
                                    </p>
                                    <p className="text-xs text-gray-500 mt-1">
                                        Accuracy: {session.location.clockOut.accuracy}m
                                    </p>
                                </>
                            ) : (
                                <p className="text-sm text-gray-500">Not clocked out</p>
                            )}
                        </div>
                    </div>

                    <div className="mt-4 flex justify-end">
                        <button
                            onClick={onClose}
                            className="px-6 py-2.5 bg-gray-600 text-white rounded-lg hover:bg-gray-700 font-medium text-sm transition-colors"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LocationVerificationMap;
