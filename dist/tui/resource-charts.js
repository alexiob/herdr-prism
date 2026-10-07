const measured = (value) => {
    if (value === undefined)
        return;
    try {
        const number = typeof value === 'number' ? value : Number(BigInt(value));
        return Number.isFinite(number) && number >= 0 ? number : undefined;
    }
    catch {
        return;
    }
};
/** Last measured sample per interval; missing samples never fabricate a value. */
export function resourceChart(history, kind, width, now) {
    width = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
    const values = (history?.[kind] ?? []).map(measured), points = history?.points, windowMs = history?.windowMs;
    const result = { values: [], measuredCount: 0, explicitGaps: 0 };
    if (points?.length && windowMs !== undefined && Number.isFinite(windowMs) && windowMs > 0 && Number.isFinite(now)) {
        const first = points.find(point => Number.isFinite(point.at) && point.at >= now - windowMs && point.at <= now);
        const from = first?.at ?? now, elapsed = now - from;
        result.period = { from, to: now };
        result.values = Array(width).fill(undefined);
        for (let i = 0; i < points.length; i++) {
            const point = points[i];
            if (!Number.isFinite(point.at) || point.at < from || point.at > now)
                continue;
            const index = elapsed === 0 ? width - 1 : Math.min(width - 1, Math.floor((point.at - from) * width / elapsed));
            if (point.gap) {
                result.explicitGaps++;
                if (width)
                    result.values[index] = undefined;
                continue;
            }
            const value = values[i];
            if (value === undefined)
                continue;
            result.measuredCount++;
            result.latestMeasuredAt = point.at;
            if (width)
                result.values[index] = value;
        }
    }
    else {
        result.values = width ? values.slice(-width) : [];
        result.measuredCount = values.filter(value => value !== undefined).length;
    }
    return result;
}
