export function formatISODate(date) {
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function getWeekRange(date, weekStartDay = 1) { // 1 = Monday default
    const current = new Date(date);
    const day = current.getDay();
    const diff = (day - weekStartDay + 7) % 7;

    const start = new Date(current);
    start.setDate(current.getDate() - diff);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    return { start, end };
}
