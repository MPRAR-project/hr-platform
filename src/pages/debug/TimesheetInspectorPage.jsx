import React, { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { fetchWeeklySummaries } from '../../services/timesheets';
import { toast } from 'react-toastify';

const TimesheetInspectorPage = () => {
    const { user } = useAuth();
    const [timesheets, setTimesheets] = useState([]);
    const [loading, setLoading] = useState(false);

    const fetchAllTimesheets = async () => {
        if (!user) return;
        setLoading(true);
        try {
            const data = await fetchWeeklySummaries(user.id || user.uid, 50);
            
            // Client side sort by weekStart desc
            data.sort((a, b) => (b.weekStart || '').localeCompare(a.weekStart || ''));

            setTimesheets(data);
        } catch (error) {
            console.error("Failed to fetch", error);
            toast.error("Error: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAllTimesheets();
    }, [user?.id, user?.uid]);

    return (
        <div className="p-8 max-w-6xl mx-auto">
            <h1 className="text-2xl font-bold mb-6">Timesheet Inspector (REST API)</h1>
            <p className="mb-4 text-gray-600">
                Viewing raw timesheet data for user: <strong>{user?.id || user?.uid}</strong>
            </p>
            <button onClick={fetchAllTimesheets} className="bg-blue-600 text-white px-4 py-2 rounded mb-6">
                Refresh Data
            </button>

            {loading ? <div>Loading...</div> : (
                <div className="overflow-x-auto">
                    <table className="min-w-full bg-white border border-gray-300">
                        <thead className="bg-gray-100">
                            <tr>
                                <th className="p-3 border">Timesheet ID</th>
                                <th className="p-3 border">UserId</th>
                                <th className="p-3 border">CompanyId</th>
                                <th className="p-3 border">Week Start Date</th>
                                <th className="p-3 border">Status</th>
                                <th className="p-3 border">Total Hours</th>
                                <th className="p-3 border">Entries Count</th>
                                <th className="p-3 border">Created At</th>
                            </tr>
                        </thead>
                        <tbody>
                            {timesheets.map(ts => (
                                <tr key={ts.id} className="hover:bg-gray-50">
                                    <td className="p-3 border font-mono text-xs">{ts.id}</td>
                                    <td className="p-3 border text-xs">{ts.userId}</td>
                                    <td className="p-3 border text-xs">{ts.companyId}</td>
                                    <td className="p-3 border font-bold text-blue-600">{ts.weekStart || ts.period}</td>
                                    <td className="p-3 border text-sm capitalize">{ts.status}</td>
                                    <td className="p-3 border text-center">{ts.totalHours || 0}</td>
                                    <td className="p-3 border text-center">{ts.entries?.length || 0}</td>
                                    <td className="p-3 border text-xs">
                                        {ts.createdAt ? new Date(ts.createdAt).toLocaleString() : 'N/A'}
                                    </td>
                                </tr>
                            ))}
                            {timesheets.length === 0 && (
                                <tr>
                                    <td colSpan="8" className="p-8 text-center text-gray-500">
                                        No timesheets found in PostgreSQL for this user.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default TimesheetInspectorPage;
