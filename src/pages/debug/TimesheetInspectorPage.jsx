import React, { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { db } from '../../firebase/client';

const TimesheetInspectorPage = () => {
    const { user } = useAuth();
    const [timesheets, setTimesheets] = useState([]);
    const [loading, setLoading] = useState(false);

    const fetchAllTimesheets = async () => {
        if (!user) return;
        setLoading(true);
        try {
            // Fetch ALL timesheets for this user, ordered by date desc
            const q = query(
                collection(db, 'timesheets'),
                where('userId', '==', user.uid),
                // orderBy('weekStartDate', 'desc'), // Index might be missing, remove if it fails
                limit(20)
            );

            const snap = await getDocs(q);
            const data = snap.docs.map(d => ({
                _docId: d.id,
                ...d.data()
            }));

            // Client side sort if index missing
            data.sort((a, b) => (b.weekStartDate || '').localeCompare(a.weekStartDate || ''));

            setTimesheets(data);
        } catch (error) {
            console.error("Failed to fetch", error);
            alert("Error: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAllTimesheets();
    }, [user]);

    return (
        <div className="p-8 max-w-6xl mx-auto">
            <h1 className="text-2xl font-bold mb-6">Timesheet Inspector (Debug)</h1>
            <p className="mb-4 text-gray-600">
                Viewing raw timesheet data for user: <strong>{user?.uid}</strong>
            </p>
            <button onClick={fetchAllTimesheets} className="bg-blue-600 text-white px-4 py-2 rounded mb-6">
                Refresh Data
            </button>

            {loading ? <div>Loading...</div> : (
                <div className="overflow-x-auto">
                    <table className="min-w-full bg-white border border-gray-300">
                        <thead className="bg-gray-100">
                            <tr>
                                <th className="p-3 border">Document ID (Firestore Key)</th>
                                <th className="p-3 border">UserId</th>
                                <th className="p-3 border">CompanyId</th>
                                <th className="p-3 border">Week Start Date (The Key Field)</th>
                                <th className="p-3 border">Period</th>
                                <th className="p-3 border">Site ID</th>
                                <th className="p-3 border">Entries Count</th>
                                <th className="p-3 border">Created At</th>
                            </tr>
                        </thead>
                        <tbody>
                            {timesheets.map(ts => (
                                <tr key={ts._docId} className="hover:bg-gray-50">
                                    <td className="p-3 border font-mono text-xs">{ts._docId}</td>
                                    <td className="p-3 border text-xs">{ts.userId}</td>
                                    <td className="p-3 border text-xs">{ts.companyId}</td>
                                    <td className="p-3 border font-bold text-blue-600">{ts.weekStartDate}</td>
                                    <td className="p-3 border">{ts.period}</td>
                                    <td className="p-3 border text-sm">{ts.siteId}</td>
                                    <td className="p-3 border text-center">{ts.entries?.length || 0}</td>
                                    <td className="p-3 border text-xs">
                                        {ts.createdAt?.seconds ? new Date(ts.createdAt.seconds * 1000).toLocaleString() : 'N/A'}
                                    </td>
                                </tr>
                            ))}
                            {timesheets.length === 0 && (
                                <tr>
                                    <td colSpan="6" className="p-8 text-center text-gray-500">
                                        No timesheets found in Firestore for this user.
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
