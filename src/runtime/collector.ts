import { EventEmitter } from 'node:events';
import type { HerdrSnapshot, HerdrAgent, SessionEvidence, Rpc, SampleBatch, GoalRecord } from '../model/types.ts';
import { buildForest, sessionKey } from '../model/graph.ts';
import { ProviderIndex } from '../providers/index.ts';
import { TodoList, extractRefs } from '../content/index.ts';
import { createSampler } from '../process/sampler.ts';
import type { ProcessSampler } from '../process/sampler.ts';
import { ProcessTracker } from '../process/ownership.ts';
import type { ProcessRoot } from '../process/ownership.ts';
import { LaunchLedger } from '../process/ledger.ts';
import { reduceUsage, reduceUsageScope } from '../metrics/usage-reducer.ts';
import { SampleHistory } from '../metrics/history.ts';
import { GitCache } from '../git/cache.ts';
import type { Settings } from '../config/index.ts';
import { StateStore, identityName } from '../state/store.ts';
import { NativePublisher } from '../native/publisher.ts';
import type { DashboardData, SessionView } from '../tui/types.ts';
export interface CollectorOptions {
    rpc: Rpc;
    settings: Settings;
    stateDir: string;
    index?: ProviderIndex;
    sampler?: ProcessSampler;
    git?: GitCache;
    paneOpen?: boolean;
    visibleSession?: string;
}
function blank(provider: string, id: string, cwd?: string, reason = 'Exact local transcript unavailable'): SessionEvidence { return { id, provider, cwd, messages: [], tools: [], usage: [], goals: [], availability: 'unavailable', reason }; }
function nativeState(agent: HerdrAgent): string { return typeof agent.agent_status === 'string' ? agent.agent_status : agent.agent_status?.state ?? agent.agent_status?.status ?? 'unknown'; }
export function matchesHarness(provider: string, p: {
    name?: string;
    argv0?: string;
    argv?: string[];
}): boolean { const basename = (v: string) => v.split(/[\\/]/).at(-1)?.replace(/\.exe$/i, '') ?? ''; const allowed = provider === 'claude' ? ['claude'] : provider === 'codex' ? ['codex'] : provider === 'pi' ? ['pi', 'pi-coding-agent'] : []; const exe = basename(p.argv0 ?? p.argv?.[0] ?? p.name ?? ''); if (allowed.includes(exe))
    return true; if (!['node', 'nodejs', 'bun'].includes(exe))
    return false; const script = p.argv?.[1]; if (!script || script.startsWith('-'))
    return false; if (provider === 'pi')
    return allowed.includes(basename(script)) || /[\\/]node_modules[\\/](?:@earendil-works[\\/]pi-coding-agent[\\/]dist[\\/]bundle[\\/]cli\.js|@mariozechner[\\/]pi-coding-agent[\\/]dist[\\/]cli\.js)$/.test(script); if (provider === 'claude')
    return /[\\/]@anthropic-ai[\\/]claude-code[\\/]cli\.js$/.test(script); return false; }
