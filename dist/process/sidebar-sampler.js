import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { parseStat } from "./linux.js";
const exec = promisify(execFile), MAX_PIDS = 128, MAX_OUTPUT = 512 * 1024;
function bounded(value, limit = MAX_OUTPUT) { if (typeof value !== 'string' || Buffer.byteLength(value) > limit)
    throw Error('Sidebar output limit exceeded'); return value; }
function pid(value) { return Number.isSafeInteger(value) && value > 0 && value <= 2147483647; }
function abortable(work, signal) { return new Promise((resolve, reject) => { const stop = () => reject(signal.reason ?? Error('Sidebar query aborted')); if (signal.aborted) {
    stop();
    work.catch(() => { });
    return;
} signal.addEventListener('abort', stop, { once: true }); work.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop)).catch(() => { }); }); }
function cpuTime(text) { const match = /^(?:(\d+)-)?(\d+):(\d{2})(?::(\d{2}))?(?:\.(\d{1,9}))?$/.exec(text); if (!match)
    throw Error('Malformed CPU TIME'); const days = BigInt(match[1] ?? '0'), a = BigInt(match[2]), b = BigInt(match[3]), c = match[4] === undefined ? undefined : BigInt(match[4]); if (b >= 60n || c !== undefined && c >= 60n || match[1] !== undefined && (c === undefined || a >= 24n))
    throw Error('Malformed CPU TIME'); const seconds = days * 86400n + (c === undefined ? a * 60n + b : a * 3600n + b * 60n + c); return (seconds * 1000000000n + BigInt((match[5] ?? '').padEnd(9, '0'))).toString(); }
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function birth(month, day, time, year) { const m = months.indexOf(month), d = Number(day), y = Number(year), [h, n, s] = time.split(':').map(Number); if (m < 0 || y < 1970 || y > 9999 || d < 1 || d > 31 || h > 23 || n > 59 || s > 59)
    throw Error('Malformed process birth'); const ms = Date.UTC(y, m, d, h, n, s), date = new Date(ms); if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m || date.getUTCDate() !== d)
    throw Error('Malformed process birth'); return ms; }
/** macOS ps supplies whole-second birth and cumulative CPU TIME (normally 10ms).
 * These identities belong to the separate sidebar tracker, never the native tree. */
export function parseSidebarPs(text, requested, now = Date.now()) {
    bounded(text);
    const wanted = new Set(requested), rows = new Map(), seen = new Set(), errors = [];
    for (const line of text.split(/\r?\n/).filter(value => value.trim())) {
        const leading = Number(/^\s*(\d+)/.exec(line)?.[1]);
        if (!wanted.has(leading)) {
            errors.push(`unrequested PID ${Number.isSafeInteger(leading) ? leading : 'unknown'} in sidebar output`);
            continue;
        }
        if (seen.has(leading)) {
            rows.delete(leading);
            errors.push(`pid ${leading}: unavailable (duplicate identity)`);
            continue;
        }
        seen.add(leading);
        try {
            const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\w{3})\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})\s+(\d{4})\s+(.+?)\s*$/.exec(line);
            if (!m)
                throw Error('Malformed ps row');
            const id = Number(m[1]), ppid = Number(m[2]);
            if (!pid(id) || !Number.isSafeInteger(ppid) || ppid < 0 || m[9].length > 1024)
                throw Error('Malformed ps identity');
            const start = birth(m[5], m[6], m[7], m[8]), elapsed = now - start;
            rows.set(id, { pid: id, ppid, startTime: String(start / 1000), cpuNs: cpuTime(m[3]), rssBytes: (BigInt(m[4]) * 1024n).toString(), name: m[9], availability: 'known', ...(Number.isSafeInteger(elapsed) && elapsed >= 0 ? { uptimeMs: elapsed } : {}) });
        }
        catch (error) {
            errors.push(`pid ${leading}: unavailable (${error.message})`);
        }
    }
    for (const id of wanted)
        if (!rows.has(id) && !errors.some(e => e.startsWith(`pid ${id}:`)))
            errors.push(`pid ${id}: unavailable (exited or denied)`);
    return { processes: [...rows.values()].sort((a, b) => a.pid - b.pid), errors };
}
/** PID-only observer. It never falls back to full-host process/tree enumeration.
 * Partial failures omit unreadable rows and report errors, never measured zero.
 * close aborts only this sampler's own I/O/helper commands, never target processes. */
