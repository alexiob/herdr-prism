import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const wide = (x) => typeof x === 'string' && /^\d+$/.test(x) && x.length <= 40;
export function validateBatch(x) {
    if (!x || typeof x !== 'object')
        throw new Error('Invalid sampler response');
    const error = x.error;
    if (typeof error === 'string')
        throw new Error(`metrics unavailable: ${error}`);
    const b = x;
    if (b.version !== 1 || typeof b.platform !== 'string' || b.platform.length > 32 || typeof b.bootId !== 'string' || !b.bootId || b.bootId.length > 256 || !Number.isFinite(b.sampledAt) || !wide(b.monotonicNs) || !Array.isArray(b.processes) || b.processes.length > 200000 || b.errors !== undefined && (!Array.isArray(b.errors) || b.errors.length > 200000 || !b.errors.every(e => typeof e === 'string' && e.length <= 4096)) || b.clockEpoch !== undefined && (typeof b.clockEpoch !== 'string' || !b.clockEpoch || b.clockEpoch.length > 256) || b.timings !== undefined && (!b.timings || typeof b.timings !== 'object' || !wide(b.timings.collectionNs) || !wide(b.timings.serializationNs)))
        throw new Error('Invalid sampler batch');
    const ids = new Set();
    for (const p of b.processes) {
        if (!p || !Number.isSafeInteger(p.pid) || p.pid < 1 || ids.has(p.pid) || !wide(p.startTime) || !wide(p.cpuNs) || !wide(p.rssBytes) || typeof p.name !== 'string' || p.name.length > 1024 || p.ppid !== undefined && (!Number.isSafeInteger(p.ppid) || p.ppid < 0) || p.uptimeMs !== undefined && (!Number.isSafeInteger(p.uptimeMs) || p.uptimeMs < 0) || p.availability !== undefined && !['known', 'unavailable', 'partial'].includes(p.availability))
            throw new Error('Invalid sampler process');
        ids.add(p.pid);
    }
    return b;
}
/** Release artifacts are locally pinned. Explicit developer helper paths are trusted by the caller. */
export async function verifyHelperArtifact(path, platform = process.platform, arch = process.arch) {
    const manifestText = await readFile(join(dirname(path), 'sha256.json'), 'utf8');
    if (manifestText.length > 16384)
        throw new Error('Invalid sampler manifest');
    const x = JSON.parse(manifestText);
    if (x.version !== 1 || x.platform !== platform || x.arch !== arch || x.filename !== basename(path) || typeof x.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(x.sha256))
        throw new Error('Invalid sampler manifest');
    const hash = createHash('sha256').update(await readFile(path)).digest('hex');
    if (hash !== x.sha256)
        throw new Error('Sampler checksum mismatch');
}
export class NativeSampler {
    // Windows Rust SystemTime and Node Date.now can have different wall-clock
    // precision. Record receipt on Node's timeline so history cannot discard a
    // fresh sample as future-dated; helper monotonic/CPU/identity counters stay exact.
    child;
    children = new Set();
    forceTimers = new Map();
    clockEpoch;
    buffer = '';
    closed = false;
    failed;
    pending;
    running;
    cooldownMs;
    maxRestarts;
    restartWindowMs;
    restartWindowAt = 0;
    restarts = 0;
    retryAt = 0;
    helperPath;
    timeoutMs;
    verifyPackaged;
    helperArgs;
    constructor(helperPath, timeoutMs = 5000, helperArgs = [], recovery = {}) { if ([recovery.cooldownMs, recovery.maxRestarts, recovery.windowMs].some(value => value !== undefined && (!Number.isFinite(value) || value < 0)))
        throw new Error('Invalid sampler recovery limits'); this.helperArgs = [...helperArgs]; this.verifyPackaged = helperPath === undefined; this.helperPath = helperPath ?? fileURLToPath(new URL(`../../bin/${process.platform}-${process.arch}/hat-sampler${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url)); this.timeoutMs = timeoutMs; this.cooldownMs = Math.min(30000, Math.max(0, recovery.cooldownMs ?? 1000)); this.maxRestarts = Math.min(10, Math.max(0, Math.floor(recovery.maxRestarts ?? 3))); this.restartWindowMs = Math.min(300000, Math.max(1000, recovery.windowMs ?? 60000)); }
    async start() {
        if (this.child)
            return;
        if (this.verifyPackaged) {
            try {
                await verifyHelperArtifact(this.helperPath);
            }
            catch (error) {
                throw new Error(`metrics unavailable: sampler artifact (${String(error)})`);
            }
        }
        if (this.closed)
            throw new Error('sampler closed');
        const child = spawn(this.helperPath, this.helperArgs, { stdio: 'pipe', windowsHide: true, detached: false });
        this.child = child;
        this.children.add(child);
        this.clockEpoch = randomUUID();
        this.buffer = '';
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => { if (this.child !== child || this.closed)
            return; this.buffer += chunk; if (this.buffer.length > 32 * 1024 * 1024) {
            this.fail(new Error('Sampler response too large'));
            return;
        } let pos; while ((pos = this.buffer.indexOf('\n')) >= 0) {
            const line = this.buffer.slice(0, pos);
            this.buffer = this.buffer.slice(pos + 1);
            try {
                const wireBatch = validateBatch(JSON.parse(line));
                const batch = { ...wireBatch, clockEpoch: this.clockEpoch, ...process.platform === 'win32' ? { sampledAt: Date.now() } : {} };
                if (!this.pending) {
                    this.fail(new Error('Unsolicited sampler response'));
                    return;
                }
                clearTimeout(this.pending.timer);
                this.pending.resolve(batch);
                this.pending = undefined;
            }
            catch (e) {
                this.fail(e);
                return;
            }
        } });
        const exited = () => { this.children.delete(child); const timer = this.forceTimers.get(child); if (timer)
            clearTimeout(timer); this.forceTimers.delete(child); };
        child.stderr.resume();
        child.on('error', e => { if (child.pid === undefined)
            exited(); if (this.child === child)
            this.fail(new Error(`metrics unavailable: sampler missing or failed (${e.message})`)); });
        child.on('exit', () => { exited(); if (!this.closed && this.child === child)
            this.fail(new Error('Sampler exited')); });
        child.stdin.on('error', e => { if (this.child === child)
            this.fail(e); });
    }
    fail(e) { this.failed = e; this.retryAt = Date.now() + this.cooldownMs; if (!this.closed) {
        const child = this.child;
        this.child = undefined;
        if (child && child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
            child.kill();
            const timer = setTimeout(() => child.kill('SIGKILL'), 1000);
            timer.unref();
            this.forceTimers.set(child, timer);
        }
    } if (this.pending) {
        clearTimeout(this.pending.timer);
        this.pending.reject(e);
        this.pending = undefined;
    } }
    sample() {
        if (this.closed)
            return Promise.reject(new Error('sampler closed'));
        if (this.running)
            return this.running;
        if (this.failed) {
            const now = Date.now();
            if (now - this.restartWindowAt >= this.restartWindowMs) {
                this.restartWindowAt = now;
                this.restarts = 0;
            }
            if (now < this.retryAt || this.restarts >= this.maxRestarts)
                return Promise.reject(this.failed);
            this.restarts++;
            this.failed = undefined;
        }
        this.running = (async () => { await this.start(); if (this.closed)
            throw new Error('sampler closed'); if (this.failed)
            throw this.failed; return await new Promise((resolve, reject) => { const timer = setTimeout(() => this.fail(new Error('Sampler timeout')), Math.max(1000, this.timeoutMs)); this.pending = { resolve, reject, timer }; this.child.stdin.write('sample\n'); }); })().catch(error => { this.fail(error); throw error; }).finally(() => { this.running = undefined; });
        return this.running;
    }
    async close() { if (this.closed)
        return; this.closed = true; this.fail(new Error('sampler closed')); await Promise.all([...this.children].map(c => { if (c.exitCode !== null || c.signalCode !== null)
        return; return new Promise(resolve => { let force; const timer = setTimeout(() => { c.kill(); force = setTimeout(() => c.kill('SIGKILL'), 1000); }, 1000); const done = () => { clearTimeout(timer); if (force)
        clearTimeout(force); resolve(); }; c.once('exit', done); c.once('error', done); c.stdin.end(); }); })); }
}