function sameOccupant(a: HerdrAgent, b: HerdrAgent): boolean { return a.terminal_id === b.terminal_id && a.agent === b.agent && a.agent_session?.kind === b.agent_session?.kind && a.agent_session?.value === b.agent_session?.value; }
function inactive(state?:string):boolean { return state !== undefined && ['idle','done','completed','complete','error','interrupted','historical','waiting','blocked'].includes(state); }
export class Collector extends EventEmitter {
    data: DashboardData = { sessions: [], updatedAt: 0, stale: true, diagnostics: [] };
    readonly index: ProviderIndex;
    readonly settings: Settings;
    readonly store: StateStore;
    readonly ledger = new LaunchLedger();
    readonly tracker = new ProcessTracker(this.ledger);
    readonly history = new SampleHistory();
    private rpc: Rpc;
    private sampler: ProcessSampler;
    private git: GitCache;
    private publisher: NativePublisher;
    private snapshot?: HerdrSnapshot;
    private lastSample?: SampleBatch;
    private roots: ProcessRoot[] = [];
    private todos = new Map<string, TodoList>();
    private todoHashes = new Map<string, string>();
    private timer?: NodeJS.Timeout;
    private sampleTimer?: NodeJS.Timeout;
    private refreshing?: Promise<void>;
    private starting?: Promise<void>;
    private sampling?: Promise<void>;
    private stopped = false;
    private subtree = false;
    private viewInstalled = false;
    private localGoals = new Map<string, GoalRecord[]>();
    private savedLaunches: any[] = [];
    private sampleError?: string;
    private publicationHash = '';
    private historical = new Map<string, SessionEvidence>();
    private paneOpen = false;
    private visibleSession?: string;
    private visibilityGeneration = 0;
    private sampledGeneration?: number;
    private warmup = true;
    private processesExpanded = false;
    private lastProcessAttemptAt = 0;
    private rootProofs = new Map<string,{attachment:HerdrAgent;root:ProcessRoot;bootId:string;verifiedAt:number}>();
    private todoHydrated = new Set<string>();
    private derived = new Map<string, {revision?:string; messages:SessionEvidence['messages']; cwd?:string; refs:SessionView['refs']}>();
    constructor(options: CollectorOptions) { super(); this.paneOpen = options.paneOpen === true; this.visibleSession = options.visibleSession; this.rpc = options.rpc; this.settings = options.settings; this.store = new StateStore(options.stateDir); this.index = options.index ?? new ProviderIndex({ codexHome: options.settings.providerHomes.codex, claudeHome: options.settings.providerHomes.claude, piHome: options.settings.providerHomes.pi, maxMessages: 200 }); this.sampler = options.sampler ?? createSampler(); this.git = options.git ?? new GitCache(); this.publisher = new NativePublisher(options.rpc); }
    async init() { await this.store.init(); const goals = await this.store.read<Record<string, GoalRecord[]>>('goals'); if (goals && typeof goals === 'object')
        for (const [key, value] of Object.entries(goals))
            if (Array.isArray(value))
                this.localGoals.set(key, value.filter(g => g && typeof g.objective === 'string').slice(-100)); const launches = await this.store.read<any[]>('launches'); if (Array.isArray(launches))
        this.savedLaunches = launches; }
    async start() { if (this.starting)
        return this.starting; this.starting = (async () => { await this.init(); if (this.stopped)
        return; await this.refresh(); if (this.stopped)
        return; await this.sampleProcesses(); if (this.stopped)
            return; this.timer = setInterval(() => void this.refresh(), 1000); this.scheduleProcessSample(); })().finally(() => { this.starting = undefined; }); return this.starting; }
    invalidate() { void this.refresh(); }
    /** The foreground inspector owns this gate; finite hooks never open it. */
    setVisibleSession(key?: string, open = true) {
        if (this.visibleSession === key && this.paneOpen === open) return;
        this.visibleSession = key; this.paneOpen = open; this.visibilityGeneration++; this.warmup = true; if(open && key)this.todoHydrated.delete(key);
        this.scheduleProcessSample();
        if (this.timer || this.starting) void this.refresh().then(() => this.refresh());
    }
    private detailedRef(snapshot: HerdrSnapshot) {
        if (!this.paneOpen) return;
        if (!this.visibleSession) {
            const focused = snapshot.agents.find(a => a.focused || a.pane_id === snapshot.focused_pane_id) ?? snapshot.agents[0];
            if (focused?.agent_session?.kind === 'id') this.visibleSession = sessionKey(focused.agent ?? 'unknown', focused.agent_session.value);
        }
        const previous = this.data.sessions.find(s => s.key === this.visibleSession);
        if (previous) return {provider:previous.evidence.provider, kind:previous.evidence.path ? 'path' as const : 'id' as const, value:previous.evidence.path ?? previous.evidence.id};
        const agent = snapshot.agents.find(a => a.agent_session?.kind === 'id' && sessionKey(a.agent ?? 'unknown', a.agent_session.value) === this.visibleSession);
        if (agent?.agent_session) return {provider:agent.agent ?? 'unknown',kind:agent.agent_session.kind,value:agent.agent_session.value};
        if (!this.visibleSession) { const first = snapshot.agents.find(a => a.focused) ?? snapshot.agents[0]; if(first?.agent_session)return {provider:first.agent ?? 'unknown',kind:first.agent_session.kind,value:first.agent_session.value}; }
        const split = this.visibleSession?.indexOf(':') ?? -1;
        if (split > 0) return {provider:this.visibleSession!.slice(0,split),kind:'id' as const,value:this.visibleSession!.slice(split+1)};
    }
    setScope(subtree: boolean) { this.subtree = subtree; this.updateResources(); this.scheduleProcessSample(); this.emit('data', this.data); }
    setProcessesExpanded(expanded:boolean) { if(this.processesExpanded === expanded)return; this.processesExpanded = expanded; this.scheduleProcessSample(); }
    private scheduleProcessSample() {
        clearTimeout(this.sampleTimer); this.sampleTimer = undefined;
        if(this.stopped || !this.timer || !this.paneOpen || !this.visibleSession || this.sampling)return;
        const keys = new Set([this.visibleSession,...this.subtree ? this.descendants(this.visibleSession) : []]);
        const observed = this.data.sessions.filter(session=>keys.has(session.key));
        if(!observed.length)return;
        const idle = observed.every(session=>inactive(session.evidence.state));
        const cadence = this.processesExpanded ? 1000 : idle ? Math.max(5000,this.settings.sampleIntervalMs) : this.settings.sampleIntervalMs;
        this.sampleTimer = setTimeout(()=>{this.sampleTimer=undefined;void this.sampleProcesses();},Math.max(1,this.lastProcessAttemptAt+cadence-Date.now()));
    }
    private descendants(key: string) { const map = new Map(this.data.sessions.map(s => [s.key, s])); const seen = new Set<string>(); const queue = [...map.get(key)?.children ?? []]; while (queue.length) {
        const k = queue.pop()!;
        if (seen.has(k))
            continue;
        seen.add(k);
        queue.push(...map.get(k)?.children ?? []);
    } return [...seen]; }
    private updateResources() { for (const session of this.data.sessions) {
        const keys = this.subtree ? this.descendants(session.key) : [];
        const observed = this.paneOpen && (session.key === this.visibleSession || this.subtree && this.visibleSession && this.descendants(this.visibleSession).includes(session.key));
        if (observed && this.sampledGeneration === this.visibilityGeneration) {
            session.resource = this.tracker.view(session.key, this.subtree, keys);
            if (this.sampleError) session.resource = {...session.resource,availability:this.lastSample ? 'stale' : 'unavailable',reason:this.sampleError};
        } else if (session.resource) session.resource = {...session.resource,availability:'stale',reason:observed ? 'Awaiting a fresh sample after visibility changed' : 'Updates paused while this session is not shown'};
        const self = reduceUsage(session.evidence.usage,{rates:this.settings.costRates,activeTurnId:session.evidence.activeTurn?.id});
        if (this.subtree && session.key === this.visibleSession) {
            const aggregate = reduceUsageScope([session,...keys.map(k => this.data.sessions.find(s => s.key === k)!).filter(Boolean)].map(s => ({key:s.key,parentKey:s.parentKey,records:s.evidence.usage})),{rates:this.settings.costRates});
            for(const field of ['model','contextUsed','contextLimit','contextPercent','generationTokensPerSecond','turnTokensPerSecond','turnMs','generationMs','turnUsage'] as const) { delete aggregate[field]; if(self[field] !== undefined) Object.assign(aggregate,{[field]:self[field]}); }
            if (aggregate.availability === 'known' && keys.some(k => this.data.sessions.find(s => s.key === k)?.evidence.availability === 'stale')) {aggregate.availability = 'partial';aggregate.diagnostics.push('Descendant usage is cached while its updates are paused');}
            session.usage = aggregate;
        } else session.usage = self;
        session.history = this.history.view(session.key,this.subtree ? 'subtree' : 'self');
    } }
    async refresh(): Promise<void> {
        if (this.stopped)
            return;
        if (this.refreshing)
            return this.refreshing;
        this.refreshing = (async () => {
            try {
                const generation = this.visibilityGeneration;
                const result = await this.rpc.call('session.snapshot');
                const snapshot: HerdrSnapshot = structuredClone(result.snapshot ?? result);
                if (!Array.isArray(snapshot.agents) || typeof snapshot.protocol !== 'number')
                    throw new Error('Invalid Herdr snapshot');
                this.snapshot = snapshot;
                this.index.setActiveRefs(snapshot.agents.flatMap(agent => agent.agent_session ? [{ provider: agent.agent ?? 'unknown', kind: agent.agent_session.kind, value: agent.agent_session.value }] : []));
                const detailRef = this.detailedRef(snapshot);
                this.index.setDetailedRefs(detailRef ? [detailRef] : []);
                const all = this.paneOpen ? await this.index.refreshSnapshots() : [];
                const known = new Map(all.map(s => [sessionKey(s.provider, s.id), s]));
                const attachments = new Map<string, HerdrAgent[]>();
                const active = new Set<string>();
                for (const agent of snapshot.agents) {
                    const provider = agent.agent ?? 'unknown';
                    const ref = agent.agent_session;
                    let evidence = ref ? this.index.resolveSnapshotCached(provider, ref) : undefined;
                    if (!evidence && ref?.kind === 'path' && this.paneOpen)
                        evidence = await this.index.resolve(provider, ref);
                    evidence = evidence ? {...evidence} : blank(provider, ref?.value ?? `pane-${agent.terminal_id}`, agent.foreground_cwd ?? agent.cwd ?? undefined);
                    evidence.state = nativeState(agent);
                    evidence.title = agent.name ?? agent.display_agent ?? evidence.title ?? undefined;
                    evidence.cwd = evidence.cwd ?? agent.foreground_cwd ?? agent.cwd ?? undefined;
                    const key = sessionKey(provider, evidence.id);
                    if (this.paneOpen && !this.visibleSession && detailRef?.provider === provider && detailRef.kind === ref?.kind && detailRef.value === ref?.value) this.visibleSession = key;
                    known.set(key, evidence);
                    active.add(key);
                    attachments.set(key, [...attachments.get(key) ?? [], agent]);
                }
                for (const [key, evidence] of this.historical) {
                    const current = known.get(key);
                    if (!current) known.set(key,{...evidence});
                    else if(current.reason === 'metadata only; transcript body not loaded' && evidence.messages.length) known.set(key,{...evidence,state:current.state,title:current.title ?? evidence.title,availability:'stale',reason:'Cached details; live updates resume when this session is shown'});
                }
                const include = new Set([...active, ...this.historical.keys()]);
                let changed = true;
                while (changed) {
                    changed = false;
                    for (const [key, evidence] of known) {
                        const parent = evidence.parentId ? sessionKey(evidence.parentProvider ?? evidence.provider, evidence.parentId) : undefined;
                        if ((parent && include.has(parent)) || (include.has(key) && parent && known.has(parent))) {
                            const add = include.has(key) ? parent! : key;
                            if (!include.has(add)) {
                                include.add(add);
                                changed = true;
                            }
                        }
                    }
                }
                const previouslyPaneBacked = new Set(this.data.sessions.filter(s => s.attachment || s.historical).map(s => s.key));
                const forest = buildForest([...known].filter(([key]) => include.has(key)).map(([, evidence]) => ({...evidence})));
                const views: SessionView[] = [];
                for (const node of forest.order) {
                    node.attachments = attachments.get(node.key) ?? [];
                    node.attachment = node.attachments.find(a => a.focused) ?? node.attachments[0];
                    node.historical = !node.attachment && previouslyPaneBacked.has(node.key);
                    if (node.historical)
                        node.evidence.state = 'historical';
                    this.historical.delete(node.key);
                    this.historical.set(node.key, {...node.evidence});
                    while (this.historical.size > 512)
                        this.historical.delete(this.historical.keys().next().value!);
                    if (this.localGoals.has(node.key))
                        node.evidence.goals = [...node.evidence.goals, ...this.localGoals.get(node.key)!];
                    const detailed = generation === this.visibilityGeneration && this.paneOpen && (node.key === this.visibleSession || (!this.visibleSession && node.evidence.provider === detailRef?.provider && (detailRef.kind === 'path' ? node.evidence.path === detailRef.value : node.evidence.id === detailRef.value)));
                    if (detailed && !this.visibleSession) this.visibleSession = node.key;
                    if (!detailed && node.evidence.messages.length) {node.evidence.availability = 'stale';node.evidence.reason = 'Cached details; live updates resume when this session is shown';}
                    const previous = this.data.sessions.find(s => s.key === node.key);
                    let list = this.todos.get(node.key);
                    if (!list) { list = new TodoList({enabled:this.settings.todosEnabled}); this.todos.set(node.key,list); }
                    let refs = previous?.refs ?? [];
                    let git = previous?.git;
                    const canDetail = () => detailed && generation === this.visibilityGeneration && this.paneOpen;
                    if (canDetail()) {
                        if (!this.todoHydrated.has(node.key)) {
                            const persisted = await this.store.read<any>('todo-' + identityName(node.key));
                            const ref = node.evidence.path ? {kind:'path' as const,value:node.evidence.path} : {kind:'id' as const,value:node.evidence.id};
                            const history = this.settings.todosEnabled && canDetail() ? await this.index.readTodoState(node.evidence.provider, ref) : undefined;
                            list.restore(history ?? persisted);
                            if (history) { const checks = new Set((persisted?.items ?? []).filter((t:any) => t.checked === true).map((t:any) => t.id)); for (const item of list.items) if(checks.has(item.id) && !item.checked) list.toggle(item.id); }
                            this.todoHydrated.add(node.key);
                        }
                        if (canDetail()) {
                        list.setAvailability(node.evidence.availability !== 'unavailable');
                        const cached = this.derived.get(node.key);
                        const unchanged = cached && cached.cwd === node.evidence.cwd && (node.evidence.contentRevision !== undefined ? cached.revision === node.evidence.contentRevision : cached.messages === node.evidence.messages);
                        if (!unchanged) {
                            const previousLast = cached?.messages.at(-1)?.id;
                            if(this.settings.todosEnabled && previousLast && node.evidence.messages.length >= 200 && !node.evidence.messages.some(m => m.id === previousLast) && canDetail()) {
                                const ref = node.evidence.path ? {kind:'path' as const,value:node.evidence.path} : {kind:'id' as const,value:node.evidence.id};
                                const recovered = await this.index.readTodoState(node.evidence.provider,ref);
                                if(recovered && canDetail()) {const checks = new Set(list.items.filter(item => item.checked).map(item => item.id));list.restore(recovered);for(const item of list.items)if(checks.has(item.id) && !item.checked)list.toggle(item.id);}
                            }
                            if(canDetail()) list.update(node.evidence.messages);
                            if(canDetail()) await this.saveTodo(node.key, list);
                            if(canDetail()) refs = await extractRefs(node.evidence.messages, node.evidence.cwd);
                            this.derived.set(node.key,{revision:node.evidence.contentRevision,messages:node.evidence.messages,cwd:node.evidence.cwd,refs});
                        } else refs = cached.refs ?? [];
                        if(canDetail()) git = node.evidence.cwd ? await this.git.get(node.evidence.cwd,{ttlMs:inactive(node.evidence.state) ? 30000 : 5000}) : undefined;
                        }
                    } else if(git) git = {...git, availability:'stale', ageMs:Math.max(0,Date.now()-git.sampledAt),reason:'Updates paused while another session is shown'};
                    git ??= {availability:'unavailable',branchState:'unknown',reason:detailed ? 'Checkout path unavailable' : 'Details load when this session is shown',cwd:node.evidence.cwd ?? '',sampledAt:Date.now(),ageMs:0};
                    views.push({ ...node, resource:previous?.resource, refs, todos: list.items.map(t => ({ id: t.id, text: t.text, checked: t.checked, messageId: t.firstMessageId, firstSeenAt: t.firstSeen, latestMessageId: t.latestMessageId, repeated: t.repeated, source: t.source })), todoStatus: list.status, todoSourceMessageId: list.sourceMessageId, todoReportedAt: list.reportedAt, git });
                }
                this.data = { sessions: views, updatedAt: Date.now(), stale: false, diagnostics: [...forest.diagnostics, ...this.index.diagnostics, ...[...this.todos.values()].flatMap(list => list.diagnostics)] };
                this.updateResources();
                this.scheduleProcessSample();
                if (this.settings.nativeMode !== 'inspector-only') {
                    await this.publisher.publish(views.flatMap(s => (s.attachments ?? []).map(a => ({ ...s, attachment: a, resource: !this.paneOpen || this.sampledGeneration !== this.visibilityGeneration || s.key !== this.visibleSession ? {...this.tracker.view(s.key),availability:'stale' as const,reason:'Updates paused while this session is not shown'} : this.sampleError ? { ...this.tracker.view(s.key), availability: this.lastSample ? 'stale' as const : 'unavailable' as const, reason: this.sampleError } : this.tracker.view(s.key) }))), Date.now(), views);
                    if (!this.viewInstalled && !this.publisher.diagnostics.length && views.some(s => s.attachment)) {
                        await this.publisher.installView();
                        this.viewInstalled = true;
                    }
                    this.data.diagnostics.push(...this.publisher.diagnostics);
                    const ownership = this.publisher.ownership(), text = JSON.stringify(ownership);
                    if (this.publicationHash !== text) {
                        await this.store.write('publication', ownership);
                        this.publicationHash = text;
                    }
                }
                this.emit('data', this.data);
            }
            catch (error) {
                this.data.stale = true;
                this.diagnostic((error as Error).message);
                this.emit('data', this.data);
            }
        })().finally(() => { this.refreshing = undefined; });
        return this.refreshing;
    }
    private diagnostic(message: string) { this.data.diagnostics.push(message); this.data.diagnostics = this.data.diagnostics.slice(-64); this.emit('diagnostic', message); }
    private async saveTodo(key: string, list: TodoList) { const value = list.toJSON(), text = JSON.stringify(value); if (this.todoHashes.get(key) !== text) {
        await this.store.write('todo-' + identityName(key), value);
        this.todoHashes.set(key, text);
    } }
    async toggleTodo(key: string, id: string) { const list = this.todos.get(key); if (!list || !list.toggle(id))
        throw new Error('To-do item no longer present'); await this.saveTodo(key, list); const session = this.data.sessions.find(s => s.key === key); if (session)
        session.todos = list.items.map(t => ({ id: t.id, text: t.text, checked: t.checked, messageId: t.firstMessageId, firstSeenAt: t.firstSeen, latestMessageId: t.latestMessageId, repeated: t.repeated, source: t.source })); this.emit('data', this.data); }
    async setGoal(key: string, objective: string, status = 'active') { if (!this.data.sessions.some(s => s.key === key))
        throw new Error('Unknown session'); if (!objective.trim() || objective.length > 8192)
        throw new Error('Goal must contain 1–8192 characters'); const records = this.localGoals.get(key) ?? []; records.push({ id: `local-${Date.now()}`, objective, status, timestamp: Date.now(), source: 'explicit local action' }); this.localGoals.set(key, records.slice(-100)); await this.store.write('goals', Object.fromEntries(this.localGoals)); await this.refresh(); }
    async sampleProcesses(): Promise<void> {
        if (this.stopped)
            return;
        if (!this.paneOpen || !this.visibleSession || !this.data.sessions.some(s => s.key === this.visibleSession)) return;
        if (this.sampling)
            return this.sampling;
        this.lastProcessAttemptAt = Date.now();
        const generation = this.visibilityGeneration;
        const observed = new Set([this.visibleSession, ...(this.subtree ? this.descendants(this.visibleSession) : [])]);
        this.sampling = (async () => {
            try {
                const batch = await this.sampler.sample();
                this.sampleError = undefined;
                this.lastSample = batch;
                for (const record of this.savedLaunches) {
                    try {
                        if (this.data.sessions.some(s => s.key === record.sessionKey))
                            this.ledger.add(record, batch);
                    }
                    catch { /* Persisted associations require current locally validated process identity. */ }
                }
                this.savedLaunches = [];
                const roots: ProcessRoot[] = [];
                const batchProcesses = new Map(batch.processes.map(p => [p.pid,p]));
                const liveProofs = new Set<string>();
                // Other harnesses remain attribution exclusions. Their proofs are lightweight,
                // cached identity checks, never background transcript/Git/detail refreshes.
                for (const session of this.data.sessions)
                    for (const attachment of session.attachments ?? (session.attachment ? [session.attachment] : [])) {
                        if(!this.paneOpen || generation !== this.visibilityGeneration) return;
                        const proofKey = JSON.stringify([session.key,attachment.terminal_id]);
                        liveProofs.add(proofKey);
                        const proof = this.rootProofs.get(proofKey);
                        const oldProcess = proof ? batchProcesses.get(proof.root.pid) : undefined;
                        if(!observed.has(session.key) && proof && sameOccupant(proof.attachment,attachment) && proof.bootId === batch.bootId && oldProcess?.startTime === proof.root.startTime && batch.sampledAt-proof.verifiedAt < 30000) {roots.push(proof.root);continue;}
                        this.rootProofs.delete(proofKey);
                        const liveResult = await this.rpc.call('agent.get', { target: attachment.pane_id });
                        if(!this.paneOpen || generation !== this.visibilityGeneration) return;
                        if (!sameOccupant(attachment, liveResult.agent ?? liveResult)) continue;
                        const result = await this.rpc.call('pane.process_info', { pane_id: attachment.pane_id });
                        const info = result.process_info ?? result;
                        const foreground = (info.foreground_processes ?? []) as any[];
                        const candidates = foreground.filter(p => matchesHarness(session.evidence.provider, p));
                        const process = candidates.map(p => batchProcesses.get(p.pid)).find(Boolean);
                        if (!process) continue;
                        const root = {sessionKey:session.key,pid:process.pid,startTime:process.startTime};
                        roots.push(root);
                        this.rootProofs.set(proofKey,{attachment:{...attachment},root,bootId:batch.bootId,verifiedAt:batch.sampledAt});
                    }
                for(const key of this.rootProofs.keys())if(!liveProofs.has(key))this.rootProofs.delete(key);
                if (!this.paneOpen || generation !== this.visibilityGeneration) return;
                this.roots = roots;
                this.tracker.update(batch, roots, {resetCpuBaseline:this.warmup});
                this.warmup = false;
                this.sampledGeneration = generation;
                this.updateResources();
                for (const session of this.data.sessions.filter(s => observed.has(s.key))) {
                    const resource = session.resource!;
                    this.history.add(session.key, this.subtree ? 'subtree' : 'self', { at: batch.sampledAt, cpuPercent: resource.cpuPercent, memoryBytes: resource.memoryBytes, gap: resource.availability === 'unavailable' });
                    session.history = this.history.view(session.key, this.subtree ? 'subtree' : 'self');
                }
                this.emit('data', this.data);
            }
            catch (error) {
                this.sampleError = (error as Error).message;
                for (const session of this.data.sessions) {
                    if (session.resource)
                        session.resource = { ...session.resource, availability: 'stale', reason: (error as Error).message };
                    this.history.add(session.key, this.subtree ? 'subtree' : 'self', { at: Date.now(), gap: true });
                }
                this.diagnostic('Process sample: ' + (error as Error).message);
                this.emit('data', this.data);
            }
        })().finally(() => { this.sampling = undefined; this.scheduleProcessSample(); });
        return this.sampling;
    }
    async focus(key: string) { const session = this.data.sessions.find(s => s.key === key); const expected = session?.attachment; if (!expected)
        throw new Error('Agent has no live pane; conversation remains readable'); const result = await this.rpc.call('agent.get', { target: expected.pane_id }); const live: HerdrAgent = result.agent ?? result; if (!sameOccupant(expected, live))
        throw new Error('Agent occupant changed or ended'); await this.rpc.call('agent.focus', { target: expected.pane_id }); }
    async message(key: string, id: string) { const session = this.data.sessions.find(s => s.key === key); if (!session)
        return; const current = session.evidence.messages.find(m => m.id === id); if (current)
        return current; const ref = session.evidence.path ? { kind: 'path' as const, value: session.evidence.path } : { kind: 'id' as const, value: session.evidence.id }; return this.index.readMessage(session.evidence.provider, ref, id); }
    async pageMessages(key: string, beforeId?: string) { const session = this.data.sessions.find(s => s.key === key); if (!session)
        return []; const ref = session.evidence.path ? { kind: 'path' as const, value: session.evidence.path } : { kind: 'id' as const, value: session.evidence.id }; return this.index.page(session.evidence.provider, ref, { beforeId, limit: 200 }); }
    async recordLaunch(record: {
        id: string;
        sessionKey: string;
        pid: number;
        startTime: string;
        bootId?: string;
    }) { if (!this.data.sessions.some(s => s.key === record.sessionKey))
        throw new Error('Unknown session; launch cannot take process ownership'); if (!this.lastSample)
        throw new Error('No validated process sample'); this.ledger.add(record, this.lastSample); await this.store.write('launches', this.ledger.toJSON()); }
    async close(options: {
        clearNative?: boolean;
    } = {}) { this.stopped = true; clearInterval(this.timer); clearInterval(this.sampleTimer); await this.starting?.catch(() => { }); await this.refreshing; await this.sampling; if (options.clearNative !== false)
        await this.publisher.clear(this.data.sessions); this.index.close(); this.git.close(); await this.sampler.close(); }
}
