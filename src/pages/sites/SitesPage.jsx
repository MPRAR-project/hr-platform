import React, { useState, useEffect } from 'react';
import Header from '../../components/layout/Header';
import Button from '../../components/ui/Button';
import SiteModal from './components/SiteModal';
import DeleteConfirmationModal from '../../components/modals/DeleteConfirmationModal';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { getSites, addSite, updateSite, deleteSite } from '../../services/sites';
import { toast } from 'react-toastify';
import { usePerformanceMonitor } from '../../hooks/usePerformanceMonitor';

const SitesPage = () => {
    const { user } = useAuth();
    const [sites, setSites] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Modal states
    const [showModal, setShowModal] = useState(false);
    const [editingSite, setEditingSite] = useState(null);
    const [deleteId, setDeleteId] = useState(null);

    const companyPath = user?.companyId || '';
    const companyId = companyPath.split('/')[1] || companyPath;

    usePerformanceMonitor('SitesPage');

    const loadSites = async () => {
        if (!companyId) return;
        try {
            setIsLoading(true);
            const data = await getSites(companyId);
            setSites(data);
        } catch (error) {
            console.error('Failed to load sites:', error);
            toast.error('Failed to load sites');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadSites();
    }, [companyId]);

    const handleAdd = () => {
        setEditingSite(null);
        setShowModal(true);
    };

    const handleEdit = (site) => {
        setEditingSite(site);
        setShowModal(true);
    };

    const handleDeleteClick = (site) => {
        setDeleteId(site.id);
    };

    const handleModalSubmit = async (formData) => {
        try {
            setIsSubmitting(true);
            if (editingSite) {
                await updateSite(editingSite.id, formData);
                toast.success('Site updated successfully');
            } else {
                await addSite(companyId, formData);
                toast.success('Site added successfully');
            }
            setShowModal(false);
            loadSites();
        } catch (error) {
            console.error('Error saving site:', error);
            toast.error('Failed to save site');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleConfirmDelete = async () => {
        if (!deleteId) return;
        try {
            await deleteSite(deleteId);
            toast.success('Site deleted successfully');
            setDeleteId(null);
            loadSites();
        } catch (error) {
            console.error('Error deleting site:', error);
            toast.error('Failed to delete site');
        }
    };

    return (
        <div className="flex flex-col h-full bg-gray-50">
            <Header
                user={user}
                title="Sites"
                subtitle="Manage your company sites and branches"
            />

            <div className="flex-1 overflow-auto p-6">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-semibold text-gray-800">
                        All Sites
                    </h2>
                    <Button onClick={handleAdd} icon={Plus}>
                        Add Site
                    </Button>
                </div>

                <div className="bg-white rounded-lg shadow overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Name
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Address
                                </th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {isLoading ? (
                                <tr>
                                    <td colSpan="3" className="px-6 py-4 text-center text-gray-500">
                                        Loading sites...
                                    </td>
                                </tr>
                            ) : sites.length === 0 ? (
                                <tr>
                                    <td colSpan="3" className="px-6 py-12 text-center text-gray-500">
                                        No sites found. Add one to get started.
                                    </td>
                                </tr>
                            ) : (
                                sites.map((site) => (
                                    <tr key={site.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm font-medium text-gray-900">{site.name}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-500">{site.address || '-'}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <button
                                                onClick={() => handleEdit(site)}
                                                className="text-blue-600 hover:text-blue-900 mr-4"
                                            >
                                                <Edit2 size={18} />
                                            </button>
                                            <button
                                                onClick={() => handleDeleteClick(site)}
                                                className="text-red-600 hover:text-red-900"
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <SiteModal
                isOpen={showModal}
                onClose={() => setShowModal(false)}
                onSubmit={handleModalSubmit}
                site={editingSite}
                isSubmitting={isSubmitting}
            />

            <DeleteConfirmationModal
                isOpen={!!deleteId}
                onClose={() => setDeleteId(null)}
                onConfirm={handleConfirmDelete}
                title="Delete Site"
                message="Are you sure you want to delete this site? Users assigned to this site may lose access."
            />
        </div>
    );
};

export default SitesPage;
