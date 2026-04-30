const ROUNDING_DIRECTIONS = {
    UP: 'up',
    DOWN: 'down',
};

const DEFAULT_ROUNDING_RULES = {
    clockIn: { direction: ROUNDING_DIRECTIONS.DOWN, incrementMinutes: 5 },
    clockOut: { direction: ROUNDING_DIRECTIONS.UP, incrementMinutes: 5 },
};

function clampIncrement(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) {
        return 1;
    }
    return Math.min(60, Math.max(1, Math.round(num)));
}

function normalizeRule(rule = {}) {
    const direction = (rule.direction || '').toLowerCase() === ROUNDING_DIRECTIONS.UP
        ? ROUNDING_DIRECTIONS.UP
        : ROUNDING_DIRECTIONS.DOWN;
    return {
        direction,
        incrementMinutes: clampIncrement(rule.incrementMinutes ?? 5),
    };
}

export function getDefaultRoundingRules() {
    return {
        clockIn: normalizeRule(DEFAULT_ROUNDING_RULES.clockIn),
        clockOut: normalizeRule(DEFAULT_ROUNDING_RULES.clockOut),
    };
}

export function normalizeRoundingRules(rules) {
    if (!rules) {
        return getDefaultRoundingRules();
    }

    return {
        clockIn: normalizeRule(rules.clockIn),
        clockOut: normalizeRule(rules.clockOut),
    };
}

function roundDate(date, incrementMinutes, direction) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
        return null;
    }

    // Special handling for 60-minute rounding to round to nearest hour
    if (incrementMinutes === 60) {
        const hours = date.getHours();
        const minutes = date.getMinutes();

        if (direction === ROUNDING_DIRECTIONS.UP) {
            // Round up to next hour
            const roundedDate = new Date(date);
            if (minutes > 0) {
                roundedDate.setHours(hours + 1, 0, 0, 0);
            } else {
                roundedDate.setHours(hours, 0, 0, 0);
            }
            return roundedDate;
        } else {
            // Round down to current hour
            const roundedDate = new Date(date);
            roundedDate.setHours(hours, 0, 0, 0);
            return roundedDate;
        }
    }

    // Original logic for other increments
    const incrementMs = Math.max(1, incrementMinutes) * 60 * 1000;
    const time = date.getTime();
    const remainder = time % incrementMs;

    if (remainder === 0) {
        return new Date(time);
    }

    if (direction === ROUNDING_DIRECTIONS.UP) {
        return new Date(time + (incrementMs - remainder));
    }

    return new Date(time - remainder);
}

export function applyRoundingToDate(date, rule) {
    const normalized = normalizeRule(rule);
    const rounded = roundDate(date, normalized.incrementMinutes, normalized.direction);
    return rounded ?? new Date(date);
}

export function applyRoundingToTimeString(timeStr, rule) {
    if (!timeStr) return timeStr;
    try {
        const [hours, minutes] = String(timeStr).split(':').map(Number);
        if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
            return timeStr;
        }
        const base = new Date();
        base.setHours(hours, minutes, 0, 0);
        const rounded = applyRoundingToDate(base, rule);
        const h = String(rounded.getHours()).padStart(2, '0');
        const m = String(rounded.getMinutes()).padStart(2, '0');
        return `${h}:${m}`;
    } catch (e) {
        // failed to round time string
        return timeStr;
    }
}

export function roundSessionRange(startDate, endDate, rules) {
    const normalized = normalizeRoundingRules(rules);
    const roundedStart = applyRoundingToDate(startDate, normalized.clockIn);
    const roundedEnd = applyRoundingToDate(endDate, normalized.clockOut);

    if (roundedEnd < roundedStart) {
        return {
            roundedStart,
            roundedEnd: new Date(roundedStart),
        };
    }

    return { roundedStart, roundedEnd };
}

export const RoundingConst = {
    DIRECTIONS: ROUNDING_DIRECTIONS,
};


