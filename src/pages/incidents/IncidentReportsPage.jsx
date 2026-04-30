import React, { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { addIncidentReport, getIncidentReports } from '../../services/incidentService';
import Header from '../../components/layout/Header';
import Button from '../../components/ui/Button';
import { AlertTriangle, Plus, Calendar, MapPin, User, Camera, X } from 'lucide-react';
import { toast } from 'react-toastify';
import { format } from 'date-fns';

const IncidentReportsPage = () => {
    const { user } = useAuth();
    const [reports, setReports] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    // Form State
    const [formData, setFormData] = useState({
        player: '',
        incidentDate: format(new Date(), 'yyyy-MM-ddTHH:mm'),
        location: '',
        description: ''
    });
    const [photos, setPhotos] = useState([]);

    // Only re-run when companyId actually changes (not every user object re-render)
    useEffect(() => {
        if (user?.companyId) loadReports();
    }, [user?.companyId]);

    const loadReports = async (forceRefresh = false) => {
        if (!user?.companyId) return;
        setLoading(true);
        try {
            const data = await getIncidentReports(user.companyId, user.role, user.id || user.uid, { forceRefresh });
            setReports(data);
        } catch (error) {
            console.error(error);
            toast.error('Failed to load reports');
        } finally {
            setLoading(false);
        }
    };

    const handleRefresh = async () => {
        setRefreshing(true);
        try {
            await loadReports(true);
            toast.success('Reports refreshed');
        } catch (error) {
            toast.error('Failed to refresh reports');
        } finally {
            setRefreshing(false);
        }
    };

    const handleFileChange = (e) => {
        if (e.target.files) {
            setPhotos(prev => [...prev, ...Array.from(e.target.files)]);
        }
    };

    const removePhoto = (index) => {
        setPhotos(prev => prev.filter((_, i) => i !== index));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.player || !formData.description) {
            toast.warning('Please fill in required fields');
            return;
        }

        setSubmitting(true);
        try {
            await addIncidentReport(user.companyId, user.id || user.uid, formData, photos, user.role);
            toast.success('Incident report submitted');
            setIsModalOpen(false);
            setFormData({
                player: '',
                incidentDate: format(new Date(), 'yyyy-MM-ddTHH:mm'),
                location: '',
                description: ''
            });
            setPhotos([]);
            loadReports();
        } catch (error) {
            console.error(error);
            toast.error('Failed to submit report');
        } finally {
            setSubmitting(false);
        }
    };

    // Skeleton loader that mirrors the real card layout for a polished loading experience
    const SkeletonCard = () => (
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm animate-pulse">
            <div className="flex justify-between items-start mb-4">
                <div className="space-y-2 flex-1 mr-4">
                    <div className="h-5 bg-gray-200 rounded w-1/3" />
                    <div className="h-3 bg-gray-100 rounded w-1/4" />
                </div>
                <div className="space-y-1 text-right shrink-0">
                    <div className="h-3 bg-gray-200 rounded w-20 ml-auto" />
                    <div className="h-3 bg-gray-100 rounded w-14 ml-auto" />
                </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div className="h-4 bg-gray-100 rounded w-3/4" />
                <div className="h-4 bg-gray-100 rounded w-2/3" />
            </div>
            <div className="bg-gray-50 rounded-lg p-4 space-y-2 border border-gray-100">
                <div className="h-3 bg-gray-200 rounded w-full" />
                <div className="h-3 bg-gray-200 rounded w-5/6" />
                <div className="h-3 bg-gray-200 rounded w-4/6" />
            </div>
        </div>
    );

    return (
        <div className="h-screen flex flex-col overflow-hidden bg-gray-50">
            <Header
                title="Incident Reports"
                subtitle="Track and manage player injury and incident reports."
            />

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 scrollbar-custom">
                <div className="max-w-5xl mx-auto space-y-6">

                    <div className="flex justify-between items-center">
                        <h2 className="text-lg font-semibold text-gray-800">Recent Reports</h2>
                        <Button onClick={() => setIsModalOpen(true)} icon={Plus}>
                            Submit New Report
                        </Button>
                    </div>

                    {loading ? (
                        <div className="grid gap-4">
                            <SkeletonCard />
                            <SkeletonCard />
                            <SkeletonCard />
                        </div>
                    ) : (
                        <div className="grid gap-4">
                            {reports.length === 0 ? (
                                <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
                                    <AlertTriangle className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                                    <p className="text-gray-500">No incident reports found.</p>
                                </div>
                            ) : (
                                reports.map(report => (
                                    <div key={report.id} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-all">
                                        <div className="flex justify-between items-start mb-4">
                                            <div>
                                                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                                                    {report.player}
                                                    <span className="text-xs font-normal text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                                                        Incident
                                                    </span>
                                                </h3>
                                                <p className="text-sm text-gray-500">Reported by {report.submitterName}</p>
                                            </div>
                                            <div className="text-right text-sm text-gray-500">
                                                <div>{format(report.createdAt?.toDate ? report.createdAt.toDate() : new Date(), 'MMM d, yyyy')}</div>
                                                <div className="text-xs">Submitted</div>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 text-sm text-gray-700">
                                            <div className="flex items-center gap-2">
                                                <Calendar className="h-4 w-4 text-purple-500" />
                                                <span className="font-medium">Date:</span>
                                                {format(new Date(report.incidentDate), 'PPpp')}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <MapPin className="h-4 w-4 text-purple-500" />
                                                <span className="font-medium">Location:</span>
                                                {report.location || 'N/A'}
                                            </div>
                                        </div>

                                        <div className="bg-gray-50 p-4 rounded-lg mb-4 text-sm text-gray-800 whitespace-pre-line border border-gray-100">
                                            {report.description}
                                        </div>

                                        {/* Photos Grid */}
                                        {report.photos && report.photos.length > 0 && (
                                            <div className="flex gap-2 overflow-x-auto pb-2">
                                                {report.photos.map((photo, idx) => (
                                                    <a key={idx} href={photo.url} target="_blank" rel="noopener noreferrer" className="block flex-shrink-0">
                                                        <img src={photo.url} alt="Evidence" className="h-20 w-20 object-cover rounded-lg border border-gray-200 hover:opacity-80 transition-opacity" />
                                                    </a>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm transition-all duration-300">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh] overflow-hidden transform scale-100 transition-all">
                        {/* Header */}
                        <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 shrink-0">
                            <div>
                                <h2 className="font-bold text-gray-900 text-xl">New Incident Report</h2>
                                <p className="text-sm text-gray-500 mt-0.5">Please provide details of the incident.</p>
                            </div>
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-400 hover:text-gray-600"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden flex-1 min-h-0">
                            <div className="p-6 space-y-5 overflow-y-auto flex-1 scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-transparent">
                                {/* Person Involved */}
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">Person Involved</label>
                                    <div className="relative group">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                            <User className="h-5 w-5 text-gray-400 group-focus-within:text-purple-500 transition-colors" />
                                        </div>
                                        <input
                                            type="text"
                                            className="block w-full pl-10 pr-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 focus:bg-white transition-all duration-200"
                                            placeholder="Name of player or staff member..."
                                            value={formData.player}
                                            onChange={e => setFormData({ ...formData, player: e.target.value })}
                                            required
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-5">
                                    {/* Date */}
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-2">Date & Time</label>
                                        <input
                                            type="datetime-local"
                                            className="block w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 focus:bg-white transition-all duration-200"
                                            value={formData.incidentDate}
                                            onChange={e => setFormData({ ...formData, incidentDate: e.target.value })}
                                            required
                                        />
                                    </div>
                                    {/* Location */}
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 mb-2">Location</label>
                                        <div className="relative group">
                                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                                <MapPin className="h-5 w-5 text-gray-400 group-focus-within:text-purple-500 transition-colors" />
                                            </div>
                                            <input
                                                type="text"
                                                className="block w-full pl-10 pr-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 focus:bg-white transition-all duration-200"
                                                placeholder="e.g. Training Ground"
                                                value={formData.location}
                                                onChange={e => setFormData({ ...formData, location: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Description */}
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">Description</label>
                                    <textarea
                                        rows="4"
                                        className="block w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 focus:bg-white transition-all duration-200 resize-none"
                                        placeholder="Describe the incident in detail..."
                                        value={formData.description}
                                        onChange={e => setFormData({ ...formData, description: e.target.value })}
                                        required
                                    />
                                </div>

                                {/* Photo Upload */}
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 mb-2">Evidence / Photos</label>
                                    <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-dashed border-gray-300 rounded-xl hover:border-purple-400 hover:bg-purple-50/30 transition-all duration-200 group cursor-pointer relative">
                                        <input
                                            type="file"
                                            multiple
                                            accept="image/*"
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                            onChange={handleFileChange}
                                        />
                                        <div className="space-y-2 text-center">
                                            <div className="mx-auto h-12 w-12 text-gray-300 group-hover:text-purple-500 transition-colors bg-gray-50 group-hover:bg-white rounded-full flex items-center justify-center">
                                                <Camera className="h-6 w-6" />
                                            </div>
                                            <div className="text-sm text-gray-600">
                                                <span className="font-medium text-purple-600 group-hover:text-purple-700">Click to upload</span>
                                                <span className="text-gray-500"> or drag and drop</span>
                                            </div>
                                            <p className="text-xs text-gray-400 group-hover:text-gray-500">
                                                {photos.length > 0
                                                    ? <span className="text-green-600 font-semibold">{photos.length} files selected</span>
                                                    : 'PNG, JPG up to 10MB'}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Preview Grid */}
                                    {photos.length > 0 && (
                                        <div className="grid grid-cols-4 gap-3 mt-3">
                                            {photos.map((photo, index) => (
                                                <div key={index} className="relative group rounded-lg overflow-hidden border border-gray-200 aspect-square">
                                                    <img
                                                        src={URL.createObjectURL(photo)}
                                                        alt="preview"
                                                        className="w-full h-full object-cover"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => removePhoto(index)}
                                                        className="absolute top-1 right-1 bg-black/50 hover:bg-red-500 text-white p-1 rounded-full transition-colors backdrop-blur-sm"
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Footer */}
                            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex gap-3 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-gray-700 hover:bg-gray-50 hover:text-gray-900 font-medium transition-all"
                                >
                                    Cancel
                                </button>
                                <Button type="submit" isLoading={submitting} cn="flex-1 rounded-xl py-2.5 shadow-lg shadow-purple-200">
                                    Submit Report
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default IncidentReportsPage;
