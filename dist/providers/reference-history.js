import { ReferenceList } from "../content/refs.js";
import { CodexAdapter } from "./codex.js";
import { ClaudeAdapter } from "./claude.js";
import { PiAdapter } from "./pi.js";
import { JsonlTail } from "./tail.js";
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
    cached;
    constructor(provider, maxRecord) { this.provider = provider; this.maxRecord = maxRecord; }
    reader(path) { const list = new ReferenceList(), adapter = this.provider === 'codex' ? new CodexAdapter(this.provider, path, 2) : this.provider === 'claude' ? new ClaudeAdapter(path, 2) : new PiAdapter(this.provider, path, 2); adapter.onEditedPaths = (paths, cwd) => list.updateEdits(paths, cwd); return { tail: new JsonlTail(this.maxRecord), adapter, list }; }
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
                let reader = this.readers.get(file);
                if (!reader) {
                    reader = this.reader(file);
                    this.readers.set(file, reader);
                }
                try {
                    await reader.tail.read(file, record => { const adapter = reader.adapter; if (adapter instanceof CodexAdapter)
                        adapter.consume(record);
                    else if (adapter instanceof ClaudeAdapter)
                        adapter.consume(record);
                    else
                        adapter.consume(record); reader.list.update([...adapter.messages.values()]); }, () => { const fresh = this.reader(file); reader.adapter = fresh.adapter; reader.list = fresh.list; }, () => { reader.list.limited = true; }, current);
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
