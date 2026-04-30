import React, { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { getSites, addSite, updateSite, deleteSite } from '../../services/sites';
import { getClients } from '../../services/clients';
import { Loader2, Plus, Pencil, Trash2, MapPin, Building, Users, Briefcase } from 'lucide-react';
import { toast } from 'react-toastify';

const SitesPage = () => {
    const { user } = useAuth();
    const [sites, setSites] = useState([]);
    const [clients, setClients] = useState([]);
    const [allUsers, setAllUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
    const [editingSite, setEditingSite] = useState(null);
    const [selectedSiteForAssign, setSelectedSiteForAssign] = useState(null);
    const [userAssignments, setUserAssignments] = useState({}); // { userId: boolean }
    const [formData, setFormData] = useState({ name: '', address: '', clientId: '' });
    const [error, setError] = useState(null);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [siteToDelete, setSiteToDelete] = useState(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [savingAssignments, setSavingAssignments] = useState(false);

    useEffect(() => {
        if (user.companyId) {
            fetchSites();
            fetchClients();
            fetchUsers();
        }
    }, [user.companyId]);

    const fetchSites = async () => {
        setLoading(true);
        try {
            const data = await getSites(user.companyId);
            setSites(data);
        } catch (err) {
            setError('Failed to load sites');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const fetchClients = async () => {
        try {
            const data = await getClients(user.companyId);
            setClients(data);
        } catch (err) {
            console.error('Failed to load clients:', err);
        }
    };

    const fetchUsers = async () => {
        try {
            const { getUsersByCompany } = await import('../../services/users');
            const users = await getUsersByCompany(user.companyId);
            setAllUsers(users);
        } catch (err) {
            console.error('Failed to load users:', err);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            if (editingSite) {
                await updateSite(editingSite.id, formData);
                toast.success('Site updated successfully');
            } else {
                await addSite(user.companyId, formData);
                toast.success('Site created successfully');
            }
            setIsModalOpen(false);
            setFormData({ name: '', address: '' });
            setEditingSite(null);
            fetchSites();
        } catch (err) {
            console.error('Failed to save site:', err);
            toast.error('Failed to save site');
        }
    };

    const handleDeleteClick = (site) => {
        setSiteToDelete(site);
        setIsDeleteModalOpen(true);
    };

    const confirmDelete = async () => {
        if (!siteToDelete) return;
        setIsDeleting(true);
        try {
            await deleteSite(siteToDelete.id);
            toast.success('Site deleted successfully');
            fetchSites();
            setIsDeleteModalOpen(false);
            setSiteToDelete(null);
        } catch (err) {
            console.error('Failed to delete site:', err);
            toast.error('Failed to delete site');
        } finally {
            setIsDeleting(false);
        }
    };

    const openModal = (site = null) => {
        if (site) {
            setEditingSite(site);
            const safeAddress = typeof site.address === 'object' ? (site.address.formatted || site.address.line1 || '') : (site.address || '');
            setFormData({ name: site.name, address: safeAddress, clientId: site.clientId || '' });
        } else {
            setEditingSite(null);
            setFormData({ name: '', address: '', clientId: '' });
        }
        setIsModalOpen(true);
    };

    const openAssignModal = (site) => {
        setSelectedSiteForAssign(site);
        const initialAssignments = {};
        allUsers.forEach(u => {
            const userSiteId = u.siteId ? (u.siteId.includes('/') ? u.siteId.split('/').pop() : u.siteId) : null;
            initialAssignments[u.id] = userSiteId === site.id;
        });
        setUserAssignments(initialAssignments);
        setIsAssignModalOpen(true);
    };

    const handleAssignmentChange = (userId) => {
        setUserAssignments(prev => ({
            ...prev,
            [userId]: !prev[userId]
        }));
    };

    const saveAssignments = async () => {
        if (!selectedSiteForAssign) return;
        setSavingAssignments(true);
        try {
            const { updateUserSiteAndClient } = await import('../../services/userSiteClientSync');

            // Get site's client for validation
            const siteClientId = selectedSiteForAssign.clientId;
            if (!siteClientId) {
                toast.error('This site has no client assigned. Please assign a client first.');
                setSavingAssignments(false);
                return;
            }

            const promises = [];

            for (const user of allUsers) {
                const wasAssigned = user.siteId && (user.siteId.includes(selectedSiteForAssign.id));
                const isAssignedNow = userAssignments[user.id];

                if (wasAssigned !== isAssignedNow) {
                    if (isAssignedNow) {
                        // User is being assigned to this site
                        // Use centralized sync function - handles everything!
                        promises.push(
                            updateUserSiteAndClient(user.id, selectedSiteForAssign.id).catch(err => {
                                console.error(`Failed to assign user ${user.id}:`, err);
                            })
                        );
                    } else {
                        // User is being removed from this site
                        // Use centralized sync function with null
                        promises.push(
                            updateUserSiteAndClient(user.id, null).catch(err => {
                                console.error(`Failed to remove user ${user.id}:`, err);
                            })
                        );
                    }
                } else if (isAssignedNow && user.siteId !== `sites/${selectedSiteForAssign.id}`) {
                    // User is already assigned but siteId format needs update
                    promises.push(
                        updateUserSiteAndClient(user.id, selectedSiteForAssign.id).catch(err => {
                            console.error(`Failed to update user ${user.id}:`, err);
                        })
                    );
                }
            }

            await Promise.all(promises);
            await fetchUsers(); // Refresh users to get latest siteIds
            setIsAssignModalOpen(false);
            setSelectedSiteForAssign(null);
            toast.success('User assignments and client linkage saved successfully!');
        } catch (err) {
            console.error('Failed to save assignments:', err);
            toast.error('Failed to save user assignments. Please try again.');
        } finally {
            setSavingAssignments(false);
        }
    };

    if (loading) return <div className="flex justify-center p-8"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>;

    return (
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Sites</h1>
                    <p className="text-gray-500">Manage your company's job sites.</p>
                </div>
                <button
                    onClick={() => openModal()}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
                >
                    <Plus className="w-4 h-4" />
                    Add Site
                </button>
            </div>

            {error && <div className="bg-red-50 text-red-600 p-4 rounded-lg mb-6">{error}</div>}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {sites.map(site => {
                    const assignedCount = allUsers.filter(u => {
                        const sid = u.siteId ? (u.siteId.includes('/') ? u.siteId.split('/').pop() : u.siteId) : null;
                        return sid === site.id;
                    }).length;

                    return (
                        <div key={site.id} className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm hover:shadow-md transition">
                            <div className="flex justify-between items-start mb-4">
                                <div className="p-2 bg-blue-50 rounded-lg">
                                    <Building className="w-6 h-6 text-blue-600" />
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => openAssignModal(site)}
                                        className="p-1 text-gray-400 hover:text-green-600 transition"
                                        title="Manage Users"
                                    >
                                        <Users className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => openModal(site)}
                                        className="p-1 text-gray-400 hover:text-blue-600 transition"
                                        title="Edit Site"
                                    >
                                        <Pencil className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => handleDeleteClick(site)}
                                        className="p-1 text-gray-400 hover:text-red-600 transition"
                                        title="Delete Site"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">{site.name}</h3>
                            <div className="flex items-start gap-2 text-gray-500 text-sm mb-3">
                                <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" />
                                <p>{(() => {
                                    if (!site.address) return 'No address provided';
                                    if (typeof site.address === 'string') return site.address;
                                    if (typeof site.address === 'object') {
                                        return site.address.formatted || site.address.line1 || site.address.raw || 'Invalid Address (Object)';
                                    }
                                    return 'Invalid Address Format';
                                })()}</p>
                            </div>
                            <div className="border-t border-gray-100 pt-3">
                                <div className="flex items-center justify-between text-sm text-gray-500">
                                    <span>Assigned Employees</span>
                                    <span className="bg-gray-100 text-gray-700 py-0.5 px-2 rounded-full text-xs font-medium">
                                        {assignedCount}
                                    </span>
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>

            {sites.length === 0 && (
                <div className="text-center py-12 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                    <Building className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900">No sites found</h3>
                    <p className="text-gray-500 mb-4">Get started by adding your first job site.</p>
                    <button
                        onClick={() => openModal()}
                        className="text-blue-600 font-medium hover:text-blue-700"
                    >
                        Add New Site
                    </button>
                </div>
            )}

            {/* Edit/Create Site Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-lg w-full max-w-md p-6">
                        <h2 className="text-xl font-bold mb-4">{editingSite ? 'Edit Site' : 'Add New Site'}</h2>
                        <form onSubmit={handleSubmit}>
                            <div className="mb-4">
                                <label className=" block text-sm font-medium text-gray-700 mb-1">Site Name</label>
                                <input
                                    type="text"
                                    required
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="e.g. London HQ"
                                />
                            </div>
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Client <span className="text-red-500">*</span>
                                </label>
                                <select
                                    required
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                                    value={formData.clientId}
                                    onChange={e => setFormData({ ...formData, clientId: e.target.value })}
                                >
                                    <option value="">Select a client...</option>
                                    {clients.map(client => (
                                        <option key={client.id} value={client.id}>{client.name}</option>
                                    ))}
                                </select>
                                {clients.length === 0 && (
                                    <p className="text-sm text-amber-600 mt-1">
                                        No clients found. Create a client first.
                                    </p>
                                )}
                            </div>
                            <div className="mb-6">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                                <textarea
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                                    rows="3"
                                    value={formData.address}
                                    onChange={e => setFormData({ ...formData, address: e.target.value })}
                                    placeholder="Full address..."
                                />
                            </div>
                            <div className="flex justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setIsModalOpen(false)}
                                    className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                                >
                                    {editingSite ? 'Save Changes' : 'Create Site'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Assign Users Modal */}
            {isAssignModalOpen && selectedSiteForAssign && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-lg w-full max-w-lg p-6 max-h-[80vh] flex flex-col">
                        <h2 className="text-xl font-bold mb-1">Manage Users</h2>
                        <p className="text-sm text-gray-500 mb-4">Assign employees to {selectedSiteForAssign.name}</p>

                        <div className="flex-1 overflow-y-auto border rounded-lg p-2 mb-4">
                            {allUsers.length === 0 ? (
                                <p className="text-center text-gray-500 py-4">No users found.</p>
                            ) : (
                                <div className="space-y-1">
                                    {allUsers.map(u => {
                                        const isChecked = userAssignments[u.id];
                                        const userCurrentSiteId = u.siteId ? (u.siteId.includes('/') ? u.siteId.split('/').pop() : u.siteId) : null;
                                        const assignedToOther = userCurrentSiteId && userCurrentSiteId !== selectedSiteForAssign.id && !isChecked;

                                        return (
                                            <div key={u.id} className={`flex items-center justify-between p-2 rounded hover:bg-gray-50 ${isChecked ? 'bg-blue-50' : ''}`}>
                                                <div className="flex items-center gap-3">
                                                    <input
                                                        type="checkbox"
                                                        checked={!!isChecked}
                                                        onChange={() => handleAssignmentChange(u.id)}
                                                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                                                    />
                                                    <div>
                                                        <p className="font-medium text-sm text-gray-900">{u.displayName || u.email}</p>
                                                        <p className="text-xs text-gray-500">{u.primaryRole}</p>
                                                    </div>
                                                </div>
                                                {assignedToOther && (
                                                    <span className="text-xs text-amber-600 font-medium px-2 py-0.5 bg-amber-50 rounded">
                                                        Changes Site
                                                    </span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="flex justify-end gap-3 pt-2 border-t">
                            <button
                                type="button"
                                onClick={() => setIsAssignModalOpen(false)}
                                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
                                disabled={savingAssignments}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={saveAssignments}
                                disabled={savingAssignments}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                            >
                                {savingAssignments && <Loader2 className="w-4 h-4 animate-spin" />}
                                Save Assignments
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {isDeleteModalOpen && siteToDelete && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-lg w-full max-w-sm p-6">
                        <div className="flex flex-col items-center text-center">
                            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4">
                                <Trash2 className="w-6 h-6 text-red-600" />
                            </div>
                            <h3 className="text-lg font-bold text-gray-900 mb-2">Delete Site?</h3>
                            <p className="text-gray-500 mb-6">
                                Are you sure you want to delete <strong>{siteToDelete.name}</strong>? This action cannot be undone.
                            </p>
                            <div className="flex gap-3 w-full">
                                <button
                                    onClick={() => setIsDeleteModalOpen(false)}
                                    className="flex-1 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition"
                                    disabled={isDeleting}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={confirmDelete}
                                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition flex items-center justify-center gap-2"
                                    disabled={isDeleting}
                                >
                                    {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SitesPage;
