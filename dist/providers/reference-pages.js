import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ReferenceList, compareReferenceCursors, referenceMessageHash } from "../content/refs.js";
import { CodexAdapter } from "./codex.js";
import { ClaudeAdapter } from "./claude.js";
import { PiAdapter } from "./pi.js";
import { JsonlTail } from "./tail.js";
const sourceIdentity = (source) => source.messageId + '\0' + source.cursor?.hash;
const compareEntry = (a, keyA, b, keyB) => compareReferenceCursors(a, b) || (keyA < keyB ? -1 : keyA > keyB ? 1 : 0);
const adapterFor = (provider, path) => provider === 'codex' ? new CodexAdapter(provider, path, 2) : provider === 'claude' ? new ClaudeAdapter(path, 2) : new PiAdapter(provider, path, 2);
function check(current) { if (!current()) {
    const error = new Error('Reference read cancelled');
    error.name = 'AbortError';
    throw error;
} }
function historyChanged() { throw new Error('Reference history changed; reload the reference pages'); }
export function referenceCursor(provider, sessionId, path, fileId, file, message) {
    const prefix = path + '#';
    if (!message.source?.startsWith(prefix))
        return;
    const offset = Number(message.source.slice(prefix.length));
    if (!Number.isSafeInteger(offset) || offset < 0 || !fileId)
        return;
    return { provider, sessionId, path, fileId, file, offset, hash: referenceMessageHash(message), timestamp: message.timestamp };
}
async function fileStates(files, current) {
    const states = [];
    for (const path of files) {
        check(current);
        try {
            const info = await stat(path);
            check(current);
            states.push({ path, stamp: info.isFile() ? `${info.dev}:${info.ino}:${info.birthtimeMs}:${info.size}:${info.mtimeMs}:${info.ctimeMs}` : undefined });
        }
        catch (error) {
            if (error.name === 'AbortError')
                throw error;
            states.push({ path });
        }
    }
    return states;
}
const versionOf = (states) => createHash('sha256').update(JSON.stringify(states)).digest('hex');
/** Explicit history requests reparse only metadata and bounded candidate windows.
 * A second scan proves each candidate's latest occurrence. Older windows refill
 * candidates displaced by later mentions, without a lifetime set of target IDs.
 */
