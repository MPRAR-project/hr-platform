import React, { useState, useEffect, useRef } from 'react';
import { Bell, Check, Trash2, X } from 'lucide-react';
import { subscribeToNotifications, markNotificationRead, markAllNotificationsRead } from '../../services/notifications';
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

    // Real-time listener via REST/WS service
    const userId = user?.id || user?.uid;
    useEffect(() => {
        if (!userId) return;

        const unsubscribe = subscribeToNotifications(userId, (updates) => {
            setNotifications(updates);
            setUnreadCount(updates.filter(n => !n.isRead && n.status !== 'read').length);
        });

        return () => unsubscribe();
    }, [userId]);

    const markAsRead = async (notification) => {
        try {
            await markNotificationRead(notification.id);
        } catch (error) {
            console.error('Error marking as read:', error);
        }
    };

    const handleNotificationClick = async (notification) => {
        const isUnread = !notification.isRead && notification.status !== 'read';
        if (isUnread) {
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
        try {
            await markAllNotificationsRead(userId);
            // Local update for immediate feedback
            setNotifications(prev => prev.map(n => ({ ...n, status: 'read', isRead: true })));
            setUnreadCount(0);
        } catch (error) {
            console.error('Error marking all read:', error);
        }
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
