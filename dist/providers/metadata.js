import { open } from 'node:fs/promises';
import { basename } from 'node:path';
import { filePath, identity, object, time } from "./common.js";
import { CodexAdapter } from "./codex.js";
import { ClaudeAdapter } from "./claude.js";
import { PiAdapter } from "./pi.js";
/** Discovery reads one bounded header plus Pi's bounded explicit-fact tail. No message adapter consumes bodies. */
export async function metadata(provider, path, maxRecord) {
    const builder = provider === 'codex' ? new CodexAdapter(provider, path, 1) : provider === 'claude' ? new ClaudeAdapter(path, 1) : new PiAdapter(provider, path, 1);
    const file = await open(path, 'r');
    try {
        const stat = await file.stat();
        if (!stat.isFile())
            throw new Error('transcript is not a regular file');
        // A header larger than the record budget is incompatible; never read the entire file to search for identity.
        const chunks = [];
        let size = 0;
        let end = -1;
        while (size < Math.min(stat.size, maxRecord + 1) && end < 0) {
            const chunk = Buffer.alloc(Math.min(4096, stat.size - size, maxRecord + 1 - size));
            const result = await file.read(chunk, 0, chunk.length, size);
            if (!result.bytesRead)
                break;
            const bytes = chunk.subarray(0, result.bytesRead);
            const newline = bytes.indexOf(10);
            if (newline >= 0)
                end = size + newline;
            chunks.push(bytes);
            size += bytes.length;
        }
        const prefix = Buffer.concat(chunks, size);
        let first = {};
        if (end < 0) {
            builder.diagnostic('session header incomplete or exceeds record byte limit');
        }
        else {
            try {
                first = object(JSON.parse(prefix.subarray(0, end).toString('utf8')));
            }
            catch {
                builder.diagnostic('malformed session header');
            }
        }
        if (builder instanceof CodexAdapter) {
            if (first.type === 'session_meta')
                builder.consume({ record: first, offset: 0 });
            else
                builder.diagnostic('session metadata header unavailable');
        }
        else if (builder instanceof ClaudeAdapter) {
            const e = builder.evidence;
            e.id = e.id || identity(first.sessionId) || basename(path, '.jsonl');
            e.cwd = filePath(first.cwd);
            e.startedAt = time(first.timestamp);
            if (identity(first.parentAgentId)) {
                e.parentId = first.parentAgentId;
                e.parentProvider = 'claude';
                e.parentSource = builder.source(0);
            }
        }
        else {
            if (first.type === 'session')
                builder.consume({ record: first, offset: 0 });
            else
                builder.diagnostic('Pi session header unavailable');
            if (builder.supported) {
                // Companion facts are plain metadata. Read only a bounded first/last window, and never parse message records.
                const bound = Math.min(maxRecord, 65536);
                const head = Buffer.alloc(Math.min(stat.size, bound));
                if (head.length)
                    await file.read(head, 0, head.length, 0);
                const tailOffset = Math.max(head.length, stat.size - bound);
                const tail = Buffer.alloc(Math.max(0, stat.size - tailOffset));
                if (tail.length)
                    await file.read(tail, 0, tail.length, tailOffset);
                const scan = (buffer, base, partial) => { let start = partial ? buffer.indexOf(10) + 1 : 0; if (partial && start === 0)
                    return; while (start < buffer.length) {
                    const next = buffer.indexOf(10, start);
                    if (next < 0)
                        break;
                    const row = buffer.subarray(start, next).toString('utf8');
                    if (/"customType"\s*:\s*"iob\.herdr-prism"/.test(row)) {
                        try {
                            const record = object(JSON.parse(row));
                            if (record.type === 'custom' && ['delegation', 'goal', 'state'].includes(object(record.data).kind))
                                builder.consume({ record, offset: base + start });
                        }
                        catch {
                            builder.diagnostic('malformed explicit companion metadata');
                        }
                    }
                    start = next + 1;
                } };
                scan(head, 0, false);
                scan(tail, tailOffset, tailOffset > head.length);
            }
        }
        builder.evidence.messages = [];
        builder.messages.clear();
        builder.tools.clear();
        builder.usage.clear();
        builder.evidence.reason = 'metadata only; transcript body not loaded';
        return builder;
    }
    finally {
        await file.close();
    }
}