export async function pageReferenceHistory(provider, sessionId, files, maxRecord, options, current, targetId) {
    try {
        check(current);
        const states = await fileStates(files, current), version = versionOf(states);
        if (!states.some(file => file.stamp))
            return;
        if (options.cursor && options.cursor.version !== version)
            historyChanged();
        if (options.cursor && options.cursor.targetId !== targetId)
            throw new Error('Reference cursor scope does not match this target');
        if (options.cursor && (options.cursor.before.provider !== provider || options.cursor.before.sessionId !== sessionId || !files.includes(options.cursor.before.path)))
            historyChanged();
        const count = Math.max(1, Math.min(options.limit ?? 50, 200)), wanted = count + 1, excluded = new Set((options.excludeIds ?? []).slice(0, 4000));
        let boundary = options.cursor ? { before: options.cursor.before, key: options.cursor.key } : undefined, partial = states.some(file => !file.stamp);
        const result = new Map();
        const keyOf = (ref, source) => targetId ? sourceIdentity(source) : ref.id;
        const scan = async (options) => {
            let active;
            const list = new ReferenceList(undefined, { ...options, cursor: message => active ? referenceCursor(provider, sessionId, active.path, active.fileId, active.file, message) : undefined });
            for (const [file, state] of states.entries()) {
                check(current);
                if (!state.stamp)
                    continue;
                const adapter = adapterFor(provider, state.path), tail = new JsonlTail(maxRecord);
                adapter.onEditedPaths = (paths, cwd) => { if (adapter.evidence.id === sessionId)
                    list.updateEdits(paths, cwd); };
                try {
                    await tail.read(state.path, record => { active = { path: state.path, fileId: tail.fileId, file }; adapter.consume(record); if (adapter.evidence.id === sessionId)
                        list.update([...adapter.messages.values()]); }, () => { }, () => { partial = true; }, current);
                    if (adapter.evidence.id !== sessionId || adapter.evidence.diagnostics?.some(d => !d.startsWith('retained record window limit reached')))
                        partial = true;
                }
                catch (error) {
                    if (error.name === 'AbortError')
                        throw error;
                    partial = true;
                }
            }
            partial ||= list.inputLimited;
            return list;
        };
        while (result.size < wanted) {
            check(current);
            const candidates = new Map();
            const room = wanted - result.size;
            await scan({ retain: 0, onMention: (ref, source) => {
                    if (targetId && ref.id !== targetId || !source.cursor)
                        return;
                    const key = keyOf(ref, source);
                    if (excluded.has(key) || result.has(key) || boundary && compareEntry(source.cursor, key, boundary.before, boundary.key) >= 0)
                        return;
                    const previous = candidates.get(key);
                    if (previous && compareReferenceCursors(source.cursor, previous.source.cursor) <= 0)
                        return;
                    candidates.set(key, { ref, source: source });
                    if (candidates.size > room) {
                        let oldest;
                        for (const [id, candidate] of candidates)
                            if (oldest === undefined || compareEntry(candidate.source.cursor, id, candidates.get(oldest).source.cursor, oldest) < 0)
                                oldest = id;
                        candidates.delete(oldest);
                    }
                } });
            if (!candidates.size)
                break;
            const latest = new Map(), ids = new Set([...candidates.values()].map(candidate => candidate.ref.id)), targets = new Set([...candidates.values()].map(candidate => candidate.ref.target));
            const list = await scan({ retain: room, accept: ref => ids.has(ref.id), acceptEdit: file => targets.has(file), onMention: (ref, source) => {
                    if (targetId && ref.id !== targetId || !source.cursor)
                        return;
                    const key = keyOf(ref, source);
                    if (!candidates.has(key))
                        return;
                    const previous = latest.get(key);
                    if (!previous || compareReferenceCursors(source.cursor, previous.source.cursor) > 0)
                        latest.set(key, { ref, source: source });
                } });
            const refs = await list.snapshot(current);
            check(current);
            const byId = new Map(refs.map(ref => [ref.id, ref]));
            for (const [key, candidate] of latest)
                if (!boundary || compareEntry(candidate.source.cursor, key, boundary.before, boundary.key) < 0) {
                    const ref = byId.get(candidate.ref.id);
                    if (ref)
                        result.set(key, { ref: { ...ref, sources: ref.sources.length > 2 ? [ref.sources[0], ref.sources.at(-1)] : ref.sources }, source: { ...candidate.source, edited: ref.edited } });
                }
            let oldest;
            for (const [key, candidate] of candidates)
                if (!oldest || compareEntry(candidate.source.cursor, key, oldest.before, oldest.key) < 0)
                    oldest = { before: candidate.source.cursor, key };
            boundary = oldest;
        }
        check(current);
        if (versionOf(await fileStates(files, current)) !== version)
            historyChanged();
        const sorted = [...result.entries()].sort(([keyA, a], [keyB, b]) => compareEntry(b.source.cursor, keyB, a.source.cursor, keyA)), page = sorted.slice(0, count), last = page.at(-1), common = { cursor: last ? { version, before: last[1].source.cursor, key: last[0], targetId } : undefined, hasMore: sorted.length > count, partial, observedAt: Date.now() };
        return targetId ? { ...common, sources: page.map(([, item]) => item.source) } : { ...common, refs: page.map(([, item]) => item.ref) };
    }
    catch (error) {
        if (error.name === 'AbortError')
            return;
        throw error;
    }
}
/** Reconstruct the exact recorded visible revision, never the newest same-ID body. */
export async function readReferenceMessage(cursor, maxRecord, current) {
    try {
        check(current);
        if (!Number.isSafeInteger(cursor.offset) || cursor.offset < 0 || !/^[a-f0-9]{64}$/.test(cursor.hash))
            return;
        const info = await stat(cursor.path);
        check(current);
        if (!info.isFile() || `${info.dev}:${info.ino}:${info.birthtimeMs}` !== cursor.fileId || cursor.offset >= info.size)
            return;
        const adapter = adapterFor(cursor.provider, cursor.path), tail = new JsonlTail(maxRecord);
        let selected, stopped = false;
        try {
            await tail.read(cursor.path, record => { adapter.consume(record); if (record.offset >= cursor.offset) {
                stopped = true;
                if (record.offset === cursor.offset && adapter.evidence.id === cursor.sessionId && tail.fileId === cursor.fileId)
                    selected = [...adapter.messages.values()].find(message => message.source === cursor.path + '#' + cursor.offset && message.complete === true && referenceMessageHash(message) === cursor.hash);
            } }, () => { }, () => { }, () => current() && !stopped);
        }
        catch (error) {
            if (error.name !== 'AbortError')
                throw error;
        }
        return current() && selected ? structuredClone(selected) : undefined;
    }
    catch (error) {
        if (error.name === 'AbortError' || error.code === 'ENOENT')
            return;
        throw error;
    }
}