export class SidebarSampler {
    options;
    platform;
    runner;
    closed = false;
    active;
    metadata;
    epoch = 'sidebar-' + randomUUID();
    constructor(options = {}) { this.options = options; this.platform = options.platform ?? process.platform; if (this.platform === 'macos')
        this.platform = 'darwin'; if (this.platform === 'windows')
        this.platform = 'win32'; if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 30000))
        throw Error('Sidebar timeout must be between 1 and 30000 ms'); this.runner = options.runner ?? (async (file, args, run) => { const result = await exec(file, args, { ...run, encoding: 'utf8', windowsHide: true }); return { stdout: result.stdout, stderr: result.stderr }; }); }
    batch(processes = [], errors = [], bootId = this.epoch) { return { version: 1, platform: this.platform, bootId, sampledAt: Date.now(), monotonicNs: process.hrtime.bigint().toString(), processes, errors }; }
    async command(file, args, signal) { if (signal.aborted)
        throw signal.reason; const result = await abortable(this.runner(file, args, { signal, timeout: this.options.timeoutMs ?? 4000, maxBuffer: MAX_OUTPUT, env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } }), signal); return bounded(result.stdout); }
    async file(file, signal) { if (signal.aborted)
        throw signal.reason; const work = this.options.readFile ? this.options.readFile(file, { signal }) : readFile(file, { signal, encoding: 'utf8' }); return bounded(await abortable(work, signal), 65536); }
    async identity(signal) { if (!this.metadata) {
        const pending = (async () => { if (this.platform === 'linux') {
            const root = this.options.procRoot ?? '/proc';
            const [clock, page, boot] = await Promise.all([this.options.clockTicks ?? this.command('getconf', ['CLK_TCK'], signal).then(v => Number(v.trim())), this.options.pageSize ?? this.command('getconf', ['PAGESIZE'], signal).then(v => Number(v.trim())), this.file(join(root, 'sys/kernel/random/boot_id'), signal)]);
            if (!Number.isSafeInteger(clock) || clock <= 0 || !Number.isSafeInteger(page) || page <= 0)
                throw Error('OS clock/page units unavailable');
            const bootId = boot.trim();
            if (!bootId || bootId.length > 256 || /[\r\n\x00]/.test(bootId))
                throw Error('OS boot identity unavailable');
            return { hz: clock, pages: page, bootId };
        } if (this.platform === 'darwin') {
            const boot = (await this.command('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'], signal)).trim();
            if (!boot || boot.length > 256 || /[\r\n\x00]/.test(boot))
                throw Error('OS boot identity unavailable');
            return { bootId: 'sidebar-darwin:' + boot };
        } if (this.platform === 'win32')
            throw Error('Windows sidebar metrics unavailable: target-only working-set API required; .NET fallback may enumerate the host'); throw Error('Unsupported sidebar platform: ' + this.platform); })();
        this.metadata = pending;
        pending.catch(() => { if (this.metadata === pending)
            this.metadata = undefined; });
    } return abortable(this.metadata, signal); }
    async collect(pids, signal) {
        const identity = await this.identity(signal);
        if (this.platform === 'darwin') {
            const text = await this.command('/bin/ps', ['-p', pids.join(','), '-o', 'pid=,ppid=,time=,rss=,lstart=,comm='], signal);
            const result = parseSidebarPs(text, pids);
            return this.batch(result.processes, result.errors, identity.bootId);
        }
        const root = this.options.procRoot ?? '/proc';
        let uptimeNs;
        try {
            const text = await this.file(join(root, 'uptime'), signal), m = /^(\d+)(?:\.(\d+))?\s/.exec(text);
            if (!m)
                throw Error('Malformed uptime');
            uptimeNs = BigInt(m[1]) * 1000000000n + BigInt((m[2] ?? '').slice(0, 9).padEnd(9, '0'));
        }
        catch { /* Timing is explicitly absent; resource values can still be measured. */ }
        const processes = [], errors = [];
        for (let offset = 0; offset < pids.length; offset += 8)
            await Promise.all(pids.slice(offset, offset + 8).map(async (id) => { try {
                const row = parseStat(await this.file(join(root, String(id), 'stat'), signal), identity.hz, identity.pages, uptimeNs);
                if (row.pid !== id)
                    throw Error('target identity mismatch');
                processes.push(row);
            }
            catch (error) {
                const code = error.code;
                errors.push(`pid ${id}: ${code === 'ENOENT' ? 'exited' : 'unavailable'} (${code ?? error.message})`);
            } }));
        return this.batch(processes.sort((a, b) => a.pid - b.pid), errors, identity.bootId);
    }
    async sample(pids) { if (this.closed)
        throw Error('Sidebar sampler closed'); if (!Array.isArray(pids) || pids.length > MAX_PIDS || pids.some(value => !pid(value)))
        throw Error('Sidebar requires at most 128 valid numeric PIDs'); if (this.active)
        throw Error('Sidebar sample already in progress'); const unique = [...new Set(pids)].sort((a, b) => a - b); if (!unique.length)
        return this.batch(); const controller = new AbortController(), timer = setTimeout(() => controller.abort(Error('Sidebar query timeout')), this.options.timeoutMs ?? 4000); const done = (async () => { try {
        return await abortable(this.collect(unique, controller.signal), controller.signal);
    }
    catch (error) {
        if (this.closed)
            throw Error('Sidebar sampler closed');
        return this.batch([], unique.map(id => `pid ${id}: unavailable (${error.message})`));
    }
    finally {
        clearTimeout(timer);
        if (this.active?.controller === controller)
            this.active = undefined;
    } })(); this.active = { controller, done }; return done; }
    async close() { this.closed = true; const active = this.active; if (active) {
        active.controller.abort(Error('Sidebar sampler closed'));
        await active.done.catch(() => { });
    } }
}
