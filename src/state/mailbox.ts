import { readdir, readFile, unlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { ensurePrivateDir } from '../config/index.ts';
import { atomicWrite, restrict } from '../config/safe-file.ts';
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const validId = (name: string) => /^[a-f0-9-]{36}\.json$/.test(name);
async function readBounded(file: string): Promise<any> { const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024)
    throw new Error('Invalid mailbox file'); return JSON.parse(await readFile(file, 'utf8')); }
function authenticated(actual: unknown, expected: string) { if (typeof actual !== 'string')
    return false; const a = Buffer.from(actual), b = Buffer.from(expected); return a.length === b.length && timingSafeEqual(a, b); }
export class MailboxServer {
    private dir: string;
    private token: string;
    private handler: (op: string, payload: any) => Promise<any>;
    private timer?: NodeJS.Timeout;
    private running?: Promise<void>;
    private stopped = false;
    constructor(dir: string, token: string, handler: (op: string, payload: any) => Promise<any>) { this.dir = dir; this.token = token; this.handler = handler; }
    async start() { await ensurePrivateDir(this.dir); await ensurePrivateDir(path.join(this.dir, 'requests')); await ensurePrivateDir(path.join(this.dir, 'responses')); this.timer = setInterval(() => void this.poll(), 100); }
    private async poll() {
        if (this.stopped || this.running)
            return;
        this.running = (async () => {
            const files = await readdir(path.join(this.dir, 'requests'));
            for (const name of files.filter(validId).slice(0, 20)) {
                const file = path.join(this.dir, 'requests', name);
                let result: any;
                try {
                    const request = await readBounded(file);
                    if (!authenticated(request.token, this.token))
                        throw new Error('Mailbox authentication failed');
                    if (typeof request.op !== 'string')
                        throw new Error('Invalid operation');
                    result = { result: await this.handler(request.op, request.payload) };
                }
                catch (e) {
                    result = { error: (e as Error).message };
                }
                await unlink(file).catch(() => { });
                await atomicWrite(path.join(this.dir, 'responses', name), JSON.stringify(result));
            }
            for (const name of (await readdir(path.join(this.dir, 'responses'))).filter(validId)) {
                const file = path.join(this.dir, 'responses', name);
                const info = await lstat(file).catch(() => undefined);
                if (info && Date.now() - info.mtimeMs > 10000)
                    await unlink(file).catch(() => { });
            }
        })().catch(() => { }).finally(() => { this.running = undefined; });
        await this.running;
    }
    async close() { this.stopped = true; clearInterval(this.timer); await this.running; }
}
export class MailboxClient {
    private dir: string;
    private token: string;
    private timeout: number;
    constructor(dir: string, token: string, timeout = 5000) { this.dir = dir; this.token = token; this.timeout = timeout; }
    async request<T = any>(op: string, payload: any = {}): Promise<T> {
        const name = randomUUID() + '.json';
        const requestDir = path.join(this.dir, 'requests');
        const info = await lstat(requestDir);
        if (!info.isDirectory() || info.isSymbolicLink())
            throw new Error('Owning collector mailbox unavailable');
        await restrict(requestDir, false);
        const request = path.join(requestDir, name), response = path.join(this.dir, 'responses', name);
        await atomicWrite(request, JSON.stringify({ token: this.token, op, payload }));
        const deadline = Date.now() + this.timeout;
        try {
            while (Date.now() < deadline) {
                try {
                    const result = await readBounded(response);
                    if (result.error)
                        throw new Error(result.error);
                    return result.result as T;
                }
                catch (e) {
                    if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                        throw e;
                }
                await delay(25);
            }
            throw new Error(`${op}: collector unavailable or response timed out`);
        }
        finally {
            await unlink(request).catch(() => { });
            await unlink(response).catch(() => { });
        }
    }
}
