import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { Building, Edit2, Trash2, Plus, MapPin, Loader2, Navigation } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { getWorkLocations, addWorkLocation, updateWorkLocation, deleteWorkLocation } from '../../services/workLocations';
import { getSites } from '../../services/sites';
import { getUserCurrentLocation } from '../../services/locationService';
import Button from '../../components/ui/Button';
import Header from '../../components/layout/Header';
import DeleteConfirmationModal from '../../components/modals/DeleteConfirmationModal';

// Lazy load map component to avoid render-blocking CSS/JS
const LocationPickerMap = React.lazy(() => import('../../components/maps/LocationPickerMap'));



const WorkLocationsPage = () => {
    const { user } = useAuth();

    // Work Locations State
    const [workLocations, setWorkLocations] = useState([]);
    const [sites, setSites] = useState([]);
    const [isLoadingLocations, setIsLoadingLocations] = useState(true);
    const [showWorkLocationModal, setShowWorkLocationModal] = useState(false);
    const [editingWorkLocation, setEditingWorkLocation] = useState(null);
    const [workLocationForm, setWorkLocationForm] = useState({ name: '', address: '', latitude: '', longitude: '', radius: 'No Restriction', notes: '', parentSiteId: '' });
    const [isSavingWorkLocation, setIsSavingWorkLocation] = useState(false);
    const [isGettingWorkLocation, setIsGettingWorkLocation] = useState(false);
    const [showMapPicker, setShowMapPicker] = useState(false);
    const [showDeleteWorkLocationModal, setShowDeleteWorkLocationModal] = useState(false);
    const [workLocationToDelete, setWorkLocationToDelete] = useState(null);

    // Load Work Locations
    useEffect(() => {
        const loadWorkLocations = async () => {
            if (user?.companyId) {
                try {
                    setIsLoadingLocations(true);
                    setIsLoadingLocations(true);
                    const [locationsData, sitesData] = await Promise.all([
                        getWorkLocations(user.companyId),
                        getSites(user.companyId)
                    ]);
                    setWorkLocations(locationsData);
                    setSites(sitesData);
                } catch (e) {
                    console.error('Failed to load work locations', e);
                } finally {
                    setIsLoadingLocations(false);
                }
            }
        };
        loadWorkLocations();
    }, [user?.companyId, showWorkLocationModal, showDeleteWorkLocationModal]);

    // Work Location Handlers
    const handleAddWorkLocation = () => {
        setEditingWorkLocation(null);
        setWorkLocationForm({
            name: '',
            address: '',
            latitude: '',
            longitude: '',
            radius: 'No Restriction',
            notes: '',
            parentSiteId: ''
        });
        setShowWorkLocationModal(true);
    };

    const handleEditWorkLocation = (loc) => {
        setEditingWorkLocation(loc);
        setWorkLocationForm({
            name: loc.name,
            address: loc.address || '',
            latitude: loc.latitude?.toString() || '',
            longitude: loc.longitude?.toString() || '',
            radius: loc.radius || 'No Restriction',
            notes: loc.notes || '',
            parentSiteId: loc.parentSiteId || ''
        });
        setShowWorkLocationModal(true);
    };

    const handleSaveWorkLocation = async () => {
        if (!workLocationForm.name.trim()) {
            toast.error('Please enter a location name');
            return;
        }

        setIsSavingWorkLocation(true);
        try {
            const locationData = {
                name: workLocationForm.name.trim(),
                address: workLocationForm.address.trim() || null,
                latitude: workLocationForm.latitude ? parseFloat(workLocationForm.latitude) : null,
                longitude: workLocationForm.longitude ? parseFloat(workLocationForm.longitude) : null,
                radius: workLocationForm.radius === 'No Restriction' ? null : workLocationForm.radius,
                notes: workLocationForm.notes.trim() || null,
                parentSiteId: workLocationForm.parentSiteId || null
            };

            if (editingWorkLocation) {
                await updateWorkLocation(editingWorkLocation.id, locationData);
                toast.success('Work location updated');
            } else {
                await addWorkLocation(user.companyId, locationData);
                toast.success('Work location added');
            }
            setShowWorkLocationModal(false);
            setEditingWorkLocation(null);
            setWorkLocationForm({ name: '', address: '', latitude: '', longitude: '', radius: 'No Restriction', notes: '', parentSiteId: '' });
        } catch (e) {
            console.error(e);
            toast.error('Failed to save work location');
        } finally {
            setIsSavingWorkLocation(false);
        }
    };

    const handleDeleteWorkLocationClick = (id) => {
        setWorkLocationToDelete(id);
        setShowDeleteWorkLocationModal(true);
    };

    const handleConfirmDeleteWorkLocation = async () => {
        if (!workLocationToDelete) return;
        setIsSavingWorkLocation(true);
        try {
            await deleteWorkLocation(workLocationToDelete);
            toast.success('Work location deleted');
        } catch (e) {
            console.error(e);
            toast.error('Failed to delete work location');
        } finally {
            setIsSavingWorkLocation(false);
            setShowDeleteWorkLocationModal(false);
            setWorkLocationToDelete(null);
        }
    };

    const handleUseCurrentWorkLocation = async () => {
        setIsGettingWorkLocation(true);
        try {
            const location = await getUserCurrentLocation();
            setWorkLocationForm({
                ...workLocationForm,
                latitude: location.latitude.toString(),
                longitude: location.longitude.toString()
            });
            toast.success('Location captured successfully!');
        } catch (error) {
            console.error('Error getting current location:', error);
            toast.error(error.message || 'Failed to get your current location. Please enter coordinates manually.');
        } finally {
            setIsGettingWorkLocation(false);
        }
    };

    const handleMapConfirm = (lat, lng) => {
        setWorkLocationForm({
            ...workLocationForm,
            latitude: lat.toString(),
            longitude: lng.toString()
        });
    };

    return (
        <div className="h-screen flex flex-col overflow-hidden bg-bg-primary">
            <Header
                title="Work Locations"
                subtitle="Manage informational work locations (not used for clock-in validation)"
            />

            <div className="flex-1 overflow-y-auto p-4 md:p-3xl scrollbar-custom">
                <div className="max-w-7xl mx-auto">
                    <div className="bg-white rounded-base p-6 shadow-lg">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                            <div>
                                <h2 className="text-2xl font-bold text-text-primary">Work Locations</h2>
                                <p className="text-sm text-text-secondary mt-1">
                                    Manage informational work locations (not used for clock-in validation).
                                </p>
                            </div>
                            <Button
                                variant="outline-primary"
                                icon={Plus}
                                onClick={handleAddWorkLocation}
                            >
                                Add Work Location
                            </Button>
                        </div>

                        <div className="space-y-3">
                            {isLoadingLocations ? (
                                <div className="flex justify-center py-8">
                                    <Loader2 className="h-8 w-8 animate-spin text-accent-purple" />
                                </div>
                            ) : workLocations.length === 0 ? (
                                <div className="text-center py-8 text-text-secondary">
                                    <p>No work locations added.</p>
                                </div>
                            ) : (
                                workLocations.map((location) => (
                                    <div
                                        key={location.id}
                                        className="flex items-center justify-between p-4 border border-border-secondary rounded-lg hover:bg-bg-secondary transition-colors"
                                    >
                                        <div className="flex items-center gap-3 flex-1">
                                            <Building className="h-5 w-5 text-text-secondary flex-shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <p className="font-semibold text-text-primary">{location.name}</p>
                                                {location.address && (
                                                    <p className="text-sm text-text-secondary truncate">{location.address}</p>
                                                )}
                                                {location.parentSiteId && (
                                                    <p className="text-xs text-purple-600 mt-0.5">
                                                        Linked to: {sites.find(s => s.id === location.parentSiteId)?.name || 'Unknown Site'}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <Button
                                                variant="outline-primary"
                                                icon={Edit2}
                                                onClick={() => handleEditWorkLocation(location)}
                                            >
                                                Edit
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                onClick={() => handleDeleteWorkLocationClick(location.id)}
                                                disabled={isSavingWorkLocation}
                                                className="flex items-center gap-2 text-red-600 hover:text-red-700 hover:bg-red-50 border-2 border-red-500 rounded-md p-1"
                                            >
                                                <Trash2 size={16} />
                                                <span>Delete</span>
                                            </Button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Add/Edit Work Location Modal */}
            {showWorkLocationModal && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 overflow-y-auto">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-lg" onClick={() => !isSavingWorkLocation && setShowWorkLocationModal(false)}></div>
                    <div className="relative w-full max-w-md bg-white rounded-2xl shadow-xl z-50 my-8 max-h-[90vh] flex flex-col">
                        <h3 className="text-xl font-bold p-6 pb-4">{editingWorkLocation ? 'Edit Work Location' : 'Add Work Location'}</h3>
                        <div className="space-y-4 px-6 overflow-y-auto flex-1">
                            <div>
                                <label className="block text-sm font-medium text-text-primary mb-1">
                                    Location Name <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
                                    value={workLocationForm.name}
                                    onChange={e => setWorkLocationForm({ ...workLocationForm, name: e.target.value })}
                                    placeholder="e.g. Site A"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-text-primary mb-1">Parent Site (Report Grouping)</label>
                                <select
                                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                                    value={workLocationForm.parentSiteId}
                                    onChange={e => setWorkLocationForm({ ...workLocationForm, parentSiteId: e.target.value })}
                                    aria-label="Select Parent Site"
                                >
                                    <option value="">No Parent Site (General)</option>
                                    {sites.map(site => (
                                        <option key={site.id} value={site.id}>{site.name}</option>
                                    ))}
                                </select>
                                <p className="mt-1 text-xs text-text-secondary">
                                    Assigning a Parent Site ensures activity at this location appears correctly in site-based reports.
                                </p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-text-primary mb-1">Address</label>
                                <textarea
                                    className="w-full p-4 border border-border-secondary rounded-lg text-md text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple resize-none h-24"
                                    value={workLocationForm.address}
                                    onChange={e => setWorkLocationForm({ ...workLocationForm, address: e.target.value })}
                                    placeholder="Full address..."
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-text-primary mb-1">Latitude</label>
                                    <input
                                        type="number"
                                        step="any"
                                        className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
                                        value={workLocationForm.latitude}
                                        onChange={e => setWorkLocationForm({ ...workLocationForm, latitude: e.target.value })}
                                        placeholder="e.g. 40.7128"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-text-primary mb-1">Longitude</label>
                                    <input
                                        type="number"
                                        step="any"
                                        className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
                                        value={workLocationForm.longitude}
                                        onChange={e => setWorkLocationForm({ ...workLocationForm, longitude: e.target.value })}
                                        placeholder="e.g. -74.0060"
                                    />
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={handleUseCurrentWorkLocation}
                                disabled={isGettingWorkLocation}
                                className="w-full h-10 px-4 border-2 border-purple-600 text-purple-600 rounded-lg hover:bg-purple-50 font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {isGettingWorkLocation ? (
                                    <>
                                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-purple-600 border-t-transparent"></div>
                                        <span>Getting Location...</span>
                                    </>
                                ) : (
                                    <>
                                        <MapPin className="h-4 w-4" />
                                        <span>Use Current Location</span>
                                    </>
                                )}
                            </button>

                            <button
                                type="button"
                                onClick={() => setShowMapPicker(true)}
                                className="w-full h-10 px-4 border-2 border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium text-sm transition-colors flex items-center justify-center gap-2"
                            >
                                <MapPin className="h-4 w-4" />
                                <span>Select on Map</span>
                            </button>

                            <div>
                                <label className="block text-sm font-medium text-text-primary mb-1">Radius Restriction</label>
                                <select
                                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                                    value={workLocationForm.radius}
                                    onChange={e => setWorkLocationForm({ ...workLocationForm, radius: e.target.value })}
                                    aria-label="Select Radius Restriction"
                                >
                                    <option value="No Restriction">No Restriction</option>
                                    <option value="50m">50 meters</option>
                                    <option value="100m">100 meters</option>
                                    <option value="200m">200 meters</option>
                                    <option value="500m">500 meters</option>
                                    <option value="1km">1 kilometer</option>
                                </select>
                                <p className="mt-1 text-xs text-text-secondary">
                                    {workLocationForm.radius === 'No Restriction'
                                        ? 'Employees can clock in/out from anywhere'
                                        : 'Employees must be within this radius to clock in/out'}
                                </p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-text-primary mb-1">Notes</label>
                                <textarea
                                    className="w-full p-4 border border-border-secondary rounded-lg text-md text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple resize-none h-20"
                                    value={workLocationForm.notes}
                                    onChange={e => setWorkLocationForm({ ...workLocationForm, notes: e.target.value })}
                                    placeholder="Any additional information..."
                                />
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 p-6 pt-4 border-t border-gray-100">
                            <Button variant="outline-secondary" onClick={() => setShowWorkLocationModal(false)} disabled={isSavingWorkLocation}>Cancel</Button>
                            <Button variant="gradient" onClick={handleSaveWorkLocation} disabled={isSavingWorkLocation}>
                                {isSavingWorkLocation ? 'Saving...' : (editingWorkLocation ? 'Update' : 'Create')}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Work Location Modal */}
            <DeleteConfirmationModal
                isOpen={showDeleteWorkLocationModal}
                onClose={() => {
                    setShowDeleteWorkLocationModal(false);
                    setWorkLocationToDelete(null);
                }}
                onConfirm={handleConfirmDeleteWorkLocation}
                title="Delete Work Location"
                description="Are you sure you want to delete this work location?"
                itemDetails={workLocationToDelete ? {
                    name: workLocations.find(l => l.id === workLocationToDelete)?.name || 'Location',
                    subtitle: workLocations.find(l => l.id === workLocationToDelete)?.address || null
                } : null}
                variant="danger"
            />

            {/* Location Picker Map Modal */}
            <React.Suspense fallback={null}>
                <LocationPickerMap
                    isOpen={showMapPicker}
                    onClose={() => setShowMapPicker(false)}
                    onConfirm={handleMapConfirm}
                    initialLat={workLocationForm.latitude}
                    initialLng={workLocationForm.longitude}
                />
            </React.Suspense>

        </div>
    );
};

export default WorkLocationsPage;
