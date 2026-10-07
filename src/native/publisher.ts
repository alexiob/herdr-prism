import {activityState} from '../runtime/activity.ts';
import type { Rpc } from '../model/types.ts';
import type { SessionView } from '../tui/types.ts';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { serverIdPattern } from '../runtime/server.ts';
import { sanitize, truncate, number } from '../tui/text.ts';
export const pluginId = 'iob.herdr-prism';
export const source = `plugin:${pluginId}`;
const keys = ['hat_line', 'hat_goal', 'hat_load', 'hat_counts', 'hat_branch', 'hat_add', 'hat_del', 'hat_div', 'hat_conflict', 'hat_last', 'hat_rank', 'hat_index', 'hat_fresh', 'hat_group','hat_attention','hat_harness'];
import type {NativeGrouping} from '../config/native-grouping.ts';
export function compactBytes(value?:string):string {if(value===undefined)return '—';try{let amount=Number(BigInt(value));if(!Number.isFinite(amount)||amount<0)return '—';const units=['B','kB','MB','GB','TB','PB','EB'];let unit=0;while(amount>=1000&&unit<units.length-1){amount/=1000;unit++;}return `${Number(amount.toFixed(1))}${units[unit]}`;}catch{return '—';}}
export interface Publication {
    paneId: string;
    terminalId: string;
    hashes: Record<string, string>;
    displayAgentHash?:string;
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export async function clearPublication(rpc: Rpc, records: Publication[]) { for (const record of records) {
    let result: any;
    try {
        result = await rpc.call('pane.get', { pane_id: record.paneId });
    }
    catch (error) {
        if (['not_found', 'pane_not_found'].includes((error as {
            code?: string;
        }).code ?? ''))
            continue;
        throw error;
    }
    const pane = result.pane ?? result;
    if (pane.terminal_id !== record.terminalId)
        continue;
    const tokens = Object.fromEntries(keys.filter(key => typeof pane.tokens?.[key] === 'string' && hash(pane.tokens[key]) === record.hashes[key]).map(key => [key, null]));
    const clearDisplay=typeof pane.display_agent==='string'&&hash(pane.display_agent)===record.displayAgentHash;
    if (Object.keys(tokens).length||clearDisplay)
        await rpc.call('pane.report_metadata', { pane_id: record.paneId, source, tokens,...(clearDisplay?{clear_display_agent:true}:{}),seq: Date.now() * 1000 + 999 });
} }
export class NativePublisher {
    diagnostics: string[] = [];
    private rpc: Rpc;
    private sent = new Map<string, {
        text: string;
        displayAgent:string;
        at: number;
        terminal: string;
    }>();
    private seq = Date.now() * 1000;
    private view = false;
    private serverId: string = randomUUID();
    constructor(rpc: Rpc) { this.rpc = rpc; }
    setServerIdentity(id: string): void {
        if (!serverIdPattern.test(id)) throw new Error('Invalid server identity');
        if (this.sent.size && id !== this.serverId) throw new Error('Cannot replace an active publication server identity');
        this.serverId = id;
    }
    ownsDisplay(pane:{pane_id:string;terminal_id:string;display_agent?:string|null}):boolean {const old=this.sent.get(pane.pane_id);return !!old&&old.terminal===pane.terminal_id&&old.displayAgent===pane.display_agent;}
    ownership(): Publication[] { return [...this.sent].map(([paneId, record]) => ({ paneId, terminalId: record.terminal,displayAgentHash:hash(record.displayAgent), hashes: Object.fromEntries(Object.entries(JSON.parse(record.text) as Record<string, string>).map(([key, value]) => [key, hash(value)])) })); }
    async publish(sessions: SessionView[], now = Date.now(), graph: SessionView[] = sessions,options:{grouping?:NativeGrouping;tabs?:Record<string,unknown>[];harnessOnly?:boolean;selfJobs?:boolean;ownerTerminalId?:string}={}): Promise<void> {
        this.diagnostics = [];
        let rank = 0;
        const active = new Set(sessions.flatMap(s => s.attachment ? [s.attachment.pane_id] : []));
        for (const [id, record] of this.sent)
            if (!active.has(id) && now - record.at >= 15000)
                this.sent.delete(id);
        const tabName=(session:SessionView)=>{const id=session.attachment?.tab_id;const tab=options.tabs?.find(t=>(t.tab_id??t.id)===id);return String(tab?.label??tab?.name??id??'');};
        const project=(session:SessionView)=>session.git?.commonDir?.replace(/[\\/]\.git$/,'')??session.git?.root??session.attachment?.foreground_cwd??session.attachment?.cwd??session.evidence.cwd??'Unknown project';
        const group=(session:SessionView)=>options.grouping==='tab'?session.attachment?.tab_id??'':options.grouping==='project'?project(session):'';
        const stateOf=(session:SessionView)=>{const state=session.attachment?activityState(session.attachment,now):session.evidence.state;return state==='idle'&&session.evidence.goals.at(-1)?.status==='paused'?'paused':state;};
        const attention=(session:SessionView)=>{const level=['blocked','done','working','idle','paused'].indexOf(stateOf(session)??'');return level<0?5:level;};
        const grouped=!!options.grouping&&options.grouping!=='none';
        const ordered=[...sessions].sort((a,b)=>(grouped?group(a).localeCompare(group(b)):0)||attention(a)-attention(b));
        const byKey=new Map(graph.map(session=>[session.key,session]));
        let previousGroup:string|undefined;
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
            // A newborn or unreadable job has no CPU delta yet. Show the measured
            // lower bound instead of erasing active compilation or implying zero.
            const lowerBound=options.selfJobs&&resource?.availability!=='not_applicable'&&resource?.cpuPercent===undefined&&resource?.cpuLowerBound!==undefined;
            const cpu=resource?.availability==='not_applicable'?undefined:lowerBound?resource?.cpuLowerBound:resource?.cpuPercent;
            const warming=options.selfJobs&&resource?.availability!=='not_applicable'&&resource?.processes.length&&cpu===undefined;
            const freshness=resource?.availability==='not_applicable'?'shared':resource?.availability==='stale'?'cached':lowerBound?'partial':warming?'warming up':resource?.availability==='known'?'':resource?.availability??'unavailable';
            const groupKey=group(session),groupLabel=groupKey&&groupKey!==previousGroup?(options.grouping==='tab'?`Tab: ${tabName(session)}`:`Project: ${path.basename(groupKey.replace(/\\/g,'/'))}`):'';previousGroup=groupKey;
            const state=stateOf(session);
            const tokens: Record<string, string> = {
                hat_harness: truncate(pane.agent??session.evidence.provider,16),
                hat_line: truncate(String(pane.name??pane.terminal_title_stripped??pane.title_stripped??pane.title??session.evidence.title??session.evidence.provider).split('|')[0].trim(),16),
                hat_goal: truncate(session.evidence.goals.at(-1)?.objective?`Goal: ${session.evidence.goals.at(-1)!.objective}`:session.evidence.task?`Task: ${session.evidence.task}`:'',100),
                hat_load: `${resource?.availability==='stale'?'~ ':''}${options.harnessOnly?'H ':''}CPU ${lowerBound?'≥':''}${number(cpu)}%  ${resource?.memoryLabel === 'working-set sum' ? 'WS' : 'RSS'} ${compactBytes(resource?.memoryBytes)}`,
                hat_counts: `p${resource?.processes.length ?? '—'} a${this.descendants(session, byKey)} m${session.evidence.reason === 'metadata only; transcript body not loaded' || session.evidence.availability === 'unavailable' && !session.evidence.messages.length ? '—' : session.evidence.messages.filter(m => m.role !== 'tool').length} r${session.refCoverage==='unavailable'?'—':session.refs?.length??'—'}${session.refCoverage==='partial'||session.refCoverage==='retained'?'+':''}`,
                hat_branch: truncate(git?.branch ?? git?.branchState ?? 'Git —',12), hat_add: git?.added === undefined ? '' : `+${number(git.added)}`, hat_del: git?.deleted === undefined ? '' : `-${number(git.deleted)}`,
                hat_div: `↑${number(git?.ahead)} ↓${number(git?.behind)}`, hat_conflict: git?.conflicts ? `conflicts ${git.conflicts}` : '',
                hat_last: truncate(session.evidence.messages.filter(m => m.kind !== 'inter-agent' && m.role === 'assistant').at(-1)?.text ?? '', 100),
                hat_rank: `${grouped?'':attention(session)+':'}${this.serverId}:${String(rank).padStart(10, '0')}`, hat_index: '', hat_fresh: freshness, hat_group: truncate(groupLabel,28),hat_attention:state==='blocked'?'! INPUT REQUIRED':state==='done'?'✓ READY TO REVIEW':state==='idle'?'○ IDLE':state==='paused'?'Ⅱ PAUSED':state==='working'?'● WORKING':''
            };
            for (const key of keys)
                tokens[key] = sanitize(tokens[key]).replace(/[\r\n\t]/g, ' ');
            const owner=!!options.ownerTerminalId&&pane.terminal_id===options.ownerTerminalId;
            const displayAgent=owner?`> ${tokens.hat_line}`:tokens.hat_line;
            if(owner)tokens.hat_index='>';
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
                await this.rpc.call('pane.report_metadata', { pane_id: pane.pane_id, source, tokens,display_agent:displayAgent, ttl_ms: 15000, seq: ++this.seq });
                this.sent.set(pane.pane_id, { text,displayAgent, at: now, terminal: pane.terminal_id });
            }
            catch (error) {
                this.diagnostics.push(`${pane.pane_id}: ${(error as Error).message}`);
            }
        }
    }
    private descendants(session: SessionView, byKey:ReadonlyMap<string,SessionView>): number { const seen = new Set<string>(); const pending = [...session.children]; while (pending.length) {
        const k = pending.pop()!;
        if (seen.has(k))
            continue;
        seen.add(k);
        pending.push(...byKey.get(k)?.children ?? []);
    } return seen.size; }
    async installView(): Promise<void> { if (this.view)
        return; if (this.diagnostics.length)
        throw new Error('Cannot install view before complete rank publication'); await this.rpc.call('agent.view.set', { source, label: 'Prism', sort: [{ field: { token: 'hat_rank' }, order: 'asc' }] }); this.view = true; }
    async clear(sessions: SessionView[]): Promise<void> {
        try {
            await clearPublication(this.rpc, this.ownership());
        }
        catch { /* Source-safe TTL handles disconnected or departed panes. */ }
        await this.rpc.call('agent.view.clear', { source }).catch(() => { });
        this.view = false;
        this.sent.clear();
    }
}
