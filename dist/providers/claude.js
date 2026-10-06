import { basename, dirname } from 'node:path';
import { EvidenceBuilder, array, clean, filePath, identity, number, object, visible } from "./common.js";
export class ClaudeAdapter extends EvidenceBuilder {
    directoryParent;
    constructor(path, max) {
        super('claude', path, max);
        if (basename(path).startsWith('agent-') && basename(dirname(path)) === 'subagents') {
            this.evidence.id = basename(path).slice(6, -6);
            this.directoryParent = basename(dirname(dirname(path)));
            this.evidence.parentId = this.directoryParent;
            this.evidence.parentProvider = 'claude';
            this.evidence.parentSource = `directory:${dirname(path)}`;
        }
    }
    consume({ record: r, offset }) {
        const e = this.evidence;
        const m = object(r.message);
        const source = this.source(offset);
        const timestamp = this.activity(r.timestamp);
        e.id = e.id || identity(r.sessionId) || '';
        e.cwd = filePath(r.cwd) || e.cwd;
        e.startedAt = e.startedAt ?? timestamp;
        if (identity(r.parentAgentId)) {
            e.parentId = r.parentAgentId;
            e.parentProvider = 'claude';
            e.parentSource = source;
        }
        if (r.type === 'summary') {
            e.title = clean(r.summary, 300);
            return;
        }
        if (!['user', 'assistant'].includes(r.type) || !['user', 'assistant'].includes(m.role))
            return;
        const id = identity(m.id) || identity(r.uuid) || `${e.id}:${offset}`;
        const blocks = array(m.content);
        if (m.role === 'assistant') {
            e.model = clean(m.model, 200) || e.model;
            const tools = [];
            for (const b of blocks) {
                if (b.type === 'tool_use' && identity(b.id) && identity(b.name)) {
                    this.call(b.id, b.name, b.input, timestamp);
                    tools.push(this.tools.get(b.id));
                }
            }
            const body = visible(m.content);
            const previous = this.messages.get(id);
            let merged = body;
            if (previous?.text) {
                if (!body || previous.text.startsWith(body))
                    merged = previous.text;
                else if (!body.startsWith(previous.text) && !previous.text.split('\n').includes(body))
                    merged = previous.text + '\n' + body;
            }
            const linked = new Map((previous?.tools ?? []).map(tool => [tool.id, tool]));
            for (const tool of tools)
                linked.set(tool.id, tool);
            if (merged || linked.size)
                this.message({ id, role: 'assistant', text: merged.slice(0, 65536), timestamp, cwd: e.cwd, source, complete: m.stop_reason !== null, tools: [...linked.values()] });
            const u = object(m.usage);
            if (Object.keys(u).length)
                this.usageRecord({ id: `request:${identity(r.requestId) || id}`, sessionId: e.id, requestId: identity(r.requestId) || id, model: e.model, timestamp, kind: 'delta', input: number(u.input_tokens), output: number(u.output_tokens), cacheRead: number(u.cache_read_input_tokens), cacheWrite: number(u.cache_creation_input_tokens), cacheSemantics: 'separate', source });
        }
        else {
            const body = visible(m.content);
            if (body)
                this.message({ id, role: 'user', text: body, timestamp, cwd: e.cwd, source, complete: true });
            for (const b of blocks)
                if (b.type === 'tool_result' && identity(b.tool_use_id)) {
                    const call = this.calls.get(b.tool_use_id);
                    this.result(b.tool_use_id, b.content, Boolean(b.is_error), source, timestamp);
                    if (!b.is_error && call && ['Agent', 'Task'].includes(call.name)) {
                        const child = identity(object(r.toolUseResult).agentId);
                        if (child)
                            this.children.push({ id: child, task: clean(call.args.prompt), source });
                    }
                }
        }
    }
}
