import React, { useState, useEffect, useRef } from 'react';
import { Bell, Check, Trash2, X } from 'lucide-react';
import { collection, query, where, orderBy, limit, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase/client';
import { useAuth } from '../../hooks/useAuth';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';

const NotificationBell = () => {
    const { user } = useAuth();
    const [notifications, setNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);
    const navigate = useNavigate();

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Real-time listener - use stable userId to prevent re-subscription loop
    const userId = user?.id || user?.uid;
    useEffect(() => {
        if (!userId) return;

        const q = query(
            collection(db, 'notifications'),
            where('userId', '==', userId),
            orderBy('createdAt', 'desc'),
            limit(20)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const updates = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setNotifications(updates);
            setUnreadCount(updates.filter(n => n.status === 'unread').length);
        });

        return () => unsubscribe();
    }, [userId]);

    const markAsRead = async (notification) => {
        try {
            await updateDoc(doc(db, 'notifications', notification.id), {
                status: 'read',
                readAt: serverTimestamp()
            });
        } catch (error) {
            console.error('Error marking as read:', error);
        }
    };

    const handleNotificationClick = async (notification) => {
        if (notification.status === 'unread') {
            await markAsRead(notification);
        }

        // Navigation logic based on type
        if (notification.type === 'shift_assigned' || notification.title?.includes('Shift')) {
            navigate('/schedule');
        } else if (notification.relatedEntityType === 'onboarding_application') {
            // navigate('/onboardings-management'); 
        } else if (notification.type === 'timesheet_submission') {
            if (notification.data?.employeeId) {
                navigate(`/timesheets/${notification.data.employeeId}`);
            } else {
                navigate('/timesheet-approvals');
            }
        } else if (notification.type === 'timesheet_decision') {
            navigate('/timesheets');
        } else if (notification.type === 'leave_request') {
            const employeeId = notification.data?.employeeId || notification.relatedEntityId;
            const absenceId = notification.data?.absenceId || notification.relatedEntityId;
            if (employeeId && employeeId !== absenceId) {
                navigate(`/absences/${employeeId}`, { state: { autoOpenAbsenceId: absenceId } });
            } else {
                navigate(`/absences`);
            }
        } else if (notification.type === 'leave_decision') {
            navigate('/absences');
        } else if (notification.type === 'allowance_update') {
            const employeeId = notification.data?.employeeId || notification.relatedEntityId;
            if (employeeId) {
                navigate(`/absences/${employeeId}`);
            } else {
                navigate('/absences');
            }
        }
        setIsOpen(false);
    };

    const markAllRead = async () => {
        // Optimistic update for UI feel (batch update in background)
        // For simplicity, just update displayed ones
        const unreadIds = notifications.filter(n => n.status === 'unread').map(n => n.id);
        unreadIds.forEach(id => {
            updateDoc(doc(db, 'notifications', id), { status: 'read', readAt: serverTimestamp() }).catch(console.error);
        });
    };

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="p-2 rounded-full hover:bg-gray-100 relative transition-colors"
                aria-label={`Notifications, ${unreadCount} unread`}
                title="Notifications"
            >
                <Bell className={`h-6 w-6 ${unreadCount > 0 ? 'text-purple-600 fill-purple-100' : 'text-gray-600'}`} />
                {unreadCount > 0 && (
                    <span
                        className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-red-600 rounded-full text-[11px] font-bold text-white flex items-center justify-center border-2 border-white px-0.5"
                        aria-live="polite"
                        aria-label={`${unreadCount} unread notifications`}
                    >
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden animation-fade-in-down">
                    <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                        <h3 className="font-semibold text-gray-800">Notifications</h3>
                        {unreadCount > 0 && (
                            <button onClick={markAllRead} className="text-xs text-purple-600 hover:text-purple-700 font-medium">
                                Mark all read
                            </button>
                        )}
                    </div>

                    <div className="max-h-[70vh] overflow-y-auto">
                        {notifications.length === 0 ? (
                            <div className="p-8 text-center text-gray-500 flex flex-col items-center">
                                <Bell className="h-8 w-8 text-gray-300 mb-2" />
                                <p>No notifications yet</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-gray-50">
                                {notifications.map(notification => (
                                    <div
                                        key={notification.id}
                                        onClick={() => handleNotificationClick(notification)}
                                        className={`p-4 hover:bg-gray-50 cursor-pointer transition-colors ${notification.status === 'unread' ? 'bg-purple-50/50' : ''}`}
                                    >
                                        <div className="flex gap-3">
                                            <div className="mt-1 flex-shrink-0">
                                                <div className={`h-2 w-2 rounded-full ${notification.status === 'unread' ? 'bg-purple-500' : 'bg-transparent'}`} />
                                            </div>
                                            <div className="flex-1 space-y-1">
                                                <p className={`text-sm ${notification.status === 'unread' ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                                                    {notification.title}
                                                </p>
                                                <p className="text-xs text-gray-500 line-clamp-2">
                                                    {notification.message}
                                                </p>
                                                <p className="text-[10px] text-gray-400">
                                                    {notification.createdAt?.toDate ? formatDistanceToNow(notification.createdAt.toDate(), { addSuffix: true }) : 'Just now'}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default NotificationBell;
