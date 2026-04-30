import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import { X, MapPin, Search } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix for default marker icon in React-Leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Component to handle map clicks
function LocationMarker({ position, setPosition }) {
    useMapEvents({
        click(e) {
            setPosition(e.latlng);
        },
    });

    return position === null ? null : <Marker position={position} />;
}

const LocationPickerMap = ({ isOpen, onClose, onConfirm, initialLat, initialLng }) => {
    const [position, setPosition] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearching, setIsSearching] = useState(false);

    // Set initial position
    useEffect(() => {
        if (initialLat && initialLng) {
            setPosition({ lat: parseFloat(initialLat), lng: parseFloat(initialLng) });
        } else {
            // Default to a central location (you can change this)
            setPosition({ lat: 20.5937, lng: 78.9629 }); // Center of India
        }
    }, [initialLat, initialLng]);

    const handleConfirm = () => {
        if (position) {
            onConfirm(position.lat, position.lng);
            onClose();
        }
    };

    const handleSearch = async () => {
        if (!searchQuery.trim()) return;

        setIsSearching(true);
        try {
            // Using Nominatim (OpenStreetMap's geocoding service)
            const response = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}`
            );
            const data = await response.json();

            if (data && data.length > 0) {
                const { lat, lon } = data[0];
                setPosition({ lat: parseFloat(lat), lng: parseFloat(lon) });
            } else {
                alert('Location not found. Please try a different search term.');
            }
        } catch (error) {
            console.error('Geocoding error:', error);
            alert('Failed to search location. Please try again.');
        } finally {
            setIsSearching(false);
        }
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter') {
            handleSearch();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={onClose}></div>

            <div className="relative w-full max-w-4xl bg-white rounded-2xl shadow-xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-200">
                    <div>
                        <h3 className="text-xl font-bold text-gray-900">Select Location on Map</h3>
                        <p className="text-sm text-gray-600 mt-1">Click anywhere on the map to set coordinates</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <X className="h-5 w-5 text-gray-500" />
                    </button>
                </div>

                {/* Search Bar */}
                <div className="p-4 border-b border-gray-200 bg-gray-50">
                    <div className="flex gap-2">
                        <div className="flex-1 relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyPress={handleKeyPress}
                                placeholder="Search for a location (e.g., Mumbai, India)"
                                className="w-full h-12 pl-10 pr-4 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-purple-500"
                            />
                        </div>
                        <button
                            onClick={handleSearch}
                            disabled={isSearching || !searchQuery.trim()}
                            className="px-6 h-12 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isSearching ? 'Searching...' : 'Search'}
                        </button>
                    </div>
                </div>

                {/* Map Container */}
                <div className="h-[500px] relative">
                    {position && (
                        <MapContainer
                            center={[position.lat, position.lng]}
                            zoom={13}
                            style={{ height: '100%', width: '100%' }}
                            key={`${position.lat}-${position.lng}`} // Force re-render when position changes
                        >
                            <TileLayer
                                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            />
                            <LocationMarker position={position} setPosition={setPosition} />
                        </MapContainer>
                    )}
                </div>

                {/* Coordinates Display & Actions */}
                <div className="p-6 border-t border-gray-200 bg-gray-50">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <MapPin className="h-5 w-5 text-purple-600" />
                            <div>
                                <p className="text-sm font-medium text-gray-700">Selected Coordinates:</p>
                                {position && (
                                    <p className="text-sm text-gray-600">
                                        Lat: <span className="font-mono font-semibold">{position.lat.toFixed(6)}</span>,
                                        Lng: <span className="font-mono font-semibold">{position.lng.toFixed(6)}</span>
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end gap-3">
                        <button
                            onClick={onClose}
                            className="px-6 py-2.5 border-2 border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 font-medium text-sm transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={!position}
                            className="px-6 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Confirm Location
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LocationPickerMap;
