import React, { useState, useEffect } from 'react';
import Header from '../../components/layout/Header';
import Button from '../../components/ui/Button';
import ClientModal from './components/ClientModal';
import DeleteConfirmationModal from '../../components/modals/DeleteConfirmationModal';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { getClients, addClient, updateClient, deleteClient } from '../../services/clients';
import { toast } from 'react-toastify';
import { usePerformanceMonitor } from '../../hooks/usePerformanceMonitor';

const ClientsPage = (props) => {
    const { user } = useAuth();
    const [clients, setClients] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Modal states
    const [showModal, setShowModal] = useState(false);
    const [editingClient, setEditingClient] = useState(null);
    const [deleteId, setDeleteId] = useState(null);

    const companyPath = user?.companyId || '';
    // companyId is needed for adding new clients
    // companyPath usually comes as "companies/ID"
    const companyId = companyPath.split('/')[1] || companyPath;

    usePerformanceMonitor('ClientsPage');

    const loadClients = async () => {
        if (!companyId) return;
        try {
            setIsLoading(true);
            const data = await getClients(companyId);
            setClients(data);
        } catch (error) {
            console.error('Failed to load clients:', error);
            toast.error('Failed to load clients');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadClients();
    }, [companyId]);

    const handleAdd = () => {
        setEditingClient(null);
        setShowModal(true);
    };

    const handleEdit = (client) => {
        setEditingClient(client);
        setShowModal(true);
    };

    const handleDeleteClick = (client) => {
        setDeleteId(client.id);
    };

    const handleModalSubmit = async (formData) => {
        try {
            setIsSubmitting(true);
            if (editingClient) {
                await updateClient(editingClient.id, formData);
                toast.success('Client updated successfully');
            } else {
                await addClient(companyId, formData);
                toast.success('Client added successfully');
            }
            setShowModal(false);
            loadClients();
        } catch (error) {
            console.error('Error saving client:', error);
            toast.error('Failed to save client');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleConfirmDelete = async () => {
        if (!deleteId) return;
        try {
            await deleteClient(deleteId);
            toast.success('Client deleted successfully');
            setDeleteId(null);
            loadClients();
        } catch (error) {
            console.error('Error deleting client:', error);
            toast.error('Failed to delete client');
        }
    };

    const { isEmbedded } = props;

    return (
        <div className="flex flex-col h-full bg-gray-50">
            {!isEmbedded && (
                <Header
                    user={user}
                    title="Clients"
                    subtitle="Manage your client list for allocation and reporting"
                />
            )}

            <div className="flex-1 overflow-auto p-6">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-semibold text-gray-800">
                        All Clients
                    </h2>
                    <Button onClick={handleAdd} icon={Plus}>
                        Add Client
                    </Button>
                </div>

                <div className="bg-white rounded-lg shadowoverflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Name
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Contact Person
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Email
                                </th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {isLoading ? (
                                <tr>
                                    <td colSpan="4" className="px-6 py-4 text-center text-gray-500">
                                        Loading clients...
                                    </td>
                                </tr>
                            ) : clients.length === 0 ? (
                                <tr>
                                    <td colSpan="4" className="px-6 py-12 text-center text-gray-500">
                                        No clients found. Add one to get started.
                                    </td>
                                </tr>
                            ) : (
                                clients.map((client) => (
                                    <tr key={client.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm font-medium text-gray-900">{client.name}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-500">{client.contactPerson || '-'}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm text-gray-500">{client.email || '-'}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <button
                                                onClick={() => handleEdit(client)}
                                                className="text-blue-600 hover:text-blue-900 mr-4"
                                            >
                                                <Edit2 size={18} />
                                            </button>
                                            <button
                                                onClick={() => handleDeleteClick(client)}
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

            <ClientModal
                isOpen={showModal}
                onClose={() => setShowModal(false)}
                onSubmit={handleModalSubmit}
                client={editingClient}
                isSubmitting={isSubmitting}
            />

            <DeleteConfirmationModal
                isOpen={!!deleteId}
                onClose={() => setDeleteId(null)}
                onConfirm={handleConfirmDelete}
                title="Delete Client"
                message="Are you sure you want to delete this client? This action cannot be undone."
            />
        </div>
    );
};

export default ClientsPage;
