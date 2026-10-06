import { EvidenceBuilder, clean, filePath, identity, number, object, time, visible, array } from "./common.js";
export class PiAdapter extends EvidenceBuilder {
    forkPath;
    consume({ record: r, offset }) {
        const e = this.evidence;
        const source = this.source(offset);
        const timestamp = this.activity(r.timestamp);
        if (r.type === 'session') {
            e.id = identity(r.id) || '';
            e.cwd = filePath(r.cwd);
            e.startedAt = timestamp;
            this.forkPath = filePath(r.parentSession);
            if (this.forkPath)
                e.diagnostics.push('ordinary Pi fork parent recorded; delegation not proven');
            if (![undefined, 1, 2, 3].includes(r.version)) {
                this.supported = false;
                this.diagnostic('unsupported Pi session schema version');
            }
            return;
        }
        if (!this.supported)
            return;
        if (r.type === 'session_info') {
            e.title = clean(r.name, 300);
            return;
        }
        if (r.type === 'model_change') {
            e.model = clean(r.modelId, 200) || e.model;
            return;
        }
        if (r.type === 'custom_message') {
            if (r.display === true)
                this.message({ id: identity(r.id) || source, role: 'user', text: visible(r.content), timestamp, cwd: e.cwd, source, complete: true });
            return;
        }
        if (['usage', 'compaction', 'branch_summary'].includes(r.type) && r.usage) {
            const u = object(r.usage);
            this.usageRecord({ id: `entry:${identity(r.id) || source}`, sessionId: e.id, model: clean(r.model, 200) || e.model, timestamp, kind: 'delta', input: number(u.input), output: number(u.output), cacheRead: number(u.cacheRead), cacheWrite: number(u.cacheWrite), reasoning: number(u.reasoning), total: number(u.totalTokens), cacheSemantics: 'separate', source });
            return;
        }
        if (r.type === 'custom' && r.customType === 'iob.herdr-prism') {
            const d = object(r.data);
            if (d.version !== 1) {
                this.diagnostic('unsupported companion record version');
                return;
            }
            if (d.kind === 'delegation' || d.kind === 'state' && ['running', 'idle', 'waiting', 'done', 'error', 'interrupted'].includes(d.state)) {
                const p = object(d.parent);
                if (identity(p.id) && identity(p.provider)) {
                    e.parentId = p.id;
                    e.parentProvider = p.provider;
                    e.parentSource = source;
                    e.task = clean(d.task, 8192);
                }
            }
            if (d.kind === 'goal' && identity(d.id) && clean(d.objective)) {
                e.goals = e.goals.filter(g => g.id !== d.id);
                e.goals.push({ id: d.id, objective: clean(d.objective, 8192), status: clean(d.status, 100) || undefined, timestamp, source });
                e.goals = e.goals.slice(-this.max);
            }
            if (d.kind === 'state' && ['running', 'idle', 'waiting', 'done', 'error', 'interrupted'].includes(d.state))
                e.state = d.state;
            if (d.kind === 'usage') {
                const u = object(d.usage);
                if (['delta', 'cumulative'].includes(d.counterKind))
                    this.usageRecord({ id: identity(r.id) || source, sessionId: e.id, model: e.model, turnId: identity(d.turnId), timestamp, kind: d.counterKind, input: number(u.input), output: number(u.output), cacheRead: number(u.cacheRead), cacheWrite: number(u.cacheWrite), total: number(u.total), cacheSemantics: ['subset', 'separate'].includes(d.cacheSemantics) ? d.cacheSemantics : 'unknown', generationMs: number(d.generationMs), turnMs: number(d.turnMs), source });
            }
            return;
        }
        if (r.type !== 'message')
            return;
        const m = object(r.message);
        const id = identity(r.id) || `${e.id}:${offset}`;
        if (['user', 'assistant'].includes(m.role)) {
            const body = visible(m.content);
            const tools = [];
            if (m.role === 'assistant')
                for (const b of array(m.content))
                    if (b.type === 'toolCall' && identity(b.id) && identity(b.name)) {
                        this.call(b.id, b.name, b.arguments, timestamp);
                        tools.push(this.tools.get(b.id));
                    }
            if (body || tools.length)
                this.message({ id, role: m.role, text: body, timestamp: time(m.timestamp) ?? timestamp, cwd: e.cwd, source, complete: !['error', 'aborted'].includes(m.stopReason), tools });
            if (m.role === 'assistant') {
                e.model = clean(m.model, 200) || e.model;
                const u = object(m.usage);
                if (Object.keys(u).length)
                    this.usageRecord({ id: `message:${id}`, sessionId: e.id, requestId: id, model: e.model, timestamp, kind: 'delta', input: number(u.input), output: number(u.output), cacheRead: number(u.cacheRead), cacheWrite: number(u.cacheWrite), total: number(u.totalTokens), cacheSemantics: 'separate', source });
            }
        }
        else if (m.role === 'toolResult' && identity(m.toolCallId))
            this.result(m.toolCallId, m.content, Boolean(m.isError), source, timestamp);
    }
}
