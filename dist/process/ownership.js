import { LaunchLedger, processKey } from "./ledger.js";
export class ProcessTracker {
    batch;
    owned = new Map();
    remembered = new Map();
    boundRoots = new Map();
    shared = new Map();
    unreadable = new Map();
    ledger;
    constructor(ledger = new LaunchLedger()) { this.ledger = ledger; }
    update(batch, roots, options = {}) {
        const previous = this.batch, old = this.owned;
        const byPid = new Map(batch.processes.map(p => [p.pid, p]));
        const rootOwners = new Map();
        this.shared.clear();
        const liveRootIds = new Set(roots.map(r => `${r.sessionKey}:${r.pid}`));
        for (const k of this.boundRoots.keys())
            if (!liveRootIds.has(k))
                this.boundRoots.delete(k);
        for (const r of roots) {
            const p = byPid.get(r.pid);
            if (!p)
                continue;
            const k = processKey(batch.bootId, p.pid, p.startTime), rk = `${r.sessionKey}:${r.pid}`;
            const bound = this.boundRoots.get(rk);
            if (r.startTime !== undefined && r.startTime !== p.startTime)
                continue;
            if (bound && bound !== k && r.startTime === undefined)
                continue;
            this.boundRoots.set(rk, k);
            const other = rootOwners.get(r.pid);
            if (other && other !== r.sessionKey)
                this.shared.set(r.sessionKey, other);
            else
                rootOwners.set(r.pid, r.sessionKey);
        }
        const next = new Map();
        const sameBoot = previous?.bootId === batch.bootId;
        for (const p of batch.processes) {
            const k = processKey(batch.bootId, p.pid, p.startTime);
            let cursor = p, owner;
            const seen = new Set();
            while (cursor && !seen.has(cursor.pid)) {
                seen.add(cursor.pid);
                owner = rootOwners.get(cursor.pid) || this.ledger.owner(batch, cursor.pid, cursor.startTime);
                if (owner)
                    break;
                const parent = byPid.get(cursor.ppid ?? -1);
                // Windows creation FILETIMEs and Linux start ticks are ordered within a boot.
                if (parent && BigInt(parent.startTime) > BigInt(cursor.startTime))
                    break;
                cursor = parent;
            }
            owner ??= sameBoot ? this.remembered.get(k) : undefined;
            if (!owner)
                continue;
            const prior = old.get(k);
            let cpuPercent;
            if (!options.resetCpuBaseline && sameBoot && prior && p.availability !== 'unavailable' && prior.availability !== 'unavailable') {
                const wall = BigInt(batch.monotonicNs) - BigInt(previous.monotonicNs), delta = BigInt(p.cpuNs) - BigInt(prior.cpuNs);
                if (wall > 0n && delta >= 0n)
                    cpuPercent = Number(delta) * 100 / Number(wall);
            }
            next.set(k, { ...p, key: k, owner, isHarness: rootOwners.get(p.pid) === owner, cpuPercent });
        }
        const denied = new Set((batch.errors ?? []).map(e => /^pid (\d+)(?:[: ]).*?(?:denied|unavailable|EACCES|EPERM)/i.exec(e)?.[1]).filter(Boolean).map(Number));
        const unreadable = new Map();
        if (sameBoot) {
            for (const [key, owner] of this.remembered) {
                const pid = Number(JSON.parse(key)[1]);
                if (denied.has(pid) && !byPid.has(pid))
                    unreadable.set(key, { pid, owner });
            }
        }
        for (const r of roots)
            if (denied.has(r.pid) && !byPid.has(r.pid)) {
                const key = this.boundRoots.get(`${r.sessionKey}:${r.pid}`);
                if (key)
                    unreadable.set(key, { pid: r.pid, owner: r.sessionKey });
            }
        this.owned = next;
        this.unreadable = unreadable;
        this.remembered = new Map([...next].map(([k, p]) => [k, p.owner]));
        for (const [key, p] of unreadable)
            this.remembered.set(key, p.owner);
        this.batch = batch;
        this.ledger.reconcile(batch);
    }
    view(sessionKey, includeDescendants = false, descendants = []) {
        const sessions = new Set([sessionKey, ...includeDescendants ? descendants : []]);
        const processes = [...this.owned.values()].filter(p => sessions.has(p.owner));
        const readable = processes.filter(p => p.availability !== 'unavailable');
        const cpu = readable.filter(p => p.cpuPercent !== undefined);
        const sharedWith = this.shared.get(sessionKey);
        const errors = this.batch?.errors ?? [];
        const unreadablePids = [...this.unreadable.values()].filter(p => sessions.has(p.owner)).map(p => p.pid);
        const total = processes.length + unreadablePids.length;
        const availability = sharedWith ? 'not_applicable' : !total ? 'unavailable' : readable.length !== total || errors.length ? 'partial' : 'known';
        return { processes, cpuPercent: total && cpu.length === total ? cpu.reduce((s, p) => s + p.cpuPercent, 0) : undefined, memoryBytes: readable.length ? readable.reduce((s, p) => s + BigInt(p.rssBytes), 0n).toString() : undefined, availability, coverage: { readable: readable.length, total }, cpuCoverage: { readable: cpu.length, total }, memoryLabel: this.batch?.platform === 'win32' || this.batch?.platform === 'windows' ? 'working-set sum' : 'RSS sum', sampledAt: this.batch?.sampledAt, sharedWith, reason: sharedWith ? 'shared with parent' : !processes.length ? 'No verified live process' : undefined, errors, unreadablePids };
    }
}
