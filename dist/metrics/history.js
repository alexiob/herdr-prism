export class SampleHistory {
    series = new Map();
    windowMs;
    maxPoints;
    gapMs;
    maxSeries;
    constructor(options = {}) { this.windowMs = Math.min(900000, Math.max(1, options.windowMs ?? 900000)); this.maxPoints = Math.max(1, options.maxPoints ?? 900); this.gapMs = options.gapMs ?? 5000; this.maxSeries = Math.max(1, options.maxSeries ?? 256); }
    add(session, scope, point) { if (!Number.isFinite(point.at))
        throw new Error('Invalid sample time'); const key = JSON.stringify([session, scope]); let points = this.series.get(key) ?? []; const last = points.at(-1); if (last && point.at < last.at)
        return; if (last && point.at === last.at)
        points.pop(); points.push({ ...point }); points = points.filter(p => p.at >= point.at - this.windowMs).slice(-this.maxPoints); this.series.delete(key); this.series.set(key, points); while (this.series.size > this.maxSeries)
        this.series.delete(this.series.keys().next().value); }
    view(session, scope, now = Date.now()) {
        const key = JSON.stringify([session, scope]);
        const raw = (this.series.get(key) ?? []).filter(p => p.at >= now - this.windowMs && p.at <= now);
        if (this.series.has(key))
            this.series.set(key, raw);
        const points = [];
        let peakMemoryBytes, peakCpuPercent;
        for (const p of raw) {
            const last = points.at(-1);
            if (last && p.at - last.at > this.gapMs)
                points.push({ at: last.at + this.gapMs, gap: true });
            points.push({ ...p });
            if (p.memoryBytes !== undefined) {
                const v = BigInt(p.memoryBytes);
                peakMemoryBytes = peakMemoryBytes === undefined || v > peakMemoryBytes ? v : peakMemoryBytes;
            }
            if (p.cpuPercent !== undefined)
                peakCpuPercent = Math.max(peakCpuPercent ?? 0, p.cpuPercent);
        }
        return { points, cpu: points.map(p => p.cpuPercent), memory: points.map(p => p.memoryBytes), peakMemoryBytes: peakMemoryBytes?.toString(), peakCpuPercent, observedFrom: raw[0]?.at, observedTo: raw.at(-1)?.at, windowMs: this.windowMs };
    }
    clear(session) { if (session === undefined)
        this.series.clear();
    else
        for (const key of this.series.keys())
            if (JSON.parse(key)[0] === session)
                this.series.delete(key); }
}
