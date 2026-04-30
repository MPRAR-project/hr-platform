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
    // "up" or "down". Default to down if invalid/unspecified?
    // Client code: direction === UP ? UP : DOWN.
    const direction = (rule.direction || '').toLowerCase() === ROUNDING_DIRECTIONS.UP
        ? ROUNDING_DIRECTIONS.UP
        : ROUNDING_DIRECTIONS.DOWN;
    return {
        direction,
        incrementMinutes: clampIncrement(rule.incrementMinutes ?? 5),
    };
}

function getDefaultRoundingRules() {
    return {
        clockIn: normalizeRule(DEFAULT_ROUNDING_RULES.clockIn),
        clockOut: normalizeRule(DEFAULT_ROUNDING_RULES.clockOut),
    };
}

function normalizeRoundingRules(rules) {
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

function applyRoundingToDate(date, rule) {
    const normalized = normalizeRule(rule);
    const rounded = roundDate(date, normalized.incrementMinutes, normalized.direction);
    return rounded ?? new Date(date);
}

function roundSessionRange(startDate, endDate, rules) {
    const normalized = normalizeRoundingRules(rules);
    const roundedStart = applyRoundingToDate(startDate, normalized.clockIn);
    const roundedEnd = applyRoundingToDate(endDate, normalized.clockOut);

    // If rounding flips the order (rare but possible with aggressive rounding), clamp end to start
    if (roundedEnd && roundedStart && roundedEnd < roundedStart) {
        return {
            roundedStart,
            roundedEnd: new Date(roundedStart),
        };
    }

    return { roundedStart, roundedEnd };
}

module.exports = {
    roundSessionRange,
    applyRoundingToDate,
    getDefaultRoundingRules,
    normalizeRoundingRules
};
