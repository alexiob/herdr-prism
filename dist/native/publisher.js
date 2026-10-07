import { activityState } from "../runtime/activity.js";
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { serverIdPattern } from "../runtime/server.js";
import { sanitize, truncate, number } from "../tui/text.js";
export const pluginId = 'iob.herdr-prism';
export const source = `plugin:${pluginId}`;
const keys = ['hat_line', 'hat_goal', 'hat_load', 'hat_counts', 'hat_branch', 'hat_add', 'hat_del', 'hat_div', 'hat_conflict', 'hat_last', 'hat_rank', 'hat_index', 'hat_fresh', 'hat_group', 'hat_attention', 'hat_harness'];
export function compactBytes(value) { if (value === undefined)
    return '—'; try {
    let amount = Number(BigInt(value));
    if (!Number.isFinite(amount) || amount < 0)
        return '—';
    const units = ['B', 'kB', 'MB', 'GB', 'TB', 'PB', 'EB'];
    let unit = 0;
    while (amount >= 1000 && unit < units.length - 1) {
        amount /= 1000;
        unit++;
    }
    return `${Number(amount.toFixed(1))}${units[unit]}`;
}
catch {
    return '—';
} }
const hash = (text) => createHash('sha256').update(text).digest('hex');
export async function clearPublication(rpc, records) {
    for (const record of records) {
        let result;
        try {
            result = await rpc.call('pane.get', { pane_id: record.paneId });
        }
        catch (error) {
            if (['not_found', 'pane_not_found'].includes(error.code ?? ''))
                continue;
            throw error;
        }
        const pane = result.pane ?? result;
        if (pane.terminal_id !== record.terminalId)
            continue;
        const tokens = Object.fromEntries(keys.filter(key => typeof pane.tokens?.[key] === 'string' && hash(pane.tokens[key]) === record.hashes[key]).map(key => [key, null]));
        const clearDisplay = typeof pane.display_agent === 'string' && hash(pane.display_agent) === record.displayAgentHash;
        if (Object.keys(tokens).length || clearDisplay)
            await rpc.call('pane.report_metadata', { pane_id: record.paneId, source, tokens, ...(clearDisplay ? { clear_display_agent: true } : {}), seq: Date.now() * 1000 + 999 });
    }
}
export class NativePublisher {
    diagnostics = [];
    rpc;
    sent = new Map();
    seq = Date.now() * 1000;
    view = false;
    serverId = randomUUID();
    constructor(rpc) { this.rpc = rpc; }
    setServerIdentity(id) {
        if (!serverIdPattern.test(id))
            throw new Error('Invalid server identity');
        if (this.sent.size && id !== this.serverId)
            throw new Error('Cannot replace an active publication server identity');
        this.serverId = id;
    }
    ownsDisplay(pane) { const old = this.sent.get(pane.pane_id); return !!old && old.terminal === pane.terminal_id && JSON.parse(old.text).hat_line === pane.display_agent; }
    ownership() { return [...this.sent].map(([paneId, record]) => ({ paneId, terminalId: record.terminal, displayAgentHash: hash(JSON.parse(record.text).hat_line), hashes: Object.fromEntries(Object.entries(JSON.parse(record.text)).map(([key, value]) => [key, hash(value)])) })); }
    async publish(sessions, now = Date.now(), graph = sessions, options = {}) {
        this.diagnostics = [];
        let rank = 0;
        const active = new Set(sessions.flatMap(s => s.attachment ? [s.attachment.pane_id] : []));
        for (const [id, record] of this.sent)
            if (!active.has(id) && now - record.at >= 15000)
                this.sent.delete(id);
        const tabName = (session) => { const id = session.attachment?.tab_id; const tab = options.tabs?.find(t => (t.tab_id ?? t.id) === id); return String(tab?.label ?? tab?.name ?? id ?? ''); };
        const project = (session) => session.git?.commonDir?.replace(/[\\/]\.git$/, '') ?? session.git?.root ?? session.attachment?.foreground_cwd ?? session.attachment?.cwd ?? session.evidence.cwd ?? 'Unknown project';
        const group = (session) => options.grouping === 'tab' ? session.attachment?.tab_id ?? '' : options.grouping === 'project' ? project(session) : '';
        const stateOf = (session) => { const state = session.attachment ? activityState(session.attachment, now) : session.evidence.state; return state === 'idle' && session.evidence.goals.at(-1)?.status === 'paused' ? 'paused' : state; };
        const attention = (session) => { const level = ['blocked', 'done', 'working', 'idle', 'paused'].indexOf(stateOf(session) ?? ''); return level < 0 ? 5 : level; };
        const grouped = !!options.grouping && options.grouping !== 'none';
        const ordered = [...sessions].sort((a, b) => (grouped ? group(a).localeCompare(group(b)) : 0) || attention(a) - attention(b));
        let previousGroup;
        for (const session of ordered) {
            const pane = session.attachment;
            if (!pane)
                continue;
            rank++;
            const foreign = Object.keys(pane.tokens ?? {}).filter(k => !keys.includes(k)).length;
            if (foreign + keys.length > 32) {
                this.diagnostics.push(`${pane.pane_id}: shared token budget unavailable`);
                continue;
            }
            const resource = session.resource, git = session.git;
            const groupKey = group(session), groupLabel = groupKey && groupKey !== previousGroup ? (options.grouping === 'tab' ? `Tab: ${tabName(session)}` : `Project: ${path.basename(groupKey.replace(/\\/g, '/'))}`) : '';
            previousGroup = groupKey;
            const state = stateOf(session);
            const tokens = {
                hat_harness: truncate(pane.agent ?? session.evidence.provider, 16),
                hat_line: truncate(String(pane.name ?? pane.terminal_title_stripped ?? pane.title_stripped ?? session.evidence.title ?? session.evidence.provider).split('|')[0].trim(), 16),
                hat_goal: truncate(session.evidence.goals.at(-1)?.objective ? `Goal: ${session.evidence.goals.at(-1).objective}` : session.evidence.task ? `Task: ${session.evidence.task}` : '', 100),
                hat_load: `${resource?.availability === 'stale' ? '~ ' : ''}${options.harnessOnly ? 'H ' : ''}CPU ${number(resource?.cpuPercent)}%  ${resource?.memoryLabel === 'working-set sum' ? 'WS' : 'RSS'} ${compactBytes(resource?.memoryBytes)}`,
                hat_counts: `p${resource?.processes.length ?? '—'} a${this.descendants(session, graph)} m${session.evidence.reason === 'metadata only; transcript body not loaded' || session.evidence.availability === 'unavailable' && !session.evidence.messages.length ? '—' : session.evidence.messages.filter(m => m.role !== 'tool').length} r${session.refCoverage === 'unavailable' ? '—' : session.refs?.length ?? '—'}${session.refCoverage === 'partial' || session.refCoverage === 'retained' ? '+' : ''}`,
                hat_branch: truncate(git?.branch ?? git?.branchState ?? 'Git —', 12), hat_add: git?.added === undefined ? '' : `+${number(git.added)}`, hat_del: git?.deleted === undefined ? '' : `-${number(git.deleted)}`,
                hat_div: `↑${number(git?.ahead)} ↓${number(git?.behind)}`, hat_conflict: git?.conflicts ? `conflicts ${git.conflicts}` : '',
                hat_last: truncate(session.evidence.messages.filter(m => m.kind !== 'inter-agent' && m.role === 'assistant').at(-1)?.text ?? '', 100),
                hat_rank: `${grouped ? '' : attention(session) + ':'}${this.serverId}:${String(rank).padStart(10, '0')}`, hat_index: '', hat_fresh: resource?.availability === 'known' ? '' : resource?.availability === 'stale' ? 'cached' : resource?.availability ?? 'unavailable', hat_group: truncate(groupLabel, 28), hat_attention: state === 'blocked' ? '! INPUT REQUIRED' : state === 'done' ? '✓ READY TO REVIEW' : state === 'idle' ? '○ IDLE' : state === 'paused' ? 'Ⅱ PAUSED' : state === 'working' ? '● WORKING' : ''
            };
            for (const key of keys)
                tokens[key] = sanitize(tokens[key]).replace(/[\r\n\t]/g, ' ');
            const text = JSON.stringify(tokens), old = this.sent.get(pane.pane_id);
            if (old && old.text === text && old.terminal === pane.terminal_id && now - old.at < 5000)
                continue;
            try {
                const result = await this.rpc.call('pane.get', { pane_id: pane.pane_id });
                const live = result.pane ?? result;
                if (live.terminal_id !== pane.terminal_id || live.agent !== pane.agent || live.agent_session?.kind !== pane.agent_session?.kind || live.agent_session?.value !== pane.agent_session?.value)
                    throw new Error('Pane occupant changed before publication');
                const liveForeign = Object.keys(live.tokens ?? {}).filter(k => !keys.includes(k)).length;
                if (liveForeign + keys.length > 32)
                    throw new Error('Shared token budget changed before publication');
                await this.rpc.call('pane.report_metadata', { pane_id: pane.pane_id, source, tokens, display_agent: tokens.hat_line, ttl_ms: 15000, seq: ++this.seq });
                this.sent.set(pane.pane_id, { text, at: now, terminal: pane.terminal_id });
            }
            catch (error) {
                this.diagnostics.push(`${pane.pane_id}: ${error.message}`);
            }
        }
    }
    descendants(session, sessions) {
        const byKey = new Map(sessions.map(s => [s.key, s]));
        const seen = new Set();
        const pending = [...session.children];
        while (pending.length) {
            const k = pending.pop();
            if (seen.has(k))
                continue;
            seen.add(k);
            pending.push(...byKey.get(k)?.children ?? []);
        }
        return seen.size;
    }
    async installView() {
        if (this.view)
            return;
        if (this.diagnostics.length)
            throw new Error('Cannot install view before complete rank publication');
        await this.rpc.call('agent.view.set', { source, label: 'Prism', sort: [{ field: { token: 'hat_rank' }, order: 'asc' }] });
        this.view = true;
    }
    async clear(sessions) {
        try {
            await clearPublication(this.rpc, this.ownership());
        }
        catch { /* Source-safe TTL handles disconnected or departed panes. */ }
        await this.rpc.call('agent.view.clear', { source }).catch(() => { });
        this.view = false;
        this.sent.clear();
    }
}
