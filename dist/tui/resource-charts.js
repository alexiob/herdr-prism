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
/** Step plot of observed readings; explicit gaps and unavailable readings stop the step. */
export function resourceChart(history, kind, width, now) {
    width = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
    const points = history?.points, windowMs = history?.windowMs;
    const values = (history?.[kind] ?? []).map((value, index) => measured(value) ?? (kind === 'cpu' ? measured(points?.[index]?.cpuLowerBound) : undefined));
    const result = { values: [], measuredCount: 0, partialCount: 0, explicitGaps: 0 };
    if (points?.length && windowMs !== undefined && Number.isFinite(windowMs) && windowMs > 0 && Number.isFinite(now)) {
        const first = points.find((point, index) => !point.gap && values[index] !== undefined && Number.isFinite(point.at) && point.at >= now - windowMs && point.at <= now) ?? points.find(point => Number.isFinite(point.at) && point.at >= now - windowMs && point.at <= now);
        const from = first?.at ?? now, elapsed = now - from;
        result.period = { from, to: now };
        result.values = Array(width).fill(undefined);
        const gapMs = Number.isFinite(history?.gapMs) ? Math.max(0, history.gapMs) : 5000;
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
            result.peak = Math.max(result.peak ?? 0, value);
            result.measuredCount++;
            if (kind === 'cpu' && history?.cpu[i] === undefined && point.cpuLowerBound !== undefined)
                result.partialCount++;
            result.latestMeasuredAt = point.at;
            if (width) {
                // One observation represents a step until the next reading, not just one
                // pixel. Bound the tail so a stopped collector cannot look continuously live.
                const next = points[i + 1], end = Math.min(now, point.at + gapMs, next && Number.isFinite(next.at) ? next.at : now);
                const last = elapsed === 0 ? width - 1 : Math.min(width - 1, Math.ceil((end - from) * width / elapsed) - 1);
                for (let column = index; column <= Math.max(index, last); column++)
                    result.values[column] = value;
            }
        }
    }
    else {
        result.values = width ? values.slice(-width) : [];
        const valid = values.filter((value) => value !== undefined);
        result.measuredCount = valid.length;
        for (const value of valid)
            result.peak = Math.max(result.peak ?? 0, value);
        if (kind === 'cpu')
            result.partialCount = values.filter((value, index) => value !== undefined && history?.cpu[index] === undefined && points?.[index]?.cpuLowerBound !== undefined).length;
    }
    return result;
}
