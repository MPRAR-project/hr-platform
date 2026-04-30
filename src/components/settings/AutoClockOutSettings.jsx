import { Clock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getCompanyAutoClockOutConfig, getDefaultAutoClockOutTimes } from '../../services/autoClockOut';

/**
 * AutoClockOutSettings Component
 * Allows company owners/admins to configure auto clock-out times for day and night shifts
 */
const AutoClockOutSettings = ({ companyId, autoClockOutConfig, setAutoClockOutConfig, userRole }) => {
    const [dayShiftTime, setDayShiftTime] = useState('18:00');
    const [nightShiftTime, setNightShiftTime] = useState('06:00');
    const [isLoading, setIsLoading] = useState(true);

    // Load current config on mount
    useEffect(() => {
        const loadConfig = async () => {
            try {
                if (companyId) {
                    const config = await getCompanyAutoClockOutConfig(companyId);
                    setDayShiftTime(config.dayShiftTime || '18:00');
                    setNightShiftTime(config.nightShiftTime || '06:00');
                }
            } catch (error) {
                console.error('Error loading auto clock-out config:', error);
                const defaults = getDefaultAutoClockOutTimes();
                setDayShiftTime(defaults.dayShiftTime);
                setNightShiftTime(defaults.nightShiftTime);
            } finally {
                setIsLoading(false);
            }
        };
        loadConfig();
    }, [companyId]);

    // Update parent component whenever local state changes
    useEffect(() => {
        if (!isLoading) {
            setAutoClockOutConfig({
                dayShiftTime,
                nightShiftTime
            });
        }
    }, [dayShiftTime, nightShiftTime, isLoading, setAutoClockOutConfig]);

    // Check if user has permission to edit
    const canEdit = ['siteManager', 'seniorManager'].includes(userRole);

    const handleTimeChange = (type, value) => {
        // Validate time format (HH:MM)
        if (/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(value)) {
            if (type === 'day') {
                setDayShiftTime(value);
            } else {
                setNightShiftTime(value);
            }
        }
    };

    if (isLoading) {
        return (
            <div className="w-full space-y-4 animate-pulse">
                <div className="h-10 bg-gray-200 rounded"></div>
                <div className="h-10 bg-gray-200 rounded"></div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="bg-gradient-to-br from-primary-50 to-primary-100 border border-primary-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                    <Clock className="h-5 w-5 text-primary-600 mt-0.5 flex-shrink-0" />
                    <div>
                        <h3 className="font-semibold text-primary-900">Auto Clock-Out Settings</h3>
                        <p className="text-sm text-primary-700 mt-1">
                            Set the times when employees will be automatically clocked out if they forget to clock out manually. This prevents inaccurate hours from being recorded.
                        </p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Day Shift */}
                <div>
                    <label className="text-md font-medium text-text-primary mb-3 block">
                        Day Shift Auto Clock-Out Time
                    </label>
                    <div className="relative">
                        <input
                            type="time"
                            value={dayShiftTime}
                            onChange={(e) => handleTimeChange('day', e.target.value)}
                            disabled={!canEdit}
                            className={`w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple ${!canEdit ? 'bg-gray-50 cursor-not-allowed text-text-secondary' : 'bg-white'
                                }`}
                        />
                    </div>
                    
                </div>

                {/* Night Shift */}
                <div>
                    <label className="text-md font-medium text-text-primary mb-3 block">
                        Night Shift Auto Clock-Out Time
                    </label>
                    <div className="relative">
                        <input
                            type="time"
                            value={nightShiftTime}
                            onChange={(e) => handleTimeChange('night', e.target.value)}
                            disabled={!canEdit}
                            className={`w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple ${!canEdit ? 'bg-gray-50 cursor-not-allowed text-text-secondary' : 'bg-white'
                                }`}
                        />
                    </div>
                    
                </div>
            </div>

            {!canEdit && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                    <p className="text-sm text-yellow-800">
                        <strong>Permission Denied:</strong> Only Site Managers or Senior Managers can modify auto clock-out settings.
                    </p>
                </div>
            )}

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-sm text-blue-800">
                    <strong>Note:</strong> These times apply to all employees. Individual shifts (Day/Night) determine which time is used.
                </p>
            </div>
        </div>
    );
};

export default AutoClockOutSettings;
