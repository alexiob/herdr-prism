import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, unlink, open, mkdir, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { ensurePrivateDir } from "../config/index.js";
import { atomicWrite, restrict } from "../config/safe-file.js";
export function identityName(value) { return createHash('sha256').update(value).digest('hex'); }
export function processIsAbsent(pid) {
    if (!Number.isSafeInteger(pid) || pid < 1)
        return false;
    try {
        process.kill(pid, 0);
        return false;
    }
    catch (e) {
        return e.code === 'ESRCH';
    }
}
export class StateStore {
    dir;
    constructor(dir) { this.dir = dir; }
    async init() { await ensurePrivateDir(this.dir); }
    file(name) {
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(name))
            throw new Error('Invalid state name');
        return path.join(this.dir, name + '.json');
    }
    async read(name) {
        const file = this.file(name);
        try {
            const stat = await lstat(file);
            if (stat.isSymbolicLink() || !stat.isFile())
                throw new Error('Unsafe state file');
            if (stat.size > 1024 * 1024)
                throw new Error('State size limit exceeded');
            return JSON.parse(await readFile(file, 'utf8'));
        }
        catch (e) {
            if (e.code === 'ENOENT')
                return;
            throw e;
        }
    }
    async write(name, value) {
        const file = this.file(name);
        await this.init();
        const content = JSON.stringify(value);
        if (Buffer.byteLength(content) > 1024 * 1024)
            throw new Error('State size limit exceeded');
        await atomicWrite(file, content + '\n');
    }
    async remove(name) {
        await unlink(this.file(name)).catch(e => {
            if (e.code !== 'ENOENT')
                throw e;
        });
    }
    async acquire(options = {}) {
        if (options.create === false) {
            const info = await lstat(this.dir);
            if (!info.isDirectory() || info.isSymbolicLink())
                throw new Error('Owned state directory unavailable');
            await restrict(this.dir, false);
        }
        else
            await this.init();
        const filename = path.join(this.dir, (options.name ?? 'collector') + '.lock');
        let handle;
        try {
            handle = await open(filename, 'wx', 0o600);
        }
        catch (e) {
            if (e.code !== 'EEXIST')
                throw e;
            const info = await lstat(filename);
            if (!info.isFile() || info.isSymbolicLink() || info.size > 4096)
                throw new Error('Unsafe collector lease');
            const text = await readFile(filename, 'utf8');
            // Exclusive creation precedes the owner-record write. An empty file
            // is uncertain ownership, never permission to reclaim a lease.
            if (text.length === 0)
                throw new Error('Collector lease initialization in progress; owner is uncertain');
            const old = JSON.parse(text);
            if (typeof old.token !== 'string' || old.token.length > 128 || !processIsAbsent(old.pid))
                throw new Error('Collector owner is live or uncertain; open its existing panel or use doctor');
            // Serialize recovery for this exact lease generation. A reused live PID is
            // uncertain and is never killed or reclaimed. A concurrent new owner wins.
            const recovery = path.join(this.dir, '.recover-' + identityName(old.token));
            try {
                await mkdir(recovery, { mode: 0o700 });
            }
            catch {
                throw new Error('Collector lease recovery in progress; retry');
            }
            try {
                const current = JSON.parse(await readFile(filename, 'utf8'));
                if (current.token !== old.token || current.pid !== old.pid)
                    throw new Error('Collector owner changed during recovery');
                await unlink(filename);
                try {
                    handle = await open(filename, 'wx', 0o600);
                }
                catch {
                    throw new Error('Another collector now owns this server');
                }
            }
            finally {
                await rmdir(recovery).catch(() => { });
            }
        }
        const token = randomUUID();
        await handle.writeFile(JSON.stringify({ pid: process.pid, token, startedAt: Date.now() }));
        return { token, release: async () => {
                await handle.close();
                let current;
                try {
                    current = JSON.parse(await readFile(filename, 'utf8'));
                }
                catch {
                    return;
                }
                if (current.token === token)
                    await unlink(filename);
            } };
    }
}
