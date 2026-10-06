import { ReferenceList } from "../content/refs.js";
import { CodexAdapter } from "./codex.js";
import { ClaudeAdapter } from "./claude.js";
import { PiAdapter } from "./pi.js";
import { JsonlTail } from "./tail.js";
import { referenceCursor } from "./reference-pages.js";
function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value))
        freeze(child);
    Object.freeze(value);
} return value; }
/** One selected session's incremental readers; no historical message bodies persist. */
export class ReferenceHistory {
    readers = new Map();
    provider;
    maxRecord;
    closed = false;
    sessionId;
    cached;
    constructor(provider, maxRecord, sessionId) { this.provider = provider; this.maxRecord = maxRecord; this.sessionId = sessionId; }
    reader(path, file) { const tail = new JsonlTail(this.maxRecord), adapter = this.provider === 'codex' ? new CodexAdapter(this.provider, path, 2) : this.provider === 'claude' ? new ClaudeAdapter(path, 2) : new PiAdapter(this.provider, path, 2), list = new ReferenceList(undefined, { cursor: message => referenceCursor(this.provider, adapter.evidence.id, path, tail.fileId, file, message) }); adapter.onEditedPaths = (paths, cwd) => list.updateEdits(paths, cwd); return { tail, adapter, list, file }; }
    async read(files, isCurrent) {
        const current = () => !this.closed && isCurrent();
        if (!current())
            return;
        const selected = files.slice(-8), allowed = new Set(selected);
        for (const file of this.readers.keys())
            if (!allowed.has(file))
                this.readers.delete(file);
        const combined = new ReferenceList();
        combined.limited = selected.length < files.length;
        let available = false;
        try {
            for (const file of selected) {
                if (!current())
                    return;
                const order = files.indexOf(file);
                let reader = this.readers.get(file);
                if (!reader || reader.file !== order) {
                    reader = this.reader(file, order);
                    this.readers.set(file, reader);
                }
                try {
                    await reader.tail.read(file, record => { reader.adapter.consume(record); reader.list.update([...reader.adapter.messages.values()]); }, () => { const fresh = this.reader(file, order); reader.adapter = fresh.adapter; reader.list = new ReferenceList(undefined, { cursor: message => referenceCursor(this.provider, reader.adapter.evidence.id, file, reader.tail.fileId, order, message) }); reader.adapter.onEditedPaths = (paths, cwd) => reader.list.updateEdits(paths, cwd); }, () => { reader.list.limited = true; }, current);
                    if (this.sessionId && reader.adapter.evidence.id !== this.sessionId)
                        throw new Error('Reference session identity changed');
                    if (reader.adapter.evidence.diagnostics?.some(d => !d.startsWith('retained record window limit reached')))
                        reader.list.limited = true;
                    combined.limited ||= reader.list.limited;
                    available = true;
                }
                catch (error) {
                    if (error.name === 'AbortError')
                        throw error;
                    this.readers.delete(file);
                    combined.limited = true;
                }
            }
            if (!available || !current())
                return;
            const signature = JSON.stringify([combined.limited, ...selected.map(file => { const reader = this.readers.get(file); return [file, reader?.tail.fileId, reader?.tail.generation, reader?.list.revision, reader?.list.limited]; })]);
            if (this.cached?.signature === signature && Date.now() - this.cached.state.observedAt < 5000)
                return this.cached.state;
            for (const file of selected) {
                const reader = this.readers.get(file);
                if (reader)
                    combined.merge(reader.list);
            }
            const observedAt = Date.now(), refs = await combined.snapshot(current);
            if (!refs)
                return;
            const state = freeze({ refs, limited: combined.limited, observedAt });
            this.cached = { signature, state };
            return state;
        }
        catch (error) {
            if (error.name === 'AbortError')
                return;
            throw error;
        }
        finally {
            if (!current()) {
                this.readers.clear();
                this.cached = undefined;
            }
        }
    }
    close() { this.closed = true; this.readers.clear(); this.cached = undefined; }
}
