import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/client';
import { useAuth } from '../../hooks/useAuth';
import Header from '../../components/layout/Header';
import Loader from '../../components/ui/Loader';

const SessionDebugPage = () => {
    const { user } = useAuth();
    const [sessions, setSessions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchSessions = async () => {
            if (!user?.uid || !user?.companyId) {
                setLoading(false);
                return;
            }

            try {
                setLoading(true);
                const companyId = user.companyId.includes('/')
                    ? user.companyId.split('/')[1]
                    : user.companyId;

                console.log('[SessionDebug] Fetching sessions for:', {
                    userId: user.uid,
                    companyId
                });

                // Query all sessions for this user
                const sessionsQuery = query(
                    collection(db, 'timeClockSessions'),
                    where('companyId', '==', companyId),
                    where('userId', '==', user.uid)
                );

                const snapshot = await getDocs(sessionsQuery);

                console.log('[SessionDebug] Found sessions:', snapshot.docs.length);

                const sessionData = snapshot.docs.map(doc => {
                    const data = doc.data();
                    const startedAt = data.startedAt?.toDate?.() || data.startedAt;

                    return {
                        id: doc.id,
                        userId: data.userId,
                        companyId: data.companyId,
                        startedAt: startedAt,
                        startedAtISO: startedAt instanceof Date ? startedAt.toISOString() : 'Invalid',
                        dateString: startedAt instanceof Date ? startedAt.toISOString().slice(0, 10) : 'Invalid',
                        endedAt: data.endedAt?.toDate?.() || data.endedAt,
                        status: data.status,
                        rawData: data
                    };
                });

                // Sort by date descending
                sessionData.sort((a, b) => {
                    const aTime = a.startedAt instanceof Date ? a.startedAt.getTime() : 0;
                    const bTime = b.startedAt instanceof Date ? b.startedAt.getTime() : 0;
                    return bTime - aTime;
                });

                setSessions(sessionData);
                console.log('[SessionDebug] Processed sessions:', sessionData);

                // Check for specific Dec 30 session
                const dec30Session = sessionData.find(s => s.id === 'dntZEWi5gzB2qsObgHXL');
                if (dec30Session) {
                    console.log('✅ Dec 30 session FOUND:', dec30Session);
                } else {
                    console.log('❌ Dec 30 session NOT FOUND in results');
                }

            } catch (err) {
                console.error('[SessionDebug] Error:', err);
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchSessions();
    }, [user?.uid, user?.companyId]);

    if (loading) {
        return (
            <div className="h-screen flex flex-col">
                <Header title="Session Debug" subtitle="Analyzing clock sessions" />
                <div className="flex-1 flex items-center justify-center">
                    <Loader variant="spinner" size="lg" />
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="h-screen flex flex-col">
                <Header title="Session Debug" subtitle="Error loading sessions" />
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-red-600">Error: {error}</div>
                </div>
            </div>
        );
    }

    const dec30Session = sessions.find(s => s.id === 'dntZEWi5gzB2qsObgHXL');

    return (
        <div className="h-screen flex flex-col overflow-hidden">
            <Header title="Session Debug" subtitle={`Found ${sessions.length} sessions`} />

            <div className="flex-1 overflow-y-auto p-6">
                <div className="max-w-7xl mx-auto space-y-6">
                    {/* Dec 30 Session Status */}
                    <div className={`p-4 rounded-lg border-2 ${dec30Session ? 'bg-green-50 border-green-500' : 'bg-red-50 border-red-500'}`}>
                        <h2 className="text-lg font-bold mb-2">
                            {dec30Session ? '✅ Dec 30 Session FOUND' : '❌ Dec 30 Session NOT FOUND'}
                        </h2>
                        {dec30Session && (
                            <div className="text-sm space-y-1">
                                <p><strong>ID:</strong> {dec30Session.id}</p>
                                <p><strong>Date:</strong> {dec30Session.dateString}</p>
                                <p><strong>Started At:</strong> {dec30Session.startedAtISO}</p>
                                <p><strong>Status:</strong> {dec30Session.status}</p>
                            </div>
                        )}
                    </div>

                    {/* User Info */}
                    <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                        <h3 className="font-bold mb-2">User Info</h3>
                        <p><strong>User ID:</strong> {user?.uid}</p>
                        <p><strong>Company ID:</strong> {user?.companyId}</p>
                        <p><strong>Email:</strong> {user?.email}</p>
                    </div>

                    {/* Sessions Table */}
                    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-gray-50 border-b border-gray-200">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">ID</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Date</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Started At</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Ended At</th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {sessions.map((session) => (
                                        <tr
                                            key={session.id}
                                            className={session.id === 'dntZEWi5gzB2qsObgHXL' ? 'bg-yellow-50' : ''}
                                        >
                                            <td className="px-4 py-3 text-sm font-mono">
                                                {session.id}
                                                {session.id === 'dntZEWi5gzB2qsObgHXL' && (
                                                    <span className="ml-2 text-xs bg-yellow-200 px-2 py-1 rounded">Dec 30</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-sm">{session.dateString}</td>
                                            <td className="px-4 py-3 text-sm font-mono text-xs">
                                                {session.startedAt instanceof Date
                                                    ? session.startedAt.toLocaleString()
                                                    : 'Invalid'}
                                            </td>
                                            <td className="px-4 py-3 text-sm font-mono text-xs">
                                                {session.endedAt instanceof Date
                                                    ? session.endedAt.toLocaleString()
                                                    : 'N/A'}
                                            </td>
                                            <td className="px-4 py-3 text-sm">
                                                <span className={`px-2 py-1 rounded text-xs font-semibold ${session.status === 'closed'
                                                    ? 'bg-gray-100 text-gray-700'
                                                    : 'bg-green-100 text-green-700'
                                                    }`}>
                                                    {session.status}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Raw Data */}
                    <details className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                        <summary className="font-bold cursor-pointer">View Raw Session Data (JSON)</summary>
                        <pre className="mt-4 text-xs overflow-x-auto bg-white p-4 rounded border border-gray-300">
                            {JSON.stringify(sessions, null, 2)}
                        </pre>
                    </details>
                </div>
            </div>
        </div>
    );
};

export default SessionDebugPage;
