import { stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { outsideFences } from "./text.js";
const windows = (p) => /^(?:[A-Za-z]:[\\/]|\\\\)/.test(p);
function target(raw, cwd) {
    let value = raw.trim().replace(/^<|>$/g, '');
    if (!value || /[\x00-\x08\x0b-\x1f\x7f]|\x1b/.test(value) || value.length > 4096)
        return;
    if (/^https?:\/\//i.test(value)) {
        try {
            const url = new URL(value);
            if (url.username || url.password)
                return;
            return { target: url.href, kind: 'url' };
        }
        catch {
            return;
        }
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(value) && !windows(value))
        return;
    if (/[|;&$]/.test(value))
        return;
    let line;
    const suffix = /(?::(\d+)(?::\d+)?|#L(\d+))$/.exec(value);
    if (suffix) {
        line = Number(suffix[1] || suffix[2]);
        if (!Number.isSafeInteger(line) || line < 1)
            return;
        value = value.slice(0, suffix.index);
    }
    const api = windows(value) || cwd !== undefined && windows(cwd) ? path.win32 : path;
    if (!api.isAbsolute(value) && !cwd)
        return;
    return { target: api.isAbsolute(value) ? api.normalize(value) : api.resolve(cwd, value), line, kind: 'file' };
}
/** Streaming metadata only: retained references do not depend on the message window. */
export class ReferenceList {
    refs = new Map();
    edited = new Set();
    seen = new Map();
    cwd;
    limited = false;
    revision = 0;
    constructor(cwd) { this.cwd = cwd; }
    edit(file) { if (this.edited.has(file))
        return; this.edited.add(file); this.revision++; if (this.edited.size > 2000) {
        this.edited.delete(this.edited.values().next().value);
        this.limited = true;
    } for (const ref of this.refs.values())
        if (ref.target === file) {
            ref.edited = true;
            for (const source of ref.sources)
                source.edited = true;
        } }
    add(normalized, source, edited = false) {
        const key = normalized.target + '\0' + (normalized.line ?? ''), earlier = this.refs.get(key);
        const sources = earlier?.sources ?? [];
        const duplicate = sources.some(s => s.messageId === source.messageId);
        const isEdited = edited || earlier?.edited === true || this.edited.has(normalized.target);
        if (!duplicate || isEdited !== earlier?.edited)
            this.revision++;
        if (!duplicate)
            sources.push({ ...source, edited: isEdited });
        if (sources.length > 100) {
            sources.splice(1, sources.length - 100);
            this.limited = true;
        }
        const previousTime = earlier?.sources.find(s => s.messageId === earlier.messageId)?.timestamp;
        const newer = !earlier || !duplicate && !(source.timestamp !== undefined && previousTime !== undefined && source.timestamp < previousTime);
        if (newer) {
            this.refs.delete(key);
            this.refs.set(key, { id: createHash('sha256').update(key).digest('hex').slice(0, 24), ...normalized, messageId: source.messageId, source: source.source, edited: isEdited, sources });
        }
        else if (earlier) {
            earlier.edited = isEdited;
            earlier.sources = sources;
        }
        if (this.refs.size > 2000) {
            this.refs.delete(this.refs.keys().next().value);
            this.limited = true;
        }
    }
    updateEdits(files, cwd) { for (const file of files) {
        const normalized = target(file, cwd || this.cwd);
        if (normalized)
            this.edit(normalized.target);
    } }
    update(messages) {
        for (const message of messages)
            for (const tool of message.tools ?? [])
                if (tool.status === 'done')
                    this.updateEdits(tool.editedPaths ?? [], message.cwd);
        for (const message of messages) {
            if (message.kind === 'inter-agent' || message.role !== 'assistant' || message.complete !== true)
                continue;
            // Every supported reference contains a slash, backtick, or Markdown opening bracket.
            // Check before Unicode/prose scans; sanitization may join delimiters but cannot create these characters.
            const body = message.text.slice(0, 1024 * 1024);
            if (!body.includes('/') && !body.includes('`') && !body.includes('['))
                continue;
            const signature = createHash('sha256').update(JSON.stringify([body, message.cwd ?? this.cwd, message.source, message.timestamp])).digest('hex');
            if (this.seen.get(message.id) === signature)
                continue;
            this.seen.delete(message.id);
            this.seen.set(message.id, signature);
            while (this.seen.size > 256)
                this.seen.delete(this.seen.keys().next().value);
            const text = outsideFences(body);
            const candidates = [];
            for (const m of text.matchAll(/\[[^\]\n]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+"[^"]*")?\s*\)/gu))
                candidates.push(m[1]);
            const withoutLinks = text.replace(/\[[^\]\n]*\]\([^\n]*?\)/gu, '');
            for (const m of withoutLinks.matchAll(/`([^`\n]+)`/gu))
                if (/[\\/]|\.[\p{L}\d]{1,12}(?::\d+|#L\d+)?$/u.test(m[1]))
                    candidates.push(m[1]);
            for (const m of withoutLinks.replace(/`[^`]*`/g, '').matchAll(/https?:\/\/[^\s<>"`]+/gu))
                candidates.push(m[0].replace(/[.,;!?]+$/, ''));
            const prose = withoutLinks.replace(/`[^`]*`|https?:\/\/[^\s<>"`]+/gu, '');
            for (const m of prose.matchAll(/(?:^|[\s([])((?:\.\.?\/|\/)?[\p{L}\p{N}_@.-]+(?:\/[\p{L}\p{N}_@.-]+)+(?::\d+(?::\d+)?|#L\d+)?)/gu))
                candidates.push(m[1].replace(/[.,;!?]+$/, ''));
            if (candidates.length > 500 || message.text.length > body.length)
                this.limited = true;
            for (const raw of candidates.slice(0, 500)) {
                const normalized = target(raw, message.cwd || this.cwd);
                if (normalized)
                    this.add(normalized, { messageId: message.id, source: message.source, timestamp: message.timestamp });
            }
        }
    }
    merge(other) {
        this.limited ||= other.limited;
        for (const file of other.edited)
            this.edit(file);
        const records = [...other.refs.values()].flatMap(ref => ref.sources.map(source => ({ ref, source })));
        records.sort((a, b) => (a.source.timestamp ?? 0) - (b.source.timestamp ?? 0) || Number(a.source.source?.split('#').at(-1) || 0) - Number(b.source.source?.split('#').at(-1) || 0));
        for (const { ref, source } of records)
            this.add(ref, source, ref.edited);
    }
    async snapshot(isCurrent = () => true) {
        if (!isCurrent())
            return;
        const result = structuredClone([...this.refs.values()].reverse());
        let next = 0;
        const worker = async () => { while (next < result.length && isCurrent()) {
            const ref = result[next++];
            if (ref.kind === 'url')
                continue;
            try {
                const info = await stat(ref.target);
                ref.exists = true;
                if (info.isDirectory())
                    ref.kind = 'directory';
            }
            catch {
                ref.exists = false;
            }
        } };
        await Promise.all(Array.from({ length: Math.min(4, result.length) }, worker));
        return isCurrent() ? result : undefined;
    }
}
/** Local stat only; no URL requests. Results group naturally under the latest source message. */
export async function extractRefs(messages, cwd, isCurrent = () => true) {
    if (!isCurrent())
        return [];
    const list = new ReferenceList(cwd);
    list.update(messages);
    return await list.snapshot(isCurrent) ?? [];
}
