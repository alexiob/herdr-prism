import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite, privateDir, restrict } from "../config/safe-file.js";
import { StateStore, identityName } from "./store.js";
export const noteLimit = 1024 * 1024;
const revision = (text) => createHash('sha256').update(text).digest('hex');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
/** Server-local Markdown, outside release checkouts and provider transcripts. */
export class NotesStore {
    serverDir;
    constructor(serverDir) { this.serverDir = serverDir; }
    async directory(key) {
        if (!key || key.length > 8192)
            throw new Error('Invalid note identity');
        // An inspector must not resurrect state after complete removal.
        const root = await lstat(this.serverDir);
        if (!root.isDirectory() || root.isSymbolicLink())
            throw new Error('Unsafe Notes server directory');
        await restrict(this.serverDir, false);
        const parent = join(this.serverDir, 'notes');
        await privateDir(parent);
        const dir = join(parent, identityName(key));
        await privateDir(dir);
        return dir;
    }
    async read(path) {
        let info;
        try {
            info = await lstat(path);
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return { text: '', revision: null, path };
            throw error;
        }
        if (!info.isFile() || info.isSymbolicLink())
            throw new Error('Unsafe Notes file');
        if (info.size > noteLimit)
            throw new Error('Notes exceed 1 MiB limit');
        await restrict(path, false);
        const file = await open(path, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW));
        try {
            const actual = await file.stat();
            if (!actual.isFile() || actual.ino !== info.ino || actual.size > noteLimit)
                throw new Error('Notes changed during read');
            const text = await file.readFile('utf8');
            if (Buffer.byteLength(text) > noteLimit)
                throw new Error('Notes exceed 1 MiB limit');
            return { text, revision: revision(text), path };
        }
        finally {
            await file.close();
        }
    }
    async load(key) { return this.read(join(await this.directory(key), 'note.md')); }
    async save(key, text, expected, recovery) {
        if (Buffer.byteLength(text) > noteLimit)
            throw new Error('Notes exceed 1 MiB limit');
        const dir = await this.directory(key), lock = new StateStore(dir);
        let lease;
        // Serialize cooperating panels. Exact live/uncertain ownership is never reclaimed.
        for (let attempt = 0;; attempt++) {
            try {
                lease = await lock.acquire({ create: false });
                break;
            }
            catch (error) {
                const e = error;
                if (attempt >= 40 || !(/live or uncertain|initialization in progress|recovery in progress|now owns/.test(e.message) || e.code === 'ENOENT' && e.path === join(dir, 'collector.lock')))
                    throw error;
                await sleep(25);
            }
        }
        try {
            const current = await this.read(join(dir, 'note.md'));
            const conflict = !!recovery || current.revision !== expected;
            const target = conflict ? (recovery?.path ?? join(dir, 'recovery-' + randomUUID() + '.md')) : current.path;
            if (recovery && !/^recovery-[a-f0-9-]{36}\.md$/.test(target.slice(dir.length + 1)) || recovery && !target.startsWith(dir + '/') && !target.startsWith(dir + '\\'))
                throw new Error('Invalid recovery draft');
            const previous = conflict ? await this.read(target) : current;
            if (recovery && previous.revision !== recovery.revision)
                throw new Error('Recovery draft changed externally');
            await atomicWrite(target, text, 0o600, async () => {
                if ((await this.read(target)).revision !== previous.revision)
                    throw new Error('Notes changed during save; retry');
                await lstat(this.serverDir);
            });
            return { text, revision: revision(text), path: target, conflict };
        }
        finally {
            await lease.release();
        }
    }
}
