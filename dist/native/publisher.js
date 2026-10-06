import { createHash } from 'node:crypto';
import { sanitize, truncate, number, bytes } from "../tui/text.js";
export const pluginId = 'iob.herdr-prism';
export const source = `plugin:${pluginId}`;
const keys = ['hat_line', 'hat_goal', 'hat_load', 'hat_counts', 'hat_branch', 'hat_add', 'hat_del', 'hat_div', 'hat_conflict', 'hat_last', 'hat_rank', 'hat_index', 'hat_fresh', 'hat_group'];
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
        if (Object.keys(tokens).length)
            await rpc.call('pane.report_metadata', { pane_id: record.paneId, source, tokens, seq: Date.now() * 1000 + 999 });
    }
}
export class NativePublisher {
    diagnostics = [];
    rpc;
    sent = new Map();
    seq = Date.now() * 1000;
    view = false;
    constructor(rpc) { this.rpc = rpc; }
    ownership() { return [...this.sent].map(([paneId, record]) => ({ paneId, terminalId: record.terminal, hashes: Object.fromEntries(Object.entries(JSON.parse(record.text)).map(([key, value]) => [key, hash(value)])) })); }
    async publish(sessions, now = Date.now(), graph = sessions) {
        this.diagnostics = [];
        let rank = 0;
        const active = new Set(sessions.flatMap(s => s.attachment ? [s.attachment.pane_id] : []));
        for (const [id, record] of this.sent)
            if (!active.has(id) && now - record.at >= 15000)
                this.sent.delete(id);
        for (const session of sessions) {
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
            const tokens = {
                hat_line: truncate(`${' '.repeat(Math.min(session.depth, 5) * 2)}${session.depth ? '↳ ' : ''}${session.evidence.title ?? session.evidence.id}`, 80),
                hat_goal: truncate(`Goal: ${session.evidence.goals.at(-1)?.objective ?? 'not reported'}`, 100),
                hat_load: `CPU ${number(resource?.cpuPercent)}% ${resource?.memoryLabel === 'working-set sum' ? 'WS' : 'RSS'} ${bytes(resource?.memoryBytes)}`,
                hat_counts: `p${resource?.processes.length ?? '—'} a${this.descendants(session, graph)} m${session.evidence.reason === 'metadata only; transcript body not loaded' || session.evidence.availability === 'unavailable' && !session.evidence.messages.length ? '—' : session.evidence.messages.filter(m => m.role !== 'tool').length} r${session.refs?.length ?? '—'}`,
                hat_branch: git?.branch ?? git?.branchState ?? 'Git —', hat_add: git?.added === undefined ? '' : `+${git.added}`, hat_del: git?.deleted === undefined ? '' : `-${git.deleted}`,
                hat_div: `↑${number(git?.ahead)} ↓${number(git?.behind)}`, hat_conflict: git?.conflicts ? `conflicts ${git.conflicts}` : '',
                hat_last: truncate(session.evidence.messages.filter(m => m.kind !== 'inter-agent' && m.role === 'assistant').at(-1)?.text ?? '', 100),
                hat_rank: String(rank).padStart(10, '0'), hat_index: '', hat_fresh: resource?.availability === 'known' ? '' : resource?.availability ?? 'unavailable', hat_group: ''
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
                await this.rpc.call('pane.report_metadata', { pane_id: pane.pane_id, source, tokens, ttl_ms: 15000, seq: ++this.seq });
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
