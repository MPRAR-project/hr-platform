/**
 * TimeMathService - Authoritative calculation logic for timesheets.
 * This service centralizes all logic for rounding, auto-lunch, and overtime.
 * 
 * USE THIS SERVICE to ensure consistency between the UI display and DB records.
 */
import { roundSessionRange } from '../utils/timeRounding';

export class TimeMathService {
    /**
     * Calculate core session metrics: Gross, Effective, and Overtime Duration.
     * 
     * @param {Date} startTime - Raw clock-in time
     * @param {Date} endTime - Raw clock-out time
     * @param {Object} options - Calculation parameters
     * @param {Object} options.roundingRules - Company rounding configuration
     * @param {Object} options.autoLunchConfig - Company auto-lunch configuration
     * @param {number} options.standardWorkSec - Daily overtime threshold (default 8h)
     */
    static calculateSessionMetrics(startTime, endTime, options = {}) {
        const {
            roundingRules = null,
            autoLunchConfig = { enabled: false, thresholdHours: 8, lunchBreakMinutes: 0 },
            standardWorkSec = 28800 // 8 hours default
        } = options;

        if (!startTime || !endTime || isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
            return { grossSec: 0, effectiveSec: 0, overtimeSec: 0 };
        }

        // 1. Apply Rounding
        let finalStart = startTime;
        let finalEnd = endTime;

        if (roundingRules) {
            const rounded = roundSessionRange(startTime, endTime, roundingRules);
            finalStart = rounded.roundedStart;
            finalEnd = rounded.roundedEnd;
        }

        // 2. Gross Duration
        const grossSec = Math.max(0, Math.floor((finalEnd - finalStart) / 1000));

        // 3. Auto-Lunch Deduction
        let autoLunchSec = 0;
        if (autoLunchConfig.enabled && autoLunchConfig.lunchBreakMinutes > 0) {
            const thresholdSec = (autoLunchConfig.thresholdHours || 0) * 3600;
            if (grossSec > thresholdSec) {
                autoLunchSec = (autoLunchConfig.lunchBreakMinutes || 0) * 60;
            }
        }

        // 4. Effective Duration
        const effectiveSec = Math.max(0, grossSec - autoLunchSec);

        // 5. Overtime Calculation (Daily)
        const overtimeSec = Math.max(0, effectiveSec - standardWorkSec);

        return {
            grossSec,
            effectiveSec,
            overtimeSec,
            autoLunchSec,
            roundedStart: finalStart,
            roundedEnd: finalEnd
        };
    }

    /**
     * Helper to format seconds to "Xh Ym"
     */
    static formatSeconds(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${minutes.toString().padStart(2, '0')}m`;
    }
}

export default TimeMathService;
