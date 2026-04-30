import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, UserPlus, Info } from 'lucide-react';

const UserAssignmentRow = ({ user, clients, sitesByClient, onAssign }) => {
    const [selectedClientId, setSelectedClientId] = useState('');
    const [selectedSiteId, setSelectedSiteId] = useState('');
    const [assigning, setAssigning] = useState(false);

    const handleClientChange = (e) => {
        setSelectedClientId(e.target.value);
        setSelectedSiteId(''); // Reset site when client changes
    };

    const handleAssign = async () => {
        if (!selectedClientId) return;

        setAssigning(true);
        try {
            // Pass siteId as null if not selected (valid for client-only assignment)
            await onAssign(user.id, selectedClientId, selectedSiteId || null);
            // Reset state not needed as user will disappear from list
        } catch (error) {
            console.error('Failed to assign:', error);
            setAssigning(false);
        }
    };

    // Get sites for selected client
    const clientSites = selectedClientId ? (sitesByClient[selectedClientId] || []) : [];

    return (
        <tr className="border-b border-gray-100 hover:bg-gray-50/80 transition-colors last:border-0 group">
            <td className="px-6 py-4 whitespace-nowrap">
                <div className="text-sm font-medium text-gray-900">{user.name || user.email || 'Unknown'}</div>
                <div className="text-xs text-gray-500">{user.email}</div>
            </td>
            <td className="px-6 py-4 whitespace-nowrap">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                    {(user.totalHours || 0).toFixed(2)}h
                </span>
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {user.weekLabel || '-'}
            </td>
            <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex items-center gap-3">
                    {/* Client Select */}
                    <div className="relative">
                        <select
                            value={selectedClientId}
                            onChange={handleClientChange}
                            className="block w-40 rounded-md border-gray-300 py-1.5 pl-3 pr-8 text-xs focus:border-amber-500 focus:outline-none focus:ring-amber-500 sm:text-xs shadow-sm cursor-pointer"
                            disabled={assigning}
                        >
                            <option value="">Select Client...</option>
                            {clients.map(client => (
                                <option key={client.id} value={client.id}>
                                    {client.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Site Select */}
                    <div className="relative">
                        <select
                            value={selectedSiteId}
                            onChange={(e) => setSelectedSiteId(e.target.value)}
                            className="block w-40 rounded-md border-gray-300 py-1.5 pl-3 pr-8 text-xs focus:border-amber-500 focus:outline-none focus:ring-amber-500 sm:text-xs shadow-sm disabled:bg-gray-50 disabled:text-gray-400 cursor-pointer"
                            disabled={!selectedClientId || assigning}
                        >
                            <option value="">No Site (Client Only)</option>
                            {clientSites.map(site => (
                                <option key={site.id} value={site.id}>
                                    {site.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <button
                        onClick={handleAssign}
                        disabled={assigning || !selectedClientId}
                        className={`inline-flex items-center justify-center p-1.5 rounded-md shadow-sm transition-all duration-200 
                            ${selectedClientId
                                ? 'bg-amber-600 text-white hover:bg-amber-700 hover:shadow active:scale-95'
                                : 'bg-gray-100 text-gray-300 cursor-not-allowed'
                            }`}
                        title="Assign User"
                    >
                        {assigning ? (
                            <div className="w-4 h-4 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />
                        ) : (
                            <UserPlus className="w-4 h-4" />
                        )}
                    </button>
                </div>
            </td>
        </tr>
    );
};

/**
 * Panel showing users with timesheet hours but no site/client assignment
 * Allows quick assignment directly from the Invoice Generator page
 */
const UnassignedUsersPanel = ({
    unassignedUsers = [],
    sites = [],
    clients = [],
    onAssign,
    loading = false
}) => {
    const [isExpanded, setIsExpanded] = useState(true);

    if (unassignedUsers.length === 0 && !loading) {
        return null;
    }

    // Group sites by client for better UX
    const sitesByClient = sites.reduce((acc, site) => {
        const clientId = site.clientId || 'unassigned';
        if (!acc[clientId]) {
            acc[clientId] = [];
        }
        acc[clientId].push(site);
        return acc;
    }, {});

    return (
        <div className="bg-white border border-gray-200 border-l-4 border-l-amber-500 rounded-lg shadow-sm mb-8 overflow-hidden">
            {/* Header */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between p-4 bg-amber-50/50 hover:bg-amber-50 transition-colors"
            >
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-amber-100 rounded-full">
                        <AlertTriangle className="w-5 h-5 text-amber-600" />
                    </div>
                    <div className="text-left">
                        <h3 className="font-semibold text-gray-900 text-base">
                            Unassigned Hours ({unassignedUsers.length})
                        </h3>
                        <p className="text-xs text-amber-700 hidden sm:block">
                            Action required: Assign clients to include these hours in invoices
                        </p>
                    </div>
                </div>
                {isExpanded ? (
                    <ChevronUp className="w-5 h-5 text-gray-400" />
                ) : (
                    <ChevronDown className="w-5 h-5 text-gray-400" />
                )}
            </button>

            {/* Content */}
            {isExpanded && (
                <div className="p-0">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-8 text-gray-500 gap-2">
                            <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                            <span className="text-sm">Finding unassigned hours...</span>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50/50 border-y border-gray-100">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Employee</th>
                                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Hours</th>
                                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Week</th>
                                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-[400px]">Assignment Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 bg-white">
                                    {unassignedUsers.map((user) => (
                                        <UserAssignmentRow
                                            key={user.id}
                                            user={user}
                                            clients={clients}
                                            sitesByClient={sitesByClient}
                                            onAssign={onAssign}
                                        />
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <div className="bg-gray-50 px-6 py-3 border-t border-gray-100">
                        <p className="text-xs text-gray-500 flex items-center gap-1">
                            <Info className="w-3 h-3" />
                            Use "No Site" to assign strictly to a Client profile.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default UnassignedUsersPanel;
