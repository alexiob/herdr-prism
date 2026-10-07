import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseNumstat, parseStatus } from "./status.js";
// One host queue for all cache instances, with at most two Git processes.
let active = 0;
const waiting = [];
async function queued(job) { if (active >= 2)
    await new Promise(done => waiting.push(done));
else
    active++; try {
    return await job();
}
finally {
    const next = waiting.shift();
    if (next)
        next();
    else
        active--;
} }
const defaultRunner = (cwd, args, options) => new Promise((yes, no) => { const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', GIT_EXTERNAL_DIFF: '', GIT_CONFIG_COUNT: '0' }; for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CEILING_DIRECTORIES', 'GIT_DISCOVERY_ACROSS_FILESYSTEM'])
    delete env[key]; execFile('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'core.quotePath=false', ...args], { cwd, encoding: 'utf8', timeout: options.timeoutMs, maxBuffer: 8 * 1024 * 1024, signal: options.signal, windowsHide: true, env }, (error, out, stderr) => { if (error)
    no(Object.assign(error, { stderr }));
else
    yes(out); }); });
function line(text) { return text.endsWith('\n') ? text.slice(0, -1) : text; }
export class GitCache {
    aliases = new Map();
    samples = new Map();
    pending = new Map();
    refreshing = new Map();
    identitySamples = new Map();
    identityInputs = new Map();
    identityPending = new Map();
    identityRefreshing = new Map();
    invalidated = new Set();
    controllers = new Set();
    closed = false;
    ttl;
    timeout;
    max;
    runner;
    now;
    constructor(options = {}) { this.ttl = options.ttlMs ?? 5000; this.timeout = options.timeoutMs ?? 2500; this.max = options.maxEntries ?? 128; this.runner = options.runner ?? defaultRunner; this.now = options.now ?? Date.now; if (!Number.isInteger(this.max) || this.max < 1 || this.max > 4096)
        throw new Error('Invalid maxEntries'); if (!Number.isFinite(this.timeout) || this.timeout <= 0 || this.timeout > 60000)
        throw new Error('Invalid timeoutMs'); if (!Number.isFinite(this.ttl) || this.ttl < 0)
        throw new Error('Invalid ttlMs'); }
    async run(cwd, args) {
        if (this.closed)
            throw new Error('Git cache closed');
        const controller = new AbortController();
        this.controllers.add(controller);
        try {
            return await queued(() => { if (this.closed)
                throw new Error('Git cache closed'); return this.runner(cwd, args, { timeoutMs: this.timeout, signal: controller.signal }); });
        }
        finally {
            this.controllers.delete(controller);
        }
    }
    async identity(cwd) {
        const root = await realpath(line(await this.run(cwd, ['rev-parse', '--show-toplevel'])));
        const gitDir = await realpath(line(await this.run(root, ['rev-parse', '--absolute-git-dir'])));
        const commonDir = await realpath(line(await this.run(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])));
        return { root, gitDir, commonDir, checkoutKey: JSON.stringify([root, gitDir]), familyKey: commonDir };
    }
    cacheIdentity(input, sample) {
        if (this.closed)
            return;
        this.identityInputs.delete(input);
        this.identityInputs.set(input, { sample, cachedAt: this.now() });
        while (this.identityInputs.size > this.max * 8)
            this.identityInputs.delete(this.identityInputs.keys().next().value);
    }
    refreshIdentity(identity) {
        const pending = this.identityRefreshing.get(identity.checkoutKey);
        if (pending)
            return pending;
        const job = (async () => {
            const optional = async (args) => { try {
                return line(await this.run(identity.root, args));
            }
            catch (error) {
                if (error.code === 1)
                    return undefined;
                throw error;
            } };
            const branch = await optional(['symbolic-ref', '--quiet', '--short', 'HEAD']);
            const head = await optional(['rev-parse', '--verify', '--quiet', 'HEAD']);
            const sample = { availability: 'known', identityOnly: true, sampledAt: this.now(), ageMs: 0, cwd: identity.root, ...identity, branch, head, branchState: head ? (branch ? 'named' : 'detached') : 'unborn' };
            const full = this.samples.get(identity.checkoutKey);
            // Previously measured counts belong to one HEAD/branch, not merely a directory.
            if (full && (full.head !== sample.head || full.branch !== sample.branch || full.branchState !== sample.branchState))
                this.samples.delete(identity.checkoutKey);
            this.identitySamples.delete(identity.checkoutKey);
            this.identitySamples.set(identity.checkoutKey, sample);
            while (this.identitySamples.size > this.max)
                this.identitySamples.delete(this.identitySamples.keys().next().value);
            return sample;
        })();
        this.identityRefreshing.set(identity.checkoutKey, job);
        void job.finally(() => this.identityRefreshing.delete(identity.checkoutKey)).catch(() => { });
        return job;
    }
    /** Cheap checkout metadata for background cards. Never reads status, diff or untracked files. */
    async getIdentity(cwd, options = {}) {
        const ttlMs = options.ttlMs ?? 30000;
        if (!Number.isFinite(ttlMs) || ttlMs < 0)
            throw new Error('Invalid ttlMs');
        const input = resolve(cwd), record = this.identityInputs.get(input), cached = record?.sample;
        if (record && this.now() - (record.sample.availability === 'stale' ? record.cachedAt : record.sample.sampledAt) < ttlMs)
            return { ...record.sample, ageMs: Math.max(0, this.now() - record.sample.sampledAt) };
        const running = this.identityPending.get(input);
        if (running)
            return running;
        const job = (async () => {
            try {
                // Resolve aliases again after expiry so retargeted symlinks cannot retain old checkout data.
                const identity = await this.identity(input), previous = this.aliases.get(input);
                if (previous && previous.checkoutKey !== identity.checkoutKey)
                    this.samples.delete(previous.checkoutKey);
                this.aliases.set(input, identity);
                this.aliases.set(identity.root, identity);
                while (this.aliases.size > this.max * 8)
                    this.aliases.delete(this.aliases.keys().next().value);
                const prior = this.identitySamples.get(identity.checkoutKey);
                const sample = prior && this.now() - prior.sampledAt < ttlMs ? prior : await this.refreshIdentity(identity);
                this.cacheIdentity(input, sample);
                return { ...sample, ageMs: Math.max(0, this.now() - sample.sampledAt) };
            }
            catch (error) {
                const err = error;
                const reason = err.code === 'ETIMEDOUT' || err.killed ? 'Git timed out' : err.code === 'EACCES' || err.code === 'EPERM' ? 'Git access denied' : err.message;
                const nonGit = !!err.stderr?.includes('not a git repository');
                if (nonGit) {
                    const previous = this.aliases.get(input);
                    if (previous)
                        this.samples.delete(previous.checkoutKey);
                    this.aliases.delete(input);
                }
                const sample = cached && !nonGit ? { ...cached, availability: 'stale', reason } : { availability: nonGit ? 'not_applicable' : 'unavailable', identityOnly: true, branchState: nonGit ? 'non-git' : 'unknown', reason, sampledAt: this.now(), ageMs: 0, cwd: input };
                this.cacheIdentity(input, sample);
                return { ...sample, ageMs: Math.max(0, this.now() - sample.sampledAt) };
            }
        })();
        this.identityPending.set(input, job);
        try {
            return await job;
        }
        finally {
            this.identityPending.delete(input);
        }
    }
    fresh(identity, ttlMs = this.ttl) { const prior = this.samples.get(identity.checkoutKey); return prior && !this.invalidated.has(identity.checkoutKey) && this.now() - prior.sampledAt < ttlMs ? { ...prior, ageMs: Math.max(0, this.now() - prior.sampledAt) } : undefined; }
    refresh(identity) {
        const pending = this.refreshing.get(identity.checkoutKey);
        if (pending)
            return pending;
        const job = (async () => {
            const status = parseStatus(await this.run(identity.root, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all']));
            const counts = status.branchState === 'unborn' ? {} : parseNumstat(await this.run(identity.root, ['diff', '--no-ext-diff', '--no-textconv', '--numstat', '-z', 'HEAD', '--']));
            const sample = { availability: 'known', sampledAt: this.now(), ageMs: 0, cwd: identity.root, ...identity, ...status, ...counts };
            this.samples.delete(identity.checkoutKey);
            this.samples.set(identity.checkoutKey, sample);
            this.invalidated.delete(identity.checkoutKey);
            while (this.samples.size > this.max) {
                const oldest = this.samples.keys().next().value;
                this.samples.delete(oldest);
                this.invalidated.delete(oldest);
                for (const [alias, item] of this.aliases)
                    if (item.checkoutKey === oldest)
                        this.aliases.delete(alias);
            }
            return sample;
        })();
        this.refreshing.set(identity.checkoutKey, job);
        void job.finally(() => this.refreshing.delete(identity.checkoutKey)).catch(() => { });
        return job;
    }
    async get(cwd, options = {}) {
        const ttlMs = options.ttlMs ?? this.ttl;
        if (!Number.isFinite(ttlMs) || ttlMs < 0)
            throw new Error('Invalid ttlMs');
        const input = resolve(cwd);
        const running = this.pending.get(input);
        if (running)
            return running;
        let identity = this.aliases.get(input);
        const cached = identity ? this.fresh(identity, ttlMs) : undefined;
        if (cached)
            return cached;
        const job = (async () => {
            try {
                if (!identity || this.invalidated.has(identity.checkoutKey))
                    identity = await this.identity(input);
                this.aliases.set(input, identity);
                this.aliases.set(identity.root, identity);
                while (this.aliases.size > this.max * 8)
                    this.aliases.delete(this.aliases.keys().next().value);
                return this.fresh(identity, ttlMs) ?? await this.refresh(identity);
            }
            catch (error) {
                const err = error;
                const reason = err.code === 'ETIMEDOUT' || err.killed ? 'Git timed out' : err.code === 'EACCES' || err.code === 'EPERM' ? 'Git access denied' : err.message;
                const prior = identity ? this.samples.get(identity.checkoutKey) : undefined;
                if (prior)
                    return { ...prior, availability: 'stale', ageMs: Math.max(0, this.now() - prior.sampledAt), reason };
                const nonGit = !!err.stderr?.includes('not a git repository');
                return { availability: nonGit ? 'not_applicable' : 'unavailable', branchState: nonGit ? 'non-git' : 'unknown', reason, sampledAt: this.now(), ageMs: 0, cwd: input };
            }
        })();
        this.pending.set(input, job);
        try {
            return await job;
        }
        finally {
            this.pending.delete(input);
        }
    }
    invalidate(cwd) { if (cwd === undefined) {
        for (const key of this.samples.keys())
            this.invalidated.add(key);
        this.identitySamples.clear();
        this.identityInputs.clear();
        return;
    } const path = resolve(cwd); const identity = this.aliases.get(path); if (identity) {
        this.invalidated.add(identity.checkoutKey);
        this.identitySamples.delete(identity.checkoutKey);
        for (const [input, record] of this.identityInputs)
            if (record.sample.checkoutKey === identity.checkoutKey)
                this.identityInputs.delete(input);
    } this.identityInputs.delete(path); }
    close() { this.closed = true; for (const controller of this.controllers)
        controller.abort(); this.controllers.clear(); this.aliases.clear(); this.samples.clear(); this.identitySamples.clear(); this.identityInputs.clear(); this.invalidated.clear(); }
}
