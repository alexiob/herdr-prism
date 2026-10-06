import { createHash } from 'node:crypto';
export const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
export const array = (value) => Array.isArray(value) ? value : [];
export function clean(value, limit = 65536) {
    return typeof value === 'string' ? value.slice(0, limit).replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\|$)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '') : '';
}
export const identity = (value) => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\x00-\x1f\x7f]/.test(value) ? value : undefined;
/** Filename spelling may contain newline/tab; preserve it for explicit argv/fs use. */
export const filePath = (value) => typeof value === 'string' && value.length > 0 && value.length <= 32768 && !/[\x00-\x08\x0b-\x1f\x7f]/.test(value) ? value : undefined;
export const number = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
export function time(value) { if (typeof value === 'number')
    return number(value); if (typeof value !== 'string')
    return; const n = Date.parse(value); return Number.isFinite(n) ? n : undefined; }
export const hash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 24);
export function json(value) { if (typeof value !== 'string')
    return object(value); try {
    return object(JSON.parse(value));
}
catch {
    return {};
} }
export function visible(content) { if (typeof content === 'string')
    return clean(content); return array(content).filter(b => ['text', 'input_text', 'output_text'].includes(object(b).type)).map(b => clean(b.text)).join('\n'); }
export class EvidenceBuilder {
    evidence;
    children = [];
    calls = new Map();
    messages = new Map();
    tools = new Map();
    usage = new Map();
    turnId;
    turnStart;
    supported = true;
    onEditedPaths;
    max;
    constructor(provider, path, max) { this.max = max; this.evidence = { id: '', provider, path, messages: [], tools: [], usage: [], goals: [], availability: 'known', diagnostics: [] }; }
    source(offset) { return `${this.evidence.path}#${offset}`; }
    diagnostic(message) { if (!this.evidence.diagnostics.includes(message))
        this.evidence.diagnostics.push(message); this.evidence.diagnostics = this.evidence.diagnostics.slice(-64); this.evidence.availability = 'partial'; }
    message(message) { const old = this.messages.get(message.id); this.messages.set(message.id, { ...old, ...message, tools: message.tools?.length ? message.tools : old?.tools }); const offset = Number(message.source?.slice(message.source.lastIndexOf('#') + 1)); if (message.kind !== 'inter-agent' && message.role === 'user' && message.complete === true && !this.evidence.initialRequest && Number.isFinite(offset) && offset <= 1024 * 1024)
        this.evidence.initialRequest = structuredClone(message); this.bound(this.messages); }
    tool(tool, cwd = this.evidence.cwd) { this.tools.set(tool.id, { ...this.tools.get(tool.id), ...tool }); this.bound(this.tools); if (tool.status === 'done' && tool.editedPaths?.length)
        this.onEditedPaths?.(tool.editedPaths, cwd); }
    usageRecord(record) { if (Object.entries(record).some(([k, v]) => ['input', 'output', 'cacheRead', 'cacheWrite', 'total', 'turnMs', 'generationMs', 'contextUsed', 'contextLimit'].includes(k) && v !== undefined)) {
        const defined = Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined));
        this.usage.set(record.id, { ...this.usage.get(record.id), ...defined });
        this.bound(this.usage);
    } }
    bound(map) { while (map.size > this.max) {
        map.delete(map.keys().next().value);
        this.diagnostic('retained record window limit reached; lifetime coverage partial');
    } }
    snapshot() { const e = this.evidence; e.messages = [...this.messages.values()].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)); e.tools = [...this.tools.values()]; e.usage = [...this.usage.values()]; return structuredClone(e); }
    activity(timestamp) { const at = time(timestamp); if (at !== undefined)
        this.evidence.lastActivity = Math.max(at, this.evidence.lastActivity ?? at); return at; }
    call(id, name, args, timestamp) {
        const parsed = json(args);
        const selected = {};
        for (const key of ['file_path', 'path', 'message', 'prompt', 'objective', 'status'])
            if (typeof parsed[key] === 'string')
                selected[key] = parsed[key].slice(0, 8192);
        const raw = name === 'apply_patch' && typeof args === 'string' ? args.split('\n').filter(line => /^\*\*\* (?:Update|Add|Delete|Move to)/.test(line)).slice(0, 200).join('\n') : '';
        this.calls.set(id, { name, args: selected, raw, cwd: this.evidence.cwd });
        this.bound(this.calls);
        this.tool({ id, name: clean(name, 200), status: 'running', timestamp });
    }
    result(id, content, error, source, timestamp) {
        const call = this.calls.get(id);
        const tool = this.tools.get(id);
        const summary = visible(content) || clean(typeof content === 'string' ? content : JSON.stringify(content), 4096);
        if (!call || !tool) {
            const unknown = { id, name: 'unknown', status: error ? 'error' : 'done', summary: summary.slice(0, 4096), timestamp };
            this.tool(unknown);
            this.message({ id: `tool:${id}`, role: 'tool', text: summary.slice(0, 4096), timestamp, cwd: this.evidence.cwd, source, complete: true, tools: [unknown] });
            this.diagnostic('tool result has no retained matching call; call provenance unavailable');
            return;
        }
        tool.status = error ? 'error' : 'done';
        tool.summary = summary.slice(0, 4096);
        if (!error && ['Edit', 'Write', 'MultiEdit', 'edit', 'write', 'apply_patch'].includes(call.name)) {
            const paths = [];
            for (const p of [call.args.file_path, call.args.path])
                if (identity(p))
                    paths.push(p);
            if (call.name === 'apply_patch' && /Success|success|"success"\s*:\s*true/.test(summary))
                for (const match of call.raw.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm))
                    paths.push(match[1]);
            if (paths.length)
                tool.editedPaths = [...new Set(paths)].slice(0, 200);
        }
        this.tool(tool, call.cwd);
        this.message({ id: `tool:${id}`, role: 'tool', text: summary.slice(0, 4096), timestamp, cwd: call.cwd, source, complete: true, tools: [tool] });
        const output = json(content);
        if (!error && ['create_goal', 'get_goal', 'update_goal'].includes(call.name)) {
            const goal = object(output.goal);
            const objective = clean(goal.objective, 8192);
            const created = number(goal.createdAt);
            const thread = identity(goal.threadId);
            const goalId = thread && created !== undefined ? `goal:${thread}:${created}` : undefined;
            const validStatus = ['active', 'complete', 'blocked', 'paused', 'budget_limited', 'usage_limited'].includes(goal.status);
            if (goalId && thread === this.evidence.id && objective && validStatus && (call.name !== 'create_goal' || clean(call.args.objective).trim() === objective.trim()) && (call.name !== 'update_goal' || call.args.status === goal.status)) {
                this.evidence.goals = this.evidence.goals.filter(g => g.id !== goalId);
                this.evidence.goals.push({ id: goalId, objective, status: goal.status, timestamp, source });
                this.evidence.goals = this.evidence.goals.slice(-this.max);
            }
        }
        if (!error && ['spawn_agent', 'Agent', 'Task'].includes(call.name)) {
            const child = identity(output.agent_id) || identity(output.agentId);
            if (child)
                this.children.push({ id: child, task: clean(call.args.message || call.args.prompt), source });
            this.children = this.children.slice(-this.max);
        }
    }
}
export function codexTokens(value) { const v = object(value); return { input: number(v.input_tokens), output: number(v.output_tokens), cacheRead: number(v.cached_input_tokens), cacheWrite: number(v.cache_write_input_tokens), reasoning: number(v.reasoning_output_tokens), total: number(v.total_tokens), cacheSemantics: 'subset' }; }
